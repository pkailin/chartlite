import { describe, expect, it } from 'vitest';
import {
  GROUND_LAYER_ID,
  SEAMARK_LAYER_ID,
  SEAMARK_MIN_ZOOM,
  SEAMARK_OPACITY,
  basemapStyle,
} from '../src/map/basemap';

describe('basemapStyle', () => {
  it('declares both raster sources', () => {
    const style = basemapStyle();
    expect(Object.keys(style.sources).sort()).toEqual(
      [GROUND_LAYER_ID, SEAMARK_LAYER_ID].sort(),
    );
    for (const source of Object.values(style.sources)) {
      expect(source.type).toBe('raster');
      expect(source.tiles.length).toBeGreaterThan(0);
    }
  });

  it('credits both sources — ODbL requires it and MapLibre only renders what the style carries', () => {
    const style = basemapStyle();
    for (const source of Object.values(style.sources)) {
      expect(source.attribution.trim().length).toBeGreaterThan(0);
    }
  });

  /*
   * The ordering test is the one that matters. MapLibre paints in array order,
   * so a reversed pair buries every buoy, light and lane under the road map —
   * a chart that is no longer a chart, with nothing on screen to say why.
   */
  it('paints the seamarks ABOVE the ground', () => {
    const ids = basemapStyle().layers.map((l) => l.id);
    expect(ids.indexOf(SEAMARK_LAYER_ID)).toBeGreaterThan(ids.indexOf(GROUND_LAYER_ID));
  });

  it('holds the seamark overlay off below the zoom OpenSeaMap serves', () => {
    const seamark = basemapStyle().layers.find((l) => l.id === SEAMARK_LAYER_ID);
    expect(seamark?.minzoom).toBe(SEAMARK_MIN_ZOOM);
    expect(seamark?.paint?.['raster-opacity']).toBe(SEAMARK_OPACITY);
  });

  /*
   * CARTO serves unauthenticated tiles with "API KEY REQUIRED" rendered into
   * the image, so it fails silently and visibly at the same time. Pinned as a
   * test because the obvious fix for "the map is too bright" is to reach for
   * exactly that host.
   */
  it('uses no keyed tile host', () => {
    const urls = Object.values(basemapStyle().sources).flatMap((s) => s.tiles);
    for (const url of urls) {
      expect(url).not.toMatch(/cartocdn|api_key|apikey|access_token/i);
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});
