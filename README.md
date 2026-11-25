# chartlite

A clean standalone chart of the Singapore Strait. One tab, one map.

```bash
npm install && npm run build   # first time only
npm run serve                  # → http://localhost:3300/
```

No ROS needed. To run it as a ROS package instead, clone this repo into a
colcon workspace's `src/`, `colcon build --packages-select chartlite`, then
`ros2 launch chartlite chartlite.launch.py`.

OpenStreetMap as the ground, the OpenSeaMap seamark overlay above it — buoyage,
lights, anchorages and the traffic separation scheme. Nothing else yet.

Joins **no DDS domain** and needs **no RTI Connext environment**. It was split
out of `usv_fleet_stack` (where it lived at `src/chartlite`) on 2026-11-25 and
shares no code, data or configuration with it.

## Why it exists

The fleet's full perception V&V instrument has grown many surfaces. They earn
their place, but it means there is no small thing left to build on — adding one
idea means landing it inside a programme spine, a rail system, a bitemporal
archive and a coverage firewall.

`chartlite` is a deliberately empty starting point that features are grown back
onto one at a time.

## Commands

```bash
npm run dev          # vite dev server with hot reload, port 3300, no ROS
npm run build        # typecheck + bundle to dist/
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run verify       # typecheck + test + build — the acceptance signal
npm run serve        # node serve.mjs, without ros2 launch

colcon build --packages-select chartlite   # once, so ros2 launch can find it
colcon test  --packages-select chartlite   # runs npm test — NOT vacuous
```

Launch arguments: `port:=3301`, `host:=127.0.0.1`.

## Layout

```
launch/chartlite.launch.py   ros2 entry; resolves to the SOURCE tree
serve.mjs                    stdlib-only static server for dist/
src/App.tsx                  one tab
src/map/Chart.tsx            the MapLibre component
src/map/basemap.ts           style definition (pure, tested)
src/map/view.ts              opening camera and chart frame (pure, tested)
```

## The one architectural rule

**`Chart` fetches nothing.** Everything it draws arrives as props from `App`.

Today that is only a camera position. When weather, coverage or tracks land they
arrive the same way and the map module does not change. A map component that
loads its own data has to be rewritten the first time the data source moves,
which is the whole reason this tool is a fresh start rather than a fork.

## Deliberately absent

No weather, no database, no operating-area polygon, no panels, no theme toggle,
no ODD arithmetic. Each is a later step.

There is **no dark theme**, and that is a decision rather than an omission: the
ground is OpenStreetMap's raster, which is light and cannot be inverted without
making the seamark overlay unreadable. A dark chrome around a light map reads as
a bug. When a keyless dark basemap exists, a theme becomes worth having.

## Two things worth knowing

**It serves the source tree, and is not relocatable.** `CMakeLists.txt` installs
`launch/` and nothing else, so no bundle is ever copied into `install/`. That is
the point: a copy-installed bundle is not covered by `--symlink-install`, so an
edit does not reach `install/` until a rebuild — and it then needs a freshness
gate that can refuse to launch. Nothing is copied here, so there is no
second copy to drift and nothing to gate. The cost is that an `install/` tree
without its source beside it cannot serve. `CHARTLITE_ROOT` overrides the
lookup if your layout breaks that assumption.

**CARTO is deliberately not used.** `basemaps.cartocdn.com` is the obvious dark
basemap and it now serves unauthenticated requests with `API KEY REQUIRED`
rendered *into* the tile image — verified 2026-08-27 by fetching one directly —
so the watermark tiles across the whole chart with no error anywhere to explain
it. `test/basemap.test.ts` pins that no keyed host returns. Any basemap added
later must be checked the same way: fetch a tile and look at it.

## Failure modes, and what each does

| Failure | Behaviour |
|---|---|
| `dist/` missing | Hard stop before anything spawns, naming `npm run build`. |
| Port already in use | Exit 1 naming the port. **No respawn** — a process that binds a port plus a restart-on-failure is an unbounded loop that reads as a hang. |
| No WebGL context | The chart renders an explanatory message, not a white page. |
| A tile 404s | MapLibre draws blank tiles; the chart stays usable. |
| `node` missing or < 18 | The launch file refuses with the version it found. |

## See also

- [The design](docs/design.md) — why this exists, and the weather-by-timestamp
  model it is built toward.
