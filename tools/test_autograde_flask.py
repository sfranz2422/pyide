#!/usr/bin/env python3
"""Tests in an assignment's notes: Check my work and Check all (autograde.py,

FlaskIDE's tools/test_autograde.py, its first half, moved here with FlaskIDE
(Nov 2026): the format, the two readers agreeing, and the tests run on real
Flask. Its second half — the server's Check all, kept results and XP — comes
over when Flask assignments reach the teacher's pages here (step 4).
static/autograde.js, "Tests" in app.py).

    python3 tools/test_autograde_flask.py

WHY THIS FILE EXISTS

A test that passes a wrong app, or fails a right one, is a wrong grade —
and once the teacher presses Check all, it is the grade that goes to
Classroom. So this pins:

  * the format: requests (status, contains, a form), code checks, SQL
    rows and results, points, and a line that isn't a test being said
    rather than quietly skipped;
  * autograde.js reads every block exactly as autograde.py does (node);
  * the tests, run against the real bridge (flask.js's Python, on real
    Flask, as test_bridge.py does), pass the right app and fail each wrong
    one for the right reason — wrong status, wrong text, a route that
    crashes, a missing route, a route that never returns, an app that won't
    import, code that won't read — and a SQL project's query;
  * the server: a student's own check is kept and counts for nothing; only
    the teacher's verified result is added to the grade, and can complete
    a quest; a verified result older than the work is marked stale; a page
    can't claim more points than the lines it sent; only the teacher can
    fetch the work or post a verified result.

Needs node, and Flask installed for this Python (as test_bridge.py).
"""
import html as _html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUTOGRADE = os.path.join(ROOT, "static", "flask", "autograde.js")
FLASKJS = os.path.join(ROOT, "static", "flask", "flask.js")

DB = os.path.join(tempfile.mkdtemp(), "ag.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@school.org, other@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import autograde_flask as autograde                                             # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-64s %s" % ("ok" if ok else "FAIL", label, detail))


def set_notes(c, slug, text):
    """An assignment's notes, written where they are written now: its
    tutorial in the library (library.py), saved — and linked first, if it
    has none."""
    items = c.get("/api/library").get_json()["items"]
    mine = next((i for i in items if any(u["url"].rstrip("/").endswith("/" + slug) for u in i["uses"])), None)
    if mine is None:
        return c.post("/api/library", json={"body": text, "linkTo": slug})
    return c.post("/api/library/" + mine["slug"], json={"body": text})


NOTES = """# A greeting site

```tests
# a comment
GET / -> 200
GET / contains Welcome
GET /nope -> 404
POST /hello name=Sam&x=1 -> contains Hello, Sam
GET /about contains about &   US       (2 points)
uses render_template
defines home
avoids eval
```
"""

# ------------------------------------------------------------- the format
print("\nThe format")
tests, errors = autograde.parse(NOTES)
check("eight tests, comment skipped", [t["kind"] for t in tests] ==
      ["request"] * 5 + ["uses", "defines", "avoids"], [t["kind"] for t in tests])
check("a status test", tests[0]["method"] == "GET" and tests[0]["path"] == "/"
      and tests[0]["status"] == 200 and tests[0]["expect"] == "")
check("a contains test", tests[1]["status"] is None and tests[1]["expect"] == "Welcome")
check("a form goes with a POST", tests[3]["method"] == "POST" and tests[3]["form"] == "name=Sam&x=1"
      and tests[3]["expect"] == "Hello, Sam")
check("(2 points) is two points, the rest one each",
      [t["points"] for t in tests] == [1, 1, 1, 1, 2, 1, 1, 1])
check("labels read as sentences",
      [t["label"] for t in tests[:5]] == ["GET / answers 200", "GET / shows Welcome",
                                          "GET /nope answers 404",
                                          "POST /hello with name=Sam&x=1 shows Hello, Sam",
                                          "GET /about shows about &   US"]
      and tests[5]["label"] == "Uses render_template", [t["label"] for t in tests])
sql, _ = autograde.parse("```tests\nreturns 3 rows\nresult contains Alice\nreturns 1 row\n```")
check("SQL tests: rows and a result", [t["kind"] for t in sql] == ["rows", "result", "rows"]
      and sql[0]["count"] == 3 and sql[2]["label"] == "The query returns 1 row")
