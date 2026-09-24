#!/usr/bin/env python3
"""Copy the `requests` wheels into PyIDE, so the browser never goes to PyPI.

    python3 tools/vendor_requests.py           # fetch and record
    python3 tools/vendor_requests.py --check   # verify, change nothing

WHY NOT micropip.install("requests") AT RUNTIME

It works — that is how this was proved possible in the first place. It is
also 445 KB per student per session, fetched from files.pythonhosted.org at
the moment a class of thirty presses Run together, which is about 13 MB of
PyPI traffic on the critical path of first period.

Worse than slow: a school network that blocks PyPI turns "import requests"
into a lesson that cannot start, and nothing on the page explains why. The
same reasoning vendored kaypy, and it applies here for the same reason.

So the five wheels live in static/py/wheels/ and micropip installs them from
this app's own domain — already cached alongside everything else on the page,
and served by the one host the lesson already depends on.

WHY THESE FIVE AND NOT JUST ONE

`requests` alone does nothing: it needs urllib3 to move bytes, certifi for
the CA bundle, idna for international hostnames, and charset-normalizer to
guess text encodings. micropip would fetch all five anyway; pinning them
means a student gets the same five every time rather than whatever PyPI
happens to resolve to that morning.

WHY THE WHEELS MUST BE PURE PYTHON

Pyodide can only load a `py3-none-any` wheel. Several of these publish
platform builds too, and `pip download` on a Mac will happily hand you a
macOS one — which vendors cleanly, passes --check, and then fails in the
browser for every student with an error about a missing module. So the
filename is checked rather than trusted, here and in --check.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHEEL_DIR = os.path.join(HERE, "static", "py", "wheels")
MANIFEST = os.path.join(HERE, "static", "py", "wheels.json")

# Pinned on purpose: these are the versions proved to work in Pyodide 314.
# A newer requests is not automatically a better one here — urllib3 is the
# piece that has to keep talking to the browser's XMLHttpRequest, and that is
# not a promise it makes to anybody.
PINNED = [
    ("requests", "2.33.1"),
    ("urllib3", "2.6.3"),
    ("certifi", "2026.4.22"),
    ("idna", "3.11"),
    ("charset-normalizer", "3.4.7"),
]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def fetch(into: str) -> list:
    """Download every pinned wheel, pure-python builds only."""
    spec = ["%s==%s" % (n, v) for n, v in PINNED]
    cmd = [sys.executable, "-m", "pip", "download",
           "--only-binary", ":all:", "--platform", "any", "--no-deps",
           "-d", into] + spec
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit("pip could not fetch the wheels:\n" + proc.stderr[-600:])

    wheels = sorted(f for f in os.listdir(into) if f.endswith(".whl"))
    bad = [w for w in wheels if not w.endswith("-none-any.whl")]
    if bad:
        sys.exit("these are not pure-python wheels and Pyodide cannot load "
                 "them:\n  " + "\n  ".join(bad))
    return wheels


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify what is committed, download nothing")
    args = ap.parse_args()

    if args.check:
        return check()

    os.makedirs(WHEEL_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wheels = fetch(tmp)
        records = []
        for name in wheels:
            src = os.path.join(tmp, name)
            shutil.copy2(src, os.path.join(WHEEL_DIR, name))
            records.append({
                "file": name,
                "sha256": sha256(src),
                "bytes": os.path.getsize(src),
            })

    # Anything left from an older pin would still be served and would still
    # be in the repo, which is how a project ends up shipping two urllib3s.
    keep = {r["file"] for r in records}
    for stale in os.listdir(WHEEL_DIR):
        if stale.endswith(".whl") and stale not in keep:
            os.remove(os.path.join(WHEEL_DIR, stale))
            print("  removed stale %s" % stale)

    with open(MANIFEST, "w") as fh:
        json.dump({"pinned": dict(PINNED), "wheels": records}, fh, indent=2)
        fh.write("\n")

    total = sum(r["bytes"] for r in records)
    for r in records:
        print("  %-46s %6d bytes" % (r["file"], r["bytes"]))
    print("  %d wheels, %.0f KB -> static/py/wheels/" % (len(records), total / 1024))


def check() -> None:
    if not os.path.isfile(MANIFEST):
        sys.exit("no wheels.json — run tools/vendor_requests.py first")
    with open(MANIFEST) as fh:
        manifest = json.load(fh)

    problems = []
    for r in manifest["wheels"]:
        path = os.path.join(WHEEL_DIR, r["file"])
        if not os.path.isfile(path):
            problems.append("missing: " + r["file"])
        elif sha256(path) != r["sha256"]:
            problems.append("changed since it was vendored: " + r["file"])
        elif not r["file"].endswith("-none-any.whl"):
            problems.append("not a pure-python wheel: " + r["file"])

    listed = {r["file"] for r in manifest["wheels"]}
    for extra in sorted(os.listdir(WHEEL_DIR)) if os.path.isdir(WHEEL_DIR) else []:
        if extra.endswith(".whl") and extra not in listed:
            problems.append("on disk but not in wheels.json: " + extra)

    if problems:
        print("the vendored wheels do not match wheels.json:\n")
        for p in problems:
            print("   ", p)
        sys.exit(1)
    print("  %d wheels, all present and unchanged" % len(manifest["wheels"]))


if __name__ == "__main__":
    main()
