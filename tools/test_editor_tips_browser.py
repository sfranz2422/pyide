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
os.environ["TEACHER_EMAILS"] = "teacher@example.org,webteacher@example.org,liveteacher@example.org"
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

# A coding exercise: two directions checked by ONE card, said together; then
# a challenge, never checked, said with no Check my work.
NOTES2 = """locked: yes
# Exercise

:::pop editor
✏ **Your turn:** make `fruit` hold `"pear"`.
:::

:::pop editor
✏ **Then:** make `count` hold `3`.
:::

```tests
fruit == "pear"
count == 3
```

:::pop editor
★ **Challenge** (not checked): print `fruit` three times.
:::
"""

# A web page (Web Design 1's v10 lessons, Nov 2026): the student types
# inside <body>, under the starter's comment, so the bubble goes there and
# not under </html> at the end of the file.
WEB_NOTES = """locked: yes
# Try It

A **heading** shows big.

:::pop editor
✏ **Type this:**

`<h2>Harvest</h2>`
:::

```tests
h2 contains Harvest
```
"""
WEB_PAGE = """<!DOCTYPE html>
<html>
<head>
    <title>Fair</title>
</head>
<body>
    <h1>Fall Fair</h1>

    <!-- Build your page here -->

</body>
</html>
"""

# Copy to editor (Nov 2026, the teacher's request, "especially in the web
# design class"): the Easy box's code with blanks has a button that puts it
# into the file its direction names, blanks and all. Medium's code has blanks
# too and gets one as well (the teacher, Nov 2026); Master never does.
COPY_NOTES = """# Exercise

:::level easy
✏ In `index.html`, type this and fill in every `_____`:

```html
<h2>_____</h2>
<p class="_____">Pies and cider</p>
```

✏ Then in `style.css`:

```css
h2 { color: _____; }
```

```text
Fall Fair
```
:::end

:::level medium
✏ In `index.html`:

```html
<h3>_____</h3>
```
:::end

:::level master
✏ In `index.html`, add an `<h4>` that says Harvest.

```html
<h4>_____</h4>
```
:::end

Code with blanks outside any box, in notes that aren't a quiz:

```html
<h5>_____</h5>
```
"""

# The same on the class's live page, in the student's own editor.
LIVE_COPY_NOTES = """# Exercise

:::level easy
✏ In `main.py`, type this and fill in every `_____`:

```python
snack = "_____"
print(_____)
```
:::end
"""

