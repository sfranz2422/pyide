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
check("  and who is teaching", body["host"] == "Mr Franz", body.get("host"))

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


# -------------------------------------------------------------- the pages
print("\nThe pages")

r = stranger.get("/live/%s" % CODE)
check("the live page opens for anyone with the code", r.status_code == 200,
      r.status_code)
page = r.get_data(as_text=True)
check("  and carries two editors, mirror and their own",
      'id="mirror"' in page and 'id="mine"' in page)
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
from_storage = bool(arg) and re.search(
    r"\b(var\s+)?%s\s*=\s*window\.localStorage\.getItem" % re.escape(arg),
    live_code) is not None
check("  and what goes in came out of their own browser, not the wire",
      from_storage,
      "mine.setValue(%s) — %s" % (arg or "nothing",
                                  "read from localStorage" if from_storage
                                  else "NOT traced to localStorage"))

after_mirror = live_code[live_code.index("function showMirror"):]
check("  and nothing in the polling path touches it at all",
      "mine.setValue(" not in after_mirror,
      "a class losing their own work is the one unforgivable bug here")

mirror_opts = live_code[live_code.index('fromTextArea($("mirror")'):]
mirror_opts = mirror_opts[:mirror_opts.index("});")]
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

check("a finished lesson stops the polling",
      'throw new Error("ended")' in live_code,
      "thirty browsers polling an ended lesson until home time")

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
