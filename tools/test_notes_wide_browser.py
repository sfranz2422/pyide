#!/usr/bin/env python3
"""Reading slides fill the screen until the warm-up (notes.js `wide`, app.js), in Chrome.

    python3 tools/test_notes_wide_browser.py
    WIDE_SHOT=/some/dir python3 tools/test_notes_wide_browser.py   # and screenshots

The teacher (Nov 2026): "make the notes take up the whole screen until the
warmup slide is reached? Just hide all the other panes and expand the slide
pane to the max. this will allow us to increase font sizes". A slide before
the first one with work in main.py (a graded tests card, or a `:::pop
editor` step) is a reading slide: the editor and output go, the notes fill
the window, bigger. A Try It typed on the slide (```tests try) is still
reading. Notes with no work slide are never wide.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "wide.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
from werkzeug.serving import make_server                     # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:400]))


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


NOTES = """# Joining strings

Read this first.

---

## Try It

:::pop
Type `print("hi")`.
:::

```tests try
prints hi
```

---

## Warm-Up

Print yo.

```tests
prints yo
```

---

## After

More reading, after the work began.
"""

PLAIN = "# Just reading\n\nOne.\n\n---\n\nTwo.\n"

chrome = find_chrome()
if not chrome or not shutil.which("node"):
    print("Chrome and node are needed.")
    sys.exit(1)

db = P.SessionLocal()
t = accounts.User(google_sub="t", email="teacher@example.org", name="Teach")
s = accounts.User(google_sub="s", email="kid@example.org", name="Kid Student")
db.add_all([t, s])
db.commit()
tid, sid = t.id, s.id
for slug, notes in (("widenotes", NOTES), ("plainnotes", PLAIN)):
    db.add(accounts.Assignment(slug=slug, app="pyide", teacher_id=tid, title=slug, code="print('start')\n",
                               files=json.dumps({"notes.md": notes})))
db.commit()
db.close()

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "page": "/a/widenotes", "plain": "/a/plainnotes",
               "student": sign.dumps({"uid": sid})}, f)
run = subprocess.run(["node", os.path.join(HERE, "notes_wide_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=300)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("Reading slides, full screen")
check("the browser run finished", not r.get("error"), r.get("error", ""))
a, b, c, d, back = (r.get(k) or {} for k in ("s1", "s2", "s3", "s4", "back"))
check("the first slide: the notes fill the window, no editor, no output",
      a.get("wide") is True and a.get("editor") is False and a.get("output") is False and a.get("notesW", 0) >= 1250, a)
check("  bigger text", a.get("font", 0) >= 20, a.get("font"))
check("  and no Hide (it would leave nothing on screen)", a.get("hide") is False, a)
check("a Try It typed on the slide is still reading: wide", b.get("wide") is True, b)
check("the warm-up: editor and output back, the notes beside them",
      c.get("wide") is False and c.get("editor") is True and c.get("output") is True and c.get("notesW", 9999) < 900, c)
check("  the editor redrawn: code changed while it was hidden is drawn, every line", c.get("lines", 0) >= 12, c.get("lines"))
check("  the normal size again", 0 < c.get("font", 0) < 18, c.get("font"))
check("a slide after the work began stays beside the editor", d.get("wide") is False, d)
check("back to the first slide: wide again", back.get("wide") is True, back)
check("notes with no work in main.py are never wide (the editor would never show)",
      (r.get("plain") or {}).get("wide") is False and (r.get("plain") or {}).get("editor") is True, r.get("plain"))

server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
failed = results.count(False)
print("\n%s (%d checks, %d failed)" % ("ALL PASSED" if not failed else "SOME FAILED", len(results), failed))
sys.exit(1 if failed else 0)
