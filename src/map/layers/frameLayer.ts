/**
 * How a sensor frame is drawn.
 *
 * One dot per GPS fix that has at least one frame matched to it — see the note
 * on `FrameDot` in `src/data/tracks.ts` for why that is not one dot per frame.
 *
 * Kept pure — plain objects, no MapLibre import — so the specs can be asserted
 * in a test without a GL context, the same way basemap.ts is.
 */

export const FRAME_SOURCE = 'frames';
export const FRAME_LAYER = 'frame-dot';

/**
 * Frame dots take the SAME crimson as the track.
 *
 * It would be easy to give camera and radar a colour each, and it would be
 * wrong: colour here means provenance, and both are KR's. The tab says which
 * sensor is shown, and only one is ever shown at a time — what the reader is
 * comparing between tabs is DENSITY, which a colour change would make harder
 * to judge, not easier.
 */
export { EXTERNAL_INK } from './trackLayer';

/**
 * Radius by zoom.
 *
 * Small at chart scale, because 34,000 camera dots over 10 km is a solid line
 * if each is more than a couple of pixels — and a solid line is exactly the
 * information this layer exists to show you is NOT a line. Growing with zoom
 * keeps individual frames pickable once you are close enough for them to be
 * separate things.
 */
export function frameDotPaint(ink: string): Record<string, unknown> {
  return {
    'circle-radius': [
      'interpolate', ['linear'], ['zoom'],
      10, 1.6,
      13, 2.6,
      16, 4.5,
      19, 7,
    ],
    'circle-color': ink,
    /*
     * Deliberately translucent. Where frames are dense the dots overlap and
     * stack toward opaque, so a busy stretch reads darker than a sparse one
     * without any binning — the picture carries the density for free. Any
     * higher and every stretch looks equally covered.
     */
    'circle-opacity': 0.55,
    'circle-stroke-width': 0,
  };
}

/** What a hovered frame dot says. */
export interface FrameHover {
  label: string;
  source: string;
  sourceNote: string;
  sensor: string;
  n: number;
  t: number;
}

export function frameHoverFrom(
  props: Record<string, unknown> | undefined,
): FrameHover | null {
  if (!props || typeof props['label'] !== 'string' || props['sensor'] === undefined) {
    return null;
  }
  return {
    label: String(props['label']),
    source: String(props['source'] ?? ''),
    sourceNote: String(props['sourceNote'] ?? ''),
    sensor: String(props['sensor']),
    n: Number(props['n'] ?? 0),
    t: Number(props['t'] ?? 0),
  };
}

/** `2025-12-17 05:53:04Z`. UTC, because the stamps are epochs and the corpus
 *  spans a day boundary in Singapore time — a local rendering would quietly
 *  move a frame to the previous evening. */
export function formatStamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}Z`;
}
