import { useEffect, useState } from 'react';
import Chart from './map/Chart';
import { EMPTY_TRACK_SET, parseTrackSet, type TrackSet } from './data/tracks';

/** Injected by Vite at build time — see BUILD_ID in vite.config.ts. */
declare const __BUILD_ID__: string;

/**
 * Written by an adapter under `tools/`, served from `public/`.
 *
 * The build id in the query is load-bearing. An earlier build served this file
 * with `immutable, max-age=31536000`, and a browser that stored it under that
 * directive goes on honouring it for a year — it never asks again, so fixing
 * the server header cannot reach it. A per-build URL has no poisoned entry.
 */
const TRACKS_URL = `./tracks.json?b=${__BUILD_ID__}`;

/**
 * One tab, one chart.
 *
 * App owns the data and hands it to the map — the map fetches nothing. See the
 * rule at the top of `map/Chart.tsx`.
 *
 * THE BAR CARRIES NO STATISTICS. It held a drawn/excluded count briefly and
 * that was the wrong place for it: the bar is the tool's identity, not its
 * readout, and a number parked there is read once and then stops being read.
 * What the adapter included and excluded is printed when it runs. When a
 * surface exists that is about the ingest, the count belongs on that.
 *
 * A FAILED LOAD still has to say so somewhere, so it is reported over the
 * chart rather than silently swallowed — a chart with no tracks and no
 * explanation is indistinguishable from one where nothing was ingested.
 */
export default function App() {
  const [set, setSet] = useState<TrackSet>(EMPTY_TRACK_SET);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(TRACKS_URL)
      .then((r) => {
        /*
         * A 404 is the ORDINARY state, not an error: a fresh clone has no
         * tracks file because the adapter has not been run and, for KR, its
         * output may not be committed.
         */
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((raw) => {
        if (!live) return;
        if (raw !== null) setSet(parseTrackSet(raw));
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { live = false; };
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <span className="bar-name">CHARTLITE</span>
        <span className="bar-where">Singapore Strait</span>
      </header>
      <main className="stage">
        <Chart tracks={set.tracks} />
        {error !== null && (
          <div className="load-error" role="alert">
            Could not load tracks: {error}
          </div>
        )}
      </main>
    </div>
  );
}