_, errs = autograde.parse("```tests\nGET / -> maybe\nopen the page\n```")
check("a line that isn't a test is an error, not skipped", len(errs) == 2, errs)
check("possible points add up", autograde.possible({"notes.md": NOTES}) == 9)

# ------------------------------------------------- the same in JavaScript
node = shutil.which("node")
if not node:
    check("node is available", False, "brew install node")
    sys.exit(1)
samples = [NOTES, "```tests\nGET /a?b=1 -> contains x\nPOST / a=1 -> 302\nGET / -> contains  Hi there\n```",
           "```tests\nreturns 3 rows (2 points)\nresult contains Alice (1 point)\nuses import sqlite3\n```",
           "```tests\nGET / -> maybe\nPOST /x -> 200\nnonsense\n```", "no block here"]
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
    py = autograde.parse(s)
    same = j["tests"] == py[0] and j["errors"] == py[1]
    check("  sample %d reads the same in both" % (i + 1), same,
          "" if same else "js=%r py=%r" % (j, py))

# ----------------------------------------- running them on the real bridge
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

print("\nRunning the tests (flask.js's Python, on real Flask)")
# The bridge as JavaScript hands it to Python: node evaluates flask.js's
# template literal, so every escape is undone exactly as in the browser.
src = open(FLASKJS).read()
literal = re.search(r"const BRIDGE = (`.*?`);", src, re.S).group(1)
project = tempfile.mkdtemp()
bridge = subprocess.run([node, "-e", "const PROJECT=%s;process.stdout.write(%s)"
                         % (json.dumps(project), literal)], capture_output=True, text=True).stdout
harness = subprocess.run([node, "-e", "global.window={};eval(require('fs').readFileSync(%s,'utf8'));"
                          "process.stdout.write(window.PyIDETests.HARNESS)" % json.dumps(AUTOGRADE)],
                         capture_output=True, text=True).stdout
check("the bridge and the harness were found", "_flaskide_load" in bridge
      and "_flaskide_autograde" in harness)

RIGHT = '''from flask import Flask, render_template, request
app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/about")
def about():
    return "<h1>About &amp; us</h1>"

@app.route("/hello", methods=["POST"])
def hello():
    return "Hello, " + request.form["name"] + "!"
'''
INDEX = "<html><body><h1>Welcome   to my site</h1></body></html>"
APPS = {
    "right": {"app.py": RIGHT, "templates/index.html": INDEX},
    "wrong_text": {"app.py": RIGHT, "templates/index.html": "<h1>Hi</h1>"},
    "crashes": {"app.py": RIGHT.replace('"!"', '1'),
                "templates/index.html": INDEX},
    "no_about": {"app.py": RIGHT.replace('@app.route("/about")\ndef about():\n'
                                         '    return "<h1>About &amp; us</h1>"\n', ""),
                 "templates/index.html": INDEX},
    "endless": {"app.py": RIGHT.replace('    return "<h1>About &amp; us</h1>"',
                                        '    while True:\n        pass'),
                "templates/index.html": INDEX},
    "wont_import": {"app.py": RIGHT + "\nimport no_such_module\n",
                    "templates/index.html": INDEX},
    "unreadable": {"app.py": RIGHT.replace("def home():", "def home()"),
                   "templates/index.html": INDEX},
    "evil": {"app.py": RIGHT + "\neval('1')\n", "templates/index.html": INDEX},
}
SQL_NOTES = "```tests\nreturns 2 rows\nresult contains Alice\nresult contains Zed\nreturns 5 rows\n```"
SQL_FILES = {"schema.sql": "CREATE TABLE p (name TEXT);\nINSERT INTO p VALUES ('Alice'), ('Bob');",
             "query.sql": "-- everyone\nSELECT name FROM p ORDER BY name;"}
