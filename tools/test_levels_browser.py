"""v11 levels in a real browser: Choose your level, and only that level shows.

Run: python3 tools/test_levels_browser.py      (needs node and Chrome)

A ```level block is three buttons (Easy, Medium, Master) and `:::level easy`
… `:::end` boxes are what each level sees (notes.js, "levels"). This opens a
lesson in Chrome as students and its teacher and checks: nothing of the
exercise shows until a level is chosen (a line says where to choose); a
choice (pressed twice, except Master) shows that level's box alone, is the
server's (a reload keeps it), greys out the harder ones and lets a student
drop down; the challenge is chosen on its own; a locked student sees only
their level; the bonus card shows no ✗ until something on it passes; the
teacher writing the notes sees every level with a switcher and nothing is
saved; and with `locked: yes` the level slide holds the next one until a
level is chosen. The server side is test_levels.py.
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

```level
```

## Exercise

:::level easy
EASY-BOX fill the blanks
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

```level
for: challenge
```

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
# Choose

```level
```

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

print("Choose your level, in a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid Ode")
    sid2 = add_user("s2", "kid2@example.org", "Ana Ruiz")
    lid = add_user("l", "locked@example.org", "Bo Lee")
    gid = add_user("g", "sugg@example.org", "Cy Dee")
    teacher = P.app.test_client()
    with teacher.session_transaction() as sess:
        sess["uid"] = tid
    slug = teacher.post("/api/assignment", json={"title": "Levels", "code": "# Levels\n",
                                                 "files": {"notes.md": NOTES}}).get_json()["slug"]
    slug2 = teacher.post("/api/assignment", json={"title": "Slides", "code": "# Slides\n",
                                                  "files": {"notes.md": SLIDES}}).get_json()["slug"]
    db = P.SessionLocal()
    course = accounts.Course(teacher_id=tid, name="100 Days", app="pyide")
    db.add(course)
    db.commit()
    for s in (slug, slug2):
        it = db.query(accounts.Assignment).filter_by(slug=s).first()
        db.add(accounts.ClassItem(class_id=course.id, assignment_id=it.id))
    for email in ("kid@example.org", "kid2@example.org", "locked@example.org", "sugg@example.org"):
        db.add(accounts.Enrollment(class_id=course.id, email=email, name=email))
    db.commit()
    enr = db.query(accounts.Enrollment).filter_by(class_id=course.id, email="locked@example.org").first().id
    genr = db.query(accounts.Enrollment).filter_by(class_id=course.id, email="sugg@example.org").first().id
    cid = course.id
    db.close()
    teacher.post("/api/class/%d/levels" % cid, json={"teacher_name": "Mr. Franz"})
    teacher.post("/api/class/%d/levels" % cid, json={"enrollment": enr, "level": "medium", "locked": True})
    teacher.post("/api/class/%d/levels" % cid, json={"enrollment": genr, "level": "medium"})
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    sign = P.app.session_interface.get_signing_serializer(P.app)
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": base, "page": "/a/" + slug, "teacherPage": "/teacher/%s/edit" % slug,
                   "slides": "/a/" + slug2,
                   "student": sign.dumps({"uid": sid}), "student2": sign.dumps({"uid": sid2}),
                   "locked": sign.dumps({"uid": lid}), "sugg": sign.dumps({"uid": gid}),
                   "teacher": sign.dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "levels_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=300)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    b = r.get("before") or {}
    check("nothing of the exercise or challenge shows before a level is chosen", b.get("shown") == [], b)
    check("  a line says where to choose instead", "Choose your level" in (b.get("wait") or "")
          and "challenge level" in (b.get("wait") or ""), b.get("wait"))
    check("  the level slide wants a choice (data-needs), and warns that changing loses the points",
          b.get("needs") is True and "change your level" in (b.get("notes") or ""), b)
    m = r.get("medium") or {}
    check("no suggestion: one press chooses Medium, and only Medium's box shows",
          m.get("shown") == ["MEDIUM-BOX fewer hints"], m)
    check("  the line saying where to choose goes", "your exercise shows up" not in (m.get("wait") or ""), m.get("wait"))
    check("  every level can still be pressed", m.get("masterDisabled") is False and m.get("easyDisabled") is False, m)
    check("  the slide no longer waits, and it says what they chose", m.get("needs") is False
          and "You chose Medium" in (m.get("notes") or ""), m)
    check("Check my work runs only their level's tests", r.get("ran") == ["Prints Howdy"]
          or sorted(r.get("ran") or []) == ["Prints Howdy", "Prints Wow 3"], r.get("ran"))
    bu = r.get("bonusUntried") or {}
    check("the bonus card, not tried: no ✗, says it's optional", "✗" not in (bu.get("marks") or "✗")
          and "Optional" in (bu.get("sum") or "") and "Bonus" in (bu.get("head") or ""), bu)
    check("  while the exercise card passed in the same check", bu.get("exercisePassed") is True, bu)
    bd = r.get("bonusDone") or {}
    check("  done: ✓ and passed", bd.get("marks") == "✓" and bd.get("passed") is True, bd)
    rl = r.get("reloaded") or {}
    check("a reload keeps the level (it's the server's)", rl.get("shown") == ["MEDIUM-BOX fewer hints", "CH-MASTER"], rl)
    ch = r.get("change") or {}
    check("changing level asks again, saying the points would be lost",
          "Change to Easy?" in (ch.get("button") or "") and "lost" in (ch.get("notes") or ""), ch)
    dr = r.get("dropped") or {}
    check("  pressed again: Easy's box shows, and they're told it earns nothing now",
          dr.get("shown") == ["EASY-BOX fill the blanks", "CH-MASTER"] and "won't earn points" in (dr.get("notes") or ""), dr)
    sg = r.get("sugg") or {}
    check("a suggested student sees ⭐ and that only that level earns",
          "⭐ Medium" in (sg.get("buttons") or "") and "Only Medium earns" in (sg.get("notes") or ""), sg)
    check("  another level asks again, saying it earns no points",
          "Choose Easy?" in (sg.get("confirm") or "") and "earns no points" in (sg.get("confirmNotes") or ""), sg)
    lk = r.get("locked") or {}
    check("a locked student sees only their level's button and boxes (the challenge's too)", len(lk.get("buttons") or []) == 1
          and "Medium" in (lk.get("buttons") or [""])[0]
          and lk.get("shown") == ["MEDIUM-BOX fewer hints", "CH-MEDIUM"], lk)
    check("  told by name, and never held", "Mr. Franz set your level: Medium" in (lk.get("notes") or "")
          and lk.get("needs") is False, lk)
    t = r.get("teacher") or {}
    check("the teacher sees a switcher on Easy, said to be the teacher's view",
          t.get("shown") == ["EASY-BOX fill the blanks", "CH-EASY"] and "Teacher view" in (t.get("notes") or ""), t)
    check("  pressing Master shows Master's box at once", r.get("teacherMaster") == ["MASTER-BOX write it yourself", "CH-EASY"],
          r.get("teacherMaster"))
    db = P.SessionLocal()
    kept = db.query(P.LevelPick).filter_by(student_id=tid).count()
    db.close()
    check("  and nothing of the teacher's is kept", kept == 0, kept)
    h = r.get("held") or {}
    check("locked: yes — the level slide holds the next one, saying why", h.get("next") is True
          and "level" in (h.get("why") or "").lower(), h)
    check("  chosen, the way on opens, and the next slide shows that level",
          r.get("unheld") is False and r.get("nextSlide") == ["MASTER-BOX"], (r.get("unheld"), r.get("nextSlide")))
    check("  another level's hidden card doesn't hold it: passing Master's opens the way on",
          r.get("exerciseOpen") is False, r.get("exerciseOpen"))
    check("a bonus check never holds the way on", r.get("bonusHolds") is False, r.get("bonusHolds"))

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
