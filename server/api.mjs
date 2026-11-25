/**
 * The HTTP API, shared by serve.mjs (production) and the vite dev server.
 *
 *   GET  /api/corpus                                  every scenario of every source
 *   GET  /api/frames?source=&scenario=&sensor=        ordered frame files + URL bases
 *   GET  /api/reviews?source=&scenario=               accepted frames, per sensor
 *   GET  /api/reviews/summary                         accepted counts only
 *   POST /api/reviews  {source,scenario,sensor,frames:[stem],accepted}
 *   GET  /api/accuracy/scenarios                      scenarios that have targets/gps
 *   GET  /api/accuracy?source=&scenario=              box-vs-GNSS report (tools/accuracy.mjs)
 *   GET  /data/<source>/(rawdata|groundtruth)/…       dataset images and box JSON
 *
 * The config is re-read on every request, so a source added to
 * chartlite.config.json shows up on the next refresh.
 *
 * `/data/` is read-only and allows only images and JSON under the source's
 * rawdata/ and groundtruth/ folders. The containment check runs after symlinks
 * are resolved. Without it `/data/X/rawdata/../../../etc/passwd` would read
 * whatever the process can read.
 */
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { NAME_RE, configFileFromArgs, loadConfig } from '../tools/config.mjs';
import { buildCorpus, isDir, listFrames, scenarioDir, sensorKind } from '../tools/syndataset.mjs';
import { scenarioAccuracy, scenariosWithTargets } from '../tools/accuracy.mjs';
import { readStore, scenarioReviews, setAccepted, summary, writeStore } from './reviews.mjs';

const DATA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY = 4 * 1024 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { ok(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', fail);
  });
}

