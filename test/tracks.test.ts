import { describe, expect, it } from 'vitest';
import {
  MOORED_SPAN_M,
  durationS,
  isMoored,
  parseTrackSet,
  spanMetres,
  trackHeadsToGeoJSON,
  tracksToGeoJSON,
  type Track,
} from '../src/data/tracks';

function track(points: { lon: number; lat: number; t: number }[], over: Partial<Track> = {}): Track {
  return {
    id: 'kr:S', label: 'S', source: 'KR AIC', sourceNote: 'no licence',
    vessel: 'ownship',
    points: points.map((p) => ({ ...p, heading: null })),
    frames: { camera: [], radar: [] },
    unmatched: { camera: 0, radar: 0 },
    ...over,
  };
}

/** The real S2A transit: ~670 m east at constant latitude. */
const TRANSIT = track([
  { lon: 103.8555, lat: 1.2164, t: 1_765_950_878_172 },
  { lon: 103.8615, lat: 1.2160, t: 1_765_951_045_804 },
]);

/** A moored S5 session: about a metre of GPS scatter. */
const MOORED = track([
  { lon: 103.85544, lat: 1.25004, t: 1_765_859_040_000 },
  { lon: 103.85543, lat: 1.25003, t: 1_765_859_097_000 },
]);

describe('track geometry', () => {
  it('measures a transit in metres', () => {
    // 0.006° of longitude at the equator is ~667 m.
    expect(spanMetres(TRANSIT)).toBeGreaterThan(600);
    expect(spanMetres(TRANSIT)).toBeLessThan(750);
  });

  it('separates a moored vessel from one under way', () => {
    expect(isMoored(MOORED)).toBe(true);
    expect(isMoored(TRANSIT)).toBe(false);
    // The threshold must sit in the gap between the two, not near either.
    expect(spanMetres(MOORED)).toBeLessThan(MOORED_SPAN_M);
    expect(spanMetres(TRANSIT)).toBeGreaterThan(MOORED_SPAN_M * 4);
  });

  it('reports duration in seconds', () => {
    expect(Math.round(durationS(TRANSIT))).toBe(168);
    expect(Math.round(durationS(MOORED))).toBe(57);
  });

  it('is safe on a track with fewer than two fixes', () => {
    const one = track([{ lon: 103.85, lat: 1.25, t: 1 }]);
    expect(spanMetres(one)).toBe(0);
    expect(durationS(one)).toBe(0);
    expect(() => tracksToGeoJSON([one])).not.toThrow();
  });
});

describe('what reaches the map', () => {
  /*
   * Provenance is the reason this tool draws anything at all. A feature that
   * loses its source becomes indistinguishable from a position we measured,
   * which is the one mistake this chart must not make.
   */
  it('carries the source onto every line feature', () => {
    for (const f of tracksToGeoJSON([TRANSIT, MOORED]).features) {
      expect(f.properties['source']).toBe('KR AIC');
      expect(String(f.properties['sourceNote']).length).toBeGreaterThan(0);
    }
  });

  it('carries the source onto every head feature', () => {
    for (const f of trackHeadsToGeoJSON([TRANSIT, MOORED]).features) {
      expect(f.properties['source']).toBe('KR AIC');
    }
  });

  /*
   * A moored session's line is sub-pixel at chart zoom. Without a head point
   * two of the three KR sessions would not appear at all, and the chart would
   * under-report the corpus while looking complete.
   */
  it('gives every track a head, including one that cannot be drawn as a line', () => {
    const one = track([{ lon: 103.85, lat: 1.25, t: 1 }], { id: 'kr:one' });
    expect(tracksToGeoJSON([one]).features).toHaveLength(0);
    expect(trackHeadsToGeoJSON([one]).features).toHaveLength(1);
  });

  it('flags moored tracks so the hover card can say so', () => {
    const byId = new Map(
      tracksToGeoJSON([TRANSIT, MOORED]).features.map((f) => [f.properties['id'], f.properties]),
    );
    expect(byId.get('kr:S')?.['moored']).toBeDefined();
  });
});

describe('parseTrackSet', () => {
  it('rejects an unknown version rather than rendering an empty chart', () => {
    expect(() => parseTrackSet({ version: 3, tracks: [] })).toThrow(/version/);
  });

  it('rejects a malformed file', () => {
    expect(() => parseTrackSet(null)).toThrow();
    expect(() => parseTrackSet({ version: 2 })).toThrow(/tracks/);
  });

  it('keeps the excluded list, which is data and not an error', () => {
    const set = parseTrackSet({
      version: 2, generatedAt: '', generator: '', tracks: [],
      excluded: [{ id: 'S5_2512161519', reason: 'no navsat_log.json' }],
    });
    expect(set.excluded).toHaveLength(1);
    expect(set.excluded[0]?.id).toBe('S5_2512161519');
  });
});
