"""The gradebook in a real browser: Check all from a column, and typing a grade.

Run: python3 tools/test_gradebook_browser.py      (needs node and Chrome; fetches Python from the CDN)

A column whose assignment has tests gets Check all: it opens the assignment
page in a small window with ?checkall=1, which runs that page's own Check all
(in the teacher's browser, as always), tells the gradebook, and closes; the
gradebook reloads with the tests' points in. A cell whose turned-in code
hasn't been checked shows ⟳ until then. A grade typed into a cell is saved
and stays. The server side is test_gradebook.py.
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
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "gbb.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-68s %s" % ("ok" if condition else "FAIL", label, "" if condition else str(detail)[:300]))


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def client(uid):
    c = P.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = uid
    return c


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


print("The gradebook, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid Ode")
    teacher, student = client(tid), client(sid)
    slug = teacher.post("/api/assignment", json={"title": "Say hi", "code": "# say hi\n",
                                                 "files": {"notes.md": "# Hi\n```tests\nprints hi    (4 points)\n```\n"}}).get_json()["slug"]
    db = P.SessionLocal()
    course = accounts.Course(teacher_id=tid, name="P4", app="pyide")
    db.add(course)
    db.commit()
    item = db.query(accounts.Assignment).filter_by(slug=slug).first()
    db.add(accounts.ClassItem(class_id=course.id, assignment_id=item.id, hidden=0))
    db.add(accounts.Enrollment(class_id=course.id, email="kid@example.org", name="Kid Ode"))
    db.commit()
    cid = course.id
    db.close()
    student.get("/a/" + slug)
    db = P.SessionLocal()
    dslug = db.query(accounts.Draft).filter_by(owner_id=sid).first().slug
    db.close()
    turned = student.post("/api/submit", json={"draft": dslug, "code": 'print("hi")\n', "files": {}})
    check("the student turns in code that passes", turned.status_code == 200, turned.get_json())
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "gradebook": "/teacher/class/%d/gradebook" % cid, "slug": slug,
                   "teacher": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "gradebook_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=400)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    b = r.get("before") or {}
    check("before Check all: tests unchecked (⟳), nothing scored yet", b.get("mark") is True and b.get("value") == "", b)
    a = r.get("after") or {}
    check("Check all from the column: the tests' 4 points are in, the ⟳ gone", a.get("value") == "4" and a.get("mark") is False, a)
    check("a grade typed into the cell is kept", r.get("typed") == "3", r.get("typed"))
    db = P.SessionLocal()
    sub = db.query(accounts.Submission).filter_by(student_id=sid).first()
    db.close()
    check("  as the teacher's score that makes the total 3 (3 - 4 = -1)", sub is not None and sub.score == -1, sub and sub.score)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
