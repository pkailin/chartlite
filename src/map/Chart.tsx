import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyle } from './basemap';
import {
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  type LngLat,
} from './view';
import {
  TRACK_HEAD_LAYER,
  TRACK_HEAD_SOURCE,
  TRACK_HIT_LAYER,
  TRACK_LINE_LAYER,
  TRACK_SOURCE,
  formatDuration,
  formatSpan,
  hoverFrom,
  trackHeadPaint,
  trackHitPaint,
  trackLinePaint,
  type TrackHover,
} from './layers/trackLayer';
import {
  FRAME_LAYER,
  FRAME_SOURCE,
  formatStamp,
  frameDotPaint,
  frameHoverFrom,
  EXTERNAL_INK,
  type FrameHover,
} from './layers/frameLayer';
import {
  framesToGeoJSON,
  tracksToGeoJSON,
  trackHeadsToGeoJSON,
  type SensorId,
  type Track,
} from '../data/tracks';

/**
 * The chart.
 *
 * THE ONE RULE THIS COMPONENT HOLDS: it fetches nothing. Everything it draws
 * arrives as props. A map component that loads its own data has to be
 * rewritten the first time the data source moves — and it moved on the first
 * feature, when tracks arrived from an adapter rather than from an API.
 */
export interface ChartProps {
  /** Opening centre. Defaults to mid-strait. */
  centre?: LngLat;
  /** Opening zoom. */
  zoom?: number;
  /** Tracks to draw. Provenance-labelled; see `src/data/tracks.ts`. */
  tracks?: readonly Track[];
  /** Which sensor's frames to show. One at a time, by design. */
  sensor?: SensorId;
}

