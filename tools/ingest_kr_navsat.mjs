/**
 * Adapter: KR AIC field-collection layout → the neutral track set.
 *
 *   node tools/ingest_kr_navsat.mjs <source> [--out FILE] [--mirror DIR]
 *
 * `<source>` is either a local directory or an `https://` URL. Both carry the
 * SAME layout — `<root>/<session>/navsat_log.json` — so the parsing below is
 * written once and the transport is swapped underneath it.
 *
 *   # the RAW dataset on KR's host: all 23 sessions, untruncated
 *   node tools/ingest_kr_navsat.mjs "https://…/RealDataset/"
 *
 *   # a local copy. NOTE the extra rawdata/ level in the Labeled Dataset
 *   node tools/ingest_kr_navsat.mjs "/media/…/Labeled Dataset/rawdata"
 *
 * THIS IS THE ONLY FILE THAT KNOWS WHAT KR'S LAYOUT LOOKS LIKE. The map draws
 * `src/data/tracks.ts`'s shape and nothing else, so the next corpus gets its
 * own adapter beside this one and changes nothing downstream. If a new format
 * ever makes you want to edit the map, the adapter is in the wrong place.
 *
 * What it reads, per session:
 *
 *     {"gps":{"altitude":9.57,"latitude":1.216,"longitude":103.855,"heading":92},
 *      "timestamp":1765950878172248064}
 *
 * Four rules, each of which exists because the alternative silently produces a
 * plausible wrong answer:
 *
 * 1. NANOSECONDS VIA BIGINT. `timestamp` is a nanosecond epoch, past 2^53, so
 *    the parsed float is granular to a few hundred nanoseconds. Measured over
 *    all 40,814 stamps in this corpus the naive `Math.floor(n / 1e6)` agrees
 *    with the exact value 40,811 times and rounds a millisecond UP on 3 — each
 *    landing a nanosecond below a millisecond boundary. 1 in 13,600 is not a
 *    crisis and is also not worth leaving to chance in a stamp a later join may
 *    key on, so the division is done on BigInt, re-reading the raw text because
 *    JSON.parse has already rounded by the time a value reaches an object.
 *
 * 2. NEVER INVENT A POSITION. A fix without finite lat/lon is dropped, not
 *    defaulted. Exactly (0, 0) is refused outright — Null Island is what a GPS
 *    receiver with no lock reports, not a place off Singapore.
 *
 * 3. A SESSION WITHOUT A LOG IS REPORTED, NOT SKIPPED. Emitting the sessions
 *    that worked and saying nothing about the rest misreports the corpus as
 *    complete.
 *
 * 4. NO LICENCE TRAVELS WITH THIS DATA. Every track carries the caveat to the
 *    screen, and the output path is gitignored — see the note by DEFAULT_OUT.
 *
 * ON READING FROM THE HOST. KR's share is served from a revocable
 * hash-token host; it can stop answering without notice and nothing here can
 * prevent that. `--mirror DIR` writes each log to disk as it is fetched, so a
 * run that worked once can be repeated from the copy. Use it.
 */
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Written into `public/`, which Vite serves at the site root and which is
 * GITIGNORED for this file.
 *
 * The KR share states no licence and is served from a revocable host. Position
 * data derived from it must not be committed to this repository — so the
 * adapter writes it where the app can read it and git cannot keep it. Re-run
 * the adapter rather than looking for the file in a clone.
 */
const DEFAULT_OUT = join(HERE, '..', 'public', 'tracks.json');

const SOURCE_LABEL = 'KR AIC';
const SOURCE_NOTE =
  'KR AIC field collection, Dec 2025 — no licence granted, revocable host. '
  + 'Reference only: not our sensors, and not coverage evidence.';

const LOG_NAME = 'navsat_log.json';

/** Per-request ceiling. A hung socket must not stall a 23-session run. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Concurrent fetches. Low on purpose: this is someone else's server. */
const CONCURRENCY = 4;

/** Directory entries that are not sessions. `@eaDir` is a Synology artifact. */
const NOT_A_SESSION = /^(@eaDir|\.|\.\.)$/;

/**
 * Which on-disk folders feed which sensor tab.
 *
 * `camera0` and `camera1` are two lenses on ONE hull, so both report the same
 * position for the same instant. Listing both would double the work and draw
 * the identical dots — the frame COUNT per place is what differs, and that is
 * what the aggregation below keeps. `camera0` alone is also the stream KR's
 * groundtruth is scored against.
 */
