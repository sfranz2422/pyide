"""PresMaker's Insert ▾ → Editor pop-up, in the library's editor, in Chrome.

Run: python3 tools/test_presmaker_insert.py      (needs node and Chrome)

v10 lessons write each single-step typing direction as `:::pop editor`
(shown in a pop-up in the student's editor, editor_tip.js). The library's
editor (PresMaker, made by tools/sync_presmaker.py from ~/presMaker/web)
has an Insert item for it (Nov 2026, the teacher's request): with nothing
selected it inserts a whole step — and with a real check in its tests
block, because an empty block has nothing to pass and would hold a locked
slide for good; with a selection it wraps it, as Pop box does.
"""
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "pm.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-66s %s" % ("ok" if condition else "FAIL", label, detail))


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


print("PresMaker's Insert → Editor pop-up, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    db = P.SessionLocal()
    t = accounts.User(google_sub="t", email="teacher@example.org", name="Teach")
    db.add(t)
    db.commit()
    tid = t.id
    db.close()
    c = P.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = tid
    made = c.post("/api/library", json={"kind": "tutorial", "title": "Notes", "body": "# Notes\n", "ide": "pyide"})
    slug = made.get_json()["slug"]
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/teacher/tutorials/%s/edit" % slug,
                   "cookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "presmaker_insert_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=180)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    check("Insert ▾ has Editor pop-up", r.get("menuItem") == "Editor pop-up", r.get("menuItem"))
    ins = r.get("inserted") or ""
    check("with nothing selected it inserts a whole step: the box, Type this, the code on its own line",
          ":::pop editor\nA sentence on what it means.\n\n✏ **Type this:**\n\n`print(\"hello\")`\n:::" in ins, repr(ins))
    check("  then a tests block with a real check in it (an empty one would hold a locked slide)",
          ins.rstrip().endswith("```tests\nprints hello\n```"), repr(ins[-60:]))
    check("  after what was there, the explanation selected to type over",
          ins.startswith("# Notes\n\nSome words.\n\n:::pop editor") and r.get("selected") == "A sentence on what it means.",
          (repr(ins[:40]), r.get("selected")))
    check("with a selection it wraps the selection",
          r.get("wrapped") == "# Notes\n\n:::pop editor\nType x = 1 now.\n:::\n", repr(r.get("wrapped")))
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
