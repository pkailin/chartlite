import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bandLabel, type Corpus, type Scenario } from '../data/corpus';
import {
  fetchBoxes,
  fetchFrames,
  fetchReviews,
  fetchSummary,
  postReview,
  stemOf,
  url,
  type Box,
  type FrameList,
  type ReviewSummary,
  type ScenarioReviews,
} from './api';

/**
 * Step through a scenario's frames with its 2D boxes drawn over the image,
 * and accept the annotation frame by frame.
 *
 * Keys: → / ← step, A toggles accept, Enter accepts and steps, L toggles labels.
 */
export interface ReviewTarget {
  scenarioId: string | null;
  sensor: string | null;
  index: number;
}

export interface ReviewViewProps {
  corpus: Corpus;
  target: ReviewTarget;
  onTarget: (t: ReviewTarget) => void;
}

/** Box colour by class. Bright on purpose: boxes sit over sea, sky and night images. */
const CLASS_INK: Record<string, string> = {
  vessel: '#FFD400',
  mark: '#00E5FF',
};
const OTHER_INK = '#FF4FD8';
const inkOf = (b: Box) => CLASS_INK[b.class] ?? OTHER_INK;

const PREFETCH = 3;

type BoxState =
  | { stem: string; status: 'loading' }
  | { stem: string; status: 'ok'; boxes: Box[] }
  | { stem: string; status: 'missing' }
  | { stem: string; status: 'error'; message: string };

function totalFrames(s: Scenario): number {
  return s.streams.reduce((a, st) => a + st.frames, 0);
}

function acceptedIn(summary: ReviewSummary, s: Scenario): number {
  const by = summary[s.source]?.[s.dir] ?? {};
  return Object.values(by).reduce((a, n) => a + n, 0);
}

