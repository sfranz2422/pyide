"""Teaching live: the mirror, and everything that could quietly ruin a lesson.

    python3 tools/test_live.py

A live lesson is thirty people watching one row in a table. Almost everything
that can go wrong with it goes wrong SILENTLY — the page still renders, the
button still says Live, and the only symptom is a class looking at a line
their teacher fixed two minutes ago. So each of those is a check here.

WHAT IS ACTUALLY BEING GUARDED

  A student's own work is never touched.
      The page has two editors. If anything arriving from the network could
      reach the lower one, a class would lose a paragraph of their own typing
      the moment the teacher pressed a key, and nobody would use this twice.
      Checked by reading live.js: the mirror is the only editor given a value.

  A push that arrives late cannot win.
      The teacher's browser sends every 400ms. On school wifi two of those
      can overtake each other, and without a guard the OLDER text lands with
      the NEWER version number — after which nothing corrects it until the
      next keystroke. The write is conditional on a stamp that only goes up.

  A student who joins late is not left behind.
      No catch-up path, no replay: the first poll carries the whole file.

  Nothing lives in memory.
      Every one of these apps runs `gunicorn --workers 2`. A dict in a module
      is visible to one worker and invisible to the other, and which one a
      student reaches changes from poll to poll. It would pass every test on
      a laptop running a single worker and fail in front of a class.

  Only the host can type into the lesson.
      Checked against the row, not against the teacher list — a second
      teacher must not be able to write into somebody else's lesson.
"""
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

DB = os.path.join(tempfile.mkdtemp(), "live.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@example.org, other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-58s %s" % ("ok" if condition else "FAIL", label, detail))


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


def row(code):
    db = P.SessionLocal()
    try:
        return db.query(accounts.LiveSession).filter_by(code=code).first()
    finally:
        db.close()


TEACHER = add_user("t1", "teacher@example.org", "Mr Franz")
OTHER = add_user("t2", "other@example.org", "Another Teacher")
STUDENT = add_user("s1", "kid@example.org", "A Student")
STUDENT2 = add_user("s2", "kid2@example.org", "Another Student")

teacher = client(TEACHER)
other = client(OTHER)
student = client(STUDENT)
stranger = client()                      # signed out, like most of a class


# ---------------------------------------------------------------- starting
print("\nStarting a lesson")

r = student.post("/api/live/start", json={"body": "print(1)"})
check("a student cannot start one", r.status_code == 403, r.status_code)

r = stranger.post("/api/live/start", json={"body": "print(1)"})
check("nor can somebody signed out", r.status_code == 403, r.status_code)

r = teacher.post("/api/live/start",
                 json={"body": "print('hello')", "filename": "main.py",
                       "title": "Loops"})
check("a teacher can", r.status_code == 200, r.status_code)
CODE = r.get_json()["code"]
check("  and gets a code to read out", bool(CODE), CODE)
check("  with no look-alike characters in it",
      not set(CODE) & set("01lioIO"), CODE)

again = teacher.post("/api/live/start", json={"body": "print(2)"}).get_json()
check("pressing Go live again reuses the same lesson",
      again["code"] == CODE,
      "a second code would leave half the class on the wrong one")


# ------------------------------------------------------------------ pushing
print("\nPushing what the teacher types")

r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "line one", "seq": 1000, "filename": "main.py"})
check("the host can push", r.status_code == 200 and not r.get_json().get("stale"),
      r.status_code)
check("  and the row holds it", row(CODE).body == "line one")
check("  at the version they sent", row(CODE).version == 1000)

r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "line one, fixed", "seq": 1001})
check("a newer push replaces it", row(CODE).body == "line one, fixed")

# THE ONE THAT MATTERS. A push that was sent earlier but arrived later.
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "line one", "seq": 1000})
check("a push that arrives late is refused",
      r.get_json().get("stale") is True, r.get_json())
check("  and the newer text is still what the class sees",
      row(CODE).body == "line one, fixed",
      "stale text on the board is invisible to the teacher")
check("  and the version did not go backwards", row(CODE).version == 1001)

r = other.post("/api/live/%s/push" % CODE, json={"body": "hijacked", "seq": 9999})
check("another teacher cannot push into this lesson", r.status_code == 403,
      r.status_code)
check("  and did not change it", row(CODE).body == "line one, fixed")

r = student.post("/api/live/%s/push" % CODE, json={"body": "hijacked", "seq": 9999})
check("nor can a student", r.status_code == 403, r.status_code)

big = "x" * (P.MAX_CODE_BYTES + 1)
r = teacher.post("/api/live/%s/push" % CODE, json={"body": big, "seq": 2000})
check("an oversized file is refused", r.status_code == 413, r.status_code)
check("  and did not land", row(CODE).body == "line one, fixed")


# ------------------------------------------------------------------ polling
print("\nWhat the class sees")

r = stranger.get("/api/live/%s" % CODE)
check("a student who is not signed in can watch", r.status_code == 200,
      r.status_code)
body = r.get_json()
check("  and gets the whole file, not a diff", body["body"] == "line one, fixed")
check("  with the version to poll against", body["version"] == 1001)
check("  and who is teaching, by last name only", body["host"] == "Franz",
      body.get("host"))
check("  a one-word name as it is, and no name the email's first half",
      P._live_host_name(accounts.User(name="Franz", email="a@b.org")) == "Franz"
      and P._live_host_name(accounts.User(name="", email="sfranz@b.org"))
      == "sfranz")

r = stranger.get("/api/live/%s?v=%d" % (CODE, body["version"]))
check("polling with the version they have gets 304, not the file again",
      r.status_code == 304,
      "thirty students pulling the file every second is the whole cost")

teacher.post("/api/live/%s/push" % CODE, json={"body": "line two", "seq": 3000})
r = stranger.get("/api/live/%s?v=%d" % (CODE, body["version"]))
check("  and the next change comes straight through",
      r.status_code == 200 and r.get_json()["body"] == "line two",
      r.status_code)

# A student opening the page halfway through the lesson.
late = client()
r = late.get("/api/live/%s?v=-1" % CODE)
check("someone joining late gets the current file at once",
      r.status_code == 200 and r.get_json()["body"] == "line two",
      "no catch-up path, because the first poll IS the catch-up")

r = stranger.get("/api/live/nosuchcode")
check("an unknown code is a clean 404", r.status_code == 404, r.status_code)


# ------------------------------------------------- sending a snippet
print("\nSending a snippet")

def poll_json(v=-1):
    return stranger.get("/api/live/%s?v=%s" % (CODE, v)).get_json()

before = poll_json()
r = teacher.post("/api/live/%s/send" % CODE,
                 json={"snippet": "scores = [3, 1, 4]", "seq": 4000})
check("the host can send a snippet", r.status_code == 200
      and r.get_json().get("sent") is True, r.get_json())

# It has to move the version: the class polls with the version it has, and
# a send that left it alone would be answered 304 and never seen.
r = stranger.get("/api/live/%s?v=%s" % (CODE, before["version"]))
check("  and a student polling with the old version gets it",
      r.status_code == 200 and r.get_json().get("snippet") == "scores = [3, 1, 4]",
      r.status_code)
check("  with the stamp that tells a new send from an old one",
      r.get_json().get("snippet_seq") == 4000, r.get_json().get("snippet_seq"))
check("  and the teacher's file is untouched by it",
      r.get_json().get("body") == before.get("body"))

page = stranger.get("/live/%s" % CODE).get_data(as_text=True)
check("a student who joins late is handed it in the page",
      '"scores = [3, 1, 4]"' in page and "snippetSeq: 4000" in page)

# The editor's Sprites and light/dark buttons, on the student's page too. A
# kaypy lesson without Sprites left the class typing file names by hand, and
# a room projecting in light had no way to put a laptop in it.
check("a student's lesson page has the Sprites button and its panel",
      'id="sprites-toggle"' in page and 'id="sprites"' in page
      and "sprites.js" in page
      and re.search(r"^\s*var spritePanel = window\.PyIDESprites\.attachPanel\(",
                   open(os.path.join(PYIDE, "static", "live.js")).read(), re.M))
_live_js = open(os.path.join(PYIDE, "static", "live.js")).read()
_demo_js = open(os.path.join(PYIDE, "static", "demo.js")).read()
check("  and the New tab button, hidden until their code is a game",
      'id="run-tab" class="btn" type="button" hidden' in page
      and re.search(r"^\s*if \(runTabBtn\) runTabBtn\.hidden = !isGame;", _live_js, re.M))
check("  which hands their own code to /play under the key /play reads",
      re.search(r'localStorage\.setItem\("pyide-play", JSON\.stringify\(\{\s*code: mainSource\(\),',
                _live_js)
      and 'localStorage.getItem("pyide-play")' in _demo_js
      and re.search(r'^\s*window\.open\("/play", "pyide-play"\);', _live_js, re.M)
      and re.search(r'^\s*if \(runTabBtn\) runTabBtn\.addEventListener\("click", runInNewTab\);',
                    _live_js, re.M))
check("  and the light/dark button",
      'id="theme"' in page
      and re.search(r"^\s*themeSwitch\(\);", open(os.path.join(PYIDE, "static", "live.js")).read(), re.M))

r = other.post("/api/live/%s/send" % CODE, json={"snippet": "x", "seq": 9999})
check("another teacher cannot send to this class", r.status_code == 403,
      r.status_code)
r = student.post("/api/live/%s/send" % CODE, json={"snippet": "x", "seq": 9999})
check("  nor can a student", r.status_code == 403, r.status_code)
r = stranger.post("/api/live/%s/send" % CODE, json={"snippet": "x", "seq": 9999})
check("  nor anyone signed out", r.status_code == 403, r.status_code)
check("  and none of them changed it",
      poll_json().get("snippet") == "scores = [3, 1, 4]")

r = teacher.post("/api/live/%s/send" % CODE, json={"snippet": "old", "seq": 3999})
check("a send that arrives late is refused like a late push",
      r.get_json().get("stale") is True
      and poll_json().get("snippet") == "scores = [3, 1, 4]", r.get_json())

# And the other direction, which is the one that bit: a push can lose to a
# send too, and must say so, because app.js relies on `stale` to push again.
r = teacher.post("/api/live/%s/push" % CODE, json={"body": "lost", "seq": 3998})
check("  and a push that loses to a send says it was stale",
      r.get_json().get("stale") is True, r.get_json())

r = teacher.post("/api/live/%s/send" % CODE, json={"snippet": "", "seq": 4001})
check("sending nothing takes it back", r.status_code == 200
      and poll_json().get("snippet") == "", r.get_json())

r = teacher.post("/api/live/start", json={})
check("a teacher who reloads is told whether something is out",
      r.get_json().get("snippet_out") is False, r.get_json())
teacher.post("/api/live/%s/send" % CODE, json={"snippet": "y = 1", "seq": 4002})
r = teacher.post("/api/live/start", json={})
check("  (and it says so when there is)", r.get_json().get("snippet_out") is True,
      r.get_json())

big = "#" * (P.MAX_CODE_BYTES + 1)
r = teacher.post("/api/live/%s/send" % CODE, json={"snippet": big, "seq": 4003})
check("an oversized snippet is refused", r.status_code == 413, r.status_code)

teacher.post("/api/live/%s/push" % CODE, json={"body": before["body"],
                                               "seq": 4100})


# ------------------------------------------------------ the notes pane
print("\nThe project's notes")

base = poll_json()
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": base.get("body"), "filename": "main.py",
                       "notes": "# Today\nLoops, [docs](https://docs.python.org)",
                       "seq": 4200})
got = poll_json()
check("notes pushed with the open file reach the class",
      r.status_code == 200 and got.get("notes", "").startswith("# Today"),
      repr(got.get("notes")))
check("  while main.py is still what the mirror shows",
      got.get("filename") == "main.py" and got.get("body") == base.get("body"))

# THE BUG THIS EXISTS FOR, from the other side: an editor still running the
# old code sends no notes, and must not wipe the ones already there.
teacher.post("/api/live/%s/push" % CODE,
             json={"body": "typing on", "filename": "main.py", "seq": 4201})
check("a push without notes leaves them in place",
      poll_json().get("notes", "").startswith("# Today"),
      repr(poll_json().get("notes")))

