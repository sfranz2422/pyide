#!/usr/bin/env python3
"""Tests in an assignment's notes: Check my work and Check all (autograde.py,
static/autograde.js, "Tests" in app.py).

    python3 tools/test_autograde.py

WHY THIS FILE EXISTS

A test that passes a wrong program, or fails a right one, is a wrong grade —
and once the teacher presses Check all, it is the grade that goes to
Classroom. So this pins:

  * the format: what each line is, its points, and a line that isn't a test
    being said rather than quietly skipped;
  * autograde.js reads every block exactly as autograde.py does (node);
  * the tests, run in the real Pyodide (node), pass the right program and
    fail each wrong one for the right reason — wrong output, wrong return,
    an endless loop, asking for more input, a missing function, code that
    won't read;
  * the server: a student's own check is kept and counts for nothing; only
    the teacher's verified result is added to the grade — on the results
    page, My work and the class page — and it can complete a quest; a
    verified result older than the work is marked stale; a page can't claim
    more points than the lines it sent; and only the teacher can fetch the
    work or post a verified result.

Needs node, and Pyodide in node_modules (as test_charts.py).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNTIME = os.path.join(ROOT, "static", "runtime.js")
AUTOGRADE = os.path.join(ROOT, "static", "autograde.js")
PYODIDE = os.path.join(ROOT, "node_modules", "pyodide", "pyodide.mjs")

DB = os.path.join(tempfile.mkdtemp(), "ag.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@school.org, other@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import autograde                                             # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-64s %s" % ("ok" if ok else "FAIL", label, detail))


NOTES = """# Rectangles

Write `area(w, h)`, then ask for two numbers and print their area.

```tests
# a comment
input 3, 4 -> prints 12
input 5, 2 -> prints exactly Area? Area? 10
area(3, 4) == 12        (2 points)
area(0.1, 3) == 0.3
uses for
defines area
avoids eval
uses import math
```
"""

# ------------------------------------------------------------- the format
print("\nThe format")
tests, errors = autograde.parse(NOTES)
kinds = [t["kind"] for t in tests]
check("eight tests, comment skipped", kinds == ["output", "output", "call", "call",
                                                "uses", "defines", "avoids", "uses"], kinds)
check("an output test types its inputs, and contains by default",
      tests[0]["inputs"] == ["3", "4"] and tests[0]["expect"] == "12"
      and not tests[0]["exact"])
check("  exactly is exact", tests[1]["exact"] and tests[1]["expect"] == "Area? Area? 10")
check("(2 points) is two points, and the rest one each",
      [t["points"] for t in tests] == [1, 1, 2, 1, 1, 1, 1, 1])
check("a call test is the call and its answer",
      tests[2]["expr"] == "area(3, 4)" and tests[2]["expect"] == "12")
check("labels read as sentences",
      [t["label"] for t in tests][:3] == ["With input 3, 4, prints 12",
                                          "With input 5, 2, prints exactly Area? Area? 10",
                                          "area(3, 4) gives 12"]
      and tests[4]["label"] == "Uses a for loop" and tests[5]["label"] == "Defines area()"
      and tests[6]["label"] == "Doesn't use eval", [t["label"] for t in tests])
_, errs = autograde.parse("```tests\nprint the answer\n```")
check("a line that isn't a test is an error, not skipped", len(errs) == 1
      and "isn't a test" in errs[0], errs)
check("possible points add up", autograde.possible({"notes.md": NOTES}) == 9)
check("no tests block, no tests", autograde.parse("```quiz\nQ\n- [x] a\n```")[0] == [])

# ------------------------------------------------- the same in JavaScript
node = shutil.which("node")
if not node or not os.path.exists(PYODIDE):
    check("node and node_modules/pyodide are here", False, "brew install node; npm install")
    sys.exit(1)

samples = [NOTES, "```tests\nprints Hello\nprints exactly  Hi there  \n```",
           "```tests\ninput  -> prints x\nadd(1,2) == 3 (3 points)\nuses len (1 point)\n```",
           "```tests\nprint the answer\n```", "no block here"]
script = ("global.window={};eval(require('fs').readFileSync(%s,'utf8'));"
          "process.stdout.write(JSON.stringify(%s.map(s=>window.PyIDETests.parse(s))))"
          % (json.dumps(AUTOGRADE), json.dumps(samples)))
out = subprocess.run([node, "-e", script], capture_output=True, text=True)
try:
    js = json.loads(out.stdout)
except ValueError:
    js = []
check("node read autograde.js", len(js) == len(samples), out.stderr[-300:])
for i, (s, j) in enumerate(zip(samples, js)):
    py_tests, py_errors = autograde.parse(s)
    same = j["tests"] == py_tests and j["errors"] == py_errors
    check("  sample %d reads the same in both" % (i + 1), same,
          "" if same else "js=%r py=%r" % (j, (py_tests, py_errors)))

# ------------------------------------------- results headed by their slide
print("\nCheck my work heads the results with their slide")
SLIDES_MD = ("theme: arcade\n# Lesson\n\n```tests\nuses for\n```\n\n---\n\n"
             "```python\n# not the title\n```\n\n## Step 1 — show_title\n\n```text\n---\n```\n\n"
             "```tests\ndefines show_title\n```\n\n---\n\n---\n\n## Step 2 — round_header\n\n"
             "```tests\ndefines show_title\ndefines round_header\n```\n")
script = ("global.window={};const fs=require('fs');"
          "eval(fs.readFileSync(%s,'utf8'));eval(fs.readFileSync(%s,'utf8'));"
          "const T=window.%s,N=window.%s,md=%s;"
          "process.stdout.write(JSON.stringify([T.places({'notes.md':md,'main.py':''},N),"
          "T.places({'notes.md':'```tests\\nuses for\\n```'},N)]))"
          % (json.dumps(os.path.join(ROOT, "static", "notes.js")), json.dumps(AUTOGRADE),
             "PyIDETests", "PyIDENotes", json.dumps(SLIDES_MD)))
out = subprocess.run([node, "-e", script], capture_output=True, text=True)
try:
    placed, flat = json.loads(out.stdout)
except ValueError:
    placed, flat = None, None
check("each test is given the slide it's on, numbered as the viewer numbers",
      [(p or {}).get("slide") for p in placed or []] == [1, 2, 3, 3], (placed, out.stderr[-300:]))
check("  under that slide's heading, not a # in its code",
      [(p or {}).get("title") for p in placed or []]
      == ["Lesson", "Step 1 — show_title", "Step 2 — round_header", "Step 2 — round_header"], placed)
check("  and notes without slides get no headings", flat == [None], flat)

# ---------------------------------------------- running them in Pyodide
print("\nRunning the tests (real Pyodide)")
RIGHT = """import math
def area(w, h):
    return w * h