runner = '''
import json, sys
scope = {}
exec(compile(open(sys.argv[1]).read(), "flask.js:BRIDGE", "exec"), scope)
exec(compile(open(sys.argv[2]).read(), "autograde.js:HARNESS", "exec"), scope)
jobs = json.load(open(sys.argv[3]))
out = {}
for name, (files, tests) in jobs.items():
    out[name] = json.loads(scope["_flaskide_autograde"](json.dumps(files), json.dumps(tests), 2))
print(json.dumps(out))
'''
tmp = tempfile.mkdtemp()
for name, text in (("bridge.py", bridge), ("harness.py", harness), ("runner.py", runner)):
    with open(os.path.join(tmp, name), "w") as f:
        f.write(text)
jobs = {name: [files, tests] for name, files in APPS.items()}
jobs["sql"] = [SQL_FILES, autograde.parse(SQL_NOTES)[0]]
jobs["sql_broken"] = [dict(SQL_FILES, **{"query.sql": "SELEC name FROM p;"}), autograde.parse(SQL_NOTES)[0]]
# Operators: `uses +` once looked for a name called "+", and failed on code
# that plainly used it (a student's print(3+4) in GameIDE found it).
# A login (Flask's session) and a form that redirects, as Web 2's logins
# unit has them: each test had its own client, so a login was forgotten by
# the next test, and a POST that redirected answered 302 to `contains`.
LOGIN = """from flask import Flask, session, request, redirect
app = Flask(__name__)
app.secret_key = "dev"

@app.route("/login", methods=["POST"])
def login():
    session["user"] = request.form["name"]
    return redirect("/secret")

@app.route("/secret")
def secret():
    if "user" not in session:
        return "Please log in", 401
    return "Welcome, " + session["user"]
"""
# A field sent empty (title=) reaches the route as "", as a browser sends a
# blank box: parse_qsl dropped it, so "you left the title blank" was untestable.
jobs["blank"] = [{"app.py": "from flask import Flask, request\napp = Flask(__name__)\n"
                  "@app.route('/add', methods=['POST'])\ndef add():\n"
                  "    return 'Please give a title' if request.form['title'] == '' else 'ok'\n"},
                 autograde.parse("```tests\nPOST /add title= -> contains Please give a title\n```")[0]]
# A duplicate caught without rollback() left data.db locked for the next
# test's write: "Still running after 5 seconds" on a right app.
jobs["locky"] = [{"schema.sql": "CREATE TABLE t (name TEXT UNIQUE);\nINSERT INTO t VALUES ('a');",
                  "app.py": "import sqlite3\nfrom flask import Flask, request\napp = Flask(__name__)\n"
                            "@app.route('/add', methods=['POST'])\ndef add():\n"
                            "    db = sqlite3.connect('data.db')\n    try:\n"
                            "        db.execute('INSERT INTO t VALUES (?)', (request.form['name'],))\n"
                            "        db.commit()\n        return 'added'\n"
                            "    except sqlite3.IntegrityError:\n        return 'taken'\n"},
                 autograde.parse("```tests\nPOST /add name=a -> contains taken\nPOST /add name=b -> contains added\n```")[0]]
jobs["login"] = [{"app.py": LOGIN}, autograde.parse(
    "```tests\nGET /secret -> 401\nPOST /login name=sam -> contains Welcome, sam\n"
    "GET /secret contains Welcome, sam\nPOST /login name=ana -> 302\n```")[0]]
jobs["ops"] = [{"app.py": "x = 3+4\nif x == 7 and True:\n    y = 'a-b'\n"},
               autograde.parse("```tests\nuses +\nuses ==\nuses and\nuses -\navoids *\n```")[0]]
with open(os.path.join(tmp, "jobs.json"), "w") as f:
    json.dump(jobs, f)
out = subprocess.run([sys.executable, os.path.join(tmp, "runner.py"), os.path.join(tmp, "bridge.py"),
                      os.path.join(tmp, "harness.py"), os.path.join(tmp, "jobs.json")],
                     capture_output=True, text=True, cwd=tmp, timeout=300)
