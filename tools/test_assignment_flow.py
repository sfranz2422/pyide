"""Who gets what when the handout link is opened. Both editors.

    python3 tools/test_assignment_flow.py

One link, `/a/<slug>`, is opened by three different people, and it has to do
three different things:

    a student          their own copy, the same one every time
    nobody (signed out) an editable copy that saves nothing
    the author         the assignment itself, to edit

The third was wrong. The author got a student's copy of their own assignment,
which is a draft — a *copy* — so:

  * it showed up in their project list looking like a duplicate of the
    assignment they had just written;
  * it counted them among the students who had started but not turned in;
  * editing it changed nothing for the class, because students read the
    assignment, not somebody's draft of it.

None of that announces itself. The URL quietly changes from /a/ to /p/, the
code is identical, and the page looks right. It took noticing the duplicate to
find it.

So each of the three openings is checked here for where it lands AND for what
it left behind in the database, because "it redirected" was true the whole time
the behaviour was wrong.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
WEBIDE = os.path.join(os.path.dirname(PYIDE), "webide")

if not os.path.isdir(WEBIDE):
    sys.exit("expected webide/ next to pyide/, found nothing at " + WEBIDE)

DB = os.path.join(tempfile.mkdtemp(), "flow.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, WEBIDE)
import app as W                                              # noqa: E402
import accounts                                              # noqa: E402

sys.path.pop(0)
del sys.modules["app"]
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402


def add_user(sub, email, name):
    db = W.SessionLocal()
    try:
        user = accounts.User(google_sub=sub, email=email, name=name)
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


TEACHER = add_user("t1", "teacher@example.org", "Teacher")
STUDENT = add_user("s1", "kid@example.org", "A Student")

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-52s %s" % ("ok" if condition else "FAIL", label, detail))


def client(module, uid=None):
    c = module.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def drafts_for(module, assignment_slug, owner_id=None):
    """Count the drafts in the database, not what a page happens to say."""
    db = module.SessionLocal()
    try:
        item = db.query(accounts.Assignment).filter_by(
            slug=assignment_slug, app=module.APP_NAME).first()
        q = db.query(accounts.Draft).filter_by(assignment_id=item.id)
        if owner_id is not None:
            q = q.filter_by(owner_id=owner_id)
        return q.count()
    finally:
        db.close()


def run(module, label, starter):
    print("\n%s" % label)
    teacher = client(module, TEACHER)
    student = client(module, STUDENT)
    stranger = client(module)          # signed out

    slug = teacher.post("/api/assignment",
                        json=dict(starter, title=label + " assignment")
                        ).get_json()["slug"]

    # ---- the author -------------------------------------------------------
    r = teacher.get("/a/" + slug)
    check("the author is sent to the assignment, not a copy",
          r.status_code == 302 and r.headers["Location"].endswith(
              "/teacher/" + slug + "/edit"),
          r.headers.get("Location", r.status_code))
    check("and no draft was made for them",
          drafts_for(module, slug, TEACHER) == 0)
    check("the page it lands on opens",
          teacher.get("/teacher/" + slug + "/edit").status_code == 200)

    # ---- the author, deliberately looking at the student's view ------------
    r = teacher.get("/a/" + slug + "?preview=1")
    check("?preview=1 still gives the student's view",
          r.status_code == 302 and "/p/" in r.headers.get("Location", ""),
          r.headers.get("Location", r.status_code))
    check("which does make a draft, as asked",
          drafts_for(module, slug, TEACHER) == 1)

    # ---- a student --------------------------------------------------------
    r = student.get("/a/" + slug)
    check("a student gets their own copy",
          r.status_code == 302 and "/p/" in r.headers.get("Location", ""),
          r.headers.get("Location", r.status_code))
    first = r.headers["Location"]
    again = student.get("/a/" + slug).headers["Location"]
    check("and the same one next time, not a new one", first == again)
    check("exactly one draft for that student",
          drafts_for(module, slug, STUDENT) == 1)

    # ---- signed out -------------------------------------------------------
    before = drafts_for(module, slug)
    r = stranger.get("/a/" + slug)
    check("signed out, the work opens without an account",
          r.status_code == 200)
    check("and saves nothing", drafts_for(module, slug) == before)

    # ---- what the teacher is shown ----------------------------------------
    # Read the "Started but not turned in" list itself, not the whole page:
    # the teacher's own name is in the account menu at the top of every page,
    # so searching the lot would pass no matter what.
    page = teacher.get("/teacher/" + slug).get_data(as_text=True)
    names = page.split("Started but not turned in")[-1].split("</section>")[0]
    check("the student is in 'started but not turned in'",
          "A Student" in names)
    check("the author's own preview draft is not",
          "Teacher" not in names, names.count("<li>") and "names: " +
          " ".join(names.split("<li>")[1:]).replace("</li>", "").split("\n")[0])

    started = teacher.post("/api/assignment/" + slug,
                           json=dict(starter, title=label + " assignment")
                           ).get_json()["already_started"]
    check("the 'already started' count is students only, not the author",
          started == 1, "counted %s" % started)


run(W, "WebIDE", {"files": {"index.html": "<h1>hi</h1>"}})
run(P, "PyIDE", {"code": "print(1)", "files": {}})

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
