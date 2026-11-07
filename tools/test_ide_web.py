#!/usr/bin/env python3
"""A project's IDE, on the server: WebIDE moving into PyIDE, step 1a.

    python3 tools/test_ide_web.py

WebIDE and FlaskIDE are being folded into this app. The shared tables
already said which IDE each row belongs to (`app`), and share snapshots now
do too (`snippets.ide`). Three things are pinned here:

1. AN IDE WITHOUT A RUNNER IS NOT FOUND. Until the editor page can run one
   (EDITOR_IDES — GameIDE's, which shares the tables), every editor route
   answers its row as if it weren't there. Before this, /p/<slug> opened any app's draft, so an
   HTML project reached by its address was shown, run and saved as Python.

2. EVERY DOOR KNOWS THE IDE. A web draft, share, assignment, turn-in and
   automatic turn-in each carry it, and the page is told it — and is the
   web page: WebIDE's preview and scripts, and none of Python's. Web projects keep WebIDE's rules: an index.html,
   everything in files, `code` always "", and its small limits — while a
   Python project's limits and answers stay exactly what they were.

3. THE TESTS GRAMMAR FOLLOWS THE IDE. A web assignment's ```tests are read
   with WebIDE's grammar; read with Python's, every line is unreadable and the
   assignment silently has no points.

And the column: a database from before `snippets.ide` gets it on boot, and
every old snapshot reads as Python.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

DB = os.path.join(tempfile.mkdtemp(), "ide.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-62s %s" % ("ok" if condition else "FAIL", label, detail))


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


def row(model, **by):
    db = P.SessionLocal()
    try:
        return db.query(model).filter_by(**by).first()
    finally:
        db.close()


def add_row(obj):
    db = P.SessionLocal()
    try:
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj
    finally:
        db.close()


def page_ide(html):
    """The IDE the editor page was told, from window.PYIDE."""
    m = re.search(r'\bide: "([a-z]+)"', html)
    return m.group(1) if m else None


TEACHER = add_user("t1", "teacher@example.org", "Mr Franz")
STUDENT = add_user("s1", "kid@example.org", "A Student")
OTHER = add_user("s2", "kid2@example.org", "B Student")
teacher, student, other = client(TEACHER), client(STUDENT), client(OTHER)

PAGE = "<!doctype html><h1>Hi</h1><ul><li>a</li><li>b</li><li>c</li></ul>"
WEB = {"index.html": PAGE, "style.css": "h1 { color: red; }"}
NOTES = "# Lists\n\n```tests\nhas 3 li\nh1 contains Hi (2 points)\n```\n"


# --------------------------------------------------------------------------
print("\nA Python project is exactly what it was")

r = student.post("/api/share", json={"code": "print(1)", "author": "A",
                                     "files": {"data.txt": "x"}})
check("a share without `ide` is made", r.status_code == 200, r.status_code)
snip = row(P.Snippet, slug=r.get_json()["slug"])
check("... and is a Python snapshot", snip.ide == "pyide", snip.ide)
html = student.get("/s/%s" % snip.slug).get_data(as_text=True)
check("its page is told it is Python", page_ide(html) == "pyide", page_ide(html))
check("its raw text is main.py",
      student.get("/s/%s/raw" % snip.slug).get_data(as_text=True) == "print(1)")
check("/new is told Python", page_ide(student.get("/new").get_data(as_text=True)) == "pyide")

big = "x" * 3_000_000                    # a book: fine in Python
r = student.post("/api/draft", json={"code": "print(1)", "files": {"book.txt": big}})
check("Python still takes a 3 MB data file", r.status_code == 200, r.status_code)
py_draft = r.get_json()["slug"]
check("... in a Python draft", row(accounts.Draft, slug=py_draft).app == "pyide")
r = student.post("/api/draft", json={"code": "", "files": {}})
check("Python's empty program keeps its words",
      r.get_json().get("error") == "There's nothing to save yet.", r.get_json())
r = student.post("/api/draft", json={"code": "x", "files": {"main.py": "y"}})
check("Python still refuses main.py as a file",
      r.status_code == 400 and "main.py" in r.get_json()["error"])
r = student.post("/api/draft/%s" % py_draft, json={"code": "", "files": {}})
check("Python autosave of an emptied program still saves", r.status_code == 200,
      r.get_json())


# --------------------------------------------------------------------------
print("\nAn IDE the editor has no runner for is not found (EDITOR_IDES = %r)" % (P.EDITOR_IDES,))

# GameIDE's rows share these tables, and this editor has no runner for a
# GameIDE project: one reached here by its address is not found — it used to open,
# and an HTML project was shown, run and saved as a Python program that way.
flask_draft = add_row(accounts.Draft(slug="gmedraft1", owner_id=STUDENT,
                                     app="gameide", title="Site", code="",
                                     files=json.dumps({"app.py": "x"})))
flask_item = add_row(accounts.Assignment(slug="gmeitem1", app="gameide",
                                         teacher_id=TEACHER, title="Routes",
                                         code="", files=json.dumps({"app.py": "x"})))
flask_snip = add_row(P.Snippet(slug="gmesnip1", title="Site", author="A", code="",
                               files=json.dumps({"app.py": "x"}), ide="gameide"))
flask_demo = add_row(P.Snippet(slug="gmedemo1", title="Site", author="A", code="",
                               files=json.dumps({"app.py": "x"}), ide="gameide", hidden=1))

check("/p/<GameIDE draft> is 404", student.get("/p/gmedraft1").status_code == 404)
check("saving a GameIDE draft is 404",
      student.post("/api/draft/gmedraft1",
                   json={"code": "print('python now')"}).status_code == 404)
check("... and it is untouched", row(accounts.Draft, slug="gmedraft1").code == "")
check("deleting a GameIDE draft is 404",
      student.delete("/api/draft/gmedraft1").status_code == 404)
check("turning in a GameIDE draft is 404",
      student.post("/api/submit", json={"draft": "gmedraft1"}).status_code == 404)
check("/a/<GameIDE assignment> is 404", student.get("/a/gmeitem1").status_code == 404)
check("its teacher's editor is 404",
      teacher.get("/teacher/gmeitem1/edit").status_code == 404)
check("/s, /fork, /raw of a GameIDE snapshot are 404",
      all(student.get(u).status_code == 404
          for u in ("/s/gmesnip1", "/s/gmesnip1/fork", "/s/gmesnip1/raw")))
check("/d and its source of a GameIDE demo are 404",
      all(student.get(u).status_code == 404
          for u in ("/d/gmedemo1", "/d/gmedemo1/source")))
check("/new?ide=gameide is 404", student.get("/new?ide=gameide").status_code == 404)
check("a new GameIDE draft is refused",
      student.post("/api/draft", json={"ide": "gameide", "files": {"app.py": "x"}}).status_code == 400)
check("a GameIDE share is refused",
      student.post("/api/share", json={"ide": "gameide", "author": "A",
                                       "files": {"app.py": "x"}}).status_code == 400)
check("an IDE nobody has heard of is refused",
      student.post("/api/draft", json={"ide": "cobol", "code": "x"}).status_code == 400)

# A WebIDE draft from before the move, as WebIDE stored it.
web_draft = add_row(accounts.Draft(slug="webdraft1", owner_id=STUDENT,
                                   app="webide", title="Site", code="",
                                   files=json.dumps(WEB)))


print("\nA web project: every door carries the IDE")

check("the editor has a web runner", "webide" in P.EDITOR_IDES, P.EDITOR_IDES)

html = student.get("/new?ide=webide").get_data(as_text=True)
check("/new?ide=webide is told webide", page_ide(html) == "webide", page_ide(html))
html = student.get("/p/webdraft1").get_data(as_text=True)
check("an existing WebIDE draft opens as web", page_ide(html) == "webide",
      page_ide(html))

r = student.post("/api/draft", json={"ide": "webide", "code": "stray",
                                     "files": WEB})
check("a new web draft is made", r.status_code == 200, r.get_json())
d = row(accounts.Draft, slug=r.get_json()["slug"])
check("... app is webide", d.app == "webide", d.app)
check("... and `code` is \"\" whatever was sent", d.code == "", repr(d.code))

r = student.post("/api/draft", json={"ide": "webide", "files": {"style.css": "x"}})
check("a web project needs its index.html",
      r.status_code == 400 and "index.html" in r.get_json()["error"], r.get_json())
r = student.post("/api/draft", json={"ide": "webide",
                                     "files": dict(WEB, **{"big.txt": "x" * 200_001})})
check("a web file over 200 KB is refused (Python's 4 MB is not theirs)",
      r.status_code == 400 and "too large" in r.get_json()["error"], r.get_json())
r = student.post("/api/draft/webdraft1",
                 json={"files": dict(WEB, **{"big.txt": "x" * 200_001})})
check("... on an autosave too, by the draft's own IDE", r.status_code == 400,
      r.status_code)
many = {"index.html": PAGE}
many.update({"p%d.html" % i: "x" for i in range(15)})
check("a web project may have 16 files",
      student.post("/api/draft", json={"ide": "webide", "files": many}).status_code == 200)
many["p15.html"] = "x"
check("... and not 17",
      student.post("/api/draft", json={"ide": "webide", "files": many}).status_code == 400)
check("a web project may have a main.py like any other file",
      student.post("/api/draft", json={"ide": "webide", "files": dict(
          WEB, **{"main.py": "x"})}).status_code == 200)
check("a web page with folders in a name is still refused",
      student.post("/api/draft", json={"ide": "webide", "files": dict(
          WEB, **{"css/a.css": "x"})}).status_code == 400)

r = student.post("/api/share", json={"ide": "webide", "author": "A", "files": WEB})
check("a web share is made", r.status_code == 200, r.get_json())
slug = r.get_json()["slug"]
check("... as a web snapshot", row(P.Snippet, slug=slug).ide == "webide")
check("its page is told webide",
      page_ide(student.get("/s/%s" % slug).get_data(as_text=True)) == "webide")
check("its fork is told webide",
      page_ide(student.get("/s/%s/fork" % slug).get_data(as_text=True)) == "webide")
check("its raw text is the page, not the empty `code`",
      student.get("/s/%s/raw" % slug).get_data(as_text=True) == PAGE)
r = student.post("/api/share", json={"ide": "webide", "author": "A", "files": {}})
check("an empty web share is refused", r.status_code == 400, r.status_code)


# --------------------------------------------------------------------------
print("\nThe page is the IDE's own")

def scripts(html):
    return re.findall(r"<script src=\"([^\"]+)\"", html)

web_page = student.get("/new?ide=webide").get_data(as_text=True)
py_page = student.get("/new").get_data(as_text=True)
ws, ps = scripts(web_page), scripts(py_page)
check("a web project loads the web runner, not Python's",
      "/static/runners/web.js" in ws and "/static/runners/python.js" not in ws, ws[-3:])
check("  and WebIDE's runner, tests and completion",
      all(x in ws for x in ("/static/web/runner.js", "/static/web/autograde.js",
                            "/static/web/complete.js")))
check("  and no Pyodide, game, world or Pi",
      not [x for x in ws if "pyodide" in x or x.endswith(("/runtime.js", "/game.js",
                                                          "/world.js", "/pi.js", "/autograde.js"))
           and "/web/" not in x])
check("  and the HTML modes and closing tags",
      any("htmlmixed" in x for x in ws) and any("closetag" in x for x in ws)
      and not any("mode/python" in x for x in ws))
check("  each runner before the shell that attaches it",
      ws.index("/static/runners/web.js") < ws.index("/static/app.js")
      and ps.index("/static/runners/python.js") < ps.index("/static/app.js"))
check("its right pane is the preview and its console",
      'id="preview" title="Page preview"' in web_page and 'sandbox="allow-scripts allow-forms"' in web_page
      and 'id="output-view"' in web_page and 'id="stage"' not in web_page)
check("its body says which IDE, for the styles", '<body class="ide-webide' in web_page)
check("a new web project starts from WebIDE's three files, index.html in the editor",
      "&lt;h1&gt;Hello!&lt;/h1&gt;" in web_page.split('<textarea id="editor">')[1].split("</textarea>")[0]
      and '"style.css"' in web_page and '"script.js"' in web_page)
check("a teacher can Go live from a web project, as from a Python one",
      'id="go-live"' in teacher.get("/new?ide=webide").get_data(as_text=True)
      and 'id="go-live"' in teacher.get("/new").get_data(as_text=True))
check("the Python page is as it was: its runner, Pyodide, the stage, the sprites",
      "/static/runners/python.js" in ps and any("pyodide" in x for x in ps)
      and 'id="stage"' in py_page and 'id="sprites"' in py_page
      and "/static/runners/web.js" not in ps and "/static/web/runner.js" not in ps
      and '<body class="ide-pyide' in py_page)
check("  with main.py's starter in the editor",
      "What is your name?" in py_page.split('<textarea id="editor">')[1].split("</textarea>")[0])

# The page's own script: work rescued from a web project is kept under the
# IDE's name, so it can never be put back into a Python one (rescue.js).
_app_js = open(os.path.join(PYIDE, "static", "app.js")).read()
check("the rescue is kept per IDE", 'app: window.PYIDE.ide || "pyide",' in _app_js)

# Every web rule in the stylesheet is under .ide-webide: the names are
# ordinary ones (#preview is also the avatar page's; #output is Python's
# console, which the web console's sizes would squash).
_css = open(os.path.join(PYIDE, "static", "style.css")).read()
_web = _css[_css.index("/* ---------------------------------------------------------- web projects */"):]
_web = _web[:_web.index("/* ----", 10)]
_sels = [sel.strip() for block in re.findall(r"([^{}]+)\{", re.sub(r"/\*.*?\*/", "", _web, flags=re.S))
         for sel in block.split(",")]
check("every web style is for a web page only",
      _sels and all(".ide-webide" in sel for sel in _sels),
      [sel for sel in _sels if ".ide-webide" not in sel])

r = student.post("/api/share", json={"ide": "webide", "author": "A", "files": WEB, "hidden": True})
demo = r.get_json()["slug"]
check("a web demo link opens WebIDE's player",
      "/static/web/demo.js" in student.get("/d/%s" % demo).get_data(as_text=True))
check("  which fetches the files",
      student.get("/d/%s/source" % demo).get_json().get("files", {}).get("index.html") == PAGE)
check("a web New tab is WebIDE's player",
      "/static/web/demo.js" in student.get("/play?ide=webide").get_data(as_text=True))
check("a Python New tab and demo are Python's",
      "/static/demo.js" in student.get("/play").get_data(as_text=True)
      and "/static/web/demo.js" not in student.get("/play").get_data(as_text=True))

r = teacher.post("/api/assignment", json={"ide": "webide", "title": "Lists",
                                          "files": dict(WEB, **{"notes.md": NOTES})})
check("a web assignment is published", r.status_code == 200, r.get_json())
item = row(accounts.Assignment, slug=r.get_json()["slug"])
check("... app is webide", item.app == "webide", item.app)
html = teacher.get("/teacher/%s/edit" % item.slug).get_data(as_text=True)
check("its teacher's editor is told webide", page_ide(html) == "webide")
r = teacher.post("/api/assignment/%s" % item.slug,
                 json={"title": "Lists", "files": {"style.css": "x"}})
check("updating it keeps web rules (needs index.html)",
      r.status_code == 400 and "index.html" in r.get_json()["error"], r.get_json())

html = other.get("/a/%s" % item.slug, follow_redirects=True).get_data(as_text=True)
check("a student opening it gets a web editor", page_ide(html) == "webide",
      page_ide(html))
sd = row(accounts.Draft, owner_id=OTHER, assignment_id=item.id)
check("... and a web draft", sd is not None and sd.app == "webide",
      sd and sd.app)
html = client().get("/a/%s" % item.slug).get_data(as_text=True)
check("signed out, the copy is told webide too", page_ide(html) == "webide")

work = dict(WEB, **{"index.html": PAGE + "<p>mine</p>"})
r = other.post("/api/draft/%s" % sd.slug, json={"files": work, "turn_in": True})
check("an autosave that turns in works", r.status_code == 200, r.get_json())
sub = row(accounts.Submission, assignment_id=item.id, student_id=OTHER)
snap = row(P.Snippet, slug=sub.snippet_slug)
check("... and its snapshot is a web one", snap is not None and snap.ide == "webide",
      snap and snap.ide)
r = other.post("/api/submit", json={"draft": sd.slug, "files": work})
check("Turn in works", r.status_code == 200, r.get_json())
sub = row(accounts.Submission, assignment_id=item.id, student_id=OTHER)
snap = row(P.Snippet, slug=sub.snippet_slug)
check("... and its snapshot is a web one", snap.ide == "webide", snap.ide)
check("... with the page in it", snap.file_map().get("index.html", "").endswith("mine</p>"))
r = other.post("/api/submit", json={"draft": sd.slug, "files": {"a.css": "x"}})
check("Turn in without an index.html is refused",
      r.status_code == 400 and "index.html" in r.get_json()["error"], r.get_json())


r = other.post("/api/tests/self", json={"assignment": item.slug,
                                        "results": [{"label": "Has at least 3 li", "ok": True, "points": 1}]})
check("a student's Check my work on a web assignment is kept", r.status_code == 200, r.get_json())
_kept = row(accounts.TestResult, student_id=OTHER, assignment_id=item.id)
check("  as their own check, for the teacher", _kept is not None and _kept.kind == "self",
      _kept and _kept.kind)
check("  but not for a GameIDE one (no runner, so no assignment)",
      other.post("/api/tests/self", json={"assignment": "gmeitem1", "results": []}).status_code == 404)


# --------------------------------------------------------------------------
print("\nA FlaskIDE project: a Flask app, a SQL project or a PHP site")

check("the editor has a Flask runner", "flaskide" in P.EDITOR_IDES, P.EDITOR_IDES)
fl_page = student.get("/new?ide=flaskide").get_data(as_text=True)
fs = scripts(fl_page)
check("a Flask project loads the Flask runner and FlaskIDE's runtimes",
      "/static/runners/flask.js" in fs and all(x in fs for x in (
          "/static/flask/flask.js", "/static/flask/php.js", "/static/flask/preview.js",
          "/static/flask/syntax.js", "/static/flask/complete.js", "/static/flask/autograde.js"))
      and "/static/runners/python.js" not in fs and "/static/runtime.js" not in fs, fs[-6:])
check("  with pack.js first, before anything that could keep a plain fetch",
      fs and fs[0] == "/static/flask/pack.js" and fl_page.index("flask/pack.js") < fl_page.index("</head>"), fs[:2])
check("  and only there: a Python or web page sends as it always has",
      "pack.js" not in py_page and "pack.js" not in web_page)
check("  the PHP and SQL modes", any("mode/php" in x for x in fs) and any("mode/sql" in x for x in fs))
check("  its preview has an address bar and a place for SQL results",
      'id="preview-path"' in fl_page and 'id="sql-results"' in fl_page and '<body class="ide-flaskide' in fl_page)
check("  and Go live for the teacher",
      'id="go-live"' in teacher.get("/new?ide=flaskide").get_data(as_text=True))

def editor_text(html):
    return html.split('<textarea id="editor">')[1].split("</textarea>")[0]

check("a new Flask app opens on app.py, its templates beside it",
      "from flask import" in editor_text(fl_page) and '"templates/base.html"' in fl_page)
sql_page = student.get("/new?ide=flaskide&kind=sql").get_data(as_text=True)
check("kind=sql is a SQL project, open on query.sql",
      '"query.sql"' in sql_page and '"schema.sql"' in sql_page and '"app.py"' not in sql_page
      and editor_text(sql_page).lstrip().startswith("--"))
php_page = student.get("/new?ide=flaskide&kind=php").get_data(as_text=True)
check("kind=php is a PHP site, open on index.php",
      '"includes/header.php"' in php_page and editor_text(php_page).startswith("&lt;?php"))

FLASK = dict(P.FLASK_STARTER)
r = student.post("/api/draft", json={"ide": "flaskide", "files": FLASK})
check("a Flask draft is saved, folders and all", r.status_code == 200, r.get_json())
fd = row(accounts.Draft, slug=r.get_json()["slug"])
check("  as a FlaskIDE project, `code` empty", fd.app == "flaskide" and fd.code == ""
      and "templates/index.html" in fd.file_map())
r = student.post("/api/draft", json={"ide": "flaskide", "files": dict(FLASK, **{"pages/x.html": "x"})})
check("a folder Flask doesn't look in is refused, naming the ones it does",
      r.status_code == 400 and "templates or static or includes" in r.get_json()["error"], r.get_json())
r = student.post("/api/draft", json={"ide": "flaskide", "files": dict(FLASK, **{"templates\\x.html": "x"})})
check("a backslash gets a sentence about forward slashes",
      r.status_code == 400 and "forward slash" in r.get_json()["error"], r.get_json())
r = student.post("/api/draft", json={"ide": "flaskide", "files": {"templates/x.html": "x"}})
check("a project with nothing to run is refused, naming all three entries",
      r.status_code == 400 and all(e in r.get_json()["error"] for e in ("app.py", "query.sql", "index.php")))
many = dict(FLASK)
many.update({"static/f%d.css" % i: "x" for i in range(40 - len(FLASK))})
check("a Flask project may have 40 files (Web 2's Game Vault has 22)",
      student.post("/api/draft", json={"ide": "flaskide", "files": many}).status_code == 200)
many["static/one-more.css"] = "x"
check("  and not 41", student.post("/api/draft", json={"ide": "flaskide", "files": many}).status_code == 400)
check("a web project still may not have folders",
      student.post("/api/draft", json={"ide": "webide", "files": dict(WEB, **{"templates/a.html": "x"})}).status_code == 400)

# Encoded, as pack.js sends it: a body Render's firewall would read as an
# attack goes as base64 and the server reads it as if it were plain.
import base64                                               # noqa: E402
packed = {"_packed": base64.b64encode(json.dumps(
    {"files": dict(FLASK, **{"app.py": FLASK["app.py"] + "\n# <script>packed</script>\n"})}).encode()).decode()}
r = student.post("/api/draft/%s" % fd.slug, json=packed)
check("an encoded autosave is read as a plain one", r.status_code == 200, r.get_json())
check("  and saved", "<script>packed</script>" in row(accounts.Draft, slug=fd.slug).file_map()["app.py"])
r = student.post("/api/draft/%s" % fd.slug, json={"_packed": "not base64!"})
check("  and one that can't be read is refused, not saved as nothing", r.status_code == 400)
check("a plain save still works on the same draft",
      student.post("/api/draft/%s" % fd.slug, json={"files": FLASK}).status_code == 200)

r = student.post("/api/share", json={"ide": "flaskide", "author": "A", "files": P.SQL_STARTER})
sq = r.get_json()["slug"]
check("a SQL project's raw text is its query.sql",
      student.get("/s/%s/raw" % sq).get_data(as_text=True) == P.SQL_STARTER["query.sql"])
r = student.post("/api/share", json={"ide": "flaskide", "author": "A", "files": FLASK, "hidden": True})
fdemo = r.get_json()["slug"]
fd_page = student.get("/d/%s" % fdemo).get_data(as_text=True)
check("a Flask hide-code link plays in the app's own player, from its source",
      "/static/flask/play.js" in fd_page and "/d/%s/source" % fdemo in fd_page)
check("  which sends the files", student.get("/d/%s/source" % fdemo).get_json()["files"] == FLASK)
check("the console's handle names the pane it sizes, and split.js honours that",
      'data-split="editor-console" data-size="next" data-pane="output"' in open(os.path.join(PYIDE, "templates", "index.html")).read()
      and "if (handle.dataset.pane) return document.getElementById(handle.dataset.pane);"
      in open(os.path.join(PYIDE, "static", "split.js")).read())
check("a Flask New tab is the app's own player",
      "/static/flask/play.js" in student.get("/play?ide=flaskide").get_data(as_text=True))

r = teacher.post("/api/assignment", json={"ide": "flaskide", "title": "Routes",
                                          "files": dict(FLASK, **{"notes.md": "```tests\nGET / -> 200\nGET /about -> 200 (2 points)\n```\n"})})
fitem = row(accounts.Assignment, slug=r.get_json()["slug"])
check("a Flask assignment's tests are read as Flask tests",
      fitem.app == "flaskide" and P._grader(fitem).possible(fitem.file_map()) == 3,
      P._grader(fitem).possible(fitem.file_map()))
html = other.get("/a/%s" % fitem.slug, follow_redirects=True).get_data(as_text=True)
check("a student opening it gets a Flask editor, open on app.py",
      page_ide(html) == "flaskide" and "from flask import" in editor_text(html))




# --------------------------------------------------------------------------
print("\nTeaching a web or Flask lesson live")

def live_row(code):
    return row(accounts.LiveSession, code=code)

r = teacher.post("/api/live/start", json={"ide": "webide", "body": PAGE, "filename": "index.html",
                                          "title": "Lists", "assignment": item.slug})
check("Go live on a web assignment starts a web lesson", r.status_code == 200, r.get_json())
wcode = r.get_json()["code"]
check("  its IDE is the assignment's", live_row(wcode).app == "webide", live_row(wcode).app)
lp = other.get("/live/%s" % wcode).get_data(as_text=True)
check("the class gets WebIDE's live page", "/static/web/live.js" in lp and "ide-webide" in lp
      and "/static/live.js" not in lp)
check("  the student's editor starting on their draft's index.html, its other files as tabs",
      # the page's config: the entry as `starter`, the rest as starterFiles
      re.search(r'starter: "[^"]*mine\\u003c/p\\u003e', lp) is not None
      and re.search(r'starterFiles: \{[^\n]*"style.css"', lp) is not None
      and not re.search(r'starterFiles: \{[^\n]*"index.html"', lp))
r = teacher.post("/api/live/%s/push" % wcode, json={"body": PAGE, "filename": "index.html",
                                                     "page": "<html>THE PAGE</html>", "seq": 5})
check("the teacher's page goes out with a push", r.status_code == 200, r.get_json())
poll = other.get("/api/live/%s?v=-1" % wcode).get_json()
check("  and comes back on a poll, with its id", poll.get("page") == "<html>THE PAGE</html>"
      and poll.get("page_id"), poll.get("page_id"))
again = other.get("/api/live/%s?v=-1&pg=%s" % (wcode, poll["page_id"])).get_json()
check("  but not to a page that already shows it", "page" not in again and again.get("page_id") == poll["page_id"])
teacher.post("/api/live/%s/push" % wcode, json={"body": PAGE, "filename": "index.html",
                                                 "page": "x" * (P.LIVE_PAGE_BYTES + 1), "seq": 6})
check("a page too big to send is dropped, and the code still goes",
      live_row(wcode).page == "" and live_row(wcode).version == 6)

r = other.post("/api/live/%s/keep" % wcode, json={"code": "<h1>kept live</h1>", "files": {"style.css": "p{}"}})
check("a student's Save from a web lesson is kept", r.status_code == 200, r.get_json())
kd = row(accounts.Draft, slug=r.get_json()["slug"])
check("  into their web draft: index.html among the files, `code` empty",
      kd.app == "webide" and kd.code == "" and kd.file_map().get("index.html") == "<h1>kept live</h1>"
      and kd.file_map().get("style.css") == "p{}", (kd.app, kd.code, sorted(kd.file_map())))
r = other.post("/api/live/%s/keep" % wcode, json={"code": "<h1>again</h1>"})
check("  and a Save with no other files keeps the ones it had",
      r.status_code == 200 and row(accounts.Draft, slug=kd.slug).file_map().get("style.css") == "p{}"
      and row(accounts.Draft, slug=kd.slug).file_map().get("index.html") == "<h1>again</h1>")

# A Python lesson with no assignment first, then a SQL project's Go live, also
# with none: the same (no) assignment, so only the change of IDE ends it.
r = teacher.post("/api/live/start", json={"body": "print(0)", "filename": "main.py", "assignment": ""})
p0 = r.get_json()["code"]
check("(a Python lesson, no assignment, on the air)", live_row(p0).app == "pyide" and not live_row(p0).ended)
r = teacher.post("/api/live/start", json={"ide": "flaskide", "body": "SELECT 1;", "filename": "query.sql",
                                          "title": "Queries", "assignment": ""})
check("Go live from a SQL project starts a Flask lesson, ending the Python one",
      r.status_code == 200 and live_row(r.get_json()["code"]).app == "flaskide"
      and live_row(p0).ended == 1 and r.get_json()["code"] != p0, r.get_json())
fcode = r.get_json()["code"]
lp = student.get("/live/%s" % fcode).get_data(as_text=True)
check("the class gets FlaskIDE's live page, opening their editor on query.sql",
      "/static/flask/live.js" in lp and "ide-flaskide" in lp
      and re.search(r'\bentry: "query.sql"', lp) is not None)
r = student.post("/api/live/%s/keep" % fcode, json={"code": "SELECT 2;", "entry": "query.sql"})
check("a student's Save from it makes a SQL project", r.status_code == 200
      and row(accounts.Draft, slug=r.get_json()["slug"]).file_map() == {"query.sql": "SELECT 2;"}
      and row(accounts.Draft, slug=r.get_json()["slug"]).app == "flaskide", r.get_json())
teacher.post("/api/live/%s/push" % fcode, json={"body": "SELECT 1;", "filename": "query.sql",
                                                 "page": '{"sql": true, "html": "<table></table>"}', "seq": 9})
check("a Flask lesson's page (FlaskIDE's {sql, html}) goes out too",
      student.get("/api/live/%s?v=-1" % fcode).get_json().get("page") == '{"sql": true, "html": "<table></table>"}')

r = teacher.post("/api/live/start", json={"body": "print(1)", "filename": "main.py", "assignment": ""})
pcode = r.get_json()["code"]
check("Go live from Python is a Python lesson, on the Python page",
      live_row(pcode).app == "pyide" and "/static/live.js" in student.get("/live/%s" % pcode).get_data(as_text=True))
teacher.post("/api/live/%s/push" % pcode, json={"body": "print(1)", "filename": "main.py",
                                                 "page": "<html>no</html>", "seq": 3})
check("  where a page sent anyway is ignored", live_row(pcode).page == "")

check("the Go live chooser lists the editor's own kind of assignment",
      [a["slug"] for a in teacher.get("/api/live/assignments?ide=webide").get_json()["assignments"]] == [item.slug]
      and item.slug not in [a["slug"] for a in teacher.get("/api/live/assignments").get_json()["assignments"]])
r = teacher.post("/api/live/start", json={"ide": "pyide", "body": "", "filename": "main.py", "assignment": item.slug})
check("a Python editor can't teach a web assignment live", r.status_code == 400, r.get_json())
loc = teacher.get("/teacher/%s/live" % fitem.slug).headers.get("Location", "")
check("teaching a Flask assignment from the dashboard opens the Flask editor",
      "ide=flaskide" in loc and "teach=" in loc, loc)




# --------------------------------------------------------------------------
print("\nWebIDE's and FlaskIDE's classes are PyIDE's now")

# A class made in WebIDE, before it moved in: its row says "webide".
db = P.SessionLocal()
wclass = accounts.Course(app="webide", teacher_id=TEACHER, name="Web Design 1")
db.add(wclass)
db.commit()
db.add(accounts.Enrollment(class_id=wclass.id, email="kid2@example.org", name="B Student"))
witem = db.query(accounts.Assignment).filter_by(slug=item.slug).first()
P._place(db, wclass, witem)
db.add(accounts.StudentPhoto(slug="wphoto1", user_id=OTHER, status="pending", app="webide",
                             content_type="image/png", data=b"x"))
db.commit()
WCLASS = wclass.id
db.close()

check("a WebIDE class is on the teacher's dashboard", "Web Design 1" in teacher.get("/teacher").get_data(as_text=True))
tpage = teacher.get("/teacher/class/%d" % WCLASS)
check("  its page opens, with its web assignment on it",
      tpage.status_code == 200 and item.slug in tpage.get_data(as_text=True))
# (the dashboard lists assignments in no class; one in a class is on its page)
check("a Flask assignment in no class is on the dashboard",
      fitem.title in teacher.get("/teacher").get_data(as_text=True))
check("  and its own page opens", teacher.get("/teacher/%s" % item.slug).status_code == 200)
check("its student has the class among theirs", "Web Design 1" in other.get("/classes").get_data(as_text=True))
spage = other.get("/class/%d" % WCLASS)
check("  and its page, with the assignment", spage.status_code == 200 and item.slug in spage.get_data(as_text=True))
# A web project of their own, in no assignment: only the draft list has it
# (an assignment shows on My work through its turn-in as well).
other.post("/api/draft", json={"ide": "webide", "title": "My own site", "files": WEB})
check("a web project of their own is in My work", "My own site" in other.get("/my").get_data(as_text=True))
db = P.SessionLocal()
_course = db.query(accounts.Course).filter_by(id=WCLASS).first()
with P.app.test_request_context():
    _waiting = P._pending_photos(db, _course)
db.close()
check("a photo they sent in WebIDE still waits for the teacher here",
      [w["url"].rsplit("/", 1)[-1] for w in _waiting] == ["wphoto1"], _waiting)
r = teacher.post("/api/class/%d/new" % WCLASS, json={"title": "Day 2", "kind": "web"})
check("Add to class in it makes a web assignment",
      r.status_code == 200 and row(accounts.Assignment, slug=r.get_json()["slug"]).app == "webide", r.get_json())
_work = teacher.get("/api/assignment/%s/tests/work" % item.slug).get_json()["work"]
check("Check all is sent a web project's files as they are, with no main.py added",
      _work and "index.html" in _work[0]["files"] and "main.py" not in _work[0]["files"],
      [sorted(w["files"]) for w in _work])
_front = client().get("/").get_data(as_text=True)
check("the front door offers a new project of every kind",
      all(u in _front for u in ('href="/new"', 'href="/new?ide=webide"', 'href="/new?ide=flaskide"',
                                'href="/new?ide=flaskide&amp;kind=sql"', 'href="/new?ide=flaskide&amp;kind=php"')))


# --------------------------------------------------------------------------
print("\nThe tests grammar follows the IDE")

check("a web assignment's tests are read as web tests",
      P._grader(item).possible(item.file_map()) == 3,
      P._grader(item).possible(item.file_map()))
tests, errors = P._grader(item).file_tests(item.file_map())
check("... with no line unreadable", len(tests) == 2 and not errors, errors)
check("(Python's grammar would find none of them)",
      P.autograde.possible(item.file_map()) == 0)
py_item = add_row(accounts.Assignment(
    slug="pyitem1", app="pyide", teacher_id=TEACHER, title="Squares",
    code="print(9)", files=json.dumps({"notes.md": "```tests\nprints 9\n```\n"})))
check("a Python assignment's tests are still Python's",
      P._grader(py_item).possible(py_item.file_map()) == 1)


# --------------------------------------------------------------------------
print("\nA database from before snippets.ide")

OLD = os.path.join(tempfile.mkdtemp(), "old.db")
con = sqlite3.connect(OLD)
con.execute("CREATE TABLE snippets (id INTEGER PRIMARY KEY, slug VARCHAR(16) "
            "UNIQUE NOT NULL, title VARCHAR(120) NOT NULL, author VARCHAR(80) "
            "NOT NULL, code TEXT NOT NULL, files TEXT NOT NULL DEFAULT '{}', "
            "hidden INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL)")
con.execute("INSERT INTO snippets (slug, title, author, code, created_at) "
            "VALUES ('oldone1', 'Old', 'A', 'print(1)', '2025-01-01 00:00:00')")
con.commit()
con.close()
env = dict(os.environ, DATABASE_URL="sqlite:///" + OLD)
out = subprocess.run(
    [sys.executable, "-c",
     "import app as P; db = P.SessionLocal(); "
     "print('IDE=' + db.query(P.Snippet).filter_by(slug='oldone1').one().ide)"],
    cwd=PYIDE, env=env, capture_output=True, text=True)
check("booting adds the column, and an old snapshot is Python",
      "IDE=pyide" in out.stdout, (out.stdout + out.stderr).strip()[-200:])


print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
