#!/usr/bin/env python3
"""The hint panel in a student's own editor, in Chrome (hints.js).

    python3 tools/test_hints_browser.py
    HINTS_SHOT=/some/dir python3 tools/test_hints_browser.py   # and screenshots

A failed check brings up the panel over the editor — the test, why, and
💡 Hint; one press each, the buttons naming no cost
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

# A Try It slide: two steps, each a `:::pop editor` box and its card.
TRY = """# Try it

:::pop editor
Type `print("Hey")`.
:::

```tests
prints Hey
hint: Type what's in the box.
```

:::pop editor
Type `print("Pumpkin")`.
:::

```tests
prints Pumpkin
hint: Pumpkin, in quotes.
hint: print, brackets, "Pumpkin".
code: print("Pumpkin")
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
slugs, ids = {}, {}
for key, notes in (("page", NOTES), ("quiz", "quiz: yes\n" + NOTES), ("try", TRY)):
    a = accounts.Assignment(slug="hint" + key[:4], app="pyide", teacher_id=tid, title="Hello " + key,
                            code="# hello\n", files=json.dumps({"notes.md": notes}))
    db.add(a)
    db.commit()
    slugs[key] = a.slug
    ids[key] = a.id
db.close()

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "page": "/a/" + slugs["page"],
               "quiz": "/a/" + slugs["quiz"], "tryit": "/a/" + slugs["try"], "slug": slugs["page"], "student": sign.dumps({"uid": sid})}, f)
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
check("a failed check: a big card in the middle of the screen, the page dimmed behind it",
      f.get("centered") is True and f.get("dimmed") is True, f)
check("  in a student's words: what it should do, what it did, and a free hint",
      f.get("title") == "✗ Not yet: It should print Hello" and f.get("why") == "Your program printed: Hi"
      and f.get("button") == "💡 Hint", f)
w = r.get("words") or []
check("  a NameError says the word needs quotes; a syntax error gets the Run button's plain words",
      len(w) == 5 and "Python doesn't know hay" in w[0] and 'quotes: "hay"' in w[0]
      and "NameError" not in w[0] and "invalid syntax" not in w[1] and w[1], w)
check("  nothing printed, the checker's own input list gone, and 'is made with' said plainly",
      w[2:] == ["Your program didn't print anything.", "It should print hayride",
                "The line that makes crop should use +"], w)
h1 = r.get("hint1") or {}
check("Hint: the first hint, and the second offered, the button saying nothing of cost",
      h1.get("hints") == ["💡 Use print() with the words inside quotes."]
      and h1.get("button") == "💡 Another hint", h1)
h2 = r.get("hint2") or {}
check("one press opens the paid hint (twice looked broken), only it on the card, then the code offered",
      (h2.get("hints") or [None])[0] != "💡 Use print() with the words inside quotes." and len(h2.get("hints") or []) == 1
      and h2.get("button") == "👀 Show me the code"
      and r.get("hint2Recorded") == [1, 2], (h2, r.get("hint2Recorded")))
c = r.get("code") or {}
check("the code alone, after one press (the hints above it gone) — and then it says that was every hint, not a dead end",
      c.get("code") == 'print("Hello")' and c.get("hints") == [] and c.get("button") == ""
      and c.get("end") == "That's every hint for this one.", c)
db = P.SessionLocal()
taken = sorted(lv for (lv,) in db.query(P.HintTaken.level).filter_by(student_id=sid, assignment_id=ids["page"]))
db.close()
check("…and the server recorded each, once", taken == [1, 2, 3], taken)
check("✕ hides it", r.get("closed") is True)
check("the next failed check brings it back, with the newest opened: the code", (r.get("back") or {}).get("hints") == []
      and (r.get("back") or {}).get("code") == 'print("Hello")', r.get("back"))
p = r.get("passed") or {}
check("fixed: the pass card, with what passes", p.get("pass") and p.get("title") == "✓ Great Job!"
      and p.get("button") == "" and "✓ It should print Hello" in (p.get("why") or ""), p)
check("a program asking for input after the check: the card waits until it's done",
      r.get("heldWhileRunning") is True and ((r.get("afterRun") or {}).get("title") or "").startswith("✗ Not yet"),
      (r.get("heldWhileRunning"), r.get("afterRun")))
fs_ = r.get("firstStep") or {}
check("a Try It slide: passing step 1 says it passes — not that step 2 (not typed yet) fails",
      fs_.get("pass") is True and "Hey" in (fs_.get("why") or ""), fs_)
t1, t2 = r.get("tryHint1") or {}, r.get("tryHint2") or {}
check("a Try It step's hints: one press each, no \"(free)\" on the buttons, the code too",
      t1.get("button") == "💡 Another hint" and len(t2.get("hints") or []) == 1
      and t2.get("button") == "👀 Show me the code", (t1, t2))
rl = r.get("reloaded") or {}
check("after a reload, what was paid for is shown again on the next failed check",
      rl.get("hints") == [] and rl.get("code") == 'print("Hello")', rl)
db = P.SessionLocal()
again = db.query(P.HintTaken).filter_by(student_id=sid, assignment_id=ids["page"]).count()
db.close()
check("…without being charged again", again == 3, again)
check("a wrong prediction's card shows only the newest hint",
      (r.get("predictHints") or {}).get("hints") == ["💡 second nudge"], r.get("predictHints"))
check("a quiz: no panel at all", r.get("quiz") is True, r.get("quiz"))

print()
failed = results.count(False)
print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if failed else 0)
