/**
 * Where the chart opens, and the water it is about.
 *
 * Kept pure and separate from the map component so the opening view can be
 * asserted in a test without a WebGL context — the component needs one, these
 * numbers do not.
 */

/** A longitude/latitude pair, in the order MapLibre takes them. */
export type LngLat = [lon: number, lat: number];

/**
 * The Singapore Strait and its approaches.
 *
 * West edge sits off Tuas, east edge past Changi and the eastern anchorages,
 * south edge into Indonesian water across the traffic separation scheme, north
 * edge over the island so the Johor Strait is visible but not central.
 *
 * This is the chart frame, NOT an operating area and NOT a jurisdiction — no
 * claim about where anything may sail is made anywhere in this build.
 */
export const STRAIT_BOUNDS = {
  west: 103.5,
  south: 1.1,
  east: 104.15,
  north: 1.5,
} as const;

/** Opening centre: mid-strait, south of the island, on the shipping lanes. */
export const DEFAULT_CENTRE: LngLat = [103.82, 1.25];

/** Opening zoom. 11 fits the strait across a laptop window. */
export const DEFAULT_ZOOM = 11;

/**
 * Floor the zoom at 8 rather than 0.
 *
 * The seamark overlay has no tiles below 8, so zooming out further silently
 * drops every buoy, light and lane — the chart stops being a chart and becomes
 * a plain road map, with nothing on screen to say why.
 */
export const MIN_ZOOM = 8;

/**
 * Ceiling above the raster sources' native maximum (OSM 18, seamark 18).
 *
 * Past their maxzoom the tiles upscale and blur, which is the honest look for
 * "you are now past what this imagery knows" and is better than refusing to
 * zoom.
 */
export const MAX_ZOOM = 20;

/** Whether a point lies inside the chart frame. */
export function inStrait([lon, lat]: LngLat): boolean {
  return (
    lon >= STRAIT_BOUNDS.west &&
    lon <= STRAIT_BOUNDS.east &&
    lat >= STRAIT_BOUNDS.south &&
    lat <= STRAIT_BOUNDS.north
  );
}
