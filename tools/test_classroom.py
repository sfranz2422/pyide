#!/usr/bin/env python3
"""Connecting a teacher's Google Classroom.

    python3 tools/test_classroom.py

Needs `cryptography` (pip install -r requirements.txt): the stored token is
encrypted, and checking that is half the point of this file.

WHY THIS FILE EXISTS

The connection is a credential that can post to a teacher's classes and
grade them, kept for weeks. The ways of getting it wrong are all quiet:

  * stored in the clear, a copy of the database is a key to every
    connected teacher's Classroom;
  * a teacher who unticks one box on Google's consent screen gets a token
    that works today and fails the day grades are sent;
  * a teacher who picks their personal Gmail from the account chooser
    connects classes that are not the ones they teach here;
  * a token Google has stopped honouring makes the dashboard fail the same
    way forever, unless it is forgotten so Connect is offered again;
  * a student must never be shown any of this.

Google is never called. `_google_post` and `_google_get` are the only two
functions in app.py that reach it, and both are replaced here.
"""
import os
import sys
import tempfile
from urllib.parse import parse_qs, urlparse

try:
    import cryptography                                      # noqa: F401
except ImportError:
    sys.exit("test_classroom.py needs `cryptography`: pip install -r requirements.txt")

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

DB = os.path.join(tempfile.mkdtemp(), "classroom.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
os.environ.pop("GOOGLE_CLIENT_ID", None)
os.environ.pop("GOOGLE_CLIENT_SECRET", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-58s %s" % ("ok" if condition else "FAIL", label, detail))


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        user = accounts.User(google_sub=sub, email=email, name=name)
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def link_row():
    db = P.SessionLocal()
    try:
        return db.query(accounts.ClassroomLink).filter_by(user_id=TEACHER).first()
    finally:
        db.close()


# ------------------------------------------------------------ a fake Google
ALL = " ".join(P.CLASSROOM_SCOPES)
google = {"email": "teacher@school.org", "scope": ALL, "refresh": 200,
          "refresh_error": "", "courses": 200}
calls = []


def fake_post(url, data):
    calls.append(("POST", url, dict(data)))
    if url == P.GOOGLE_TOKEN_URL and data.get("grant_type") == "authorization_code":
        return 200, {"access_token": "AT-1", "refresh_token": "RT-secret",
                     "scope": google["scope"]}
    if url == P.GOOGLE_TOKEN_URL and data.get("grant_type") == "refresh_token":
        if google["refresh_error"]:
            return 400, {"error": google["refresh_error"]}
        return google["refresh"], {"access_token": "AT-2"}
    if url == P.GOOGLE_REVOKE_URL:
        return 200, {}
    return 404, {}


def fake_get(url, token, params=None):
    calls.append(("GET", url, token))
    if url == P.GOOGLE_USERINFO_URL:
        return 200, {"email": google["email"]}
    if url == P.CLASSROOM_API + "/courses":
        if google["courses"] != 200:
            return 403, {"error": {"message": "Google Classroom API has not been "
                                              "used in project 123 or it is disabled."}}
        return 200, {"courses": [
            {"id": "c1", "name": "Programming 1", "section": "Period 2",
             "alternateLink": "https://classroom.google.com/c/c1"},
            {"id": "c2", "name": "Intro to Programming", "section": ""}]}
    return 404, {}


# The Classroom side of the fake: one class, a roster split over two pages
# (a second page silently dropped would be students silently ungraded), and
# whatever coursework PyIDE creates.
room = {"work": None, "gone": False, "patches": [],
        "roster": [[{"userId": "u-other", "profile": {"emailAddress": "someone@school.org"}}],
                   [{"userId": "u-kid", "profile": {"emailAddress": "KID1@school.org"}},
                    {"userId": "u-kid3", "profile": {"emailAddress": "kid3@school.org"}}]]}


def fake_classroom_get(url, params):
    base = P.CLASSROOM_API + "/courses/123456"
    if url == base:
        return 200, {"id": "123456", "name": "Programming 1"}
    if url == base + "/students":
        page = int(params.get("pageToken") or 0)
        data = {"students": room["roster"][page]}
        if page + 1 < len(room["roster"]):
            data["nextPageToken"] = str(page + 1)
        return 200, data
    if room["work"] and url == base + "/courseWork/w1/studentSubmissions":
        if room["gone"]:
            return 404, {"error": {"message": "Requested entity was not found."}}
        return 200, {"studentSubmissions": [
            {"id": "s-other", "userId": "u-other"}, {"id": "s-kid", "userId": "u-kid"},
            {"id": "s-kid3", "userId": "u-kid3"}]}
    return None


def fake_api(method, url, token, body=None, params=None):
    calls.append((method, url, token, body, params))
    if method == "POST" and url == P.CLASSROOM_API + "/courses/123456/courseWork":
        room["work"] = body
        return 200, {"id": "w1", "alternateLink": "https://classroom.google.com/c/123456/a/w1"}
    if method == "PATCH" and "/studentSubmissions/" in url:
        room["patches"].append((url.rsplit("/", 1)[1], body, params))
        return 200, {}
    if method == "PATCH" and url.endswith("/courseWork/w1"):
        return 200, {}
    return 404, {}


_plain_get = fake_get


def fake_get_all(url, token, params=None):
    hit = fake_classroom_get(url, params or {})
    if hit is not None:
        calls.append(("GET", url, token))
        return hit
    return _plain_get(url, token, params)


P._google_post = fake_post
P._google_get = fake_get_all
P._google_api = fake_api


def revoked():
    return [c for c in calls if c[0] == "POST" and c[1] == P.GOOGLE_REVOKE_URL]


TEACHER = add_user("t1", "teacher@school.org", "Mr Franz")
STUDENT = add_user("s1", "kid@school.org", "A Student")
teacher = client(TEACHER)
student = client(STUDENT)
stranger = client()


# ------------------------------------------------------- with Google unset
print("\nWith no Google sign-in configured")

check("there is no Connect route", teacher.get("/classroom/connect").status_code == 404)
check("  and no Classroom box on the dashboard",
      "Google Classroom" not in teacher.get("/teacher").get_data(as_text=True))

os.environ["GOOGLE_CLIENT_ID"] = "client-id"
os.environ["GOOGLE_CLIENT_SECRET"] = "client-secret"


# --------------------------------------------------------------- connecting
print("\nConnecting")

page = teacher.get("/teacher").get_data(as_text=True)
check("a teacher's dashboard offers Connect Google Classroom",
      "Connect Google Classroom" in page)
check("a student cannot start it", student.get("/classroom/connect").status_code == 404)
r = stranger.get("/classroom/connect")
check("  nor someone signed out, who is sent to sign in",
      r.status_code == 302 and "/login" in r.headers["Location"])

r = teacher.get("/classroom/connect")
to = urlparse(r.headers.get("Location", ""))
q = {k: v[0] for k, v in parse_qs(to.query).items()}
check("a teacher is sent to Google's consent screen",
      r.status_code == 302 and to.netloc == "accounts.google.com", to.netloc)
# Written out, not read from app.py: compared with its own list, this check
# could never fail. Each one is needed by a later step — listing classes,
# posting work and grading it, finding the students, matching them by email.
WANTED = {
    "openid", "email",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.profile.emails",
}
check("  asking for every Classroom permission at once",
      set(q.get("scope", "").split()) == WANTED, q.get("scope"))
check("  offline, so grades can be sent later",
      q.get("access_type") == "offline" and q.get("prompt") == "consent")
check("  with the account chooser on their school address",
      q.get("login_hint") == "teacher@school.org")
check("  and back to /classroom/callback",
      q.get("redirect_uri", "").endswith("/classroom/callback"))
with teacher.session_transaction() as s:
    state = s.get("classroom_state")
check("  with a state only this browser knows", state and q.get("state") == state)

src = open(os.path.join(PYIDE, "app.py")).read()
check("students' sign-in still asks for nothing more than it did",
      'client_kwargs={"scope": "openid email profile"}' in src)


def callback(c, **args):
    with c.session_transaction() as s:
        s["classroom_state"] = "S"
    args.setdefault("state", "S")
    return c.get("/classroom/callback", query_string=args)


r = teacher.get("/classroom/callback", query_string={"state": "forged", "code": "x"})
check("a reply that did not start in this browser is refused",
      r.status_code == 400 and link_row() is None, r.status_code)

r = callback(teacher, error="admin_policy_enforced")
check("a school admin's block is explained, and who to ask",
      r.status_code == 400 and "IT department" in r.get_data(as_text=True))
check("  on a page about Classroom, not about signing in",
      "Connect again" in r.get_data(as_text=True)
      and "without signing in" not in r.get_data(as_text=True))
r = callback(teacher, error="access_denied")
check("pressing Cancel on Google's screen is explained",
      "allow PyIDE to use your Classroom" in r.get_data(as_text=True))

google["scope"] = "openid email https://www.googleapis.com/auth/classroom.courses.readonly"
calls.clear()
r = callback(teacher, code="abc")
check("a token with a box unticked is refused, and why",
      r.status_code == 400 and "leave all the boxes ticked" in r.get_data(as_text=True))
check("  and nothing is stored", link_row() is None)
check("  and Google is told to forget it", len(revoked()) == 1)
google["scope"] = ALL

google["email"] = "mrfranz.personal@gmail.com"
calls.clear()
r = callback(teacher, code="abc")
check("connecting a different Google account is refused",
      r.status_code == 400 and "mrfranz.personal@gmail.com" in r.get_data(as_text=True))
check("  and nothing is stored, and Google is told to forget it",
      link_row() is None and len(revoked()) == 1)
google["email"] = "Teacher@School.org"          # Google may differ in case

r = callback(teacher, code="abc")
check("the right account, everything ticked: connected",
      r.status_code == 302 and "classroom=connected" in r.headers["Location"],
      r.status_code)
row = link_row()
check("  a link is stored for this teacher", row is not None)
check("  and the token in the database is not the token",
      row is not None and "RT-secret" not in row.refresh_token)
check("    but decrypts to it",
      row is not None
      and P._token_box().decrypt(row.refresh_token.encode()).decode() == "RT-secret")

page = teacher.get("/teacher?classroom=connected").get_data(as_text=True)
check("the dashboard says which account is connected",
      "Connected as <strong>Teacher@School.org</strong>" in page)


# ------------------------------------------------------------ their classes
print("\nTheir classes")

r = teacher.get("/api/classroom/courses")
names = [c["name"] for c in (r.get_json() or {}).get("courses", [])]
check("a connected teacher's classes are listed",
      names == ["Programming 1", "Intro to Programming"], names)
check("  using a fresh access token, not the stored one",
      ("GET", P.CLASSROOM_API + "/courses", "AT-2") in calls)
check("a student cannot list them",
      student.get("/api/classroom/courses").status_code == 403)

google["courses"] = 403
r = teacher.get("/api/classroom/courses")
check("Google's own reason reaches the teacher when it refuses",
      r.status_code == 502 and "has not been used in project"
      in (r.get_json() or {}).get("error", ""))
google["courses"] = 200

google["refresh_error"] = "invalid_grant"
r = teacher.get("/api/classroom/courses")
check("a token Google stopped honouring is forgotten",
      r.status_code == 409 and link_row() is None, r.status_code)
check("  so the dashboard offers Connect again",
      "Connect Google Classroom" in teacher.get("/teacher").get_data(as_text=True))
google["refresh_error"] = ""

callback(teacher, code="abc")
P.app.secret_key = "a different key entirely, as after a rotation"
# A new key signs everyone out too, so the teacher signs in again first.
r = client(TEACHER).get("/api/classroom/courses")
check("after SECRET_KEY changes, the unreadable token is forgotten",
      r.status_code == 409 and link_row() is None, r.status_code)
P.app.secret_key = "k" * 32


# ------------------------------------------------------------ disconnecting
print("\nDisconnecting")

callback(teacher, code="abc")
calls.clear()
r = teacher.post("/classroom/disconnect")
check("Disconnect forgets the connection", link_row() is None)
check("  and withdraws it at Google too",
      len(revoked()) == 1 and revoked()[0][2].get("token") == "RT-secret")
callback(teacher, code="abc")
check("a student's Disconnect touches nothing",
      student.post("/classroom/disconnect").status_code == 404
      and link_row() is not None)

# -------------------------------------------------- posting and sending grades
print("\nPosting to Classroom and sending grades")

hw = teacher.post("/api/assignment", json={
    "code": "# starter\n", "files": {}, "title": "Loops"}).get_json()["slug"]
KIDS = {}
for n, email in enumerate(["kid1@school.org", "kid2@school.org", "kid3@school.org"]):
    uid = add_user("k%d" % n, email, "Kid %d" % (n + 1))
    kid = client(uid)
    kid.get("/a/%s" % hw)
    db = P.SessionLocal()
    d = db.query(accounts.Draft).filter_by(owner_id=uid).first()
    db.close()
    kid.post("/api/submit", json={"draft": d.slug, "code": "print(%d)\n" % n, "files": {}})
    KIDS[email] = uid


def sub_of(email):
    db = P.SessionLocal()
    try:
        return db.query(accounts.Submission).filter_by(student_id=KIDS[email]).first()
    finally:
        db.close()


def assignment():
    db = P.SessionLocal()
    try:
        return db.query(accounts.Assignment).filter_by(slug=hw).first()
    finally:
        db.close()


POST = "/api/assignment/%s/classroom/post" % hw
SYNC = "/api/assignment/%s/classroom/sync" % hw

page = teacher.get("/teacher/%s" % hw).get_data(as_text=True)
check("a connected teacher's assignment page offers Post to Classroom",
      'id="gc-post"' in page)
r = teacher.post(POST, json={"course": "123456"})
check("it cannot be posted before it has points",
      r.status_code == 400 and "out of" in r.get_json()["error"], r.status_code)
teacher.post("/api/assignment/%s/out-of" % hw, json={"out_of": 10})
check("a student cannot post it", student.post(POST, json={"course": "123456"}).status_code == 403)
r = teacher.post(POST, json={"course": "../evil"})
check("a class id that is not one is refused", r.status_code == 400)

calls.clear()
r = teacher.post(POST, json={"course": "123456"})
check("the teacher posts it to Programming 1", r.status_code == 200
      and r.get_json().get("course") == "Programming 1", r.get_data(as_text=True)[:90])
w = room["work"] or {}
check("  as a published assignment worth 10 points",
      w.get("state") == "PUBLISHED" and w.get("workType") == "ASSIGNMENT"
      and w.get("maxPoints") == 10, w)
link = ((w.get("materials") or [{}])[0].get("link") or {}).get("url", "")
check("  carrying the link students open it from",
      link.endswith("/a/%s" % hw), link)
a = assignment()
check("  and it remembers where it went",
      (a.classroom_course_id, a.classroom_work_id, a.classroom_course_name)
      == ("123456", "w1", "Programming 1"))
r = teacher.post(POST, json={"course": "123456"})
check("posting twice is refused, so the class never sees two",
      r.status_code == 409 and room["work"] is not None)
page = teacher.get("/teacher/%s" % hw).get_data(as_text=True)
check("the page then says where it is, and offers Sync",
      "Programming 1" in page and 'id="gc-sync"' in page)

calls.clear()
teacher.post("/api/assignment/%s/out-of" % hw, json={"out_of": 20})
patch = [c for c in calls if c[0] == "PATCH" and c[1].endswith("/courseWork/w1")]
check("changing the points changes them in Classroom too",
      patch and patch[0][3] == {"maxPoints": 20}
      and patch[0][4] == {"updateMask": "maxPoints"}, patch)

FB = "/api/assignment/%s/feedback" % hw
teacher.post(FB, json={"submission": sub_of("kid1@school.org").id,
                       "feedback": "", "score": "17"})
teacher.post(FB, json={"submission": sub_of("kid2@school.org").id,
                       "feedback": "", "score": "15"})
# kid3 is in the Classroom class but not scored, and must not be sent as
# anything — least of all 0, or a blank that wipes a grade typed there.

r = teacher.post(SYNC)
out = r.get_json() or {}
check("Sync sends the scores", r.status_code == 200 and out.get("sent") == 1, out)
check("  as draft grades, matched by email whatever its case",
      room["patches"] == [("s-kid", {"draftGrade": 17.0}, {"updateMask": "draftGrade"})],
      room["patches"])
check("  finding them on the roster's second page", "s-kid" in str(room["patches"]))
check("  naming the student who is not in the Classroom class",
      out.get("unmatched") == ["Kid 2"], out.get("unmatched"))
check("  and sending nothing for the one with no score",
      len(room["patches"]) == 1)
check("  and remembering what went", sub_of("kid1@school.org").score_synced == 17.0)
page = teacher.get("/teacher/%s" % hw).get_data(as_text=True)
check("the page shows it is in Classroom",
      '<span class="fb-sync small">✓ in Classroom</span>' in page)
teacher.post(FB, json={"submission": sub_of("kid1@school.org").id,
                       "feedback": "", "score": "18"})
page = teacher.get("/teacher/%s" % hw).get_data(as_text=True)
check("  and that a changed score is not, until the next Sync",
      '<span class="fb-sync small">not in Classroom yet</span>' in page)

check("a student cannot sync", student.post(SYNC).status_code == 403)

room["gone"] = True
r = teacher.post(SYNC)
check("an assignment deleted in Classroom is said so",
      r.status_code == 409 and "gone from Google Classroom" in r.get_json()["error"])
check("  and forgotten, so it can be posted again",
      assignment().classroom_work_id == ""
      and 'id="gc-post"' in teacher.get("/teacher/%s" % hw).get_data(as_text=True))


# ---------------------------------------------------------- the policy page
print("\nThe privacy policy")

# Google's consent screen links here and will not publish the app without it,
# so a broken /privacy is a Classroom connection nobody can make.
r = stranger.get("/privacy")
text = r.get_data(as_text=True)
check("/privacy is public", r.status_code == 200, r.status_code)
check("  names all three editors", all(h in text for h in (
    "pyide-mdfd.onrender.com", "webide-4kiy.onrender.com", "flaskide.onrender.com")))
check("  and makes Google's Limited Use statement",
      "Limited Use" in text and "api-services-user-data-policy" in text)

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
