"""v11 levels: Easy / Medium / Master for the coding exercise and the challenge
(Nov 2026, the teacher's request).

Run: python3 tools/test_levels.py      (needs node)

A ```level slide before the coding exercise (and the ★ Challenge) lets each
student choose; the exercise's tests (```tests exercise) count 80% / 88% /
100% of their points by that level, and nothing else moves. The challenge's
tests (```tests bonus) add points that are never part of what it's out of,
and passing them all pays CHALLENGE_XP once, more for a harder level. The
pick is the server's and only goes down. The teacher suggests (⭐) or locks
(🔒) a level per student on the class's Levels page; the page also offers
its own suggestion (🤖) from the lesson so far — never in a quiz.

Pinned here: autograde.py and autograde.js read the parts the same; bonus is
out of nothing (possible, the teacher's page, Out of); scoring, rescoring on
a drop, refusing a climb, a lock, the suggestions and their name; the
challenge XP once and by level; Check all's verified result scaled and its
level said; the system suggestion from answers and history, and none in a
quiz; and notes without a ```level are exactly as before.
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

# ---------------------------------------------------------------- a v11 lesson
# Each level its own tests (its own variables and values: "or they will just
# copy from a neighbor"), 5 points an exercise, 1 a challenge.
LESSON = """locked: yes
# Levels

```quiz
What does len("hi") return?
- [ ] 1
- [x] 2
points: 2
```

```quiz
Pick the vowel.
- [x] a
- [ ] b
```

---

```tests
uses print
```

---