page = stranger.get("/live/%s" % CODE).get_data(as_text=True)
check("a student who joins now gets them in the page",
      re.search(r'^\s*notes: "# Today', page, re.M) is not None)
check("  with a pane to show them in",
      'id="live-notes-view"' in page and 'id="live-notes"' in page)

r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "x", "notes": "#" * (P.MAX_CODE_BYTES + 1),
                       "seq": 4202})
check("oversized notes are refused", r.status_code == 413, r.status_code)

teacher.post("/api/live/%s/push" % CODE,
             json={"body": base.get("body"), "filename": "main.py",
                   "notes": "", "seq": 4300})
check("a project with no notes clears them",
      poll_json().get("notes") == "", repr(poll_json().get("notes")))


# ------------------------------------------------ slides and output
print("\nSlides, and the teacher's output")

base = poll_json()
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": base.get("body"), "filename": "main.py",
                       "notes": "## Two", "slide": "2/4",
                       "output": "Spawning ghosty\n", "seq": 4400})
got = poll_json()
check("the slide a push names reaches the class",
      r.status_code == 200 and got.get("slide") == "2/4", repr(got.get("slide")))
check("  and so does what the teacher's Run printed",
      got.get("output") == "Spawning ghosty\n", repr(got.get("output")))

teacher.post("/api/live/%s/push" % CODE,
             json={"body": "typing on", "filename": "main.py", "seq": 4401})
got = poll_json()
check("a push from an older editor leaves both alone",
      got.get("slide") == "2/4" and got.get("output") == "Spawning ghosty\n",
      "an old tab would wipe them every 400ms")

teacher.post("/api/live/%s/push" % CODE,
             json={"body": "x", "slide": "<b>9</b>", "seq": 4402})
check("a slide that is not N/M is stored as none",
      poll_json().get("slide") == "", repr(poll_json().get("slide")))

# A runaway print loop. Refusing it would take the code down with it, and
# the mirror would freeze for as long as the loop ran.
flood = "".join("line %d\n" % i for i in range(20000))
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "while True: print()", "output": flood,
                       "seq": 4403})
got = poll_json()
check("huge output is trimmed, not refused",
      r.status_code == 200 and got.get("body") == "while True: print()",
      r.status_code)
check("  keeping the end of it, which is the part anyone reads",
      got.get("output", "").endswith("line 19999\n")
      and len(got["output"].encode()) <= P.LIVE_OUTPUT_BYTES,
      len(got.get("output", "")))

teacher.post("/api/live/%s/push" % CODE,
             json={"body": "x", "slide": "3/5", "output": "hi\n",
                   "seq": 4404})
again = teacher.post("/api/live/start", json={"body": "x"}).get_json()
check("a reload is told which slide the class is on",
      again.get("slide") == "3/5", repr(again.get("slide")))
page = stranger.get("/live/%s" % CODE).get_data(as_text=True)
check("a late joiner gets both in the page",
      re.search(r'^\s*slide: "3/5"', page, re.M) is not None
      and re.search(r'^\s*output: "hi\\n"', page, re.M) is not None)
check("  with a slide marker and a pane for the teacher's output",
      'id="live-slide"' in page and 'id="teacher-output"' in page)
_mirror_html = page[page.index('class="live-pane live-mirror"'):
                    page.index('class="live-pane live-mine"')]
_out_html = page[page.index('id="output-view"'):page.index('id="live-notes-view"')]
check("  beside the teacher's code, not in the student's output pane",
      'id="teacher-output"' in _mirror_html
      and 'teacher-output' not in _out_html,
      "the class had to flick between two tabs to compare the outputs")
teacher.post("/api/live/%s/push" % CODE,
             json={"body": base.get("body"), "filename": "main.py",
                   "notes": "", "slide": "", "output": "", "seq": 4500})


# ------------------------------------------------ the teacher's caret
print("\nThe teacher's caret")

teacher.post("/api/live/%s/push" % CODE,
             json={"body": "a = 1\nb = 2", "cursor": "1:3", "seq": 4600})
check("the caret a push names reaches the class",
      poll_json().get("cursor") == "1:3", repr(poll_json().get("cursor")))
teacher.post("/api/live/%s/push" % CODE,
             json={"body": "a = 1\nb = 22", "seq": 4601})
check("  a push from an older editor leaves it alone",
      poll_json().get("cursor") == "1:3", repr(poll_json().get("cursor")))
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "a = 1", "cursor": "<b>", "seq": 4602})
check("  one that is not line:ch is stored as none, not refused",
      r.status_code == 200 and poll_json().get("cursor") == ""
      and poll_json().get("body") == "a = 1", repr(poll_json().get("cursor")))
teacher.post("/api/live/%s/push" % CODE,
             json={"body": "a = 1\nb = 2", "cursor": "0:1-1:3", "seq": 4604})
check("a highlighted block reaches the class as anchor-head",
      poll_json().get("cursor") == "0:1-1:3", repr(poll_json().get("cursor")))
r = teacher.post("/api/live/%s/push" % CODE,
                 json={"body": "a = 1", "cursor": "123456:1-1:1", "seq": 4605})
check("  one too long for the column is stored as none, not refused",
      r.status_code == 200 and poll_json().get("cursor") == ""
      and poll_json().get("body") == "a = 1",
      "Postgres would refuse 25 characters and the push would be lost")
check("  and the longest one allowed fits the column",
      len("99999:99999-99999:99999")
      <= accounts.LiveSession.__table__.c.cursor.type.length)
teacher.post("/api/live/%s/push" % CODE,
             json={"body": "a = 1", "cursor": "0:2", "seq": 4606})
page = stranger.get("/live/%s" % CODE).get_data(as_text=True)
check("  and a late joiner gets it in the page",
      re.search(r'^\s*cursor: "0:2"', page, re.M) is not None)
teacher.post("/api/live/%s/push" % CODE,
             json={"body": base.get("body"), "filename": "main.py",
                   "cursor": "", "seq": 4700})


# -------------------------------------------------------------- the pages
print("\nThe pages")

r = stranger.get("/live/%s" % CODE)
check("the live page opens for anyone with the code", r.status_code == 200,
      r.status_code)
page = r.get_data(as_text=True)
check("  and carries two editors, mirror and their own",
      'id="mirror"' in page and 'id="mine"' in page)

# LAYOUT, because the first version got this wrong in a way only a kaypy
# lesson showed: three panes stacked down the page put an 800x600 canvas in
# the middle, squeezed the student's own editor to a few lines at the
# bottom, and left Run in the header far from the code it runs.
#
# Checked as structure rather than by eye: the two editors are inside one
# left-hand column, and the output and the canvas are a sibling of that
# column, not a third row under it.
# NESTING, not order. The first version of this sliced from the left
# column's class to the string "live-right" — which is the same slice
# whether the student's editor is inside that column or has been moved out
# of it into a sibling, because both sit between those two points in the
# text. It passed a deliberately broken page.
start = page.index('class="pane live-left"')
end = page.index("</section>", start)
left = page[start:end]
check("  with both editors stacked inside the left column",
      'id="mirror"' in left and 'id="mine"' in left,
      "mirror: %s, mine: %s" % ('id="mirror"' in left, 'id="mine"' in left))
check("  and the output beside them, not under them",
      'id="output"' not in left and 'id="canvas"' not in left,
      "a game in the middle row is what squeezed the editor last time")
check("  in the same right-hand pane class the editor uses",
      'class="pane pane-right live-right"' in page,
      "so the two pages do not disagree about where output lives")
check("  with the lesson already in it, so it is not blank while it polls",
      "line two" in page)
check("  and no button that copies the teacher's code down",
      not re.search(r"copy[^<]{0,20}(mine|into|down)", page, re.I),
      "typing it is the exercise")

r = stranger.get("/live/nosuchcode")
check("a bad code goes back to the join page", r.status_code == 302
      and "/live" in r.headers.get("Location", ""),
      r.headers.get("Location", r.status_code))

check("the join page opens", stranger.get("/live").status_code == 200)

r = teacher.get("/live/%s" % CODE)
host_page = r.get_data(as_text=True)
check("the host gets their own view, not a mirror of themselves",
      'id="mirror"' not in host_page)
# A projector showing two paragraphs and a code does not need several
# megabytes of WebAssembly to do it.
check("  and is not made to download Python to show a code",
      "pyodide.js" not in host_page)
check("  while a student following along does get it",
      "pyodide.js" in page)

r = teacher.get("/")
check("the editor offers Go live to a teacher", 'id="go-live"' in
      r.get_data(as_text=True))
r = student.get("/")
check("  and does not offer it to a student", 'id="go-live"' not in
      r.get_data(as_text=True))
check("  nor a copy of what the class's notes pane shows",
      'id="class-view"' not in r.get_data(as_text=True))
r = teacher.get("/")
check("the teacher's editor has a pane showing the slide the class is on",
      'id="class-view"' in r.get_data(as_text=True)
      and 'id="class-notes"' in r.get_data(as_text=True))

# Hide code moved off the toolbar into the dialog a teacher's Share opens.
# On the toolbar, a tick left on from an earlier demo was invisible until a
# student opened the link and found no code.
_tp = r.get_data(as_text=True)
_ask = _tp.find('id="share-ask"')
check("a teacher's Share asks first, with Hide code inside that dialog",
      _ask != -1 and _tp.find('id="hide-code"') > _ask,
      "share-ask at %d, hide-code at %d" % (_ask, _tp.find('id="hide-code"')))
_sp = student.get("/").get_data(as_text=True)
check("  and a student gets neither", 'id="share-ask"' not in _sp
      and 'id="hide-code"' not in _sp)

# The join code on the teacher's bar is a button that copies /live/<code>.
_chip = re.search(r'<(\w+) id="live-code"', _tp)
check("the live code chip is a button", _chip and _chip.group(1) == "button",
      _chip.group(1) if _chip else "missing")
_app = open(os.path.join(HERE, "..", "static", "app.js")).read()
check("  that copies the class's whole link",
      re.search(r'liveChip\.addEventListener\("click"', _app)
      and 'location.origin + "/live/"' in _app)

# The notes panes neither grow nor shrink, so output printed above them —
# or a folded console opening — cannot take their height. The output took it
# from the teacher's copy because its basis was `auto`, its own content.
_css = open(os.path.join(HERE, "..", "static", "style.css")).read()
for _sel in (".live-right .live-notes", ".pane-right .class-view"):
    _rule = re.search(re.escape(_sel) + r"\s*\{([^}]*)\}", _css)
    check("%s is a fixed size" % _sel,
          _rule and re.search(r"flex:\s*0 0 ", _rule.group(1)),
          _rule.group(1).strip() if _rule else "no rule")
check("  and the output beside them takes only what is left",
      re.search(r"\.pane-right #output-view\s*\{\s*flex:\s*1 1 0;", _css)
      and not re.search(r"#output-view\.is-folded\s*\{\s*flex", _css))


# ------------------------------------------------ keeping their own copy
print("\nSaving their own work")

r = student.get("/live/%s" % CODE)
student_page = r.get_data(as_text=True)
check("a signed-in student is offered Save", 'id="live-save"' in student_page)
check("  and is not told their work is browser-only",
      "sign in to save it properly" not in student_page)

r = stranger.get("/live/%s" % CODE)
out_page = r.get_data(as_text=True)
check("a signed-out student is not offered Save",
      'id="live-save"' not in out_page,
      "there is nowhere for it to go, so the button would be a lie")
check("  and is told where their work is kept instead",
      "sign in to save it properly" in out_page)

# Sign in, on the lesson page itself. Save and Turn in only exist once signed
# in, so without this a student had no way to get them short of leaving the
# lesson — and nothing on the page said so. Login is off in this suite (no
# Google keys), so it is switched on just for these two requests.
_login = accounts.login_configured
accounts.login_configured = lambda: True
try:
    signin_out = stranger.get("/live/%s" % CODE).get_data(as_text=True)
    signin_in = student.get("/live/%s" % CODE).get_data(as_text=True)
finally:
    accounts.login_configured = _login
check("a signed-out student is offered Sign in on the lesson",
      "/login?next=/live/%s" % CODE in signin_out
      or "/login?next=%%2Flive%%2F%s" % CODE in signin_out)
check("  and a signed-in one is not",
      ">Sign in</a>" not in signin_in)

