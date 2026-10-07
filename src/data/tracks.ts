/**
 * What a track is, once the format it arrived in has been forgotten.
 *
 * THE POINT OF THIS FILE is that the map knows nothing about KR, or about any
 * other corpus. An adapter under `tools/` reads one vendor's layout and emits
 * this; the chart draws this and only this. The next dataset — a different
 * vendor, a different log format, our own captures — gets its own adapter and
 * changes nothing here or in the map.
 *
 * So the rule to hold when adding the second source: if the map has to learn
 * the new format, the adapter is in the wrong place.
 */

/** One fix. Time is epoch MILLISECONDS — see `TIME` below. */
export interface TrackPoint {
  lon: number;
  lat: number;
  /** Epoch ms. */
  t: number;
  /** Degrees true, or null when the log carries none. Never 0 as a stand-in. */
  heading: number | null;
}

/**
 * TIME. Source logs may carry nanoseconds (KR's do: 1765950878172248064).
 * A nanosecond epoch does not survive a JS number — 1765950878172248064
 * becomes …248000 — so adapters must divide with BigInt, and this interface is
 * declared in milliseconds to put the conversion in one place and keep it out
 * of every consumer.
 *
 * Milliseconds are enough for a track: a 5 Hz GPS log has 200 ms between
 * fixes. If something later needs to join on the original stamp, that join
 * belongs on the full-precision value in the source, not on this.
 */

export interface Track {
  /** Stable, unique across a TrackSet. Used as the MapLibre feature id. */
  id: string;
  /** Shown on hover. */
  label: string;
  /**
   * Where this came from, shown on hover beside the label.
   *
   * It is a REQUIRED field and not an optional note. A position drawn on a
   * chart with no provenance is indistinguishable from one we measured, and
   * this tool will eventually carry both.
   */
  source: string;
  /** Licence or caveat, shown on hover under the source. */
  sourceNote: string | null;
  /** Which hull — ownship, target A, and so on. */
  vessel: string;
  points: TrackPoint[];
}

/** A source that was found but produced no track, and why. */
export interface ExcludedTrack {
  id: string;
  reason: string;
}

export interface TrackSet {
  /** Bumped when the shape changes, so a stale file fails loudly. */
  version: 1;
  /** ISO 8601, when the adapter ran. */
  generatedAt: string;
  /** What produced this file, for the same reason `source` exists. */
  generator: string;
  tracks: Track[];
  /**
   * NOT an error list. Sessions the adapter deliberately did not draw, each
   * with its reason — two of the five KR sessions carry no navsat log at all.
   * Silently rendering three of five would misreport the corpus; the UI shows
   * this count, so the absence is on screen rather than inferred.
   */
  excluded: ExcludedTrack[];
}

export const EMPTY_TRACK_SET: TrackSet = {
  version: 1,
  generatedAt: '',
  generator: '',
  tracks: [],
  excluded: [],
};

/** Metres per degree of latitude. Good to ~0.1% over the Strait. */
const M_PER_DEG_LAT = 110_574;

/** A track's bounding span in metres — how far it actually went. */
export function spanMetres(track: Track): number {
  if (track.points.length < 2) return 0;
  let n = 90, s = -90, w = 180, e = -180;
  for (const p of track.points) {
    if (p.lat < n) n = p.lat;
    if (p.lat > s) s = p.lat;
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
  }
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(((n + s) / 2) * (Math.PI / 180));
  return Math.hypot((s - n) * M_PER_DEG_LAT, (e - w) * mPerDegLon);
}

/**
 * Whether a track is a vessel that stayed put.
 *
 * 25 m over the whole log: wider than GPS scatter at anchor (metres), far
 * narrower than the shortest real transit here (670 m). Named rather than
 * inlined because it changes what the hover card says, and a reader deserves
 * to see the number that decided it.
 */
export const MOORED_SPAN_M = 25;

export function isMoored(track: Track): boolean {
  return spanMetres(track) < MOORED_SPAN_M;
}

/** Duration in seconds, or 0 for a track with fewer than two fixes. */
export function durationS(track: Track): number {
  if (track.points.length < 2) return 0;
  const first = track.points[0];
  const last = track.points[track.points.length - 1];
  if (!first || !last) return 0;
  return Math.max(0, (last.t - first.t) / 1000);
}

/**
 * Parse a TrackSet from whatever the fetch returned.
 *
 * Throws rather than coercing. A malformed track file silently becoming an
 * empty one would render a chart with no tracks and nothing to say why, which
 * is the same failure as drawing the wrong thing and harder to notice.
 */
export function parseTrackSet(raw: unknown): TrackSet {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('track set: not an object');
  }
  const o = raw as Record<string, unknown>;
  if (o['version'] !== 1) {
    throw new Error(`track set: unsupported version ${String(o['version'])}`);
  }
  if (!Array.isArray(o['tracks'])) {
    throw new Error('track set: `tracks` is not an array');
  }
  return {
    version: 1,
    generatedAt: String(o['generatedAt'] ?? ''),
    generator: String(o['generator'] ?? ''),
    tracks: o['tracks'] as Track[],
    excluded: Array.isArray(o['excluded']) ? (o['excluded'] as ExcludedTrack[]) : [],
  };
}

/** GeoJSON the track layer draws, one LineString per track. */
export function tracksToGeoJSON(tracks: readonly Track[]): {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: Record<string, string | number | boolean>;
  }[];
} {
  return {
    type: 'FeatureCollection',
    features: tracks
      // A LineString needs two positions. A one-fix track is drawn by the
      // point layer instead, never dropped.
      .filter((t) => t.points.length >= 2)
      .map((t) => ({
        type: 'Feature' as const,
        id: t.id,
        geometry: {
          type: 'LineString' as const,
          coordinates: t.points.map((p) => [p.lon, p.lat] as [number, number]),
        },
        properties: {
          id: t.id,
          label: t.label,
          source: t.source,
          sourceNote: t.sourceNote ?? '',
          vessel: t.vessel,
          fixes: t.points.length,
          seconds: Math.round(durationS(t)),
          spanM: Math.round(spanMetres(t)),
          moored: isMoored(t),
        },
      })),
  };
}

/**
 * One point per track, at its first fix.
 *
 * A moored vessel's "track" is a metre of GPS scatter — at chart zoom that is
 * a sub-pixel line, i.e. invisible. Without this, two of the three KR sessions
 * would simply not appear, and the chart would under-report the corpus while
 * looking complete.
 */
export function trackHeadsToGeoJSON(tracks: readonly Track[]): {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, string | number | boolean>;
  }[];
} {
  return {
    type: 'FeatureCollection',
    features: tracks.flatMap((t) => {
      const p = t.points[0];
      if (!p) return [];
      return [{
        type: 'Feature' as const,
        id: `${t.id}:head`,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
        properties: {
          id: t.id,
          label: t.label,
          source: t.source,
          sourceNote: t.sourceNote ?? '',
          vessel: t.vessel,
          fixes: t.points.length,
          seconds: Math.round(durationS(t)),
          spanM: Math.round(spanMetres(t)),
          moored: isMoored(t),
        },
      }];
    }),
  };
}
