"""v11 levels: Easy / Medium / Master for the coding exercise and the challenge
(Nov 2026, the teacher's request), set by the teacher behind the scenes.

Run: python3 tools/test_levels.py      (needs node)

The exercise and the challenge are written per level in `:::level` boxes,
each with its own tests (```tests exercise easy …, ```tests bonus master …).
The teacher sets each student's level in the gradebook (one level for both,
Easy until set); students are never shown a choice or a suggestion ("let me
just do this behind the scenes"). The exercise counts at their level, scaled
80% / 88% / 100%; the challenge is a bonus — points on top, never part of
what it's out of — and passing it pays CHALLENGE_XP once, more for a harder
level.

Pinned here: autograde.py and autograde.js read the parts and levels the
same; Out of is one level's worth; a student's level is Easy until set and
then the teacher's; scores follow it (rescored when it changes); only their
level's tests count; the bonus and its XP; there's no way for a student to
set a level; the teacher's pages show it; and notes without levels are
exactly as before.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "levels.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import autograde                                             # noqa: E402
import quiz                                                  # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-74s %s" % ("ok" if condition else "FAIL", label, "" if condition else str(detail)[:300]))


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def client(uid):
    c = P.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = uid
    return c


# ---------------------------------------------------------------- the grammar
print("Reading the parts, the same on both sides")
SAMPLE = """# A
```tests
x == 1
```
```tests exercise
prints Hi       (2 points)
```
```tests bonus
prints Wow
```
```tests nonsense
prints never
```
```tests exercise medium
prints Med
```
```tests bonus master
prints Top
```
```tests easy
prints nope
```
"""
py = [(t["label"], t["part"], t["level"]) for t in autograde.parse(SAMPLE)[0]]
harness = """
var window = {}; var document = {};
eval(require("fs").readFileSync(%s, "utf8"));
console.log(JSON.stringify(window.PyIDETests.parse(%s).tests.map(function (t) { return [t.label, t.part, t.level]; })));
""" % (json.dumps(os.path.join(PYIDE, "static", "autograde.js")), json.dumps(SAMPLE))
out = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
try:
    js = [tuple(x) for x in json.loads(out.stdout.strip().splitlines()[-1])]
except (ValueError, IndexError):
    js = out.stderr[-300:]
check("autograde.py and autograde.js read the parts the same", js == py, (py, js))
check("  plain, exercise and bonus, each maybe with a level; other words aren't a tests block",
      py == [("x gives 1", "", ""), ("Prints Hi", "exercise", ""), ("Prints Wow", "bonus", ""),
             ("Prints Med", "exercise", "medium"), ("Prints Top", "bonus", "master")], py)
check("  a bonus test is out of nothing; one level's exercise counts: possible 4",
      autograde.possible({"notes.md": SAMPLE}) == 4.0, autograde.possible({"notes.md": SAMPLE}))

# The web grammar (WebIDE's, for HTML/CSS/JS lessons) reads levels the same way.
import autograde_web                                         # noqa: E402
WSAMPLE = """```tests
has h1
```
```tests exercise easy
has 2 li       (2 points)
```
```tests exercise master
has 3 li       (2 points)
```
```tests bonus easy
has footer
```
```tests nope
has p
```
"""
wpy = [(t["label"], t["part"], t["level"]) for t in autograde_web.parse(WSAMPLE)[0]]
wharness = """
var window = {}; var document = {};
eval(require("fs").readFileSync(%s, "utf8"));
console.log(JSON.stringify(window.WebIDETests.parse(%s).tests.map(function (t) { return [t.label, t.part, t.level]; })));
""" % (json.dumps(os.path.join(PYIDE, "static", "web", "autograde.js")), json.dumps(WSAMPLE))
wout = subprocess.run(["node", "-e", wharness], capture_output=True, text=True)
try:
    wjs = [tuple(x) for x in json.loads(wout.stdout.strip().splitlines()[-1])]
except (ValueError, IndexError):
    wjs = wout.stderr[-300:]
check("web lessons: autograde_web.py and web/autograde.js read parts and levels the same",
      wjs == wpy and [w[1:] for w in wpy] == [("", ""), ("exercise", "easy"), ("exercise", "master"), ("bonus", "easy")],
      (wpy, wjs))
check("  and Out of is one level's exercise, no bonus: 1 + 2",
      autograde_web.possible({"notes.md": WSAMPLE}) == 3.0, autograde_web.possible({"notes.md": WSAMPLE}))

# ---------------------------------------------------------------- a v11 lesson
# Each level its own tests (its own variables and values), 5 points an
# exercise, 1 a challenge. No choice slides: the teacher sets the level.
LESSON = """locked: yes
# Levels

