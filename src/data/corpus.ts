/**
 * What a scenario is, once the layout it arrived in has been forgotten.
 *
 * `tools/syndataset.mjs` reads the on-disk layout and emits this, and the app
 * draws only this. A collection in some other layout gets its own adapter and
 * changes nothing here or in the map.
 */

/** One GNSS fix. Time is epoch MILLISECONDS (the adapter divides the ns stamp on BigInt). */
export interface RoutePoint {
  lon: number;
  lat: number;
  t: number;
  heading: number | null;
}

/** Sensor kinds the coverage panel counts by. `camera0` and `camera1` are both `camera`. */
export const SENSOR_KINDS = ['camera', 'radar'] as const;
export type SensorKind = (typeof SENSOR_KINDS)[number];

export const SENSOR_LABELS: Record<SensorKind, string> = {
  camera: 'Camera',
  radar: 'Radar',
};

export interface Stream {
  /** Folder name under rawdata/<SCN>/, e.g. `camera0`. */
  id: string;
  kind: string;
  frames: number;
}

export interface Scenario {
  /** `<source>/<scenario dir>`. Unique across the corpus. */
  id: string;
  /** The config's source name. */
  source: string;
  /** `scenario_id` from metadata.json. */
  scenario: string;
  /** The folder name under rawdata/, used in every URL. */
  dir: string;
  date: string | null;
  startTime: string | null;
  durationS: number | null;
  targets: string[];
  /** Labelled ODD value per axis key, as a string, or null when the scenario does not label it. */
  odd: Record<string, string | null>;
  /** GNSS route, thinned to ~1 Hz. */
  route: RoutePoint[];
  fixes: number;
  fixesDegraded: number;
  fixesDropped: number;
  streams: Stream[];
  /** Frames per sensor kind, summed over that kind's streams. */
  frames: Record<string, number>;
}

export interface Axis {
  key: string;
  label: string;
  /** Ordered band values. Includes values no scenario has, on purpose. */
  values: string[];
}

export interface SourceInfo {
  name: string;
  path: string;
  scenarios: number;
  error: string | null;
}

export interface Corpus {
  version: 4;
  generatedAt: string;
  sources: SourceInfo[];
  axes: Axis[];
  scenarios: Scenario[];
  /** Scenarios that were found but could not be read, each with its reason. */
  excluded: { id: string; reason: string }[];
}

export const EMPTY_CORPUS: Corpus = {
  version: 4, generatedAt: '', sources: [], axes: [], scenarios: [], excluded: [],
};

/** Throws instead of coercing, so a malformed reply never shows as an empty chart. */
export function parseCorpus(raw: unknown): Corpus {
  if (typeof raw !== 'object' || raw === null) throw new Error('corpus: not an object');
  const o = raw as Record<string, unknown>;
  if (o['version'] !== 4) throw new Error(`corpus: unsupported version ${String(o['version'])}`);
  if (!Array.isArray(o['scenarios'])) throw new Error('corpus: `scenarios` is not an array');
  return {
    version: 4,
    generatedAt: String(o['generatedAt'] ?? ''),
    sources: Array.isArray(o['sources']) ? (o['sources'] as SourceInfo[]) : [],
    axes: Array.isArray(o['axes']) ? (o['axes'] as Axis[]) : [],
    scenarios: o['scenarios'] as Scenario[],
    excluded: Array.isArray(o['excluded']) ? (o['excluded'] as Corpus['excluded']) : [],
  };
}

export function framesOf(s: Scenario, kind: SensorKind): number {
  return s.frames[kind] ?? 0;
}

/**
 * Frames, and scenarios, in each band of one axis, for one sensor kind.
 *
 * The ODD is labelled per SCENARIO, so every frame of a scenario falls in the
 * same band. `scenarios` counts only scenarios that have frames of this kind,
 * so a radar count never includes a camera-only scenario.
 *
 * `unknown` is returned beside the bands, not folded into one or dropped.
 */