export default function ReviewView({ corpus, target, onTarget }: ReviewViewProps) {
  const scenario = corpus.scenarios.find((s) => s.id === target.scenarioId) ?? null;
  const sensor = scenario
    ? (scenario.streams.find((st) => st.id === target.sensor)?.id ?? scenario.streams[0]?.id ?? null)
    : null;

  const [list, setList] = useState<FrameList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ScenarioReviews>({});
  const [summary, setSummary] = useState<ReviewSummary>({});
  const [boxes, setBoxes] = useState<BoxState | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 3840, h: 2160 });
  const [imgState, setImgState] = useState<{ src: string; ok: boolean } | null>(null);
  const [labels, setLabels] = useState(true);
  const [focusBox, setFocusBox] = useState<Box['id'] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchSummary().then(setSummary, () => { /* the list still works without counts */ });
  }, []);

  /* Frame list for the scenario + sensor. */
  useEffect(() => {
    setList(null);
    setListError(null);
    if (!scenario || !sensor) return;
    let live = true;
    fetchFrames(scenario.source, scenario.dir, sensor).then(
      (l) => { if (live) setList(l); },
      (e: unknown) => { if (live) setListError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [scenario?.source, scenario?.dir, sensor]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Accepted frames for the scenario, all sensors. */
  useEffect(() => {
    setReviews({});
    if (!scenario) return;
    let live = true;
    fetchReviews(scenario.source, scenario.dir).then((r) => { if (live) setReviews(r); }, () => undefined);
    return () => { live = false; };
  }, [scenario?.source, scenario?.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = list?.frames.length ?? 0;
  const index = n === 0 ? 0 : Math.min(Math.max(0, target.index), n - 1);
  const file = list?.frames[index] ?? null;
  const stem = file ? stemOf(file) : null;
  const imgUrl = list && file ? url(list.imageBase + encodeURIComponent(file)) : null;
  const sensorReviews = (sensor ? reviews[sensor] : undefined) ?? {};
  const accepted = stem !== null && sensorReviews[stem] !== undefined;
  const acceptedCount = list ? list.frames.reduce((a, f) => a + (sensorReviews[stemOf(f)] ? 1 : 0), 0) : 0;

  const go = useCallback((i: number) => {
    if (!scenario) return;
    onTarget({ scenarioId: scenario.id, sensor, index: Math.min(Math.max(0, i), Math.max(0, n - 1)) });
  }, [scenario, sensor, n, onTarget]);

  /* Boxes for the current frame, keyed by stem so stale boxes are never drawn over a new image. */
  useEffect(() => {
    if (!list || !stem) { setBoxes(null); return; }
    let live = true;
    setBoxes({ stem, status: 'loading' });
    fetchBoxes(url(`${list.bboxBase}${encodeURIComponent(stem)}.json`)).then(
      (b) => { if (live) setBoxes(b === null ? { stem, status: 'missing' } : { stem, status: 'ok', boxes: b }); },
      (e: unknown) => { if (live) setBoxes({ stem, status: 'error', message: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [list, stem]);

  /* Image: learn its size, then prefetch the next few frames so stepping feels instant. */
  useEffect(() => {
    if (!imgUrl || !list) return;
    const img = new Image();
    img.onload = () => {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setImgState({ src: imgUrl, ok: true });
    };
    img.onerror = () => { setImgState({ src: imgUrl, ok: false }); };
    img.src = imgUrl;
    for (let k = 1; k <= PREFETCH; k++) {
      const f = list.frames[index + k];
      if (!f) break;
      new Image().src = url(list.imageBase + encodeURIComponent(f));
      void fetch(url(`${list.bboxBase}${encodeURIComponent(stemOf(f))}.json`)).catch(() => undefined);
    }
  }, [imgUrl, list, index]);

  const setAccept = useCallback(async (on: boolean) => {
    if (!scenario || !sensor || !stem) return;
    const prev = reviews;
    // Optimistic: the badge flips at once, and is put back if the write fails.
    setReviews((r) => {
      const s = { ...(r[sensor] ?? {}) };
      if (on) s[stem] = new Date().toISOString(); else delete s[stem];
      return { ...r, [sensor]: s };
    });
    try {
      const next = await postReview({ source: scenario.source, scenario: scenario.dir, sensor, frames: [stem], accepted: on });
      setReviews(next);
      setSaveError(null);
      setSummary((sm) => ({
        ...sm,
        [scenario.source]: {
          ...(sm[scenario.source] ?? {}),
          [scenario.dir]: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, Object.keys(v).length])),
        },
      }));
    } catch (e) {
      setReviews(prev);
      setSaveError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [scenario, sensor, stem, reviews]);

  const acceptAndNext = useCallback(() => {
    if (!accepted) void setAccept(true);
    go(index + 1);
  }, [accepted, setAccept, go, index]);

  const nextUnreviewed = useCallback(() => {
    if (!list) return;
    for (let k = 1; k <= n; k++) {
      const i = (index + k) % n;
      const f = list.frames[i];
      if (f && !sensorReviews[stemOf(f)]) { go(i); return; }
    }
  }, [list, n, index, sensorReviews, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); void setAccept(!accepted); }
      else if (e.key === 'Enter') { e.preventDefault(); acceptAndNext(); }
      else if (e.key === 'l' || e.key === 'L') { setLabels((v) => !v); }
      else if (e.key === 'u' || e.key === 'U') { nextUnreviewed(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [go, index, setAccept, accepted, acceptAndNext, nextUnreviewed]);

  const shown = boxes && boxes.stem === stem && boxes.status === 'ok' ? boxes.boxes : [];
  const fontPx = Math.max(12, dims.w / 120);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? corpus.scenarios.filter((s) => s.id.toLowerCase().includes(q)) : corpus.scenarios;
  }, [corpus.scenarios, filter]);

  return (
    <div className="review">
      <aside className="review-list" aria-label="Scenarios">
        <h2 className="panel-title">Scenarios</h2>
        <input
          className="review-filter"
          type="search"
          placeholder="Filter"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
        />
        {corpus.sources.map((src) => {
          const rows = visible.filter((s) => s.source === src.name);
          if (rows.length === 0) return null;
          return (
            <div key={src.name}>
              {corpus.sources.length > 1 && <h3 className="review-source">{src.name}</h3>}
              {rows.map((s) => {
                const tot = totalFrames(s);
                const acc = acceptedIn(summary, s);
                const done = tot > 0 && acc >= tot;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`review-item${s.id === scenario?.id ? ' review-item-on' : ''}`}
                    onClick={() => { onTarget({ scenarioId: s.id, sensor: target.sensor, index: 0 }); }}
                  >
                    <span className="review-item-name">{s.scenario}</span>
                    <span className="review-item-meta">
                      {[s.odd['time_of_day'], s.odd['visibility_reduction_cause']].filter(Boolean).map((v) => bandLabel(String(v))).join(' · ')}
                    </span>
                    <span className="review-item-prog">
                      <span className="review-bar"><span style={{ width: `${String(tot ? (100 * acc) / tot : 0)}%` }} /></span>
                      <span className={done ? 'review-done' : ''}>{acc.toLocaleString()}/{tot.toLocaleString()}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </aside>

      <section className="review-main">
        {!scenario && (
          <div className="review-empty">
            {corpus.scenarios.length === 0 ? 'No scenarios loaded. Check chartlite.config.json.' : 'Pick a scenario on the left, or click a route on the chart.'}
          </div>
        )}

        {scenario && (
          <>
            <div className="review-toolbar">
              <div className="review-title">
                <strong>{scenario.scenario}</strong>
                <span className="review-sub">{scenario.source}</span>
              </div>
              <div className="seg" role="tablist" aria-label="Sensor">
                {scenario.streams.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={st.id === sensor}
                    className={`seg-btn${st.id === sensor ? ' seg-on' : ''}`}
                    onClick={() => { onTarget({ scenarioId: scenario.id, sensor: st.id, index }); }}
                  >
                    {st.id}
                  </button>
                ))}
              </div>
              <div className="review-nav">
                <button type="button" className="btn" onClick={() => { go(index - 1); }} disabled={index <= 0} title="Previous (←)">◀</button>
                <span className="review-count">{n === 0 ? '0 / 0' : `${(index + 1).toLocaleString()} / ${n.toLocaleString()}`}</span>
                <button type="button" className="btn" onClick={() => { go(index + 1); }} disabled={index >= n - 1} title="Next (→)">▶</button>
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className={`btn ${accepted ? 'btn-accepted' : 'btn-accept'}`}
                  onClick={() => { void setAccept(!accepted); }}
                  disabled={!stem}
                  title="Toggle accept (A)"
                >
                  {accepted ? '✓ Accepted' : 'Accept'}
                </button>
                <button type="button" className="btn" onClick={acceptAndNext} disabled={!stem} title="Accept and go to next (Enter)">
                  Accept &amp; next ▶
                </button>
                <button type="button" className="btn btn-quiet" onClick={nextUnreviewed} disabled={!list} title="Next frame not yet accepted (U)">
                  Next unaccepted
                </button>
                <label className="review-check">
                  <input type="checkbox" checked={labels} onChange={(e) => { setLabels(e.target.checked); }} /> labels
                </label>
              </div>
            </div>

            {list && n > 0 && (
              <Timeline frames={list.frames} accepted={sensorReviews} index={index} onSeek={go} />
            )}

            <div className="review-body">
              <div className={`review-stage${accepted ? ' review-stage-accepted' : ''}`}>
                {listError && <div className="review-empty">{listError}</div>}
                {!listError && list && n === 0 && <div className="review-empty">No frames in {sensor}/images.</div>}
                {imgUrl && (
                  <svg
                    className="review-svg"
                    viewBox={`0 0 ${String(dims.w)} ${String(dims.h)}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label={`${file ?? ''} with ${String(shown.length)} boxes`}
                  >
                    <rect width={dims.w} height={dims.h} fill="#0b1014" />
                    <image href={imgUrl} width={dims.w} height={dims.h} />
                    {shown.map((b) => {
                      const ink = inkOf(b);
                      const hi = focusBox === b.id;
                      return (
                        <g key={String(b.id)}>
                          <rect
                            x={b.xmin}
                            y={b.ymin}
                            width={Math.max(1, b.width)}
                            height={Math.max(1, b.height)}
                            fill={hi ? `${ink}33` : 'none'}
                            stroke={ink}
                            strokeWidth={hi ? 4 : 2}
                            strokeDasharray={b.occluded ? '6 4' : undefined}
                            vectorEffect="non-scaling-stroke"
                          />
                          {labels && (
                            <text
                              x={b.xmin}
                              y={Math.max(fontPx, b.ymin - fontPx * 0.35)}
                              fill={ink}
                              fontSize={fontPx}
                              fontFamily="IBM Plex Mono, monospace"
                              paintOrder="stroke"
                              stroke="#000"
                              strokeWidth={fontPx / 6}
                            >
                              {String(b.id)} {b.subclass ?? b.class}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}
                {accepted && <div className="review-badge">✓ Accepted</div>}
                {imgState && imgState.src === imgUrl && !imgState.ok && (
                  <div className="review-empty">Could not load the image.</div>
                )}
              </div>

              <aside className="review-side">
                <h3 className="axis-name">Frame</h3>
                <p className="review-file" title={file ?? ''}>{file ?? '—'}</p>
                <p className="review-sub">
                  {acceptedCount.toLocaleString()} of {n.toLocaleString()} {sensor} frames accepted
                </p>
                {saveError && <p className="review-error" role="alert">{saveError}</p>}

                <h3 className="axis-name">Boxes {boxes?.status === 'ok' ? `(${String(shown.length)})` : ''}</h3>
                {boxes?.status === 'loading' && <p className="review-sub">loading…</p>}
                {boxes?.status === 'missing' && <p className="review-error">No 2dbbox file for this frame.</p>}
                {boxes?.status === 'error' && <p className="review-error">{boxes.message}</p>}
                {boxes?.status === 'ok' && shown.length === 0 && <p className="review-sub">No objects annotated.</p>}
                <ul className="review-boxes">
                  {shown.map((b) => (
                    <li
                      key={String(b.id)}
                      onMouseEnter={() => { setFocusBox(b.id); }}
                      onMouseLeave={() => { setFocusBox(null); }}
                    >
                      <span className="review-swatch" style={{ background: inkOf(b) }} />
                      <span className="review-box-id">{String(b.id)}</span>
                      <span className="review-box-cls">
                        {b.class}{b.subclass ? ` / ${bandLabel(b.subclass)}` : ''}
                        {b.occluded ? ' · occluded' : ''}
                        {b.encounter_geometry ? ` · ${bandLabel(b.encounter_geometry)}` : ''}
                      </span>
                      <span className="review-box-size">{b.width}×{b.height}</span>
                    </li>
                  ))}
                </ul>

                <h3 className="axis-name">Scenario ODD</h3>
                <dl className="absent">
                  {corpus.axes.map((a) => (
                    <div className="absent-row" key={a.key}>
                      <dt>{a.label}</dt>
                      <dd>{scenario.odd[a.key] === null ? 'not labelled' : bandLabel(String(scenario.odd[a.key]))}</dd>
                    </div>
                  ))}
                </dl>
                <p className="review-keys">← → step · Shift ×10 · A accept · Enter accept &amp; next · U next unaccepted · L labels</p>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** One strip across the scenario: green where accepted, a marker at the current frame. Click to seek. */
function Timeline({ frames, accepted, index, onSeek }: {
  frames: string[];
  accepted: Record<string, string>;
  index: number;
  onSeek: (i: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const W = 1200;
  const H = 14;

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#dfe7eb';
    g.fillRect(0, 0, W, H);
    const n = frames.length;
    g.fillStyle = '#2A9D4B';
    frames.forEach((f, i) => {
      if (accepted[stemOf(f)]) g.fillRect(Math.floor((i / n) * W), 0, Math.max(1, Math.ceil(W / n)), H);
    });
    g.fillStyle = '#16202a';
    g.fillRect(Math.floor((index / n) * W) - 1, 0, 3, H);
  }, [frames, accepted, index]);

  return (
    <canvas
      ref={canvas}
      className="review-timeline"
      width={W}
      height={H}
      title="Accepted frames (green). Click to jump."
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.floor(((e.clientX - r.left) / r.width) * frames.length));
      }}
    />
  );
}