```tests
uses print
```

---

## Exercise

:::level easy
easy words
```tests exercise easy
prints Hi Ava      (5 points)
```
:::end
:::level medium
medium words
```tests exercise medium
prints Hi Ben      (5 points)
```
:::end
:::level master
master words
```tests exercise master
prints Hi Cal      (5 points)
```
:::end

---

## Challenge

:::level challenge easy
```tests bonus easy
prints Wow 1
```
:::end
:::level challenge master
```tests bonus master
prints Wow 3
```
:::end
"""

tid = add_user("t", "teacher@example.org", "Teach")
kid = add_user("k", "kid@example.org", "Kid Ode")
kid2 = add_user("k2", "kid2@example.org", "Ana Ruiz")
teacher = client(tid)
k, k2 = client(kid), client(kid2)


def make(notes, title, course_id=None):
    slug = teacher.post("/api/assignment", json={"title": title, "code": "x = 0\n",
                                                 "files": {"notes.md": notes}}).get_json()["slug"]
    if course_id:
        db = P.SessionLocal()
        item = db.query(accounts.Assignment).filter_by(slug=slug).first()
        db.add(accounts.ClassItem(class_id=course_id, assignment_id=item.id))
        db.commit()
        db.close()
    return slug


db = P.SessionLocal()
course = accounts.Course(teacher_id=tid, name="100 Days", app="pyide")
db.add(course)
db.commit()
CID = course.id
for email, name in (("kid@example.org", "Kid Ode"), ("kid2@example.org", "Ana Ruiz")):
    db.add(accounts.Enrollment(class_id=CID, email=email, name=name))
db.commit()
ENR = {e.email: e.id for e in db.query(accounts.Enrollment).filter_by(class_id=CID)}
db.close()

LS = make(LESSON, "Lesson v11", CID)
check("Out of counts one level's exercise and no bonus: 1 + 5",
      autograde.possible({"notes.md": LESSON}) == 6.0, autograde.possible({"notes.md": LESSON}))


def lines(level, ok=True, bonus=None, bonus_ok=True):
    """What a student's page sends: the plain test, and their level's tests
    (autograde.js runs only those)."""
    name = {"easy": "Ava", "medium": "Ben", "master": "Cal"}[level]
    out = [{"label": "Uses print", "ok": True, "points": 1},
           {"label": "Prints Hi " + name, "ok": ok, "points": 5}]
    if bonus:
        out.append({"label": "Prints Wow " + {"easy": "1", "medium": "2", "master": "3"}[bonus],
                    "ok": bonus_ok, "points": 1})
    return out


def item_of(slug):
    db = P.SessionLocal()
    try:
        return db.query(accounts.Assignment).filter_by(slug=slug).first()
    finally:
        db.close()


def row(uid, slug, kind="self"):
    db = P.SessionLocal()
    try:
        return db.query(accounts.TestResult).filter_by(assignment_id=item_of(slug).id,
                                                       student_id=uid, kind=kind).first()
    finally:
        db.close()


def awards(uid):
    db = P.SessionLocal()
    try:
        return {a.source: a.xp for a in db.query(accounts.XpAward).filter_by(user_id=uid)}
    finally:
        db.close()


def set_level(enr, level):
    return teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR[enr], "level": level})


print("\nThe level is the teacher's")
check("a lesson with level boxes is a levelled one (no choice slide needed)",
      P._level_keys(item_of(LS)) == {"exercise", "challenge"}, P._level_keys(item_of(LS)))
check("a student's level is Easy until the teacher sets one", k.get("/api/level/%s" % LS).get_json() == {"level": "easy"})
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("easy")}).get_json()
check("  Easy's tests count, at 80% (1 + 4 of 6)", r.get("earned") == 5.0 and r.get("possible") == 6.0, r)
s_ = set_level("kid@example.org", "master").get_json()
check("the teacher sets Master: the student's page is told so",
      s_.get("ok") and k.get("/api/level/%s" % LS).get_json()["level"] == "master", s_)
check("  and the kept result is scored again: Easy's lines don't count now (1 of 6)",
      row(kid, LS).earned == 1.0, row(kid, LS).earned)
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("master")}).get_json()
check("  Master's own tests passing: 6 of 6", r.get("earned") == 6.0 and r.get("possible") == 6.0, r)
set_level("kid@example.org", "medium")
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("medium")}).get_json()
check("Medium: 1 + 0.88 x 5 = 5.4", r.get("earned") == 5.4, r)
set_level("kid@example.org", "")
check("cleared: back to Easy", k.get("/api/level/%s" % LS).get_json()["level"] == "easy")
nope = k.post("/api/level", json={"assignment": LS, "key": "exercise", "level": "master"})
check("a student has no way to set a level", nope.status_code in (404, 405), nope.status_code)
bad = teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid@example.org"], "level": "legend"})
check("a level that isn't one is refused", bad.status_code == 400)
other = add_user("o", "other@example.org", "Other T")
nope = client(other).post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid@example.org"], "level": "easy"})
check("only the class's teacher sets them", nope.status_code in (403, 404), nope.status_code)
loner = client(add_user("l", "loner@example.org", "Lo Ner"))
check("a student on no roster is on Easy", loner.get("/api/level/%s" % LS).get_json()["level"] == "easy")

print("\nThe challenge: a bonus at the student's level")
src = "challenge:%d" % item_of(LS).id
set_level("kid2@example.org", "master")
r = k2.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus="master", bonus_ok=False)}).get_json()
check("not done: nothing added, and no challenge XP", r.get("earned") == 6.0 and src not in awards(kid2), (r, awards(kid2)))
r = k2.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus="master")}).get_json()
check("done: +1 bonus, out of nothing (7 of 6)", r.get("earned") == 7.0 and r.get("possible") == 6.0, r)
check("  and the challenge XP, more for Master (60)", awards(kid2).get(src) == P.CHALLENGE_XP["master"], awards(kid2))
k2.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus="master")})
check("  once", sum(1 for x in awards(kid2) if x.startswith("challenge:")) == 1, awards(kid2))
r = k2.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus="easy")}).get_json()
check("another level's challenge done: no bonus (6 of 6)", r.get("earned") == 6.0, r)
k.post("/api/tests/self", json={"assignment": LS, "results": lines("easy", bonus="easy")})
check("the XP is paid by their level: Easy 25", awards(kid).get(src) == P.CHALLENGE_XP["easy"], awards(kid))
ONE = "# One\n```tests\nuses print\n```\n:::level challenge easy\nx\n:::end\n```tests bonus\nprints Wow\n```\n"
OS = make(ONE, "One challenge", CID)
WOW = [{"label": "Uses print", "ok": True, "points": 1}, {"label": "Prints Wow", "ok": True, "points": 1}]
r = k.post("/api/tests/self", json={"assignment": OS, "results": WOW}).get_json()
check("a challenge written once (one ```tests bonus): done, +1 (2 of 1)",
      r.get("earned") == 2.0 and r.get("possible") == 1.0, r)

# Level boxes with ONE shared exercise tests block: still levelled (scaled).
SHARED = "# Shared\n:::level easy\ne\n:::end\n:::level master\nm\n:::end\n```tests exercise\nprints Hi     (5 points)\n```\n"
SS = make(SHARED, "Shared tests", CID)
HI = [{"label": "Prints Hi", "ok": True, "points": 5}]
r = k.post("/api/tests/self", json={"assignment": SS, "results": HI}).get_json()
check("level boxes with one shared tests block: still scaled by level (Easy: 4 of 5)",
      r.get("earned") == 4.0 and r.get("possible") == 5.0, r)

# A web assignment is scored by the same rule (its own grammar's labels).
WEB = "# W\n```tests\nhas h1\n```\n:::level easy\ne\n```tests exercise easy\nhas 2 li     (2 points)\n```\n:::end\n" \
      ":::level master\nm\n```tests exercise master\nhas 3 li     (2 points)\n```\n:::end\n"
wslug = teacher.post("/api/assignment", json={"title": "Web v11", "ide": "webide", "code": "",
                                              "files": {"index.html": "<h1>x</h1>", "notes.md": WEB}}).get_json()["slug"]
db = P.SessionLocal()
witem = db.query(accounts.Assignment).filter_by(slug=wslug).first()
db.add(accounts.ClassItem(class_id=CID, assignment_id=witem.id))
db.commit()
db.close()
wl = lambda n: [{"label": t["label"], "ok": True, "points": t["points"]} for t in autograde_web.parse(WEB)[0]
                if t["level"] in ("", n)]
r = k2.post("/api/tests/self", json={"assignment": wslug, "results": wl("master")}).get_json()
check("a web lesson: the Master student's own tests count whole (1 + 2 of 3)", r.get("earned") == 3.0 and r.get("possible") == 3.0, r)
r = k.post("/api/tests/self", json={"assignment": wslug, "results": wl("easy")}).get_json()
check("  and Easy's at 80% (1 + 1.6)", r.get("earned") == 2.6, r)

# A SQL lesson (FlaskIDE's grammar, Nov 2026: "make sure we can use difficulty
# levels for the sql, flask and php lessons") is scored by the same rule.
SQLV = "# S\n```tests\nreturns 1 row\n```\n:::level easy\ne\n```tests exercise easy\nresult contains Ava     (2 points)\n```\n:::end\n" \
       ":::level master\nm\n```tests exercise master\nresult contains Cy     (2 points)\n```\n:::end\n"
sslug = teacher.post("/api/assignment", json={"title": "SQL v11", "ide": "flaskide", "code": "",
                                              "files": {"schema.sql": "CREATE TABLE t (n TEXT);", "query.sql": "SELECT n FROM t;",
                                                        "notes.md": SQLV}}).get_json()["slug"]
db = P.SessionLocal()
sitem = db.query(accounts.Assignment).filter_by(slug=sslug).first()
db.add(accounts.ClassItem(class_id=CID, assignment_id=sitem.id))
db.commit()
db.close()
import autograde_flask
sl = lambda n: [{"label": t["label"], "ok": True, "points": t["points"]} for t in autograde_flask.parse(SQLV)[0]
                if t.get("level") in ("", n)]
r = k2.post("/api/tests/self", json={"assignment": sslug, "results": sl("master")}).get_json()
check("a SQL lesson: the Master student's own tests count whole (1 + 2 of 3)", r.get("earned") == 3.0 and r.get("possible") == 3.0, r)
r = k.post("/api/tests/self", json={"assignment": sslug, "results": sl("easy")}).get_json()
check("  and Easy's at 80% (1 + 1.6)", r.get("earned") == 2.6, r)

print("\nThe teacher's pages")
db = P.SessionLocal()
it = item_of(LS)
db.add(accounts.Submission(assignment_id=it.id, student_id=kid2, snippet_slug="", times_submitted=0))
db.commit()
db.close()
every = lines("easy") + lines("medium")[1:] + lines("master")[1:]
v = teacher.post("/api/assignment/%s/tests/verify" % LS, json={"student": kid2, "results": every}).get_json()
check("Check all runs every level; only theirs counts (Master: 6) and the level is said",
      v.get("earned") == 6.0 and v.get("possible") == 6.0 and v.get("level") == "master", v)
page = teacher.get("/teacher/%s" % LS).get_data(as_text=True)
check("the assignment page shows each student's level", "Level: Master" in page)
check("  and counts the bonus apart: + 2 bonus", "+ 2 bonus" in page)
gb = teacher.get("/teacher/class/%d/gradebook" % CID).get_data(as_text=True)
page = teacher.get("/teacher/class/%d/levels" % CID).get_data(as_text=True)
check("the Levels page sets levels, Easy shown until set",
      page.count("js-level is-on") == 2 and 'data-id="%d" data-level="master"' % ENR["kid2@example.org"] in page
      and "Kid" in page and "Ana" in page, page.count("js-level is-on"))
check("  the class page links to it, and so does the gradebook (which has no level buttons)",
      "/teacher/class/%d/levels" % CID in teacher.get("/teacher/class/%d" % CID).get_data(as_text=True)
      and "/teacher/class/%d/levels" % CID in gb and "js-level" not in gb)
for k_ in ("suggest", "🔒", "Your name on"):
    check("  nothing left of suggestions or locks: no %r" % k_, k_ not in gb and k_ not in page)

print("\nNotes without levels, as always")
OLD = make("# Old\n```tests\nprints Hi\n```\n", "Old lesson")
r = k.post("/api/tests/self", json={"assignment": OLD, "results": [{"label": "Prints Hi", "ok": True, "points": 1}]}).get_json()
check("an old lesson is untouched", r.get("earned") == 1.0 and r.get("possible") == 1.0, r)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
