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
 * Axes that belong in this picture and are not in the data yet.
 *
 * Listed rather than omitted: a panel showing three bars reads as "these are
 * the axes", and a reader has no way to know that others were considered.
 * Each names HOW it would arrive, because that is the actionable part — an
 * axis waiting on a hand annotation and an axis waiting on a sensor feed are
 * different pieces of work.
 */
const ABSENT: { axis: string; how: string }[] = [
  { axis: 'backlighting condition', how: 'manually labelled' },
  { axis: 'visibility', how: 'manually labelled' },
  { axis: 'traffic density', how: 'manually labelled from annotation' },
  { axis: 'ownship speed', how: 'from IMU data' },
  { axis: 'sea state', how: 'manually labelled' },
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
   * The denominator for the bar WIDTHS only; it is no longer printed. Every
   * axis sums to it — a frame is banded on all of them — so a reader who
   * wants the total can add any one axis's bands, and the rows stay plain
   * counts rather than counts-with-a-percentage.
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
          {ABSENT.map(({ axis, how }) => (
            <div className="absent-row" key={axis}>
              <dt>{axis}</dt>
              <dd>{how}</dd>
            </div>
          ))}
        </dl>
        <p className="absent-note">
          All these ODD axes can be represented as strata like those above, but
          are not present in the data.
        </p>
      </section>
    </aside>
  );
}