# A quiz (`quiz: yes`, the teacher, Nov 2026): the student is never told how
# a check or an answer went. A wrong step, checked from the bubble, says
# "Checked" and moves on — never "Not yet" or ✗; the question says it was
# saved. The teacher writing it still sees the card's ✓/✗.
QUIZ_NOTES = """quiz: yes
# Quiz

:::pop editor
✏ Make `size` hold `4`.
:::

```tests
size == 4
```

```quiz
What does len("hi") return?
- [ ] 1
- [x] 2
```

✏ Then type this into `main.py`, and fill in the `_____`:

```python
total = _____
```
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
    sid2 = add_user("s2", "kid2@example.org", "Kid Two")
    teacher = client(tid)
    made = teacher.post("/api/assignment", json={"title": "Slices", "code": "# Slices\n",
                                                 "files": {"notes.md": NOTES}})
    slug = made.get_json()["slug"]
    slug2 = teacher.post("/api/assignment", json={"title": "Exercise", "code": "# Exercise\n",
                                                  "files": {"notes.md": NOTES2}}).get_json()["slug"]
    qslug = teacher.post("/api/assignment", json={"title": "Quiz", "code": "size = 0\n",
                                                  "files": {"notes.md": QUIZ_NOTES}}).get_json()["slug"]
    # Another teacher: one teacher has one lesson on the air, and going live
    # with a web project would end the Python one above.
    wteacher_id = add_user("w", "webteacher@example.org", "Web")
    wteacher = client(wteacher_id)
    wslug = wteacher.post("/api/assignment", json={"title": "Fair", "ide": "webide", "code": "",
                                                  "files": {"index.html": WEB_PAGE, "notes.md": WEB_NOTES}}).get_json()["slug"]
    wcode = wteacher.post("/api/live/start", json={"assignment": wslug, "body": WEB_PAGE, "ide": "webide",
                                                    "filename": "index.html"}).get_json()["code"]
    wpushed = wteacher.post("/api/live/%s/push" % wcode, json={"body": WEB_PAGE, "filename": "index.html",
                                                           "notes": WEB_NOTES, "slide": "1/1", "seq": 50})
    check("a web lesson goes live too", wpushed.status_code == 200, wpushed.get_json())
    cslug = wteacher.post("/api/assignment", json={"title": "Copy", "ide": "webide", "code": "",
                                                  "files": {"index.html": WEB_PAGE, "style.css": "body { margin: 0; }\n",
                                                            "notes.md": COPY_NOTES}}).get_json()["slug"]
    sid3 = add_user("s3", "kid3@example.org", "Kid Three")
    lteacher = client(add_user("lt", "liveteacher@example.org", "Live"))
    lslug = lteacher.post("/api/assignment", json={"title": "Snack", "code": "# Snack\n",
                                                  "files": {"notes.md": LIVE_COPY_NOTES}}).get_json()["slug"]
    lcode = lteacher.post("/api/live/start", json={"assignment": lslug, "body": "# Snack\n",
                                                    "filename": "main.py"}).get_json()["code"]
    lteacher.post("/api/live/%s/push" % lcode, json={"body": "# Snack\n", "filename": "main.py",
                                                     "notes": LIVE_COPY_NOTES, "slide": "1/1", "seq": 50})
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
        json.dump({"base": base, "page": "/a/" + slug, "teacherPage": "/teacher/%s/edit" % slug, "live": "/live/" + code, "page2": "/a/" + slug2, "quiz": "/a/" + qslug, "quizTeacher": "/teacher/%s/edit" % qslug, "web": "/a/" + wslug, "webLive": "/live/" + wcode, "copy": "/a/" + cslug, "copyLive": "/live/" + lcode, "copyTeacher": "/teacher/%s/edit" % cslug, "student3": sign.dumps({"uid": sid3}), "webTeacher": sign.dumps({"uid": wteacher_id}),
                   "student": sign.dumps({"uid": sid}), "student2": sign.dumps({"uid": sid2}), "teacher": sign.dumps({"uid": tid})}, f)
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
    cb = r.get("codeBlock") or {}
    check("  the code to type is a little editor block of its own, on one line",
          cb.get("lines") == 1 and cb.get("text") == 'title = "Mohawk"' and 15 < (cb.get("height") or 0) < 45, cb)
    check("  coloured in the student's own editor theme", cb.get("coloured") is True and cb.get("same") is True, cb)
    check("  a whole line lower than the code, so the line to type on stays in sight",
          (r.get("gap") or 0) >= (r.get("lineHeight") or 99), (r.get("gap"), r.get("lineHeight")))
    check("  and its own Check my work button, which takes clicks",
          r.get("bubbleButton") is True and r.get("buttonClicks") == "auto", (r.get("bubbleButton"), r.get("buttonClicks")))
    check("  clicks go through it to the code", r.get("clicksThrough") == "none", r.get("clicksThrough"))
    check("  it sits under the last line with code on it, not after blank lines",
          r.get("underLast") is True, r.get("underLast"))
    # The reason itself is the hint card's now (hints.js): said in both places
    # it was twice the reading (the teacher, Nov 2026). test_hints_browser.py
    # checks the card says it.
    check("a wrong step, checked from the bubble, says Not yet there, and leaves why to the hint card",
          "Not yet" in (r.get("nope") or "") and "✗" not in (r.get("nope") or ""), r.get("nope"))
    check("the steps' check cards are hidden on the student's slide (the bubble checks)",
          r.get("cardsOnSlide") is False and r.get("cardsInPage") == 2, (r.get("cardsOnSlide"), r.get("cardsInPage")))
    check("  and the slide says to finish the step in the editor, not 'the check above'",
          "editor" in (r.get("holdWhy") or ""), r.get("holdWhy"))
    check("its check, run from the bubble's button, passes in the real Pyodide", r.get("firstPassed") is True, r)
    check("  and the bubble moves on to the next step",
          "print(title[2:6])" in (r.get("second") or ""), r.get("second"))
    check("  a long program scrolled to its top: the next step's bubble is scrolled into sight, whole",
          r.get("secondInView") == {"top": True, "bottom": True}, r.get("secondInView"))
    check("the last step passed: the bubble says so", r.get("allPassed") is True and "✓" in (r.get("done") or ""),
          r.get("done"))
    check("  and then goes", r.get("goneAfter") is True, r.get("goneAfter"))
    check("Check my work runs their program too: its output is on screen",
          "hawk" in (r.get("outputAfterCheck") or ""), (r.get("outputAfterCheck") or "")[-80:])
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
    check("live: Check my work runs their program too", "Mohawk" in (r.get("liveOutput") or ""),
          (r.get("liveOutput") or "")[-80:])
    check("an exercise's directions checked by one card are said together",
          "pear" in (r.get("groupTip") or "") and "count" in (r.get("groupTip") or ""), r.get("groupTip"))
    check("  and once it passes, the challenge (no check) is said with no Check my work",
          "Challenge" in (r.get("challengeTip") or "") and r.get("challengeButton") is False,
          (r.get("challengeTip"), r.get("challengeButton")))
    check("web: the bubble says the step in the student's editor", "<h2>Harvest</h2>" in (r.get("webFirst") or ""), r.get("webFirst"))
    check("  inside <body>, under the starter's comment, not under </html>",
          r.get("webUnder") == "comment", r.get("webUnder"))
    check("  and under the line they typed there, once they have",
          r.get("webKept") is True and r.get("webUnderTyped") is True, (r.get("webKept"), r.get("webUnderTyped")))
    check("  its check passes from the bubble, and their page is run", r.get("webPassed") is True and r.get("webRan") is True,
          (r.get("webPassed"), r.get("webRan")))
    cp = r.get("copy") or {}
    check("copy to editor: a button under each piece of the Easy box's code with blanks",
          cp.get("easyButtons") == 2, cp)
    check("  and Medium's, but never Master's", cp.get("mediumButtons") == 1 and cp.get("masterButtons") == 0, cp)
    check("  nor code with blanks outside a box, when the notes aren't a quiz", cp.get("allButtons") == 3, cp)
    check("  pressed: the code goes into the file the step names, inside <body>, indented, blanks and all",
          cp.get("htmlFile") == "index.html" and cp.get("htmlInBody") is True and cp.get("selected") == "_____", cp)
    check("  pressed again: not put in twice", cp.get("twice") == 1, cp)
    check("  the style.css piece goes into style.css", cp.get("cssFile") == "style.css" and cp.get("cssIn") is True, cp)
    check("  the teacher writing the notes gets no button", cp.get("teacherButtons") == 0, cp)
    check("live: the button puts the code into the student's own editor, never the teacher's mirror",
          cp.get("liveMine") is True and cp.get("liveMirror") is False, cp)
    check("web live: the bubble is in the student's own editor, never the teacher's",
          "<h2>Harvest</h2>" in (r.get("webLiveFirst") or "") and r.get("webLiveInMine") is True and r.get("webLiveInMirror") is False,
          (r.get("webLiveFirst"), r.get("webLiveInMine"), r.get("webLiveInMirror")))
    check("  and the step is hidden on the live slide", r.get("webLiveStepOnSlide") is False, r.get("webLiveStepOnSlide"))
    check("web live: its check passes from the bubble, and their page is run",
          r.get("webLivePassed") is True and r.get("webLiveRan") is True, (r.get("webLivePassed"), r.get("webLiveRan")))
    q = r.get("quizStudent") or {}
    check("quiz: a wrong step checked from the bubble says Checked — never Not yet or ✗",
          "Checked" in (q.get("tip") or "") and "Not yet" not in (q.get("tip") or "") and "✗" not in (q.get("tip") or ""), q)
    check("  its card has no ✓ or ✗, and says only that it was checked",
          q.get("marks") == "○" and "teacher will see" in (q.get("sum") or ""), q)
    check("  a right answer to a question says it was saved, not that it was right",
          "Answer saved" in (q.get("answer") or "") and "Correct" not in (q.get("answer") or ""), q.get("answer"))
    check("quiz: its coding question's code with blanks (no level box) has Copy to editor, and it works",
          q.get("copyButtons") == 1 and q.get("copied") is True, q)
    qt = r.get("quizTeacher") or {}
    check("  the teacher writing the quiz still sees the card's marks", qt.get("marks") == "✗", qt)
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
