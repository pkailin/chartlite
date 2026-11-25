import { useCallback, useEffect, useMemo, useState } from 'react';
import { url } from '../review/api';
import {
  BEARING_BAD,
  BEARING_WARN,
  GRADE_INK,
  RANGE_BAD,
  RANGE_WARN,
  fetchAccuracy,
  fetchAccuracyScenarios,
  frameScore,
  gradeOf,
  type AccuracyReport,
  type AccuracySensor,
  type Check,
} from './api';

/**
 * Annotated frames that contain a GNSS-tracked target, with each target's box
 * compared to where GNSS says it was.
 *
 *  - Radar: a cross at the GNSS position, a line from the box centre to it,
 *    and the range, bearing and position error.
 *  - Camera: a dashed line along the GNSS bearing, and the bearing error.
 *    A single image cannot measure range.
 *
 * Keys: → / ← step (Shift ×10).
 */
export interface AccuracyTarget {
  scenarioId: string | null;
  sensor: string | null;
  index: number;
}

export interface AccuracyViewProps {
  target: AccuracyTarget;
  onTarget: (t: AccuracyTarget) => void;
}

const LINE_INK = '#00E5FF';

const fmt = (v: number | null | undefined, unit: string, signed = true) =>
  v === null || v === undefined ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`;

export default function AccuracyView({ target, onTarget }: AccuracyViewProps) {
  const [scenarios, setScenarios] = useState<{ source: string; dir: string }[] | null>(null);
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [labels, setLabels] = useState(true);

  useEffect(() => {
    fetchAccuracyScenarios().then(setScenarios, (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  const [source, dir] = useMemo(() => {
    const id = target.scenarioId;
    if (!id) return [null, null];
    const i = id.indexOf('/');
    return [id.slice(0, i), id.slice(i + 1)];
  }, [target.scenarioId]);

  useEffect(() => {
    setReport(null);
    setError(null);
    if (!source || !dir) return;
    let live = true;
    setLoading(true);
    fetchAccuracy(source, dir).then(
      (r) => { if (live) { setReport(r); setLoading(false); } },
      (e: unknown) => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
    return () => { live = false; };
  }, [source, dir]);

  const sensor: AccuracySensor | null = report
    ? (report.sensors.find((s) => s.id === target.sensor)
      ?? report.sensors.find((s) => s.kind === 'radar' && s.frames.length > 0)
      ?? report.sensors.find((s) => s.frames.length > 0)
      ?? report.sensors[0] ?? null)
    : null;
  const n = sensor?.frames.length ?? 0;
  const index = n === 0 ? 0 : Math.min(Math.max(0, target.index), n - 1);
  const frame = sensor?.frames[index] ?? null;
  const imgUrl = sensor && frame?.file ? url(sensor.imageBase + encodeURIComponent(frame.file)) : null;

  const go = useCallback((i: number) => {
    if (!target.scenarioId || !sensor) return;
    onTarget({ scenarioId: target.scenarioId, sensor: sensor.id, index: Math.min(Math.max(0, i), Math.max(0, n - 1)) });
  }, [target.scenarioId, sensor, n, onTarget]);

  useEffect(() => {
    if (!imgUrl || !sensor) return;
    const img = new Image();
    img.onload = () => { setDims({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = imgUrl;
    for (let k = 1; k <= 3; k++) {
      const f = sensor.frames[index + k];
      if (f?.file) new Image().src = url(sensor.imageBase + encodeURIComponent(f.file));
    }
  }, [imgUrl, sensor, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - (e.shiftKey ? 10 : 1)); }
      else if (e.key === 'l' || e.key === 'L') setLabels((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [go, index]);

  const worst = useMemo(() => {
    if (!sensor) return [];
    return sensor.frames.map((f, i) => ({ i, s: frameScore(f) })).sort((a, b) => b.s - a.s).slice(0, 6);
  }, [sensor]);

  const W = dims?.w ?? (sensor?.kind === 'radar' ? 2048 : 3840);
  const H = dims?.h ?? (sensor?.kind === 'radar' ? 2048 : 2160);
  const fontPx = Math.max(14, W / 90);
  const isRadar = sensor?.kind === 'radar';

  return (
    <div className="review">
      <aside className="review-list" aria-label="Scenarios with targets">
        <h2 className="panel-title">Target accuracy</h2>
        <p className="panel-hint">Scenarios with target GNSS (targets/gps).</p>
        {scenarios?.length === 0 && <p className="panel-hint">No scenario has targets/gps.</p>}
        {scenarios?.map((s) => {
          const id = `${s.source}/${s.dir}`;
          return (
            <button
              key={id}
              type="button"
              className={`review-item${id === target.scenarioId ? ' review-item-on' : ''}`}
              onClick={() => { onTarget({ scenarioId: id, sensor: target.sensor, index: 0 }); }}
            >
              <span className="review-item-name">{s.dir}</span>
              <span className="review-item-meta">{s.source}</span>
            </button>
          );
        })}
      </aside>

      <section className="review-main">
        {!target.scenarioId && <div className="review-empty">Pick a scenario on the left.</div>}
        {loading && <div className="review-empty">Comparing boxes with target GNSS…</div>}
        {error && <div className="review-empty review-error">{error}</div>}

        {report && sensor && (
          <>
            <div className="review-toolbar">
              <div className="review-title">
                <strong>{report.scenario}</strong>
                <span className="review-sub">{report.source} · calibration {report.calibrationVersion}</span>
              </div>
              <div className="seg" role="tablist" aria-label="Sensor">
                {report.sensors.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={s.id === sensor.id}
                    className={`seg-btn${s.id === sensor.id ? ' seg-on' : ''}`}
                    onClick={() => { onTarget({ scenarioId: target.scenarioId, sensor: s.id, index: 0 }); }}
                  >
                    {s.id}<span className="tab-n">{s.frames.length}</span>
                  </button>
                ))}
              </div>
              <div className="review-nav">
                <button type="button" className="btn" onClick={() => { go(index - 1); }} disabled={index <= 0} title="Previous (←)">◀</button>
                <span className="review-count">{n === 0 ? '0 / 0' : `${(index + 1).toLocaleString()} / ${n.toLocaleString()}`}</span>
                <button type="button" className="btn" onClick={() => { go(index + 1); }} disabled={index >= n - 1} title="Next (→)">▶</button>
              </div>
              <label className="review-check">
                <input type="checkbox" checked={labels} onChange={(e) => { setLabels(e.target.checked); }} /> labels
              </label>
            </div>

            <div className="review-body">
              <div className="review-stage">
                {n === 0 && <div className="review-empty">No annotated {sensor.id} frame contains a tracked target.</div>}
                {frame && !frame.file && <div className="review-empty">Image for {frame.stem} not found in rawdata.</div>}
                {imgUrl && frame && (
                  <svg className="review-svg" viewBox={`0 0 ${String(W)} ${String(H)}`} preserveAspectRatio="xMidYMid meet">
                    <rect width={W} height={H} fill="#0b1014" />
                    <image href={imgUrl} width={W} height={H} />
                    {frame.checks.map((c) => (
                      <Overlay key={String(c.id)} c={c} radar={isRadar} fontPx={fontPx} labels={labels} />
                    ))}
                  </svg>
                )}
              </div>

              <aside className="review-side">
                <h3 className="axis-name">This frame</h3>
                <p className="review-file">{frame?.file ?? frame?.stem ?? '—'}</p>
                {frame?.checks.map((c) => <CheckCard key={String(c.id)} c={c} radar={isRadar} />)}

                <h3 className="axis-name">Scenario · {sensor.id}</h3>
                <table className="acc-table">
                  <thead>
                    <tr>
                      <th>target</th><th>n</th>
                      <th title="median bearing error">Δb med</th><th title="90th percentile of |bearing error|">|Δb| p90</th>
                      {isRadar && <><th title="median range error">Δr med</th><th title="90th percentile of |range error|">|Δr| p90</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {sensor.summary.map((s) => (
                      <tr key={String(s.id)}>
                        <td>{s.id} {s.name}</td>
                        <td>{s.n}</td>
                        <td>{fmt(s.bearingMedian, '°')}</td>
                        <td>{fmt(s.bearingP90Abs, '°', false)}</td>
                        {isRadar && <><td>{fmt(s.rangeMedian, ' m')}</td><td>{fmt(s.rangeP90Abs, ' m', false)}</td></>}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3 className="axis-name">Calibration used</h3>
                <dl className="absent">
                  {isRadar ? (
                    <>
                      <Row k="scale" v={`${String(sensor.calib.metersPerPixel?.toFixed(4))} m/px (${String(sensor.calib.rangeAtEdgeM)} m to edge)`} />
                      <Row k="from" v={sensor.calib.scaleSource ?? '—'} />
                      <Row k="best fit to GNSS" v={`${String(sensor.calib.fittedMetersPerPixel ?? '—')} m/px (${String(sensor.calib.fittedRangeAtEdgeM ?? '—')} m)`} />
                      <Row k="orientation" v={sensor.calib.alignment ?? '—'} />
                    </>
                  ) : (
                    <>
                      <Row k="yaw on hull" v={`${fmt(sensor.calib.yawDeg, '°')} (${sensor.calib.yawSource ?? '—'})`} />
                      <Row k="best-fit yaw" v={fmt(sensor.calib.fittedYawDeg, '°')} />
                      <Row k="pitch" v={`${fmt(sensor.calib.pitchDeg, '°')}${sensor.calib.pitchAssumed ? ' (assumed, TBD)' : ''}`} />
                      <Row k="lens distortion" v={sensor.calib.distortion ?? '—'} />
                    </>
                  )}
                </dl>
                {isRadar && sensor.calib.fittedMetersPerPixel && sensor.calib.metersPerPixel
                  && Math.abs(sensor.calib.fittedMetersPerPixel / sensor.calib.metersPerPixel - 1) > 0.05 && (
                  <p className="review-error">
                    The best-fit scale differs from radar_params.yaml by{' '}
                    {Math.round(100 * (sensor.calib.fittedMetersPerPixel / sensor.calib.metersPerPixel - 1))}%.
                    Range errors may come from the scale, not the boxes.
                  </p>
                )}
                {!isRadar && sensor.calib.yawSource === 'fitted' && (
                  <p className="review-sub">
                    Yaw is TBD in extrinsic_params.yaml, so it is fitted from these targets. That cancels any constant
                    bearing offset: the median error is ~0 by construction, and only the spread is meaningful.
                  </p>
                )}

                <h3 className="axis-name">Worst frames</h3>
                <ul className="acc-worst">
                  {worst.map(({ i, s }) => (
                    <li key={i}>
                      <button type="button" className="btn btn-quiet" onClick={() => { go(i); }}>
                        #{i + 1}: {s.toFixed(1)}{isRadar ? ' (° or 10 m)' : '°'}
                      </button>
                    </li>
                  ))}
                </ul>

                {report.notes.length > 0 && (
                  <>
                    <h3 className="axis-name">Notes</h3>
                    {report.notes.map((x) => <p key={x} className="review-sub">{x}</p>)}
                  </>
                )}
                <p className="review-keys">
                  Green ≤ {BEARING_WARN}°{isRadar ? ` / ${String(RANGE_WARN)} m` : ''} · amber ≤ {BEARING_BAD}°
                  {isRadar ? ` / ${String(RANGE_BAD)} m` : ''} · red beyond. ← → step · Shift ×10 · L labels.
                  {isRadar ? ' Cross = GNSS position.' : ' Dashed line = GNSS bearing.'}
                </p>
              </aside>
            </div>
          </>
        )}
        {report && !sensor && <div className="review-empty">No sensor in this scenario could be checked. {report.notes.join(' ')}</div>}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="absent-row"><dt>{k}</dt><dd>{v}</dd></div>;
}

function Overlay({ c, radar, fontPx, labels }: { c: Check; radar: boolean; fontPx: number; labels: boolean }) {
  const ink = GRADE_INK[gradeOf(c)];
  const cx = c.box.xmin + c.box.width / 2;
  const cy = c.box.ymin + c.box.height / 2;
  const label = radar
    ? `${String(c.id)} ${c.name}  Δr ${fmt(c.err.range, ' m')}  Δb ${fmt(c.err.bearing, '°')}`
    : `${String(c.id)} ${c.name}  Δb ${fmt(c.err.bearing, '°')}`;
  const s = fontPx * 0.9;
  return (
    <g>
      {radar && c.predicted && (
        <>
          <line x1={cx} y1={cy} x2={c.predicted.x} y2={c.predicted.y} stroke={LINE_INK} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path
            d={`M${String(c.predicted.x - s)} ${String(c.predicted.y)}h${String(2 * s)}M${String(c.predicted.x)} ${String(c.predicted.y - s)}v${String(2 * s)}`}
            stroke={LINE_INK}
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {!radar && c.line && c.line.length >= 2 && (
        <polyline
          points={c.line.map(([u, v]) => `${String(u)},${String(v)}`).join(' ')}
          fill="none"
          stroke={LINE_INK}
          strokeWidth={2}
          strokeDasharray="10 6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        x={c.box.xmin}
        y={c.box.ymin}
        width={Math.max(1, c.box.width)}
        height={Math.max(1, c.box.height)}
        fill="none"
        stroke={ink}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      {labels && (
        <text
          x={c.box.xmin}
          y={Math.max(fontPx, c.box.ymin - fontPx * 0.4)}
          fill={ink}
          fontSize={fontPx}
          fontFamily="IBM Plex Mono, monospace"
          paintOrder="stroke"
          stroke="#000"
          strokeWidth={fontPx / 6}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function CheckCard({ c, radar }: { c: Check; radar: boolean }) {
  const grade = gradeOf(c);
  return (
    <div className="acc-card" style={{ borderLeftColor: GRADE_INK[grade] }}>
      <div className="acc-card-head">
        <strong>{String(c.id)} {c.name}</strong>
        <span className={`acc-grade acc-${grade}`}>{grade}</span>
      </div>
      <table className="acc-table">
        <thead><tr><th /><th>GNSS</th><th>box</th><th>error</th></tr></thead>
        <tbody>
          {radar && <tr><td>range</td><td>{fmt(c.gnss.range, ' m', false)}</td><td>{fmt(c.measured.range, ' m', false)}</td><td>{fmt(c.err.range, ' m')}</td></tr>}
          <tr><td>bearing</td><td>{fmt(c.gnss.bearing, '°')}</td><td>{fmt(c.measured.bearing, '°')}</td><td>{fmt(c.err.bearing, '°')}</td></tr>
        </tbody>
      </table>
      <p className="review-sub">
        {radar && c.err.position !== undefined && <>box centre {c.err.position.toFixed(1)} m from GNSS · </>}
        box {radar ? `${c.sizeM.w.toFixed(0)} × ${String(c.sizeM.h?.toFixed(0))} m` : `≈ ${c.sizeM.w.toFixed(1)} m wide at GNSS range`}
        {c.lengthM !== null && <> · vessel {c.lengthM} × {c.breadthM} m</>}
        {Math.abs(c.dtMs) > 50 && <> · GPS fix {c.dtMs} ms off</>}
        {!radar && c.line?.length === 0 && <> · GNSS bearing is outside this camera&apos;s view</>}
      </p>
    </div>
  );
}
