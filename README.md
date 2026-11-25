# chartlite

A chart of the Singapore Strait that places every camera and radar frame of a
field collection where it was taken, and shows how those frames are spread
across wind, rain and time of day.

- **Ground:** OpenStreetMap, with the OpenSeaMap seamark overlay above it —
  buoyage, lights, anchorages and the traffic separation scheme. Both keyless.
- **Frames:** one dot per GPS fix that has frames, with a tab per sensor
  (camera, radar).
- **ODD coverage:** a panel that counts the frames in each band of each measured
  axis — wind (kn), rain (mm/h) and four-hour time-of-day slots — and lists the
  axes the data cannot measure, with how each would arrive.

## Quick start

Needs Node ≥ 18.

```bash
npm install
npm run build
npm run serve        # → http://localhost:3300/
```

The chart runs with no data. To draw frames, ingest a collection first (see
[Data](#data)), then rebuild.

## Commands

```bash
npm run dev          # vite dev server with hot reload, port 3300
npm run build        # typecheck + bundle to dist/
npm run serve        # serve dist/ with serve.mjs (stdlib-only)
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run verify       # typecheck + test + build
```

`serve.mjs` takes `--port` and `--host` (or `CHARTLITE_PORT` and
`CHARTLITE_HOST`); the defaults are `3300` and `0.0.0.0`.

## Data

The chart reads `public/tracks.json`, written by an adapter under `tools/`:

```bash
# from a URL or a local directory laid out as <root>/<session>/navsat_log.json
node tools/ingest_kr_navsat.mjs <source> [--out FILE] [--mirror DIR]
npm run build
```

The adapter places each frame at the GPS fix nearest in time and conditions it
on the weather recorded at that moment, fetched by date from Singapore's NEA
station network (`api.data.gov.sg`, no key). `--mirror DIR` keeps a local copy
of every log it fetches, so a run can be repeated if the source goes away.

`public/tracks.json` is gitignored: the source collection carries no licence,
so positions derived from it are never committed. Every track shows that caveat
on screen.

A new collection format gets its own adapter beside this one. The map only
knows the shape in `src/data/tracks.ts`.

## Layout

```
serve.mjs                     static server for dist/
src/App.tsx                   loads the data; sensor tabs
src/map/Chart.tsx             the MapLibre component
src/map/basemap.ts            style definition (pure, tested)
src/map/view.ts               opening camera and chart frame (pure, tested)
src/map/layers/               frame and track layers
src/panels/CoveragePanel.tsx  ODD coverage
src/data/tracks.ts            the track-set shape every adapter writes
tools/ingest_kr_navsat.mjs    adapter: field-collection navsat logs → tracks.json
tools/nea.mjs                 historical weather from NEA
tools/odd.mjs                 ODD axes and band edges
launch/chartlite.launch.py    optional ROS 2 launch entry
```

## Design notes

**`Chart` fetches nothing.** Everything it draws arrives as props from `App`, so
a new data source changes `App` and an adapter, never the map.

**Weather is fetched by timestamp, not polled live.** The data's own timestamps
decide which weather is fetched, so any collection can be conditioned however
long after it was recorded.

**No dark theme.** The OpenStreetMap raster is light and cannot be inverted
without making the seamark overlay unreadable.

**CARTO is not used.** `basemaps.cartocdn.com` serves unauthenticated requests
with `API KEY REQUIRED` drawn into the tile image, with no error to explain it.
`test/basemap.test.ts` pins that no keyed host is used. Check any new basemap by
fetching a tile and looking at it.

## Failure modes

| Failure | Behaviour |
|---|---|
| `dist/` missing | The server stops before starting and names `npm run build`. |
| Port in use | Exits 1 naming the port. No respawn. |
| No WebGL context | The chart shows an explanatory message, not a white page. |
| A tile 404s | MapLibre draws blank tiles; the chart stays usable. |
| `tracks.json` missing | The chart draws with no frames: nothing has been ingested yet. |
| `tracks.json` unreadable | The chart says so over the map. |

## Running under ROS 2 (optional)

chartlite is also an `ament_cmake` package. Clone it into a colcon workspace as
`src/chartlite`, then:

```bash
colcon build --packages-select chartlite
ros2 launch chartlite chartlite.launch.py        # port:=3301 host:=127.0.0.1
colcon test --packages-select chartlite          # runs npm test
```

The package installs only `launch/` and serves `dist/` from the source tree, so
there is no installed copy of the bundle to go stale. `CHARTLITE_ROOT` points the
launch file at the source if your layout differs.