export default function Chart({
  centre = DEFAULT_CENTRE,
  zoom = DEFAULT_ZOOM,
  tracks = [],
  sensor = 'camera',
}: ChartProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  /** Whether the camera has already been moved to the data. See the fit below. */
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<TrackHover | null>(null);
  const [frameHover, setFrameHover] = useState<FrameHover | null>(null);
  const [hoverAt, setHoverAt] = useState<{ x: number; y: number } | null>(null);

  /*
   * Built ONCE. `centre` and `zoom` are the opening camera, not a live
   * binding — rebuilding on every prop change would throw away the user's own
   * pan and zoom, and recreating a GL context is expensive enough to see.
   */
  useEffect(() => {
    if (!container.current || map.current) return;

    try {
      const m = new maplibregl.Map({
        container: container.current,
        style: basemapStyle() as unknown as maplibregl.StyleSpecification,
        center: centre,
        zoom,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        // Tolerate hosts without a full GPU rather than refusing to draw: a
        // blurry chart beats a blank page, and this tool is read, not flown.
        canvasContextAttributes: { failIfMajorPerformanceCaveat: false },
      });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl(), 'top-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }));
      m.on('load', () => { setReady(true); });
    } catch (err) {
      /*
       * The constructor throws when there is no WebGL context — a headless
       * host, a locked-down browser, a VM with no GL. Left uncaught this
       * renders a white page with the reason only in the console, which reads
       * as "the tool is broken" rather than "this browser cannot draw a map".
       */
      setFailed(err instanceof Error ? err.message : String(err));
    }

    return () => {
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening camera, deliberately not a live binding
  }, []);

  /* Tracks. Sources are upserted so new data never rebuilds the map. */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const lines = tracksToGeoJSON(tracks) as unknown as GeoJSON.FeatureCollection;
    const heads = trackHeadsToGeoJSON(tracks) as unknown as GeoJSON.FeatureCollection;

    const lineSrc = m.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (lineSrc) lineSrc.setData(lines);
    else m.addSource(TRACK_SOURCE, { type: 'geojson', data: lines });

    const headSrc = m.getSource(TRACK_HEAD_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (headSrc) headSrc.setData(heads);
    else m.addSource(TRACK_HEAD_SOURCE, { type: 'geojson', data: heads });

    /*
     * ORDER: the wide transparent hit target goes UNDER the visible line, so
     * it can never sit on top of the ink it exists to make pointable.
     */
    if (!m.getLayer(TRACK_HIT_LAYER)) {
      m.addLayer({
        id: TRACK_HIT_LAYER, type: 'line', source: TRACK_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: trackHitPaint(),
      });
    }
    if (!m.getLayer(TRACK_LINE_LAYER)) {
      m.addLayer({
        id: TRACK_LINE_LAYER, type: 'line', source: TRACK_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: trackLinePaint(),
      });
    }
    if (!m.getLayer(TRACK_HEAD_LAYER)) {
      m.addLayer({
        id: TRACK_HEAD_LAYER, type: 'circle', source: TRACK_HEAD_SOURCE,
        paint: trackHeadPaint(),
      });
    }

    /*
     * Frame the data, ONCE.
     *
     * The opening view is the whole Strait, where a 670 m track is about nine
     * pixels and the two moored sessions are a dot — you would open the tool
     * and reasonably conclude nothing had been ingested. So the first time
     * tracks arrive the camera goes to them.
     *
     * Once only, guarded by a ref: refitting on every data change would yank
     * the view back from wherever the reader had panned to, which is worse
     * than never fitting at all.
     */
    if (!fitted.current && tracks.length > 0) {
      const b = new maplibregl.LngLatBounds();
      for (const t of tracks) for (const p of t.points) b.extend([p.lon, p.lat]);
      if (!b.isEmpty()) {
        // maxZoom, because fitting two moored sessions a metre across would
        // otherwise zoom to street level and lose all marine context.
        m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 0 });
        fitted.current = true;
      }
    }

    const show = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const h = hoverFrom(f?.properties as Record<string, unknown> | undefined);
      if (h) {
        setHover(h);
        setHoverAt({ x: e.point.x, y: e.point.y });
        m.getCanvas().style.cursor = 'pointer';
      }
    };
    const hide = () => {
      setHover(null);
      setHoverAt(null);
      m.getCanvas().style.cursor = '';
    };

    // Both the hit line and the head, so a moored session — whose line is
    // sub-pixel — is hoverable through its dot.
    for (const id of [TRACK_HIT_LAYER, TRACK_HEAD_LAYER]) {
      m.on('mousemove', id, show);
      m.on('mouseleave', id, hide);
    }
    return () => {
      for (const id of [TRACK_HIT_LAYER, TRACK_HEAD_LAYER]) {
        m.off('mousemove', id, show);
        m.off('mouseleave', id, hide);
      }
    };
  }, [ready, tracks]);

  /*
   * Frame dots for the selected sensor.
   *
   * Its OWN effect, keyed on `sensor` as well as the data, so switching tabs
   * only swaps this source — the track lines, the camera position and the
   * once-only fit are all untouched. Tabs that rebuilt the map would reset the
   * reader's pan on every click, which is the whole reason they are tabs and
   * not two separate pages.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const data = framesToGeoJSON(tracks, sensor) as unknown as GeoJSON.FeatureCollection;
    const src = m.getSource(FRAME_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    else m.addSource(FRAME_SOURCE, { type: 'geojson', data });

    if (!m.getLayer(FRAME_LAYER)) {
      // Above the track line: the dots are the subject, the line is context.
      m.addLayer({ id: FRAME_LAYER, type: 'circle', source: FRAME_SOURCE, paint: frameDotPaint(EXTERNAL_INK) });
    }

    const show = (e: maplibregl.MapLayerMouseEvent) => {
      const h = frameHoverFrom(e.features?.[0]?.properties as Record<string, unknown> | undefined);
      if (h) {
        setFrameHover(h);
        setHover(null);           // a dot sits on the line; only one card
        setHoverAt({ x: e.point.x, y: e.point.y });
        m.getCanvas().style.cursor = 'pointer';
      }
    };
    const hide = () => {
      setFrameHover(null);
      setHoverAt(null);
      m.getCanvas().style.cursor = '';
    };
    m.on('mousemove', FRAME_LAYER, show);
    m.on('mouseleave', FRAME_LAYER, hide);
    return () => {
      m.off('mousemove', FRAME_LAYER, show);
      m.off('mouseleave', FRAME_LAYER, hide);
    };
  }, [ready, tracks, sensor]);

  if (failed !== null) {
    return (
      <div className="chart-failed" role="alert">
        <h2>This browser cannot draw the chart</h2>
        <p>
          MapLibre could not get a WebGL context. Try a different browser, or
          enable hardware acceleration.
        </p>
        <p className="chart-failed-detail">{failed}</p>
      </div>
    );
  }

  return (
    <div className="chart" ref={container} data-testid="chart">
      {frameHover && hoverAt && (
        <div
          className="hover-card"
          data-testid="frame-hover-card"
          style={{ left: hoverAt.x + 14, top: hoverAt.y + 14 }}
        >
          <div className="hover-source">{frameHover.source} · {frameHover.sensor}</div>
          <div className="hover-label">{frameHover.label}</div>
          <dl className="hover-facts">
            <dt>frames here</dt><dd>{frameHover.n.toLocaleString()}</dd>
            <dt>at</dt><dd>{formatStamp(frameHover.t)}</dd>
          </dl>
          {frameHover.sourceNote && <p className="hover-note">{frameHover.sourceNote}</p>}
        </div>
      )}
      {!frameHover && hover && hoverAt && (
        <div
          className="hover-card"
          data-testid="hover-card"
          style={{ left: hoverAt.x + 14, top: hoverAt.y + 14 }}
        >
          {/* The source leads. A position on a chart with no provenance is
              indistinguishable from one we measured. */}
          <div className="hover-source">{hover.source}</div>
          <div className="hover-label">{hover.label}</div>
          <dl className="hover-facts">
            <dt>vessel</dt><dd>{hover.vessel}</dd>
            <dt>fixes</dt><dd>{hover.fixes.toLocaleString()}</dd>
            <dt>duration</dt><dd>{formatDuration(hover.seconds)}</dd>
            <dt>travelled</dt>
            <dd>{hover.moored ? `${formatSpan(hover.spanM)} — moored` : formatSpan(hover.spanM)}</dd>
          </dl>
          {hover.sourceNote && <p className="hover-note">{hover.sourceNote}</p>}
        </div>
      )}
    </div>
  );
}
