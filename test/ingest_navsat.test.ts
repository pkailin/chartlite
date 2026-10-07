import { describe, expect, it } from 'vitest';
import { parseNavsat } from '../tools/ingest_kr_navsat.mjs';

/**
 * A log in KR's shape.
 *
 * The stamp is taken as a STRING and interpolated as raw digits. Writing it as
 * a number literal is the very bug these tests are about: the JS parser rounds
 * 1765950940592999936 before `JSON.stringify` ever sees it, so the fixture
 * would not contain the digits it claims to.
 */
function log(rows: { gps: Record<string, number>; ts: string }[]): string {
  return `[${rows.map((r) => `{"gps":${JSON.stringify(r.gps)},"timestamp":${r.ts}}`).join(',')}]`;
}

const GOOD = log([
  { gps: { altitude: 9.57, latitude: 1.2163984944, longitude: 103.8554540778, heading: 92 }, ts: '1765950878172248064' },
  { gps: { altitude: 9.62, latitude: 1.2163979861, longitude: 103.8554676333, heading: 91 }, ts: '1765950878502199808' },
]);

describe('parseNavsat', () => {
  it('reads a well-formed log', () => {
    const { track, excluded } = parseNavsat('S2A_x', GOOD);
    expect(excluded).toBeNull();
    expect(track?.points).toHaveLength(2);
    expect(track?.source).toBe('KR AIC');
    expect(track?.id).toBe('kr:S2A_x');
  });

  /*
   * THE ONE THAT MATTERS, though less dramatically than it first looks.
   *
   * A nanosecond epoch exceeds 2^53, so the parsed float is granular to a few
   * hundred ns. That is usually harmless — measured over all 40,814 stamps in
   * the corpus, the naive `Math.floor(Number(s) / 1e6)` agrees with the exact
   * value for 40,811 of them. It disagrees on 3, each landing within a
   * nanosecond of a millisecond boundary and rounding UP across it.
   *
   * 1 fix in 13,600 is not a crisis, and it is also not something to leave to
   * chance in a timestamp a later join may key on. The stamp below is one of
   * the three real offenders, kept as the test case precisely because it was
   * found in the data rather than imagined.
   */
  it('floors a nanosecond stamp exactly, where the float path rounds up', () => {
    const src = log([
      { gps: { latitude: 1.21, longitude: 103.85 }, ts: '1765950940592999936' },
    ]);
    expect(parseNavsat('S', src).track?.points[0]?.t).toBe(1765950940592);
    // The naive route really does land a millisecond late on this one.
    expect(Math.floor(Number('1765950940592999936') / 1e6)).toBe(1765950940593);
  });

  it('is exact on an ordinary stamp too', () => {
    expect(parseNavsat('S', GOOD).track?.points[0]?.t).toBe(1765950878172);
  });

  it('refuses Null Island rather than plotting it off Singapore', () => {
    const src = log([
      { gps: { latitude: 0, longitude: 0, heading: 0 }, ts: '1765950878172248064' },
      { gps: { latitude: 1.21, longitude: 103.85, heading: 92 }, ts: '1765950878502199808' },
    ]);
    const { track } = parseNavsat('S', src);
    expect(track?.points).toHaveLength(1);
    expect(track?.points[0]?.lat).toBe(1.21);
  });

  it('drops a fix with no position instead of defaulting one', () => {
    const src = log([
      { gps: { altitude: 9.5 }, ts: '1765950878172248064' },
      { gps: { latitude: 1.21, longitude: 103.85 }, ts: '1765950878502199808' },
    ]);
    const { track, dropped } = parseNavsat('S', src);
    expect(track?.points).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('carries a missing heading as null, never as zero', () => {
    const src = log([
      { gps: { latitude: 1.21, longitude: 103.85 }, ts: '1765950878172248064' },
    ]);
    expect(parseNavsat('S', src).track?.points[0]?.heading).toBeNull();
  });

  /*
   * Absence and failure are different facts and must not collapse: one is
   * about the corpus, the other about tonight's network.
   */
  it('reports a session with no log, rather than skipping it', () => {
    const { track, excluded } = parseNavsat('S5_x', null);
    expect(track).toBeNull();
    expect(excluded?.id).toBe('S5_x');
    expect(excluded?.reason).toMatch(/no navsat_log\.json/);
  });

  it('reports malformed JSON as an exclusion, not a crash', () => {
    const { track, excluded } = parseNavsat('S', '{not json');
    expect(track).toBeNull();
    expect(excluded?.reason).toMatch(/not valid JSON/);
  });

  it('reports a log with no usable fix', () => {
    const { track, excluded } = parseNavsat('S', log([{ gps: { latitude: 0, longitude: 0 }, ts: '1' }]));
    expect(track).toBeNull();
    expect(excluded?.reason).toMatch(/no usable fix/);
  });
});
