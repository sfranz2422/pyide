#!/usr/bin/env python3
"""The hint panel in a student's own editor, in Chrome (hints.js).

    python3 tools/test_hints_browser.py
    HINTS_SHOT=/some/dir python3 tools/test_hints_browser.py   # and screenshots

A failed check brings up the panel over the editor — the test, why, and
💡 Hint (free); the second hint asks to be pressed again before it costs
anything; then the code; closing it lasts until the next check; a fixed test
says so; a reload shows what was paid for again, free; a quiz shows nothing.
The page's runner is replaced with set results (hints_browser.mjs), so no
Python loads. The server side is test_hints.py.
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
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "hintsb.db")
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


NOTES = """# Say hello

Write the line.

```tests
prints Hello
hint: Use print() with the words inside quotes.
hint: It's one line: print, brackets, then "Hello" in quotes.
code: print("Hello")
uses for
```
"""

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
slugs = {}
for key, notes in (("page", NOTES), ("quiz", "quiz: yes\n" + NOTES)):
    a = accounts.Assignment(slug="hint" + key[:4], app="pyide", teacher_id=tid, title="Hello " + key,
                            code="# hello\n", files=json.dumps({"notes.md": notes}))
    db.add(a)
    db.commit()
    slugs[key] = a.slug
db.close()

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "page": "/a/" + slugs["page"],
               "quiz": "/a/" + slugs["quiz"], "slug": slugs["page"], "student": sign.dumps({"uid": sid})}, f)
run = subprocess.run(["node", os.path.join(HERE, "hints_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=300)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("The hint panel")
check("the browser run finished", not r.get("error"), r.get("error", ""))
check("nothing before a check", r.get("before") is True, r.get("before"))
f = r.get("failed") or {}
check("a failed check: the panel, over the editor — the test, why, and a free hint",
      f.get("inEditor") and f.get("title") == "✗ Not yet: Prints Hello" and f.get("why") == "It printed: Hi"
      and f.get("button") == "💡 Hint (free)", f)
h1 = r.get("hint1") or {}
check("Hint: the first hint, and the second offered with its cost",
      h1.get("hints") == ["💡 Use print() with the words inside quotes."]
      and h1.get("button") == "💡 Another hint · costs a quarter of this test's points", h1)
a = r.get("armed") or {}
check("pressed once, the paid hint only asks to be pressed again — nothing spent",
      a.get("button") == "Press again to spend a quarter of this test's points" and len(a.get("hints") or []) == 1
      and r.get("armedRecorded") == [1], (a, r.get("armedRecorded")))
h2 = r.get("hint2") or {}
check("pressed again: the second hint, and then the code offered at its cost",
      len(h2.get("hints") or []) == 2 and h2.get("button") == "👀 Show me the code · costs half of this test's points", h2)
c = r.get("code") or {}
check("the code, after its own second press", c.get("code") == 'print("Hello")' and not c.get("button"), c)
db = P.SessionLocal()
taken = sorted(lv for (lv,) in db.query(P.HintTaken.level).filter_by(student_id=sid))
db.close()
check("…and the server recorded each, once", taken == [1, 2, 3], taken)
check("✕ hides it", r.get("closed") is True)
check("the next failed check brings it back, with what was opened", len((r.get("back") or {}).get("hints") or []) == 2
      and (r.get("back") or {}).get("code") == 'print("Hello")', r.get("back"))
p = r.get("passed") or {}
check("fixed: it says that one passes now", p.get("pass") and "passes now" in (p.get("title") or ""), p)
rl = r.get("reloaded") or {}
check("after a reload, what was paid for is shown again on the next failed check",
      len(rl.get("hints") or []) == 2 and rl.get("code") == 'print("Hello")', rl)
db = P.SessionLocal()
again = db.query(P.HintTaken).filter_by(student_id=sid).count()
db.close()
check("…without being charged again", again == 3, again)
check("a quiz: no panel at all", r.get("quiz") is True, r.get("quiz"))

print()
failed = results.count(False)
print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if failed else 0)
