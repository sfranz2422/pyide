"""A quiz: `quiz: yes` at the top of the notes (Nov 2026, the teacher's request).

Run: python3 tools/test_quiz_mode.py      (needs node)

"i don't want them to know if they pass the code tests or get the questions
correct." Everything works as before — answers are kept and marked, checks
are kept, the teacher sees it all — but a student is told only that it was
kept. The reply to an answer is all their page knows, so it's the server
that leaves right/wrong out (_answer_reply); the tests cards are the
browser's (checks_in_notes.js, held by test_checks_in_notes.py).

Pinned here: the header is read by quiz.py exactly as notes.js's takeHeader
reads it (node runs the real one on the same notes); a quiz's answer, and
/mine, say nothing of right or wrong, and its long response no mark; no XP
that would say so (a right answer's, full marks', a passing test's), while
answering them all still pays; Check my work's result is kept but its
points aren't sent back; My work and the class page leave a quiz's points
out of the student's grade; the teacher trying their own quiz still sees
the marks; and notes without the line are as they always were.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "quizmode.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import quiz                                                  # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-70s %s" % ("ok" if condition else "FAIL", label, "" if condition else str(detail)[:300]))


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


# ---------------------------------------------------------------- the header
print("The header line, read the same on both sides")
HEADERS = ["quiz: yes\n# A", "quiz: no\n# A", "QUIZ: On\n# A", "\n\n  quiz: true\n# A",
           "theme: ocean\nanimate: words\nlocked: yes\nquiz: yes\n# A",
           "locked: yes\nquiz: yes\n# A", "quiz: yes\ntheme: ocean\n# A",
           "# A\nquiz: yes", "theme: nope\nquiz: yes\n# A", "animate: sideways\nquiz: yes",
           "quiz: maybe\n# A", "quiz: yes\nquiz: no\n# A", "theme: ocean\ntheme: space\nquiz: yes",
           "", "quiz:yes"]
py = [quiz.is_quiz(h) for h in HEADERS]
if shutil.which("node") is None:
    check("node is needed to compare with notes.js (brew install node)", False)
else:
    harness = """
var window = { marked: { parse: function (s) { return s; } }, DOMPurify: { sanitize: function (s) { return s; } },
               matchMedia: function () { return { matches: false }; } };
var document = { createElement: function () { return {}; } };
eval(require("fs").readFileSync(%s, "utf8"));
console.log(JSON.stringify(%s.map(function (h) { return window.PyIDENotes.takeHeader(h).quiz; })));
""" % (json.dumps(os.path.join(PYIDE, "static", "notes.js")), json.dumps(HEADERS))
    out = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    try:
        js = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        js = out.stderr[-300:]
    check("quiz.py and notes.js agree on every header", js == py, list(zip(HEADERS, py, js if isinstance(js, list) else [])))
check("  `quiz: yes` (or on/true) at the top is a quiz; below the title it isn't",
      py[0] and py[2] and py[3] and not py[1] and not py[7], py)
check("  beside theme/animate/locked, in any order", py[4] and py[5] and py[6], py)
check("  a line notes.js doesn't know ends the header (it shows on the slide)", not py[8] and not py[9], py)

# ---------------------------------------------------------------- the quiz
QUIZ = """quiz: yes
# The quiz

```quiz
What does len("hi") return?
- [ ] 1
- [x] 2
points: 2
```

```quiz
The secret animal?
answer: zebra
```

```quiz
Explain a loop.
type: long
points: 3
```

