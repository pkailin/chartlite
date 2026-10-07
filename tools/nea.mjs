/**
 * NEA's realtime station network, read HISTORICALLY.
 *
 * `https://api.data.gov.sg/v1/environment/<param>?date=YYYY-MM-DD` returns a
 * whole day of snapshots, and it still serves December 2025 — verified against
 * every day this corpus covers. That is the point of this file: the weather a
 * frame was captured in is pulled BY ITS TIMESTAMP, not polled live and hoped
 * to overlap.
 *
 * It is the difference between a record and a coincidence. A live poller only
 * has weather for the wall-clock periods it happened to be running; asking by
 * date cannot miss, however long after the fact you ask.
 *
 * Resolution, measured on 2025-12-17:
 *
 *   wind-speed   1,439 snapshots — one a MINUTE, 13 stations
 *   rainfall       287 snapshots — one per 5 minutes, ~60 stations
 *
 * UNITS ARE READ, NOT ASSUMED. `metadata.reading_unit` is checked against what
 * the caller expects and a mismatch throws. A metres-per-second reading banded
 * against knot edges would mis-size every figure downstream while looking
 * perfectly healthy — this package's one job is to not do that.
 */

const BASE = 'https://api.data.gov.sg/v1/environment';

/** Per-request ceiling. A day of wind is ~18,700 readings and is not small. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * One day of one parameter.
 *
 * @param {string} param     NEA path segment, e.g. 'wind-speed'
 * @param {string} day       'YYYY-MM-DD', Singapore time
 * @param {string} wantUnit  the unit the caller will band against
 * @returns {Promise<{stations: Map, series: {t: number, byStation: Map}[]}>}
 */
export async function fetchDay(param, day, wantUnit) {
  const url = `${BASE}/${param}?date=${day}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${url}`);
  const json = await res.json();

  const unit = json?.metadata?.reading_unit;
  if (unit !== wantUnit) {
    throw new Error(
      `${param} ${day}: expected unit "${wantUnit}", got "${String(unit)}". `
      + 'Refusing to band a reading whose unit changed.',
    );
  }

  const stations = new Map();
  for (const s of json?.metadata?.stations ?? []) {
    const lat = s?.location?.latitude;
    const lon = s?.location?.longitude;
    // A station with no position cannot be the nearest to anything. Dropped
    // rather than placed at (0, 0), for the usual reason.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stations.set(String(s.id), { id: String(s.id), name: String(s.name ?? s.id), lat, lon });
  }

  const series = [];
  for (const item of json?.items ?? []) {
    const t = Date.parse(item?.timestamp ?? '');
    if (!Number.isFinite(t)) continue;
    const byStation = new Map();
    for (const r of item?.readings ?? []) {
      if (Number.isFinite(r?.value)) byStation.set(String(r.station_id), r.value);
    }
    if (byStation.size > 0) series.push({ t, byStation });
  }
  // The API returns them in order, but a sort is cheap and the binary search
  // below is wrong in a way that is hard to see if it ever is not.
  series.sort((a, b) => a.t - b.t);

  return { stations, series };
}

/** Metres per degree of latitude. Good to ~0.1% over the Strait. */
const M_PER_DEG_LAT = 110_574;

/** Squared distance in degrees², longitude scaled for latitude. Comparison
 *  only — no square root, because nothing here needs the actual distance. */
function dist2(aLat, aLon, bLat, bLon) {
  const k = Math.cos(aLat * (Math.PI / 180));
  const dLat = aLat - bLat;
  const dLon = (aLon - bLon) * k;
  return dLat * dLat + dLon * dLon;
}

/**
 * A reader that answers "what was this parameter at this place and time".
 *
 * Two nearests, and they are different kinds of thing:
 *
 *   TIME   the snapshot closest to the instant, within `toleranceMs`. Beyond
 *          it there is no reading, and the answer is null.
 *   PLACE  the nearest station that actually REPORTED in that snapshot. Not
 *          simply the nearest station: stations drop in and out, and silently
 *          falling back to "no value" when the closest one was offline would
 *          turn a station outage into a weather gap.
 *
 * Returns null rather than a number whenever either search fails. Null is
 * `unknown`, which is a band in its own right.
 */
export function makeReader(days, toleranceMs) {
  // One merged, sorted series across every day fetched.
  const series = days.flatMap((d) => d.series).sort((a, b) => a.t - b.t);
  const stations = new Map();
  for (const d of days) for (const [k, v] of d.stations) stations.set(k, v);

  return function read(ms, lat, lon) {
    if (series.length === 0) return null;

    let lo = 0, hi = series.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t < ms) lo = mid + 1; else hi = mid;
    }
    let best = -1, bestGap = Infinity;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= series.length) continue;
      const gap = Math.abs(series[i].t - ms);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0 || bestGap > toleranceMs) return null;

    const snapshot = series[best];
    let value = null, bestD2 = Infinity, stationId = null;
    for (const [id, v] of snapshot.byStation) {
      const st = stations.get(id);
      if (!st) continue;
      const d2 = dist2(lat, lon, st.lat, st.lon);
      if (d2 < bestD2) { bestD2 = d2; value = v; stationId = id; }
    }
    if (value === null) return null;

    return {
      value,
      stationId,
      stationName: stations.get(stationId)?.name ?? stationId,
      km: Math.sqrt(bestD2) * M_PER_DEG_LAT / 1000,
      gapMs: bestGap,
    };
  };
}