```level
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

```level
for: challenge
```

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
PLAIN = LESSON.replace("```level\n```", "").replace("```level\nfor: challenge\n```", "")

tid = add_user("t", "teacher@example.org", "Teach")
kid = add_user("k", "kid@example.org", "Kid Ode")
kid2 = add_user("k2", "kid2@example.org", "Ana Ruiz")
kid3 = add_user("k3", "kid3@example.org", "Bo Lee")
kid6 = add_user("k6", "kid6@example.org", "Eli Fay")
teacher = client(tid)
k, k2, k3, k6 = client(kid), client(kid2), client(kid3), client(kid6)


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
for email, name in (("kid@example.org", "Kid Ode"), ("kid2@example.org", "Ana Ruiz"),
                    ("kid3@example.org", "Bo Lee"), ("kid6@example.org", "Eli Fay")):
    db.add(accounts.Enrollment(class_id=CID, email=email, name=name))
db.commit()
ENR = {e.email: e.id for e in db.query(accounts.Enrollment).filter_by(class_id=CID)}
db.close()

LS = make(LESSON, "Lesson v11", CID)
PS = make(PLAIN, "Plain lesson", CID)
check("Out of counts one level's exercise and no bonus: 1 + 5",
      autograde.possible({"notes.md": LESSON}) == 6.0, autograde.possible({"notes.md": LESSON}))


def lines(level, ok=True, bonus_level=None, bonus_ok=True):
    """What a student's page sends: the plain test, and the tests of the
    levels they're on (autograde.js runs only those)."""
    name = {"easy": "Ava", "medium": "Ben", "master": "Cal"}[level]
    out = [{"label": "Uses print", "ok": True, "points": 1},
           {"label": "Prints Hi " + name, "ok": ok, "points": 5}]
    if bonus_level:
        out.append({"label": "Prints Wow " + {"easy": "1", "medium": "2", "master": "3"}[bonus_level],
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


def pick(c, key, level, slug=None):
    return c.post("/api/level", json={"assignment": slug or LS, "key": key, "level": level})


print("\nNo suggestion: the level they chose counts, if they keep it")
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("easy")}).get_json()
check("nothing chosen, nothing suggested: Easy's tests at 80% (1 + 4 of 6)",
      r.get("earned") == 5.0 and r.get("possible") == 6.0, r)
st = pick(k, "exercise", "master").get_json()
check("choosing Master rescores the kept result: Easy's lines don't count now (1 of 6)",
      st.get("picks", {}).get("exercise") == "master" and row(kid, LS).earned == 1.0, (st, row(kid, LS).earned))
check("  and it still earns (credit)", st.get("credit", {}).get("exercise") is True, st)
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("master")}).get_json()
check("Master's own tests passing: 6 of 6", r.get("earned") == 6.0 and r.get("possible") == 6.0, r)
st = pick(k, "exercise", "medium").get_json()
check("changing level: allowed, but the exercise earns nothing now (1 of 6)",
      st.get("picks", {}).get("exercise") == "medium" and st["credit"]["exercise"] is False
      and row(kid, LS).earned == 1.0, (st, row(kid, LS).earned))
k.post("/api/tests/self", json={"assignment": LS, "results": lines("medium")})
pick(k, "exercise", "master")
r = k.post("/api/tests/self", json={"assignment": LS, "results": lines("master")}).get_json()
check("  even changing back: still nothing (or anyone could look and return)", r.get("earned") == 1.0, r)
bad = pick(k, "exercise", "legend")
check("a level that isn't one is refused", bad.status_code == 400)

print("\nThe teacher's suggestion is the only level that earns")
teacher.post("/api/class/%d/levels" % CID, json={"teacher_name": "Mr. Franz"})
s_ = teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid3@example.org"], "level": "medium"}).get_json()
st = k3.get("/api/level/%s" % LS).get_json()
check("a suggestion reaches the student, with the name they see it under",
      s_.get("ok") and st["suggestion"] == "medium" and st["teacher"] == "Mr. Franz" and not st["locked"], st)
pick(k3, "exercise", "medium")
r = k3.post("/api/tests/self", json={"assignment": LS, "results": lines("medium")}).get_json()
check("done at the suggested level: 1 + 0.88 × 5 = 5.4", r.get("earned") == 5.4, r)
teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid6@example.org"], "level": "medium"})
st = pick(k6, "exercise", "master").get_json()
r = k6.post("/api/tests/self", json={"assignment": LS, "results": lines("master")}).get_json()
check("done perfectly at another level: no exercise points (1 of 6), and the student is told",
      r.get("earned") == 1.0 and st["credit"]["exercise"] is False, (r, st))
teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid6@example.org"], "level": "master"})
check("the teacher changing the suggestion to what they did rescores it: 6 of 6",
      row(kid6, LS).earned == 6.0, row(kid6, LS).earned)
teacher.post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid2@example.org"], "level": "master",
                                                   "locked": True})
st = k2.get("/api/level/%s" % LS).get_json()
lk = pick(k2, "exercise", "easy")
check("a lock is their level: anything else is refused", st["locked"] == "master" and lk.status_code == 403, st)
r = k2.post("/api/tests/self", json={"assignment": LS, "results": lines("master")}).get_json()
check("  and it counts with nothing chosen: Master, 6 of 6", r.get("earned") == 6.0, r)
other = add_user("o", "other@example.org", "Other T")
nope = client(other).post("/api/class/%d/levels" % CID, json={"enrollment": ENR["kid@example.org"], "level": "easy"})
check("only the class's teacher sets them", nope.status_code in (403, 404), nope.status_code)
page = teacher.get("/teacher/class/%d/levels" % CID).get_data(as_text=True)
check("the Levels page lists the roster with the name students see",
      "Kid" in page and "Ana" in page and "Bo" in page and "Mr. Franz" in page, page[:200])
check("  each student's suggestion shows on it (Bo: Medium)",
      'data-id="%d" data-level="medium"' % ENR["kid3@example.org"] in page)
check("  the class page links to it", "/teacher/class/%d/levels" % CID in
      teacher.get("/teacher/class/%d" % CID).get_data(as_text=True))
t_try = teacher.post("/api/level", json={"assignment": LS, "key": "exercise", "level": "easy"}).get_json()
check("the teacher trying their own lesson keeps nothing", t_try.get("practice") is True)

print("\nThe challenge: a bonus, at the same rule")
src = "challenge:%d" % item_of(LS).id
pick(k3, "challenge", "medium")
r = k3.post("/api/tests/self", json={"assignment": LS, "results": lines("medium")}).get_json()
check("a level with no challenge tests: nothing added, nothing lost", r.get("earned") == 5.4, r)
kid7 = add_user("k7", "kid7@example.org", "Gus Hal")
k7 = client(kid7)
pick(k7, "exercise", "master")
pick(k7, "challenge", "master")
r = k7.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus_level="master", bonus_ok=False)}).get_json()
check("not done: nothing added, and no challenge XP", r.get("earned") == 6.0 and src not in awards(kid7), (r, awards(kid7)))
r = k7.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus_level="master")}).get_json()
check("done at the level that counts: +1 bonus, out of nothing (7 of 6)",
      r.get("earned") == 7.0 and r.get("possible") == 6.0, r)
check("  and the challenge XP, more for Master (60)", awards(kid7).get(src) == P.CHALLENGE_XP["master"], awards(kid7))
k7.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus_level="master")})
check("  once", sum(1 for x in awards(kid7) if x.startswith("challenge:")) == 1, awards(kid7))
pick(k7, "challenge", "easy")
r = k7.post("/api/tests/self", json={"assignment": LS, "results": lines("master", bonus_level="easy")}).get_json()
check("changing the challenge level: the bonus point goes (6 of 6)", r.get("earned") == 6.0, r)
kid8 = add_user("k8", "kid8@example.org", "Ivy Jo")
k8 = client(kid8)
pick(k8, "challenge", "easy")
k8.post("/api/tests/self", json={"assignment": LS, "results": lines("easy", bonus_level="easy")})
check("the XP is paid by the level they're on: Easy 25", awards(kid8).get(src) == P.CHALLENGE_XP["easy"], awards(kid8))
# A challenge written once (one ```tests bonus for every level): the rule holds.
ONE = "# One\n```tests\nuses print\n```\n```level\nfor: challenge\n```\n```tests bonus\nprints Wow\n```\n"
OS = make(ONE, "One challenge", CID)
WOW = [{"label": "Uses print", "ok": True, "points": 1}, {"label": "Prints Wow", "ok": True, "points": 1}]
pick(k8, "challenge", "easy", OS)
r = k8.post("/api/tests/self", json={"assignment": OS, "results": WOW}).get_json()
check("one challenge for every level: done, +1 (2 of 1)", r.get("earned") == 2.0 and r.get("possible") == 1.0, r)
pick(k8, "challenge", "master", OS)
r = k8.post("/api/tests/self", json={"assignment": OS, "results": WOW}).get_json()
check("  changed level: the bonus point goes (1 of 1)", r.get("earned") == 1.0, r)

