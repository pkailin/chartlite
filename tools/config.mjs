/**
 * The config file: which collections to read, and where review state lives.
 *
 *   {
 *     "sources": [
 *       { "name": "SynDataset", "path": "~/SynDataset" },
 *       { "name": "SynDataset2", "path": "/media/disk/SynDataset2" }
 *     ],
 *     "reviewsFile": "./reviews.json",
 *     // per source, optional: override configs/<version>/ calibration
 *     //   "calibration": { "radar": { "meters_per_pixel": 1.8086 },
 *     //                    "camera0": { "yaw_deg": -30, "pitch_deg": 0 } }
 *     "oddAxes": [ ... ]            // optional, overrides tools/odd.mjs
 *   }
 *
 * Every source must follow the SynDataset layout — see tools/syndataset.mjs.
 *
 * Found at `--config FILE`, else `$CHARTLITE_CONFIG`, else
 * `chartlite.config.json` beside package.json. Relative paths resolve against
 * the config file's own directory, and `~` expands to the home directory.
 *
 * The server re-reads this file on every request, so adding a source needs a
 * browser refresh and not a restart.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AXES } from './odd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONFIG_FILE = resolve(HERE, '..', 'chartlite.config.json');

/**
 * A source name is used in URLs (`/data/<name>/…`) and as a key in the reviews
 * file, so it is held to a plain charset instead of being escaped everywhere.
 */
export const NAME_RE = /^(?!\.+$)[A-Za-z0-9._-]+$/;

export function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function resolveFrom(baseDir, p) {
  const e = expandHome(p);
  return isAbsolute(e) ? e : resolve(baseDir, e);
}

/** Validate a parsed config object. Throws with a message naming the field. */
export function parseConfig(raw, baseDir) {
  if (typeof raw !== 'object' || raw === null) throw new Error('config: not an object');
  const sources = raw.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('config: `sources` must be a non-empty array of {name, path}');
  }
  const seen = new Set();
  const out = sources.map((s, i) => {
    if (typeof s !== 'object' || s === null) throw new Error(`config: sources[${i}] is not an object`);
    if (typeof s.name !== 'string' || !NAME_RE.test(s.name)) {
      throw new Error(`config: sources[${i}].name must match ${String(NAME_RE)}`);
    }
    if (seen.has(s.name)) throw new Error(`config: duplicate source name "${s.name}"`);
    seen.add(s.name);
    if (typeof s.path !== 'string' || s.path.length === 0) {
      throw new Error(`config: sources[${i}].path must be a string`);
    }
    if (s.calibration !== undefined && (typeof s.calibration !== 'object' || s.calibration === null)) {
      throw new Error(`config: sources[${i}].calibration must be an object`);
    }
    return { name: s.name, root: resolveFrom(baseDir, s.path), path: s.path, calibration: s.calibration ?? {} };
  });

  let axes = DEFAULT_AXES;
  if (raw.oddAxes !== undefined) {
    if (!Array.isArray(raw.oddAxes)) throw new Error('config: `oddAxes` must be an array');
    axes = raw.oddAxes.map((a, i) => {
      if (typeof a?.key !== 'string') throw new Error(`config: oddAxes[${i}].key must be a string`);
      return {
        key: a.key,
        label: typeof a.label === 'string' ? a.label : a.key,
        values: Array.isArray(a.values) ? a.values.map(String) : [],
      };
    });
  }

  return {
    sources: out,
    reviewsFile: resolveFrom(baseDir, typeof raw.reviewsFile === 'string' ? raw.reviewsFile : './reviews.json'),
    axes,
  };
}

export function configFileFromArgs(argv = process.argv) {
  const i = argv.indexOf('--config');
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  return process.env.CHARTLITE_CONFIG ? resolve(process.env.CHARTLITE_CONFIG) : DEFAULT_CONFIG_FILE;
}

export function loadConfig(file = configFileFromArgs()) {
  if (!existsSync(file)) {
    throw new Error(`config: ${file} not found — create it, or pass --config FILE`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`config: ${file} is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  return { ...parseConfig(raw, dirname(file)), file };
}
