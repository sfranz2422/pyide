#!/usr/bin/env python3
"""A project's IDE, on the server: WebIDE moving into PyIDE, step 1a.

    python3 tools/test_ide_web.py

WebIDE and FlaskIDE are being folded into this app. The shared tables
already said which IDE each row belongs to (`app`), and share snapshots now
do too (`snippets.ide`). Three things are pinned here:

1. TODAY, A WEB PROJECT IS NOT FOUND. Until the editor page can run one
   (EDITOR_IDES), every editor route answers a WebIDE row as if it weren't
   there. Before this, /p/<slug> opened any app's draft, so an HTML project
   reached by its address was shown, run and saved as a Python program.

2. ONCE THE PAGE CAN, EVERY DOOR KNOWS THE IDE. With "webide" let in, a
   draft, share, assignment, turn-in and automatic turn-in each carry it, and
   the page is told it. Web projects keep WebIDE's rules: an index.html,
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
print("\nToday a WebIDE row is not found (EDITOR_IDES = %r)" % (P.EDITOR_IDES,))

web_draft = add_row(accounts.Draft(slug="webdraft1", owner_id=STUDENT,
                                   app="webide", title="Site", code="",
                                   files=json.dumps(WEB)))
web_item = add_row(accounts.Assignment(slug="webitem1", app="webide",
                                       teacher_id=TEACHER, title="Lists",
                                       code="", files=json.dumps(
                                           dict(WEB, **{"notes.md": NOTES}))))
web_snip = add_row(P.Snippet(slug="websnip1", title="Site", author="A", code="",
                             files=json.dumps(WEB), ide="webide"))
web_demo = add_row(P.Snippet(slug="webdemo1", title="Site", author="A", code="",
                             files=json.dumps(WEB), ide="webide", hidden=1))

check("/p/<web draft> is 404", student.get("/p/webdraft1").status_code == 404)
check("saving a web draft is 404",
      student.post("/api/draft/webdraft1",
                   json={"code": "print('python now')"}).status_code == 404)
check("... and it is untouched", row(accounts.Draft, slug="webdraft1").code == "")
check("deleting a web draft is 404",
      student.delete("/api/draft/webdraft1").status_code == 404)
check("/a/<web assignment> is 404", student.get("/a/webitem1").status_code == 404)
check("its teacher's editor is 404",
      teacher.get("/teacher/webitem1/edit").status_code == 404)
check("/s, /fork, /raw of a web snapshot are 404",
      all(student.get(u).status_code == 404
          for u in ("/s/websnip1", "/s/websnip1/fork", "/s/websnip1/raw")))
check("/d and its source of a web demo are 404",
      all(student.get(u).status_code == 404
          for u in ("/d/webdemo1", "/d/webdemo1/source")))
check("/new?ide=webide is 404", student.get("/new?ide=webide").status_code == 404)
check("a new web draft is refused",
      student.post("/api/draft", json={"ide": "webide", "files": WEB}).status_code == 400)
check("a web share is refused",
      student.post("/api/share", json={"ide": "webide", "author": "A",
                                       "files": WEB}).status_code == 400)
check("an IDE nobody has heard of is refused",
      student.post("/api/draft", json={"ide": "cobol", "code": "x"}).status_code == 400)


# --------------------------------------------------------------------------
print("\nWith the web runner in place, every door carries the IDE")

P.EDITOR_IDES = ("pyide", "webide")

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
