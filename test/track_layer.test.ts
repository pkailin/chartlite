import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatSpan,
  hoverFrom,
} from '../src/map/layers/trackLayer';

describe('hoverFrom', () => {
  it('returns null rather than a card full of blanks', () => {
    expect(hoverFrom(undefined)).toBeNull();
    expect(hoverFrom({})).toBeNull();
  });

  it('reads a feature into the card', () => {
    const h = hoverFrom({
      label: 'S2A_2512171450', source: 'KR AIC', sourceNote: 'no licence',
      vessel: 'ownship', fixes: 825, seconds: 167, spanM: 670, moored: false,
    });
    expect(h?.source).toBe('KR AIC');
    expect(h?.fixes).toBe(825);
    expect(h?.moored).toBe(false);
  });

  /* MapLibre round-trips booleans as strings on some paths. */
  it('accepts a boolean that arrived as a string', () => {
    expect(hoverFrom({ label: 'x', moored: 'true' })?.moored).toBe(true);
    expect(hoverFrom({ label: 'x', moored: 'false' })?.moored).toBe(false);
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(57)).toBe('57 s');
    expect(formatDuration(167)).toBe('2 m 47 s');
  });

  it('formats spans', () => {
    expect(formatSpan(670)).toBe('670 m');
    expect(formatSpan(1240)).toBe('1.2 km');
  });
});