w = int(input("Area? "))
h = int(input("Area? "))
for _ in range(1):
    print(area(w, h))
"""
PROGRAMS = {
    "right": RIGHT,
    "wrong_math": RIGHT.replace("return w * h", "return w + h"),
    "no_loop": RIGHT.replace("for _ in range(1):\n    print", "print").replace(
        "    print(area(w, h))", "print(area(w, h))"),
    "one_input": "def area(w, h):\n    return w * h\nimport math\nfor x in [1]:\n"
                 "    w = int(input())\n    print(w * w)\n    input()\n    input()\n",
    "endless": "import math\ndef area(w, h):\n    while True:\n        pass\n"
               "for _ in []: pass\nwhile True:\n    pass\n",
    "unreadable": "def area(w, h)\n    return w * h\n",
    "evil": RIGHT + "eval('1')\n",
    "no_area": "import math\nfor _ in range(1):\n    print(int(input()) * int(input()))\n",
}
harness = r"""
import { loadPyodide } from %(pyodide)s;
import fs from "fs";
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
eval(fs.readFileSync(%(runtime)s, "utf8"));
eval(fs.readFileSync(%(autograde)s, "utf8"));
const py = await loadPyodide();
py.setStdout({ batched: () => {} });
py.runPython(window.PyIDERuntime.BOOTSTRAP);
const tests = window.PyIDETests.parse(%(notes)s).tests;
const programs = %(programs)s;
const out = {};
for (const name of Object.keys(programs)) {
  out[name] = await window.PyIDETests.run(py, { "main.py": programs[name], "notes.md": "x" }, tests);
}
// Case and spacing: a student's "The area is  12" is what the teacher meant
// by "prints the AREA is 12".
out.casing = await window.PyIDETests.run(py, { "main.py": "print('The area is  12')" },
  window.PyIDETests.parse("```tests\nprints the AREA is 12\nprints exactly The area is 12\n```").tests);