print("\nThe page's own suggestion (🤖)")
quiz_keys = quiz.keys(LESSON)


def answer(c, slug, qid, response):
    return c.post("/api/quiz/answer", json={"assignment": slug, "question": qid, "response": response}).get_json()


kid4 = add_user("k4", "kid4@example.org", "Cy Dee")
k4 = client(kid4)
st = k4.get("/api/level/%s" % LS).get_json()
check("nothing to go on yet: no suggestion", st["system"] is None, st)
answer(k4, LS, quiz_keys[0]["qid"], "2")
answer(k4, LS, quiz_keys[1]["qid"], "a")
st = k4.get("/api/level/%s" % LS).get_json()
check("every question right so far: Master, and why", st["system"] and st["system"]["level"] == "master"
      and "3 of 3" in st["system"]["why"], st["system"])
kid5 = add_user("k5", "kid5@example.org", "Di Eve")
k5 = client(kid5)
answer(k5, LS, quiz_keys[0]["qid"], "1")
answer(k5, LS, quiz_keys[1]["qid"], "b")
check("  every one wrong: Easy", k5.get("/api/level/%s" % LS).get_json()["system"]["level"] == "easy")
# History: two earlier exercises passed at Medium nudge a Medium up to Master.
db = P.SessionLocal()
for n in (1, 2):
    a = make(LESSON, "Earlier %d" % n, CID)
    it = db.query(accounts.Assignment).filter_by(slug=a).first()
    db.add(P.LevelPick(assignment_id=it.id, student_id=kid5, key="exercise", level="medium"))
    db.add(accounts.TestResult(assignment_id=it.id, student_id=kid5, kind="self", earned=5, possible=6,
                               details=json.dumps(lines("medium"))))
db.commit()
db.close()
st = k5.get("/api/level/%s" % LS).get_json()
check("two exercises passed at Medium nudge it up a level", st["system"]["level"] == "medium"
      and "last 2 exercises at Medium" in st["system"]["why"], st["system"])
QZ = make("quiz: yes\n" + LESSON, "Quiz v11", CID)
answer(k4, QZ, quiz_keys[0]["qid"], "2")
check("never in a quiz (it would say what was right)", k4.get("/api/level/%s" % QZ).get_json()["system"] is None)

print("\nThe teacher's page and Check all")
db = P.SessionLocal()
it = item_of(LS)
db.add(accounts.Submission(assignment_id=it.id, student_id=kid3, snippet_slug="", times_submitted=0))
db.add(accounts.Submission(assignment_id=it.id, student_id=kid, snippet_slug="", times_submitted=0))
db.commit()
db.close()
every = lines("easy") + lines("medium")[1:] + lines("master")[1:]
v = teacher.post("/api/assignment/%s/tests/verify" % LS, json={"student": kid3, "results": every}).get_json()
check("Check all runs every level; only theirs counts (Medium: 1 + 4.4) and the level is said",
      v.get("earned") == 5.4 and v.get("possible") == 6.0 and v.get("level") == "medium", v)
page = teacher.get("/teacher/%s" % LS).get_data(as_text=True)
check("the assignment page shows each student's level", "Exercise: Medium" in page)
check("  and says when it earns nothing", "(no credit)" in page)
check("  and counts the bonus apart: + 1 bonus", "+ 2 bonus" in page or "+ 1 bonus" in page)

print("\nNotes without a ```level, as always")
r = k.post("/api/tests/self", json={"assignment": PS, "results": lines("easy") + lines("medium")[1:] + lines("master")[1:]}).get_json()
check("no level slide: every test counts whole (16 of 16)", r.get("earned") == 16.0 and r.get("possible") == 16.0, r)
OLD = make("# Old\n```tests\nprints Hi\n```\n", "Old lesson")
r = k.post("/api/tests/self", json={"assignment": OLD, "results": [{"label": "Prints Hi", "ok": True, "points": 1}]}).get_json()
check("  an old lesson is untouched", r.get("earned") == 1.0 and r.get("possible") == 1.0, r)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
