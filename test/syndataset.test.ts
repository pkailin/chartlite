import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildCorpus,
  compareFrames,
  nsToMs,
  parseGnss,
  sensorKind,
  thinRoute,
} from '../tools/syndataset.mjs';
import { parseConfig } from '../tools/config.mjs';
import { DEFAULT_AXES, resolveAxes } from '../tools/odd.mjs';

const GNSS = [
  'stamp_ns,lat,lon,heading_deg,pitch_deg,roll_deg,status',
  '1786057500000000000,1.2341320,104.0000001,73.50,0.10,0.23,good',
  '1786057500100000000,1.2341320,103.9999999,73.50,0.05,0.01,good',
  '1786057501100000000,1.2351320,103.9999999,,0.05,0.01,degraded',
  '1786057501200000000,0,0,73.50,0.05,0.01,good',
].join('\r\n');

/** A miniature SynDataset: one complete scenario, one with no metadata.json. */
let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chartlite-syn-'));
  const scn = join(root, 'rawdata', 'SCN-A');
  for (const s of ['camera0', 'camera1', 'radar']) mkdirSync(join(scn, s, 'images'), { recursive: true });
  mkdirSync(join(scn, 'gnss'));
  writeFileSync(join(scn, 'gnss', 'gnss_info.csv'), GNSS);
  writeFileSync(join(scn, 'metadata.json'), JSON.stringify({
    scenario_id: 'SCN-A', date: '2026-08-07', start_time: '07:05:00', duration_sec: 1.2,
    sea_state_code: 1, beaufort_scale: 13, time_of_day: 'sunrise', target_list: ['T1'],
  }));
  for (const f of ['100.jpg', '20.jpg', 'notes.txt']) writeFileSync(join(scn, 'camera0', 'images', f), '');
  writeFileSync(join(scn, 'camera1', 'images', '100.jpg'), '');
  writeFileSync(join(scn, 'radar', 'images', '100.png'), '');
  mkdirSync(join(root, 'rawdata', 'SCN-B', 'gnss'), { recursive: true });
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('GNSS', () => {
  it('reads CRLF rows, drops (0, 0) and keeps a missing heading as null', () => {
    const g = parseGnss(GNSS);
    expect(g.points).toHaveLength(3);
    expect(g.dropped).toBe(1);
    expect(g.degraded).toBe(1);
    expect(g.points[0]).toEqual({ lon: 104.0000001, lat: 1.234132, t: 1786057500000, heading: 73.5 });
    expect(g.points[2]?.heading).toBeNull();
  });

  it('divides ns stamps exactly', () => {
    expect(nsToMs('1786057500999999999')).toBe(1786057500999);
    expect(nsToMs('nope')).toBeNull();
  });

  it('thins to ~1 Hz and keeps the final fix', () => {
    const pts = Array.from({ length: 25 }, (_, i) => ({ lon: 0, lat: 0, t: i * 100, heading: null }));
    const out = thinRoute(pts, 1000);
    expect(out.map((p) => p.t)).toEqual([0, 1000, 2000, 2400]);
  });
});

describe('sensors and frames', () => {
  it('classifies sensors by folder name', () => {
    expect(sensorKind('camera0')).toBe('camera');
    expect(sensorKind('radar')).toBe('radar');
    expect(sensorKind('radar_simrad')).toBe('radar');
  });

  it('sorts frame files by their numeric stamp', () => {
    expect(['100.jpg', '20.jpg', '3.jpg'].sort(compareFrames)).toEqual(['3.jpg', '20.jpg', '100.jpg']);
  });
});

describe('buildCorpus', () => {
  it('reads labelled ODD, counts frames per kind and excludes what it cannot read', () => {
    const config = parseConfig({ sources: [{ name: 'Syn', path: root }, { name: 'Gone', path: join(root, 'nope') }] }, '/');
    const c = buildCorpus(config);
    expect(c.scenarios).toHaveLength(1);
    const s = c.scenarios[0] as unknown as { id: string; odd: Record<string, string | null>; frames: unknown; streams: { id: string }[] };
    expect(s.id).toBe('Syn/SCN-A');
    expect(s.odd['sea_state_code']).toBe('1');
    expect(s.odd['waterway_type']).toBeNull();
    // notes.txt is not a frame; camera0 + camera1 both count as camera.
    expect(s.frames).toEqual({ camera: 3, radar: 1 });
    expect(s.streams.map((x) => x.id)).toEqual(['camera0', 'camera1', 'radar']);
    expect(c.excluded).toEqual([{ id: 'Syn/SCN-B', reason: 'no metadata.json' }]);
    expect(c.sources[1]?.error).toMatch(/no rawdata/);
    // Beaufort 13 is outside the listed 0–12 and is appended, not dropped.
    const bf = c.axes.find((a: { key: string }) => a.key === 'beaufort_scale');
    expect(bf?.values.at(-1)).toBe('13');
  });
});

describe('config', () => {
  it('expands ~ and resolves relative paths against the config file', () => {
    const c = parseConfig({ sources: [{ name: 'A', path: '~/SynDataset' }, { name: 'B', path: 'data/x' }] }, '/etc/cl');
    expect(c.sources[0]?.root).toMatch(/SynDataset$/);
    expect(c.sources[0]?.root.startsWith('~')).toBe(false);
    expect(c.sources[1]?.root).toBe('/etc/cl/data/x');
    expect(c.reviewsFile).toBe('/etc/cl/reviews.json');
  });

  it('refuses bad or duplicate names', () => {
    expect(() => parseConfig({ sources: [] }, '/')).toThrow(/non-empty/);
    expect(() => parseConfig({ sources: [{ name: 'a/b', path: '/x' }] }, '/')).toThrow(/name/);
    expect(() => parseConfig({ sources: [{ name: 'a', path: '/x' }, { name: 'a', path: '/y' }] }, '/')).toThrow(/duplicate/);
  });

  it('orders extra values numerically after the listed ones', () => {
    const axes = resolveAxes([{ key: 'k', label: 'K', values: ['1'] }], [
      { odd: { k: '10' } }, { odd: { k: '2' } }, { odd: { k: null } },
    ]);
    expect(axes[0]?.values).toEqual(['1', '2', '10']);
    expect(DEFAULT_AXES.map((a) => a.key)).toContain('sea_state_code');
  });
});
