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
  ROUTE_LAYER,
  ROUTE_SOURCE,
  TRACK_HEAD_LAYER,
  TRACK_HEAD_SOURCE,
  formatDuration,
  formatSpan,
  hoverFrom,
  routeLinePaint,
  trackHeadPaint,
  type TrackHover,
} from './layers/trackLayer';
import { headsToGeoJSON, routesToGeoJSON, type Corpus } from '../data/corpus';

/**
 * The chart.
 *
 * THE ONE RULE THIS COMPONENT HOLDS: it fetches nothing. Everything it draws
 * arrives as props, so a new data source changes App and an adapter, never
 * the map.
 */
export interface ChartProps {
  centre?: LngLat;
  zoom?: number;
  corpus: Corpus;
  /** Called with a scenario id (`<source>/<dir>`) when a route or head is clicked. */
  onSelect?: (id: string) => void;
}

export default function Chart({
  centre = DEFAULT_CENTRE,
  zoom = DEFAULT_ZOOM,
  corpus,
  onSelect,
}: ChartProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  /** Whether the camera has already been moved to the data. See the fit below. */
  const fitted = useRef(false);
  const hovered = useRef<number | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<TrackHover | null>(null);
  const [hoverAt, setHoverAt] = useState<{ x: number; y: number } | null>(null);

  /* Built ONCE: rebuilding on a prop change would throw away the reader's pan and zoom. */
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
        canvasContextAttributes: { failIfMajorPerformanceCaveat: false },
      });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl(), 'top-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }));
      m.on('load', () => { setReady(true); });
    } catch (err) {
      // No WebGL context: say so instead of rendering a white page.
      setFailed(err instanceof Error ? err.message : String(err));
    }
    return () => {
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening camera, deliberately not a live binding
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const upsert = (id: string, data: GeoJSON.FeatureCollection) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
      else m.addSource(id, { type: 'geojson', data });
    };
    upsert(ROUTE_SOURCE, routesToGeoJSON(corpus));
    upsert(TRACK_HEAD_SOURCE, headsToGeoJSON(corpus));

    if (!m.getLayer(ROUTE_LAYER)) {
      m.addLayer({
        id: ROUTE_LAYER, type: 'line', source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: routeLinePaint(),
      });
    }
    if (!m.getLayer(TRACK_HEAD_LAYER)) {
      m.addLayer({ id: TRACK_HEAD_LAYER, type: 'circle', source: TRACK_HEAD_SOURCE, paint: trackHeadPaint() });
    }

    /* Frame the data once. Refitting on every change would yank the reader's view back. */
    if (!fitted.current && corpus.scenarios.length > 0) {
      const b = new maplibregl.LngLatBounds();
      for (const s of corpus.scenarios) for (const p of s.route) b.extend([p.lon, p.lat]);
      if (!b.isEmpty()) {
        m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 0 });
        fitted.current = true;
      }
    }

    const setState = (fid: number | null, on: boolean) => {
      if (fid === null || fid < 0) return;
      m.setFeatureState({ source: ROUTE_SOURCE, id: fid }, { hover: on });
      m.setFeatureState({ source: TRACK_HEAD_SOURCE, id: fid }, { hover: on });
    };
    const show = (e: maplibregl.MapLayerMouseEvent) => {
      const h = hoverFrom(e.features?.[0]?.properties as Record<string, unknown> | undefined);
      if (!h) return;
      if (hovered.current !== h.fid) {
        setState(hovered.current, false);
        hovered.current = h.fid;
        setState(h.fid, true);
      }
      setHover(h);
      setHoverAt({ x: e.point.x, y: e.point.y });
      m.getCanvas().style.cursor = 'pointer';
    };
    const hide = () => {
      setState(hovered.current, false);
      hovered.current = null;
      setHover(null);
      setHoverAt(null);
      m.getCanvas().style.cursor = '';
    };
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const h = hoverFrom(e.features?.[0]?.properties as Record<string, unknown> | undefined);
      if (h) selectRef.current?.(h.id);
    };

    for (const layer of [ROUTE_LAYER, TRACK_HEAD_LAYER]) {
      m.on('mousemove', layer, show);
      m.on('mouseleave', layer, hide);
      m.on('click', layer, click);
    }
    return () => {
      for (const layer of [ROUTE_LAYER, TRACK_HEAD_LAYER]) {
        m.off('mousemove', layer, show);
        m.off('mouseleave', layer, hide);
        m.off('click', layer, click);
      }
    };
  }, [ready, corpus]);

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
      {hover && hoverAt && (
        <div className="hover-card" data-testid="hover-card" style={{ left: hoverAt.x + 14, top: hoverAt.y + 14 }}>
          <div className="hover-source">{hover.source}</div>
          <div className="hover-label">{hover.scenario}</div>
          <dl className="hover-facts">
            {hover.when && (<><dt>start</dt><dd>{hover.when}</dd></>)}
            <dt>duration</dt><dd>{formatDuration(hover.seconds)}</dd>
            <dt>travelled</dt>
            <dd>{hover.stationary ? `${formatSpan(hover.spanM)} (stationary)` : formatSpan(hover.spanM)}</dd>
            <dt>camera frames</dt><dd>{hover.camera.toLocaleString()}</dd>
            <dt>radar frames</dt><dd>{hover.radar.toLocaleString()}</dd>
          </dl>
          <p className="hover-note">Click to review annotations</p>
        </div>
      )}
    </div>
  );
}
