"""PresMaker's Insert ▾ → Try It step, in the library's editor, in Chrome.

Run: python3 tools/test_presmaker_insert.py      (needs node and Chrome)

v10 lessons write each single-step typing direction as `:::pop editor`
(shown in a pop-up in the student's editor, editor_tip.js). The library's
editor (PresMaker, made by tools/sync_presmaker.py from ~/presMaker/web)
has an Insert item for it (Nov 2026, the teacher's request): with nothing
selected it inserts a whole step — and with a real check in its tests
block, because an empty block has nothing to pass and would hold a locked
slide for good; with a selection it wraps it, as Pop box does.

v13 (Nov 2026, the teacher: "the editor popups are just not working"): for a
Python tutorial the item is a Try It step — a plain pop box and a ```tests
try block (two hints and the code), typed on the slide — and the preview
checks a Try It box with a Python of its own (try_preview.js). A web or
Flask tutorial keeps the editor pop-up: their tests don't know `try`.
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


print("PresMaker's Insert → Try It step, in a real browser")
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
    web_slug = c.post("/api/library", json={"kind": "tutorial", "title": "Web notes", "body": "# Web\n", "ide": "webide"}).get_json()["slug"]
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/teacher/tutorials/%s/edit" % slug, "web": "/teacher/tutorials/%s/edit" % web_slug,
                   "cookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "presmaker_insert_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=400)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    check("Insert ▾ has Try It step", r.get("menuItem") == "Try It step", r.get("menuItem"))
    ins = r.get("inserted") or ""
    check("a Python tutorial, nothing selected: a whole step in a plain pop box — Type this, the code, what it prints",
          ':::pop\nA sentence on what it means.\n\n✏ **Type this:**\n\n`print("hello")`\n\nIt should print `hello`.\n:::' in ins
          and ":::pop editor" not in ins, repr(ins))
    check("  then a ```tests try block with a real check, two hints and the code",
          ins.rstrip().endswith('```tests try\nprints hello\nhint: What to look at in the box above.\n'
                                'hint: Closer, but not the whole line.\ncode: print("hello")\n```'), repr(ins[-140:]))
    check("  after what was there, the explanation selected to type over",
          ins.startswith("# Notes\n\nSome words.\n\n:::pop\n") and r.get("selected") == "A sentence on what it means.",
          (repr(ins[:40]), r.get("selected")))
    check("  with a selection: the selection in a pop box, a ```tests try block after it",
          (r.get("wrapped") or "").startswith("# Notes\n\n:::pop\nType x = 1 now.\n:::\n\n```tests try\nprints hello"),
          repr(r.get("wrapped")))
    check("the preview checks a Try It box, with a Python of its own", r.get("previewButton") is True
          and r.get("previewMarks") == "✓✓", (r.get("previewButton"), r.get("previewMarks")))
    check("  and shows what it printed under the box", "hello" in (r.get("previewOut") or ""), r.get("previewOut"))
    w = r.get("web") or {}
    wi = w.get("inserted") or ""
    check("a web tutorial keeps the v12 editor pop-up (its tests don't know `try`)",
          ":::pop editor\nA sentence on what it means." in wi and wi.rstrip().endswith("```tests\nprints hello\n```")
          and w.get("wrapped") == "# Notes\n\n:::pop editor\nType x = 1 now.\n:::\n", (repr(wi[-80:]), w.get("wrapped")))
    check("  and its preview loads no Python for Try It boxes", r.get("webPreview") is False, r.get("webPreview"))
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
