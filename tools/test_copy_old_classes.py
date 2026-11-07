#!/usr/bin/env python3
"""Copy WebIDE and FlaskIDE classes into PyIDE (copy_old_classes in app.py).

    python3 tools/test_copy_old_classes.py

WebIDE and FlaskIDE moved into PyIDE and are going away. Their classes
already open here, but the teacher asked for each to become a new PyIDE
class before then: the dashboard's Copy button makes one per WebIDE or
FlaskIDE class, of the same name, with

  * its roster, its Google Classroom course and its week's calendar, so the
    copy works for the same students at once
  * its banner, groups, materials and descriptions, in the same order,
    hidden ones still hidden
  * a fresh copy of every assignment — archived ones and closed ones too,
    still so, each keeping its own IDE, tutorial and deck — and its live
    link made ahead

and never the students' work: the copies start empty, and the originals
are left exactly as they were, still listed (the teacher's choice). Each
class is copied once: pressing it again copies nothing it already has.
Duplicate class, which the copy shares its code with, is unchanged.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "copy.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org, other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-70s %s" % ("ok" if condition else "FAIL", label, detail))


def add(obj):
    db = P.SessionLocal()
    try:
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj
    finally:
        db.close()


def rows(model, **by):
    db = P.SessionLocal()
    try:
        return db.query(model).filter_by(**by).all()
    finally:
        db.close()


def client(uid):
    c = P.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = uid
    return c


TEACHER = add(accounts.User(google_sub="t", email="teacher@example.org", name="Mr Franz")).id
OTHER_T = add(accounts.User(google_sub="o", email="other@example.org", name="Other")).id
KID = add(accounts.User(google_sub="k", email="kid@example.org", name="A Kid")).id
teacher, other_teacher, kid = client(TEACHER), client(OTHER_T), client(KID)

WEB = dict(P.WEB_STARTER, **{"notes.md": "# Lists\n\n```tests\nhas 3 li\n```\n"})


def make_class(app, name, teacher_id=TEACHER, **more):
    return add(accounts.Course(app=app, teacher_id=teacher_id, name=name, **more))


def make_assignment(app, title, files, teacher_id=TEACHER, **more):
    return add(accounts.Assignment(slug=accounts.new_id(P.SessionLocal(), accounts.Assignment), app=app,
                                   teacher_id=teacher_id, title=title, code="", files=json.dumps(files), **more))


def place(course, item=None, **more):
    return add(accounts.ClassItem(class_id=course.id, assignment_id=item.id if item else None, **more))


# A WebIDE class, as WebIDE made it.
web1 = make_class("webide", "Web Design 1", banner="Welcome to web!", calendar="Monday:\nLists",
                  course_id="cr123", course_name="Web Design 1 (Classroom)")
for email, name in (("kid@example.org", "A Kid"), ("kid2@example.org", "B Kid")):
    add(accounts.Enrollment(class_id=web1.id, email=email, name=name))
tut = add(accounts.LibraryItem(slug="tut0000001", app="webide", teacher_id=TEACHER, kind="tutorial",
                               title="Lists", body=WEB["notes.md"], size=10))
lists = make_assignment("webide", "Lists", WEB, tutorial_id=tut.id)
old_one = make_assignment("webide", "Last month", WEB, archived=1)
quest = make_assignment("webide", "Quest", WEB, closed=1, xp_bonus=50, out_of=10)
place(web1, kind="group", title="Unit 1", position=0)
place(web1, lists, kind="assignment", title="", position=1, description="Do the list.")
place(web1, kind="material", title="Reading", position=2, hidden=1, description="Read this.")
place(web1, old_one, kind="assignment", position=3)
place(web1, quest, kind="assignment", position=4, show_live=0)
# a student's work in it
kid.get("/a/" + lists.slug)
_d = rows(accounts.Draft, owner_id=KID, assignment_id=lists.id)[0]
kid.post("/api/submit", json={"draft": _d.slug, "files": dict(WEB, **{"index.html": "<h1>mine</h1>"})})

# A FlaskIDE class.
sql1 = make_class("flaskide", "SQL 1")
add(accounts.Enrollment(class_id=sql1.id, email="kid@example.org", name="A Kid"))
queries = make_assignment("flaskide", "Queries", P.SQL_STARTER)
place(sql1, queries, kind="assignment", position=0)

# Not to be copied: a Python class, and another teacher's WebIDE class.
py1 = make_class("pyide", "Python 1")
theirs = make_class("webide", "Their web class", teacher_id=OTHER_T)


# --------------------------------------------------------------------------
print("\nThe dashboard offers it")
dash = teacher.get("/teacher").get_data(as_text=True)
box = dash[dash.find('id="copy-old-box"'):dash.find('id="new-class"')] if 'id="copy-old-box"' in dash else ""
check("it names the WebIDE and FlaskIDE classes", "Web Design 1" in box and "SQL 1" in box, box[:200])
check("  not a Python class, nor another teacher's", "Python 1" not in box and "Their web class" not in box)
check("only a teacher may press it", kid.post("/api/classes/copy-old").status_code == 403)

# --------------------------------------------------------------------------
print("\nPressing it")
r = teacher.post("/api/classes/copy-old", json={})
got = r.get_json() or {}
check("copies the two classes", r.status_code == 200 and sorted(c["name"] for c in got.get("copied", []))
      == ["SQL 1", "Web Design 1"], got)

db = P.SessionLocal()
new_web = (db.query(accounts.Course).filter(accounts.Course.app == "pyide", accounts.Course.name == "Web Design 1")
           .first())
new_sql = (db.query(accounts.Course).filter(accounts.Course.app == "pyide", accounts.Course.name == "SQL 1").first())
db.close()
check("each is a new PyIDE class of the same name", new_web is not None and new_sql is not None
      and new_web.id != web1.id)
check("  with the same Classroom course, calendar and banner",
      (new_web.course_id, new_web.course_name, new_web.calendar, new_web.banner)
      == ("cr123", "Web Design 1 (Classroom)", "Monday:\nLists", "Welcome to web!"))
check("  and the same students",
      sorted(e.email for e in rows(accounts.Enrollment, class_id=new_web.id))
      == ["kid2@example.org", "kid@example.org"])

db = P.SessionLocal()
items = (db.query(accounts.ClassItem).filter_by(class_id=new_web.id)
         .order_by(accounts.ClassItem.position).all())
copies = {a.id: a for a in db.query(accounts.Assignment).filter(
    accounts.Assignment.id.in_([i.assignment_id for i in items if i.assignment_id])).all()}
db.close()
check("its page laid out the same: group, assignment, hidden material, archived, quest",
      [(i.kind, i.title, i.hidden) for i in items]
      == [("group", "Unit 1", 0), ("assignment", "", 0), ("material", "Reading", 1),
          ("assignment", "", 0), ("assignment", "", 0)]
      and items[1].description == "Do the list." and items[4].show_live == 0)
c_lists, c_old, c_quest = (copies[items[1].assignment_id], copies[items[3].assignment_id],
                           copies[items[4].assignment_id])
check("every assignment copied, new links, each still a web assignment",
      {c_lists.slug, c_old.slug, c_quest.slug}.isdisjoint({lists.slug, old_one.slug, quest.slug})
      and {a.app for a in (c_lists, c_old, c_quest)} == {"webide"})
check("  its starter files and tutorial with it",
      c_lists.file_map() == WEB and c_lists.tutorial_id == tut.id)
check("  the archived one still archived, the closed quest still closed, its reward kept",
      c_old.archived == 1 and c_quest.closed == 1 and c_quest.xp_bonus == 50 and c_quest.out_of == 10)
check("  each with its live link made ahead",
      all(rows(accounts.LiveSession, assignment_id=a.id) for a in (c_lists, c_quest)))
check("a SQL class's assignment stays a FlaskIDE one, a SQL project",
      [a.app for a in rows(accounts.Assignment, title="Queries")] == ["flaskide", "flaskide"]
      and "query.sql" in [a for a in rows(accounts.Assignment, title="Queries") if a.id != queries.id][0].file_map())

check("students' work is not copied: the copy has none",
      not rows(accounts.Draft, assignment_id=c_lists.id) and not rows(accounts.Submission, assignment_id=c_lists.id))
check("  and the original keeps theirs",
      rows(accounts.Draft, assignment_id=lists.id) and rows(accounts.Submission, assignment_id=lists.id))
check("the original class is untouched, and still listed for its student",
      rows(accounts.Course, id=web1.id)[0].app == "webide"
      and kid.get("/classes").get_data(as_text=True).count("Web Design 1") >= 2)
check("their class page opens the copy", kid.get("/class/%d" % new_web.id).status_code == 200
      and c_lists.slug in kid.get("/class/%d" % new_web.id).get_data(as_text=True))

# --------------------------------------------------------------------------
print("\nPressing it again")
r = teacher.post("/api/classes/copy-old", json={})
check("copies nothing it already has", r.get_json().get("copied") == [], r.get_json())
check("  and the dashboard stops offering it",
      'id="copy-old"' not in teacher.get("/teacher").get_data(as_text=True))
add(accounts.Course(app="flaskide", teacher_id=TEACHER, name="PHP 1"))
check("a class made since is offered, and copied alone",
      [c["name"] for c in teacher.post("/api/classes/copy-old", json={}).get_json()["copied"]] == ["PHP 1"])
check("another teacher's class was never touched",
      not [c for c in rows(accounts.Course, teacher_id=TEACHER) if c.name == "Their web class"])

# --------------------------------------------------------------------------
print("\nDuplicate class is as it was")
r = teacher.post("/api/class/%d/duplicate" % web1.id, json={"name": "Web Design 1, spring"})
dup = rows(accounts.Course, id=r.get_json()["id"])[0]
db = P.SessionLocal()
dup_items = db.query(accounts.ClassItem).filter_by(class_id=dup.id).all()
dup_assignments = [db.get(accounts.Assignment, i.assignment_id) for i in dup_items if i.assignment_id]
db.close()
check("no roster, no Classroom course, no calendar",
      not rows(accounts.Enrollment, class_id=dup.id) and dup.course_id == "" and dup.calendar == "")
check("  and the archived assignment left behind",
      len(dup_assignments) == 2 and all(not a.archived for a in dup_assignments),
      [(a.title, a.archived) for a in dup_assignments])

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
