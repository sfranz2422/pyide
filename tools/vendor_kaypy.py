"""Copy the kaypy engine into PyIDE, so the browser never goes to PyPI.

    python3 tools/vendor_kaypy.py --from ~/kaypy

WHY NOT micropip.install("kaypy") AT RUNTIME

Because a class starts all at once. Measured against the real 0.1.1 wheel:

    the wheel from PyPI                     1.36 MB   per student, per session
    of which is engine code                   92 KB
    of which is starter/sounds/background.wav  2.4 MB uncompressed

Twenty students at 8:05 would pull about 27 MB from PyPI, and almost all of it
is a sound file the browser never opens, because PyIDE serves its own assets.
Worse, "only install if there's a newer version" is not a thing micropip can
do: finding out what the newest version *is* means asking PyPI, which is the
expensive half. That puts PyPI on the critical path of first period.

So the engine is copied here instead — 92 KB, served from PyIDE's own domain,
cached alongside everything else on the page, and written straight into
Pyodide's filesystem with nothing to install. Checking for a new release moves
to the server, once a day, on the teacher dashboard (see app.py).

WHAT IS AND IS NOT COPIED

Only `kaypy/`, and not `kaypy/starter/` — those are the assets `kaypy new`
hands a desktop user, and PyIDE has its own sprite packs in static/assets. No
`__pycache__`, no `.pyc`.

VENDORING FROM THE WORKING COPY, NOT FROM PyPI

Deliberate: it means PyIDE can run an unreleased kaypy. Fix something in
~/kaypy, run this, press Run in the browser — before publishing anything. The
version recorded below is whatever pyproject.toml says, so a working copy ahead
of PyPI simply reads as ahead.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
DEST = os.path.join(PYIDE, "static", "py", "kaypy")
STAMP = os.path.join(PYIDE, "static", "py", "kaypy.json")
BUNDLE = os.path.join(PYIDE, "static", "py", "kaypy_bundle.json")

SKIP_DIRS = {"__pycache__", "starter"}


def read_version(root):
    """The version in pyproject.toml, without importing anything."""
    path = os.path.join(root, "pyproject.toml")
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        return None
    m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.M)
    return m.group(1) if m else None


def read_commit(root):
    """The commit this came from, so a bug can be traced to a source tree."""
    try:
        out = subprocess.run(["git", "-C", root, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            dirty = subprocess.run(["git", "-C", root, "status", "--porcelain"],
                                   capture_output=True, text=True, timeout=5)
            return out.stdout.strip() + ("+dirty" if dirty.stdout.strip() else "")
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def copy_engine(src_pkg, dest):
    """Copy the package, leaving out what the browser has no use for."""
    if os.path.isdir(dest):
        shutil.rmtree(dest)

    copied = []
    for base, dirs, files in os.walk(src_pkg):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(base, src_pkg)
        out_dir = dest if rel == "." else os.path.join(dest, rel)
        os.makedirs(out_dir, exist_ok=True)
        for name in sorted(files):
            if name.endswith((".pyc", ".pyo")):
                continue
            # copyfile, not copy2: a read-only source file would otherwise
            # arrive read-only and the next vendor run could not replace it.
            shutil.copyfile(os.path.join(base, name),
                            os.path.join(out_dir, name))
            copied.append(os.path.join(rel, name) if rel != "." else name)
    return copied


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from", dest="src", default=os.path.expanduser("~/kaypy"),
                    help="the kaypy working copy (default: ~/kaypy)")
    args = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(args.src))
    src_pkg = os.path.join(src, "kaypy")
    if not os.path.isdir(src_pkg):
        sys.exit("No kaypy/ package under %s — is that the kaypy repo?" % src)

    version = read_version(src)
    if version is None:
        sys.exit("Could not read a version out of %s/pyproject.toml" % src)

    files = copy_engine(src_pkg, DEST)
    total = sum(os.path.getsize(os.path.join(DEST, f)) for f in files)

    # One file instead of twenty-eight. The browser writes the whole package
    # into Pyodide's filesystem before a game runs, and twenty students all
    # fetching twenty-eight files at 8:05 is twenty-eight times the round
    # trips for no reason. The bundle is ~120 KB of JSON and caches like any
    # other static asset.
    bundle = {}
    for rel in files:
        with open(os.path.join(DEST, rel)) as fh:
            bundle[rel.replace(os.sep, "/")] = fh.read()
    with open(BUNDLE, "w") as f:
        json.dump(bundle, f)
        f.write("\n")

    stamp = {
        "version": version,
        "commit": read_commit(src),
        "source": src,
        "vendored_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": len(files),
        "bytes": total,
    }
    with open(STAMP, "w") as f:
        json.dump(stamp, f, indent=1)
        f.write("\n")

    print("kaypy %s%s -> static/py/kaypy/"
          % (version, " (" + stamp["commit"] + ")" if stamp["commit"] else ""))
    print("  %d files, %.0f KB" % (len(files), total / 1024))
    print("  bundled for the browser: static/py/kaypy_bundle.json (%.0f KB)"
          % (os.path.getsize(BUNDLE) / 1024))
    print("  starter assets left behind on purpose; PyIDE serves its own")

    missing = [n for n in ("__init__.py", "engine.py") if n not in files]
    if missing:
        print("\nWARNING: expected %s and did not copy it"
              % ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
