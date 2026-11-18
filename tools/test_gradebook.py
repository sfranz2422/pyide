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
# html and body never scroll (style.css); a page's .sheet does. A <main>
# without it held a long class list off the bottom with no way down.
check("  the page scrolls (its main is a .sheet)", '<main class="sheet gradebook-page">' in page
      and '<main class="sheet' in teacher.get("/teacher/class/%d/levels" % CID).get_data(as_text=True)
      and '<main class="sheet' in ka.get("/class/%d/grades" % CID).get_data(as_text=True))
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
stranger_id = add_user("s", "stranger@example.org", "Stranger Q")
stranger = client(stranger_id)
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
check("only the teacher exports", other.post(API + "/skyward", json={}).status_code in (403, 404))

print("\nNever twice to Skyward (its import always makes a NEW assignment)")
page = teacher.get(GB).get_data(as_text=True)
check("sent assignments say so in their column", page.count("class=\"small gb-sent\"") == 2, page.count("gb-sent"))
y = teacher.post(API + "/skyward", json={"missing_zero": True}).get_json()
check("exporting again sends nothing already there", y["count"] == 0 and sorted(y["already"]) == ["Strings HW", "Strings Test"], y)
teacher.post(API + "/skyward/mark", json={"assignment": A, "sent": False})
y = teacher.post(API + "/skyward", json={"missing_zero": False}).get_json()
check("Send again puts one back in the next file — and missing work left out when asked",
      y["count"] == 1 and [l[2] for l in csv.reader(io.StringIO(y["csv"]))] == ["Strings HW"], y["csv"])
db = P.SessionLocal()
db.query(P.SkywardSent).delete()
db.commit()
db.close()
m = teacher.post(API + "/skyward/mark", json={"all": True}).get_json()
check("Mark all as already in Skyward: every column counts as sent", m.get("marked") == 3
      and teacher.post(API + "/skyward", json={}).get_json()["count"] == 0, m)
check("  only the teacher marks", other.post(API + "/skyward/mark", json={"all": True}).status_code in (403, 404))

print("\nTyping a grade into a cell")
SC = API + "/score"
r = teacher.post(SC, json={"assignment": A, "student": ben, "score": "7"}).get_json()
db = P.SessionLocal()
sub = db.query(accounts.Submission).filter_by(assignment_id=aid, student_id=ben).first()
db.close()
check("a missing cell typed 7: kept as his grade (a submission made for it)", r.get("ok") and r["total"] == "7"
      and sub is not None and sub.score == 7, r)
page = teacher.get(GB).get_data(as_text=True)
check("  his average moves: HW 70%, Test 100% -> 0.4*70 + 0.6*100 = 88.0%", "88.0%" in page)
check("  and it was sent to Skyward as 0: the cell says it changed (△, sent: 0)",
      'title="Changed since it was sent to Skyward (sent: 0)' in page and 'data-student="%d"' % ben in page.split("gb-changed js-updated", 1)[-1][:200],
      page.count("gb-changed"))
check("  the cell is a box with the grade in it", 'value="7"' in page and 'data-student="%d"' % ben in page)
# Points the checks earned count in the total: the number typed IS the total.
db = P.SessionLocal()
db.add(accounts.TestResult(assignment_id=aid, student_id=ava, kind="verified", earned=3, possible=3, details="[]"))
db.commit()
db.close()
r = teacher.post(SC, json={"assignment": A, "student": ava, "score": "9"}).get_json()
db = P.SessionLocal()
s_ava = db.query(accounts.Submission).filter_by(assignment_id=aid, student_id=ava).first().score
db.close()
check("a total typed over checked points: 9 = 3 from the tests + 6 of the teacher's", r["total"] == "9" and s_ava == 6, (r, s_ava))
r = teacher.post(SC, json={"assignment": A, "student": ava, "score": ""}).get_json()
check("  emptied: the teacher's score goes, the tests' 3 stay", r["total"] == "3" and r["score"] == "", r)
teacher.post(SC, json={"assignment": A, "student": ava, "score": "8"})
# △ clicked: the teacher typed the new score into Skyward, so it's cleared —
# that student's only; then the column's "All typed into Skyward".
def changed_in(page):
    return page.count('class="gb-changed js-updated"')
