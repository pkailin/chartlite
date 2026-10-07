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
  { axis: 'illumination', why: 'recorded by hand' },
  { axis: 'sun glare', why: 'recorded by hand — needs camera FOV' },
  { axis: 'visibility', why: 'no source — NEA publishes none' },
  { axis: 'traffic density', why: 'no historical AIS exists' },
  { axis: 'vessel scale', why: 'no historical AIS exists' },
  { axis: 'depth', why: 'bathymetry source unreachable' },
  { axis: 'waterway', why: 'not yet built' },
  { axis: 'shore proximity', why: 'not yet built' },
  { axis: 'confinement', why: 'not yet built' },
  { axis: 'encounter', why: 'not yet built' },
];

/**
 * Frames, grouped, as a plain count.
 *
 * Counts rather than percentages because a percentage hides the size of what
 * it is a percentage OF: 1.7% of rain reads the same whether it rests on 580
 * frames or on six, and those are very different claims about evidence. The
 * bar beside it still carries the proportion, so nothing is lost.
 */
function count(n: number): string {
  return n.toLocaleString();
}

export default function CoveragePanel({ set, sensor }: CoveragePanelProps) {
  /*
   * Every axis sums to the same total — each frame is banded on all of them —
   * so the denominator is stated once at the top rather than repeated per
   * axis, and the per-band rows are left to be plain counts.
   */
  const total = set.tracks.reduce(
    (a, t) => a + (t.frames[sensor] ?? []).reduce((b, d) => b + d.n, 0),
    0,
  );

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
        {total.toLocaleString()} {sensor} frames by condition. Empty bands are
        drawn at zero — a condition never captured is the thing worth seeing.
      </p>

      {set.axes.map((axis, ai) => {
        const bands = set.bands[axis] ?? [];
        const labels = set.bandLabels[axis] ?? bands;
        const { counts, unknown } = axisCoverage(set.tracks, sensor, ai, bands.length);
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
                    <span className="band-pct">{count(n)}</span>
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
                  <span className="band-pct">{count(unknown)}</span>
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
