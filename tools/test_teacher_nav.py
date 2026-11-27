"""The teacher's navigation (templates/_teacher_nav.html), on every teacher page.

Run: python3 tools/test_teacher_nav.py      (the browser half needs node and Chrome)

Nov 2026, the teacher: "the menu bar at the top is cluttered and ... when I'm
in an assignment page, there is no way to return to the class page." Three
layers now: the site bar (Classes, Tutorials, Token shop, the account menu),
the breadcrumb (Classes › the class ▾ › the page) and the class's tabs
(Assignments, Gradebook, Levels, XP & tokens, Attendance), with a page's own
buttons in a row under them. The ▾ goes to the same page in another class:
an assignment's copy there (same library tutorial), else that class's same
tab. In Chrome: the pages still reach their bottom (the sheet was sized as
the window less ONE bar, and the body doesn't scroll), and a menu opens and
closes on a click outside it.
"""
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "nav.db")
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


def client(uid):
    c = P.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = uid
    return c


def part(html, start, end):
    """The text from the first `start` to the next `end` after it ("" if absent)."""
    a = html.find(start)
    if a < 0:
        return ""
    b = html.find(end, a)
    return html[a:b if b > 0 else len(html)]


def current(nav):
    """The links marked aria-current in a piece of the nav, by their text."""
    return [re.sub(r"<[^>]+>", "", m).strip()
            for m in re.findall(r'<a [^>]*aria-current="page"[^>]*>(.*?)</a>', nav, re.S)]


tid = add_user("t", "teacher@example.org", "Teach Er")
teacher = client(tid)
NOTES = "# Day 6\n\nSome notes.\n"
a4 = teacher.post("/api/assignment", json={"title": "Day 6", "code": "print(1)\n", "files": {"notes.md": NOTES}}).get_json()["slug"]
a7 = teacher.post("/api/assignment", json={"title": "Day 6 (P7)", "code": "print(1)\n", "files": {"notes.md": NOTES}}).get_json()["slug"]
other = teacher.post("/api/assignment", json={"title": "Only in P4", "code": "print(1)\n",
                                              "files": {"notes.md": "# Other\n"}}).get_json()["slug"]
db = P.SessionLocal()
p4 = accounts.Course(teacher_id=tid, name="Intro P4", app="pyide")
p7 = accounts.Course(teacher_id=tid, name="Intro P7", app="pyide")
db.add_all([p4, p7])
db.commit()
by = {a.slug: a for a in db.query(accounts.Assignment).all()}
# Every period's copy of a lesson is linked to one library tutorial: that's
# what makes Period 7's Day 6 the twin of Period 4's, whatever its title.
by[a4].tutorial_id = by[a7].tutorial_id = 4242
by[other].tutorial_id = 0
db.add(accounts.ClassItem(class_id=p4.id, assignment_id=by[a4].id, hidden=0, position=1))
db.add(accounts.ClassItem(class_id=p4.id, assignment_id=by[other].id, hidden=0, position=2))
db.add(accounts.ClassItem(class_id=p7.id, assignment_id=by[a7].id, hidden=0, position=1))
db.commit()
c4, c7 = p4.id, p7.id
db.close()

print("Every teacher page has the site bar, and the account menu instead of the bare email")
PAGES = {"dashboard": "/teacher", "class": "/teacher/class/%d" % c4, "gradebook": "/teacher/class/%d/gradebook" % c4,
         "levels": "/teacher/class/%d/levels" % c4, "xp": "/teacher/class/%d/xp" % c4,
         "attendance": "/teacher/class/%d/attendance" % c4, "assignment": "/teacher/" + a4,
         "library": "/teacher/tutorials", "shop": "/teacher/shop"}
html = {}
for name, url in PAGES.items():
    r = teacher.get(url)
    html[name] = r.get_data(as_text=True) if r.status_code == 200 else ""
    check("%s (%s) opens" % (name, url), r.status_code == 200, r.status_code)
for name, h in html.items():
    bar = part(h, '<header class="bar tnav-bar">', "</header>")
    check("%s: the site bar, with Classes, Tutorials and Token shop" % name,
          bar and all(w in bar for w in (">Classes<", "Tutorials<", "Token shop<")), bar[:200])
    check("  and Sign out inside the account menu, not loose in the bar",
          "Sign out" in part(bar, '<details class="tnav-menu tnav-account">', "</details>")
          and 'class="whoami"' not in h, "")
    check("  and teacher_nav.css after site_look.css",
          0 < h.find("site_look.css") < h.find("teacher_nav.css"), "")
check("the dashboard's site link is Classes, the library's Tutorials, the shop's Token shop",
      current(part(html["dashboard"], "tnav-site", "</nav>")) == ["Classes"]
      and current(part(html["library"], "tnav-site", "</nav>")) == ["Tutorials"]
      and current(part(html["shop"], "tnav-site", "</nav>")) == ["Token shop"],
      (current(part(html["library"], "tnav-site", "</nav>")),))
check("the dashboard and the library have no breadcrumb (it would say only Classes)",
      "tnav-crumbs" not in html["dashboard"] and "tnav-crumbs" not in html["library"])
check("  and keep their own buttons in the row under the bar: New project, Create lesson, New tutorial",
      'id="create-lesson"' in part(html["dashboard"], 'class="tnav-actions', "</div>\n<script")
      and 'id="lib-new"' in part(html["library"], 'class="tnav-actions', "</div>\n<script"), "")