try:
    ran = json.loads(out.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    ran = {}
check("every app was checked", len(ran) == len(jobs), out.stderr[-500:])
check("a field sent empty (title=) reaches the route as an empty string",
      [x["ok"] for x in ran.get("blank", {}).get("results", [])] == [True], ran.get("blank"))
check("a duplicate caught without rollback() doesn't lock the next test's write",
      [x["ok"] for x in ran.get("locky", {}).get("results", [])] == [True, True], ran.get("locky"))
lg = [x["ok"] for x in ran.get("login", {}).get("results", [])]
check("a POST that redirects is followed for `contains`, as a browser follows it", lg[1:2] == [True], ran.get("login"))
check("  a login in one test is still logged in for the next (one client per check)", lg[2:3] == [True], ran.get("login"))
check("  and a status test still sees the redirect itself", lg[3:4] == [True] and lg[:1] == [True], ran.get("login"))


def lines(name):
    return {r["label"]: r for r in ran.get(name, {}).get("results", [])}


ops = [x["ok"] for x in ran.get("ops", {}).get("results", [])]
check("uses + sees 3+4, == and and too — operators, read from the code's tree",
      ops[:3] == [True, True, True], ran.get("ops"))
check("  a - inside a string isn't a minus, and avoids * holds", ops[3:] == [False, True], ran.get("ops"))

r = ran.get("right", {})
check("the right app passes everything: 9 of 9", r.get("earned") == 9 and r.get("possible") == 9,
      [(x["label"], x["detail"]) for x in r.get("results", []) if not x["ok"]])
check("  contains ignores case and spacing, and reads the page as text",
      lines("right")["GET / shows Welcome"]["ok"] and lines("right")["GET /about shows about &   US"]["ok"])
L = lines("wrong_text")
check("wrong text fails, saying what the page showed",
      not L["GET / shows Welcome"]["ok"] and "It showed: Hi" in L["GET / shows Welcome"]["detail"]
      and L["GET / answers 200"]["ok"], L["GET / shows Welcome"])
L = lines("crashes")
check("a route that crashes fails, naming the error",
      not L["POST /hello with name=Sam&x=1 shows Hello, Sam"]["ok"]
      and "crashed" in L["POST /hello with name=Sam&x=1 shows Hello, Sam"]["detail"],
      L["POST /hello with name=Sam&x=1 shows Hello, Sam"]["detail"])
L = lines("no_about")
check("a missing route fails with the status it got",
      not L["GET /about shows about &   US"]["ok"] and "404" in L["GET /about shows about &   US"]["detail"],
      L["GET /about shows about &   US"]["detail"])
L = lines("endless")
check("a route that never returns fails instead of hanging",
      "never ends" in L["GET /about shows about &   US"]["detail"] and L["GET / answers 200"]["ok"],
      L["GET /about shows about &   US"]["detail"])
L = lines("wont_import")
check("an app that won't import fails every request, saying why",
      all(not L[t["label"]]["ok"] for t in tests if t["kind"] == "request")
      and "ModuleNotFoundError" in L["GET / answers 200"]["detail"]
      and L["Uses render_template"]["ok"], L["GET / answers 200"]["detail"])
L = lines("unreadable")
check("code that won't read fails everything, saying where",
      ran["unreadable"]["earned"] == 0 and "can't be read" in L["Defines home()"]["detail"])
check("avoids catches a name that is used", not lines("evil")["Doesn't use eval"]["ok"]
      and lines("right")["Doesn't use eval"]["ok"])
check("a status test passes on the right status only", lines("right")["GET /nope answers 404"]["ok"]
      and not lines("no_about")["GET /about shows about &   US"]["ok"])
L = lines("sql")
check("SQL: the last query's rows are counted", L["The query returns 2 rows"]["ok"]
      and not L["The query returns 5 rows"]["ok"]
      and L["The query returns 5 rows"]["detail"] == "It returned 2 rows.", L.get("The query returns 5 rows"))
check("  a value in them is found, and one not there isn't",
      L["The query's result contains Alice"]["ok"] and not L["The query's result contains Zed"]["ok"]
      and "Alice" in L["The query's result contains Zed"]["detail"])
L = lines("sql_broken")
check("  a query that won't run fails, saying why",
      not L["The query returns 2 rows"]["ok"] and "SQL didn't run" in L["The query returns 2 rows"]["detail"])

print()
failed = results.count(False)
print("%d checks, %s" % (len(results), "all ok" if not failed else "%d FAILED" % failed))
sys.exit(1 if failed else 0)