# Their own editor behaves like the main one: name completion is loaded and
# wired up. It was missing for a term because this page was built separately.
check("the live page loads completion and its popup",
      "complete.js" in out_page and "show-hint.min.js" in out_page
      and "show-hint.min.css" in out_page)
check("  and tab stops", "tabstops.js" in out_page)
_lj = open(os.path.join(PYIDE, "static", "live.js")).read()
check("  and live.js attaches completion once Python loads",
      "PyIDEComplete.attach(pyodide)" in _lj
      and "PyIDEComplete.show(cm)" in _lj)

# The live page saves through the editor's own endpoints, so a project made
# here is an ordinary project: it opens at /p/<slug>, lists in My projects,
# and can be turned in. Nothing about it is special-cased.
r = student.post("/api/draft", json={"code": "my own attempt", "files": {},
                                     "title": "Loops"})
check("their copy saves through the ordinary draft endpoint",
      r.status_code == 200, r.status_code)
SLUG = r.get_json()["slug"]

r = student.post("/api/draft/" + SLUG,
                 json={"code": "my own attempt, further on", "files": {},
                       "title": "Loops"})
check("  and autosaves from then on", r.status_code == 200, r.status_code)

listed = student.get("/api/my/projects").get_json()
titles = [row["title"] for row in listed.get("projects", listed if
          isinstance(listed, list) else [])]
check("  and turns up in My projects", "Loops" in titles, titles)

r = student.get("/p/" + SLUG)
check("  and opens in the full editor",
      r.status_code == 200 and "my own attempt, further on"
      in r.get_data(as_text=True), r.status_code)

r = stranger.post("/api/draft", json={"code": "x", "files": {}})
check("a signed-out student saving is told to sign in, not ignored",
      r.status_code == 401, r.status_code)

# A deleted project must not leave the page autosaving into nothing while
# telling the student it saved.
student.delete("/api/draft/" + SLUG)
r = student.post("/api/draft/" + SLUG, json={"code": "after", "files": {}})
check("autosaving into a deleted project is a clean 404, not a silent success",
      r.status_code == 404, r.status_code)
_live_js = open(os.path.join(PYIDE, "static", "live.js")).read()
check("  and live.js turns that back into a Save button",
      "res.status === 404" in _live_js and "removeItem(SLUG_KEY)" in _live_js,
      "otherwise it says Saved for the rest of the lesson and saves nothing")


# ------------------------------------------------- handing work in
#
# THE THING THAT WAS IMPOSSIBLE.
#
# Turning work in needs a draft with an assignment on it. A live lesson had
# no assignment and the live page saved through /api/draft, which makes a
# free-standing project — so the Turn in button could not appear, on the
# live page or on reopening the saved copy. Nothing errored; the lesson
# worked, the saving worked, and handing in simply could not happen.
print("\nHanding work in")

hw = teacher.post("/api/assignment",
                  json={"code": "# starter\n", "files": {},
                        "title": "Loops homework"}).get_json()["slug"]

r = teacher.get("/api/live/assignment/" + hw)
check("a teacher can fetch one assignment's starter for the editor",
      r.status_code == 200 and r.get_json()["code"].startswith("# starter"),
      r.status_code)
check("  another teacher cannot",
      other.get("/api/live/assignment/" + hw).status_code == 404)
check("  nor can a student",
      student.get("/api/live/assignment/" + hw).status_code == 403)

r = teacher.get("/api/live/assignments")
check("a teacher can list their open assignments", r.status_code == 200,
      r.status_code)
check("  and the list stays light, with no starter code in it",
      all("code" not in a for a in r.get_json()["assignments"]),
      "every starter in the chooser would be megabytes nobody reads")
check("  and the new one is in it",
      hw in [a["slug"] for a in r.get_json()["assignments"]])
check("a student cannot", student.get("/api/live/assignments").status_code == 403)

r = other.post("/api/live/start", json={"body": "x", "assignment": hw})
check("a teacher cannot attach someone else's assignment",
      r.status_code == 400, r.get_json())

# CODE is still the teacher open lesson at this point; close it so
# the next start makes a fresh one attached to the assignment.
teacher.post("/api/live/%s/stop" % CODE)
started = teacher.post("/api/live/start",
                       json={"body": "for i in range(3):", "title": "Loops",
                             "assignment": hw}).get_json()
LESSON = started["code"]
check("a lesson can be started for an assignment",
      started.get("assignment") == hw, started)

# Resuming after a page reload sends no assignment key at all.
again2 = teacher.post("/api/live/start", json={"body": "more"}).get_json()
check("  and reloading the editor does not drop it",
      again2.get("assignment") == hw,
      "the class would silently lose the ability to hand in")


def starter_of(page):
    """What the page tells live.js to start the student's editor with."""
    m = re.search(r"^\s*starter: (.*?),?$", page, re.M)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return "<not JSON: %s>" % m.group(1)   # fail the check, don't crash

# THE STARTER, as the handout link would give it. A lesson for an assignment
# used to hand every student an empty editor, so the class retyped the
# starter the teacher had already written for them.
check("a lesson for an assignment starts the class on its starter",
      starter_of(stranger.get("/live/%s" % LESSON).get_data(as_text=True))
      == "# starter\n")
check("  signed in with no draft of it yet, the same",
      starter_of(student.get("/live/%s" % LESSON).get_data(as_text=True))
      == "# starter\n")
r = stranger.get("/api/live/%s" % LESSON)
check("  and it is in the page, never on the poll",
      "starter" not in r.get_json() and "# starter" not in r.get_data(as_text=True),
      "the poll is the teacher's channel; the starter is the student's")

# The assignment ships an attached data file, which is the normal case for
# anything that reads from one.
db = P.SessionLocal()
try:
    row = db.query(accounts.Assignment).filter_by(slug=hw).first()
    row.files = json.dumps({"data.csv": "a,b\n1,2\n"})
    db.commit()
finally:
    db.close()

r = student.post("/api/live/%s/keep" % LESSON, json={"code": "my work"})
check("a student's save lands in the assignment's own draft",
      r.status_code == 200 and r.get_json()["can_turn_in"] is True,
      r.get_json())
KEPT = r.get_json()["slug"]

# THE DRAFT, NOT THE STARTER, once they have one. Saving here overwrites the
# draft with the live editor, so a student who did half of it from the link
# this morning and was handed the bare starter now would lose the morning on
# their first Save.
check("a student with a draft of the assignment starts from their draft",
      starter_of(student.get("/live/%s" % LESSON).get_data(as_text=True))
      == "my work",
      repr(starter_of(student.get("/live/%s" % LESSON).get_data(as_text=True))))
check("  while everyone else still gets the starter",
      starter_of(stranger.get("/live/%s" % LESSON).get_data(as_text=True))
      == "# starter\n")

def drafts_for(uid):
    db = P.SessionLocal()
    try:
        item = db.query(accounts.Assignment).filter_by(slug=hw).first()
        return db.query(accounts.Draft).filter_by(
            owner_id=uid, assignment_id=item.id).count()
    finally:
        db.close()


# THE DUPLICATE, EXERCISED PROPERLY.
#
# The first version of this saved once and then counted, which is one draft
# however the code behaves — it passed a deliberately broken server that made
# a fresh row every time. Two copies of one piece of work is the failure
# worth catching: the student edits one and hands in the other.
# THE STATUS, NOT JUST THE COUNT. Counting alone still passed a server that
# inserted a fresh row every time — because the table's unique constraint on
# (owner, assignment) rejected the second insert, so the count stayed at 1
# while every save after the first was a 500 the student would have seen as
# "could not save". The count was right for the wrong reason.
again_a = student.post("/api/live/%s/keep" % LESSON,
                       json={"code": "my work, further on"})
again_b = student.post("/api/live/%s/keep" % LESSON,
                       json={"code": "further still"})
check("  and saving again succeeds rather than colliding",
      again_a.status_code == 200 and again_b.status_code == 200,
      "%s then %s" % (again_a.status_code, again_b.status_code))
check("  writing to that same row, not a new one",
      drafts_for(STUDENT) == 1,
      "%d drafts for one student on one assignment" % drafts_for(STUDENT))
check("  and the latest text is what was kept",
      again_b.get_json().get("slug") == KEPT, again_b.get_json())

# The other order, which is the one that happens in a real week: they open
# the handout link in class on Monday, then join the live lesson on Tuesday.
handout_first = client(STUDENT2)
r = handout_first.get("/a/" + hw)
check("  a student who opened the handout link first has one copy",
      drafts_for(STUDENT2) == 1, drafts_for(STUDENT2))
joined = handout_first.post("/api/live/%s/keep" % LESSON,
                            json={"code": "typed along"})
check("  and saving from the live lesson succeeds",
      joined.status_code == 200, joined.status_code)
check("  finding it rather than making another",
      drafts_for(STUDENT2) == 1,
      "%d drafts — they would edit one and hand in the other"
      % drafts_for(STUDENT2))

r = student.get("/a/" + hw)
check("  so opening the handout link afterwards finds it",
      r.status_code == 302 and KEPT in r.headers.get("Location", ""),
      r.headers.get("Location", r.status_code))

kept_now = student.post("/api/live/%s/keep" % LESSON,
                        json={"code": "my work"}).get_json()
r = student.post("/api/submit", json={"draft": KEPT, "code": "my work",
                                      "files": kept_now["files"]})
check("the student can turn it in", r.status_code == 200, r.get_json())

# A student who joined the lesson without ever opening the handout link
# must still get the assignment's attached files, or the program they were
# told to run fails on a missing one.
db = P.SessionLocal()
try:
    kept = db.query(accounts.Draft).filter_by(slug=KEPT).first().file_map()
finally:
    db.close()
check("  and the assignment's attached files came with it",
      "data.csv" in kept, sorted(kept))

# THE REST OF THE PROJECT, AS TABS. The live page was main.py alone, so a
# student could not see the data file the lesson was about, and their saves
# could not carry one. The page is handed the same files the handout link
# would open — their draft's — and a save carries the tabs back.
def starter_files_of(page):
    m = re.search(r"^\s*starterFiles: (.*?),?$", page, re.M)
    try:
        return json.loads(m.group(1)) if m else None
    except ValueError:
        return "<not JSON: %s>" % m.group(1)


def kept_files():
    db = P.SessionLocal()
    try:
        return db.query(accounts.Draft).filter_by(slug=KEPT).first().file_map()
    finally:
        db.close()


r = student.post("/api/live/%s/keep" % LESSON,
                 json={"code": "my work", "files": {"data.csv": "a,b\n3,4\n",
                                                    "words.txt": "cat"}})
check("a save from the live page keeps what they typed in the other tabs",
      r.status_code == 200 and kept_files() == {"data.csv": "a,b\n3,4\n",
                                                "words.txt": "cat"},
      kept_files())
check("  and hands back the project as saved, for Turn in",
      r.get_json().get("files") == kept_files(), r.get_json().get("files"))
# An empty map is an old editor tab from before the tabs, which sent `{}`
# on every save. Taken literally it would delete every file in the project.
r = student.post("/api/live/%s/keep" % LESSON,
                 json={"code": "my work", "files": {}})
check("  while an empty map leaves the files alone",
      r.status_code == 200 and "words.txt" in kept_files(), kept_files())
r = student.post("/api/live/%s/keep" % LESSON,
                 json={"code": "my work", "files": {"../x.txt": "no"}})
check("  and a file name the editor would refuse is refused here too",
      r.status_code == 400 and "../x.txt" not in kept_files(), r.status_code)

# Their draft's files — words.txt is in it now and not in the assignment —
# so this cannot pass on the assignment's alone.
check("the live page hands the student their project's other files",
      starter_files_of(student.get("/live/%s" % LESSON).get_data(as_text=True))
      == kept_files(), starter_files_of(student.get("/live/%s" % LESSON)
                                .get_data(as_text=True)))
check("  and a student with no draft gets the assignment's",
      starter_files_of(stranger.get("/live/%s" % LESSON).get_data(as_text=True))
      == {"data.csv": "a,b\n1,2\n"})


seen_by_teacher = teacher.get("/teacher/" + hw).get_data(as_text=True)
check("  and it reaches the teacher's dashboard",
      "A Student" in seen_by_teacher)

page = student.get("/live/%s" % LESSON).get_data(as_text=True)
check("the live page offers Turn in once there is an assignment",
      'id="live-turn-in"' in page)