const SENSOR_DIRS = {
  camera: ['camera0'],
  radar: ['simrad'],
};

/**
 * How far a frame may sit from its nearest GPS fix before it is NOT placed.
 *
 * The logs run at ~5 Hz, so an in-window frame lands within ~100 ms of a fix.
 * A second is generously wide and still refuses anything that fell in a GPS
 * dropout. A frame beyond it gets NO position: inventing one is the same
 * mistake as defaulting a missing fix to (0, 0), just better disguised.
 */
const MATCH_TOLERANCE_MS = 1000;

/** A frame file: digits, then an extension. The digits are a ns epoch. */
const FRAME_NAME = /^(\d+)\.[A-Za-z0-9]+$/;

/* ── Transports ─────────────────────────────────────────────────────────────
 *
 * Two implementations of the same two questions — what sessions are there, and
 * what is in this one's log — so everything below them is transport-blind.
 */

function localSource(root) {
  const base = resolve(root);
  if (!existsSync(base)) {
    throw new Error(`no such directory: ${base}`);
  }
  return {
    describe: base,
    listSessions() {
      return readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !NOT_A_SESSION.test(d.name))
        .map((d) => d.name)
        .sort();
    },
    readLog(session) {
      const file = join(base, session, LOG_NAME);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    listFrames(session, dir) {
      const d = join(base, session, dir);
      if (!existsSync(d)) return null;
      return readdirSync(d)
        .map((n) => FRAME_NAME.exec(n)?.[1])
        .filter((x) => x !== undefined);
    },
  };
}

