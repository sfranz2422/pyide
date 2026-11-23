#!/usr/bin/env python3
"""A Try It step typed on the slide (```tests try), in Chrome, real Python.

    python3 tools/test_try_slide_browser.py
    TRY_SHOT=/some/dir python3 tools/test_try_slide_browser.py   # and screenshots

The teacher (Nov 2026): "the editor popups are just not working but i like
the teaching that the try it slides do". A ```tests try block is a box to
type into under the step, with its own card checking THAT box (not
main.py), the hint card, the step's output under the box, the next box
starting from the code so far, paste refused, and nothing graded. The
server side (never graded, hints free) is in test_hints.py and
test_autograde.py.
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
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "tryslide.db")
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


# No slides, so every card is in the page at once: the plain card's own
# "Uses +" must not be marked by a Try It check.
NOTES = """# Try it

:::pop
`+` glues two strings together.

`print("hay" + "ride")`

It should print `hayride`.
:::

```tests try
prints hayride
hint: Type it exactly as it is in the box.
hint: Both words need their own quotes, with + between them.
code: print("hay" + "ride")
uses +
hint: Put a + between "hay" and "ride".
```

:::pop
`crop = "pump" + "kin"`, then `print(crop)`.
:::

```tests try
prints pumpkin
crop is made with +
```

```tests try
prints pumpkinseed
```

The exercise.

```tests
uses +
prints soup
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
a = accounts.Assignment(slug="tryslide", app="pyide", teacher_id=tid, title="Try slide",
                        code="", files=json.dumps({"notes.md": NOTES}))
db.add(a)
db.commit()
aid = a.id
# v14: each Try It step on a slide of its own.
V14 = """# Try It (1 of 3)

```tests try
prints hayride
```

---

# Try It (2 of 3)

```tests try
prints pumpkin
```

---

# Try It (3 of 3)

```tests try
prints pumpkinseed
```
"""
db.add(accounts.Assignment(slug="tryv14", app="pyide", teacher_id=tid, title="v14", code="",
                           files=json.dumps({"notes.md": V14})))
db.commit()
db.close()

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "page": "/a/tryslide", "v14": "/a/tryv14",
               "student": sign.dumps({"uid": sid})}, f)
run = subprocess.run(["node", os.path.join(HERE, "try_slide_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=600)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("Try It on the slide")
check("the browser run finished", not r.get("error"), r.get("error", ""))
check("each ```tests try is a box to type in, with its own Check my work",
      r.get("boxes") == 3 and r.get("cards") == 3, (r.get("boxes"), r.get("cards")))
check("  and no pop-up in the editor", r.get("noBubble") is True)
check("  'It should print' in the step's box stands out (bigger)", r.get("expectBig") is True)
check("  paste into the box is refused", r.get("pasteRefused") is True)
check("wrong (glued without +): the step's own card fails on Uses +, passes the output",
      r.get("wrongMarks") == ["✓", "✗"], r.get("wrongMarks"))
wc = r.get("wrongCard") or {}
check("  the hint card comes up, saying just Hint", (wc.get("title") or "").startswith("✗ Not yet")
      and wc.get("button") == "💡 Hint", wc)
check("  and the box's program ran: its output under the box",
      "hayride" in (r.get("wrongOutput") or "") and "Output" in (r.get("wrongOutput") or ""), r.get("wrongOutput"))
h1 = r.get("hint1") or {}
check("  a hint opens, and nothing on the card can be selected or copied",
      h1.get("hints") == ['💡 Put a + between "hay" and "ride".'] and h1.get("select") == "none"
      and r.get("copyRefused") is True, (h1, r.get("copyRefused")))
check("  the exercise's own Uses + (another card) isn't marked by it", r.get("mainCardUntouched") is True)
check("right: every line passes and the card is passed (it holds a locked slide till then)",
      r.get("rightMarks") == ["✓", "✓"] and r.get("passed") is True, (r.get("rightMarks"), r.get("passed")))
rc = r.get("rightCard") or {}
check("  ✓ Great Job!", rc.get("pass") is True and rc.get("title") == "✓ Great Job!", rc)
check("  its output under the box", "hayride" in (r.get("rightOutput") or ""), r.get("rightOutput"))
check("the next box starts with the code so far, to type under",
      r.get("prefill") == 'print("hay" + "ride")\n', r.get("prefill"))
check("  and is checked on its own code: crop made with +",
      r.get("secondMarks") == ["✓", "✓"], r.get("secondMarks"))
check("  its output: the whole box's program", "hayride\npumpkin" in (r.get("secondOutput") or ""), r.get("secondOutput"))
check("  the exercise's card still untouched", r.get("mainStillUntouched") is True)
check("a reload keeps what was typed", "crop = " in (r.get("kept") or ""), r.get("kept"))
check("a box first on its slide starts from the box last typed in (a Try It split over slides)",
      (r.get("nextSlide") or "").endswith('print(crop)\n') and "hay" in (r.get("nextSlide") or ""), r.get("nextSlide"))

v = r.get("v14") or {}
check("v14, a step on its own slide: its box starts with the step before's code, from the slide before",
      v.get("second") == 'print("hay" + "ride")\n', v.get("second"))
check("  and in the notes' order: the step before's, not the box last typed in (they went back to step 1)",
      (v.get("third") or "").startswith('print("hay" + "ride")\ncrop = "pump"') and "BACK" not in (v.get("third") or ""), v.get("third"))

db = P.SessionLocal()
kept = db.query(accounts.TestResult).filter_by(assignment_id=aid).count()
db.close()
check("practice: nothing posted for the teacher or the grade", kept == 0, kept)

server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
failed = results.count(False)
print("\n%s (%d checks, %d failed)" % ("ALL PASSED" if not failed else "SOME FAILED", len(results), failed))
sys.exit(1 if failed else 0)
