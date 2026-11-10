"""Questions in the notes answer a real click at once, however slow the server.

Run: python3 tools/test_quiz_browser.py      (needs node and Chrome)

Each question used to stay disabled until the student's earlier answers came
back from /api/quiz/<slug>/mine. On a busy server that was seconds, and every
click a student made in the meantime — on a find-the-bug line, a choice —
did nothing and said nothing (Nov 2026: "kids are clicking and the click
doesn't work"). Here that request is held for two seconds, and a real mouse
click (Chrome's own, not element.click()) must pick a bug line straight away;
then a question the student had already answered must come back locked, with
its result, once the answers arrive.
"""
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "quizb.db")
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


def bug(title):
    return ("```quiz\ntype: bug\n%s Click the line that's wrong.\n~~~python\n"
            "durations = [94, 120, 88, 101, 75]\nfor d in durations:\n    short = []\n"
            "    if d < 90:\n        short.append(d)\nprint(short)\n~~~\nbug: 3\npoints: 2\n```" % title)


# Two bug questions: the student answers the second one before the page
# loads, so it must come back locked once /mine answers.
NOTES = "# Bugs\n\n" + bug("First one.") + "\n\n" + bug("Second one.") + "\n"

print("Questions in a real browser, with a slow server")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher = client(tid)
    made = teacher.post("/api/assignment", json={"title": "Bugs", "code": "print(1)\n",
                                                 "files": {"notes.md": NOTES}})
    slug = made.get_json()["slug"]
    kid = client(sid)
    # The second question's id: the stored key whose prompt says so.
    db = P.SessionLocal()
    second = next(q.qid for q in db.query(accounts.QuizQuestion).all() if "Second one" in (q.prompt or ""))
    db.close()
    said = kid.post("/api/quiz/answer", json={"assignment": slug, "question": second, "response": "3"})
    check("the student answers the second question first, from elsewhere", said.status_code == 200, said.get_json())

    # Hold the student's answers back, as a busy server would.
    mine = P.app.view_functions["quiz_mine"]

    def slow(*a, **kw):
        time.sleep(2.0)
        return mine(*a, **kw)
    P.app.view_functions["quiz_mine"] = slow
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/a/" + slug,
                   "cookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": sid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "quiz_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=180)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {}
    check("the answers request really was slow (the check means something)",
          (r.get("waited") or 0) >= 1.5 and r.get("answersBackWhenClicked") is False, r)
    check("a real click on a bug line picks it before the answers arrive",
          r.get("pickedEarly") == 3, (r, out.stderr[-300:]))
    check("  and the line was clickable, not disabled, while waiting", r.get("disabledEarly") == 0, r)
    check("the question answered before comes back locked with its result",
          r.get("secondLocked") and r.get("secondResult"), r)
    check("  and the pick on the first one survives the answers arriving", r.get("pickedLater") == 3, r)
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
