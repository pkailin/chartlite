import { axisCoverage, type SensorId, type TrackSet } from '../data/tracks';

/**
 * What conditions the corpus actually sampled, one bar per band.
 *
 * THE EMPTY BANDS ARE THE POINT. A band with no frames is still drawn, at zero
 * — because "we have never captured in fresh wind" is the single most useful
 * thing this panel can tell you, and a chart that only plots what exists can
 * never say it. Hiding a zero row turns a gap into an absence of evidence
 * about a gap.
 *
 * Counts are FRAMES, not dots: a place holding six camera frames is six frames
 * captured in that condition.
 */
export interface CoveragePanelProps {
  set: TrackSet;
  sensor: SensorId;
}

const AXIS_TITLES: Record<string, string> = {
  wind: 'Wind',
  rain: 'Rain',
  illumination: 'Illumination',
  glint: 'Sun glint',
  bin: 'Time of day',
};

/**
 * Axes that exist in the taxonomy but cannot be measured here, and why.
 *
 * Shown rather than omitted, for the same reason an empty band is shown: a
 * panel listing five axes reads as "these are the axes", and the reader has no
 * way to know that seven more were considered and found unreachable.
 */
const ABSENT: { axis: string; why: string }[] = [
  { axis: 'visibility', why: 'no source — NEA publishes none' },
  { axis: 'traffic density', why: 'needs AIS (key-gated)' },
  { axis: 'vessel scale', why: 'needs AIS (key-gated)' },
  { axis: 'depth', why: 'bathymetry source unreachable' },
  { axis: 'waterway', why: 'not yet built' },
  { axis: 'shore proximity', why: 'not yet built' },
  { axis: 'confinement', why: 'not yet built' },
  { axis: 'encounter', why: 'not yet built' },
];

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  const p = (100 * n) / total;
  // Below 0.1% but non-zero reads as "<0.1%", never as "0.0%": a rounded zero
  // beside a real zero makes the two indistinguishable, and only one of them
  // is a gap.
  if (n > 0 && p < 0.1) return '<0.1%';
  return `${p.toFixed(1)}%`;
}

export default function CoveragePanel({ set, sensor }: CoveragePanelProps) {
  if (set.axes.length === 0) {
    return (
      <aside className="panel">
        <h2 className="panel-title">ODD coverage</h2>
        <p className="panel-hint">Nothing ingested yet.</p>
      </aside>
    );
  }

  return (
    <aside className="panel" aria-label="ODD coverage">
      <h2 className="panel-title">ODD coverage</h2>
      <p className="panel-hint">
        {sensor} frames by condition. Empty bands are drawn at zero — a
        condition never captured is the thing worth seeing.
      </p>

      {set.axes.map((axis, ai) => {
        const bands = set.bands[axis] ?? [];
        const labels = set.bandLabels[axis] ?? bands;
        const { counts, unknown, total } = axisCoverage(set.tracks, sensor, ai, bands.length);
        const filled = counts.filter((c) => c > 0).length;

        return (
          <section className="axis" key={axis}>
            <header className="axis-head">
              <h3 className="axis-name">{AXIS_TITLES[axis] ?? axis}</h3>
              <span className="axis-fill" title="bands with at least one frame">
                {filled}/{bands.length}
              </span>
            </header>

            {bands.map((band, bi) => {
              const n = counts[bi] ?? 0;
              const share = total === 0 ? 0 : (100 * n) / total;
              return (
                <div className={`band${n === 0 ? ' band-empty' : ''}`} key={band}>
                  <div className="band-row">
                    <span className="band-label">{labels[bi] ?? band}</span>
                    <span className="band-pct">{pct(n, total)}</span>
                  </div>
                  <div className="band-track">
                    {/* A hairline at zero so an empty band still reads as a
                        row that exists, rather than as a missing one. */}
                    <div className="band-fill" style={{ width: `${String(Math.max(share, 0.4))}%` }} />
                  </div>
                </div>
              );
            })}

            {unknown > 0 && (
              <div className="band band-unknown">
                <div className="band-row">
                  <span className="band-label">unknown</span>
                  <span className="band-pct">{pct(unknown, total)}</span>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="axis axis-absent">
        <header className="axis-head">
          <h3 className="axis-name">Not measured</h3>
        </header>
        <dl className="absent">
          {ABSENT.map(({ axis, why }) => (
            <div className="absent-row" key={axis}>
              <dt>{axis}</dt>
              <dd>{why}</dd>
            </div>
          ))}
        </dl>
      </section>

      {set.days.length > 0 && (
        <p className="panel-foot">
          {set.days.join(' · ')} · weather read by timestamp, not polled
        </p>
      )}
    </aside>
  );
}
