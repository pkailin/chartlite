/**
 * How well each 2D box agrees with where GNSS says its target vessel was.
 *
 * A box is checked only when its `id` is also in that frame's
 * groundtruth/<SCN>/targets/gps file. Every other box (untracked traffic,
 * marks) has nothing to be compared with.
 *
 * RADAR (range and bearing). The box centre's distance and angle from own-ship
 * pixel, scaled by radar_params.yaml, are compared with range and bearing from
 * own-ship GNSS to the target. A best-fit scale is reported beside the one
 * used, so a wrong `scanner_range_m` shows up as a mismatch, not a silent bias.
 *
 * CAMERA (bearing only). The box centre is undistorted, turned into an angle
 * off the optical axis, and shifted by the camera's yaw on the hull. Range
 * cannot be measured from one image: at 600 m a target sits ~3 px below the
 * horizon, and hull pitch moves the horizon by tens of pixels. Box width is
 * converted to metres at the GNSS range, for comparison with the vessel's
 * length and breadth.
 *
 * Calibration: configs/<calibration_version>/ in the source, overridden per
 * source by `calibration` in chartlite.config.json. A camera whose yaw is
 * missing or TBD gets a yaw FITTED from the targets, and the report says so.
 *
 * Not modelled: mount lever arms (≈1 m against targets hundreds of metres
 * away), hull roll and pitch, and earth curvature.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from './yaml-lite.mjs';
import { IMAGE_EXT, isDir, nsToMs, parseGnss, sensorKind, stemOf } from './syndataset.mjs';

/** A target GPS file further than this from the frame is not used. */
export const MAX_TARGET_DT_MS = 500;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EARTH_R = 6371008.8;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function readYaml(file) {
  return existsSync(file) ? parseYaml(readFileSync(file, 'utf8')) : null;
}

/** Flat-earth range and true bearing. Good to well under a metre over a few km. */
export function rangeBearing(lat0, lon0, lat1, lon1) {
  const dn = (lat1 - lat0) * D2R * EARTH_R;
  const de = (lon1 - lon0) * D2R * EARTH_R * Math.cos(((lat0 + lat1) / 2) * D2R);
  return { range: Math.hypot(dn, de), bearing: ((Math.atan2(de, dn) * R2D) + 360) % 360 };
}

/* ── Calibration ───────────────────────────────────────────────────────── */

export function radarFrom(y) {
  if (!y) return null;
  const w = num(y.image?.width);
  const ox = num(y.origin_px?.x) ?? (w !== null ? w / 2 : null);
  const h = num(y.image?.height);
  const oy = num(y.origin_px?.y) ?? (h !== null ? h / 2 : null);
  const mpp = num(y.range?.meters_per_pixel)
    ?? (num(y.range?.scanner_range_m) !== null && w !== null ? y.range.scanner_range_m / (w / 2) : null);
  if (ox === null || oy === null || mpp === null) return null;
  return {
    originX: ox,
    originY: oy,
    metersPerPixel: mpp,
    alignment: typeof y.orientation?.alignment === 'string' ? y.orientation.alignment : 'heading_up',
    zeroBearingDeg: num(y.orientation?.zero_bearing_offset_deg) ?? 0,
    zeroRangeM: num(y.range?.zero_range_offset_m) ?? 0,
  };
}

export function cameraFrom(intr, extr) {
  if (!intr) return null;
  const m = intr.camera_matrix ?? intr.intrinsic_matrix ?? {};
  const fx = num(m.fx), fy = num(m.fy), cx = num(m.cx), cy = num(m.cy);
  if (fx === null || fy === null || cx === null || cy === null) return null;
  const d = intr.distortion;
  const coeffs = Array.isArray(d?.coefficients) ? d.coefficients.map((c) => num(c) ?? 0) : null;
  return {
    fx, fy, cx, cy,
    width: num(intr.resolution?.width),
    height: num(intr.resolution?.height),
    dist: coeffs && coeffs.some((c) => c !== 0) ? coeffs : null,
    yawDeg: num(extr?.yaw_deg) ?? num(extr?.rotation_deg?.yaw),
    pitchDeg: num(extr?.pitch_deg) ?? num(extr?.rotation_deg?.pitch),
  };
}

