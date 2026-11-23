#!/usr/bin/env python3
"""A Try It step typed on the slide in a web, Flask, SQL and PHP lesson, in
Chrome with each one's real runner (try_slide_ides_browser.mjs).

    python3 tools/test_try_slide_ides_browser.py
    TRYIDE_SHOT=/some/dir python3 tools/test_try_slide_ides_browser.py   # and screenshots

The teacher (Nov 2026): "how can we solve the html, flask and php tutorials.
I'd rather have everything in the slides". A ```tests try block in any of
those lessons is a box on the slide like Python's (test_try_slide_browser.py):

  * a web lesson's box is one whole page (the teacher's choice), checked by
    WebIDE's checker as index.html and shown under the box in a frame;
  * a Flask, SQL or PHP lesson's box is the project's entry — app.py,
    query.sql, index.php — with the rest of the project beside it (the SQL
    lesson's schema.sql), checked by FlaskIDE's checker, then its / page or
    its query's rows shown under the box;
  * none of it is posted, and none of it is graded (autograde_web.py and
    autograde_flask.py leave `try` out; test_hints.py has the server side).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "tryide.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
import autograde_flask                                       # noqa: E402
import autograde_web                                         # noqa: E402
from werkzeug.serving import make_server                     # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:400]))


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


def notes(step, tests):
    return ":::pop\n%s\n:::\n\n```tests try\n%s\n```\n" % (step, tests)


KINDS = {
    "web": ("webide", P.WEB_STARTER,
            notes("Type `<h1>Hello</h1>`.\n\nIt should show Hello in big letters.", "has h1\nh1 contains Hello\nhint: An h1 tag."),
            "<!doctype html>\n<h1>Hello</h1>\n", "<!doctype html>\n<p>Hello</p>\n", "Hello"),
    "flask": ("flaskide", P.FLASK_STARTER,
              notes("A route that says hi.", "GET / contains Hi there"),
              'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef home():\n    return "<p>Hi there</p>"\n',
              'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef home():\n    return "<p>Bye</p>"\n', "Hi there"),
    "sql": ("flaskide", P.SQL_STARTER,
            notes("Every teacher.", "returns 6 rows"),
            "SELECT * FROM teachers;\n", "SELECT * FROM teachers LIMIT 2;\n", "rows"),
    # A SQL box with no SELECT (SQL Day 3's INSERT steps, once typed in
    # schema.sql): it runs after schema.sql, and the lesson's query.sql
    # shows the result.
    "sqlinsert": ("flaskide", {"schema.sql": "CREATE TABLE snacks (id INTEGER, name TEXT);\n",
                               "query.sql": "SELECT * FROM snacks;\n"},
                  notes("Add a snack.", "result contains 1 | Popcorn"),
                  "INSERT INTO snacks (id, name) VALUES (1, 'Popcorn');\n",
                  "INSERT INTO snacks (id, name) VALUES (1, 'Nachos');\n", "Popcorn"),
    "php": ("flaskide", P.PHP_STARTER,
            notes("Say hi in PHP.", "GET / contains Hi php"),
            '<?php echo "<p>Hi php</p>"; ?>\n', '<?php echo "<p>nope</p>"; ?>\n', "Hi php"),
}

# The JavaScript unit (the teacher's choice): the first Try It box starts
# with the lesson's starter page (```try-start), and students type the
# JavaScript inside its <script>; the next box carries it on.
JS_START = """# Select and change

```try-start
<link rel="stylesheet" href="style.css">
<h1>Arcade Night</h1>
<p class="game">Tetris</p>
<script>
// Day 3A — the starter's own comment

</script>
```

:::pop
Type this inside the `<script>`: `document.querySelector(".game").textContent = "Pac-Man";`
:::

```tests try
.game contains Pac-Man
```

---

# Step 2

