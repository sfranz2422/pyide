#!/usr/bin/env python3
"""Bundles PyIDE's mcpi package (static/py/mcpi/) for the browser.

    python3 tools/build_mcpi.py

Writes static/py/mcpi_bundle.json — {path inside the package: its text}, the
same shape as kaypy's bundle — which world.js writes into Pyodide's files
(/lib/mcpi) before a world program runs: one fetch rather than one per file.

Run it after changing anything in static/py/mcpi/. The bundle is what the
browser and the tests load, not the .py files, so a change that isn't
bundled doesn't exist there — tools/test_world_python.py fails when the two
differ.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACKAGE = os.path.join(ROOT, "static", "py", "mcpi")
BUNDLE = os.path.join(ROOT, "static", "py", "mcpi_bundle.json")


def bundle():
    """The package as {relative path: text}, sorted, so the file only changes when the code does."""
    out = {}
    for name in sorted(os.listdir(PACKAGE)):
        if name.endswith(".py"):
            with open(os.path.join(PACKAGE, name), encoding="utf-8") as f:
                out[name] = f.read()
    return out


def main():
    files = bundle()
    with open(BUNDLE, "w", encoding="utf-8") as f:
        json.dump(files, f, sort_keys=True)
        f.write("\n")
    print("mcpi: %d files -> static/py/mcpi_bundle.json (%.0f KB)"
          % (len(files), os.path.getsize(BUNDLE) / 1024))


if __name__ == "__main__":
    main()
