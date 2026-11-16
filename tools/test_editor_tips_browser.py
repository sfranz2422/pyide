"""The editor's guide bubble: a `:::pop editor` step shows in the student's editor.

Run: python3 tools/test_editor_tips_browser.py      (needs node and Chrome)

v10 lessons (Nov 2026, the teacher's request) have a slide where students
type short lines into the real editor a step at a time: "✏ type
title = "Mohawk"", a check, a few words on what a slice is, "✏ type
print(title[2:6])", a check. A step written as `:::pop editor` shows on the
slide as any pop does AND in a bubble in the editor, under the student's
last line, while it's the step they're on (notes.js editorTip, app.js).
This opens a real assignment in Chrome as the student and checks that the
bubble says the first step, sits under their code, lets clicks through,
moves on to the second step when the first one's check passes, says ✓ when
the last one does and then goes; that a plain `:::pop` never reaches the
editor; and that the teacher writing the notes never gets a bubble.
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

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "tips.db")
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


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        user = accounts.User(google_sub=sub, email=email, name=name)
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


NOTES = """locked: yes
# Try It in the Editor

:::pop
Only on the slide: a plain pop.
:::

A **string** is text in quotes.

:::pop editor
✏ **Type this** into `main.py`:

`title = "Mohawk"`
:::

```tests
title == "Mohawk"
```

A **slice** takes some of the letters.

:::pop editor
✏ **Type this** under it:

`print(title[2:6])`

It should print `hawk`.
:::

```tests
prints hawk
```

---

## The end
"""

print("The editor's guide bubble, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher = client(tid)
    made = teacher.post("/api/assignment", json={"title": "Slices", "code": "# Slices\n",
                                                 "files": {"notes.md": NOTES}})
    slug = made.get_json()["slug"]
    # And live (the teacher's request: "I've been using live mode a lot"):
    # the teacher goes live on it, on the slide with the steps.
    code = teacher.post("/api/live/start", json={"assignment": slug, "body": "# Slices\n",
                                                  "filename": "main.py"}).get_json()["code"]
    pushed = teacher.post("/api/live/%s/push" % code, json={"body": "# Slices\n", "filename": "main.py",
                                                         "notes": NOTES, "slide": "1/2", "seq": 50})
    check("the teacher goes live with the notes, on the first slide", pushed.status_code == 200, pushed.get_json())
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    sign = P.app.session_interface.get_signing_serializer(P.app)
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/a/" + slug, "teacherPage": "/teacher/%s/edit" % slug, "live": "/live/" + code,
                   "student": sign.dumps({"uid": sid}), "teacher": sign.dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "editor_tips_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    check("the student's editor shows the first step in a bubble",
          'title = "Mohawk"' in (r.get("first") or ""), r.get("first"))
    check("  a plain :::pop stays on the slide only", r.get("plainPopInEditor") is False, r.get("first"))
    check("  and the step is said only there: hidden on the student's slide, the explanation kept",
          r.get("stepOnSlide") is False and r.get("explainOnSlide") is True, (r.get("stepOnSlide"), r.get("explainOnSlide")))
    check("  the code on a line of its own, kept on one line",
          r.get("codeAlone") is True and r.get("codeNowrap") == "nowrap", (r.get("codeAlone"), r.get("codeNowrap")))
    check("  with room above it: it doesn't touch the line it sits under",
          (r.get("gap") or 0) >= 10, r.get("gap"))
    check("  and its own Check my work button, which takes clicks",
          r.get("bubbleButton") is True and r.get("buttonClicks") == "auto", (r.get("bubbleButton"), r.get("buttonClicks")))
    check("  clicks go through it to the code", r.get("clicksThrough") == "none", r.get("clicksThrough"))
    check("  it sits under the last line with code on it, not after blank lines",
          r.get("underLast") is True, r.get("underLast"))
    check("a wrong step, checked from the bubble, says Not yet there, with the check's reason",
          "Not yet" in (r.get("nope") or "") and "title" in (r.get("nope") or "") and "✗" in (r.get("nope") or ""), r.get("nope"))
    check("the steps' check cards are hidden on the student's slide (the bubble checks)",
          r.get("cardsOnSlide") is False and r.get("cardsInPage") == 2, (r.get("cardsOnSlide"), r.get("cardsInPage")))
    check("  and the slide says to finish the step in the editor, not 'the check above'",
          "editor" in (r.get("holdWhy") or ""), r.get("holdWhy"))
    check("its check, run from the bubble's button, passes in the real Pyodide", r.get("firstPassed") is True, r)
    check("  and the bubble moves on to the next step",
          "print(title[2:6])" in (r.get("second") or ""), r.get("second"))
    check("the last step passed: the bubble says so", r.get("allPassed") is True and "✓" in (r.get("done") or ""),
          r.get("done"))
    check("  and then goes", r.get("goneAfter") is True, r.get("goneAfter"))
    check("the teacher writing the notes gets no bubble",
          r.get("teacherHasEditor") is True and r.get("teacherCard") is True and r.get("teacherTip") is False,
          (r.get("teacherHasEditor"), r.get("teacherCard"), r.get("teacherTip")))
    check("  and sees the step on the slide instead, with its check card",
          r.get("teacherStepOnSlide") is True and r.get("teacherCardOnSlide") is True,
          (r.get("teacherStepOnSlide"), r.get("teacherCardOnSlide")))
    check("live: the student's own editor shows the step in a bubble",
          'title = "Mohawk"' in (r.get("liveFirst") or "") and r.get("liveInMine") is True, (r.get("liveFirst"), r.get("liveInMine")))
    check("  never the teacher's code above it", r.get("liveInMirror") is False, r.get("liveInMirror"))
    check("  and the step is hidden on the live slide too", r.get("liveStepOnSlide") is False, r.get("liveStepOnSlide"))
    check("  and it moves on when that step's check passes",
          r.get("livePassed") is True and "print(title[2:6])" in (r.get("liveSecond") or ""), (r.get("livePassed"), r.get("liveSecond")))
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
