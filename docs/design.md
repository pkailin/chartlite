> Moved from `usv_fleet_stack` `docs/superpowers/specs/2026-10-07-chartlite-design.md`
> on 2026-11-25. A record of the design at the time: paths such as `src/chartlite/`
> refer to that repo.

# chartlite — a clean standalone strait chart

**Date:** 2026-10-07
**Status:** design, awaiting implementation plan

## Why

The fleet's full perception V&V instrument has grown many surfaces. That
growth is deliberate and the surfaces earn their place, but it means there is no
longer a small thing to build on: adding one new idea means landing it inside a
programme spine, a rail system, a bitemporal archive and a coverage firewall.

`chartlite` is a deliberately empty starting point — one tab showing the
Singapore Strait — that features can be grown back onto one at a time.

It takes **nothing** from that instrument: no code, no archive, no
configuration, no shared modules. The two tools coexist on different ports and
share only the public tile servers they both happen to use.

## The eventual job, and why it shapes this build

The intended end state is:

> ingest capture data → read the timestamps off it → fetch the weather that was
> true at those instants → condition ODD coverage on it

That is a different model from polling weather live on a 5-minute
cadence. The live-poll model has a structural flaw that this design avoids:
weather exists only for the wall-clock periods the poller happened to be
running. Measured on the live archive on 2026-10-07, `nea-wind-speed` holds
readings for 2026-08-27 through 08-29, a scattering on 08-31, then nothing until
10-07 — a five-and-a-half week hole. Any capture session recorded in that window
can never be conditioned on weather, and no amount of future polling fixes it.

Fetching by *timestamp*, driven by the data, removes the failure mode. It is
also supported upstream, which was verified live during design:

| Request | Response |
|---|---|
| `GET /v1/environment/rainfall?date_time=2026-09-15T08:00:00` | 1 snapshot, 88 station readings, `timestamp: 2026-09-15T08:00:00+08:00` |
| `GET /v1/environment/rainfall?date=2026-09-15` | 287 snapshots, `00:05` through `23:55` |

All five NEA realtime params (wind speed, wind direction, air temperature,
relative humidity, rainfall) share that response shape and both parameters.

**None of that is built in this first step.** It is recorded here because it
determines one decision below: the map component must not fetch.

## Scope of this build

In:

- One browser tab, full-bleed map of the Singapore Strait.
- OpenStreetMap raster ground, OpenSeaMap seamark overlay above it.
- Navigation and scale controls.
- `ros2 launch chartlite chartlite.launch.py`, serving on port 3300.

Out, each a later step that slots in without moving what exists:

- weather of any kind
- any database or persisted state
- the operating-area polygon
- panels, rails, drawers, surfaces
- a theme toggle
- ODD arithmetic

## Architecture

```
src/chartlite/
  package.xml              ament_cmake, so colcon builds it
  CMakeLists.txt           installs launch/ ONLY — see "Staleness" below
  launch/
    chartlite.launch.py    ros2 launch entry; resolves to the SOURCE tree
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  serve.mjs                static file server for the built bundle
  src/
    main.tsx               mount
    App.tsx                one tab, full-bleed map
    map/
      Chart.tsx            the MapLibre component
      basemap.ts           style definition (pure)
      view.ts              default centre, zoom, bounds (pure)
  test/
    basemap.test.ts
    view.test.ts
  README.md
```

**Stack:** Vite + TypeScript + React 18, MapLibre GL. React is present from the
start so that the first panel does not require a migration.

### The basemap

A MapLibre style v8 with two raster sources, both keyless:

| Layer | Tiles | Notes |
|---|---|---|
| `osm` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | ground, maxzoom 18 |
| `seamark` | `https://t1.openseamap.org/seamark/{z}/{x}/{y}.png` | overlay, opacity 0.85, minzoom 8 |