function httpSource(rootUrl) {
  // A trailing slash is load-bearing for relative resolution: without it the
  // last path segment is replaced rather than appended, and every request goes
  // to the parent directory.
  const base = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;

  async function get(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${url}`);
    return res.text();
  }

  return {
    describe: base,
    async listSessions() {
      const html = await get(base);
      if (html === null) throw new Error(`no listing at ${base}`);
      /*
       * An Apache-style index. Only hrefs ending in `/` are directories, and
       * anything containing `:` or starting with `/` is a link off this page
       * (sort links, the parent, absolute paths) rather than a child.
       */
      const names = [...html.matchAll(/<a\s+href="([^"]+)"/gi)]
        .map((m) => m[1])
        .filter((h) => h.endsWith('/') && !h.startsWith('/') && !h.includes(':') && h !== '../')
        .map((h) => decodeURIComponent(h.slice(0, -1)))
        .filter((n) => !NOT_A_SESSION.test(n));
      return [...new Set(names)].sort();
    },
    async readLog(session) {
      return get(`${base}${encodeURIComponent(session)}/${LOG_NAME}`);
    },
    async listFrames(session, dir) {
      const html = await get(`${base}${encodeURIComponent(session)}/${dir}/`);
      if (html === null) return null;
      /*
       * DEDUPED. An Apache index prints each name twice — once as the href and
       * once as the link text — so a naive match reports 2,574 frames where
       * there are 1,287, and every per-place count comes out doubled.
       */
      const names = [...html.matchAll(/<a\s+href="([^"]+)"/gi)]
        .map((m) => decodeURIComponent(m[1]))
        .map((n) => FRAME_NAME.exec(n)?.[1])
        .filter((x) => x !== undefined);
      return [...new Set(names)];
    },
  };
}

function sourceFor(arg) {
  return /^https?:\/\//i.test(arg) ? httpSource(arg) : localSource(arg);
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

/** A finite number that is not a boolean. */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Nanosecond epoch → milliseconds, without going through a float.
 *
 * Takes the ORIGINAL TEXT of the stamp, because JSON.parse has already rounded
 * the value by the time it reaches an object.
 */
function nsTextToMs(text) {
  try {
    return Number(BigInt(text) / 1000000n);
  } catch {
    return null;
  }
}

/** Pull the raw digits of every "timestamp": field, in file order. */
function rawStamps(json) {
  return [...json.matchAll(/"timestamp"\s*:\s*(\d+)/g)].map((m) => m[1]);
}

/** One session's log text → a track, or an exclusion with its reason. */
export function parseNavsat(sessionId, text) {
  if (text === null) {
    return {
      track: null,
      excluded: { id: sessionId, reason: `no ${LOG_NAME} — nothing to draw` },
      dropped: 0,
    };
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch (e) {
    return {
      track: null,
      excluded: { id: sessionId, reason: `${LOG_NAME} is not valid JSON: ${e.message}` },
      dropped: 0,
    };
  }
  if (!Array.isArray(rows)) {
    return {
      track: null,
      excluded: { id: sessionId, reason: `${LOG_NAME} is not an array` },
      dropped: 0,
    };
  }

  const stamps = rawStamps(text);
  const points = [];
  let noFix = 0, nullIsland = 0, noTime = 0;

  rows.forEach((row, i) => {
    const gps = row?.gps;
    const lat = gps?.latitude;
    const lon = gps?.longitude;

    if (!finite(lat) || !finite(lon)) { noFix++; return; }
    // Rule 2. A receiver with no lock reports exactly this.
    if (lat === 0 && lon === 0) { nullIsland++; return; }

    const stamp = stamps[i];
    const t = stamp === undefined ? null : nsTextToMs(stamp);
    if (t === null) { noTime++; return; }

    points.push({ lon, lat, t, heading: finite(gps?.heading) ? gps.heading : null });
  });

  if (points.length === 0) {
    return {
      track: null,
      excluded: { id: sessionId, reason: `${LOG_NAME} held no usable fix` },
      dropped: noFix + nullIsland + noTime,
    };
  }

  return {
    track: {
      id: `kr:${sessionId}`,
      label: sessionId,
      source: SOURCE_LABEL,
      sourceNote: SOURCE_NOTE,
      vessel: 'ownship',
      points,
      // Filled by the run loop, which owns the transport. Present and empty
      // rather than absent: "we looked and found none" is a different claim
      // from "nobody looked", and only the first belongs in the output.
      frames: { camera: [], radar: [] },
      unmatched: { camera: 0, radar: 0 },
    },
    excluded: null,
    dropped: noFix + nullIsland + noTime,
    droppedDetail: { noFix, nullIsland, noTime },
  };
}

/* ── Matching frames to fixes ───────────────────────────────────────────── */

/**
 * Place each frame at the GPS fix nearest in time, and aggregate per fix.
 *
 * `points` must be sorted by `t` (the logs are, and the parser preserves
 * order). Binary search rather than a scan per frame: 40,000 fixes against
 * 40,000 frames is 1.6e9 comparisons the naive way, and about 600,000 this way.
 *
 * THE RESULT IS ONE DOT PER FIX, NOT PER FRAME. Frames arrive at roughly the
 * GPS rate, so a dot per frame would stack identical circles on one pixel and
 * make a dense stretch indistinguishable from a sparse one. `n` carries the
 * count, which is the thing that actually differs between camera and radar.
 *
 * A frame further than `toleranceMs` from any fix is NOT placed. It is counted
 * as unmatched and reported — inventing a position for it would be the same
 * error as defaulting a missing fix, only harder to see.
 */
export function matchFrames(points, stampsNs, toleranceMs = MATCH_TOLERANCE_MS) {
  const perFix = new Map();
  let unmatched = 0;

  for (const ns of stampsNs) {
    const t = nsTextToMs(ns);
    if (t === null) { unmatched++; continue; }

    // First fix at or after t.
    let lo = 0, hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid + 1; else hi = mid;
    }

    // The nearest fix is one of the two straddling t.
    let best = -1, bestGap = Infinity;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= points.length) continue;
      const gap = Math.abs(points[i].t - t);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }

    if (best < 0 || bestGap > toleranceMs) { unmatched++; continue; }
    perFix.set(best, (perFix.get(best) ?? 0) + 1);
  }

  const dots = [...perFix.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, n]) => ({ lon: points[i].lon, lat: points[i].lat, t: points[i].t, n }));

  return { dots, unmatched };
}


/* ── Run ────────────────────────────────────────────────────────────────── */

/** Map over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : DEFAULT_OUT;
  const mirrorIdx = args.indexOf('--mirror');
  const mirror = mirrorIdx >= 0 && args[mirrorIdx + 1] ? resolve(args[mirrorIdx + 1]) : null;

  if (!root) {
    console.error('usage: node tools/ingest_kr_navsat.mjs <dir|url> [--out FILE] [--mirror DIR]');
    process.exit(2);
  }

  const src = sourceFor(root);
  const sessions = await src.listSessions();
  console.log(`${String(sessions.length)} session(s) at ${src.describe}`);
  if (sessions.length === 0) {
    console.error('no sessions found — is this the directory holding <session>/navsat_log.json?');
    process.exit(1);
  }

  const results = await mapLimit(sessions, CONCURRENCY, async (id) => {
    let text;
    try {
      text = await src.readLog(id);
    } catch (e) {
      // A transport failure is NOT "this session has no log". Keeping them
      // apart matters: one is a fact about the corpus, the other is a fact
      // about tonight's network, and conflating them turns an outage into a
      // permanent-looking gap.
      return {
        track: null,
        excluded: { id, reason: `could not be read: ${e.message}` },
        failed: true,
      };
    }
    if (text !== null && mirror) {
      const dir = join(mirror, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, LOG_NAME), text);
    }

    const parsed = parseNavsat(id, text);
    if (!parsed.track) return parsed;

    /*
     * Frames. Listing a directory costs one request and gives the FILENAMES,
     * which are the timestamps — the images themselves are never fetched, so
     * 40,000 frame positions cost a few megabytes of HTML rather than the
     * hundreds of gigabytes the pixels would.
     */
    for (const [sensor, dirs] of Object.entries(SENSOR_DIRS)) {
      const stamps = [];
      let anyDir = false;
      for (const d of dirs) {
        let names;
        try {
          names = await src.listFrames(id, d);
        } catch (e) {
          parsed.frameErrors ??= [];
          parsed.frameErrors.push(`${sensor}: ${e.message}`);
          continue;
        }
        if (names === null) continue;          // no such folder for this session
        anyDir = true;
        stamps.push(...names);
      }
      if (!anyDir && stamps.length === 0) continue;

      const { dots, unmatched } = matchFrames(parsed.track.points, stamps);
      parsed.track.frames[sensor] = dots;
      parsed.track.unmatched[sensor] = unmatched;

      if (mirror) {
        writeFileSync(join(mirror, id, `${sensor}.stamps.txt`), stamps.join('\n'));
      }
    }
    return parsed;
  });

  const tracks = [];
  const excluded = [];
  let failures = 0;

  results.forEach((r, i) => {
    const id = sessions[i];
    if (r.track) {
      tracks.push(r.track);
      const d = r.dropped > 0 ? `  (dropped ${String(r.dropped)})` : '';
      const f = Object.keys(SENSOR_DIRS)
        .map((s2) => {
          const n = r.track.frames[s2].reduce((a, x) => a + x.n, 0);
          const u = r.track.unmatched[s2];
          return `${s2} ${String(n)}${u > 0 ? ` (+${String(u)} unplaced)` : ''}`;
        })
        .join(', ');
      console.log(`  ${id}: ${String(r.track.points.length)} fixes${d} · ${f}`);
      for (const e of r.frameErrors ?? []) console.log(`    ! ${e}`);
    } else if (r.excluded) {
      excluded.push(r.excluded);
      if (r.failed) failures++;
      console.log(`  ${id}: EXCLUDED — ${r.excluded.reason}`);
    }
  });

  const set = {
    version: 2,
    generatedAt: new Date().toISOString(),
    generator: `tools/ingest_kr_navsat.mjs ${src.describe}`,
    tracks,
    excluded,
  };

  mkdirSync(dirname(out), { recursive: true });
  // Compact: this is machine-read generated data, and 23 sessions of 5 Hz
  // fixes pretty-printed is several times the size for nobody's benefit.
  writeFileSync(out, JSON.stringify(set));

  const fixes = tracks.reduce((a, t) => a + t.points.length, 0);
  console.log(
    `\nwrote ${out}\n  ${String(tracks.length)} track(s), `
    + `${fixes.toLocaleString()} fixes, ${String(excluded.length)} excluded`,
  );
  if (mirror) console.log(`  mirrored logs to ${mirror}`);

  /*
   * A transport failure exits non-zero even though a usable file was written.
   * The file is real and partial; a CI step or a shell `&&` must not read
   * "some sessions could not be reached" as success.
   */
  if (failures > 0) {
    console.error(`\n${String(failures)} session(s) could not be READ — this run is incomplete.`);
    process.exit(1);
  }
}

/*
 * Importable for tests, executable as a script. `realpathSync` so a symlinked
 * invocation still matches, and the comparison is on file URLs rather than on
 * string suffixes, which match the wrong file for any path that happens to end
 * the same way.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main();
}
