#!/usr/bin/env python3
"""The A+ lab in a real Chrome (tools/lab_browser.mjs).

    python3 tools/test_lab_browser.py

machine.js has its own tests in node (test_lab_machine.py); this is
everything around it a student touches on /lab/sandbox:

  * the bench: parts tapped into place, a wrong one refused in machine.js's
    words, photos and cut-outs where they belong, a spec card with its
    credit, power connectors plugged by tapping them, and a good build
    starting Windows with the screen coming up
  * the computer: a new disk initialized and given a volume (FAT32 over 32 GB
    refused with the wizard still open), a missing network driver that a
    search online can't fix and the maker's folder can, a static address
    with the wrong gateway, a runaway process ended, a start-up app turned
    off, Event Viewer, File Explorer, a window dragged, the bench and back,
    and Shut down
  * Start in Windows: ?start=windows opens on the desktop with a PC put
    together, and the button keeps a student's own build when it starts
  * no errors in the page

Needs Chrome and node; says "skip" without Chrome rather than failing.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "lab.db")
os.environ["SECRET_KEY"] = "k" * 32

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402

# Each line lab_browser.mjs prints is a check; this many, or one went missing.
EXPECTED = 40

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-74s %s" % ("ok" if condition else "FAIL", label, detail))


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


print("The A+ lab in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here — the lab in a browser is not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    out = subprocess.run(["node", os.path.join(HERE, "lab_browser.mjs"), base, chrome, os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:240])
    check("the browser run reported every check", len(lines) == EXPECTED, (len(lines), out.stderr.strip()[-300:]))
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
