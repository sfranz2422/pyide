"""The class, live, in a real browser: two students and their teacher.

Run: python3 tools/test_live_class_browser.py      (needs node and Chrome)

Two students on a live lesson's page predict and pass a step's check
(no I'm stuck / I'm done any more); the teacher's editor, live on the same lesson, shows it — "2 / 2
finished" on the card, the class's first guesses charted under the
prediction — and its pop-out on the projector shows
the same. The whole class having passed the step, the celebration reaches
both students' screens (with +5 XP); the teacher's countdown reaches them
too. tools/test_live_class.py pins the server; this, the pages.
"""
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "liveclassb.db")
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
        u = accounts.User(google_sub=sub, email=email, name=name)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


NOTES = """# Try It

```python predict
print("maple".upper())
```

```tests
crop == "corn"
```

---

## The end
"""

print("The class, live, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    s1 = add_user("s1", "ana@example.org", "Ana Ruiz")
    s2 = add_user("s2", "ben@example.org", "Ben Ode")
    teacher = P.app.test_client()
    with teacher.session_transaction() as s:
        s["uid"] = tid
    slug = teacher.post("/api/assignment", json={"title": "Try", "code": "# Try\n",
                                                 "files": {"notes.md": NOTES}}).get_json()["slug"]
    db = P.SessionLocal()
    item = db.query(accounts.Assignment).filter_by(slug=slug).first()
    course = accounts.Course(teacher_id=tid, name="P4")
    db.add(course)
    db.commit()
    db.add(accounts.ClassItem(class_id=course.id, assignment_id=item.id))
    for uid in (s1, s2):
        db.add(accounts.Visit(class_id=course.id, user_id=uid))
    db.commit()
    db.close()
    code = teacher.post("/api/live/start", json={"assignment": slug, "body": "# Try\n",
                                                  "filename": "main.py"}).get_json()["code"]
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    sign = P.app.session_interface.get_signing_serializer(P.app)
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "live": "/live/" + code, "teach": "/new?teach=%s&a=%s" % (code, slug),
                   "s1": sign.dumps({"uid": s1}), "s2": sign.dumps({"uid": s2}),
                   "teacher": sign.dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "live_class_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    check("a student's page has no I'm stuck / I'm done (the teacher had them taken off)", r.get("handButtons") == 0, r.get("handButtons"))
    check("  and no countdown before the teacher starts one", r.get("timerBefore") is True, r.get("timerBefore"))
    check("passing the step tells the first student they were first",
          "first" in (r.get("toast1") or ""), r.get("toast1"))
    check("  and the second, #2", "#2" in (r.get("toast2") or ""), r.get("toast2"))
    check("the teacher's card says 2 / 2 finished", r.get("teacherCount") == "2 / 2 finished", r.get("teacherCount"))
    g = r.get("teacherGuesses") or ""
    check("the teacher sees the class's first guesses: MAPLE (right) and maple",
          "2 of 2" in g and "✓ MAPLE" in g and "maple" in g, g)
    check("  and no student's name anywhere on the teacher's page",
          r.get("namesOnTeacher") is False, r.get("namesOnTeacher"))
    check("  and the teacher's page shows no stuck / done count", r.get("teacherHands") is False, r.get("teacherHands"))
    check("the whole class passed: both students get the celebration",
          "Everyone finished" in (r.get("party1") or "") and "Everyone finished" in (r.get("party2") or ""),
          (r.get("party1"), r.get("party2")))
    check("  with +5 XP, as they passed it", "+5 XP" in (r.get("party1") or ""), r.get("party1"))
    check("the teacher starts a 1-minute countdown and the class sees it",
          r.get("studentTimer", "").startswith("⏱ 0:5") or r.get("studentTimer") == "⏱ 1:00", r.get("studentTimer"))
    check("  and so does the teacher's bar", (r.get("teacherTimer") or "").startswith("⏱ "), r.get("teacherTimer"))
    check("the pop-out on the projector shows the card's count and the guesses",
          r.get("popCount") == "2 / 2 finished" and "MAPLE" in (r.get("popGuesses") or ""), (r.get("popCount"), r.get("popGuesses")))
    check("  and the countdown, with no stuck / done count", (r.get("popTimer") or "").startswith("⏱ ") and r.get("popHands") is False,
          (r.get("popTimer"), r.get("popHands")))
    server.shutdown()

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
