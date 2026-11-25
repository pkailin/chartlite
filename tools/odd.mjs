/**
 * The ODD axes this tool can actually measure, and the maths behind them.
 *
 * Three axes, each derived from data in hand rather than
 * guessed. The band EDGES follow ISO 34503, so a figure here means the same thing
 * as the same band anywhere else that follows the standard.
 *
 *   wind          kn, from NEA's station network
 *   rain          mm/h, from NEA — see RAIN_PERIOD_MIN for the trap
 *   illumination  ° solar elevation, COMPUTED
 *   glint         ° between the sun and where the camera looked, COMPUTED
 *   bin           four-hour slot of the Singapore day, from the timestamp
 *
 * Axes deliberately absent, each for a different reason:
 *
 *   visibility                   no source exists. NEA publishes none, and
 *                                inferring it from humidity would be inventing
 *                                a measurement.
 *   traffic_density, vessel_scale  need AIS, which is key-gated.
 *   depth                        needs bathymetry; NOAA's ERDDAP does not
 *                                answer from here.
 *   waterway, shore_proximity,   need charted geometry and the target logs.
 *   confinement, encounter        Reachable, not yet built.
 *
 * An absent axis is reported as absent. None of them is ever guessed.
 */

/* ── Bands ──────────────────────────────────────────────────────────────── */

/**
 * Ordered band ids per axis. ORDER IS THE WIRE FORMAT: the adapter writes the
 * INDEX into these arrays, not the name, which turns a string per axis per dot
 * into a small integer and keeps a 40,000-dot file to megabytes rather than
 * tens of them. The arrays travel in the output so it stays self-describing.
 *
 * THESE KEYS AND THE VECTOR WRITTEN BY conditionDots MUST AGREE, in count and
 * in order. They disagreed once — two axes were dropped from the vector while
 * these tables still listed them — and the result was not an error but a
 * SHIFT: every dot's bin index was read as its illumination, and the last two
 * axes read 100% unknown. Nothing threw. `odd.test.ts` now pins the length.
 */
export const BANDS = {
  wind: ['calm', 'moderate', 'fresh', 'strong'],
  rain: ['dry', 'light', 'moderate_rain', 'heavy'],
  bin: ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'],
};

/** Human labels, carried in the output so the app needs no copy of them. */
export const BAND_LABELS = {
  wind: ['Calm (<5 kn)', 'Moderate (5–15 kn)', 'Fresh (15–25 kn)', 'Strong (>25 kn)'],
  rain: ['Dry (<0.2 mm/h)', 'Light (0.2–4 mm/h)', 'Moderate (4–10 mm/h)', 'Heavy (>10 mm/h)'],
  bin: ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'],
};

export const AXES = Object.keys(BANDS);

/** `null` means UNKNOWN — no reading, or no heading to compute against. It is
 *  a real state and is reported, never folded into a band. */
export const UNKNOWN = null;

/* ── Weather ────────────────────────────────────────────────────────────── */

/** Wind speed in knots → band index. */
export function windBand(kn) {
  if (!Number.isFinite(kn)) return UNKNOWN;
  if (kn < 5) return 0;
  if (kn < 15) return 1;
  if (kn < 25) return 2;
  return 3;
}

/**
 * NEA's realtime rainfall endpoint reports a 5-MINUTE ACCUMULATION in mm,
 * while every rain band is an INTENSITY in mm/h. Banding the raw deposit
 * against mm/h edges under-reads by 12× — a tropical downpour filed as light
 * rain. The conversion happens here, once, for every caller.
 *
 * This constant is NEA's. A second rainfall source would need its own declared
 * period; it must not inherit this one.
 */
export const RAIN_PERIOD_MIN = 5;

export function rainMmPerH(accumulatedMm) {
  return accumulatedMm * (60 / RAIN_PERIOD_MIN);
}

/** Rain INTENSITY in mm/h → band index. Pass the converted value. */
export function rainBand(mmPerH) {
  if (!Number.isFinite(mmPerH)) return UNKNOWN;
  if (mmPerH < 0.2) return 0;
  if (mmPerH < 4) return 1;
  if (mmPerH < 10) return 2;
  return 3;
}

