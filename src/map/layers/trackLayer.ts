/**
 * How a track is drawn, and what you get when you point at it.
 *
 * Kept pure — plain objects, no MapLibre import — so the layer specs can be
 * asserted in a test without a GL context, the same way basemap.ts is.
 */

export const TRACK_SOURCE = 'tracks';
export const TRACK_HEAD_SOURCE = 'track-heads';

export const TRACK_LINE_LAYER = 'track-line';
/** A wide, invisible line under the visible one: see HIT_WIDTH. */
export const TRACK_HIT_LAYER = 'track-hit';
export const TRACK_HEAD_LAYER = 'track-head';

/**
 * Ink for anything that is NOT ours.
 *
 * A deep crimson, darker and more saturated than the pink-red OpenStreetMap
 * spends on motorways, so a track crossing a trunk road still reads as drawn
 * over the map rather than part of it. That collision is the reason to keep
 * this value dark: a brighter red would be the one colour on screen that the
 * basemap already uses for a line of similar weight.
 *
 * It is one colour for every external corpus on purpose. When our own captures
 * are drawn here they get their own, and the difference between "measured by
 * us" and "someone else's" must be visible without reading a legend.
 */
export const EXTERNAL_INK = '#C8102E';

export const LINE_WIDTH = 2.4;

/**
 * The invisible hit target is far wider than the visible line.
 *
 * A 2.4 px line is roughly a one-pixel hover target once antialiasing is
 * accounted for, and a feature nobody can point at might as well not carry a
 * label. 12 px is a comfortable target that still cannot be confused for a
 * second track, because the tracks here are hundreds of metres apart.
 */
export const HIT_WIDTH = 12;

export function trackLinePaint(): Record<string, unknown> {
  return {
    'line-color': EXTERNAL_INK,
    'line-width': LINE_WIDTH,
    'line-opacity': 0.9,
  };
}

/** Transparent, not `visibility: none` — a hidden layer is not hoverable. */
export function trackHitPaint(): Record<string, unknown> {
  return {
    'line-color': EXTERNAL_INK,
    'line-width': HIT_WIDTH,
    'line-opacity': 0,
  };
}

/**
 * The start-of-track dot.
 *
 * Carries its own hover data because a moored session's line is sub-pixel —
 * for two of the three KR sessions this dot is the ONLY thing on screen, so it
 * cannot be decoration on top of a line that answers for it.
 */
export function trackHeadPaint(): Record<string, unknown> {
  return {
    'circle-radius': ['case', ['get', 'moored'], 6, 4],
    'circle-color': EXTERNAL_INK,
    'circle-opacity': 0.95,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
  };
}

export interface TrackHover {
  label: string;
  source: string;
  sourceNote: string;
  vessel: string;
  fixes: number;
  seconds: number;
  spanM: number;
  moored: boolean;
}

/** A feature's properties as the hover card wants them, or null. */
export function hoverFrom(props: Record<string, unknown> | undefined): TrackHover | null {
  if (!props || typeof props['label'] !== 'string') return null;
  return {
    label: String(props['label']),
    source: String(props['source'] ?? ''),
    sourceNote: String(props['sourceNote'] ?? ''),
    vessel: String(props['vessel'] ?? ''),
    fixes: Number(props['fixes'] ?? 0),
    seconds: Number(props['seconds'] ?? 0),
    spanM: Number(props['spanM'] ?? 0),
    // MapLibre round-trips booleans through the tile encoder as strings on
    // some paths, so accept both rather than trusting the type.
    moored: props['moored'] === true || props['moored'] === 'true',
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