print("\nThe class's pages: its tabs, the one you're on marked, and the way back in the crumbs")
TABS = {"class": "Assignments", "gradebook": "Gradebook", "levels": "Levels", "xp": "XP & tokens", "attendance": "Attendance"}
for name, tab in TABS.items():
    tabs = part(html[name], '<nav class="tnav-tabs"', "</nav>")
    check("%s: every tab, %s marked as the one you're on" % (name, tab),
          all(t in tabs for t in ("Assignments", "Gradebook", "Levels", "XP &amp; tokens", "Attendance",
                                  "Student view", "Name picker"))
          and current(tabs) == [tab.replace("&", "&amp;")], current(tabs))
    crumbs = part(html[name], '<nav class="tnav-crumbs"', "</nav>")
    check("  the crumbs: Classes › Intro P4, back to the class's page",
          'href="/teacher"' in crumbs and 'href="/teacher/class/%d"' % c4 in crumbs and "Intro P4" in crumbs, crumbs[:300])
gb_switch = part(html["gradebook"], '<details class="tnav-menu tnav-switch">', "</details>")
check("the ▾ beside the class goes to the same tab in the other class (P4's gradebook → P7's)",
      'href="/teacher/class/%d/gradebook"' % c7 in gb_switch and "Intro P7" in gb_switch
      and "Intro P4" not in gb_switch, gb_switch)
check("  and from the class page, to the other class's page",
      'href="/teacher/class/%d"' % c7 in part(html["class"], '<details class="tnav-menu tnav-switch">', "</details>"))
check("the class page's bar no longer carries the class's tools as buttons (they're tabs)",
      'class="btn" href="/teacher/class/%d/gradebook"' % c4 not in html["class"]
      and "All classes</a>" not in part(html["class"], "<header", "</header>"), "")

print("\nAn assignment's page")
h = html["assignment"]
crumbs = part(h, '<nav class="tnav-crumbs"', "</nav>")
check("the crumbs: Classes › Intro P4 › Day 6 — the way back to the class it's in",
      'href="/teacher/class/%d"' % c4 in crumbs and '<span class="tnav-here" aria-current="page">Day 6</span>' in crumbs, crumbs[:400])
check("  with the class's tabs, none marked (it's inside the class, not one of its tabs)",
      "tnav-tabs" in h and current(part(h, '<nav class="tnav-tabs"', "</nav>")) == [], "")
sw = part(h, '<details class="tnav-menu tnav-switch">', "</details>")
check("the ▾ goes to Period 7's copy of it (the same library tutorial), not just P7's page",
      'href="/teacher/%s"' % a7 in sw, sw)
osw = part(teacher.get("/teacher/" + other).get_data(as_text=True), '<details class="tnav-menu tnav-switch">', "</details>")
check("  one with no copy in P7 sends ▾ to P7's class page", 'href="/teacher/class/%d"' % c7 in osw, osw)
menu = part(h, '<details class="tnav-menu" id="deck-menu">', "</details>")
check("the five teacher-slide buttons are one Teacher slides menu",
      all('id="%s"' % i in menu for i in ("deck-open", "deck-show", "deck-edit", "deck-download", "deck-upload"))
      and "Teacher slides" in menu, menu[:300])
check("  and Edit project / Student preview stay out in the row", 'id="edit-project"' in part(h, 'class="tnav-actions', "</details>")
      and 'id="edit-project"' not in menu, "")
check("the to-grade tag is beside the crumbs", 'id="needs-grading"' in crumbs, "")
loose = teacher.post("/api/assignment", json={"title": "Loose", "code": "print(1)\n", "files": {"notes.md": "# L\n"}}).get_json()["slug"]
lh = teacher.get("/teacher/" + loose).get_data(as_text=True)
check("an assignment in no class: Classes › its title, and no class tabs",
      "tnav-tabs" not in lh and '<span class="tnav-here" aria-current="page">Loose</span>' in lh, "")


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


print("\nIn Chrome")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    # A long class page and assignment page, so their bottoms are below the fold.
    db = P.SessionLocal()
    for k in range(40):
        a = accounts.Assignment(slug="filler%02d" % k, teacher_id=tid, title="Filler %d" % k, app="pyide",
                                code="", files="{}")
        db.add(a)
        db.flush()
        db.add(accounts.ClassItem(class_id=c4, assignment_id=a.id, hidden=0, position=10 + k))
    db.commit()
    db.close()
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"base": "http://127.0.0.1:%d" % server.server_port,
                   "pages": {"class": PAGES["class"], "assignment": PAGES["assignment"], "gradebook": PAGES["gradebook"]},
                   "shots": os.environ.get("NAV_SHOTS", ""),
                   "teacher": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": tid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "teacher_nav_browser.mjs"), setup, chrome],
                         cwd=PYIDE, capture_output=True, text=True, timeout=200)
    try:
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        r = {"error": out.stdout[-300:] + out.stderr[-300:]}
    check("the browser run finished", not r.get("error"), r.get("error", ""))
    for name in ("class", "assignment", "gradebook"):
        p = (r.get("pages") or {}).get(name) or {}
        check("%s: the page scrolls to its very bottom, inside the window" % name,
              p.get("fits") is True and p.get("reached") is True, p)
    m = r.get("menu") or {}
    check("Teacher slides opens on a click, and closes on a click outside it",
          m.get("opened") is True and m.get("closed") is True, m)
    check("  and Escape closes it too", m.get("escaped") is True, m)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