```tests try
.game contains Pac-Man
has h1
```
"""

print("Never graded, in every grammar")
for name, parse in (("web", autograde_web.parse), ("flask", autograde_flask.parse)):
    md = KINDS[name][2] + "\n```tests\n" + ("has p" if name == "web" else "GET / -> 200") + "\n```\n"
    got, bad = parse(md)
    check("%s: a ```tests try block is left out of the graded tests" % name,
          [t["label"] for t in got] == [autograde_web.parse("```tests\nhas p\n```\n")[0][0]["label"]
                                        if name == "web" else autograde_flask.parse("```tests\nGET / -> 200\n```\n")[0][0]["label"]]
          and not bad, (got, bad))

chrome = find_chrome()
if not chrome or not shutil.which("node"):
    print("Chrome and node are needed.")
    sys.exit(1)

db = P.SessionLocal()
t = accounts.User(google_sub="t", email="teacher@example.org", name="Teach")
s = accounts.User(google_sub="s", email="kid@example.org", name="Kid Student")
db.add_all([t, s])
db.commit()
tid, sid = t.id, s.id
pages, ids = {}, {}
for name, (ide, starter, md, right, wrong, shows) in KINDS.items():
    files = dict(starter, **{"notes.md": md})
    a = accounts.Assignment(slug="try" + name, app=ide, teacher_id=tid, title="Try " + name, code="",
                            files=json.dumps(files))
    db.add(a)
    db.commit()
    pages[name] = {"page": "/a/" + a.slug, "right": right, "wrong": wrong, "shows": shows}
    ids[name] = a.id
    # The class's live page too (web/live.js, flask/live.js): the same box, checked there.
    if name in ("web", "sql"):
        db.add(accounts.LiveSession(code="try" + name + "l", app=ide, host_id=tid, title="Live " + name,
                                    assignment_id=a.id, version=1, notes=md, filename="index.html" if name == "web" else "query.sql"))
        db.commit()
        pages[name]["live"] = "/live/try" + name + "l"
js = accounts.Assignment(slug="tryjsstart", app="webide", teacher_id=tid, title="JS start", code="",
                         files=json.dumps(dict(P.WEB_STARTER, **{"notes.md": JS_START,
                                                                 "style.css": "/* STYLE-MARK */ h1 { color: gold; }\n"})))
db.add(js)
db.commit()
db.close()

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "kinds": pages, "jsStart": "/a/tryjsstart",
               "student": sign.dumps({"uid": sid})}, f)
run = subprocess.run(["node", os.path.join(HERE, "try_slide_ides_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=900)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("In Chrome")
check("the browser run finished", not r.get("error"), r.get("error", ""))
for name in KINDS:
    k = r.get(name) or {}
    check("%s: the step is a box on the slide with its own Check" % name, k.get("box") is True, k)
    check("  wrong: its check fails (✗)", "✗" in (k.get("wrongMarks") or ""), k.get("wrongMarks"))
    check("  right: every line passes", k.get("rightMarks") and set(k.get("rightMarks")) == {"✓"}, k.get("rightMarks"))
    check("  and what it makes is under the box (%s)" % ("a page" if name != "sql" else "its rows"),
          KINDS[name][5] in (k.get("shown") or ""), (k.get("shown") or "")[:300])

for name in ("web", "sql"):
    lv = (r.get(name) or {}).get("live") or {}
    check("%s, the class's live page: the box checks, and shows what it makes" % name,
          lv.get("rightMarks") and set(lv.get("rightMarks")) == {"✓"} and KINDS[name][5] in (lv.get("shown") or ""), lv)

j = r.get("jsStart") or {}
check("JavaScript Try It: the first box starts with the lesson's page (```try-start), the cursor inside its <script>",
      (j.get("value") or "").startswith('<link rel="stylesheet" href="style.css">\n<h1>Arcade Night</h1>\n<p class="game">Tetris</p>\n<script>\n')
      and j.get("caretLine") == "", j)
check("  the cursor under what the script already has (the starter's comments), not above it",
      (j.get("typed") or "").index("// Day 3A") < (j.get("typed") or "").index("Pac-Man") if "Pac-Man" in (j.get("typed") or "") else False,
      j.get("typed"))
check("  the page block itself isn't drawn on the slide", j.get("startShown") is False, j.get("startShown"))
check("  the JavaScript typed at the cursor passes the step", j.get("marks") == "✓", j.get("marks"))
check("  the box's page brings in the project's style.css (a class from it looks as it should)",
      j.get("styled") is True, j.get("styled"))
check("  and what it logs is listed under it (steps say 'It should log …')", "changed it" in (j.get("console") or ""), j.get("console"))
check("  and the next box starts with that whole page, JavaScript and all",
      "Pac-Man" in (j.get("next") or "") and "<h1>Arcade Night</h1>" in (j.get("next") or ""), j.get("next"))

db = P.SessionLocal()
kept = db.query(accounts.TestResult).filter(accounts.TestResult.assignment_id.in_(list(ids.values()))).count()
db.close()
check("practice: nothing posted for the teacher or the grade", kept == 0, kept)

server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
failed = results.count(False)
print("\n%s (%d checks, %d failed)" % ("ALL PASSED" if not failed else "SOME FAILED", len(results), failed))
sys.exit(1 if failed else 0)