check("  and says they have already handed it in",
      "Turn in again" in page)

# A lesson with no assignment still saves — it just cannot hand in, and
# says nothing misleading about it.
plain = teacher.post("/api/live/start", json={"body": "x"}).get_json()
check("  (an open lesson is reused, so this is still the same one)",
      plain["code"] == LESSON, plain["code"])

teacher.post("/api/live/%s/stop" % LESSON)
bare = teacher.post("/api/live/start",
                    json={"body": "x", "assignment": ""}).get_json()
r = student.post("/api/live/%s/keep" % bare["code"], json={"code": "notes"})
check("a lesson with no assignment still saves",
      r.status_code == 200 and r.get_json()["can_turn_in"] is False,
      r.get_json())
page = student.get("/live/%s" % bare["code"]).get_data(as_text=True)
check("  and offers no Turn in button at all",
      'id="live-turn-in"' not in page,
      "a button that cannot work reads as lost work")
check("  and starts the student's editor empty, as it always did",
      starter_of(page) == "", repr(starter_of(page)))

r = stranger.post("/api/live/%s/keep" % bare["code"], json={"code": "x"})
check("signed out, saving says to sign in", r.status_code == 401, r.status_code)


# ------------------------------------------------------------------ ending
print("\nEnding it")

r = student.post("/api/live/%s/stop" % CODE)
check("a student cannot end the lesson", r.status_code == 403, r.status_code)

r = teacher.post("/api/live/%s/stop" % CODE)
check("the host can", r.status_code == 200, r.status_code)

r = stranger.get("/api/live/%s?v=3000" % CODE)
check("a student still on the page is TOLD it ended",
      r.status_code == 200 and r.get_json()["ended"] is True,
      "a mirror that just stops moving looks like a broken page")

r = teacher.post("/api/live/%s/push" % CODE, json={"body": "after", "seq": 5000})
check("and nothing more can be pushed into it", r.status_code == 409,
      r.status_code)

after = teacher.post("/api/live/start", json={"body": "new"}).get_json()
check("starting again makes a NEW lesson, not the ended one",
      after["code"] != CODE, after["code"])


# ------------------------------------------- resuming, and signing out
print("\nResuming after a reload, and signing out")

def open_lessons(uid):
    db = P.SessionLocal()
    try:
        return db.query(accounts.LiveSession).filter_by(
            host_id=uid, app=P.APP_NAME, ended=0).count()
    finally:
        db.close()

r = teacher.post("/api/live/start", json={"body": "x", "resume": after["code"]})
check("a reload resumes the lesson it was broadcasting",
      r.get_json().get("code") == after["code"], r.get_json())

# THE BUG: the editor resumed by calling start like a fresh Go live, so an
# ended lesson in the browser's memory put the teacher back on the air in a
# brand-new lesson just for opening the editor — "sign in and I'm live".
teacher.post("/api/live/%s/stop" % after["code"])
r = teacher.post("/api/live/start", json={"body": "x", "resume": after["code"]})
check("resuming a lesson that has ended starts nothing",
      r.get_json().get("resumed") is False and "code" not in r.get_json(),
      r.get_json())
check("  and no lesson was opened behind the teacher's back",
      open_lessons(TEACHER) == 0, "%d open" % open_lessons(TEACHER))

fresh = teacher.post("/api/live/start", json={"body": "x"}).get_json()
r = teacher.post("/api/live/start", json={"body": "x", "resume": CODE})
check("  nor does resuming an old code while a different lesson is open",
      r.get_json().get("resumed") is False, r.get_json())
check("  and the open one is left alone",
      open_lessons(TEACHER) == 1)

teacher.get("/logout")
check("signing out ends the lesson being broadcast",
      open_lessons(TEACHER) == 0, "%d open" % open_lessons(TEACHER))
r = stranger.get("/api/live/%s" % fresh["code"])
check("  and the class is told it ended",
      r.get_json().get("ended") is True, r.get_json())
teacher = client(TEACHER)                  # signed back in for what follows


# ------------------------------------------- reopening yesterday's lesson
#
# A lesson that ended — Stop, signing out, or the overnight sweep — used to
# be gone for good: the link the class had from yesterday only ever said
# "Lesson ended". Now the teacher opens that same link and presses "Teach
# this lesson again". It is never offered anywhere else: a reopened lesson
# lands on every screen still showing its host_page, which is the "sign in and
# I'm live" bug if it ever happens without the teacher choosing it. (Go
# live once offered "your last lesson", which was whichever was most recent
# rather than the one meant, and left the editor showing whatever was open.)
print("\nReopening yesterday's lesson")

def set_row(code, **fields):
    db = P.SessionLocal()
    try:
        db.query(accounts.LiveSession).filter_by(code=code).update(fields)
        db.commit()
    finally:
        db.close()

def item_id(slug):
    db = P.SessionLocal()
    try:
        return db.query(accounts.Assignment).filter_by(slug=slug).first().id
    finally:
        db.close()


def lesson_row(code):
    db = P.SessionLocal()
    try:
        return db.query(accounts.LiveSession).filter_by(code=code).first()
    finally:
        db.close()

check("Go live offers no lesson of its own accord",
      "recent" not in teacher.get("/api/live/assignments").get_json(),
      "it offered the most recent lesson, not the one the teacher meant")

# Yesterday's lesson: for the homework, ended by the sweep a day ago.
set_row(LESSON, ended=1, updated_at=P._live_now() - P.timedelta(days=1))
host_page = teacher.get("/live/%s" % LESSON).get_data(as_text=True)
_teach = re.search(r'<a id="teach-again"[^>]*href="([^"]*)"', host_page)
check("its teacher, opening its link, can teach it again",
      _teach is not None and "Teach this lesson again" in host_page,
      "the link the class still has could never be used again")
check("  into the editor, with the lesson and its assignment's starter",
      _teach is not None and _teach.group(1).replace("&amp;", "&")
      in ("/?teach=%s&a=%s" % (LESSON, hw), "/?a=%s&teach=%s" % (hw, LESSON)),
      _teach.group(1) if _teach else "")
check("  and is not offered End lesson for a lesson already over",
      'id="live-stop"' not in host_page)
check("  nor a connection chip that never connects",
      'id="live-state"' not in host_page)
host_page = student.get("/live/%s" % LESSON).get_data(as_text=True)
check("a student opening the same link is offered nothing of the kind",
      'id="teach-again"' not in host_page)
host_page = other.get("/live/%s" % LESSON).get_data(as_text=True)
check("  nor is another teacher", 'id="teach-again"' not in host_page)

r = other.post("/api/live/start", json={"body": "x", "reopen": LESSON})
check("another teacher cannot reopen it", r.status_code == 404, r.status_code)
check("  and it stays ended", lesson_row(LESSON).ended == 1)

r = teacher.post("/api/live/start", json={"body": "x", "resume": LESSON})
check("a reload's resume still cannot reopen it",
      r.get_json().get("resumed") is False and lesson_row(LESSON).ended == 1,
      r.get_json())

r = teacher.post("/api/live/start", json={"body": "day two", "reopen": LESSON})
got = r.get_json()
check("the teacher can reopen it", r.status_code == 200, r.status_code)
check("  under the same code, so yesterday's link works again",
      got.get("code") == LESSON, got)
check("  still for the same assignment, so Turn in goes where it went",
      got.get("assignment") == hw, got)
check("  and it survives the sweep that ended it overnight",
      lesson_row(LESSON).ended == 0,
      "start sweeps after it commits: a stale updated_at would end it again")
r = stranger.get("/api/live/%s" % LESSON)
check("  and the class's host_page is told it is back on",
      r.get_json().get("ended") is False, r.get_json())
host_page = teacher.get("/live/%s" % LESSON).get_data(as_text=True)
check("while it is open the link still takes its teacher back in",
      "Teach this lesson</a>" in host_page.replace("\n", "").replace("  ", "")
      and 'id="live-stop"' in host_page)

other_open = teacher.post("/api/live/start", json={"body": "x"}).get_json()
check("  (pressing Go live now carries on in the reopened one)",
      other_open.get("code") == LESSON, other_open)

# Two open rows for one teacher: the newest wins every later Go live and
# reload, which is not the one the class is looking at.
set_row(LESSON, ended=1)
newer = teacher.post("/api/live/start", json={"body": "x"}).get_json()["code"]
teacher.post("/api/live/start", json={"body": "x", "reopen": LESSON})
check("reopening closes whatever else was open, leaving one",
      open_lessons(TEACHER) == 1 and lesson_row(newer).ended == 1,
      "%d open" % open_lessons(TEACHER))
teacher.post("/api/live/%s/stop" % LESSON)



# --------------------------------------------------- how it is built at all
print("\nHow it is built")

app_src = open(os.path.join(PYIDE, "app.py")).read()
live_js = open(os.path.join(PYIDE, "static", "live.js")).read()
app_js = open(os.path.join(PYIDE, "static", "app.js")).read()


def code_only(js):
    """The JavaScript with its comments taken out.

    NOT a nicety. The check below for `readOnly: "nocursor"` was written
    against the raw file and passed happily while the actual option said
    `readOnly: true` — because the phrase was also sitting in the comment
    above it explaining why. A check that its own documentation satisfies is
    a check that can never fail.
    """
    out = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    return re.sub(r"(^|[^:])//.*$", r"\1", out, flags=re.M)


live_code = code_only(live_js)

# TWO WORKERS. `gunicorn --workers 2` is in render.yaml, so any per-session
# state kept in a module-level dict is visible to one process and invisible
# to the other — and a student's poll reaches whichever one it lands on.
live_block = app_src[app_src.index("# Teaching live"):]
check("no live state is kept in module memory",
      not re.search(r"^_?live_?\w* *= *(\{\}|\[\]|dict\(|list\()",
                    live_block, re.M),
      "with two gunicorn workers, half the class would see nothing")

check("the row is what two workers agree on",
      "class LiveSession" in open(os.path.join(PYIDE, "accounts.py")).read())

# The stamp has to be a 64-bit column: it is a millisecond clock reading,
# about 1.8e12, and Postgres INTEGER stops at 2.1e9. As a plain Integer this
# passes on SQLite and raises on the first push in production.
accounts_src = open(os.path.join(PYIDE, "accounts.py")).read()
check("  and its version column is big enough for a clock reading",
      re.search(r"version = Column\(BigInteger", accounts_src) is not None,
      "Integer overflows on Postgres at 2.1e9; Date.now() is 1.8e12")

# THE RULE THE WHOLE PAGE EXISTS TO KEEP, asked about the argument and not
# about where the line sits. An earlier version of this check only counted
# the calls and looked for the word localStorage somewhere above — which
# passed unchanged when the call was rewritten to `mine.setValue(L.body)`,
# i.e. to fill the student's editor from the lesson. It tested position, not
# source, which is not the thing that matters.
sets = re.findall(r"(\w+)\.setValue\(", live_code)
check("live.js writes into only two editors, and knows which",
      set(sets) <= {"mirror", "mine"},
      "editors written to: %s" % sorted(set(sets)))

mine_calls = re.findall(r"mine\.setValue\(([^)]*)\)", live_code)
check("  the student's editor is written to exactly once",
      len(mine_calls) == 1, "%d times" % len(mine_calls))
arg = (mine_calls[0].strip() if mine_calls else "")
# What goes in is their own browser's copy, or — only when there is none —
# the starting point the PAGE was rendered with (L.starter: their draft or
# the assignment's starter). Traced through one variable, and nothing else
# may feed it: not the poll's data, not the mirror.
assigned = re.findall(r"\b(?:var\s+)?%s\s*=\s*([^;]+);" % re.escape(arg),
                      live_code) if arg else []
source_ok = (len(assigned) == 1
             and re.fullmatch(r"kept !== null \? kept : \(L\.starter \|\| \"\"\)",
                              assigned[0].strip()) is not None)
kept_ok = re.search(r"\bkept\s*=\s*window\.localStorage\.getItem\(DRAFT_KEY\)",
                    live_code) is not None
check("  and what goes in is their browser's copy, else the page's starter",
      source_ok and kept_ok,
      "mine.setValue(%s) = %s" % (arg or "nothing", assigned))

