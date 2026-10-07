import { describe, expect, it } from 'vitest';
import {
  HIT_WIDTH,
  LINE_WIDTH,
  formatDuration,
  formatSpan,
  hoverFrom,
  trackHitPaint,
  trackLinePaint,
} from '../src/map/layers/trackLayer';

describe('the track layers', () => {
  /*
   * The hit target must be invisible AND present. `visibility: none` would be
   * the obvious way to hide it and would also stop it receiving events, which
   * silently removes every hover on the chart.
   */
  it('hides the hit target with opacity, never by hiding the layer', () => {
    const paint = trackHitPaint();
    expect(paint['line-opacity']).toBe(0);
    expect(paint).not.toHaveProperty('visibility');
  });

  it('makes the hit target far wider than the ink, so a line can be pointed at', () => {
    expect(HIT_WIDTH).toBeGreaterThan(LINE_WIDTH * 3);
    expect(trackHitPaint()['line-width']).toBe(HIT_WIDTH);
    expect(trackLinePaint()['line-width']).toBe(LINE_WIDTH);
  });
});

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
