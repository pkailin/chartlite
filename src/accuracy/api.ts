/** Client and types for the accuracy routes in server/api.mjs (report built by tools/accuracy.mjs). */
import { url } from '../review/api';

export interface Check {
  id: number | string;
  name: string;
  lengthM: number | null;
  breadthM: number | null;
  box: { xmin: number; ymin: number; width: number; height: number };
  /** Range (m) and bearing relative to the bow (deg) from own-ship GNSS to the target. */
  gnss: { range: number; bearing: number };
  /** The same, measured from the box. Cameras give bearing only. */
  measured: { range?: number; bearing: number };
  /** measured − GNSS. `position` is the radar box-centre-to-GNSS distance in metres. */
  err: { range?: number; bearing: number; position?: number };
  /** Radar: GNSS position in image pixels. */
  predicted?: { x: number; y: number };
  /** Camera: pixels on the GNSS bearing (polyline; empty if outside the view). */
  line?: [number, number][];
  /** Box size in metres (camera: width at the GNSS range). */
  sizeM: { w: number; h?: number };
  /** Target GPS file time minus frame time. */
  dtMs: number;
}

export interface AccuracyFrame {
  file: string | null;
  stem: string;
  t: number;
  heading: number;
  checks: Check[];
}

export interface TargetSummary {
  id: number | string;
  name: string;
  n: number;
  bearingMedian: number | null;
  bearingP90Abs: number | null;
  bearingMaxAbs: number | null;
  rangeMedian: number | null;
  rangeP90Abs: number | null;
  widthMedianM: number | null;
  lengthM: number | null;
  breadthM: number | null;
}

export interface AccuracySensor {
  id: string;
  kind: string;
  imageBase: string;
  calib: {
    metersPerPixel?: number;
    rangeAtEdgeM?: number;
    scaleSource?: string;
    fittedMetersPerPixel?: number | null;
    fittedRangeAtEdgeM?: number | null;
    alignment?: string;
    yawDeg?: number | null;
    yawSource?: string;
    fittedYawDeg?: number | null;
    pitchDeg?: number;
    pitchAssumed?: boolean;
    distortion?: string;
  };
  summary: TargetSummary[];
  frames: AccuracyFrame[];
}

export interface AccuracyReport {
  source: string;
  scenario: string;
  calibrationVersion: string;
  sensors: AccuracySensor[];
  notes: string[];
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${String(r.status)}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export async function fetchAccuracyScenarios(): Promise<{ source: string; dir: string }[]> {
  return json(await fetch(url('/api/accuracy/scenarios')));
}

export async function fetchAccuracy(source: string, scenario: string): Promise<AccuracyReport> {
  const q = new URLSearchParams({ source, scenario });
  return json(await fetch(url(`/api/accuracy?${q.toString()}`)));
}

/** Traffic-light thresholds. Bearing in degrees, range in metres. */
export const BEARING_WARN = 2;
export const BEARING_BAD = 5;
export const RANGE_WARN = 20;
export const RANGE_BAD = 50;

export type Grade = 'ok' | 'warn' | 'bad';

export function gradeOf(c: Check): Grade {
  const b = Math.abs(c.err.bearing);
  const r = c.err.range === undefined ? 0 : Math.abs(c.err.range);
  if (b > BEARING_BAD || r > RANGE_BAD) return 'bad';
  if (b > BEARING_WARN || r > RANGE_WARN) return 'warn';
  return 'ok';
}

export const GRADE_INK: Record<Grade, string> = { ok: '#2BD46B', warn: '#FFB020', bad: '#FF3B3B' };

/** A frame's worst error, for ranking: range error is scaled so 10 m weighs as 1°. */
export function frameScore(f: AccuracyFrame): number {
  return Math.max(...f.checks.map((c) => Math.max(Math.abs(c.err.bearing), Math.abs(c.err.range ?? 0) / 10)));
}
