#!/usr/bin/env python3
"""Hints under a test ("Hints" in app.py, hints.py, static/hints.js).

    python3 tools/test_hints.py

  * the format: `hint:` / `code:` lines belong to the test above, code keeps
    its indentation, a hint under no test is dropped — in Python's, the
    web's and Flask's grammars alike
  * every parser (three in Python, three in JavaScript) skips them: never a
    test, never an error
  * they're out of every copy a student gets (test_quiz.py's leak checks
    hold every exit; here, the redaction itself)
  * the API: which tests have hints, never their text; hints given in
    order, once paid for open again free; the teacher's and a signed-out
    visitor's not recorded; none in a quiz
  * the cost: the second hint takes a quarter of that test's points, the
    code half more, on the teacher's checked result at once and on every
    check after — levels included; failing a check costs nothing
  * the gradebook cell says how many paid hints a score has had
"""
import json
import re as _re_mod
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "hints.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import autograde                                             # noqa: E402
import autograde_flask                                       # noqa: E402
import autograde_web                                         # noqa: E402
import hints                                                 # noqa: E402
import quiz                                                  # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:300]))


PY = """# Step

```tests
prints Hello
hint: Use print() with the words in quotes.
hint: It's one line: print("Hello")
code: print("Hello")
uses for (2 points)
hint: A for loop repeats.
code: for i in range(3):
code:     print(i)
defines area
```
"""
STRAY = "```tests\nhint: under nothing\nprints Hi\n```\n"
WEB = "```tests\nhas h1\nhint: An h1 is the biggest heading.\ncode: <h1>Hi</h1>\n```\n"
# A Try It step: a `:::pop editor` box says what to type, its card under
# it. Its hints are free (the teacher, Nov 2026); the warm-up after it,
# with its directions on the slide, keeps the costs. "Prints Hi" is in
# both a free and a paid block: paid, so the free one can't be a way round.
TRY = """:::pop editor
Type `print("Hey")`.
:::

^

```tests
prints Hey
hint: Type what's in the box.
hint: print, brackets, "Hey".
code: print("Hey")
```

## Warm-Up

Print Yo, then Hi.

```tests
prints Yo
hint: Use print.
hint: print("Yo")
code: print("Yo")
prints Hi
hint: paid here
```

:::pop editor
Type `print("Hi")`.
:::

```tests
prints Hi
hint: free here
```
"""
# v12 from Nov 2026: a Try It step typed on the slide (```tests try).
# Practice: never graded, hints free. Then a closing `:::pop editor` box
# with no card, a new slide, and the warm-up — whose hints must still cost
# (the closing box once made the warm-up free).
SLIDE_TRY = """:::pop
Type `print("Hey")`.
:::

```tests try
prints Hey
hint: Type what's in the box.
uses +
hint: A plus.
```

:::pop editor
✓ That's the Try It.
:::

---

## Warm-Up

```tests
prints Yo
hint: Use print.
```
"""
FLASK = "```tests\nreturns 2 rows\nhint: WHERE keeps some rows.\ncode: SELECT * FROM t WHERE x > 1;\n```\n"

NODE = r"""
const fs = require("fs");
const md = JSON.parse(process.argv[1]);
const out = {};
for (const [k, f, n] of [["py", "static/autograde.js", "PyIDETests"], ["web", "static/web/autograde.js", null], ["flask", "static/flask/autograde.js", "PyIDETests"]]) {
  try {
    const window = {}; new Function("window", "document", fs.readFileSync(f, "utf8"))(window, {});
    const T = window.PyIDETests || window.WebIDETests || Object.values(window).find(v => v && v.parse);
    const got = T.parse(md[k]);
    out[k] = { labels: got.tests.map(t => t.label), errors: got.errors };
  } catch (e) { out[k] = { error: String(e) }; }
}
console.log(JSON.stringify(out));
"""


def user(sub, email, name):
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