teacher.post(SC, json={"assignment": A, "student": ava, "score": "5"})
page = teacher.get(GB).get_data(as_text=True)
before = changed_in(page)
check("two changed scores in the column (Ben's 7, Ava's 5), and the column offers to clear them all",
      before == 2 and "All typed into Skyward" in page, before)
u = teacher.post(API + "/skyward/mark", json={"assignment": A, "updated": True, "student": str(ben)})
page = teacher.get(GB).get_data(as_text=True)
check("△ clicked for Ben: his clears, Ava's stays", u.status_code == 200 and changed_in(page) == 1
      and 'data-student="%d"' % ava in page.split("gb-changed js-updated", 1)[-1][:200], changed_in(page))
check("  and what Skyward has is his 7 now: still left out of the next export",
      teacher.post(API + "/skyward", json={}).get_json()["count"] == 0)
check("  only the teacher clears", other.post(API + "/skyward/mark",
      json={"assignment": A, "updated": True}).status_code in (403, 404))
teacher.post(API + "/skyward/mark", json={"assignment": A, "updated": True})
page = teacher.get(GB).get_data(as_text=True)
check("the column's All typed into Skyward clears the rest", changed_in(page) == 0
      and "All typed into Skyward" not in page, changed_in(page))
teacher.post(SC, json={"assignment": A, "student": ava, "score": "9"})
check("  a later change gets a △ again", changed_in(teacher.get(GB).get_data(as_text=True)) == 1)
teacher.post(SC, json={"assignment": A, "student": ava, "score": "8"})
check("a word isn't a grade", teacher.post(SC, json={"assignment": A, "student": ava, "score": "ten"}).status_code == 400)
check("a student who isn't in the class can't be given one",
      teacher.post(SC, json={"assignment": A, "student": stranger_id, "score": "5"}).status_code == 404)
check("only the class's teacher types grades",
      other.post(SC, json={"assignment": A, "student": ava, "score": "1"}).status_code in (403, 404)
      and ka.post(SC, json={"assignment": A, "student": ava, "score": "10"}).status_code in (401, 403, 404))
db = P.SessionLocal()
s_ava = db.query(accounts.Submission).filter_by(assignment_id=aid, student_id=ava).first().score
db.close()
check("  (Ava's is still the teacher's: 8 = 3 + 5)", s_ava == 5, s_ava)

print("\nTests not checked yet")
T_ = teacher.post("/api/assignment", json={"title": "Loop Lab", "code": "x = 0\n",
                                             "files": {"notes.md": "# L\n```tests\nprints hi    (4 points)\n```\n"}}).get_json()["slug"]
db = P.SessionLocal()
tl = db.query(accounts.Assignment).filter_by(slug=T_).first()
db.add(accounts.ClassItem(class_id=CID, assignment_id=tl.id, hidden=0, position=-999))
db.add(accounts.Submission(assignment_id=tl.id, student_id=ava, snippet_slug="snap1", times_submitted=1,
                           submitted_at=P.datetime(2026, 11, 17, 10, 0)))
db.commit()
tlid = tl.id
db.close()
page = teacher.get(GB).get_data(as_text=True)
check("turned-in code the teacher hasn't checked is marked ⟳, with the points pending",
      'class="gb-unchecked"' in page and "4 points pending" in page, page.count("gb-unchecked"))
check("  and its column has a Check all button", 'class="btn small js-checkall" data-slug="%s"' % T_ in page)
check("  a column with no tests has none", 'js-checkall" data-slug="%s"' % A not in page)
check("  the student's own grades say so too", "tests not graded yet" in ka.get("/class/%d/grades" % CID).get_data(as_text=True))
db = P.SessionLocal()
db.add(accounts.TestResult(assignment_id=tlid, student_id=ava, kind="verified", earned=4, possible=4, details="[]",
                           checked_at=P.datetime(2026, 11, 17, 11, 0)))
db.commit()
db.close()
page = teacher.get(GB).get_data(as_text=True)
check("checked after the turn-in: no ⟳", 'class="gb-unchecked"' not in page)
db = P.SessionLocal()
db.query(accounts.Submission).filter_by(assignment_id=tlid, student_id=ava).update(
    {"submitted_at": P.datetime(2026, 11, 17, 12, 0)})
db.commit()
db.close()
check("  turned in again since: ⟳ again", 'class="gb-unchecked"' in teacher.get(GB).get_data(as_text=True))
apage = teacher.get("/teacher/%s?checkall=1" % T_).get_data(as_text=True)
check("the assignment page runs Check all by itself when the gradebook opens it, and tells the gradebook",
      "checkall=1" in apage and 'type: "pyide-checked"' in apage and "btn.click()" in apage)
