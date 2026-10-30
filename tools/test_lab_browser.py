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
  * a ticket (/lab/try/…): its story and tasks, a hint, fixed on the bench
    and ticked, kept over a reload; one that starts in Windows fixed from the
    Command Prompt; Start over
  * a class lab: the teacher assigns a ticket from the tickets page, the
    student fixes it on their page, it saves and is turned in, and a reload
    with this browser's storage cleared brings it back from the server —
    and the .py finds it marked there
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
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import json                                                  # noqa: E402

# Each line lab_browser.mjs prints is a check; this many, or one went missing.
EXPECTED = 54

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
    # A class, with a teacher to assign a lab and a student to do it.
    db = P.SessionLocal()
    t = accounts.User(google_sub="t", email="teacher@example.org", name="Teach")
    s = accounts.User(google_sub="s", email="kid@example.org", name="Kid")
    db.add_all([t, s])
    db.commit()
    tid, sid = t.id, s.id
    db.close()
    tc = P.app.test_client()
    with tc.session_transaction() as sess:
        sess["uid"] = tid
    cls = tc.post("/api/class", json={"name": "A+ P3"}).get_json()["id"]
    db = P.SessionLocal()
    db.add(accounts.Enrollment(class_id=cls, email="kid@example.org", name="Kid"))
    db.commit()
    db.close()
    cookie = P.app.session_interface.get_signing_serializer(P.app).dumps
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"cls": cls, "teacher": cookie({"uid": tid}), "student": cookie({"uid": sid})}, f)

    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    out = subprocess.run(["node", os.path.join(HERE, "lab_browser.mjs"), base, chrome, os.path.join(TMP, "chrome"), setup],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:240])
    check("the browser run reported every check", len(lines) == EXPECTED, (len(lines), out.stderr.strip()[-300:]))
    # What the student's page saved, as the server marked it.
    db = P.SessionLocal()
    try:
        lab = db.query(accounts.Assignment).filter_by(kind="lab").first()
        row = db.query(accounts.TestResult).filter_by(assignment_id=lab.id, student_id=sid, kind="verified").first() if lab else None
    finally:
        db.close()
    check("the student's fix reached the server, marked 6 of 6 there", row is not None and row.earned == 6 and row.possible == 6,
          row and (row.earned, row.possible))
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
