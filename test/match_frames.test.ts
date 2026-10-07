import { describe, expect, it } from 'vitest';
import { matchFrames } from '../tools/ingest_kr_navsat.mjs';

/** A 5 Hz GPS log, as KR's are: a fix every 200 ms. */
function fixes(n: number, t0 = 1_765_950_878_000) {
  return Array.from({ length: n }, (_, i) => ({
    lon: 103.85 + i * 0.0001, lat: 1.21, t: t0 + i * 200, heading: null,
  }));
}

/** Milliseconds → the nanosecond-epoch TEXT a frame filename carries. */
const ns = (ms: number) => `${String(ms)}000000`;

describe('matchFrames', () => {
  it('puts a frame at the nearest fix', () => {
    const pts = fixes(5);                       // t = …000, 200, 400, 600, 800
    const { dots, unmatched } = matchFrames(pts, [ns(1_765_950_878_410)]);
    expect(unmatched).toBe(0);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.t).toBe(1_765_950_878_400);  // 400, not 600
  });

  it('looks backwards as well as forwards', () => {
    const pts = fixes(5);
    // 590 is 10 ms from the fix at 600 and 190 from the one at 400. A search
    // that only took the fix at-or-after would still be right here, so the
    // real check is the other side:
    const { dots } = matchFrames(pts, [ns(1_765_950_878_610)]);
    expect(dots[0]?.t).toBe(1_765_950_878_600);
  });

  /*
   * AGGREGATION IS THE POINT. Frames arrive at about the GPS rate, so one dot
   * per frame would stack identical circles on a single pixel and make a dense
   * stretch look exactly like a sparse one.
   */
  it('aggregates many frames onto one fix rather than stacking dots', () => {
    const pts = fixes(3);
    const { dots } = matchFrames(pts, [
      ns(1_765_950_878_010), ns(1_765_950_878_020), ns(1_765_950_878_030),
    ]);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.n).toBe(3);
  });

  /*
   * A frame in a GPS dropout gets NO position. Inventing one is the same
   * mistake as defaulting a missing fix to (0, 0), only better disguised.
   */
  it('refuses to place a frame outside the tolerance', () => {
    const pts = fixes(2);                       // covers …000 to …200
    const { dots, unmatched } = matchFrames(pts, [ns(1_765_950_890_000)], 1000);
    expect(dots).toHaveLength(0);
    expect(unmatched).toBe(1);
  });

  it('places a frame exactly at the tolerance edge, and rejects past it', () => {
    const pts = fixes(1);
    expect(matchFrames(pts, [ns(1_765_950_879_000)], 1000).dots).toHaveLength(1);
    expect(matchFrames(pts, [ns(1_765_950_879_001)], 1000).unmatched).toBe(1);
  });

  it('returns dots in track order, not in the order frames were listed', () => {
    const pts = fixes(4);
    const { dots } = matchFrames(pts, [
      ns(1_765_950_878_600), ns(1_765_950_878_000), ns(1_765_950_878_400),
    ]);
    expect(dots.map((d: { t: number }) => d.t)).toEqual([
      1_765_950_878_000, 1_765_950_878_400, 1_765_950_878_600,
    ]);
  });

  it('counts an unreadable stamp as unmatched rather than throwing', () => {
    expect(matchFrames(fixes(3), ['not-a-number']).unmatched).toBe(1);
  });

  it('is safe against a track with no fixes', () => {
    const { dots, unmatched } = matchFrames([], [ns(1_765_950_878_000)]);
    expect(dots).toHaveLength(0);
    expect(unmatched).toBe(1);
  });

  it('carries the fix position, never the frame’s own', () => {
    const pts = fixes(3);
    const { dots } = matchFrames(pts, [ns(1_765_950_878_400)]);
    expect(dots[0]?.lon).toBe(pts[2]?.lon);
    expect(dots[0]?.lat).toBe(pts[2]?.lat);
  });
});
