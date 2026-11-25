import {
  SENSOR_KINDS,
  SENSOR_LABELS,
  axisCoverage,
  bandLabel,
  framesOf,
  type Corpus,
  type SensorKind,
} from '../data/corpus';

/**
 * How the corpus is spread across each labelled ODD attribute, one row per
 * value.
 *
 * Each row gives the number of FRAMES of the selected sensor kind.
 *
 * THE EMPTY ROWS ARE THE POINT. A value with no frames is still drawn, at
 * zero, because "nothing at sea state 6" is the most useful thing this panel
 * can say.
 */
export interface CoveragePanelProps {
  corpus: Corpus;
  kind: SensorKind;
  onKind: (k: SensorKind) => void;
}

export default function CoveragePanel({ corpus, kind, onKind }: CoveragePanelProps) {
  const totals = Object.fromEntries(
    SENSOR_KINDS.map((k) => [k, corpus.scenarios.reduce((a, s) => a + framesOf(s, k), 0)]),
  ) as Record<SensorKind, number>;

  return (
    <aside className="panel" aria-label="ODD coverage">
      <h2 className="panel-title">ODD coverage</h2>

      <div className="seg" role="tablist" aria-label="Sensor">
        {SENSOR_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className={`seg-btn${k === kind ? ' seg-on' : ''}`}
            onClick={() => { onKind(k); }}
          >
            {SENSOR_LABELS[k]}
            <span className="tab-n">{totals[k].toLocaleString()}</span>
          </button>
        ))}
      </div>

      {totals[kind] === 0 && (
        <p className="panel-hint">No {SENSOR_LABELS[kind].toLowerCase()} frames in any source yet.</p>
      )}

      {corpus.axes.length === 0 && <p className="panel-hint">Nothing loaded yet.</p>}

      {corpus.axes.map((axis) => {
        const cov = axisCoverage(corpus.scenarios, kind, axis);
        const filled = cov.frames.filter((c) => c > 0).length;
        return (
          <section className="axis" key={axis.key}>
            <header className="axis-head">
              <h3 className="axis-name" title={axis.key}>{axis.label}</h3>
              <span className="axis-fill" title="values with at least one frame">
                {filled}/{axis.values.length}
              </span>
            </header>

            {axis.values.map((v, i) => {
              const n = cov.frames[i] ?? 0;
              const share = cov.total === 0 ? 0 : (100 * n) / cov.total;
              return (
                <div className={`band${n === 0 ? ' band-empty' : ''}`} key={v}>
                  <div className="band-row">
                    <span className="band-label">{bandLabel(v)}</span>
                    <span className="band-pct">{n.toLocaleString()}</span>
                  </div>
                  <div className="band-track">
                    <div className="band-fill" style={{ width: `${String(Math.max(share, 0.4))}%` }} />
                  </div>
                </div>
              );
            })}

            {cov.unknownFrames > 0 && (
              <div className="band band-unknown">
                <div className="band-row">
                  <span className="band-label">not labelled</span>
                  <span className="band-pct">{cov.unknownFrames.toLocaleString()}</span>
                </div>
              </div>
            )}
          </section>
        );
      })}

    </aside>
  );
}
