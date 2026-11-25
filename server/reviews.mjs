/**
 * Which 2D-box annotations a reviewer has accepted.
 *
 * One JSON file, keyed source → scenario → sensor → frame stem → ISO time of
 * acceptance:
 *
 *   { "version": 1, "accepted": { "SynDataset": { "SCN-BCK-LIT_2oC2": {
 *       "camera0": { "1786057500000000000__2026-08-06_23-05-00-000Z": "2026-11-25T03:12:09.000Z" }
 *   } } } }
 *
 * A frame missing from the file has not been accepted. Writes go to a temp
 * file and are then renamed over the old one, so a crash mid-write leaves the
 * previous file whole instead of half-written.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function emptyStore() {
  return { version: 1, accepted: {} };
}

export function readStore(file) {
  if (!existsSync(file)) return emptyStore();
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (raw?.version !== 1 || typeof raw.accepted !== 'object' || raw.accepted === null) {
    throw new Error(`reviews: ${file} is not a version-1 reviews file`);
  }
  return raw;
}

export function writeStore(file, store) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 1)}\n`);
  renameSync(tmp, file);
}

/** Mark (or unmark) frames. Mutates and returns the store. */
export function setAccepted(store, { source, scenario, sensor, frames, accepted, at = new Date().toISOString() }) {
  const bySource = (store.accepted[source] ??= {});
  const byScenario = (bySource[scenario] ??= {});
  const bySensor = (byScenario[sensor] ??= {});
  for (const f of frames) {
    if (accepted) bySensor[f] = at;
    else delete bySensor[f];
  }
  return store;
}

export function scenarioReviews(store, source, scenario) {
  return store.accepted[source]?.[scenario] ?? {};
}

/** Counts only: source → scenario → sensor → accepted frames. */
export function summary(store) {
  const out = {};
  for (const [source, scns] of Object.entries(store.accepted)) {
    for (const [scn, sensors] of Object.entries(scns)) {
      for (const [sensor, frames] of Object.entries(sensors)) {
        ((out[source] ??= {})[scn] ??= {})[sensor] = Object.keys(frames).length;
      }
    }
  }
  return out;
}