after_mirror = live_code[live_code.index("function showMirror"):]
# What gets saved has to be the student's editor. Saving the mirror would
# put the teacher's code in the student's projects under their name, and it
# would look completely correct on screen while doing it.
#
# ONE LEVEL OF INDIRECTION IS RESOLVED, because the first version of this
# check only matched `code: <editor>.getValue()` and the initial Save passes
# a variable — so changing that variable to read the mirror passed the suite
# untouched. A check that covers the autosave and not the Save is worse than
# none, because it reads as though both are guarded.
def editors_behind(field):
    """Which CodeMirror every `field: ...` ends up reading."""
    found = set()
    for value in re.findall(r"\b%s: *([\w.()]+)" % field, live_code):
        value = value.rstrip(",")
        direct = re.match(r"(\w+)\.getValue\(\)$", value)
        if direct:
            found.add(direct.group(1))
            continue
        if re.match(r"^\w+$", value):          # a variable: find what it holds
            for src in re.findall(
                    r"\b%s *= *(\w+)\.getValue\(\)" % re.escape(value),
                    live_code):
                found.add(src)
            else:
                if not re.search(r"\b%s *= *\w+\.getValue\(\)"
                                 % re.escape(value), live_code):
                    found.add("?" + value)     # unresolved: say so, don't pass
    return found


# `mainSource()` is main.py's document, whichever tab is showing. Resolved
# to the editor that document belongs to, so a mainSource() that read the
# mirror would fail here rather than slip past as an unknown function.
main_ok = (re.search(r"function mainSource\(\) \{ return docs\[MAIN\]\.getValue\(\); \}",
                     live_code) is not None
           and re.findall(r"docs\[MAIN\] *= *([^;]+);", live_code) == ["mine.getDoc()"])
live_code_resolved = live_code.replace("mainSource()",
                                       "mine.getValue()" if main_ok else "?mainSource()")
_real_code = live_code
live_code = live_code_resolved
saved_from = editors_behind("code")
live_code = _real_code
check("  and what is saved to their projects is their editor, not the mirror",
      bool(saved_from) and saved_from == {"mine"},
      "saved from: %s" % sorted(saved_from))

# THE OTHER TABS ARE THEIRS TOO. Every one is a document made here from
# the page, from their browser, or from what their own Run wrote — and none
# is ever filled from the mirror or the poll's data.
doc_fills = re.findall(r"docs\[[^\]]+\] *= *([^;]+);", live_code)
check("  and every other tab is filled from the page, their browser or their Run",
      bool(doc_fills) and all("mirror" not in f and "data." not in f
                              for f in doc_fills),
      doc_fills)
doc_sets = re.findall(r"docs\[(\w+)\]\.setValue\(([^)]*)\)", live_code)
pull = live_code[live_code.index("function pullFilesFromPython"):]
pull = pull[:pull.index("\n  }\n")]
check("  and the only write into one is their own program's output",
      doc_sets == [("name", "text")] and "docs[name].setValue(text)" in pull
      and "pyodide.FS.readFile" in pull, doc_sets)
# Three saves, and the fourth is New tab's handover to /play, which carries
# the same tabs for the same reason: a game missing its data files breaks.
check("  every save carries those tabs, never an empty map",
      'files: {}' not in live_code
      and len(re.findall(r"files: dataFiles\(\)", live_code)) == 4,
      "an autosave sending {} emptied the project of its data files")
_run_fn = live_code[live_code.index("async function run()"):]
_run_fn = _run_fn[:_run_fn.index("\n  }\n")]
check("  and Run gives Python the files before running main.py",
      -1 < _run_fn.find("pushFilesToPython();") < _run_fn.find("_pyide_run(")
      and _run_fn.find("pushFilesToPython();") < _run_fn.find("_pyide_run_game("),
      "main.py would open a data file that is not there yet")
check("  with tabs on the page to switch between them",
      'id="mine-tabs"' in page and 'starterFiles:' in page)

check("  and nothing in the polling path touches it at all",
      "mine.setValue(" not in after_mirror,
      "a class losing their own work is the one unforgivable bug here")

mirror_opts = live_code[live_code.index('fromTextArea($("mirror")'):]
mirror_opts = mirror_opts[:mirror_opts.index("});")]
# THE TEACHER'S CODE IS NOT LIFTABLE. Without this a student drags across
# the mirror, presses Ctrl+C, and has the whole lesson in their own editor
# in two seconds — which is why there is no copy button either.
css = open(os.path.join(PYIDE, "static", "style.css")).read()
mirror_css = css[css.index(".live-mirror,"):]
mirror_css = mirror_css[:mirror_css.index("}")]
# ANCHORED TO THE START OF THE LINE. `"user-select: none" in block` looks
# right and is not: `-webkit-user-select: none` contains it as a substring,
# so flipping the real property to `text` left the check passing and the
# teacher's code selectable. Both of these were written the lazy way first
# and both passed a deliberately broken stylesheet.
def declares(block, prop, value):
    return re.search(r"(?m)^\s*%s:\s*%s\s*;" % (prop, value), block) is not None


check("the teacher's code cannot be selected",
      declares(mirror_css, "user-select", "none"),
      "a drag and Ctrl+C would lift the whole lesson")
check("  including on the browsers that need the prefix",
      declares(mirror_css, "-webkit-user-select", "none"))
mine_css = css[css.index(".live-mine,"):]
mine_css = mine_css[:mine_css.index("}")]
check("  while the student's own editor still can be",
      declares(mine_css, "user-select", "text"),
      "their own work has to be copyable — it is theirs")
check("  and a copy made some other way is refused",
      re.search(r'\["copy", "cut"\]', live_code) is not None
      and "preventDefault" in live_code,
      "user-select is a hint; find-on-page and extensions get round it")

# A .md FILE IS A LINK THE CLASS CAN CLICK.
#
# The teacher opens a notes tab, puts an address in it, and it renders on
# thirty screens as a real link. Without this it arrives as
# `[click here](http://…)` in grey in a code pane, which is worse than
# useless in front of a room.
check("the live page can render notes, not just code",
      'id="mirror-notes"' in page and "notes.js" in page)
check("  and switches to them on a .md filename",
      "PyIDENotes.isMarkdown(data.filename)" in live_code,
      "the filename is already on the wire; this is what reads it")
check("  rendering through the same sanitiser the editor uses",
      "PyIDENotes.render(mirrorNotes" in live_code,
      "notes.js drops scripts and forces links to a new tab")
# THE GUARD, not the variable's name. Checking that `lastNotes` appears
# somewhere passed happily when the condition it guards was replaced by
# `true` — the name was still in the file, doing nothing.
check("  and re-renders only when the text changed",
      re.search(r"data\.body\s*!==\s*lastNotes", live_code) is not None,
      "re-parsing every second replaces the link under the cursor, so a "
      "click that lands mid-poll hits a dead element")
# CodeMirror measures itself on build. Measured while display:none it
# measures zero and comes back blank — switching tabs in front of a class is
# exactly when that happens.
check("  and the code pane is refreshed on the way back",
      "mirror.refresh()" in live_code,
      "CodeMirror returns from a hidden container as an empty box")
# Verified in a real browser against these exact rules: the teacher's code
# and notes text compute to user-select none, and a link inside the notes
# computes to text. The :not(.is-authoring) rule applies because the live
# page's body is is-live.
check("  with links inside the notes still usable",
      re.search(r"(?m)^body:not\(\.is-authoring\) \.notes-body a \{", css)
      is not None and "is-live" in page,
      "unselectable notes with an unclickable link would be pointless")

# THE CLIENT HALF. The server can do all of this correctly and the feature
# still be broken, because it is live.js that chooses which endpoint to call
# — and /api/draft makes a project with no assignment, which is the thing
# that could never be turned in. Swapping the URL back passed the entire
# server-side suite untouched.
# The chooser must not read as "open this lesson" — it decides where the
# CLASS's work goes, and the first wording sent a teacher looking for code
# that never loaded.
app_code = code_only(app_js)
check("the chooser says what it actually does",
      "Where should the class turn this work in?" in app_code
      and "does not change what is in your editor" in app_code,
      "the old wording read like it was about to open the assignment")
check("  and loading the starter is a separate, confirmed step",
      "function offerStarter" in app_code
      and re.search(r"offerStarter[\s\S]{0,800}window\.confirm", app_code)
      is not None,
      "it replaces the editor, so it cannot be silent")
check("  which the reload-resume path never takes",
      re.search(r'if \(resumeCode\) startLive\(undefined, resumeCode\);',
                app_code) is not None,
      "resuming a broadcast must not wipe what is being demonstrated")

check("the live page saves through the lesson, not as a loose project",
      "/keep" in live_code and 'fetch("/api/draft"' not in live_code,
      "/api/draft makes a draft with no assignment, which cannot be handed in")
check("  and offers Turn in only once the save says it can",
      "can_turn_in" in live_code and "canTurnIn" in live_code)
# WHAT TURN IN POSTS, which the server-side checks above cannot see: they
# build the payload themselves. Posting an empty file map is accepted by the
# server and deletes every other file in the project, at the moment the work
# is handed in.
submit_call = live_code[live_code.index('"/api/submit"'):]
submit_call = submit_call[:submit_call.index("}).then")]
check("  turning in posts the whole project, not an empty map",
      "saved.files" in submit_call and "files: {}" not in submit_call,
      "an empty map wipes the assignment's own files on hand-in")
check("  having saved it first, so the two agree",
      "keep().then" in live_code,
      "otherwise what is handed in is not what was saved")

check("  handing in through the editor's own endpoint",
      '"/api/submit"' in live_code,
      "so the dashboard sees the same thing either way")

check("the mirror cannot be typed into",
      '"nocursor"' in mirror_opts,
      "a plain readOnly still takes a cursor, so it looks typeable")

check("the teacher's push carries a stamp that only goes up",
      "function nextSeq" in app_js and "Math.max(Date.now()" in app_js)
check("  and the server refuses a lower one",
      "LiveSession.version < seq" in app_src,
      "without this, late pushes overwrite newer text")

check("the poll answers 304 when nothing changed",
      'return ("", 304)' in app_src)

# The editor's own rule for game mode: the output becomes a log strip under
# the picture. Without the class the stylesheet has nothing to hook, and the
# output pane fights the canvas for the right-hand column.
check("a game turns the output into a strip under the picture",
      'classList.add("is-game")' in live_code
      and 'classList.remove("is-game")' in live_code,
      "the editor sets the same class; the rule is already in style.css")
check("  and the stylesheet has a rule for it",
      "body.is-game" in open(os.path.join(PYIDE, "static", "style.css")).read())

# STOP HAS TO PUT THE TOOLBAR BACK ITSELF.
#
# Reproduced on the deployed editor: press Stop on a kaypy game and the
# canvas freezes and "— stopped —" is printed, but the await on
# `_pyide_drive_game()` never settles, so Run stays disabled on "Running…"
# with Stop showing until the page is reloaded. Leaving the reset to the
# promise's finally is leaving it to something that may never run.
for name, src in (("live.js", live_code),
                  ("app.js", code_only(app_js))):
    stop_fn = src[src.index("function stopRun"):]
    stop_fn = stop_fn[:stop_fn.index("\n  }")]
    check("%s: Stop puts the toolbar back without waiting for the promise"
          % name,
          "setBusy(false" in stop_fn,
          "the game stops but the button says Running… for ever")

# And the promise, if it ever does settle, must not reset a LATER run.
for name, src in (("live.js", live_code),
                  ("app.js", code_only(app_js))):
    check("  %s: and a stale run cannot reset a newer one" % name,
          "runToken" in src and "token === runToken" in src,
          "an old finally would stop the game that is running now")

check("a finished lesson stops the polling",
      'throw new Error("ended")' in live_code,
      "thirty browsers polling an ended lesson until home time")

# THE SNIPPET IS THE ONE THING FROM THE NETWORK THAT MAY REACH THE STUDENT'S
# EDITOR, and only by their own click. Every write into `mine` other than
# the localStorage restore has to be inside insertSnippet, and insertSnippet
# has to be called from the Insert button and nowhere else — in particular
# not from the poll, which would put the teacher's code into thirty editors
# without anyone pressing anything.
def fn_body(src, name):
    start = src.find("function %s(" % name)
    if start < 0:
        return ""
    depth, i = 0, src.index("{", start)
    while i < len(src):
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        if depth == 0:
            return src[start:i + 1]
        i += 1
    return ""

