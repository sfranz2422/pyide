#!/usr/bin/env python3
"""A web project in PyIDE's editor, in a real Chrome (tools/web_browser.mjs).

    python3 tools/test_web_browser.py

WebIDE moved into PyIDE (Nov 2026): an HTML/CSS/JS project opens in the same
editor as a Python one, with WebIDE's preview as its runner
(runners/web.js). The preview is a sandboxed iframe talking to the editor by
postMessage, which node can't do, so here the app runs and Chrome (headless):

  * draws a new web project's page before Run, with its three starter tabs,
    an HTML editor and a CSS one for the stylesheet
  * shows console.log, and an error with the student's file and line
  * makes a new page that is a page, follows a link to it, and comes back
  * follows the typing, and Stop ends a page that never finishes — and the
    typing doesn't start it again
  * opens New tab in WebIDE's player, and Share makes a web link
  * on a student's web assignment: the notes' tests are a card, Check my
    work checks the page, the result is kept for the teacher, and the typing
    saves into the draft as a web project's files

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

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "web.db")
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
NOTES = "# My page\n\n```tests\nhas h1\nhas 3 li\n```\n"
STUDENT_PAGE = "<!doctype html><h1>Mine</h1><!-- typed by the student -->"

print("In a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here — a web project in a browser is not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher = client(tid)
    files = dict(P.WEB_STARTER, **{"notes.md": NOTES})
    made = teacher.post("/api/assignment", json={"ide": "webide", "title": "My page", "files": files})
    check("the teacher hands out a web assignment", made.status_code == 200, made.get_json())
    slug = made.get_json()["slug"]

    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"assignment": "/a/" + slug, "studentPage": STUDENT_PAGE,
                   "studentCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": sid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "web_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=600)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:200])
    check("the browser run reported every check", len(lines) == 21,
          (len(lines), out.stderr.strip()[-300:]))

    db = P.SessionLocal()
    try:
        item = db.query(accounts.Assignment).filter_by(slug=slug).first()
        draft = db.query(accounts.Draft).filter_by(owner_id=sid, assignment_id=item.id).first()
        kept = db.query(accounts.TestResult).filter_by(student_id=sid, assignment_id=item.id).first()
    finally:
        db.close()
    check("the student's draft is a web project", draft is not None and draft.app == "webide",
          draft and draft.app)
    check("  and the typing was saved into its index.html, with `code` empty",
          draft is not None and "typed by the student" in draft.file_map().get("index.html", "")
          and draft.code == "", draft and draft.file_map().get("index.html", "")[:80])
    check("the student's own check is kept for the teacher",
          kept is not None and kept.kind == "self", kept and kept.kind)
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
