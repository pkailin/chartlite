/**
 * Adapter: the SynDataset layout → the neutral corpus the app draws.
 *
 * THIS IS THE ONLY FILE THAT KNOWS THE LAYOUT. Every configured source must
 * follow it:
 *
 *   <root>/rawdata/<SCN>/metadata.json             ODD labels, date, duration
 *   <root>/rawdata/<SCN>/gnss/gnss_info.csv        stamp_ns,lat,lon,heading_deg,…
 *   <root>/rawdata/<SCN>/<sensor>/images/<f>.jpg   one per frame (or .png)
 *   <root>/groundtruth/<SCN>/<sensor>/2dbbox/<f>.json   boxes for that frame
 *
 * A SENSOR is any folder under rawdata/<SCN>/ that holds an `images/` folder.
 * Its kind comes from its name: `camera*` is a camera and `radar*` is a radar.
 * Sensors are found from the folders and not from a fixed list, so a radar
 * stream that arrives later is picked up with no code change.
 *
 * Rules carried over from the earlier adapter, each for the same reason. The
 * alternative silently gives a plausible wrong answer:
 *  - ns stamps are divided on BigInt (they are past 2^53);
 *  - a fix without finite lat/lon is dropped, and (0, 0) is refused;
 *  - a scenario that cannot be read is EXCLUDED WITH A REASON, not skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bandValue, resolveAxes } from './odd.mjs';

export const IMAGE_EXT = /\.(jpe?g|png)$/i;

/** Route points kept at most this often. The GNSS log runs at 10 Hz. */
export const ROUTE_STEP_MS = 1000;

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Minimal CSV: no quoted fields in this layout. Tolerates CRLF. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const head = (lines.shift() ?? '').split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    head.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

/** `1786057500123456789` → 1786057500123. Exact, via BigInt. */
export function nsToMs(text) {
  if (!/^\d+$/.test(text)) return null;
  return Number(BigInt(text) / 1_000_000n);
}

/** gnss_info.csv → fixes in time order. Unplaceable rows are counted, not kept. */
export function parseGnss(text) {
  const points = [];
  let dropped = 0;
  let degraded = 0;
  for (const r of parseCsv(text)) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const t = nsToMs(r.stamp_ns ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || t === null || (lat === 0 && lon === 0)) {
      dropped++;
      continue;
    }
    if (r.status && r.status !== 'good') degraded++;
    const h = Number(r.heading_deg);
    points.push({ lon, lat, t, heading: r.heading_deg !== '' && Number.isFinite(h) ? h : null });
  }
  points.sort((a, b) => a.t - b.t);
  return { points, dropped, degraded };
}

/** Keep one fix per `stepMs`, plus the last one, so the line still ends where the vessel did. */
export function thinRoute(points, stepMs = ROUTE_STEP_MS) {
  const out = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t - last >= stepMs) { out.push(p); last = p.t; }
  }
  const end = points[points.length - 1];
  if (end && out[out.length - 1] !== end) out.push(end);
  return out;
}

export function sensorKind(id) {
  if (/^radar/i.test(id)) return 'radar';
  if (/^cam/i.test(id)) return 'camera';
  return id;
}

/** Frame files sort by their leading ns stamp: numerically, then by name. */
export function compareFrames(a, b) {
  const sa = /^\d+/.exec(a)?.[0] ?? '';
  const sb = /^\d+/.exec(b)?.[0] ?? '';
  if (sa.length !== sb.length) return sa.length - sb.length;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function stemOf(file) {
  return file.replace(/\.[^.]+$/, '');
}

export function scenarioDir(root, scn) {
  return join(root, 'rawdata', scn);
}

/** The sensors a scenario recorded: folders with an images/ inside. */
export function sensorsOf(root, scn) {
  const dir = scenarioDir(root, scn);
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((d) => isDir(join(dir, d, 'images')))
    .sort()
    .map((id) => ({ id, kind: sensorKind(id) }));
}

export function listFrames(root, scn, sensor) {
  const dir = join(scenarioDir(root, scn), sensor, 'images');
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).sort(compareFrames);
}

export function listScenarios(root) {
  const dir = join(root, 'rawdata');
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter((d) => !d.startsWith('.') && !d.startsWith('@') && isDir(join(dir, d))).sort();
}

/** One scenario, read from disk. Throws with a reason when it cannot be used. */
export function readScenario(source, scn, axes) {
  const dir = scenarioDir(source.root, scn);
  const metaFile = join(dir, 'metadata.json');
  if (!existsSync(metaFile)) throw new Error('no metadata.json');
  let meta;
  try { meta = JSON.parse(readFileSync(metaFile, 'utf8')); } catch { throw new Error('metadata.json is not valid JSON'); }

  const gnssFile = join(dir, 'gnss', 'gnss_info.csv');
  if (!existsSync(gnssFile)) throw new Error('no gnss/gnss_info.csv');
  const gnss = parseGnss(readFileSync(gnssFile, 'utf8'));
  if (gnss.points.length === 0) throw new Error('gnss_info.csv has no usable fix');

  const odd = {};
  for (const a of axes) odd[a.key] = bandValue(meta[a.key]);

  const streams = sensorsOf(source.root, scn).map((s) => ({
    ...s, frames: listFrames(source.root, scn, s.id).length,
  }));
  const frames = { camera: 0, radar: 0 };
  for (const s of streams) frames[s.kind] = (frames[s.kind] ?? 0) + s.frames;

  return {
    id: `${source.name}/${scn}`,
    source: source.name,
    scenario: typeof meta.scenario_id === 'string' ? meta.scenario_id : scn,
    dir: scn,
    date: typeof meta.date === 'string' ? meta.date : null,
    startTime: typeof meta.start_time === 'string' ? meta.start_time : null,
    durationS: Number.isFinite(Number(meta.duration_sec)) ? Number(meta.duration_sec) : null,
    targets: Array.isArray(meta.target_list) ? meta.target_list.map(String) : [],
    odd,
    route: thinRoute(gnss.points),
    fixes: gnss.points.length,
    fixesDegraded: gnss.degraded,
    fixesDropped: gnss.dropped,
    streams,
    frames,
  };
}

/** Everything every configured source holds, in the shape of src/data/corpus.ts. */
export function buildCorpus(config) {
  const scenarios = [];
  const excluded = [];
  const sources = [];
  for (const source of config.sources) {
    if (!isDir(join(source.root, 'rawdata'))) {
      sources.push({ name: source.name, path: source.path, scenarios: 0, error: `no rawdata/ under ${source.root}` });
      continue;
    }
    let n = 0;
    for (const scn of listScenarios(source.root)) {
      try {
        scenarios.push(readScenario(source, scn, config.axes));
        n++;
      } catch (e) {
        excluded.push({ id: `${source.name}/${scn}`, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    sources.push({ name: source.name, path: source.path, scenarios: n, error: null });
  }
  return {
    version: 4,
    generatedAt: new Date().toISOString(),
    sources,
    axes: resolveAxes(config.axes, scenarios),
    scenarios,
    excluded,
  };
}
