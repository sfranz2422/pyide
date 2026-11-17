"""The class, live: steps passed, guesses, hands, the countdown and the party.

Run: python3 tools/test_live_class.py

Live mode was made "more interesting for the kids" (Nov 2026, the teacher's
request): a student's page says when they pass a step's check, what they
first predicted, and "I'm stuck" / "I'm done"; the teacher's editor asks
for the class's side of it (/api/live/<code>/class) and shows it on the
cards, under each prediction and on the projector; it starts a countdown
and calls a celebration when the whole class has passed a step, which
reach the class on the poll they already make (/api/live/<code>/extra).

This pins the server: who may say and who may ask; that nobody counts
twice; that counts are of the students here now (attendance) and never
carry a name; that a "done" counts only on the slide it was said on; that
the party is checked against the class, not taken on the page's word, and
pays each who passed once; that the timer and the party ride the lesson's
version to the class.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "liveclass.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org,other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-66s %s" % ("ok" if condition else "FAIL", label, detail))


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def here(class_id, uid):
    db = P.SessionLocal()
    try:
        db.add(accounts.Visit(class_id=class_id, user_id=uid))
        db.commit()
    finally:
        db.close()


print("The class, live")
tid = add_user("t", "teacher@example.org", "Teach")
oid = add_user("o", "other@example.org", "Other")
kids = [add_user("k%d" % i, "kid%d@example.org" % i, "Kid %d" % i) for i in range(3)]
away = add_user("away", "away@example.org", "Away Kid")
teacher = client(tid)
slug = teacher.post("/api/assignment", json={"title": "Strings", "code": "# x\n",
                                             "files": {"notes.md": "# Notes\n"}}).get_json()["slug"]
db = P.SessionLocal()
item = db.query(accounts.Assignment).filter_by(slug=slug).first()
course = accounts.Course(teacher_id=tid, name="P4")
db.add(course)
db.commit()
db.add(accounts.ClassItem(class_id=course.id, assignment_id=item.id))
db.commit()
cid = course.id
db.close()
for k in kids:
    here(cid, k)
code = teacher.post("/api/live/start", json={"assignment": slug, "body": "# x\n",
                                              "filename": "main.py"}).get_json()["code"]
teacher.post("/api/live/%s/push" % code, json={"body": "# x\n", "filename": "main.py",
                                               "notes": "# a\n---\n# b\n", "slide": "1/2", "seq": 100})
k0, k1, k2 = (client(k) for k in kids)

# ---- who may say, who may ask
anon = client().post("/api/live/%s/signal" % code, json={"kind": "step", "key": "abc"})
check("a signed-out page's signal counts for nothing", anon.get_json().get("ok") is False, anon.get_json())
check("a student can't ask for the class's side", k0.get("/api/live/%s/class" % code).status_code == 404)
check("  nor another teacher", client(oid).get("/api/live/%s/class" % code).status_code == 404)
check("  nor start the countdown", k0.post("/api/live/%s/extra" % code, json={"timer": 60, "seq": 200}).status_code == 403)
check("a bad step key is refused", k0.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "<x>"}).status_code == 400)
check("a bad hand is refused", k0.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": "sleepy"}).status_code == 400)

# ---- steps, in the order the class finished them
r0 = k0.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s1"}).get_json()
r1 = k1.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s1"}).get_json()
again = k0.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s1"}).get_json()
check("the first to pass a step is told #1, the next #2", r0.get("rank") == 1 and r1.get("rank") == 2, (r0, r1))
check("  and passing it again changes nothing: still #1", again.get("rank") == 1, again)
cls = teacher.get("/api/live/%s/class" % code).get_json()
check("the teacher sees 2 of the 3 here have passed it", cls["steps"].get("s1") == 2 and cls["here"] == 3, cls)
client(away).post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s1"})
cls = teacher.get("/api/live/%s/class" % code).get_json()
check("  a student not here (no attendance) isn't counted", cls["steps"].get("s1") == 2, cls["steps"])
check("  and no name is anywhere in it", "Kid" not in str(cls) and "kid" not in str(cls), cls)

# ---- guesses: first only, charted, right ones marked
k0.post("/api/live/%s/signal" % code, json={"kind": "guess", "key": "p1", "value": "MAPLE", "right": False})
k0.post("/api/live/%s/signal" % code, json={"kind": "guess", "key": "p1", "value": "maple", "right": True})
k1.post("/api/live/%s/signal" % code, json={"kind": "guess", "key": "p1", "value": " maple ", "right": True})
k2.post("/api/live/%s/signal" % code, json={"kind": "guess", "key": "p1", "value": "maple", "right": True})
g = teacher.get("/api/live/%s/class" % code).get_json()["guesses"].get("p1") or {}
top = {t["text"]: (t["n"], t["right"]) for t in g.get("top", [])}
check("the class's first guesses are charted: 2 said maple (right), 1 MAPLE",
      g.get("n") == 3 and top.get("maple") == (2, True) and top.get("MAPLE") == (1, False), g)
check("  a second guess never replaces the first", top.get("MAPLE") == (1, False), top)

# ---- hands: counts only; done is for the slide it was said on
k0.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": "stuck"})
k1.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": "done"})
k2.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": "done"})
cls = teacher.get("/api/live/%s/class" % code).get_json()
check("1 stuck and 2 done, as counts", cls["stuck"] == 1 and cls["done"] == 2, (cls["stuck"], cls["done"]))
k0.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": "done"})
cls = teacher.get("/api/live/%s/class" % code).get_json()
check("  saying done takes that student's stuck down", cls["stuck"] == 0 and cls["done"] == 3, (cls["stuck"], cls["done"]))
k1.post("/api/live/%s/signal" % code, json={"kind": "hand", "value": ""})
check("  and a hand can be taken down", teacher.get("/api/live/%s/class" % code).get_json()["done"] == 2)
teacher.post("/api/live/%s/push" % code, json={"body": "# x\n", "filename": "main.py",
                                               "notes": "# a\n---\n# b\n", "slide": "2/2", "seq": 300})
cls = teacher.get("/api/live/%s/class" % code).get_json()
check("the teacher moving on clears done (it was said on the last slide)", cls["done"] == 0, cls["done"])

# ---- the countdown rides the version to the class
before = k0.get("/api/live/%s?v=300" % code)
check("the class's poll is a 304 with nothing new", before.status_code == 304, before.status_code)
t = teacher.post("/api/live/%s/extra" % code, json={"timer": 180, "seq": 400})
check("the teacher starts a 3-minute countdown", t.status_code == 200, t.get_json())
polled = k0.get("/api/live/%s?v=300" % code)
pj = polled.get_json() or {}
check("  the class's next poll has it, about 180 s left of 180",
      polled.status_code == 200 and 170_000 < pj.get("timer_left", 0) <= 180_000 and pj.get("timer_total") == 180, pj.get("timer_left"))
teacher.post("/api/live/%s/extra" % code, json={"timer": 0, "seq": 500})
check("  and stopping it says 0 left", k0.get("/api/live/%s?v=400" % code).get_json().get("timer_left") == 0)
big = teacher.post("/api/live/%s/extra" % code, json={"timer": 99999, "seq": 510})
check("  a countdown longer than an hour is cut to an hour",
      k0.get("/api/live/%s?v=500" % code).get_json().get("timer_total") == 3600, big.get_json())

# ---- the party: checked against the class, paid once each
early = teacher.post("/api/live/%s/extra" % code, json={"party": "s1", "seq": 600})
check("no party while one student here hasn't passed the step", early.status_code == 409, early.get_json())
k2.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s1"})
party = teacher.post("/api/live/%s/extra" % code, json={"party": "s1", "seq": 700})
check("once all 3 here have, the party is on, and 3 are paid",
      party.status_code == 200 and party.get_json().get("paid") == 3, party.get_json())
pj = k0.get("/api/live/%s?v=600" % code).get_json() or {}
check("  the class's poll says so: party 1, for that step", pj.get("party_seq") == 1 and pj.get("party_key") == "s1", pj)
twice = teacher.post("/api/live/%s/extra" % code, json={"party": "s1", "seq": 800}).get_json()
check("  calling it again for the same step does nothing", twice.get("party") is False, twice)
db = P.SessionLocal()
paid = {a.user_id: a.xp for a in db.query(accounts.XpAward).filter(accounts.XpAward.source.like("liveparty:%"))}
db.close()
check("each student here got %d XP, once; the one not here none" % P.LIVE_PARTY_XP,
      paid == {k: P.LIVE_PARTY_XP for k in kids}, paid)

# ---- a lesson that ended says nothing new
teacher.post("/api/live/%s/stop" % code)
gone = k0.post("/api/live/%s/signal" % code, json={"kind": "step", "key": "s9"})
check("an ended lesson takes no more signals", gone.status_code == 404, gone.status_code)

print()
failed = results.count(False)
if failed:
    print("FAILED: %d of %d checks" % (failed, len(results)))
    sys.exit(1)
print("ALL PASSED (%d checks, 0 failed)" % len(results))