insert_fn = fn_body(live_code, "insertSnippet")
# The Sprites panel is the one other writer, and it carries nothing from the
# network — the text is sprites.js's load line for a picture the student
# clicked. It is allowed by name, and pinned below to the panel alone, so it
# cannot become a second road for the teacher's code.
sprite_fn = fn_body(live_code, "insertSprite")
outside = live_code
for f in (insert_fn, sprite_fn):
    if f:
        outside = outside.replace(f, "")
writes = re.findall(r"mine\.(replaceRange|replaceSelection)\(", outside)
check("the snippet is written into their editor only by insertSnippet",
      bool(insert_fn) and not writes,
      "other writes: %s" % writes)
sprite_uses = [m.start() for m in re.finditer(r"\binsertSprite\b", live_code)
               if not live_code[:m.start()].endswith("function ")]
check("  and the sprite insert is handed to the Sprites panel and nothing else",
      bool(sprite_fn) and len(sprite_uses) == 1
      and re.search(r"attachPanel\(\{\s*insert: insertSprite,", live_code)
      and "replaceSelection(text" in sprite_fn
      and "L." not in sprite_fn,
      "%d use(s)" % len(sprite_uses))
callers = [m.start() for m in re.finditer(r"insertSnippet\(", live_code)]
calls = [c for c in callers if not live_code[:c].endswith("function ")]
click = live_code.find('$("snippet-insert").addEventListener("click"')
click_block = live_code[click:live_code.find("});", click)] if click >= 0 else ""
check("  and insertSnippet runs only from the Insert button",
      len(calls) == 1 and "insertSnippet(" in click_block,
      "%d call(s)" % len(calls))
check("  and the poll only fills the card",
      "insertSnippet" not in fn_body(live_code, "showSnippet")
      and "insertSnippet" not in fn_body(live_code, "showMirror")
      and "insertSnippet" not in fn_body(live_code, "poll"))

# Insert goes where the student is, and never through the middle of a line
# they wrote. The function is lifted and run in node against a stand-in
# editor, because "indents to match" is exactly the kind of thing a reading
# of the code gets wrong.
import shutil
import subprocess
if shutil.which("node") and insert_fn:
    harness = r"""
function makeEditor(text, line, ch) {
  var lines = text.split("\n");
  return {
    getCursor: function () { return { line: line, ch: ch }; },
    getLine: function (n) { return lines[n]; },
    replaceRange: function (t, from, to) {
      var all = lines.join("\n");
      function off(p) {
        var o = 0; for (var i = 0; i < p.line; i++) o += lines[i].length + 1;
        return o + p.ch;
      }
      var a = off(from), b = to ? off(to) : a;
      lines = (all.slice(0, a) + t + all.slice(b)).split("\n");
    },
    focus: function () {},
    value: function () { return lines.join("\n"); }
  };
}
function note() {}
var mine;
%s
var out = {};
mine = makeEditor("def f():\n    ", 1, 4);
insertSnippet("x = 1\ny = 2\n");
out.inBlock = mine.value();
mine = makeEditor("print(1)", 0, 3);
insertSnippet("if a:\n    b()");
out.midLine = mine.value();
mine = makeEditor("", 0, 0);
insertSnippet("        z = 3\n        w = 4");
out.teacherIndent = mine.value();
console.log(JSON.stringify(out));
""" % insert_fn
    res = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    try:
        got = json.loads(res.stdout)
    except ValueError:
        got = {}
    check("Insert on an indented blank line keeps the block's indentation",
          got.get("inBlock") == "def f():\n    x = 1\n    y = 2",
          repr(got.get("inBlock") or res.stderr[-200:]))
    check("  mid-line it goes on the next line, not through their code",
          got.get("midLine") == "print(1)\nif a:\n    b()",
          repr(got.get("midLine")))
    check("  and the teacher's own indentation is not carried over",
          got.get("teacherIndent") == "z = 3\nw = 4",
          repr(got.get("teacherIndent")))
else:
    check("node is available to run insertSnippet", False,
          "brew install node")

# The teacher's side: a push that comes back stale must be pushed again.
check("app.js pushes again after losing to a send",
      re.search(r"data\.stale\) lastSent = null", code_only(app_js)) is not None,
      "the class would sit on the old file until the next keystroke")
check("  and the send menu only opens while live with a selection",
      "if (!liveCode || !cm.somethingSelected()) return;" in code_only(app_js))

# Resuming (see "Resuming after a reload" above): the editor's half.
_app_code = code_only(open(os.path.join(PYIDE, "static", "app.js")).read())
check("the editor sends the remembered code when it resumes",
      re.search(r"startLive\(undefined, resumeCode\)", _app_code) is not None
      and "resume: resume" in _app_code)
check("  and forgets it when the server says that lesson is over",
      re.search(r"data\.resumed === false\)\s*\{[^}]*forgetLive\(\);", _app_code) is not None)
check("  and forgets it on any page with no Go live button",
      re.search(r'\}\s*else\s*\{\s*try\s*\{\s*sessionStorage\.removeItem\("pyide-live-host"\);', _app_code)
      is not None)
# Only the tab that went live, on the page it went live from, rejoins. The
# marker was shared by the whole browser, so any editor the teacher opened
# while live took over the broadcast with its own file — the class watched
# an untitled default template while the teacher typed in another tab.
check("the lesson is remembered per tab, not for the whole browser",
      'sessionStorage.setItem(HOST_KEY, JSON.stringify({ code: code, path: location.pathname }));'
      in _app_code and "localStorage.setItem(HOST_KEY" not in _app_code
      and 'localStorage.setItem("pyide-live-host"' not in _app_code,
      "any editor tab would take over the class's screens")
check("  and rejoined only on the page it went live from",
      'return saved && saved.path === location.pathname ? saved.code : null;' in _app_code
      and "var resumeCode = liveToResume();" in _app_code)
check("  and the old shared marker is cleared, so it can never rejoin anything",
      "try { localStorage.removeItem(HOST_KEY); }" in _app_code)

# The notes pane: the editor sends the project's first .md on every push,
# and changing only the notes still counts as something to push — otherwise
# a teacher editing the notes while main.py is open would send nothing.
_push = code_only(open(os.path.join(PYIDE, "static", "app.js")).read())
_push_fn = _push[_push.index("function pushNow"):]
_push_fn = _push_fn[:_push_fn.index("\n    }\n")]
check("the editor sends the notes with every push",
      "notes: notes" in _push_fn and "var notes = liveNotes();" in _push_fn)
check("  and a change to the notes alone is pushed",
      re.search(r"var stamp = [^;]*\bnotes\b", _push_fn) is not None,
      "editing the notes with main.py open would reach nobody")
check("  and they are the project's first .md, as the handout link opens",
      re.search(r"function notesFile\(\)[\s\S]{0,200}fileNames\(\)\.filter\(window\.PyIDENotes\.isMarkdown\)[\s\S]{0,80}md\[0\]",
                _push) is not None
      and re.search(r"function liveNotes\(\)\s*\{\s*var md = notesFile\(\);",
                    _push) is not None)
_mirror_fn = live_code[live_code.index("function showMirror"):]
_mirror_fn = _mirror_fn[:_mirror_fn.index("\n  }\n")]
check("the live page shows them on every update, not only the first",
      "showNotes(data);" in _mirror_fn)
check("  and on the page's first paint, before any poll",
      re.search(r"showMirror\(\{[^}]*notes: L\.notes", live_code) is not None,
      "the first poll answers 304, so a late joiner would never see them")
_notes_fn = live_code[live_code.index("function showNotes"):]
_notes_fn = _notes_fn[:_notes_fn.index("\n  }\n")]
check("  through the slide viewer, which re-renders only when the slide changes",
      "notesSlides.show(data.notes, jump);" in _notes_fn
      and "if (text === drawn) return Promise.resolve(true);"
      in open(os.path.join(PYIDE, "static", "notes.js")).read(),
      "a re-render every second replaces the link a student is clicking")
check("  and jumps to the teacher's slide only when the teacher moves",
      re.search(r"if \(slide !== teacherSlide\) \{\s*teacherSlide = slide;", _notes_fn)
      is not None,
      "typing on the same slide would drag back every student who read ahead")

# ------------------------------------------------ slides and output, built
# The teacher's output goes in its own <pre>. The student's #output is where
# input() takes their typing, and is theirs exactly as their editor is.
_tout = fn_body(live_code, "showTeacherOutput")
check("the teacher's output is written only into its own pane",
      "teacherOut.textContent = data.output" in _tout
      and not re.search(r"outputEl[^;]*data\.output|data\.output[^;]*outputEl|write\(data\.output",
                        live_code),
      "the student's own output pane must never be given it")
check("  appearing with the first output and then staying",
      "if (!data.output || !teacherView.hidden) return;" in _tout
      and "teacherView.hidden = true" not in live_code,
      "an empty push mid-Run would make the code beside it jump sideways")
check("  and the mirror re-measured when it appears",
      re.search(r"teacherView\.hidden = false;[\s\S]{0,300}mirror\.refresh\(\)",
                _tout) is not None)
check("the editor sends its caret with every push, and moving it counts",
      "cursor: cursor, seq: nextSeq()" in _push_fn
      and re.search(r"var stamp = [^;]*\bcursor\b", _push_fn) is not None,
      "a caret moved without typing would reach nobody")
check("  but none for a notes file, which the class reads rendered",
      re.search(r"if \(docs\[name\] && !window\.PyIDENotes\.isMarkdown\(name\)\)",
                _push_fn) is not None)
check("the mirror draws the caret on every update",
      re.search(r"showCaret\(typeof data\.cursor", _mirror_fn) is not None
      and re.search(r"showMirror\(\{[^}]*cursor: L\.cursor", live_code)
      is not None)
_caret_fn = fn_body(live_code, "showCaret")
check("  as a widget, so the mirror still takes no cursor",
      "setBookmark(at, { widget: mark" in _caret_fn
      and "mirror.setCursor" not in live_code
      and "mirror.setSelection" not in live_code)
check("  and follows it, unless the student has just scrolled",
      "if (Date.now() >= followAfter) mirror.scrollIntoView(show" in _caret_fn
      and re.search(r'\["wheel", "touchmove", "mousedown"\][\s\S]{0,160}'
                    r'followAfter = Date\.now\(\) \+ FOLLOW_PAUSE_MS',
                    live_code) is not None,
      "a student reading line 4 would be yanked to line 40 every keystroke")
check("the editor sends a highlighted block as anchor-head",
      re.search(r"somethingSelected\(\)\) \{\s*var from = docs\[name\]"
                r"\.getCursor\(\"anchor\"\);\s*cursor = from\.line \+ \":\" \+ "
                r"from\.ch \+ \"-\" \+ cursor;", _push_fn) is not None,
      "dragging across a block to talk about it would show nobody anything")
check("  and the mirror paints it yellow as a mark, not a selection",
      'mirror.markText(from, to, { className: "mirror-pick" })' in _caret_fn
      and ".live-mirror .mirror-pick" in open(
          os.path.join(PYIDE, "static", "style.css")).read())
check("  in order even when dragged upwards",
      "CodeMirror.cmpPos(other, at) > 0" in _caret_fn,
      "markText with from after to marks nothing")
check("  and cleared with the caret",
      "if (pickMark) { pickMark.clear(); pickMark = null; }"
      in fn_body(live_code, "clearCaret"),
      "every highlight would stay yellow forever")
check("  clearing the old caret before the text is replaced",
      re.search(r"data\.body !== mirror\.getValue\(\)\) \{\s*clearCaret\(\);",
                _mirror_fn) is not None,
      "a removed line's handle throws, and the poll would stop")

# The output pane, folded until wanted.
check("the output pane starts folded",
      'id="output-view" class="subpane is-folded"' in open(os.path.join(PYIDE, "templates", "live.html")).read()
      and re.search(r"\n  openConsole\(false\);", live_code) is not None)
check("  and the student's own Run opens it",
      re.search(r"async function run\(\)[\s\S]{0,260}openConsole\(true\)",
                live_code) is not None,
      "a program waiting on input() in a folded pane looks hung")

check("the editor sends the slide and its output with every push",
      "slide: slide, output: output" in _push_fn
      and re.search(r"var stamp = [^;]*\bslide\b[^;]*\boutput\b", _push_fn)
      is not None,
      "moving a slide, or a Run, would otherwise reach nobody")
