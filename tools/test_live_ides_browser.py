#!/usr/bin/env python3
"""A web lesson and a Flask lesson taught live, from a student's seat, in
a real Chrome (tools/live_ides_browser.mjs).

    python3 tools/test_live_ides_browser.py

WebIDE's and FlaskIDE's live pages moved in with them (live_web.html,
live_flask.html; static/web/live.js, static/flask/live.js), running on
PyIDE's shared modules. Here the teacher goes live on a web assignment and
then a Flask one, pushes their code and their page, and a student's Chrome:

  * sees the teacher's code in the mirror and the teacher's page
  * starts on their own draft (web) or the starter's app.py (Flask)
  * runs their own page, or starts their own app and is shown /
  * presses Turn in (Save, on a lesson with no assignment), and the
    server has it in their draft of that kind

and a teacher's own Chrome goes live from a web project and from a SQL
project after Run, and the class's poll carries the page Run made.

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

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "live.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org, teacher2@example.org, teacher3@example.org"
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
    print("  skip  no Chrome (or no node) here — the live pages in a browser are not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    # Two teachers: one teacher has one lesson on the air at a time, so a
    # web lesson and a Flask lesson both live are two teachers' lessons.
    tid = add_user("t", "teacher@example.org", "Teach")
    tid2 = add_user("t2", "teacher2@example.org", "Other")
    sid = add_user("s", "kid@example.org", "Kid")
    tid3 = add_user("t3", "teacher3@example.org", "Third")   # has no assignments
    teacher, teacher2, student = client(tid), client(tid2), client(sid)
    web = teacher.post("/api/assignment", json={"ide": "webide", "title": "Page", "files": dict(
        P.WEB_STARTER, **{"index.html": "<!doctype html><h1>start</h1>"})}).get_json()["slug"]
    # the student's own draft of it, which their editor should start on
    student.get("/a/" + web)
    db = P.SessionLocal()
    d = db.query(accounts.Draft).filter_by(owner_id=sid).first()
    d.files = json.dumps(dict(d.file_map(), **{"index.html": "<!doctype html><p>mine</p>"}))
    db.commit()
    db.close()
    flask = teacher2.post("/api/assignment", json={"ide": "flaskide", "title": "App",
                                                  "files": P.FLASK_STARTER}).get_json()["slug"]

    def go_live(who, ide, slug, body, filename, page):
        code = who.post("/api/live/start", json={"ide": ide, "assignment": slug, "body": body,
                                                 "filename": filename}).get_json()["code"]
        r = who.post("/api/live/%s/push" % code, json={"body": body, "filename": filename,
                                                       "page": page, "seq": 50})
        check("the teacher goes live on the %s assignment and pushes their page" % ide,
              r.status_code == 200, r.get_json())
        return code

    wcode = go_live(teacher, "webide", web, "<!-- TEACHER CODE -->", "index.html", "<html>THE TEACHER PAGE</html>")
    wdraft_before = None
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    cookie = P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": sid})

    setup = os.path.join(TMP, "setup.json")
    fcode_holder = {}

    def flask_live():
        fcode_holder["code"] = go_live(teacher2, "flaskide", flask, "# TEACHER APP\n" + P.FLASK_STARTER["app.py"],
                                       "app.py", json.dumps({"path": "/", "html": "<p>THE TEACHER APP PAGE</p>"}))

    flask_live()
    with open(setup, "w") as f:
        json.dump({"web": "/live/" + wcode, "flask": "/live/" + fcode_holder["code"],
                   "studentCookie": cookie,
                   "teacherCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid3}),
                   "webTeacherCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "live_ides_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=1200)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:300])
    check("the browser run reported every check", len(lines) == 14,
          (len(lines), out.stderr.strip()[-300:]))

    db = P.SessionLocal()
    try:
        wa = db.query(accounts.Assignment).filter_by(slug=web).first()
        fa = db.query(accounts.Assignment).filter_by(slug=flask).first()
        wd = db.query(accounts.Draft).filter_by(owner_id=sid, assignment_id=wa.id).first()
        fd = db.query(accounts.Draft).filter_by(owner_id=sid, assignment_id=fa.id).first()
    finally:
        db.close()
    check("Save in the web lesson kept their page in their web draft",
          wd is not None and wd.app == "webide" and "STUDENT PAGE" in wd.file_map().get("index.html", "")
          and wd.code == "", wd and wd.file_map().get("index.html", "")[:80])
    check("Save in the Flask lesson kept their app.py in a Flask draft, its templates with it",
          fd is not None and fd.app == "flaskide" and "saved from the lesson" in fd.file_map().get("app.py", "")
          and "templates/base.html" in fd.file_map(), fd and sorted(fd.file_map())[:4])
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
