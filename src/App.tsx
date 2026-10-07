import { useEffect, useState } from 'react';
import Chart from './map/Chart';
import { EMPTY_TRACK_SET, parseTrackSet, type TrackSet } from './data/tracks';

/** Written by an adapter under `tools/`, served from `public/`. */
const TRACKS_URL = './tracks.json';

/**
 * One tab, one chart.
 *
 * App owns the data and hands it to the map — the map fetches nothing. See the
 * rule at the top of `map/Chart.tsx`.
 */
export default function App() {
  const [set, setSet] = useState<TrackSet>(EMPTY_TRACK_SET);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(TRACKS_URL)
      .then((r) => {
        /*
         * A 404 is the ORDINARY state, not an error: a fresh clone has no
         * tracks file because the adapter has not been run and, for KR, its
         * output may not be committed. Reported as "no tracks ingested",
         * which is a different sentence from "the fetch failed".
         */
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((raw) => {
        if (!live) return;
        if (raw !== null) setSet(parseTrackSet(raw));
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
    return () => { live = false; };
  }, []);

  const n = set.tracks.length;

  return (
    <div className="app">
      <header className="bar">
        <span className="bar-name">CHARTLITE</span>
        <span className="bar-where">Singapore Strait</span>

        <span className="bar-spacer" />

        {/* What is on the chart, and what is not. The excluded count is shown
            beside the drawn count on purpose: three tracks from a five-session
            corpus looks complete unless the other two are named. */}
        {error !== null ? (
          <span className="bar-stat bar-stat-bad" role="alert">tracks: {error}</span>
        ) : !loaded ? (
          <span className="bar-stat">loading…</span>
        ) : n === 0 ? (
          <span className="bar-stat">no tracks ingested</span>
        ) : (
          <>
            <span className="bar-stat">
              <b>{n}</b> track{n === 1 ? '' : 's'}
            </span>
            {set.excluded.length > 0 && (
              <span
                className="bar-stat bar-stat-dim"
                title={set.excluded.map((e) => `${e.id}: ${e.reason}`).join('\n')}
              >
                {set.excluded.length} excluded
              </span>
            )}
          </>
        )}
      </header>
      <main className="stage">
        <Chart tracks={set.tracks} />
      </main>
    </div>
  );
}
