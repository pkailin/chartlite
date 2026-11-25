/**
 * How a scenario's GNSS route and start mark are drawn, and what you get when
 * you point at either.
 *
 * Colour comes from the feature's `ink` property, one per configured source:
 * colour here means provenance. Scenarios from one source share a colour, and
 * the hovered one is picked out by width (hover feature-state), not by hue.
 *
 * Kept pure (plain objects, no MapLibre import) so the specs can be asserted in
 * a test without a GL context, the same way basemap.ts is.
 */

export const ROUTE_SOURCE = 'routes';
export const ROUTE_LAYER = 'route-line';
export const TRACK_HEAD_SOURCE = 'track-heads';
export const TRACK_HEAD_LAYER = 'track-head';

/** The first source's ink. Mirrors `--external` in index.css. */
export const EXTERNAL_INK = '#C8102E';

const HOVER = ['boolean', ['feature-state', 'hover'], false];

export function routeLinePaint(): Record<string, unknown> {
  return {
    'line-color': ['get', 'ink'],
    'line-width': ['case', HOVER, 5, 2.5],
    'line-opacity': ['case', HOVER, 1, 0.75],
  };
}

export function trackHeadPaint(): Record<string, unknown> {
  return {
    'circle-radius': ['case', HOVER, 8, ['get', 'stationary'], 6, 4],
    'circle-color': ['get', 'ink'],
    'circle-opacity': 0.95,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
  };
}

export interface TrackHover {
  fid: number;
  id: string;
  scenario: string;
  source: string;
  when: string;
  fixes: number;
  seconds: number;
  spanM: number;
  stationary: boolean;
  camera: number;
  radar: number;
}

/** A feature's properties as the hover card wants them, or null. */
export function hoverFrom(props: Record<string, unknown> | undefined): TrackHover | null {
  if (!props || typeof props['scenario'] !== 'string') return null;
  return {
    fid: Number(props['fid'] ?? -1),
    id: String(props['id'] ?? ''),
    scenario: String(props['scenario']),
    source: String(props['source'] ?? ''),
    when: String(props['when'] ?? ''),
    fixes: Number(props['fixes'] ?? 0),
    seconds: Number(props['seconds'] ?? 0),
    spanM: Number(props['spanM'] ?? 0),
    // MapLibre round-trips booleans through the tile encoder as strings on
    // some paths, so accept both rather than trusting the type.
    stationary: props['stationary'] === true || props['stationary'] === 'true',
    camera: Number(props['camera'] ?? 0),
    radar: Number(props['radar'] ?? 0),
  };
}

/** `1 m 07 s`, or `57 s`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m)} m ${String(s).padStart(2, '0')} s`;
}

/** `670 m`, or `1.2 km`. */
export function formatSpan(metres: number): string {
  if (metres < 1000) return `${String(Math.round(metres))} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
