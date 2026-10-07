import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  STRAIT_BOUNDS,
  inStrait,
} from '../src/map/view';
import { SEAMARK_MIN_ZOOM } from '../src/map/basemap';

describe('the opening view', () => {
  it('opens inside the chart frame', () => {
    expect(inStrait(DEFAULT_CENTRE)).toBe(true);
  });

  it('opens at a zoom the map will accept', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(MAX_ZOOM);
  });

  /*
   * The floor exists to keep the seamarks on screen. If it ever drops below
   * the zoom OpenSeaMap starts serving at, zooming out silently turns the
   * nautical chart into a road map.
   */
  it('never zooms out past the seamarks', () => {
    expect(MIN_ZOOM).toBeGreaterThanOrEqual(SEAMARK_MIN_ZOOM);
  });

  it('describes a non-empty frame', () => {
    expect(STRAIT_BOUNDS.west).toBeLessThan(STRAIT_BOUNDS.east);
    expect(STRAIT_BOUNDS.south).toBeLessThan(STRAIT_BOUNDS.north);
  });

  it('places the frame on the Singapore Strait and not somewhere else', () => {
    // Keppel, the Western Anchorage and Changi are all in frame; Kuala Lumpur
    // and Null Island are not. A transposed lat/lon pair fails this.
    expect(inStrait([103.84, 1.26])).toBe(true);
    expect(inStrait([103.63, 1.23])).toBe(true);
    expect(inStrait([104.0, 1.3])).toBe(true);
    expect(inStrait([101.69, 3.14])).toBe(false);
    expect(inStrait([0, 0])).toBe(false);
  });
});