def make(teacher, notes, cls, ide="pyide", kind=None):
    body = {"title": "Hinted", "ide": ide} if kind is None else {"title": "Hinted", "kind": kind}
    slug = teacher.post("/api/class/%d/new" % cls, json=body).get_json()["slug"]
    db = P.SessionLocal()
    it = db.query(accounts.Assignment).filter_by(slug=slug).first()
    files = it.file_map()
    files["notes.md"] = notes
    it.files = json.dumps(files)
    it.out_of = 4
    db.commit()
    db.close()
    return slug


def item_of(slug):
    db = P.SessionLocal()
    try:
        return db.query(accounts.Assignment).filter_by(slug=slug).first()
    finally:
        db.close()


def main():
    print("The format")
    got = hints.collect(PY, autograde.parse_block)
    check("each test's hints and code, by its label",
          got == {"Prints Hello": {"hints": ["Use print() with the words in quotes.", "It's one line: print(\"Hello\")"],
                                   "code": 'print("Hello")', "free": False},
                  "Uses a for loop": {"hints": ["A for loop repeats."], "code": "for i in range(3):\n    print(i)",
                                      "free": False}}, got)
    check("…code keeps its indentation; a test with none (defines area) isn't listed", "Defines area()" not in got)
    check("a hint under no test is dropped", hints.collect(STRAY, autograde.parse_block) == {},
          hints.collect(STRAY, autograde.parse_block))
    check("the web's grammar", hints.collect(WEB, autograde_web.parse_block).get(
        autograde_web.parse_block("has h1")[0][0]["label"], {}).get("code") == "<h1>Hi</h1>",
          hints.collect(WEB, autograde_web.parse_block))
    check("Flask / SQL's grammar", list(hints.collect(FLASK, autograde_flask.parse_block).values())[0]["code"]
          == "SELECT * FROM t WHERE x > 1;", hints.collect(FLASK, autograde_flask.parse_block))

    print("Every parser skips them")
    t, e = autograde.parse(PY)
    check("autograde.py: three tests, no errors", [x["label"] for x in t] == ["Prints Hello", "Uses a for loop", "Defines area()"]
          and not e, (t, e))
    check("autograde_web.py: one test, no errors", len(autograde_web.parse(WEB)[0]) == 1 and not autograde_web.parse(WEB)[1],
          autograde_web.parse(WEB))
    check("autograde_flask.py: one test, no errors", len(autograde_flask.parse(FLASK)[0]) == 1 and not autograde_flask.parse(FLASK)[1],
          autograde_flask.parse(FLASK))
    # A hint that LOOKS like a test (" == " makes a call test) must still be a hint.
    tricky = "```tests\nprints 4\nhint: 2 + 2 == 4\n```\n"
    check("…even a hint that reads like a test (2 + 2 == 4)", len(autograde.parse(tricky)[0]) == 1, autograde.parse(tricky))
    run = subprocess.run(["node", "-e", NODE, json.dumps({"py": PY + tricky, "web": WEB, "flask": FLASK})],
                         cwd=ROOT, capture_output=True, text=True, timeout=60)
    try:
        js = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        js = {"error": run.stderr[-300:]}
    check("autograde.js reads the same tests, no errors", (js.get("py") or {}).get("labels")
          == [x["label"] for x in autograde.parse(PY + tricky)[0]] and not js["py"]["errors"], js.get("py") or js)
    check("web/autograde.js too", len((js.get("web") or {}).get("labels") or []) == 1 and not js["web"]["errors"], js.get("web"))
    check("flask/autograde.js too", len((js.get("flask") or {}).get("labels") or []) == 1 and not js["flask"]["errors"], js.get("flask"))

    print("Out of what students get")
    red = quiz.redact(PY)
    check("redacting takes every hint and code line out, and keeps every test",
          "hint:" not in red and "code:" not in red and autograde.parse(red)[0] == autograde.parse(PY)[0], red)
    outside = "Some text.\nhint: this is just prose, not in a tests block\n" + PY
    check("…but a 'hint:' line outside a tests block is the teacher's prose, left alone",
          "just prose" in quiz.redact(outside))

    tid = user("t", "teacher@example.org", "Teach")
    sid, s2 = user("s", "kid@example.org", "Kid Student"), user("s2", "pal@example.org", "Pal Student")
    teacher, kid, pal, nobody = client(tid), client(sid), client(s2), client()
    cls = teacher.post("/api/class", json={"name": "P4"}).get_json()["id"]
    db = P.SessionLocal()
    for email, name in (("kid@example.org", "Kid Student"), ("pal@example.org", "Pal Student")):
        db.add(accounts.Enrollment(class_id=cls, email=email, name=name))
    db.commit()
    db.close()
    slug = make(teacher, PY, cls)
    item = item_of(slug)

    print("The API")
    lst = kid.get("/api/hints/" + slug).get_json()
    check("which tests have hints, and their steps — never the text",
          lst["tests"] == {"Prints Hello": {"steps": [1, 2, 3], "free": False}, "Uses a for loop": {"steps": [1, 3], "free": False}}
          and "print(" not in json.dumps(lst) and lst["quiz"] is False, lst)
    check("…the costs: first free, second a quarter, code half", lst["costs"] == {"1": 0.0, "2": 0.25, "3": 0.5}, lst["costs"])
    take = lambda c, label, level: c.post("/api/hints/" + slug, json={"label": label, "level": level})
    r = take(kid, "Prints Hello", 2)
    check("the second hint before the first: refused", r.status_code == 409, r.get_json())
    r = take(kid, "Prints Hello", 3)
    check("the code before the hints: refused", r.status_code == 409)
    r = take(kid, "Prints Hello", 1).get_json()
    check("the first hint: its text, free", r.get("text") == "Use print() with the words in quotes." and r["cost"] == 0, r)
    check("a hint that doesn't exist (level 2 of a test with one hint): 404", take(kid, "Uses a for loop", 2).status_code == 404)
    check("…nor a test that isn't there", take(kid, "Prints Goodbye", 1).status_code == 404)

    tr = hints.collect(TRY, autograde.parse_block)
    check("a test under a `:::pop editor` box (a Try It step) is free; the warm-up's isn't",
          tr["Prints Hey"]["free"] is True and tr["Prints Yo"]["free"] is False, tr)
    check("…a test in both a free and a paid block is paid", tr["Prints Hi"]["free"] is False, tr["Prints Hi"])

    st = hints.collect(SLIDE_TRY, autograde.parse_block)
    check("a ```tests try step's hints are free; the warm-up's, a slide after a closing editor box, aren't",
          (st.get("Prints Hey") or {}).get("free") is True and (st.get("Uses +") or {}).get("free") is True
          and (st.get("Prints Yo") or {}).get("free") is False, st)
    got, bad = autograde.parse(SLIDE_TRY)
    check("…and a ```tests try step is never graded: not among the tests, not in what it's out of",
          [t["label"] for t in got] == ["Prints Yo"] and not bad
          and autograde.possible({"notes.md": SLIDE_TRY}) == 1, ([t["label"] for t in got], bad))
    check("…but a typo in one is still said",
          autograde.parse("```tests try\nprnts Hey\n```\n")[1] != [])
    js = subprocess.run(["node", "-e", NODE, json.dumps({"py": SLIDE_TRY, "web": WEB, "flask": FLASK})],
                        cwd=ROOT, capture_output=True, text=True)
    jp = json.loads(js.stdout or "{}").get("py", {})
    check("…and autograde.js reads it the same (Check my work on main.py never runs it)",
          jp.get("labels") == ["Prints Yo"] and jp.get("errors") == [], jp or js.stderr[-300:])
    js2 = subprocess.run(["node", "-e", NODE, json.dumps({
        "py": SLIDE_TRY,
        "web": "```tests try\nhas h1\nhint: An h1.\n```\n\n```tests\nhas p\n```\n",
        "flask": "```tests try\nGET / contains Hi\n```\n\n```tests\nGET / -> 200\n```\n"})], cwd=ROOT, capture_output=True, text=True)
    jw = json.loads(js2.stdout or "{}")
    check("…and the web's and Flask's autograde.js leave theirs out too (Check my work never runs them)",
          (jw.get("web") or {}).get("labels") == ["Has p"] and (jw.get("flask") or {}).get("labels") == ["GET / answers 200"],
          (jw, js2.stderr[-300:]))
    # A test written at several levels (`uses prompt` at Easy and Master):
    # each level's own hints and code, not one list for all (Nov 2026).
    LV = ("```tests exercise easy\nuses prompt\nhint: EASY one\nhint: EASY two\ncode: let a = prompt(\"x\");\n```\n\n"
          "```tests exercise master\nuses prompt\nhint: MASTER one\nhint: MASTER two\ncode: let b = prompt(\"y\");\n```\n")
    lv = hints.collect(LV, autograde_web.parse_block)
    check("a test at two levels keeps each level's hints and code apart (by_level)",
          lv["Uses prompt"].get("by_level", {}).get("master", {}).get("hints") == ["MASTER one", "MASTER two"]
          and lv["Uses prompt"].get("by_level", {}).get("easy", {}).get("code") == 'let a = prompt("x");', lv)
    WEBHASH = "```tests\nhas h1\nhint: H1 one\nhint: H1 two\ncode: <h1>x</h1>\n#title contains Hi\nhint: ID one\nhint: ID two\ncode: <p id=\"title\">Hi</p>\n```\n"
    wh = hints.collect(WEBHASH, autograde_web.parse_block)
    check("a web test starting with # (#title contains …) has its own hints, not the test above's",
          wh.get("#title contains Hi", {}).get("hints") == ["ID one", "ID two"] and wh["Has h1"]["hints"] == ["H1 one", "H1 two"], wh)
    check("…and a Python # line is still a comment", "x" not in json.dumps(hints.collect("```tests\n# x\nprints a\nhint: p\n```\n", autograde.parse_block)))
    witem = make(teacher, LV, cls, ide="webide")
    seen = teacher.get("/api/hints/%s?level=master" % witem).get_json()
    got = teacher.post("/api/hints/" + witem, json={"label": "Uses prompt", "level": 3, "viewLevel": "master"}).get_json()
    check("the server hands out the level's own code (a preview at Master: Master's, not all levels joined)",
          got.get("text") == 'let b = prompt("y");' and seen["tests"]["Uses prompt"]["steps"] == [1, 2, 3], (got, seen))
    lvk = client(user("lvk", "lvk@example.org", "Level Kid"))
    kg = lvk.post("/api/hints/" + witem, json={"label": "Uses prompt", "level": 1, "viewLevel": "master"}).get_json()
    lvk.post("/api/hints/" + witem, json={"label": "Uses prompt", "level": 2, "viewLevel": "master"})
    kc = lvk.post("/api/hints/" + witem, json={"label": "Uses prompt", "level": 3, "viewLevel": "master"}).get_json()
    check("…a student gets their own level's (Easy until the teacher sets one), whatever level the page asks for",
          kg.get("text") == "EASY one" and kc.get("text") == 'let a = prompt("x");', (kg, kc))
    item_try = make(teacher, SLIDE_TRY, cls)
    redacted = kid.get("/a/" + item_try, follow_redirects=True).get_data(as_text=True)
    check("…its hint lines are out of the student's copy", "A plus." not in redacted and "tests try" in redacted)

    print("The cost")
    # The teacher's Check all on the kid's work: both tests pass (3 of 4 points; area fails).
    db = P.SessionLocal()
    db.add(accounts.Submission(assignment_id=item.id, student_id=sid, snippet_slug="", times_submitted=1))
    db.add(accounts.Submission(assignment_id=item.id, student_id=s2, snippet_slug="", times_submitted=1))
    db.commit()
    lines = [{"label": "Prints Hello", "ok": True, "points": 1}, {"label": "Uses a for loop", "ok": True, "points": 2},
             {"label": "Defines area()", "ok": False, "points": 1}]
    P._keep_result(db, item, sid, "verified", {"results": lines})
    P._keep_result(db, item, s2, "verified", {"results": lines})
    db.close()
    earned = lambda who: P._earned(P.SessionLocal(), item.id).get(who)
    check("before any paid hint: 3 points (a free hint costs nothing)", earned(sid) == 3, earned(sid))
    r = take(kid, "Prints Hello", 2).get_json()
    check("the second hint: its text, a quarter of that test", r.get("text", "").startswith("It's one line") and r["cost"] == 0.25, r)
    check("…taken off the checked result at once: 2.75", earned(sid) == 2.75, earned(sid))
    take(kid, "Prints Hello", 3)
    check("the code: half more, 2.25 (that test keeps a quarter)", earned(sid) == 2.25, earned(sid))
    again = take(kid, "Prints Hello", 3).get_json()
    check("opened again: its text, and charged nothing more", again.get("text") == 'print("Hello")' and earned(sid) == 2.25, earned(sid))
    take(kid, "Uses a for loop", 1)
    take(kid, "Uses a for loop", 3)
    check("the for loop's code (worth 2): half of it, 1 point — 1.25 in all", earned(sid) == 1.25, earned(sid))
    check("the other student, who took none, keeps all 3", earned(s2) == 3, earned(s2))
    db = P.SessionLocal()
    row = P._keep_result(db, item, sid, "verified", {"results": lines})
    after = (row.earned, row.possible)
    db.close()
    check("a later Check all scores with the hints' cost too, out of the same 4", after == (1.25, 4.0), after)
    db = P.SessionLocal()
    failing = [{"label": "Prints Hello", "ok": False, "points": 1}]
    row = P._keep_result(db, item, s2, "self", {"results": failing})
    db.close()
    taken = P.SessionLocal().query(P.HintTaken).filter_by(student_id=s2).count()
    check("failing a check costs nothing and records nothing", taken == 0 and earned(s2) == 3, (taken, earned(s2)))
    mine = kid.get("/api/hints/" + slug).get_json()["taken"]
    check("the student's page is told what they've opened", mine == {"Prints Hello": [1, 2, 3], "Uses a for loop": [1, 3]}, mine)

    print("Who is charged")
    r = take(teacher, "Prints Hello", 3).get_json()
    check("the teacher: any hint, in any order, recorded nowhere",
          r.get("text") == 'print("Hello")' and r["recorded"] is False
          and not P.SessionLocal().query(P.HintTaken).filter_by(student_id=tid).count(), r)
    r = take(nobody, "Prints Hello", 1).get_json()
    check("signed out: the hint, recorded nowhere (there's no grade to take from)", r.get("text") and r["recorded"] is False, r)

    print("A quiz")
    qslug = make(teacher, "quiz: yes\n" + PY, cls)
    q = kid.get("/api/hints/" + qslug).get_json()
    check("no hints in a quiz: none listed, and asking is refused",
          q["quiz"] is True and q["tests"] == {} and kid.post("/api/hints/" + qslug, json={"label": "Prints Hello", "level": 1}).status_code == 403, q)

    print("Levels")
    LV = ("```tests exercise easy\nprints Hi\nhint: say Hi\nhint: print it\ncode: print(\"Hi\")\n```\n"
          "```tests exercise master\nprints Hey\n```\n")
    lslug = make(teacher, LV, cls)
    litem = item_of(lslug)
    db = P.SessionLocal()
    db.add(accounts.Submission(assignment_id=litem.id, student_id=sid, snippet_slug="", times_submitted=1))
    db.commit()
    P._keep_result(db, litem, sid, "verified", {"results": [{"label": "Prints Hi", "ok": True, "points": 1}]})
    db.close()
    lslugtake = lambda lv: kid.post("/api/hints/" + lslug, json={"label": "Prints Hi", "level": lv})
    for lv in (1, 2):
        lslugtake(lv)
    e = P._earned(P.SessionLocal(), litem.id).get(sid)
    check("an Easy exercise's test with its second hint taken: 0.75", e == 0.75, e)

    print("A Try It step")
    tslug = make(teacher, TRY, cls)
    titem = item_of(tslug)
    lst = kid.get("/api/hints/" + tslug).get_json()
    check("the page is told which tests' hints are free",
          lst["tests"]["Prints Hey"]["free"] is True and lst["tests"]["Prints Yo"]["free"] is False, lst["tests"])
    db = P.SessionLocal()
    db.add(accounts.Submission(assignment_id=titem.id, student_id=sid, snippet_slug="", times_submitted=1))
    db.commit()
    P._keep_result(db, titem, sid, "verified", {"results": [{"label": "Prints Hey", "ok": True, "points": 1},
                                                            {"label": "Prints Yo", "ok": True, "points": 1}]})
    db.close()
    tk = lambda label, lv: kid.post("/api/hints/" + tslug, json={"label": label, "level": lv}).get_json()
    got = [tk("Prints Hey", lv) for lv in (1, 2, 3)]
    e = P._earned(P.SessionLocal(), titem.id).get(sid)
    check("every hint and the code on a Try It step: recorded, costing nothing, 2 of 2 kept",
          [g.get("cost") for g in got] == [0, 0, 0] and all(g.get("recorded") for g in got) and e == 2, (got, e))
    tk("Prints Yo", 1)
    r = tk("Prints Yo", 2)
    e = P._earned(P.SessionLocal(), titem.id).get(sid)
    check("the warm-up's second hint still costs a quarter: 1.75", r.get("cost") == 0.25 and e == 1.75, (r, e))

    print("The gradebook")
    page = teacher.get("/teacher/class/%d/gradebook" % cls).get_data(as_text=True)
    check("the cell says how many paid hints its score has had (💡3 for Hinted: hint 2 and the code, the loop's code)", "💡3" in page and "gb-hints" in page,
          page[page.find("gb-hints") - 200: page.find("gb-hints") + 200] if "gb-hints" in page else "no gb-hints")
    marks = sorted(_re_mod.findall(r"💡(\d+)</span>", page))
    check("…a Try It step's hints aren't counted (💡1 there: the warm-up's second hint, not the step's two)",
          marks == ["1", "1", "3"], marks)

    print("The help")
    import html as _html
    import re as _re
    hp = nobody.get("/help/questions").get_data(as_text=True)
    m = _re.search(r'<pre class="help-src" id="tests-hints-example">(.*?)</pre>', hp, _re.S)
    ex = _html.unescape(m.group(1)) if m else ""
    got = hints.collect(ex, autograde.parse_block)
    check("/help/questions#tests-hints: its example is two tests with hints, read as the help says",
          list(got) == ["Prints Hello", "Uses a for loop"] and len(got["Prints Hello"]["hints"]) == 2
          and got["Uses a for loop"]["code"] == "for n in range(3):\n    print(n)"
          and not autograde.parse(ex)[1], (got, autograde.parse(ex)[1]))
    check("…and says what they cost, as HINT_COSTS does",
          P.HINT_COSTS == {1: 0.0, 2: 0.25, 3: 0.5} and "a quarter of that test" in hp and "costs half more" in hp)

    print("The pages")
    ed = kid.get("/a/" + slug, follow_redirects=True).get_data(as_text=True)
    check("the student's editor loads hints.js, and the notes in it have no hint text",
          "hints.js" in ed and "Use print() with the words" not in ed and "code: print" not in ed)

    for js in ("static/app.js", "static/live.js"):
        src = open(os.path.join(ROOT, js)).read()
        check("%s: a Try It box on the slide is checked on its own code (setTryRunner)" % js,
              "setTryRunner(" in src)
        check("%s: a program asking for input() after a check holds the card (IDEHints.wait)" % js,
              "IDEHints.wait(ran)" in src and "input\\s*\\(" in src)

    print()
    failed = results.count(False)
    print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
    shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