// Operators: a student's print(3+4) failed `uses +` while plainly using it.
out.ops = await window.PyIDETests.run(py, { "main.py": "print(3+4)\nif 2 == 2 and True:\n    x = 'a-b'\n" },
  window.PyIDETests.parse("```tests\nuses +\nuses ==\nuses and\nuses -\navoids *\n```").tests);
process.stdout.write(JSON.stringify(out));
""" % {"pyodide": json.dumps(PYODIDE), "runtime": json.dumps(RUNTIME),
       "autograde": json.dumps(AUTOGRADE), "notes": json.dumps(NOTES),
       "programs": json.dumps(PROGRAMS)}
path = os.path.join(tempfile.mkdtemp(), "harness.mjs")
with open(path, "w") as f:
    f.write(harness)
out = subprocess.run([node, path], capture_output=True, text=True, timeout=600)
try:
    ran = json.loads(out.stdout)
except ValueError:
    ran = {}
check("Pyodide ran every program", len(ran) == len(PROGRAMS) + 2, out.stderr[-400:])


def lines(name):
    return {r["label"]: r for r in ran.get(name, {}).get("results", [])}


r = ran.get("right", {})
check("the right program passes everything: 9 of 9",
      r.get("earned") == 9 and r.get("possible") == 9,
      [(x["label"], x["detail"]) for x in r.get("results", []) if not x["ok"]])
L = lines("wrong_math")
check("wrong maths fails the output and the call, and says what it gave",
      not L["With input 3, 4, prints 12"]["ok"] and not L["area(3, 4) gives 12"]["ok"]
      and "It gave 7, not 12" in L["area(3, 4) gives 12"]["detail"]
      and L["Uses a for loop"]["ok"], L.get("area(3, 4) gives 12"))
check("  and what it printed", "It printed:" in L["With input 3, 4, prints 12"]["detail"])
# 0.1 * 3 is 0.30000000000000004 in Python: == alone would fail a right answer.
check("a decimal answer matches within rounding", L["area(0.1, 3) gives 0.3"]["ok"] is False
      and lines("right")["area(0.1, 3) gives 0.3"]["ok"])
L = lines("no_loop")
check("no for loop fails only 'Uses a for loop'",
      not L["Uses a for loop"]["ok"] and L["defines area()".capitalize()]["ok"]
      and ran["no_loop"]["earned"] == 8, ran.get("no_loop", {}).get("earned"))
L = lines("one_input")
check("asking for more input than the test types says so",
      "asked for more input" in L["With input 3, 4, prints 12"]["detail"],
      L["With input 3, 4, prints 12"]["detail"])
L = lines("endless")
check("an endless loop fails, with a reason, instead of hanging",
      "never ends" in L["With input 3, 4, prints 12"]["detail"]
      and "never ends" in L["area(3, 4) gives 12"]["detail"],
      (L["With input 3, 4, prints 12"]["detail"], L["area(3, 4) gives 12"]["detail"]))
L = lines("unreadable")
check("code that won't read fails everything, saying where",
      ran["unreadable"]["earned"] == 0 and "can't be read: line 1" in L["Defines area()"]["detail"])
L = lines("evil")
check("avoids catches a name that is used", not L["Doesn't use eval"]["ok"])
L = lines("no_area")
check("a missing function says so in plain words",
      "There's no area" in L["area(3, 4) gives 12"]["detail"]
      and not L["Defines area()"]["ok"] and L["With input 3, 4, prints 12"]["ok"],
      L["area(3, 4) gives 12"]["detail"])
check("exact output includes the prompts, as a terminal shows them",
      lines("right")["With input 5, 2, prints exactly Area? Area? 10"]["ok"])
c = ran.get("casing", {}).get("results", [{}, {}])
check("prints ignores case and extra spaces", c[0].get("ok"), c[0])
check("  but prints exactly doesn't", c[1].get("ok") is False, c[1])
check("uses import math sees the import", lines("right")["Uses import math"]["ok"]
      and not lines("unreadable")["Uses import math"]["ok"])
ops = [x.get("ok") for x in ran.get("ops", {}).get("results", [])]
check("uses + sees 3+4, == and and too — operators, read from the code's tree",
      ops[:3] == [True, True, True], ran.get("ops"))
check("  a - inside a string isn't a minus, and avoids * holds", ops[3:] == [False, True], ran.get("ops"))

# ---------------------------------------------------------------- server
print("\nThe server")
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import xp                                                    # noqa: E402


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


TEACHER = add_user("t", "teacher@school.org", "Mr Franz")
OTHER = add_user("o", "other@school.org", "Ms Other")
AMY = add_user("a", "amy@school.org", "Amy Adams")
BEN = add_user("b", "ben@school.org", "Ben Brown")
teacher, other, amy, ben = client(TEACHER), client(OTHER), client(AMY), client(BEN)

ENTRY = {"pyide": None, "webide": "index.html", "flaskide": "app.py"}[P.APP_NAME]
CLASS = teacher.post("/api/class", json={"name": "P4"}).get_json()["id"]
_db = P.SessionLocal()
for email in ("amy@school.org", "ben@school.org"):
    _db.add(accounts.Enrollment(class_id=CLASS, email=email, name=email))
_db.commit()
_db.close()
SLUG = teacher.post("/api/class/%d/new" % CLASS, json={"title": "Rectangles"}).get_json()["slug"]
teacher.post("/api/assignment/%s" % SLUG, json={"code": RIGHT, "title": "Rectangles",
                                                "files": {"notes.md": NOTES}})
teacher.post("/api/assignment/%s/out-of" % SLUG, json={"out_of": 9})

# Amy turns in the right program, Ben a wrong one.
def turn_in(c, code):
    """Open the assignment (which makes their draft) and turn this code in."""
    draft = c.get("/a/" + SLUG).headers["Location"].rsplit("/", 1)[1]
    r = c.post("/api/submit", json={"draft": draft, "code": code, "files": {"notes.md": NOTES}})
    return draft, r


DRAFTS = {}
for uid, c, code in ((AMY, amy, RIGHT), (BEN, ben, PROGRAMS["wrong_math"])):
    DRAFTS[uid], _ = turn_in(c, code)


def sub_of(uid):
    db = P.SessionLocal()
    try:
        return db.query(accounts.Submission).filter_by(student_id=uid).first()
    finally:
        db.close()


check("both turned in", sub_of(AMY) is not None and sub_of(BEN) is not None)

ALL_RIGHT = [{"label": x["label"], "ok": True, "detail": "", "points": x["points"]}
             for x in ran["right"]["results"]]
r = amy.post("/api/tests/self", json={"assignment": SLUG, "results": ALL_RIGHT})
check("a student's own check is kept", r.status_code == 200 and r.get_json()["earned"] == 9)
page = teacher.get("/teacher/" + SLUG).get_data(as_text=True)
check("  and counts for nothing: no grade from it", "Tests not checked" in page
      and "(their check 9 / 9)" in page)
def test_xp(uid):
    db = P.SessionLocal()
    try:
        return sum(a.xp for a in db.query(accounts.XpAward).filter(
            accounts.XpAward.user_id == uid, accounts.XpAward.source.like("test:%")))
    finally:
        db.close()


check("  and pays none of the teacher's check's XP", test_xp(AMY) == 0, test_xp(AMY))


def self_xp(uid):
    db = P.SessionLocal()
    try:
        return sum(a.xp for a in db.query(accounts.XpAward).filter(
            accounts.XpAward.user_id == uid, accounts.XpAward.source.like("selftest:%")))
    finally:
        db.close()


check("  but each test it passes pays a little XP",
      r.get_json()["xp"] == len(ALL_RIGHT) * xp.SELF_TEST_XP == self_xp(AMY),
      (r.get_json(), self_xp(AMY)))
again = amy.post("/api/tests/self", json={"assignment": SLUG, "results": ALL_RIGHT}).get_json()
check("    once per test: checking again pays nothing",
      again["xp"] == 0 and self_xp(AMY) == len(ALL_RIGHT) * xp.SELF_TEST_XP, again)
made_up = [{"label": "Prints a million dollars", "ok": True, "detail": "", "points": 100}]
check("    and a test the notes don't have pays nothing",
      amy.post("/api/tests/self", json={"assignment": SLUG, "results": made_up}).get_json()["xp"] == 0)
FAILING = [dict(x, ok=False) for x in ALL_RIGHT]
check("    nor does one that failed",
      ben.post("/api/tests/self", json={"assignment": SLUG, "results": FAILING}).get_json()["xp"] == 0
      and self_xp(BEN) == 0)
check("    and the XP popup leaves it to the page, which said it already",
      not [a for a in amy.get("/api/me/xp/news?after=0").get_json()["awards"]
           if a["kind"] == "selftest"])
for page in ("app.js", "live.js"):
    js = open(os.path.join(ROOT, "static", page)).read()
    at = js.find('fetch("/api/tests/self"')
    check("    and " + page + " pops it up", at >= 0 and "d.xp > 0" in js[at:at + 700]
          and "PyIDEXP.toast(" in js[at:at + 700])
check("  not on the class page either",
      "badge-grade" not in amy.get("/class/%d" % CLASS).get_data(as_text=True))

r = teacher.get("/api/assignment/%s/tests/work" % SLUG)
work = {w["student"]: w for w in r.get_json().get("work", [])}
check("the teacher fetches what each student turned in",
      set(work) == {AMY, BEN} and work[AMY]["files"]["main.py"] == RIGHT
      and "notes.md" not in work[AMY]["files"])
check("  nobody else can", other.get("/api/assignment/%s/tests/work" % SLUG).status_code == 404
      and amy.get("/api/assignment/%s/tests/work" % SLUG).status_code == 403)

r = teacher.post("/api/assignment/%s/tests/verify" % SLUG,
                 json={"student": AMY, "results": ALL_RIGHT})
check("the teacher's check counts: 9 / 9 is the total", r.status_code == 200
      and r.get_json()["total"] == "9", r.get_json())
check("  and pays %d XP a point for the tests that pass" % xp.XP_PER_POINT,
      test_xp(AMY) == 9 * xp.XP_PER_POINT and r.get_json()["xp"] >= 90, test_xp(AMY))
teacher.post("/api/assignment/%s/tests/verify" % SLUG, json={"student": AMY, "results": ALL_RIGHT})
check("  checking again pays nothing twice", test_xp(AMY) == 9 * xp.XP_PER_POINT, test_xp(AMY))
BEN_LINES = ran["wrong_math"]["results"]
r = teacher.post("/api/assignment/%s/tests/verify" % SLUG,
                 json={"student": BEN, "results": BEN_LINES})
check("  a wrong program gets its points only", r.get_json()["total"] == str(
    int(ran["wrong_math"]["earned"])) or r.get_json()["total"] == "%g" % ran["wrong_math"]["earned"],
      (r.get_json(), ran["wrong_math"]["earned"]))
cheat = [dict(x, points=500) for x in ALL_RIGHT[:1]]
r = teacher.post("/api/assignment/%s/tests/verify" % SLUG, json={"student": BEN, "results": BEN_LINES,
                                                                   "earned": 999})
check("the points come from the lines, not a sum the page sent",
      r.get_json()["earned"] == ran["wrong_math"]["earned"], r.get_json())
check("a student can't post a verified result",
      amy.post("/api/assignment/%s/tests/verify" % SLUG,
               json={"student": AMY, "results": ALL_RIGHT}).status_code == 403)
check("  nor another teacher",
      other.post("/api/assignment/%s/tests/verify" % SLUG,
                 json={"student": AMY, "results": ALL_RIGHT}).status_code == 404)

page = teacher.get("/teacher/" + SLUG).get_data(as_text=True)
check("the results page has Check all, and each student's tests",
      "tests-check-all" in page and "Tests 9 / 9" in page and "✗ area(3, 4) gives 12" in page)
check("  and says how many tests the notes have", "8 tests" in page and "9 points" in page)
mine = amy.get("/my").get_data(as_text=True)
check("My work shows the grade with the tests in it",
      "Score: <strong>9 / 9</strong>" in mine and "9 from the questions and tests" in mine)
cls = amy.get("/class/%d" % CLASS).get_data(as_text=True)
check("so does the class page", '<span class="badge badge-grade">9 / 9</span>' in cls)

# Turning in again makes the check stale.
import time                                                  # noqa: E402
time.sleep(1.1)
turn_in(amy, RIGHT + "# more\n")
page = teacher.get("/teacher/" + SLUG).get_data(as_text=True)
check("work turned in again after the check is marked stale", "is-stale" in page and "⟳" in page)

# A quest completes on a checked full score.
teacher.post("/api/assignment/%s/xp-bonus" % SLUG, json={"xp": 25})
db = P.SessionLocal()
paid = {a.user_id for a in db.query(accounts.XpAward).filter(accounts.XpAward.source.like("bonus:%"))}
db.close()
check("full marks from the tests completes the quest", AMY in paid and BEN not in paid, paid)

import html as _html                                         # noqa: E402
import re as _re                                             # noqa: E402
helppage = client().get("/help/questions").get_data(as_text=True)
example = _html.unescape(_re.search(r'id="tests-example">(.*?)</pre>', helppage, _re.S).group(1))
# The help shows a note beside each line; the format has no such thing, so
# the notes are cut off before reading it — what is left must all be tests.
bare = "\n".join(_re.split(r"\s{3,}", ln)[0] for ln in example.split("\n"))
got, bad = autograde.parse(bare)
check("the help page's example is all tests", len(got) == 7 and not bad, (len(got), bad))

authoring = teacher.get("/teacher/%s/edit" % SLUG).get_data(as_text=True)
check("writing the notes, the teacher has a Tests link to the format",
      'help/questions#tests"' in authoring and ">Tests</a>" in authoring)

editor = amy.get("/p/" + DRAFTS[AMY]).get_data(as_text=True)
# Ben fixes his code: the next check pays the tests that now pass, only.
before = test_xp(BEN)
teacher.post("/api/assignment/%s/tests/verify" % SLUG, json={"student": BEN, "results": ALL_RIGHT})
check("fixed code is paid for the tests that now pass, and only those",
      before == ran["wrong_math"]["earned"] * xp.XP_PER_POINT
      and test_xp(BEN) == 9 * xp.XP_PER_POINT, (before, test_xp(BEN)))

# Checking is on the notes' tests cards only; the button at the top came out.
check("the editor loads autograde.js, with no Check my work at the top",
      'id="check"' not in editor and "autograde.js" in editor)

# ------------------------------------------------------------ live lessons
print("\nCheck my work in a live lesson")
LIVE = teacher.post("/api/live/start", json={"body": "x", "filename": "main.py",
                                            "title": "Live"}).get_json()["code"]
teacher.post("/api/live/%s/push" % LIVE, json={
    "body": "x", "seq": 5000, "filename": "main.py",
    "notes": "# Steps\n\n---\n\n## Step 1\n\n```tests\nuses for\n```\n"})
polled = amy.get("/api/live/%s" % LIVE).get_json() or {}
check("the tests reach the class with the notes",
      "```tests\nuses for" in (polled.get("notes") or ""), polled.get("notes"))
livepage = amy.get("/live/%s" % LIVE).get_data(as_text=True)
check("the live page has the tests to run, and no Check my work at the top",
      'id="check"' not in livepage and "autograde.js" in livepage)
livejs = open(os.path.join(ROOT, "static", "live.js")).read()
# The run the notes' cards use (runLiveChecks).
at = livejs.find("async function runLiveChecks")
body = re.sub(r"//[^\n]*", "", livejs[at:livejs.find("\n  }\n", at)]) if at >= 0 else ""
check("  which runs THEIR code, never the mirror",
      body and "mainSource()" in body and "mirror" not in body.lower()
      and "window.IDENotesChecks.setRunner(runLiveChecks)" in livejs, body[:80])

# ------------------------------------------- the step's slide, beside its results
print("\nThe notes stay up beside the output")
appjs = open(os.path.join(ROOT, "static", "app.js")).read()
fn = appjs[appjs.find("function showOutput() {"):]
fn = fn[:fn.find("\n  }\n")]
# The notes are a column of their own: showing the output never hides them,
# for anyone — a student checking their work, or the teacher writing.
check("the editor keeps the notes up when it shows the output",
      fn and "notesView.hidden" not in fn and "hideNotes" not in fn, fn[:160])
editor_html = open(os.path.join(ROOT, "templates", "index.html")).read()
cut = editor_html.find('<section id="notes-view" class="pane pane-notes"')
check("  in a column beside the output's, with a handle between them",
      cut > editor_html.find('<section class="pane pane-right">') > 0
      and 'data-split="editor-right"' in editor_html[max(0, cut - 120):cut])

print()
failed = results.count(False)
print("%d checks, %s" % (len(results), "all ok" if not failed else "%d FAILED" % failed))
sys.exit(1 if failed else 0)
