#!/usr/bin/env python3
"""Student preview (student_preview in app.py), on the server and in Chrome.

    python3 tools/test_preview_browser.py
    PREVIEW_SHOT=/some/dir python3 tools/test_preview_browser.py   # and screenshots

  * the assignment's page has 👁 Student preview beside Edit project
  * only the teacher who set it can open it; a lesson, lab or discussion
    goes to its own student view
  * it is a student's page: the starter, the notes as students get them
    (keys and hints out), no teacher controls, a bar with Exit back to the
    assignment and Start over
  * nothing is kept: no draft made, no answer recorded; the page's storage
    is in memory, so it starts fresh every time and the teacher's own
    browser storage is never read or written
  * a v11 lesson previews the level picked in the bar
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "preview.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org,other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
from werkzeug.serving import make_server                     # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:400]))


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


NOTES = """locked: yes
# Joining

Read this.

```quiz
Pick b
- [ ] a
- [x] b
```

## Exercise

:::level easy
EASY-BOX
```tests exercise easy
prints Hi
hint: SECRET-HINT
code: print("Hi")
```
:::end
:::level master
MASTER-BOX
```tests exercise master
prints Hey
```
:::end

---

## Next

The second slide.
"""

chrome = find_chrome()
if not chrome or not shutil.which("node"):
    print("Chrome and node are needed.")
    sys.exit(1)

db = P.SessionLocal()
t = accounts.User(google_sub="t", email="teacher@example.org", name="Teach")
o = accounts.User(google_sub="o", email="other@example.org", name="Other")
s = accounts.User(google_sub="s", email="kid@example.org", name="Kid")
db.add_all([t, o, s])
db.commit()
tid, oid, sid = t.id, o.id, s.id
a = accounts.Assignment(slug="prevcode", app="pyide", teacher_id=tid, title="Joining", code="# start here\n",
                        files=json.dumps({"notes.md": NOTES}))
lesson = accounts.Assignment(slug="prevless", app="pyide", teacher_id=tid, title="A lesson", kind="lesson", code="",
                             files=json.dumps({"lesson.md": "# L"}))
db.add_all([a, lesson])
db.commit()
aid = a.id
db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as ss:
            ss["uid"] = uid
    return c


teacher, other, kid, nobody = client(tid), client(oid), client(sid), client()

print("On the server")
details = teacher.get("/teacher/prevcode").get_data(as_text=True)
check("the assignment's page has 👁 Student preview, beside Edit project",
      'id="student-preview"' in details and "/teacher/prevcode/preview" in details
      and details.index('id="edit-project"') < details.index('id="student-preview"'))
page = teacher.get("/teacher/prevcode/preview")
html = page.get_data(as_text=True)
check("the teacher opens it: a student's editor page, with the preview bar", page.status_code == 200
      and "preview-bar" in html and "Exit preview" in html and "/teacher/prevcode" in html)
check("…the notes as a student gets them: no answer key, no hint, no code", "[x]" not in html
      and "SECRET-HINT" not in html and 'code: print' not in html)
check("…as a student: not authoring, not the teacher", '"authoring": true' not in html and "authoring: true" not in html
      and "isTeacher: true" not in html, [ln for ln in html.split("\n") if "authoring:" in ln or "isTeacher:" in ln])
check("…the starter code", "# start here" in html)
check("…no Save or Share (a snapshot to the server), no Go live or Publish; a Turn in that does nothing",
      'id="save-project"' not in html and 'id="share"' not in html and 'id="go-live"' not in html
      and 'id="publish"' not in html and "Not saved (preview)" in html and 'title="Students turn in here. A preview can\'t.">Turn in' in html)
check("another teacher can't open it", other.get("/teacher/prevcode/preview").status_code == 404)
check("nor a student", kid.get("/teacher/prevcode/preview").status_code in (302, 403, 404))
check("nor anyone signed out", nobody.get("/teacher/prevcode/preview").status_code in (302, 401, 403))
check("a lesson goes to its own student view", teacher.get("/teacher/prevless/preview").headers.get("Location", "").endswith("/a/prevless?preview=1"))

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "details": "/teacher/prevcode",
               "preview": "/teacher/prevcode/preview", "teacher": sign.dumps({"uid": tid})}, f)
run = subprocess.run(["node", os.path.join(HERE, "preview_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=300)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("In Chrome")
check("the browser run finished", not r.get("error"), r.get("error", ""))
check("the button opens the preview", r.get("button") == "/teacher/prevcode/preview", r.get("button"))
check("the bar says what it is, and Exit goes back to the assignment's page",
      "Student preview" in (r.get("bar") or "") and "Nothing you do here is saved" in (r.get("bar") or "")
      and r.get("exit") == "/teacher/prevcode", (r.get("bar"), r.get("exit")))
check("the page never sees the teacher's own browser storage", r.get("seesReal") is None, r.get("seesReal"))
check("it's a student's page: not authoring", r.get("authoring") is False, r.get("authoring"))
check("the starter is in the editor", "# start here" in (r.get("code") or ""), r.get("code"))
check("the page still fits the window with the bar on top", r.get("fitsWindow") is True, r.get("fitsWindow"))
check("the slide arrows are in the window and can be clicked (the bar once pushed them below it)",
      r.get("navTall") is True, r.get("navTall"))
check("  on a short laptop screen too (1100×620), where the bar wraps", r.get("navShort") is True, r.get("navShort"))
fr = r.get("fresh") or {}
check("opened again: a first visit again — nothing stored, the starter back", fr.get("stored") is None
      and "# start here" in (fr.get("code") or "") and "print(1)" not in (fr.get("code") or ""), fr)
m = r.get("master") or {}
check("Level: Master shows Master's boxes, and only those", m.get("picked") == "master" and m.get("shown") == ["master"], m)
check("the teacher's own storage, after: just as it was", r.get("realAfter") == "kept|null", r.get("realAfter"))
db = P.SessionLocal()
drafts = db.query(accounts.Draft).filter_by(owner_id=tid).count()
subs = db.query(accounts.Submission).filter_by(assignment_id=aid).count()
db.close()
check("nothing kept: no draft, no turn-in", drafts == 0 and subs == 0, (drafts, subs))

print()
failed = results.count(False)
print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if failed else 0)
