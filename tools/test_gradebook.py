"""The class's gradebook, a student's own grades, and Export all to Skyward.

Run: python3 tools/test_gradebook.py

The teacher (Nov 2026): "a gradebook page that lists all the students
assignments with their scores and average grade ... the students should also
have access ... choose categories for assignments (use the ones from the
skyward export dropdown) and export all the assignments into the skyward csv".
Their choices: weighted categories; every assignment students can see
counts, missing work as 0; an assignment with no category is shown, not
counted. The level suggester (v11) sits on each row.

Pinned here: the averages (weighted, and total points before any weight is
set), missing = 0, hidden left out, uncategorized marked and left out; the
columns' category and due date saved and refused when wrong; only the
class's teacher changes anything; a student sees their own row and nobody
else's; the one Skyward file (its columns, left-out assignments named,
missing as 0 or left out); the assignment page's Download for Skyward and
the gradebook sharing a category and due date; the pages linked.
"""
import csv
import io
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "gradebook.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org,other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-74s %s" % ("ok" if condition else "FAIL", label, "" if condition else str(detail)[:300]))


def add_user(sub, email, name, first="", last=""):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name, first_name=first, last_name=last)
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


tid = add_user("t", "teacher@example.org", "Teach")
ava = add_user("a", "ava@example.org", "Ava Reyes", "Ava", "Reyes")
ben = add_user("b", "ben@example.org", "Ben Cole")            # no first/last kept: guessed
teacher, ka, kb = client(tid), client(ava), client(ben)
other = client(add_user("o", "other@example.org", "Other T"))

db = P.SessionLocal()
course = accounts.Course(teacher_id=tid, name="P4 Intro", app="pyide")
db.add(course)
db.commit()
CID = course.id
for email, name in (("ava@example.org", "Ava Reyes"), ("ben@example.org", "Ben Cole"),
                    ("cy@example.org", "Cy Dee")):              # Cy never signed in
    db.add(accounts.Enrollment(class_id=CID, email=email, name=name))
db.commit()
db.close()


def make(title, out_of, hidden=False):
    slug = teacher.post("/api/assignment", json={"title": title, "code": "x = 0\n", "files": {}}).get_json()["slug"]
    db = P.SessionLocal()
    it = db.query(accounts.Assignment).filter_by(slug=slug).first()
    it.out_of = out_of
    db.add(accounts.ClassItem(class_id=CID, assignment_id=it.id, hidden=1 if hidden else 0,
                              position=-len(results) - 100))
    db.commit()
    aid = it.id
    db.close()
    return slug, aid


def score(aid, uid, pts):
    db = P.SessionLocal()
    db.add(accounts.Submission(assignment_id=aid, student_id=uid, snippet_slug="", times_submitted=1, score=pts))
    db.commit()
    db.close()


A, aid = make("Strings HW", 10)
B, bid = make("Strings Test", 20)
C, cid_ = make("Hidden Quiz", 10, hidden=True)
D, did = make("Extra Practice", 5)
score(aid, ava, 8)
score(bid, ava, 10)
score(bid, ben, 20)
score(cid_, ava, 10)
score(did, ava, 5)
GB = "/teacher/class/%d/gradebook" % CID
API = "/api/class/%d/gradebook" % CID

print("The teacher's gradebook")
page = teacher.get(GB).get_data(as_text=True)
check("every student on the roster, and every assignment they can see",
      all(n in page for n in ("Ava Reyes", "Ben Cole", "Cy Dee", "Strings HW", "Strings Test", "Extra Practice")), page[:200])
check("  a hidden assignment isn't in it", "Hidden Quiz" not in page)
check("  no weights yet: the average is total points (Ava 23 of 35 = 65.7%)", "65.7%" in page and "No weights set" in page)
check("  missing work shows as missing (Ben's HW)", page.count("gb-missing") >= 4)
book = None
db = P.SessionLocal()
book = P._gradebook(db, db.get(accounts.Course, CID))
db.close()
rows = {p["name"]: p for p in book["students"]}
check("  Ben: 20 of 35, missing as 0 (57.1%); Cy, never here: 0%",
      rows["Ben Cole"]["avg"] == 57.1 and rows["Cy Dee"]["avg"] == 0.0, (rows["Ben Cole"]["avg"], rows["Cy Dee"]["avg"]))

print("\nCategories, due dates and weights")
r = teacher.post(API, json={"assignment": A, "category": "HW", "due": "2026-11-20"}).get_json()
teacher.post(API, json={"assignment": B, "category": "T"})
check("a column's category and due date are saved", r.get("ok") and r["category"] == "HW" and r["due"] == "2026-11-20", r)
bad = teacher.post(API, json={"assignment": A, "category": "ZZ"})
check("  a category that isn't one of the Skyward list is refused", bad.status_code == 400)
check("  so is a date that isn't one", teacher.post(API, json={"assignment": A, "due": "11/20"}).status_code == 400)
OS, _ = make("Elsewhere", 5)
db = P.SessionLocal()
other_course = accounts.Course(teacher_id=tid, name="P7", app="pyide")
db.add(other_course)
db.commit()
db.query(accounts.ClassItem).filter_by(assignment_id=db.query(accounts.Assignment).filter_by(slug=OS).first().id).update(
    {"class_id": other_course.id})