check("  the WHOLE notes go out, so students can move through the slides",
      "var notes = liveNotes();" in _push_fn
      and len(re.findall(r"(?<![\w.])notes\s*=(?!=)", _push_fn)) == 1
      and "notes: notes," in _push_fn,
      "one slide at a time, nobody could read ahead or go back to a question")
check("  and the notes tab, if open, mirrors the teacher's slide, not the file",
      "if (name === notesFile()) text = onSlide;" in _push_fn,
      "the mirror would put every slide on screen at once")
check("the teacher sees the slide the class is sent to",
      "paintClassView(onSlide, slide);" in _push_fn
      and _push_fn.index("onSlide = cut[slideAt];")
          < _push_fn.index("paintClassView(onSlide, slide);")
          < _push_fn.index("if (stamp === lastSent) return;"),
      "fed anything but what is sent, it can show a slide the class is not on")
_class_fn = fn_body(_push, "paintClassView")
check("  re-rendered only when it changes",
      "if (notes === classShownNotes && slide === classShownSlide) return;"
      in _class_fn,
      "pushNow runs every tick; re-rendering resets the teacher's scroll")
check("  and put away when the lesson ends",
      re.search(r"function paintLive\(\)[\s\S]*?\} else \{[\s\S]*?paintClassView\(null, \"\"\);",
                _push) is not None)
# Show all, and the slide controls in the Class sees pane head.
r = teacher.get("/")
_page = r.get_data(as_text=True)
_cv = _page.find('id="class-view"')
check("the slide controls sit in the Class sees pane, not the top bar",
      -1 < _cv < _page.find('id="live-slides"') < _page.find('id="class-notes"'),
      "the top bar had no room for them")
check("  and no Show all: students move through the slides themselves",
      'id="slide-whole"' not in _page and "wholeNotes" not in _push,
      "it sent the whole file as one page, which the class now always has")
check("  the arrows' [hidden] really hides them",
      re.search(r"\.slide-ctl \.btn\[hidden\]\s*\{\s*display:\s*none",
                open(os.path.join(PYIDE, "static", "style.css")).read())
      is not None,
      ".btn sets display, so [hidden] alone shows them anyway")
check("  and no output is sent before the first Run",
      re.search(r"function liveOutput\(\)\s*\{\s*if \(!hasRun\) return \"\";",
                _push) is not None,
      "every class would be shown 'Python is ready' as if it were a program")

# The splitter, run for real on the notes this feature was asked for.
notes_js = open(os.path.join(PYIDE, "static", "notes.js")).read()
if shutil.which("node"):
    # Cut where the author drew a ---, and nowhere else. The first version
    # cut at every `## ` heading, and this sample is what it got wrong: the
    # ### slide was glued onto the one before it, the slide with two ##
    # sections was cut in half, and the --- straight under a line of text
    # did not end its slide at all.
    sample = (
        "# Looping Over a List\n\n---\n\n## for Each Item\n\n"
        "```python\n## a comment\nfor e in enemies:\n    print(e)\n```\n\n"
        "```text\n---\n```\n\n---\n\n"
        "## enumerate()\n\nPosition and item.\n\n## zip()\n\nTwo lists.\n\n---\n\n"
        "### still a slide of its own\nNo blank line before the rule.\n---\n"
        "## ✏ Mini Assignment\n\n> Extension\n")
    harness = "var window = {};\n" + notes_js + """
var N = window.PyIDENotes;
console.log(JSON.stringify({
  cut: N.slides(%s),
  none: N.slides("# Just notes\\n\\n## A section\\n\\n## Another\\n"),
  crlf: N.slides("## A\\r\\nx\\r\\n---\\r\\n## B\\r\\ny")
}));
""" % json.dumps(sample)
    res = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    try:
        got = json.loads(res.stdout)
    except ValueError:
        got = {}
    cut = got.get("cut") or []
    check("notes split into slides at each --- and nowhere else",
          len(cut) == 5 and cut[0] == "# Looping Over a List"
          and cut[1].startswith("## for Each Item")
          and cut[4].startswith("## ✏ Mini Assignment"),
          repr([c[:20] for c in cut] or res.stderr[-200:]))
    check("  a slide holding two ## sections stays one slide",
          len(cut) > 2 and cut[2].startswith("## enumerate()")
          and cut[2].endswith("Two lists."),
          repr(cut[2] if len(cut) > 2 else ""))
    check("  a slide headed by ### is its own slide",
          len(cut) > 3 and cut[3].startswith("### still a slide of its own"),
          repr(cut[3] if len(cut) > 3 else ""))
    check("  a --- straight under a line of text still ends the slide",
          len(cut) > 3 and cut[3].endswith("No blank line before the rule."),
          repr(cut[3] if len(cut) > 3 else ""))
    check("  ## and --- inside a code fence do not cut it",
          len(cut) > 1 and "## a comment" in cut[1]
          and "```text\n---\n```" in cut[1],
          "a line of output would cut a slide in half")
    check("  the --- itself is not shown on either side",
          all(not c.startswith("---") and not c.endswith("---") for c in cut),
          repr(cut[1][-12:] if len(cut) > 1 else ""))
    check("  notes with ## headings but no --- are not slides at all",
          got.get("none") == [], repr(got.get("none")))
    check("  Windows line endings split the same way",
          got.get("crlf") == ["## A\nx", "## B\ny"], repr(got.get("crlf")))
else:
    check("node is available to run the slide splitter", False,
          "brew install node")

# ------------------------------------- reopening, as the browsers do it
print("\nReopening, in the browsers")

_app_now = code_only(open(os.path.join(PYIDE, "static", "app.js")).read())
_teach_fn = fn_body(_app_now, "teachAgain")
check("app.js reopens only from Teach this lesson again",
      'startLive(undefined, "", code);' in _teach_fn
      and len(re.findall(r'(?<!function )startLive\([^)]*,[^)]*,', _app_now)) == 1
      and "offerReopen" not in _app_now,
      "a reopen from anywhere else is the teacher back on the air unasked")
check("  and only when the link asked for it",
      re.search(r'if \(teach\) \{[\s\S]{0,200}?history\.replaceState\([\s\S]{0,120}?teachAgain\(teach, teachFor\);',
                _app_now) is not None,
      "left in the address bar, a reload would load the starter over the lesson")
check("  and the reload path never asks for one",
      'startLive(undefined, resumeCode);' in _app_now)

# What it does, run for real: the project goes into the editor BEFORE the
# lesson reopens, so the first push the class sees is the lesson's code and
# not whatever the editor happened to be showing.
if shutil.which("node") and _teach_fn:
    harness = """
var log = [], docs = {"main.py": {v: "default", setValue: function (t) { this.v = t; }}};
function makeDoc(t) { return {v: t, setValue: function (x) { this.v = x; }}; }
function loadStarter(code, files) { log.push("starter"); docs["main.py"].setValue(code);
  Object.keys(files).forEach(function (n) { docs[n] = makeDoc(files[n]); }); }
function switchTo(n) { log.push("switch " + n); }
function startLive(a, r, code) { log.push("live " + code + " " + docs["main.py"].v
  + " " + (docs["notes.md"] ? docs["notes.md"].v : "-")); }
var replies = %s;
function fetch(url) { return Promise.resolve({json: function () {
  return Promise.resolve(replies[url.split("?")[0]]); }}); }
%s
var which = process.argv[1];
teachAgain("abc", which === "noassign" ? "" : "hw1");
setTimeout(function () { console.log(JSON.stringify(log)); }, 50);
"""
    def run_teach(which, last):
        h = harness % (json.dumps({
            "/api/live/assignment/hw1": {"title": "HW", "code": "starter code",
                                        "files": {"notes.md": "# notes"}},
            "/api/live/abc": last}), _teach_fn)
        res = subprocess.run(["node", "-e", h, which], capture_output=True, text=True)
        return json.loads(res.stdout) if res.returncode == 0 else [res.stderr[-200:]]
    got = run_teach("assign", {"body": "yesterday's end", "filename": "main.py"})
    check("teach again loads the starter, then yesterday's code, then goes live",
          got == ["starter", "switch main.py", "live abc yesterday's end # notes"], got)
    got = run_teach("assign", {"body": "## edited notes", "filename": "notes.md"})
    check("  a lesson that ended on the notes leaves the notes as written",
          got == ["starter", "live abc starter code # notes"], got)
    got = run_teach("noassign", {"body": "x = 1", "filename": "main.py"})
    check("  and with no assignment it still brings the code back",
          got == ["switch main.py", "live abc x = 1 -"], got)
else:
    check("node is available to run teachAgain", False, "brew install node")

_live_now_js = code_only(open(os.path.join(PYIDE, "static", "live.js")).read())
# THE BUG: one `seen` for both the draft's version and the lesson's, so the
# first poll wrote the lesson's version over the draft's and every Save from
# a student with an earlier draft was refused as "changed in another tab".
check("live.js keeps the draft's version apart from the lesson's",
      len(re.findall(r'\bvar seen\b', _live_now_js)) == 1
      and "payload.base = draftSeen" in _live_now_js
      and re.search(r'function saw\(data\) \{[^}]*draftSeen = data\.version',
                    _live_now_js) is not None,
      "a reopened lesson would refuse every student's first Save")

# Which copy a student's editor starts from, run for real. Lifted from
# `var kept = null;` to the line that decides, and run against a stand-in
# localStorage — a reopened lesson has the same code, so the same keys, as
# yesterday.
_m = re.search(r'(  var kept = null;.*?  var start = kept !== null \? kept : '
               r'\(L\.starter \|\| ""\);)', _live_now_js, re.S)
if shutil.which("node") and _m:
    harness = """
var cases = %s, out = {};
Object.keys(cases).forEach(function (k) {
  var c = cases[k], store = Object.assign({}, c.store);
  var window = {localStorage: {
    getItem: function (n) { return n in store ? store[n] : null; },
    setItem: function (n, v) { store[n] = String(v); },
    removeItem: function (n) { delete store[n]; }}};
  var DRAFT_KEY = "pyide-live-abc", L = c.L;
  %s
  out[k] = {start: start, base: store[DRAFT_KEY + "-base"] || null,
            files: store[DRAFT_KEY + "-files"] || null};
});
console.log(JSON.stringify(out));
""" % (json.dumps({
        "homework_since": {"L": {"draftVersion": 9, "starter": "last night"},
                           "store": {"pyide-live-abc": "yesterday",
                                     "pyide-live-abc-files": "{}",
                                     "pyide-live-abc-base": "4"}},
        "nothing_since": {"L": {"draftVersion": 4, "starter": "server"},
                          "store": {"pyide-live-abc": "typed here",
                                    "pyide-live-abc-base": "4"}},
        "kept_before_this": {"L": {"draftVersion": 9, "starter": "server"},
                             "store": {"pyide-live-abc": "typed here"}},
        "signed_out": {"L": {"draftVersion": None, "starter": ""},
                       "store": {"pyide-live-abc": "typed here",
                                 "pyide-live-abc-base": "4"}},
    }), _m.group(1))
    res = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    got = json.loads(res.stdout or "{}") if res.returncode == 0 else {}
    h = got.get("homework_since", {})
    check("their draft saved elsewhere since: the draft wins, not this browser",
          h.get("start") == "last night", h or res.stderr[-300:])
    check("  and the old copy is let go, so a reload does not bring it back",
          h.get("base") == "9" and h.get("files") is None, h)
    n = got.get("nothing_since", {})
    check("nothing saved since: this browser's typing wins, as always",
          n.get("start") == "typed here", n)
    k = got.get("kept_before_this", {})
    check("a copy kept before this existed still wins",
          k.get("start") == "typed here", k)
    check("  and is stamped, so tomorrow it can be told apart",
          k.get("base") == "9", k)
    o = got.get("signed_out", {})
    check("signed out, with no draft: this browser's typing wins",
          o.get("start") == "typed here", o)
else:
    check("node is available to run the live page's start-up", bool(_m),
          "brew install node" if _m else "the block in live.js moved")