export function axisCoverage(
  scenarios: readonly Scenario[],
  kind: SensorKind,
  axis: Axis,
): { frames: number[]; scenarios: number[]; unknownFrames: number; unknownScenarios: number; total: number } {
  const index = new Map(axis.values.map((v, i) => [v, i]));
  const frames = new Array<number>(axis.values.length).fill(0);
  const scn = new Array<number>(axis.values.length).fill(0);
  let unknownFrames = 0;
  let unknownScenarios = 0;
  let total = 0;
  for (const s of scenarios) {
    const n = framesOf(s, kind);
    if (n === 0) continue;
    total += n;
    const v = s.odd[axis.key];
    const i = v === null || v === undefined ? undefined : index.get(v);
    if (i === undefined) { unknownFrames += n; unknownScenarios++; continue; }
    frames[i] = (frames[i] ?? 0) + n;
    scn[i] = (scn[i] ?? 0) + 1;
  }
  return { frames, scenarios: scn, unknownFrames, unknownScenarios, total };
}

/** `coastal_waters` → `coastal waters`. */
export function bandLabel(v: string): string {
  return v.replace(/_/g, ' ');
}

/* ── Geometry ──────────────────────────────────────────────────────────── */

const M_PER_DEG_LAT = 110_574;

/** Bounding span of a route in metres: how far the vessel actually went. */
export function spanMetres(route: readonly RoutePoint[]): number {
  if (route.length < 2) return 0;
  let n = 90, s = -90, w = 180, e = -180;
  for (const p of route) {
    if (p.lat < n) n = p.lat;
    if (p.lat > s) s = p.lat;
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
  }
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(((n + s) / 2) * (Math.PI / 180));
  return Math.hypot((s - n) * M_PER_DEG_LAT, (e - w) * mPerDegLon);
}

/** Below this span the ego vessel is treated as stationary: GPS scatter, not a transit. */
export const STATIONARY_SPAN_M = 25;

export function isStationary(route: readonly RoutePoint[]): boolean {
  return spanMetres(route) < STATIONARY_SPAN_M;
}

/** Ink per source. Colour means provenance: one colour per configured source. */
export const SOURCE_INKS = ['#C8102E', '#1F5FA8', '#2A7D3A', '#8A4FB0', '#B86200', '#007C80'];

export function inkFor(sources: readonly SourceInfo[], name: string): string {
  const i = Math.max(0, sources.findIndex((s) => s.name === name));
  return SOURCE_INKS[i % SOURCE_INKS.length] ?? '#C8102E';
}

type Props = Record<string, string | number | boolean>;

function scenarioProps(s: Scenario, ink: string, fid: number): Props {
  return {
    fid,
    id: s.id,
    source: s.source,
    scenario: s.scenario,
    ink,
    fixes: s.fixes,
    seconds: Math.round(s.durationS ?? 0),
    spanM: Math.round(spanMetres(s.route)),
    stationary: isStationary(s.route),
    camera: framesOf(s, 'camera'),
    radar: framesOf(s, 'radar'),
    when: [s.date, s.startTime].filter(Boolean).join(' '),
  };
}

/** One LineString per scenario. `fid` is a numeric id so hover can use feature-state. */
export function routesToGeoJSON(corpus: Corpus): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: corpus.scenarios.flatMap((s, i) => (s.route.length < 2 ? [] : [{
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'LineString' as const, coordinates: s.route.map((p) => [p.lon, p.lat]) },
      properties: scenarioProps(s, inkFor(corpus.sources, s.source), i),
    }])),
  };
}

/**
 * One point per scenario, at its first fix. A stationary scenario's route is
 * sub-pixel, so without this point it would not appear on the chart at all.
 */
export function headsToGeoJSON(corpus: Corpus): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: corpus.scenarios.flatMap((s, i) => {
      const p = s.route[0];
      if (!p) return [];
      return [{
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: scenarioProps(s, inkFor(corpus.sources, s.source), i),
      }];
    }),
  };
}
