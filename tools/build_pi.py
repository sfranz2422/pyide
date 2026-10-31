#!/usr/bin/env python3
"""Bundles PyIDE's simulated-Raspberry-Pi packages (static/py/pi/) for the
browser.

    python3 tools/build_pi.py

Writes static/py/pi_bundle.json — {path under static/py/pi/: its text} —
which pi.js writes into Pyodide's files under /lib before a Pi program runs
(gpiozero, sense_hat, sense_emu, picamera, and _pyide_pi, which takes the
turns): one fetch rather than one per file, as build_mcpi.py does for mcpi.

Run it after changing anything in static/py/pi/. The bundle is what the
browser and the tests load, not the .py files, so a change that isn't
bundled doesn't exist there — tools/test_pi_python.py fails when the two
differ.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACKAGE = os.path.join(ROOT, "static", "py", "pi")
BUNDLE = os.path.join(ROOT, "static", "py", "pi_bundle.json")


def bundle():
    files = {}
    for dirpath, dirnames, filenames in os.walk(PACKAGE):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(filenames):
            if name.endswith(".py"):
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, PACKAGE).replace(os.sep, "/")
                with open(path, encoding="utf-8") as f:
                    files[rel] = f.read()
    return dict(sorted(files.items()))


def main():
    files = bundle()
    with open(BUNDLE, "w", encoding="utf-8") as f:
        json.dump(files, f, indent=0, sort_keys=True)
        f.write("\n")
    print("wrote %s (%d files)" % (os.path.relpath(BUNDLE, ROOT), len(files)))


if __name__ == "__main__":
    main()
