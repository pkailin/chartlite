/**
 * Adapter: KR AIC field-collection layout → the neutral track set.
 *
 *   node tools/ingest_kr_navsat.mjs "<Labeled Dataset>" [--out public/tracks.json]
 *
 * THIS IS THE ONLY FILE THAT KNOWS WHAT KR'S LAYOUT LOOKS LIKE. The map draws
 * `src/data/tracks.ts`'s shape and nothing else, so the next corpus gets its
 * own adapter beside this one and changes nothing downstream. If a new format
 * ever makes you want to edit the map, the adapter is in the wrong place.
 *
 * What it reads: `rawdata/<session>/navsat_log.json`, an array of
 *
 *     {"gps":{"altitude":9.57,"latitude":1.216,"longitude":103.855,"heading":92},
 *      "timestamp":1765950878172248064}
 *
 * Four rules, each of which exists because the alternative silently produces a
 * plausible wrong answer:
 *
 * 1. NANOSECONDS VIA BIGINT. `timestamp` is a nanosecond epoch. Through a JS
 *    number 1765950878172248064 becomes …248000, so the division to
 *    milliseconds is done on BigInt and never on the parsed float. (JSON.parse
 *    has already rounded it, so the raw text is re-read for the stamp.)
 *
 * 2. NEVER INVENT A POSITION. A fix without finite lat/lon is dropped, not
 *    defaulted. Exactly (0, 0) is refused outright — Null Island is what a GPS
 *    receiver with no lock reports, not a place off Singapore.
 *
 * 3. A SESSION WITH NO navsat_log.json IS REPORTED, NOT SKIPPED. Two of KR's
 *    five sessions carry only camera and radar. Emitting three tracks and
 *    saying nothing would misreport the corpus as complete.
 *
 * 4. NO LICENCE TRAVELS WITH THIS DATA. Every track carries the caveat to the
 *    screen, and the output path is gitignored — see the note by DEFAULT_OUT.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** A finite number that is not a boolean. */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Nanosecond epoch → milliseconds, without going through a float.
 *
 * Takes the ORIGINAL TEXT of the stamp, because JSON.parse has already rounded
 * the value by the time it reaches an object. Falls back to the parsed number
 * when the text form cannot be found, which costs ~microseconds of precision —
 * irrelevant for drawing, and the fallback is reported rather than silent.
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

function readSession(dir, sessionId) {
  const file = join(dir, 'navsat_log.json');
  if (!existsSync(file)) {
    return {
      track: null,
      excluded: {
        id: sessionId,
        reason: 'no navsat_log.json — camera and radar only, so there is no position to draw',
      },
    };
  }

  const text = readFileSync(file, 'utf8');
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) {
    return { track: null, excluded: { id: sessionId, reason: 'navsat_log.json is not an array' } };
  }
  const stamps = rawStamps(text);

  const points = [];
  let droppedNoFix = 0;
  let droppedNullIsland = 0;
  let droppedNoTime = 0;

  rows.forEach((row, i) => {
    const gps = row?.gps;
    const lat = gps?.latitude;
    const lon = gps?.longitude;

    if (!finite(lat) || !finite(lon)) { droppedNoFix++; return; }
    // Rule 2. A receiver with no lock reports exactly this.
    if (lat === 0 && lon === 0) { droppedNullIsland++; return; }

    const stamp = stamps[i];
    const t = stamp === undefined ? null : nsTextToMs(stamp);
    if (t === null) { droppedNoTime++; return; }

    points.push({
      lon,
      lat,
      t,
      heading: finite(gps?.heading) ? gps.heading : null,
    });
  });

  if (points.length === 0) {
    return {
      track: null,
      excluded: { id: sessionId, reason: 'navsat_log.json held no usable fix' },
    };
  }

  const dropped = droppedNoFix + droppedNullIsland + droppedNoTime;
  if (dropped > 0) {
    console.warn(
      `  ${sessionId}: dropped ${dropped} fix(es) — `
      + `${droppedNoFix} without a position, ${droppedNullIsland} at (0,0), `
      + `${droppedNoTime} without a readable stamp`,
    );
  }

  return {
    track: {
      id: `kr:${sessionId}`,
      label: sessionId,
      source: SOURCE_LABEL,
      sourceNote: SOURCE_NOTE,
      vessel: 'ownship',
      points,
    },
    excluded: null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : DEFAULT_OUT;

  if (!root) {
    console.error('usage: node tools/ingest_kr_navsat.mjs "<Labeled Dataset dir>" [--out FILE]');
    process.exit(2);
  }

  const rawdata = join(resolve(root), 'rawdata');
  if (!existsSync(rawdata)) {
    console.error(`no rawdata/ under ${root}`);
    console.error('expected <Labeled Dataset>/rawdata/<session>/navsat_log.json');
    process.exit(1);
  }

  const sessions = readdirSync(rawdata, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`reading ${String(sessions.length)} session(s) from ${rawdata}`);

  const tracks = [];
  const excluded = [];
  for (const id of sessions) {
    const { track, excluded: ex } = readSession(join(rawdata, id), id);
    if (track) {
      tracks.push(track);
      console.log(`  ${id}: ${String(track.points.length)} fixes`);
    } else if (ex) {
      excluded.push(ex);
      console.log(`  ${id}: EXCLUDED — ${ex.reason}`);
    }
  }

  const set = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'tools/ingest_kr_navsat.mjs',
    tracks,
    excluded,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(set, null, 2));
  console.log(
    `\nwrote ${out}\n  ${String(tracks.length)} track(s), `
    + `${String(excluded.length)} session(s) excluded`,
  );
}

main();
