"""Serve the chartlite strait chart.

    ros2 launch chartlite chartlite.launch.py
    ros2 launch chartlite chartlite.launch.py port:=3301

**This joins NO DDS domain.** Every other launch file in this repo needs the
RTI Connext environment sourced first; this one does not, and saying so matters
— a reader who sources it out of habit should know it was unnecessary rather
than conclude it was required. The fleet stack can be entirely down.

**It serves the SOURCE tree, not install/.** `CMakeLists.txt` installs `launch/`
and nothing else, so there is no copied bundle that can go stale behind an edit
— the failure mode that makes dataviz carry a freshness gate that can refuse to
start. The cost is that this package is not relocatable: an `install/` tree
without its source beside it cannot serve, and `_source_dir()` below says so
plainly when it cannot find the source.

**A missing bundle is a hard stop**, not a wall of 404s: the one useful thing to
say is "run npm run build", and this says it before anything spawns.

**No respawn.** The server binds a port and exits on EADDRINUSE; respawning that
is an unbounded restart loop that reads as a hang.
"""

import os
import shutil
import subprocess
from pathlib import Path

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, OpaqueFunction
from launch.substitutions import LaunchConfiguration

#: Clear of the aquarium GCS (3000 frontend, 3001/3002 gateway) and dataviz (3200).
DEFAULT_PORT = '3300'

#: serve.mjs is stdlib-only, so this is the floor for the syntax it uses, not
#: for any native module. node:sqlite is NOT used here — there is no archive.
MIN_NODE_MAJOR = 18


def _source_dir() -> Path:
    """This package's SOURCE root — never the installed copy.

    Walks up from wherever this file was loaded until it finds a tree holding
    ``src/chartlite/package.json``. That works both when run straight out of
    the source tree and when run from ``install/<pkg>/share/chartlite/launch``,
    because the install tree sits beside ``src/`` in a colcon workspace.

    ``CHARTLITE_ROOT`` overrides it, for the layouts that assumption does not
    survive.
    """
    override = os.environ.get('CHARTLITE_ROOT')
    if override:
        return Path(override).expanduser().resolve()

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / 'src' / 'chartlite' / 'package.json'
        if candidate.is_file():
            return candidate.parent

    raise RuntimeError(
        'chartlite: cannot find the source tree from '
        f'{here}. This package serves its bundle from source and is not '
        'relocatable; set CHARTLITE_ROOT to src/chartlite.'
    )


def _node_binary() -> str:
    """A node on PATH, new enough to run serve.mjs."""
    node = shutil.which('node')
    if node is None:
        raise RuntimeError(
            f'chartlite: no `node` on PATH. Node >= {MIN_NODE_MAJOR} is required.'
        )

    out = subprocess.run(
        [node, '--version'], capture_output=True, text=True, check=False,
    ).stdout.strip()
    try:
        major = int(out.lstrip('v').split('.')[0])
    except (ValueError, IndexError):
        raise RuntimeError(
            f'chartlite: could not read a version out of `node --version` ({out!r}).'
        ) from None

    if major < MIN_NODE_MAJOR:
        raise RuntimeError(
            f'chartlite: node {out} is too old; >= {MIN_NODE_MAJOR} is required.'
        )
    return node


def _launch_setup(context, *_args, **_kwargs):
    root = _source_dir()
    node = _node_binary()
    port = LaunchConfiguration('port').perform(context)
    host = LaunchConfiguration('host').perform(context)

    bundle = root / 'dist' / 'index.html'
    if not bundle.is_file():
        raise RuntimeError(
            f'chartlite: no bundle at {root / "dist"}.\n'
            f'           run: cd {root} && npm install && npm run build'
        )

    return [
        ExecuteProcess(
            cmd=[node, str(root / 'serve.mjs'), '--port', port, '--host', host],
            cwd=str(root),
            output='screen',
            # No `respawn`: see the module docstring.
        ),
    ]


def generate_launch_description() -> LaunchDescription:
    return LaunchDescription([
        DeclareLaunchArgument(
            'port', default_value=DEFAULT_PORT,
            description='HTTP port for the chart (default 3300).',
        ),
        DeclareLaunchArgument(
            'host', default_value='0.0.0.0',
            description='Interface to bind. 127.0.0.1 to keep it local.',
        ),
        OpaqueFunction(function=_launch_setup),
    ])