export function loadCalibration(root, version) {
  const dir = join(root, 'configs', version);
  const extr = readYaml(join(dir, 'extrinsic_params.yaml')) ?? {};
  const cameras = {};
  if (isDir(dir)) {
    for (const f of readdirSync(dir)) {
      const m = /^(.+)_intrinsic\.ya?ml$/.exec(f);
      if (m) cameras[m[1]] = cameraFrom(readYaml(join(dir, f)), extr[m[1]]);
    }
  }
  return { dir, radar: radarFrom(readYaml(join(dir, 'radar_params.yaml'))), cameras };
}

/* ── Camera geometry ───────────────────────────────────────────────────── */

/** OpenCV rational/plumb-bob model: undistorted normalised → distorted normalised. */
export function distort(dist, x, y) {
  if (!dist) return [x, y];
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0] = dist;
  const r2 = x * x + y * y;
  const radial = (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2) / (1 + k4 * r2 + k5 * r2 * r2 + k6 * r2 * r2 * r2);
  return [
    x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
    y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y,
  ];
}

/**
 * Pixel → undistorted normalised coordinates.
 *
 * Newton's method with a numerical Jacobian. The plain fixed-point iteration
 * cv::undistortPoints uses fails to converge in the corners of strongly
 * distorted wide-angle lenses (off by >10 px there on RealDataset's cameras).
 */
export function undistortPixel(cam, u, v) {
  const xd = (u - cam.cx) / cam.fx;
  const yd = (v - cam.cy) / cam.fy;
  if (!cam.dist) return [xd, yd];
  let x = xd, y = yd;
  const h = 1e-7;
  for (let i = 0; i < 50; i++) {
    const [fx0, fy0] = distort(cam.dist, x, y);
    const ex = fx0 - xd, ey = fy0 - yd;
    if (Math.hypot(ex, ey) < 1e-12) break;
    const [ax, ay] = distort(cam.dist, x + h, y);
    const [bx, by] = distort(cam.dist, x, y + h);
    const j11 = (ax - fx0) / h, j21 = (ay - fy0) / h, j12 = (bx - fx0) / h, j22 = (by - fy0) / h;
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    x -= (j22 * ex - j12 * ey) / det;
    y -= (-j21 * ex + j11 * ey) / det;
  }
  return [x, y];
}

/** Horizontal angle of a pixel off the optical axis, degrees, + to starboard. */
export function cameraAzimuth(cam, u, v, pitchDeg = 0) {
  const [x, y] = undistortPixel(cam, u, v);
  const a = -pitchDeg * D2R; // camera tilted down by a
  return Math.atan2(x, -y * Math.sin(a) + Math.cos(a)) * R2D;
}

/**
 * Every pixel at one azimuth: a straight line in an undistorted image, a curve
 * after distortion. Returned as a polyline clipped to the image, or [] when the
 * bearing is outside the camera's view.
 */
export function cameraBearingLine(cam, azDeg, pitchDeg = 0) {
  if (Math.abs(azDeg) >= 89) return [];
  const a = -pitchDeg * D2R;
  const t = Math.tan(azDeg * D2R);
  const W = cam.width ?? cam.cx * 2;
  const H = cam.height ?? cam.cy * 2;
  const [, yTop] = undistortPixel(cam, cam.cx, 0);
  const [, yBot] = undistortPixel(cam, cam.cx, H);
  const pts = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const y = yTop + ((yBot - yTop) * i) / N;
    const zl = -y * Math.sin(a) + Math.cos(a);
    if (zl <= 0) continue;
    const [xd, yd] = distort(cam.dist, t * zl, y);
    const u = cam.cx + cam.fx * xd;
    const v = cam.cy + cam.fy * yd;
    if (u >= -1 && u <= W + 1 && v >= -1 && v <= H + 1) pts.push([Math.round(u * 10) / 10, Math.round(v * 10) / 10]);
  }
  return pts.length >= 2 ? pts : [];
}

