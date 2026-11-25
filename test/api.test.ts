import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi, resolveDataFile } from '../server/api.mjs';
import { parseConfig } from '../tools/config.mjs';

let dir = '';
let base = '';
let server: Server;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chartlite-api-'));
  const root = join(dir, 'Syn');
  const scn = join(root, 'rawdata', 'SCN-A');
  mkdirSync(join(scn, 'camera0', 'images'), { recursive: true });
  mkdirSync(join(scn, 'gnss'));
  mkdirSync(join(root, 'groundtruth', 'SCN-A', 'camera0', '2dbbox'), { recursive: true });
  writeFileSync(join(scn, 'metadata.json'), JSON.stringify({ scenario_id: 'SCN-A', sea_state_code: 2 }));
  writeFileSync(join(scn, 'gnss', 'gnss_info.csv'), 'stamp_ns,lat,lon,heading_deg,status\n1000000,1.2,104,0,good\n');
  writeFileSync(join(scn, 'camera0', 'images', '1__a.jpg'), 'JPEG');
  writeFileSync(join(scn, 'camera0', 'images', '2__b.jpg'), 'JPEG');
  writeFileSync(join(root, 'groundtruth', 'SCN-A', 'camera0', '2dbbox', '1__a.json'), '{"objects":[]}');
  writeFileSync(join(dir, 'secret.json'), '{}');
  writeFileSync(join(dir, 'chartlite.config.json'), JSON.stringify({ sources: [{ name: 'Syn', path: './Syn' }] }));

  const api = createApi({ configFile: join(dir, 'chartlite.config.json') });
  server = createServer((req, res) => {
    void api(req, res).then((handled: boolean) => { if (!handled) res.writeHead(418).end(); });
  });
  await new Promise<void>((ok) => { server.listen(0, '127.0.0.1', ok); });
  const addr = server.address();
  base = `http://127.0.0.1:${String(typeof addr === 'object' && addr ? addr.port : 0)}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('/data containment', () => {
  it('serves images and boxes only from rawdata/ and groundtruth/', () => {
    const config = parseConfig({ sources: [{ name: 'Syn', path: join(dir, 'Syn') }] }, dir);
    expect(resolveDataFile(config, '/data/Syn/rawdata/SCN-A/camera0/images/1__a.jpg')).toMatch(/1__a\.jpg$/);
    expect(resolveDataFile(config, '/data/Syn/rawdata/../../secret.json')).toBeNull();
    expect(resolveDataFile(config, '/data/Syn/rawdata/%2e%2e/%2e%2e/secret.json')).toBeNull();
    expect(resolveDataFile(config, '/data/Syn/rawdata/SCN-A/metadata.json')).not.toBeNull();
    expect(resolveDataFile(config, '/data/Syn/rawdata/SCN-A/gnss/gnss_info.csv')).toBeNull();
    expect(resolveDataFile(config, '/data/Other/rawdata/SCN-A/metadata.json')).toBeNull();
  });
});

describe('the API', () => {
  it('builds the corpus from the config', async () => {
    const c = (await (await fetch(`${base}/api/corpus`)).json()) as { scenarios: { id: string; odd: Record<string, string> }[] };
    expect(c.scenarios.map((s) => s.id)).toEqual(['Syn/SCN-A']);
    expect(c.scenarios[0]?.odd['sea_state_code']).toBe('2');
  });

  it('lists frames in order with URL bases that resolve', async () => {
    const r = (await (await fetch(`${base}/api/frames?source=Syn&scenario=SCN-A&sensor=camera0`)).json()) as {
      frames: string[]; imageBase: string; bboxBase: string;
    };
    expect(r.frames).toEqual(['1__a.jpg', '2__b.jpg']);
    const img = await fetch(`${base}${r.imageBase}1__a.jpg`);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(await img.text()).toBe('JPEG');
    expect((await fetch(`${base}${r.bboxBase}1__a.json`)).status).toBe(200);
    expect((await fetch(`${base}${r.bboxBase}2__b.json`)).status).toBe(404);
  });

  it('rejects a path-like scenario name', async () => {
    expect((await fetch(`${base}/api/frames?source=Syn&scenario=..&sensor=camera0`)).status).toBe(400);
    expect((await fetch(`${base}/api/frames?source=Syn&scenario=a%2Fb&sensor=camera0`)).status).toBe(400);
  });

  it('accepts, persists and un-accepts a frame', async () => {
    const post = (accepted: boolean) => fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'Syn', scenario: 'SCN-A', sensor: 'camera0', frames: ['1__a'], accepted }),
    });
    const on = (await (await post(true)).json()) as Record<string, Record<string, string>>;
    expect(Object.keys(on['camera0'] ?? {})).toEqual(['1__a']);

    const stored = JSON.parse(readFileSync(join(dir, 'reviews.json'), 'utf8')) as { accepted: Record<string, unknown> };
    expect(stored.accepted).toHaveProperty(['Syn', 'SCN-A', 'camera0', '1__a']);

    const sum = (await (await fetch(`${base}/api/reviews/summary`)).json()) as Record<string, unknown>;
    expect(sum).toEqual({ Syn: { 'SCN-A': { camera0: 1 } } });

    const off = (await (await post(false)).json()) as Record<string, Record<string, string>>;
    expect(off['camera0']).toEqual({});
  });

  it('refuses a review for an unknown source', async () => {
    const r = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      body: JSON.stringify({ source: 'Nope', scenario: 'SCN-A', sensor: 'camera0', frames: ['1__a'], accepted: true }),
    });
    expect(r.status).toBe(404);
  });

  it('passes anything else through to the static server', async () => {
    expect((await fetch(`${base}/index.html`)).status).toBe(418);
  });
});
