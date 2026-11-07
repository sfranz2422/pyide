#!/usr/bin/env python3
"""The teacher's Check all on web, Flask and PHP assignments, in a real
Chrome (tools/check_all_ides_browser.mjs).

    python3 tools/test_check_all_ides_browser.py

Check all runs every turned-in project against the notes' tests in the
teacher's browser, and its result is what counts toward the grade. The
assignment page picks the checker by the assignment's IDE: WebIDE's for a
web page, FlaskIDE's for a Flask app, PHP for a PHP site. A student turns
each in; the teacher presses Check all; the verified result is kept, with
the points the tests give.

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

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "checkall.db")
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
    print("  skip  no Chrome (or no node) here — Check all in a browser is not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher, student = client(tid), client(sid)

    def assignment(ide, files, notes, label, expect, turned):
        files = dict(files, **{"notes.md": notes})
        slug = teacher.post("/api/assignment", json={"ide": ide, "title": label, "files": files}).get_json()["slug"]
        student.get("/a/" + slug)
        db = P.SessionLocal()
        try:
            item = db.query(accounts.Assignment).filter_by(slug=slug).first()
            draft = db.query(accounts.Draft).filter_by(owner_id=sid, assignment_id=item.id).first()
            dslug = draft.slug
        finally:
            db.close()
        r = student.post("/api/submit", json={"draft": dslug, "files": turned})
        check("%s: the student turns it in" % label, r.status_code == 200, r.get_json())
        return {"slug": slug, "label": label, "expect": expect}

    web_page = dict(P.WEB_STARTER, **{"index.html": "<!doctype html><h1>Hi</h1><ul><li>a</li></ul>"})
    php_site = dict(P.PHP_STARTER)
    setup = os.path.join(TMP, "setup.json")
    items = [
        assignment("webide", P.WEB_STARTER, "```tests\nhas h1\nhas 3 li\n```\n", "A web page",
                   "Tests 1 / 2", web_page),
        assignment("flaskide", P.FLASK_STARTER, "```tests\nGET / -> 200\nGET /nope -> 200\n```\n",
                   "A Flask app", "Tests 1 / 2", dict(P.FLASK_STARTER)),
        assignment("flaskide", P.PHP_STARTER, "```tests\nGET / -> 200\nGET /nope.php -> 200\n```\n",
                   "A PHP site", "Tests 1 / 2", php_site),
    ]
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    with open(setup, "w") as f:
        json.dump({"assignments": items,
                   "teacherCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "check_all_ides_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=1200)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:300])
    check("the browser run reported every check", len(lines) == 8,
          (len(lines), out.stderr.strip()[-300:]))
    db = P.SessionLocal()
    try:
        kept = db.query(accounts.TestResult).filter_by(student_id=sid, kind="verified").all()
    finally:
        db.close()
    check("each Check all is kept as the verified result that counts, 1 of 2",
          len(kept) == 3 and all((k.earned, k.possible) == (1, 2) for k in kept),
          [(k.earned, k.possible) for k in kept])
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
