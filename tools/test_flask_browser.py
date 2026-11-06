#!/usr/bin/env python3
"""A FlaskIDE project in PyIDE's editor, in a real Chrome (tools/flask_browser.mjs).

    python3 tools/test_flask_browser.py

FlaskIDE moved into PyIDE (Nov 2026): a Flask app, a SQL project or a PHP
site opens in the same editor as a Python one, with FlaskIDE's runner
(runners/flask.js, static/flask/). The app runs in Pyodide or in PHP's
WebAssembly worker and its pages come back under an address bar, which node
can't do, so here the app runs and Chrome (headless):

  * opens a Flask app with its templates in folders, runs it, lists its
    routes and shows / — and a path typed in the address bar, and a 404
  * puts a syntax error on a card, makes a template from base.html, and
    refuses a folder Flask doesn't look in
  * opens New tab in the app's own player, and Share goes encoded (pack.js)
  * runs a SQL project into tables, and a PHP site into its pages
  * on a student's Flask assignment: the tests card, Check my work asking
    the app, the result kept for the teacher, and the typing saved — sent
    encoded and read back — into the draft as a Flask project's files

Pyodide, Flask and PHP come from the internet the first time, as for a class.

Needs Chrome and node; says "skip" without Chrome rather than failing.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "flask.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-66s %s" % ("ok" if condition else "FAIL", label, detail))


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


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


# The assignment: the starter has an h1 and no list, so a check finds one
# test passing and one not.
# The starter answers / and has no /about: one test passing, one not.
NOTES = "# My app\n\n```tests\nGET / -> 200\nGET /about -> 200\n```\n"

print("In a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here — a Flask project in a browser is not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher = client(tid)
    files = dict(P.FLASK_STARTER, **{"notes.md": NOTES})
    made = teacher.post("/api/assignment", json={"ide": "flaskide", "title": "My app", "files": files})
    check("the teacher hands out a Flask assignment", made.status_code == 200, made.get_json())
    slug = made.get_json()["slug"]

    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    # A hide-code link: FlaskIDE sent it to a page it didn't have.
    demo = client().post("/api/share", json={"ide": "flaskide", "author": "Kid", "hidden": True,
                                             "title": "Pets", "files": P.FLASK_STARTER}).get_json()["url"]
    with open(setup, "w") as f:
        json.dump({"assignment": "/a/" + slug, "demo": demo[demo.index("/", 8):],
                   "studentCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": sid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "flask_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=1200)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:200])
    check("the browser run reported every check", len(lines) == 23,
          (len(lines), out.stderr.strip()[-300:]))

    db = P.SessionLocal()
    try:
        item = db.query(accounts.Assignment).filter_by(slug=slug).first()
        draft = db.query(accounts.Draft).filter_by(owner_id=sid, assignment_id=item.id).first()
        kept = db.query(accounts.TestResult).filter_by(student_id=sid, assignment_id=item.id).first()
    finally:
        db.close()
    check("the student's draft is a Flask project", draft is not None and draft.app == "flaskide",
          draft and draft.app)
    check("  and the typing was saved into its app.py, with `code` empty",
          draft is not None and "typed by the student" in draft.file_map().get("app.py", "")
          and draft.code == "" and "templates/base.html" in draft.file_map(),
          draft and draft.file_map().get("app.py", "")[-80:])
    check("the student's own check is kept for the teacher",
          kept is not None and kept.kind == "self", kept and kept.kind)
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