```tests
x == 1
```
"""
PLAIN = QUIZ.replace("quiz: yes\n", "", 1)

tid = add_user("t", "teacher@example.org", "Teach")
kid = add_user("k", "kid@example.org", "Kid Ode")
kid2 = add_user("k2", "kid2@example.org", "Ana Ruiz")
teacher = client(tid)
k, k2 = client(kid), client(kid2)


def make(notes, title):
    slug = teacher.post("/api/assignment", json={"title": title, "code": "x = 0\n",
                                                 "files": {"notes.md": notes}}).get_json()["slug"]
    teacher.post("/api/assignment/%s/out-of" % slug, json={"out_of": 10})
    return slug


QS = make(QUIZ, "Quiz")
PS = make(PLAIN, "Practice")
mc, sa, lr = quiz.keys(QUIZ)
db = P.SessionLocal()
course = accounts.Course(teacher_id=tid, name="P4")
db.add(course)
db.commit()
for slug in (QS, PS):
    item = db.query(accounts.Assignment).filter_by(slug=slug).first()
    db.add(accounts.ClassItem(class_id=course.id, assignment_id=item.id))
for email in ("kid@example.org", "kid2@example.org"):
    db.add(accounts.Enrollment(class_id=course.id, email=email))
db.commit()
CID = course.id
QID = db.query(accounts.Assignment).filter_by(slug=QS).first().id
db.close()


def answer(c, slug, qid, response):
    return c.post("/api/quiz/answer", json={"assignment": slug, "question": qid,
                                            "response": response}).get_json()


def awards(uid):
    db = P.SessionLocal()
    try:
        return {a.source.split(":")[0] + ":" + (a.source.split(":")[1] if ":" in a.source else ""): a.xp
                for a in db.query(accounts.XpAward).filter_by(user_id=uid)}
    finally:
        db.close()


SECRET = ("correct", "earned", "graded")

print("\nA quiz's answers")
right = answer(k, QS, mc["qid"], "2")
check("a right answer's reply says it was kept, and nothing of right or wrong",
      right.get("hidden") is True and not any(f in right for f in SECRET), right)
wrong = answer(k, QS, sa["qid"], "lion")
check("  a wrong one's reply is the same", wrong.get("hidden") is True and not any(f in wrong for f in SECRET), wrong)
check("  and so is the reply to answering again", (lambda r: r.get("hidden") and "correct" not in r)(answer(k, QS, mc["qid"], "1")))
longr = answer(k, QS, lr["qid"], "<p>It goes round.</p>")
check("  a long response too", longr.get("hidden") is True and longr.get("kind") == "long"
      and not any(f in longr for f in SECRET), longr)
mine = k.get("/api/quiz/%s/mine" % QS).get_json()["answers"]
check("/mine (a reload) says nothing of right or wrong either",
      len(mine) == 3 and all(a.get("hidden") and not any(f in a for f in SECRET) for a in mine.values()), mine)
teacher.post("/api/quiz/grade", json={"assignment": QS, "student": kid, "question": lr["qid"], "score": 3})
mine = k.get("/api/quiz/%s/mine" % QS).get_json()["answers"]
check("  nor of the teacher's mark on the long response", "graded" not in mine[lr["qid"]]
      and "earned" not in mine[lr["qid"]], mine[lr["qid"]])
db = P.SessionLocal()
kept = {a.qid: a.response for a in db.query(accounts.QuizAnswer).filter_by(student_id=kid, assignment_id=QID)}
db.close()
check("the answers are kept and marked for the teacher as always",
      kept.get(mc["qid"]) == "2" and P._quiz_earned(P.SessionLocal(), QID).get(kid) == 5.0,
      (kept, P._quiz_earned(P.SessionLocal(), QID)))
aw = awards(kid)
check("no XP for a right answer (it would pop up and say so), nor for full marks",
      not any(s.startswith("quiz:") or s.startswith("bonus:") for s in aw), aw)
check("  answering every question still pays its bonus", "all:%d" % QID in aw, aw)
# Full marks on a quest pays its bonus — which would say every answer was right.
ONE = "quiz: yes\n# One\n\n```quiz\nTwo?\n- [x] 2\n- [ ] 3\n```\n"
OS = make(ONE, "One question")
db = P.SessionLocal()
one = db.query(accounts.Assignment).filter_by(slug=OS).first()
one.out_of, one.xp_bonus = 1, 20
OID = one.id
db.commit()
db.close()
got = answer(k2, OS, quiz.keys(ONE)[0]["qid"], "2")
check("  full marks on a quest's quiz pays no bonus at the answer either",
      got.get("hidden") and "bonus:%d" % OID not in awards(kid2), awards(kid2))
mine_t = answer(teacher, QS, mc["qid"], "1")
check("the teacher trying their own quiz is told it was wrong", mine_t.get("correct") is False
      and mine_t.get("practice") is True and not mine_t.get("hidden"), mine_t)

print("\nA quiz's Check my work")
ALL_RIGHT = [{"label": "x gives 1", "ok": True, "detail": "", "points": 1}]
r = k.post("/api/tests/self", json={"assignment": QS, "results": ALL_RIGHT}).get_json()
check("kept, but no points sent back and no XP", r.get("ok") and r.get("xp") == 0
      and "earned" not in r and "possible" not in r, r)
db = P.SessionLocal()
row = db.query(accounts.TestResult).filter_by(student_id=kid, assignment_id=QID, kind="self").first()
db.close()
check("  the teacher has the result", row is not None and row.earned == 1, row and row.earned)
check("  and no selftest award", not any(s.startswith("selftest:") for s in awards(kid)), awards(kid))

print("\nThe student's pages")
page = k.get("/my").get_data(as_text=True)
check("My work leaves a quiz's points out (they'd move with each answer)",
      "from the questions and tests" not in page.split("Practice")[0] if "Practice" in page else
      "from the questions and tests" not in page, page.count("from the questions and tests"))
page = k.get("/class/%d" % CID).get_data(as_text=True)
check("the class page shows the quiz no grade", "badge-grade" not in page, page.count("badge-grade"))

print("\nNotes without the line, as always")
p = answer(k2, PS, quiz.keys(PLAIN)[0]["qid"], "2")
check("a right answer is told it's right, with its points", p.get("correct") is True and p.get("earned") == 2, p)
r = k2.post("/api/tests/self", json={"assignment": PS, "results": ALL_RIGHT}).get_json()
check("  Check my work sends its points and pays its XP", r.get("earned") == 1 and r.get("xp") > 0, r)
check("  the right answer paid its XP", any(s.startswith("quiz:") for s in awards(kid2)), awards(kid2))
page = k2.get("/my").get_data(as_text=True)
check("  My work shows the points", "from the questions and tests" in page)
page = k2.get("/class/%d" % CID).get_data(as_text=True)
check("  the class page the grade", "badge-grade" in page)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