/* ── Radar geometry ────────────────────────────────────────────────────── */

/** Pixel → range (m) and bearing relative to the bow (deg). */
export function radarToPolar(radar, x, y, headingDeg) {
  const dx = x - radar.originX;
  const dy = radar.originY - y;
  const range = Math.hypot(dx, dy) * radar.metersPerPixel + radar.zeroRangeM;
  let b = Math.atan2(dx, dy) * R2D + radar.zeroBearingDeg;
  if (radar.alignment === 'north_up') b -= headingDeg;
  return { range, bearing: wrap180(b), pixels: Math.hypot(dx, dy) };
}

export function radarToPixel(radar, range, relBearingDeg, headingDeg) {
  let b = relBearingDeg - radar.zeroBearingDeg;
  if (radar.alignment === 'north_up') b += headingDeg;
  const px = Math.max(0, range - radar.zeroRangeM) / radar.metersPerPixel;
  return { x: radar.originX + px * Math.sin(b * D2R), y: radar.originY - px * Math.cos(b * D2R) };
}

/* ── Stats ─────────────────────────────────────────────────────────────── */

function quantile(xs, q) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? null;
}
const median = (xs) => quantile(xs, 0.5);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

/* ── Scenario report ───────────────────────────────────────────────────── */

function nearestIndex(sorted, t) {
  let lo = 0, hi = sorted.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs((sorted[lo - 1] ?? 0) - t) <= Math.abs((sorted[lo] ?? 0) - t)) lo--;
  return lo;
}

function readTargets(dir) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const t = nsToMs(String(j.stamp_ns ?? /^\d+/.exec(f)?.[0] ?? ''));
      if (t !== null && Array.isArray(j.targets)) out.push({ t, targets: j.targets });
    } catch { /* an unreadable file is skipped; it would only drop frames */ }
  }
  return out.sort((a, b) => a.t - b.t);
}

function readRegistry(root) {
  const f = join(root, 'target_registry.json');
  if (!existsSync(f)) return {};
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    const byId = {};
    for (const [name, v] of Object.entries(raw)) {
      if (v && typeof v === 'object' && v.id !== undefined) {
        byId[String(v.id)] = { name, length: num(v.length_m), breadth: num(v.breadth_m), type: v.vessel_type ?? null };
      }
    }
    return byId;
  } catch { return {}; }
}

/** Which scenarios of a source have target GPS at all. */
export function scenariosWithTargets(root) {
  const g = join(root, 'groundtruth');
  if (!isDir(g)) return [];
  return readdirSync(g).filter((s) => isDir(join(g, s, 'targets', 'gps'))).sort();
}

