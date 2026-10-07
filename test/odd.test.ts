import { describe, expect, it } from 'vitest';
import {
  AXES, BAND_LABELS, BANDS, bearingDelta, binOf, rainBand, rainMmPerH,
  sunPosition, windBand,
} from '../tools/odd.mjs';

/**
 * Name the band an index refers to, failing loudly on UNKNOWN.
 *
 * The classifiers return `number | null`, and null is a real answer. These
 * tests assert on cases that must NOT be unknown, so the null goes through an
 * explicit check rather than a `!` — a non-null assertion would turn an
 * unexpected unknown into `undefined` and a confusing mismatch instead of a
 * clear failure.
 */
function band(axis: keyof typeof BANDS, i: number | null): string {
  if (i === null) throw new Error(`expected a band, got unknown`);
  return BANDS[axis][i] as string;
}

/*
 * THE SHIFT THIS PREVENTS. The band tables and the vector conditionDots writes
 * must agree in count and order. They disagreed once — two axes were dropped
 * from the vector while the tables still listed them — and nothing threw:
 * every dot's time-of-day index was read as its illumination, and the last two
 * axes reported 100% unknown. A silent re-labelling, not an error.
 */
describe('the axis contract', () => {
  it('lists exactly the axes the adapter writes', () => {
    expect(AXES).toEqual(['wind', 'rain', 'bin']);
  });

  it('has a label row for every band of every axis', () => {
    for (const axis of AXES as (keyof typeof BANDS)[]) {
      expect(BAND_LABELS[axis]).toHaveLength(BANDS[axis].length);
    }
  });
});

describe('weather bands', () => {
  it('bands wind at the ISO 34503 edges', () => {
    expect(band('wind', windBand(0))).toBe('calm');
    expect(band('wind', windBand(4.9))).toBe('calm');
    expect(band('wind', windBand(5))).toBe('moderate');
    expect(band('wind', windBand(15))).toBe('fresh');
    expect(band('wind', windBand(25))).toBe('strong');
  });

  /*
   * THE 12x TRAP. NEA reports a 5-minute ACCUMULATION in mm; the bands are an
   * INTENSITY in mm/h. Banding the raw deposit files a tropical downpour as
   * light rain — the figure stays plausible, which is what makes it dangerous.
   */
  it('converts a 5-minute accumulation to an intensity before banding', () => {
    expect(rainMmPerH(1)).toBe(12);
    // 1 mm in five minutes is 12 mm/h: heavy. Unconverted it reads as light.
    expect(band('rain', rainBand(rainMmPerH(1)))).toBe('heavy');
    expect(band('rain', rainBand(1))).toBe('light');
  });

  it('bands rain at the ISO edges', () => {
    expect(band('rain', rainBand(0))).toBe('dry');
    expect(band('rain', rainBand(0.2))).toBe('light');
    expect(band('rain', rainBand(4))).toBe('moderate_rain');
    expect(band('rain', rainBand(10))).toBe('heavy');
  });

  it('returns unknown rather than a band for a missing reading', () => {
    expect(windBand(null)).toBeNull();
    expect(windBand(NaN)).toBeNull();
    expect(rainBand(undefined)).toBeNull();
  });
});

/*
 * sunPosition no longer feeds a band — illumination and glint were removed,
 * because each was only half of the backlight question anyone actually asks.
 * It is still tested: it is the primitive a real backlight measure will need
 * once a camera field of view is stated, and an untested primitive sitting
 * unused is how a correct function quietly rots.
 */
describe('the sun', () => {
  /*
   * Checked against arithmetic that does not go through this code: solar noon
   * elevation is 90 − |latitude − declination|, and on 17 Dec the declination
   * is about −23.4°, so Singapore at 1.25°N sees 90 − 24.65 = 65.35°.
   */
  it('puts Singapore’s December noon sun where the geometry says', () => {
    const s = sunPosition(Date.UTC(2025, 11, 17, 5, 10), 1.25, 103.85);
    expect(s.elevation).toBeGreaterThan(64);
    expect(s.elevation).toBeLessThan(66.5);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(12);   // near due south
  });

  /* London's solstice noon: 90 − 51.48 + 23.44 = 61.96°. */
  it('agrees at a very different latitude', () => {
    const s = sunPosition(Date.UTC(2025, 5, 21, 12, 2), 51.48, 0);
    expect(Math.abs(s.elevation - 61.96)).toBeLessThan(1);
  });

  it('puts the morning sun east and the afternoon sun west', () => {
    const am = sunPosition(Date.UTC(2025, 11, 17, 1, 0), 1.25, 103.85);   // 09:00 SGT
    const pm = sunPosition(Date.UTC(2025, 11, 17, 9, 0), 1.25, 103.85);   // 17:00 SGT
    expect(am.azimuth).toBeLessThan(180);
    expect(pm.azimuth).toBeGreaterThan(180);
  });

});

/*
 * bearingDelta no longer feeds a band either, and is tested for the same
 * reason as sunPosition: it is the other primitive a backlight measure needs,
 * and it is the function that was WRONG once — it returned the supplement, so
 * a camera pointing at the sun scored 180. An untested kept function is how
 * that comes back.
 */
describe('bearingDelta', () => {
  it('measures the short way round the compass', () => {
    expect(bearingDelta(10, 350)).toBe(20);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(0, 60)).toBe(60);
    expect(bearingDelta(0, 180)).toBe(180);
  });
});

describe('time of day', () => {
  it('bins by Singapore time, not UTC', () => {
    // 20:00 UTC is 04:00 the NEXT day in Singapore — the bin must follow the
    // local clock, or a session rolls into the wrong slot at the day boundary.
    expect(band('bin', binOf(Date.UTC(2025, 11, 17, 20, 0)))).toBe('04–08');
    expect(band('bin', binOf(Date.UTC(2025, 11, 17, 4, 0)))).toBe('12–16');
  });
});
