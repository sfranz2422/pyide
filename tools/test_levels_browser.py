"""v11 levels in a real browser: each student sees only the level their teacher set.

Run: python3 tools/test_levels_browser.py      (needs node and Chrome)

`:::level easy` … `:::end` boxes are what each level sees, tests included
(notes.js, "levels"). The teacher sets each student's level behind the
scenes (Easy until set); students see no choice and no suggestion. This
opens a lesson in Chrome as students and its teacher and checks: a student
sees only their level's boxes (Easy, or what the teacher set) and nothing
about levels; a pause (^) before :::end never leaves %%LEVELEND%% on the
slide; Check my work runs only their level's tests; the bonus card shows no
✗ until something on it passes; another level's hidden card never holds a
locked slide; and the teacher writing the notes gets a small view switcher
over the boxes, which shows each level at once and saves nothing. The
server side is test_levels.py.
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
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "levelsb.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-70s %s" % ("ok" if condition else "FAIL", label, "" if condition else str(detail)[:300]))


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
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


NOTES = """# Levels

## Exercise

:::level easy
EASY-BOX fill the blanks

^

```tests exercise easy
prints Hello
```
:::end
:::level medium
MEDIUM-BOX fewer hints
```tests exercise medium
prints Howdy
```
:::end
:::level master
MASTER-BOX write it yourself
```tests exercise master
prints Hey there
```
:::end

## ★ Challenge

:::level challenge easy
CH-EASY
```tests bonus easy
prints Wow 1
```
:::end
:::level challenge medium
CH-MEDIUM
```tests bonus medium
prints Wow 2
```
:::end
:::level challenge master
CH-MASTER
```tests bonus master
prints Wow 3
```
:::end
"""

SLIDES = """locked: yes
# Start

Hello.

---

## Exercise

:::level easy
EASY-BOX
```tests exercise easy
prints Hello
```
:::end
:::level master
MASTER-BOX
```tests exercise master
prints Hey there
```
:::end

---

## ★ Challenge

```tests bonus
prints Wow
```

---

## The end
"""

print("Levels, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid Ode")          # level never set: Easy
    mid = add_user("m", "master@example.org", "Bo Lee")         # set to Master
    teacher = P.app.test_client()
    with teacher.session_transaction() as sess:
        sess["uid"] = tid
    slug = teacher.post("/api/assignment", json={"title": "Levels", "code": "# Levels\n",
                                                 "files": {"notes.md": NOTES}}).get_json()["slug"]
    slug2 = teacher.post("/api/assignment", json={"title": "Slides", "code": "# Slides\n",
                                                  "files": {"notes.md": SLIDES}}).get_json()["slug"]
    WEB_NOTES = ("# Web\n\n:::level easy\nWEB-EASY\n```tests exercise easy\nhas h1\n```\n:::end\n"
                 ":::level master\nWEB-MASTER\n```tests exercise master\nhas h2\n```\n:::end\n")
    wslug = teacher.post("/api/assignment", json={"title": "Web levels", "ide": "webide", "code": "",
                                                  "files": dict(P.WEB_STARTER, **{"notes.md": WEB_NOTES})}).get_json()["slug"]
    db = P.SessionLocal()
    course = accounts.Course(teacher_id=tid, name="100 Days", app="pyide")
    db.add(course)
    db.commit()
    for s in (slug, slug2, wslug):
        it = db.query(accounts.Assignment).filter_by(slug=s).first()
        db.add(accounts.ClassItem(class_id=course.id, assignment_id=it.id))
    for email in ("kid@example.org", "master@example.org"):
        db.add(accounts.Enrollment(class_id=course.id, email=email, name=email))
    db.commit()
    menr = db.query(accounts.Enrollment).filter_by(class_id=course.id, email="master@example.org").first().id
    cid = course.id
    db.close()
    teacher.post("/api/class/%d/levels" % cid, json={"enrollment": menr, "level": "master"})
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    sign = P.app.session_interface.get_signing_serializer(P.app)
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/a/" + slug, "teacherPage": "/teacher/%s/edit" % slug,
                   "slides": "/a/" + slug2, "web": "/a/" + wslug, "student": sign.dumps({"uid": sid}),
                   "master": sign.dumps({"uid": mid}), "teacher": sign.dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "levels_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    e = r.get("easy") or {}
    check("a student whose level isn't set sees Easy's boxes, and only those",
          e.get("shown") == ["EASY-BOX fill the blanks", "CH-EASY"], e)
    check("  and nothing about levels: no choice, no suggestion, no switcher",
          e.get("chooser") is False and e.get("levelWords") is False, e)
    check("  a pause before :::end never leaves the marker on the slide", e.get("marker") is False, e)
    check("Check my work runs only their level's tests", sorted(r.get("ran") or []) == ["Prints Hello", "Prints Wow 1"],
          r.get("ran"))
    bu = r.get("bonusUntried") or {}
    check("the bonus card, not tried: no ✗, says it's optional", "✗" not in (bu.get("marks") or "✗")
          and "Optional" in (bu.get("sum") or "") and "Bonus" in (bu.get("head") or ""), bu)
    check("  while the exercise card passed in the same check", bu.get("exercisePassed") is True, bu)
    bd = r.get("bonusDone") or {}
    check("  done: ✓ and passed", bd.get("marks") == "✓" and bd.get("passed") is True, bd)
    m = r.get("master") or {}
    check("a student the teacher set to Master sees Master's boxes, and only those",
          m.get("shown") == ["MASTER-BOX write it yourself", "CH-MASTER"], m)
    t = r.get("teacher") or {}
    check("the teacher writing the notes sees Easy, with a view switcher over each group",
          t.get("shown") == ["EASY-BOX fill the blanks", "CH-EASY"] and t.get("bars") == 2, t)
    check("  pressing Master there shows Master's boxes at once", r.get("teacherMaster") == ["MASTER-BOX write it yourself", "CH-MASTER"],
          r.get("teacherMaster"))
    db = P.SessionLocal()
    kept = db.query(P.LevelSuggestion).count()
    db.close()
    check("  and saves nothing", kept == 1, kept)
    h = r.get("held") or {}
    check("locked: yes — Master's student on the exercise slide sees Master's box, and is held until it passes",
          h.get("shown") == ["MASTER-BOX"] and h.get("next") is True, h)
    check("  passing Master's check opens the way on (Easy's hidden card holds nothing)", r.get("exerciseOpen") is False,
          r.get("exerciseOpen"))
    check("a bonus check never holds the way on", r.get("bonusHolds") is False, r.get("bonusHolds"))
    w = r.get("web") or {}
    check("a web lesson: Easy's box only, and its Check my work runs only Easy's tests",
          w.get("shown") == ["WEB-EASY"] and w.get("ran") == ["Has h1"], w)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