db.commit()
db.close()
check("  an assignment from another class is refused", teacher.post(API, json={"assignment": OS, "category": "HW"}).status_code == 404)
w = teacher.post(API, json={"weights": {"HW": 40, "T": 60}}).get_json()
page = teacher.get(GB).get_data(as_text=True)
check("weighted: Ava HW 80%, Test 50% -> 0.4*80 + 0.6*50 = 62.0%", w.get("ok") and "62.0%" in page, page.count("%"))
check("  Ben HW missing (0%), Test 100% -> 60.0%", "60.0%" in page)
check("  Extra Practice has no category: shown, marked, not counted", "Not counted: no category" in page)
db = P.SessionLocal()
ava_row = [p for p in P._gradebook(db, db.get(accounts.Course, CID))["students"] if p["name"] == "Ava Reyes"][0]
db.close()
check("  and it's in none of her category averages", set(ava_row["cats"]) == {"HW", "T"}, ava_row["cats"])
check("only the class's teacher changes it", other.post(API, json={"weights": {"HW": 1}}).status_code in (403, 404)
      and other.get(GB).status_code == 404 and ka.post(API, json={"weights": {"HW": 1}}).status_code in (401, 403, 404))
check("  no level buttons cluttering it (they're on the Levels page)", "js-level" not in page)

print("\nA student's own grades")
mine = ka.get("/class/%d/grades" % CID).get_data(as_text=True)
check("Ava sees her average and her scores", "62.0%" in mine and "Strings HW" in mine and "8 / 10" in mine, mine[:300])
check("  and nobody else's", "Ben" not in mine and "Cy Dee" not in mine)
theirs = kb.get("/class/%d/grades" % CID).get_data(as_text=True)
check("Ben sees his: 60.0%, his HW missing", "60.0%" in theirs and "missing" in theirs)
stranger = client(add_user("s", "stranger@example.org", "Stranger Q"))
check("someone not in the class is told it isn't theirs", stranger.get("/class/%d/grades" % CID).status_code == 404)
check("the teacher going there gets the gradebook", teacher.get("/class/%d/grades" % CID).status_code == 302)
check("the student's class page links to it", "/class/%d/grades" % CID in ka.get("/class/%d" % CID).get_data(as_text=True))
check("the teacher's class page links to the gradebook and the Levels page",
      GB in teacher.get("/teacher/class/%d" % CID).get_data(as_text=True)
      and "/teacher/class/%d/levels" % CID in teacher.get("/teacher/class/%d" % CID).get_data(as_text=True))

print("\nExport all to Skyward")
teacher.post(API, json={"assignment": B, "due": "2026-11-21"})
x = teacher.post(API + "/skyward", json={"missing_zero": True}).get_json()
lines = list(csv.reader(io.StringIO(x["csv"])))
check("one file: a row per student per assignment with a category and a due date",
      x["count"] == 6 and len(lines) == 6 and all(len(l) == 7 for l in lines), lines)
check("  Skyward's columns: last, first, assignment, MMDDYYYY, category, max, score",
      ["Reyes", "Ava", "Strings HW", "11202026", "HW", "10", "8"] in lines, lines)
check("  missing work as 0 (Ben's HW)", ["Cole", "Ben", "Strings HW", "11202026", "HW", "10", "0"] in lines, lines)
check("  a name with no first/last kept is guessed and said", "Ben Cole" in x["guessed"], x["guessed"])
check("  an assignment with no category is left out and named", x["skipped"] == ["Extra Practice"], x["skipped"])
check("  Cy, never signed in, still gets a row from the roster's name", any(l[:2] == ["Dee", "Cy"] for l in lines), lines)
y = teacher.post(API + "/skyward", json={"missing_zero": False}).get_json()
check("missing work left out when asked", y["count"] == 3 and "Strings HW" not in [l[2] for l in csv.reader(io.StringIO(y["csv"])) if l[0] == "Cole"],
      y["csv"])
check("only the teacher exports", other.post(API + "/skyward", json={}).status_code in (403, 404))

print("\nHiding an assignment the teacher won't grade")
h = teacher.post(API, json={"assignment": B, "hidden": True}).get_json()
page = teacher.get(GB).get_data(as_text=True)
col = page.split("<tbody>")[0]
check("hidden: its column goes from the gradebook", h.get("ok") and "Strings Test" not in col, col.count("gb-col"))
check("  it's listed under the table with a Show button", "Hidden from the gradebook" in page and 'class="linkbtn small js-show" data-slug="%s"' % B in page)
check("  the averages leave it out: Ava is her HW alone (80.0%)", "80.0%" in page.split("<tbody>")[1].split("</tr>")[0], page.count("%"))
mine = ka.get("/class/%d/grades" % CID).get_data(as_text=True)
check("  the student's own grades leave it out too", "Strings Test" not in mine and "80.0%" in mine)
x = teacher.post(API + "/skyward", json={"missing_zero": True}).get_json()
check("  and so does the Skyward file", "Strings Test" not in x["csv"] and x["count"] == 3, x["csv"])
check("only the teacher hides", ka.post(API, json={"assignment": A, "hidden": True}).status_code in (401, 403, 404)
      and other.post(API, json={"assignment": A, "hidden": True}).status_code in (403, 404))
teacher.post(API, json={"assignment": B, "hidden": False})
page = teacher.get(GB).get_data(as_text=True)
check("Show puts it back, and the average with it (62.0%)", "Strings Test" in page.split("<tbody>")[0] and "62.0%" in page)

print("\nThe assignment page's Download for Skyward shares them")
teacher.post("/api/assignment/%s/skyward" % D, json={"category": "Prj", "due": "2026-12-01"})
page = teacher.get("/teacher/%s" % D).get_data(as_text=True)
check("its category and due date are the gradebook's now", 'value="Prj" selected' in page and 'data-kept="2026-12-01"' in page)
page = teacher.get(GB).get_data(as_text=True)
check("  and the gradebook counts it under Projects", "Not counted: no category" not in page)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