export function scenarioAccuracy(source, scn) {
  const notes = [];
  const rawDir = join(source.root, 'rawdata', scn);
  const gtDir = join(source.root, 'groundtruth', scn);
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(rawDir, 'metadata.json'), 'utf8')); } catch { notes.push('no readable metadata.json'); }
  const version = typeof meta.calibration_version === 'string' ? meta.calibration_version : 'v1';
  const calib = loadCalibration(source.root, version);
  const over = source.calibration ?? {};

  const gnssFile = join(rawDir, 'gnss', 'gnss_info.csv');
  const fixes = existsSync(gnssFile) ? parseGnss(readFileSync(gnssFile, 'utf8')).points : [];
  const fixT = fixes.map((p) => p.t);
  const targets = readTargets(join(gtDir, 'targets', 'gps'));
  const targetT = targets.map((x) => x.t);
  const registry = readRegistry(source.root);
  if (fixes.length === 0) notes.push('no GNSS fixes: nothing can be checked');
  if (targets.length === 0) notes.push('no targets/gps files: nothing can be checked');

  const sensors = [];
  const sensorDirs = isDir(gtDir) ? readdirSync(gtDir).filter((d) => isDir(join(gtDir, d, '2dbbox'))).sort() : [];

  for (const sensor of sensorDirs) {
    const kind = sensorKind(sensor);
    const imgDir = join(rawDir, sensor, 'images');
    const images = new Map((isDir(imgDir) ? readdirSync(imgDir) : []).filter((f) => IMAGE_EXT.test(f)).map((f) => [stemOf(f), f]));

    let radar = null;
    let cam = null;
    const calibOut = {};
    if (kind === 'radar') {
      radar = calib.radar ? { ...calib.radar } : null;
      const o = over.radar ?? over[sensor] ?? {};
      if (num(o.meters_per_pixel) !== null) {
        if (!radar) radar = { originX: 1024, originY: 1024, alignment: 'heading_up', zeroBearingDeg: 0, zeroRangeM: 0, metersPerPixel: o.meters_per_pixel };
        else radar.metersPerPixel = o.meters_per_pixel;
        calibOut.scaleSource = 'chartlite.config.json';
      } else calibOut.scaleSource = 'radar_params.yaml';
      if (!radar) { notes.push(`${sensor}: no radar_params.yaml in ${calib.dir}, not checked`); continue; }
      Object.assign(calibOut, { metersPerPixel: radar.metersPerPixel, rangeAtEdgeM: Math.round(radar.metersPerPixel * radar.originX), alignment: radar.alignment });
    } else {
      cam = calib.cameras[sensor] ? { ...calib.cameras[sensor] } : null;
      if (!cam) { notes.push(`${sensor}: no ${sensor}_intrinsic.yaml in ${calib.dir}, not checked`); continue; }
      const o = over[sensor] ?? {};
      if (num(o.yaw_deg) !== null) { cam.yawDeg = o.yaw_deg; calibOut.yawSource = 'chartlite.config.json'; }
      else if (cam.yawDeg !== null) calibOut.yawSource = 'extrinsic_params.yaml';
      if (num(o.pitch_deg) !== null) cam.pitchDeg = o.pitch_deg;
      calibOut.pitchDeg = cam.pitchDeg ?? 0;
      calibOut.pitchAssumed = cam.pitchDeg === null;
      calibOut.distortion = cam.dist ? 'undistorted' : 'none';
    }

    const frames = [];
    const files = readdirSync(join(gtDir, sensor, '2dbbox')).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      let box;
      try { box = JSON.parse(readFileSync(join(gtDir, sensor, '2dbbox', f), 'utf8')); } catch { continue; }
      const t = nsToMs(String(box.stamp_ns ?? /^\d+/.exec(f)?.[0] ?? ''));
      if (t === null || !Array.isArray(box.objects)) continue;
      const ti = nearestIndex(targetT, t);
      const tg = targets[ti];
      if (!tg || Math.abs(tg.t - t) > MAX_TARGET_DT_MS) continue;
      const byId = new Map(tg.targets.map((x) => [String(x.id), x]));
      const fi = nearestIndex(fixT, t);
      const own = fixes[fi];
      if (!own || own.heading === null) continue;

      const checks = [];
      for (const o of box.objects) {
        const tgt = byId.get(String(o.id));
        if (!tgt || num(tgt.lat) === null || num(tgt.lon) === null) continue;
        const g = rangeBearing(own.lat, own.lon, tgt.lat, tgt.lon);
        const gRel = wrap180(g.bearing - own.heading);
        const reg = registry[String(o.id)] ?? null;
        const cx = o.xmin + o.width / 2;
        const cy = o.ymin + o.height / 2;
        const c = {
          id: o.id,
          name: tgt.vessel_name ?? reg?.name ?? String(o.id),
          lengthM: reg?.length ?? null,
          breadthM: reg?.breadth ?? null,
          box: { xmin: o.xmin, ymin: o.ymin, width: o.width, height: o.height },
          gnss: { range: r1(g.range), bearing: r1(gRel) },
          dtMs: Math.round(tg.t - t),
        };
        if (radar) {
          const p = radarToPolar(radar, cx, cy, own.heading);
          const pred = radarToPixel(radar, g.range, gRel, own.heading);
          c.measured = { range: r1(p.range), bearing: r1(p.bearing) };
          c.err = { range: r1(p.range - g.range), bearing: r1(wrap180(p.bearing - gRel)), position: r1(Math.hypot(cx - pred.x, cy - pred.y) * radar.metersPerPixel) };
          c.predicted = { x: r1(pred.x), y: r1(pred.y) };
          c.sizeM = { w: r1(o.width * radar.metersPerPixel), h: r1(o.height * radar.metersPerPixel) };
          c._px = p.pixels;
          c._g = g.range;
        } else if (cam) {
          c._az = cameraAzimuth(cam, cx, cy, cam.pitchDeg ?? 0);
          c._gRel = gRel;
          const [xl] = undistortPixel(cam, o.xmin, cy);
          const [xr] = undistortPixel(cam, o.xmin + o.width, cy);
          c.sizeM = { w: r1(Math.abs(xr - xl) * g.range) };
        }
        checks.push(c);
      }
      if (checks.length === 0) continue;
      frames.push({ file: images.get(stemOf(f)) ?? null, stem: stemOf(f), t, heading: own.heading, checks });
    }

    const all = frames.flatMap((fr) => fr.checks);

    if (cam) {
      // Fit the yaw from the data: always reported, used only when none is configured.
      const fitted = median(all.map((c) => wrap180(c._gRel - c._az)));
      calibOut.fittedYawDeg = r1(fitted);
      if (cam.yawDeg === null) { cam.yawDeg = fitted ?? 0; calibOut.yawSource = 'fitted'; }
      calibOut.yawDeg = r1(cam.yawDeg);
      for (const fr of frames) {
        for (const c of fr.checks) {
          const meas = wrap180(cam.yawDeg + c._az);
          c.measured = { bearing: r1(meas) };
          c.err = { bearing: r1(wrap180(meas - c._gRel)) };
          c.line = cameraBearingLine(cam, wrap180(c._gRel - cam.yawDeg), cam.pitchDeg ?? 0);
          delete c._az; delete c._gRel;
        }
      }
    }
    if (radar) {
      const px = all.map((c) => c._px), rg = all.map((c) => c._g);
      const den = px.reduce((a, p) => a + p * p, 0);
      calibOut.fittedMetersPerPixel = den > 0 ? Math.round((px.reduce((a, p, i) => a + p * (rg[i] ?? 0), 0) / den) * 10000) / 10000 : null;
      calibOut.fittedRangeAtEdgeM = calibOut.fittedMetersPerPixel !== null ? Math.round(calibOut.fittedMetersPerPixel * radar.originX) : null;
      for (const c of all) { delete c._px; delete c._g; }
    }

    const ids = [...new Set(all.map((c) => String(c.id)))];
    const summary = ids.map((id) => {
      const cs = all.filter((c) => String(c.id) === id);
      const be = cs.map((c) => c.err.bearing);
      const re = cs.map((c) => c.err.range).filter((v) => v !== undefined);
      return {
        id: cs[0].id,
        name: cs[0].name,
        n: cs.length,
        bearingMedian: r2(median(be)),
        bearingP90Abs: r2(quantile(be.map(Math.abs), 0.9)),
        bearingMaxAbs: r2(Math.max(...be.map(Math.abs))),
        rangeMedian: re.length ? r1(median(re)) : null,
        rangeP90Abs: re.length ? r1(quantile(re.map(Math.abs), 0.9)) : null,
        widthMedianM: r1(median(cs.map((c) => c.sizeM?.w ?? 0))),
        lengthM: cs[0].lengthM,
        breadthM: cs[0].breadthM,
      };
    });

    const enc = encodeURIComponent;
    sensors.push({
      id: sensor,
      kind,
      imageBase: `/data/${enc(source.name)}/rawdata/${enc(scn)}/${enc(sensor)}/images/`,
      calib: calibOut,
      summary,
      frames,
    });
  }

  return { source: source.name, scenario: scn, calibrationVersion: version, sensors, notes };
}
