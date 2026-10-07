/**
 * Hand out the built bundle over HTTP. That is the whole job.
 *
 * Stdlib only — no express, no serve-static, no dependency that has to be
 * installed on a host before the chart will open. `node serve.mjs` is enough.
 *
 * It serves `dist/` from THIS directory, i.e. the source tree. Nothing is ever
 * copied into a colcon `install/` tree, which is deliberate: a second copy of
 * a bundle is a second copy that can go stale behind you, and the launch file
 * resolves back here for exactly that reason.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, 'dist');

const DEFAULT_PORT = 3300;
const DEFAULT_HOST = '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const port = Number(arg('--port', process.env.CHARTLITE_PORT ?? DEFAULT_PORT));
const host = String(arg('--host', process.env.CHARTLITE_HOST ?? DEFAULT_HOST));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`chartlite: --port must be 1-65535, got ${String(port)}`);
  process.exit(2);
}

/*
 * A missing bundle is a hard stop, not a wall of 404s. "run npm run build" is
 * the single most useful thing this process can say, and saying it here means
 * the launch file is not the only place that knows.
 */
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`chartlite: no bundle at ${ROOT}`);
  console.error('chartlite: run `npm run build` in src/chartlite first');
  process.exit(1);
}

/**
 * Resolve a URL path to a file inside ROOT, or null.
 *
 * The containment check is not ceremony: without it `GET /../../etc/passwd`
 * reads whatever the process can read. `normalize` collapses the traversal and
 * the prefix test rejects anything that still escapes.
 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = resolve(ROOT, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  if (!existsSync(full)) return null;
  const st = statSync(full);
  if (st.isDirectory()) {
    const index = join(full, 'index.html');
    return existsSync(index) ? index : null;
  }
  return full;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }

  // A single-page app: anything that is not a real file is the app itself, so
  // a deep link or a refresh lands on the chart rather than on a 404.
  const file = resolveFile(req.url ?? '/') ?? join(ROOT, 'index.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';

  res.writeHead(200, {
    'content-type': type,
    // The bundle's filenames are content-hashed by Vite, so they may be cached
    // hard; index.html names them and must not be, or a rebuild is invisible.
    'cache-control': file.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

/*
 * EADDRINUSE exits non-zero and names the port. It does NOT retry and the
 * launch file does NOT respawn: a process that binds a port, plus a restart on
 * failure, is an unbounded loop that looks like a hang.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`chartlite: port ${String(port)} is already in use`);
    console.error('chartlite: stop the other process, or pass --port');
    process.exit(1);
  }
  console.error(`chartlite: ${err.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`chartlite: serving ${ROOT}`);
  console.log(`chartlite: http://localhost:${String(port)}/`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