/** Resolve `/data/<source>/<rest>` to a file inside that source, or null. */
export function resolveDataFile(config, pathname) {
  const m = /^\/data\/([^/]+)\/(.+)$/.exec(pathname);
  if (!m) return null;
  let name, rest;
  try { name = decodeURIComponent(m[1]); rest = decodeURIComponent(m[2]); } catch { return null; }
  const source = config.sources.find((s) => s.name === name);
  if (!source) return null;
  if (!/^(rawdata|groundtruth)\//.test(rest)) return null;
  if (!DATA_TYPES[extname(rest).toLowerCase()]) return null;
  if (!existsSync(source.root)) return null;
  const root = realpathSync(source.root);
  const full = resolve(root, rest);
  if (!full.startsWith(root + sep) || !existsSync(full)) return null;
  const real = realpathSync(full);
  if (!real.startsWith(root + sep) || !statSync(real).isFile()) return null;
  return real;
}

function need(params, key) {
  const v = params.get(key);
  if (!v || !NAME_RE.test(v)) throw Object.assign(new Error(`missing or invalid \`${key}\``), { status: 400 });
  return v;
}

export function createApi({ configFile = configFileFromArgs() } = {}) {
  /* Writes are serialised so two quick clicks cannot interleave read-modify-write. */
  let writing = Promise.resolve();
  /*
   * Accuracy reports, keyed by source, scenario and that source's calibration
   * overrides, so editing the overrides in the config takes effect at once.
   * Dataset files are not expected to change under a running server; restart
   * it if they do.
   */
  const reports = new Map();

  /** Returns true if it handled the request. */
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (!p.startsWith('/api/') && !p.startsWith('/data/')) return false;

    try {
      const config = loadConfig(configFile);

      if (p.startsWith('/data/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'GET only' }); return true; }
        const file = resolveDataFile(config, p);
        if (!file) { send(res, 404, { error: 'not found' }); return true; }
        res.writeHead(200, {
          'content-type': DATA_TYPES[extname(file).toLowerCase()],
          'content-length': statSync(file).size,
          // Dataset files do not change once written. A short cache keeps
          // back-and-forth navigation instant without pinning stale copies for long.
          'cache-control': 'private, max-age=600',
        });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
        return true;
      }

      if (p === '/api/corpus' && req.method === 'GET') {
        send(res, 200, buildCorpus(config));
        return true;
      }

      if (p === '/api/frames' && req.method === 'GET') {
        const sourceName = need(url.searchParams, 'source');
        const scenario = need(url.searchParams, 'scenario');
        const sensor = need(url.searchParams, 'sensor');
        const source = config.sources.find((s) => s.name === sourceName);
        if (!source) { send(res, 404, { error: `no source "${sourceName}"` }); return true; }
        if (!isDir(join(scenarioDir(source.root, scenario), sensor, 'images'))) {
          send(res, 404, { error: `no ${sensor}/images in ${scenario}` });
          return true;
        }
        const enc = encodeURIComponent;
        send(res, 200, {
          source: sourceName,
          scenario,
          sensor,
          kind: sensorKind(sensor),
          imageBase: `/data/${enc(sourceName)}/rawdata/${enc(scenario)}/${enc(sensor)}/images/`,
          bboxBase: `/data/${enc(sourceName)}/groundtruth/${enc(scenario)}/${enc(sensor)}/2dbbox/`,
          frames: listFrames(source.root, scenario, sensor),
        });
        return true;
      }

      if (p === '/api/accuracy/scenarios' && req.method === 'GET') {
        send(res, 200, config.sources.flatMap((s) => scenariosWithTargets(s.root).map((dir) => ({ source: s.name, dir }))));
        return true;
      }

      if (p === '/api/accuracy' && req.method === 'GET') {
        const sourceName = need(url.searchParams, 'source');
        const scenario = need(url.searchParams, 'scenario');
        const source = config.sources.find((s) => s.name === sourceName);
        if (!source) { send(res, 404, { error: `no source "${sourceName}"` }); return true; }
        if (!isDir(join(source.root, 'groundtruth', scenario, 'targets', 'gps'))) {
          send(res, 404, { error: `no groundtruth/${scenario}/targets/gps` });
          return true;
        }
        const key = JSON.stringify([source.name, source.root, scenario, source.calibration]);
        let report = reports.get(key);
        if (!report) {
          report = scenarioAccuracy(source, scenario);
          if (reports.size > 64) reports.clear();
          reports.set(key, report);
        }
        send(res, 200, report);
        return true;
      }

      if (p === '/api/reviews/summary' && req.method === 'GET') {
        send(res, 200, summary(readStore(config.reviewsFile)));
        return true;
      }

      if (p === '/api/reviews' && req.method === 'GET') {
        const source = need(url.searchParams, 'source');
        const scenario = need(url.searchParams, 'scenario');
        send(res, 200, scenarioReviews(readStore(config.reviewsFile), source, scenario));
        return true;
      }

      if (p === '/api/reviews' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const params = new URLSearchParams();
        for (const k of ['source', 'scenario', 'sensor']) params.set(k, String(body?.[k] ?? ''));
        const source = need(params, 'source');
        const scenario = need(params, 'scenario');
        const sensor = need(params, 'sensor');
        if (!config.sources.some((s) => s.name === source)) { send(res, 404, { error: `no source "${source}"` }); return true; }
        const frames = Array.isArray(body.frames) ? body.frames.map(String) : [];
        if (frames.length === 0 || frames.some((f) => !NAME_RE.test(f))) {
          send(res, 400, { error: '`frames` must be a non-empty array of frame stems' });
          return true;
        }
        const accepted = body.accepted === true;
        const result = writing.then(() => {
          const store = setAccepted(readStore(config.reviewsFile), { source, scenario, sensor, frames, accepted });
          writeStore(config.reviewsFile, store);
          return scenarioReviews(store, source, scenario);
        });
        writing = result.catch(() => undefined);
        send(res, 200, await result);
        return true;
      }

      send(res, 404, { error: `no route ${req.method ?? ''} ${p}` });
      return true;
    } catch (e) {
      const status = typeof e?.status === 'number' ? e.status : e instanceof SyntaxError ? 400 : 500;
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
      return true;
    }
  };
}
