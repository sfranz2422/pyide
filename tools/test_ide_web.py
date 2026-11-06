#!/usr/bin/env python3
"""A project's IDE, on the server: WebIDE moving into PyIDE, step 1a.

    python3 tools/test_ide_web.py

WebIDE and FlaskIDE are being folded into this app. The shared tables
already said which IDE each row belongs to (`app`), and share snapshots now
do too (`snippets.ide`). Three things are pinned here:

1. AN IDE WITHOUT A RUNNER IS NOT FOUND. Until the editor page can run one
   (EDITOR_IDES — FlaskIDE's, today), every editor route answers its row as
   if it weren't there. Before this, /p/<slug> opened any app's draft, so an
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

# FlaskIDE's rows share these tables. Until the page has a Flask runner, a
# FlaskIDE draft reached here by its address is not found — it used to open,
# and an HTML project was shown, run and saved as a Python program that way.
flask_draft = add_row(accounts.Draft(slug="flkdraft1", owner_id=STUDENT,
                                     app="flaskide", title="Site", code="",
                                     files=json.dumps({"app.py": "x"})))
flask_item = add_row(accounts.Assignment(slug="flkitem1", app="flaskide",
                                         teacher_id=TEACHER, title="Routes",
                                         code="", files=json.dumps({"app.py": "x"})))
flask_snip = add_row(P.Snippet(slug="flksnip1", title="Site", author="A", code="",
                               files=json.dumps({"app.py": "x"}), ide="flaskide"))
flask_demo = add_row(P.Snippet(slug="flkdemo1", title="Site", author="A", code="",
                               files=json.dumps({"app.py": "x"}), ide="flaskide", hidden=1))

check("/p/<flask draft> is 404", student.get("/p/flkdraft1").status_code == 404)
check("saving a flask draft is 404",
      student.post("/api/draft/flkdraft1",
                   json={"code": "print('python now')"}).status_code == 404)
check("... and it is untouched", row(accounts.Draft, slug="flkdraft1").code == "")
check("deleting a flask draft is 404",
      student.delete("/api/draft/flkdraft1").status_code == 404)
check("turning in a flask draft is 404",
      student.post("/api/submit", json={"draft": "flkdraft1"}).status_code == 404)
check("/a/<flask assignment> is 404", student.get("/a/flkitem1").status_code == 404)
check("its teacher's editor is 404",
      teacher.get("/teacher/flkitem1/edit").status_code == 404)
check("/s, /fork, /raw of a flask snapshot are 404",
      all(student.get(u).status_code == 404
          for u in ("/s/flksnip1", "/s/flksnip1/fork", "/s/flksnip1/raw")))
check("/d and its source of a flask demo are 404",
      all(student.get(u).status_code == 404
          for u in ("/d/flkdemo1", "/d/flkdemo1/source")))
check("/new?ide=flaskide is 404", student.get("/new?ide=flaskide").status_code == 404)
check("a new flask draft is refused",
      student.post("/api/draft", json={"ide": "flaskide", "files": {"app.py": "x"}}).status_code == 400)
check("a flask share is refused",
      student.post("/api/share", json={"ide": "flaskide", "author": "A",
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
check("a teacher has no Go live on a web project yet (the live page can't show one)",
      'id="go-live"' not in teacher.get("/new?ide=webide").get_data(as_text=True)
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
check("  but not for a FlaskIDE one (no runner, so no assignment)",
      other.post("/api/tests/self", json={"assignment": "flkitem1", "results": []}).status_code == 404)


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