teacher.post(API, json={"assignment": T_, "hidden": True})

print("\nHiding an assignment the teacher won't grade")
h = teacher.post(API, json={"assignment": B, "hidden": True}).get_json()
page = teacher.get(GB).get_data(as_text=True)
col = page.split('<table class="gradebook">')[1].split("<tbody>")[0]
check("hidden: its column goes from the gradebook", h.get("ok") and "Strings Test" not in col, col.count("gb-col"))
check("  it's listed in its own box (one per line, scrolling) with a Show button",
      'class="gb-hidden-list"' in page and "Hidden from the gradebook" in page and 'class="linkbtn small js-show" data-slug="%s"' % B in page)
check("  the averages leave it out: Ava is her HW alone (80.0%)", "80.0%" in page.split("<tbody>")[1].split("</tr>")[0], page.count("%"))
mine = ka.get("/class/%d/grades" % CID).get_data(as_text=True)
check("  the student's own grades leave it out too", "Strings Test" not in mine and "80.0%" in mine)
teacher.post(API + "/skyward/mark", json={"assignment": A, "sent": False})
teacher.post(API + "/skyward/mark", json={"assignment": B, "sent": False})
x = teacher.post(API + "/skyward", json={"missing_zero": True}).get_json()
check("  and so does the Skyward file", "Strings Test" not in x["csv"] and x["count"] == 3, x["csv"])
check("only the teacher hides", ka.post(API, json={"assignment": A, "hidden": True}).status_code in (401, 403, 404)
      and other.post(API, json={"assignment": A, "hidden": True}).status_code in (403, 404))
teacher.post(API, json={"assignment": B, "hidden": False})
page = teacher.get(GB).get_data(as_text=True)
check("Show puts it back, and the average with it (62.0%)",
      "Strings Test" in page.split('<table class="gradebook">')[1].split("<tbody>")[0] and "62.0%" in page
      and 'js-show" data-slug="%s"' % B not in page)

print("\nDue dates follow showing")
N_, nid = make("Shown Later", 5, hidden=True)
db = P.SessionLocal()
ci = db.query(accounts.ClassItem).filter_by(assignment_id=nid).first().id
db.close()
teacher.post("/api/class/%d/item/%d" % (CID, ci), json={"hidden": False})
db = P.SessionLocal()
g = db.query(P.AssignmentGrade).filter_by(assignment_id=nid).first()
db.close()
check("showing an assignment makes that day (school time) its gradebook due date",
      g is not None and g.due == P._school_today(), g and g.due)
teacher.post(API, json={"assignment": N_, "due": "2026-12-25"})
teacher.post("/api/class/%d/item/%d" % (CID, ci), json={"hidden": True})
teacher.post("/api/class/%d/item/%d" % (CID, ci), json={"hidden": False})
db = P.SessionLocal()
g = db.query(P.AssignmentGrade).filter_by(assignment_id=nid).first()
db.close()
check("  a due date the teacher set isn't changed by showing it again", g.due == "2026-12-25", g.due)
db = P.SessionLocal()
book = P._gradebook(db, db.get(accounts.Course, CID))
d_col = [a for a in book["assignments"] if a["slug"] == D][0]
db.close()
check("an assignment shown before this kept no date: the day it was made",
      d_col["due"] == P._school_today(), d_col["due"])
page = teacher.get(GB).get_data(as_text=True)
teacher.post(API, json={"assignment": N_, "hidden": True})
page = teacher.get(GB).get_data(as_text=True)
check("hidden assignments are a closed pane at the bottom, below the table",
      '<details class="card gb-hidden">' in page and page.index('<details class="card gb-hidden">') > page.index('<table class="gradebook">'))

print("\nThe assignment page's Download for Skyward shares them")
teacher.post(API + "/skyward/mark", json={"assignment": D, "sent": False})
teacher.post("/api/assignment/%s/skyward" % D, json={"category": "Prj", "due": "2026-12-01"})
db = P.SessionLocal()
d_sent = db.query(P.SkywardSent).filter_by(class_id=CID, assignment_id=did).first()
db.close()
check("its file counts as sent too, so the gradebook's Export won't send it again", d_sent is not None, d_sent)
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
