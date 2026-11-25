import { useCallback, useEffect, useRef, useState } from 'react';
import Chart from './map/Chart';
import CoveragePanel from './panels/CoveragePanel';
import ReviewView, { type ReviewTarget } from './review/ReviewView';
import AccuracyView from './accuracy/AccuracyView';
import { EMPTY_CORPUS, parseCorpus, type Corpus, type SensorKind } from './data/corpus';
import { url } from './review/api';

type View = 'chart' | 'review' | 'targets';

/**
 * Where the page is, kept in the hash so a refresh lands in the same place:
 *   #chart
 *   #review/<source>/<scenario dir>/<sensor>/<frame index, 1-based>
 *   #targets/<source>/<scenario dir>/<sensor>/<frame index, 1-based>
 *
 * The review and targets tabs each keep their own place, so switching between
 * them does not lose either.
 */
interface Route { view: View; review: ReviewTarget; targets: ReviewTarget }

const NOWHERE: ReviewTarget = { scenarioId: null, sensor: null, index: 0 };

function parseHash(hash: string, prev?: Route): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  const base: Route = prev ?? { view: 'chart', review: NOWHERE, targets: NOWHERE };
  if (parts[0] === 'review' || parts[0] === 'targets') {
    const [view, source, dir, sensor, idx] = parts;
    const t: ReviewTarget = source && dir
      ? { scenarioId: `${source}/${dir}`, sensor: sensor || null, index: Math.max(0, (Number(idx) || 1) - 1) }
      : base[view];
    return { ...base, view, [view]: t };
  }
  return { ...base, view: 'chart' };
}

function toHash(r: Route): string {
  if (r.view === 'chart') return '#chart';
  const { scenarioId, sensor, index } = r[r.view];
  if (!scenarioId) return `#${r.view}`;
  const enc = encodeURIComponent;
  const [source, ...dir] = scenarioId.split('/');
  return `#${r.view}/${enc(source ?? '')}/${enc(dir.join('/'))}/${enc(sensor ?? '')}/${String(index + 1)}`;
}

/**
 * App owns the data and hands it down. The map and the panels fetch nothing
 * of their own, except the reviewer's per-frame images and boxes.
 *
 * A FAILED LOAD is reported over the page and never swallowed: an empty chart
 * with no explanation looks the same as one with nothing configured.
 */
export default function App() {
  const [corpus, setCorpus] = useState<Corpus>(EMPTY_CORPUS);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<SensorKind>('camera');
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    let live = true;
    fetch(url('/api/corpus'))
      .then(async (r) => {
        if (!r.ok) {
          let msg = `HTTP ${String(r.status)}`;
          try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
          throw new Error(msg);
        }
        return r.json() as Promise<unknown>;
      })
      .then((raw) => { if (live) setCorpus(parseCorpus(raw)); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onHash = () => { setRoute((prev) => parseHash(window.location.hash, prev)); };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); };
  }, []);

  const routeRef = useRef(route);
  routeRef.current = route;

  /* replaceState, not a new history entry per frame: Back should leave a tab, not step one frame. */
  const navigate = useCallback((update: (r: Route) => Route, push = false) => {
    const next = update(routeRef.current);
    routeRef.current = next;
    setRoute(next);
    const h = toHash(next);
    if (h !== window.location.hash) {
      if (push) window.history.pushState(null, '', h);
      else window.history.replaceState(null, '', h);
    }
  }, []);

  const onReview = useCallback((t: ReviewTarget) => { navigate((r) => ({ ...r, view: 'review', review: t })); }, [navigate]);
  const onTargets = useCallback((t: ReviewTarget) => { navigate((r) => ({ ...r, view: 'targets', targets: t })); }, [navigate]);
  const openScenario = useCallback((id: string) => {
    navigate((r) => ({ ...r, view: 'review', review: { scenarioId: id, sensor: null, index: 0 } }), true);
  }, [navigate]);

  return (
    <div className="app">
      <header className="bar">
        <span className="bar-name">CHARTLITE</span>
        <span className="bar-where">Singapore Strait</span>
        <nav className="tabs" aria-label="View">
          {([['chart', 'CHART'], ['review', 'ANNOTATIONS'], ['targets', 'TARGETS']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`tab${route.view === v ? ' tab-on' : ''}`}
              aria-pressed={route.view === v}
              onClick={() => { navigate((r) => ({ ...r, view: v }), true); }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {error !== null && (
        <div className="load-error" role="alert">Could not load the corpus: {error}</div>
      )}

      {/* The chart stays mounted while reviewing, so coming back keeps the reader's pan and zoom. */}
      <main className="body" hidden={route.view !== 'chart'}>
        <CoveragePanel corpus={corpus} kind={kind} onKind={setKind} />
        <div className="stage">
          <Chart corpus={corpus} onSelect={openScenario} />
        </div>
      </main>

      {route.view === 'review' && (
        <ReviewView corpus={corpus} target={route.review} onTarget={onReview} />
      )}

      {route.view === 'targets' && (
        <AccuracyView target={route.targets} onTarget={onTargets} />
      )}
    </div>
  );
}