# ------------------------------------------ a game, the output and notes
# The canvas is 800x600 scaled to the column's width and did not shrink, and
# the notes were a fixed 45% — so on a laptop the output between them was
# squeezed to nothing and drawn over the notes, on the class's page and in
# the teacher's editor alike. In game mode the canvas is capped by the
# screen's height and the other two share what is left.
_gcss = open(os.path.join(PYIDE, "static", "style.css")).read()
def _rule(sel):
    m = re.search(r"(?m)^%s[^{]*\{([^}]*)\}" % re.escape(sel), _gcss)
    return m.group(1) if m else ""
check("in game mode the canvas is capped by the screen's height",
      re.search(r"max-height:\s*\d+vh", _rule("body.is-game .pane-right #canvas")) is not None,
      "a full-width canvas pushed the output and notes off the column")
check("  and the output keeps enough room to read",
      re.search(r"min-height:\s*\d{2,}px", _rule("body.is-game .pane-right #output-view")) is not None)
check("  and so do the notes, on both pages",
      "body.is-game .live-right .live-notes" in _gcss
      and re.search(r"min-height:\s*\d{2,}px", _rule("body.is-game .pane-right .class-view")) is not None
      and re.search(r"flex:\s*1 1 0", _rule("body.is-game .pane-right .class-view")) is not None)

# ------------------------------------------------ the slide viewer, run
# notes.js's slideView, in node, with just enough of a DOM to hold it. It is
# what the editor, a shared link and the class's live page all show notes
# through, so how it cuts, numbers and moves is checked by running it.
print("\nThe slide viewer, run")
_notes_src = open(os.path.join(PYIDE, "static", "notes.js")).read()
if shutil.which("node"):
    harness = r"""
function El(tag) {
  this.tag = tag; this.children = []; this.hidden = false; this.disabled = false;
  this.textContent = ""; this.className = ""; this.handlers = {}; this.scrollTop = 0;
  this._html = ""; this.renders = 0;
}
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.insertBefore = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.setAttribute = function () {};
El.prototype.addEventListener = function (ev, fn) { this.handlers[ev] = fn; };
El.prototype.querySelectorAll = function () { return []; };
Object.defineProperty(El.prototype, "innerHTML", {
  get: function () { return this._html; },
  set: function (v) { this._html = v; this.renders++; } });
var document = { createElement: function (t) { return new El(t); } };
var window = { marked: { parse: function (s) { return s; } },
               DOMPurify: { sanitize: function (s) { return s; } } };
""" + _notes_src + r"""
var N = window.PyIDENotes;
var pane = new El("div"), body = pane.appendChild(new El("div"));
var v = N.slideView(body), bar = v.bar;
var prev = bar.children[0], pos = bar.children[1], next = bar.children[2];
var moves = [];
v.onMove(function (i) { moves.push(i); });
var deck = "# One\n\n---\n\n## Two\n\n---\n\n## Three";
var out = {};
(async function () {
  await v.show(deck);
  out.first = [body.innerHTML, pos.textContent, bar.hidden, prev.disabled];
  next.handlers.click(); await null; await null;
  out.next = [body.innerHTML, pos.textContent, moves.slice()];
  await v.show(deck, 2);
  out.snap = [body.innerHTML, moves.slice()];
  var before = body.renders;
  await v.show(deck);
  out.sameAgain = body.renders - before;
  await v.show(deck.replace("## Three", "## Three, edited"));
  out.edited = [body.innerHTML, v.at()];
  await v.show("# Just one page\n\nNo dividers.");
  out.whole = [body.innerHTML, bar.hidden];
  console.log(JSON.stringify(out));
})();
"""
    res = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    try:
        got = json.loads(res.stdout)
    except ValueError:
        got = {}
    check("notes with --- open on the first slide, with arrows under them",
          got.get("first") == ["# One", "1 / 3", False, True],
          repr(got.get("first") or res.stderr[-300:]))
    check("  ▶ moves on, and says so to whoever is listening",
          got.get("next") == ["## Two", "2 / 3", [1]], repr(got.get("next")))
    check("  being sent to a slide is not reported as the reader moving",
          got.get("snap") == ["## Three", [1]],
          "the live page would take its own snapping for a student wandering off")
    check("  the same notes again do not re-render",
          got.get("sameAgain") == 0,
          "every poll would replace the slide under the student's hand")
    check("  editing a slide keeps the reader on it",
          got.get("edited") == ["## Three, edited", 2], repr(got.get("edited")))
    check("  notes with no --- are shown whole, with no arrows",
          got.get("whole") == ["# Just one page\n\nNo dividers.", True],
          repr(got.get("whole")))
else:
    check("node is available to run the slide viewer", False, "brew install node")

# ---------------------------------------- a lesson's link, made ahead
print("\nA lesson's link, made ahead from the assignment page")
ahead = teacher.post("/api/assignment", json={
    "title": "Tomorrow", "code": "print('x')\n",
    "files": {"notes.md": "# Tomorrow\n"}}).get_json()["slug"]
page = teacher.get("/teacher/" + ahead).get_data(as_text=True)
_ahead = re.search(r'id="live-url" type="text" readonly value="[^"]*/live/([a-z0-9]+)"', page)
check("the assignment page shows a live lesson link under the handout link",
      _ahead is not None
      and page.index("The link to hand out") < page.index("The live lesson link"))
AHEAD = _ahead.group(1) if _ahead else ""
again = re.search(r'/live/([a-z0-9]+)"', teacher.get("/teacher/" + ahead).get_data(as_text=True))
check("  the same link every time the page is opened",
      again is not None and again.group(1) == AHEAD,
      "the link posted in Classroom yesterday would no longer be the lesson")
_r = lesson_row(AHEAD)
check("  made ended and never pushed: not on anyone's screen yet",
      _r is not None and _r.ended == 1 and _r.version == 0
      and _r.assignment_id is not None)
check("  and not the teacher's open lesson, so Go live elsewhere is untouched",
      teacher.post("/api/live/start", json={"resume": AHEAD}).get_json().get("resumed") is False)
poll = stranger.get("/api/live/" + AHEAD).get_json()
check("a student opening it early is told it has not started",
      poll.get("ended") is True and poll.get("waiting") is True, repr(poll)[:120])
check("  and their page keeps checking, slowly, rather than giving up",
      re.search(r"if \(data\.ended && data\.waiting\) \{\s*waiting = true;", live_code) is not None
      and "setTimeout(poll, waiting ? WAITING_MS : POLL_MS);" in live_code,
      "a student who opened the link early would sit on a dead page")
host = teacher.get("/live/" + AHEAD).get_data(as_text=True)
check("its teacher, opening it, is offered Start this lesson",
      "Start this lesson" in host and "Ready when you are" in host)
r = teacher.get("/teacher/%s/live" % ahead)
check("Go live on the dashboard opens the editor on that lesson",
      r.status_code == 302 and ("teach=" + AHEAD) in r.headers.get("Location", "")
      and ("a=" + ahead) in r.headers.get("Location", ""),
      r.headers.get("Location", r.status_code))
check("  and the assignments list has a Go live for each assignment",
      ('/teacher/%s/live' % ahead) in teacher.get("/teacher").get_data(as_text=True))
check("  which nobody else can use",
      student.get("/teacher/%s/live" % ahead).status_code == 404
      and other.get("/teacher/%s/live" % ahead).status_code == 404)
r = teacher.post("/api/live/start", json={"reopen": AHEAD, "body": "print(1)",
                                          "filename": "main.py"})
teacher.post("/api/live/%s/push" % AHEAD, json={"body": "print(1)", "seq": 50})
poll = stranger.get("/api/live/" + AHEAD).get_json()
check("starting it puts the same code on the air",
      r.get_json().get("code") == AHEAD and poll.get("ended") is False
      and poll.get("waiting") is False, repr(poll)[:120])
teacher.post("/api/live/%s/stop" % AHEAD)
check("  and once taught, it is not 'not started' any more",
      stranger.get("/api/live/" + AHEAD).get_json().get("waiting") is False)
fresh = teacher.post("/api/live/start", json={"body": "x"}).get_json()["code"]
teacher.post("/api/live/%s/stop" % fresh)
check("a lesson ended before its first push is not 'not started' either",
      stranger.get("/api/live/" + fresh).get_json().get("waiting") is False,
      "its link would say Ready when you are, not Teach this lesson again")

# Posted ahead, then started from the editor's own Go live, not the dashboard.
ahead2 = teacher.post("/api/assignment", json={
    "title": "Thursday", "code": "print('t')\n"}).get_json()["slug"]
posted = re.search(r'/live/([a-z0-9]+)"',
                   teacher.get("/teacher/" + ahead2).get_data(as_text=True)).group(1)
got = teacher.post("/api/live/start", json={"body": "print('t')",
                                            "assignment": ahead2}).get_json()
check("Go live in the editor on an assignment uses the link posted ahead",
      got.get("code") == posted,
      "the class would be live under a new code while the posted link said "
      "'not started' all period")
check("  and it is on the air", stranger.get("/api/live/" + posted).get_json().get("ended") is False)
teacher.post("/api/live/%s/stop" % posted)
again = teacher.post("/api/live/start", json={"body": "print('t')",
                                              "assignment": ahead2}).get_json()
check("  but a link already taught is not picked up again: Go live starts fresh",
      again.get("code") not in ("", None, posted), repr(again.get("code")))
teacher.post("/api/live/%s/stop" % again.get("code"))

# ------------------------------- a lesson never changes its assignment
print("\nA lesson's code always belongs to its assignment")
# The bug: Go live on assignment B while A's lesson was still open carried
# on in A's lesson, relabelled B. B's live link then said "taught" and its
# Teach again loaded B's notes with A's code.
asg_a = teacher.post("/api/assignment", json={"title": "A", "code": "print('A')\n"}).get_json()["slug"]
asg_b = teacher.post("/api/assignment", json={"title": "B", "code": "print('B')\n"}).get_json()["slug"]
la = teacher.post("/api/live/start", json={"body": "print('A')", "assignment": asg_a}).get_json()["code"]
teacher.post("/api/live/%s/push" % la, json={"body": "print('A taught')", "seq": 99})
lb = teacher.post("/api/live/start", json={"body": "print('B')", "assignment": asg_b}).get_json()["code"]
check("Go live on another assignment, with one still open, is a new lesson",
      lb != la, "it carried on in A's lesson and relabelled it B")
row_a = lesson_row(la)
check("  the old one ends, still A's, with A's code",
      row_a.ended == 1 and row_a.body == "print('A taught')"
      and row_a.assignment_id == item_id(asg_a))
check("  and B's live link is B's lesson, not A's",
      re.search(r'/live/([a-z0-9]+)"', teacher.get("/teacher/" + asg_b).get_data(as_text=True)).group(1) == lb)
same = teacher.post("/api/live/start", json={"body": "x", "assignment": asg_b}).get_json()["code"]
check("Go live again on the same assignment still carries on in its lesson", same == lb)
resumed = teacher.post("/api/live/start", json={"resume": lb}).get_json()
check("  and a reload's resume does too", resumed.get("code") == lb)
teacher.post("/api/live/%s/stop" % lb)

# The repair: forget what the lesson last had on screen, keep the link.
RESET = "/api/assignment/%s/live/reset" % asg_a
page = teacher.get("/teacher/" + asg_a).get_data(as_text=True)
check("a taught lesson's page offers Start from the starter next time", 'id="live-reset"' in page)
check("  only its teacher can", student.post(RESET).status_code == 403
      and other.post(RESET).status_code in (403, 404))
r = teacher.post(RESET)
row_a = lesson_row(la)
check("  it forgets the code, and keeps the link",
      r.status_code == 200 and row_a.body == "" and row_a.code == la
      and re.search(r'/live/([a-z0-9]+)"', teacher.get("/teacher/" + asg_a).get_data(as_text=True)).group(1) == la)
check("  so Teach again loads only the starter (nothing to lay over it)",
      stranger.get("/api/live/%s?v=-1" % la).get_json().get("body") == "")
teacher.post("/api/live/start", json={"reopen": la, "body": "x"})
check("  and is refused while the lesson is live", teacher.post(RESET).status_code == 409)
teacher.post("/api/live/%s/stop" % la)
check("a lesson made ahead and never taught does not offer it",
      'id="live-reset"' not in teacher.get("/teacher/" + teacher.post(
          "/api/assignment", json={"title": "C", "code": "x\n"}).get_json()["slug"]).get_data(as_text=True))

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