/* ── Time of day ────────────────────────────────────────────────────────── */

/** Singapore is UTC+8 with no daylight saving, so one constant is enough. */
export const SGT_OFFSET_MS = 8 * 3600_000;

/** Epoch ms → four-hour bin of the Singapore day. */
export function binOf(ms) {
  const d = ((ms + SGT_OFFSET_MS) % 86_400_000 + 86_400_000) % 86_400_000;
  return Math.floor(d / (4 * 3600_000));
}

/* ── The sun ────────────────────────────────────────────────────────────── */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Solar elevation and azimuth, by NOAA's algorithm.
 *
 * Accurate to well under a degree, which is far more than banding needs — the
 * nearest edge is 6° away. It takes no network, no API key and no data file:
 * where the sun was over Singapore on 17 December 2025 is arithmetic, and
 * these two axes are therefore the only ones here that can never be stale,
 * rate-limited or revoked.
 *
 * @returns {{elevation: number, azimuth: number}} degrees; azimuth clockwise
 *          from true north.
 */
export function sunPosition(ms, latDeg, lonDeg) {
  // Julian day, then centuries since J2000.0.
  const jd = ms / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  // Geometric mean longitude and anomaly of the sun.
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);

  // Equation of centre → true longitude → apparent longitude.
  const C =
    Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // Obliquity of the ecliptic, with the nutation correction.
  const e0 =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * RAD);

  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;

  // Equation of time, in minutes.
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const eqTime =
    4 * DEG * (
      y * Math.sin(2 * L0 * RAD)
      - 2 * eccent * Math.sin(M * RAD)
      + 4 * eccent * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
      - 0.5 * y * y * Math.sin(4 * L0 * RAD)
      - 1.25 * eccent * eccent * Math.sin(2 * M * RAD)
    );

  // True solar time → hour angle.
  const utcMinutes = (ms % 86_400_000) / 60_000;
  const trueSolarMin = (utcMinutes + eqTime + 4 * lonDeg + 1440) % 1440;
  const ha = trueSolarMin / 4 - 180;

  const latR = latDeg * RAD, declR = decl * RAD, haR = ha * RAD;
  const cosZenith =
    Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;

  // Azimuth from the zenith triangle; the sign of the hour angle puts it in
  // the right half of the compass (morning east, afternoon west).
  let azimuth;
  const denom = Math.cos(latR) * Math.sin(zenith * RAD);
  if (Math.abs(denom) < 1e-9) {
    azimuth = declR > latR ? 0 : 180;   // sun overhead: azimuth is degenerate
  } else {
    const cosAz = (Math.sin(declR) - Math.sin(latR) * cosZenith) / denom;
    azimuth = Math.acos(Math.min(1, Math.max(-1, cosAz))) * DEG;
    if (ha > 0) azimuth = 360 - azimuth;
  }

  return { elevation: 90 - zenith, azimuth: (azimuth + 360) % 360 };
}


/**
 * Smallest angle between two compass bearings, 0–180°.
 *
 * The `+540 … %360 −180` dance wraps the difference into −180…180 while
 * surviving a negative operand, which `%` alone does not in JS.
 *
 * This had a `180 -` in front of it and returned the SUPPLEMENT — so a camera
 * pointing straight at the sun scored 180 and read as `clear_of_sun`, and
 * every glint band in the output was inverted. The numbers looked entirely
 * reasonable: 17% specular is a plausible figure, which is precisely why it
 * survived a read-through and only a test against a hand-computed angle
 * caught it.
 */
export function bearingDelta(a, b) {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

/*
 * sunPosition and bearingDelta are kept though nothing bands on them now.
 *
 * They are the two primitives a real backlight measure needs — sun elevation,
 * sun azimuth, and the angle from the camera to it — and they are correct and
 * tested. What is missing is not the maths but the camera's VERTICAL FIELD OF
 * VIEW, which the KR share does not state: without it there is no honest way
 * to say whether a sun at 12 degrees was in frame. Keeping these here means
 * that gap is a stated assumption away from being closed, rather than a
 * rewrite.
 */