CARTO is deliberately **not** used. `basemaps.cartocdn.com` now watermarks
unauthenticated tiles with "API KEY REQUIRED" baked into the image — verified
2026-08-27 by fetching a tile directly. Any keyless dark basemap added later
must be re-checked the same way.

Attribution for both sources is required by their licences (ODbL) and is carried
in the style's `attribution` fields so MapLibre renders it.

### The one architectural rule

**`Chart` takes everything it draws as props from `App`, and fetches nothing.**

This is the whole reason the tool is worth scaffolding rather than hacking. When
weather arrives it becomes `<Chart stations={...} />`, and the map module does
not change. A map component that fetches its own data is a map component that
has to be rewritten the first time the data source changes.

## ROS integration

`ros2 launch chartlite chartlite.launch.py` is a requirement, so the package is a
colcon package with `ament_cmake`.

It joins **no DDS domain** and needs **no RTI Connext environment**. The launch
file must say so, because every other launch file in this repo does need it, and
a reader who sources the RTI env out of habit should know it was unnecessary
rather than conclude it was required.

### Staleness: the trap not to inherit

A copy-installed bundle (`install(DIRECTORY)`) is not covered by
`--symlink-install`, so an edit to its web sources does not reach `install/`
until a rebuild. Catching that takes a bundle-freshness gate, and the gate
refuses to launch — a correct behaviour that still costs a blocked start.

`chartlite` avoids the class rather than guarding against it:

- `CMakeLists.txt` installs **only `launch/`**. The bundle is never copied.
- `chartlite.launch.py` resolves the package directory to the **source tree** and
  serves `dist/` from there.

With nothing copied into `install/`, the only remaining staleness is "you edited
`src/` and did not run `npm run build`", which is the ordinary state of any
frontend project and does not warrant a gate.

A **missing** `dist/` is different from a stale one: it is a hard error, and the
launch file exits with `run: npm run build` rather than serving a 404.

### Node

`serve.mjs` is stdlib-only (`node:http`, `node:fs`) and needs no native module,
so any Node ≥ 18 runs it. The launch file checks the version and fails with a
clear message rather than letting a syntax error surface from inside the server.

### Ports

| Port | Owner |
|---|---|
| 3000 / 3001 / 3002 | aquarium GCS frontend and gateway |
| 3200 | the fleet's V&V instrument |
| **3300** | **chartlite** |

Overridable with `port:=`. The server binds and exits on `EADDRINUSE` rather than
respawning — a process that binds a port must not be given a restart loop.

## Error handling

| Failure | Behaviour |
|---|---|
| A tile 404s or times out | MapLibre renders blank tiles. No custom handling; the chart remains usable. |
| No WebGL context | The MapLibre constructor throws. Catch it and render a plain explanatory message instead of a white page. |
| `dist/` missing at launch | Hard error naming `npm run build`. |
| Port in use | Exit non-zero with the port named. Never respawn. |

## Testing

- `test/basemap.test.ts` — the style object has both sources, both layers, the
  seamark layer above the ground layer, and a non-empty attribution on each
  source.
- `test/view.test.ts` — the default view lies inside the Strait bounds.
- `npm run build` must pass; it is the gate.

The `Chart` component is not unit-tested: it needs a GL context, and at one
component the cost of a headless-GL harness exceeds its value. It is verified by
eye. This is a deliberate, revisitable call, recorded so the gap is known rather
than assumed covered.

Note the trap: a package with no registered tests makes `colcon test` pass
vacuously because the generated CTest file is empty — a green colcon result
there is evidence of nothing.

`chartlite` must not repeat it. `CMakeLists.txt` registers `npm test` as a CTest
test under `if(BUILD_TESTING)`, so `colcon test --packages-select chartlite`
either runs the suite or fails. A vacuous pass is not an acceptable outcome for
this package.

## Out of scope, explicitly

Nothing in this build reads, writes, imports or links anything outside this package.
If a later step wants a shared module, that is a separate decision made on its
own merits, not a default.
