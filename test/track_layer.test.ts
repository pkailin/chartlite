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
      fid: 3, id: 'SynDataset/SCN-BCK-LIT_2oC2', scenario: 'SCN-BCK-LIT_2oC2', source: 'SynDataset',
      fixes: 1664, seconds: 166, spanM: 4, stationary: true, camera: 3326, radar: 0,
    });
    expect(h?.source).toBe('SynDataset');
    expect(h?.fid).toBe(3);
    expect(h?.camera).toBe(3326);
    expect(h?.stationary).toBe(true);
  });

  /* MapLibre round-trips booleans as strings on some paths. */
  it('accepts a boolean that arrived as a string', () => {
    expect(hoverFrom({ scenario: 'x', stationary: 'true' })?.stationary).toBe(true);
    expect(hoverFrom({ scenario: 'x', stationary: 'false' })?.stationary).toBe(false);
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
