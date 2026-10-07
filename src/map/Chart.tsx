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

/**
 * The chart.
 *
 * THE ONE RULE THIS COMPONENT HOLDS: it fetches nothing. Everything it draws
 * arrives as props. Today that is only a camera position; when weather,
 * coverage or tracks land they arrive the same way, and this file does not
 * change. A map component that loads its own data has to be rewritten the
 * first time the data source moves, which is the whole reason this tool exists
 * as a fresh start rather than a fork.
 */
export interface ChartProps {
  /** Opening centre. Defaults to mid-strait. */
  centre?: LngLat;
  /** Opening zoom. */
  zoom?: number;
}

export default function Chart({
  centre = DEFAULT_CENTRE,
  zoom = DEFAULT_ZOOM,
}: ChartProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /*
   * Built ONCE. `centre` and `zoom` are the opening camera, not a live binding
   * — rebuilding the map on every prop change would throw away the user's own
   * pan and zoom, and recreating a GL context is expensive enough to see.
   */
  useEffect(() => {
    if (!container.current || map.current) return;

    try {
      map.current = new maplibregl.Map({
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
      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.current.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }));
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening camera, deliberately not a live binding
  }, []);

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

  return <div className="chart" ref={container} data-testid="chart" />;
}
