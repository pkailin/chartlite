/**
 * The chart's basemap style: a road map with a nautical chart drawn over it.
 *
 * Two raster sources, both free of any key:
 *
 *   osm       OpenStreetMap standard tiles — the ground. Land, roads, the
 *             coastline, place names.
 *   seamark   OpenSeaMap's seamark overlay — buoyage, lights, anchorages,
 *             the traffic separation scheme. Transparent everywhere else,
 *             so it composites straight over the ground.
 *
 * WHY NOT CARTO. `basemaps.cartocdn.com` is the obvious dark basemap and it is
 * deliberately absent. It now serves unauthenticated requests with "API KEY
 * REQUIRED" rendered INTO the tile image — verified 2026-08-27 by fetching one
 * directly — so the watermark tiles across the whole chart with no error
 * anywhere to explain it. Any keyless basemap added here later must be checked
 * the same way: fetch a tile and look at it.
 *
 * WHY RASTER AND NOT VECTOR. A vector style needs a glyph endpoint for its
 * labels, and every free one is either keyed or a single volunteer server. A
 * raster tile carries its own labels and needs nothing else.
 *
 * Kept pure — a function returning a plain object, importing nothing from
 * MapLibre — so the style can be asserted in a test with no GL context.
 */

/** Both sources are ODbL and the licence requires the credit be displayed. */
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const SEAMARK_ATTRIBUTION = '© OpenSeaMap contributors';

export const GROUND_LAYER_ID = 'osm';
export const SEAMARK_LAYER_ID = 'seamark';

/**
 * Below this zoom OpenSeaMap serves no seamark tiles at all.
 * Matches MIN_ZOOM in view.ts, which stops the map going below it.
 */
export const SEAMARK_MIN_ZOOM = 8;

/**
 * Seamark symbols are drawn for a white chart, not for OSM's beige land, so
 * at full strength they sit on the page rather than on the water. 0.85 lets
 * the coastline read through without washing the buoyage out.
 */
export const SEAMARK_OPACITY = 0.85;

/**
 * The MapLibre style.
 *
 * Typed structurally rather than against MapLibre's `StyleSpecification` so
 * this module imports nothing — the map component passes it straight to the
 * constructor, which validates it properly at runtime.
 */
export interface BasemapStyle {
  version: 8;
  sources: Record<string, {
    type: 'raster';
    tiles: string[];
    tileSize: number;
    attribution: string;
    maxzoom: number;
  }>;
  layers: {
    id: string;
    type: 'raster';
    source: string;
    minzoom?: number;
    maxzoom?: number;
    paint?: Record<string, unknown>;
  }[];
}

export function basemapStyle(): BasemapStyle {
  return {
    version: 8,
    sources: {
      [GROUND_LAYER_ID]: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION,
        maxzoom: 18,
      },
      [SEAMARK_LAYER_ID]: {
        type: 'raster',
        tiles: ['https://t1.openseamap.org/seamark/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: SEAMARK_ATTRIBUTION,
        maxzoom: 18,
      },
    },
    // ORDER IS THE POINT: ground first, seamarks second. MapLibre paints in
    // array order, so reversing these buries every buoy under the road map.
    layers: [
      {
        id: GROUND_LAYER_ID,
        type: 'raster',
        source: GROUND_LAYER_ID,
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: SEAMARK_LAYER_ID,
        type: 'raster',
        source: SEAMARK_LAYER_ID,
        minzoom: SEAMARK_MIN_ZOOM,
        maxzoom: 22,
        paint: { 'raster-opacity': SEAMARK_OPACITY },
      },
    ],
  };
}
