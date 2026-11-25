# chartlite

A chart of the Singapore Strait that draws the GNSS route of every scenario in
one or more SynDataset-layout collections, shows how their camera and radar
frames are spread across the labelled ODD attributes, and lets you step through
each scenario's 2D-box annotations and accept them frame by frame.

- **Ground:** OpenStreetMap, with the OpenSeaMap seamark overlay above it —
  buoyage, lights, anchorages and the traffic separation scheme. Both keyless.
- **Routes:** one line per scenario from `gnss/gnss_info.csv`, coloured by
  source. Hover for details, click to open its annotations.
- **ODD coverage:** for each attribute labelled in `metadata.json` (waterway
  type, operating phase, time of day, visibility scale and cause, backlighting,
  precipitation, Beaufort, sea state code), the number of frames and scenarios
  at each value, split by Camera / Radar. Values with no data are still listed,
  at zero.
- **Annotations:** the frame image with its `2dbbox` boxes drawn over it. Step
  with ← / →, accept with A, accept and advance with Enter. Accepted frames are
  marked on the frame, on the timeline strip and in the scenario list.

## Quick start

### 1. Install Node (once)

Needs Node ≥ 18. Ubuntu's `apt` package is too old, so install it with
[nvm](https://github.com/nvm-sh/nvm) instead. This goes under your home folder
and needs no sudo:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
node --version       # v22.x
```

### 2. Point it at your data

Edit [`chartlite.config.json`](chartlite.config.json) so each source's `path` is
a SynDataset-layout folder (default: `~/SynDataset`). See [Data](#data).

### 3. Build and start

```bash
cd chartlite
npm install          # first time, and after pulling new dependencies
npm run build        # after every code change
npm run serve        # → http://localhost:3300/
```

Open **http://localhost:3300** in a browser. There are two tabs, **CHART** and
**ANNOTATIONS**, and clicking a route on the chart opens its annotations. Stop
the server with Ctrl+C.

- **Another port:** `npm run serve -- --port 8080`.
- **From another computer on your network:** open `http://<this machine's IP>:3300`
  (find the IP with `hostname -I`). If it does not load, allow the port through
  the firewall: `sudo ufw allow 3300`.
- **This computer only:** `npm run serve -- --host 127.0.0.1`.
- **While developing:** `npm run dev` serves the same app on port 3300 and
  reloads when the code changes, with no build step. Stop `npm run serve` first,
  because both use port 3300.

There is no login. Anyone who can reach the port can view the dataset images
and accept or un-accept annotations, so do not expose it to the internet.

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

[`chartlite.config.json`](chartlite.config.json) lists the collections to read.
Add as many as you like, and each must follow the SynDataset layout:

```json
{
  "sources": [
    { "name": "SynDataset", "path": "~/SynDataset" },
    { "name": "SynDataset2", "path": "/media/disk/SynDataset2" }
  ],
  "reviewsFile": "./reviews.json"
}
```

```
<path>/rawdata/<SCN>/metadata.json               ODD labels, date, duration
<path>/rawdata/<SCN>/gnss/gnss_info.csv          stamp_ns,lat,lon,heading_deg,…
<path>/rawdata/<SCN>/<sensor>/images/*.jpg|png   frames
<path>/groundtruth/<SCN>/<sensor>/2dbbox/*.json  boxes, same file stem as the image
```

- `name` appears in URLs and in the reviews file, so it must be letters,
  digits, `.`, `_` or `-`. `path` may use `~`, and relative paths resolve
  against the config file.
- A sensor is any folder under `rawdata/<SCN>/` that has `images/` inside it.
  `camera*` folders count as Camera and `radar*` folders count as Radar, so a
  radar stream is picked up as soon as it appears on disk.
- The server re-reads the config on every request, so after editing it you only
  need to refresh the browser. Use `--config FILE` or `CHARTLITE_CONFIG` to point at
  another config.
- A scenario that cannot be read (for example, no `metadata.json` or no GNSS
  file) is skipped. Its reason is in `excluded` at `/api/corpus`.
- The ODD attributes and the order of their values are set in
  [`tools/odd.mjs`](tools/odd.mjs). A value found in the data but missing from
  that list is still counted. Add `"oddAxes": [{ "key", "label", "values" }]` to
  the config to override the list.

Accepted annotations are written to `reviewsFile` (gitignored by default):
source → scenario → sensor → frame stem → time accepted.

## Layout

```
chartlite.config.json         the sources to read
serve.mjs                     static server for dist/ + the API
server/api.mjs                /api/* and /data/* (also mounted by `npm run dev`)
server/reviews.mjs            accepted-annotation store
tools/config.mjs              config loading and validation
tools/syndataset.mjs          adapter: SynDataset layout → corpus
tools/odd.mjs                 ODD attributes and their values
src/App.tsx                   loads the corpus; Chart / Annotations tabs
src/data/corpus.ts            the corpus shape the adapter writes, and coverage
src/map/                      the MapLibre chart, basemap, route layers
src/panels/CoveragePanel.tsx  ODD coverage
src/review/                   the annotation reviewer
launch/chartlite.launch.py    optional ROS 2 launch entry
```

**`/data/` serves dataset files.** Only images and JSON under each source's
`rawdata/` and `groundtruth/` are served, read-only. The default host is
`0.0.0.0`, so anyone on your network can view them. Pass `--host 127.0.0.1` to
keep it local.

## Design notes

**`Chart` fetches nothing.** Everything it draws arrives as props from `App`, so
a new data source changes `App` and an adapter, never the map.

**ODD comes from the labels, not from outside feeds.** Each scenario's
`metadata.json` holds its ODD values. Nothing is fetched from weather services.

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
| Config missing or invalid | The page shows the error, naming the file or field. |
| A source path missing | Skipped. The reason is in `sources[].error` at `/api/corpus`. |
| A frame has no `2dbbox` file | The reviewer says so beside the image. |

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
