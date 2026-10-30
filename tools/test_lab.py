#!/usr/bin/env python3
"""A+ labs in a class: assigned, done, saved, marked and graded.

    python3 tools/test_lab.py

The lab itself is tested in node (test_lab_machine.py, test_lab_cmd.py,
test_lab_checks.py) and in Chrome (test_lab_browser.py). This is the server
around it, through the Flask test client:

  * the tickets and try pages are the teacher's alone — their tasks and
    hints are the answers
  * Assign makes a lab in that class: kind "lab", its ticket, Out of its
    points, no live link made
  * a student's link opens the lab; the teacher's opens its results, or the
    lab with ?preview=1
  * saving the machine stores it as the scenario's parts (not what the page
    claimed), marks it with lab_checks.py, turns it in without counting an
    attempt, and puts the points where every total looks (_earned)
  * the same machine saved again, or saved with only its clock moved, does
    nothing — a turn-in time never moves on its own
  * each task pays XP once; a forged machine gets nothing
  * nobody reads or writes another student's machine; signed out, a
    teacher, a closed lab, a machine too big: refused or not saved
  * never live: not in the Go-live chooser, Go live goes to its results,
    and a live lesson can't take it
  * Delete works with saved machines and checked results (an FK on
    Postgres otherwise)
  * the class pages: the Lab (A+) option, its tag, Open the lab
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "lab.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org,other@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:300]))


# The machines a student's page would send: each ticket's start, and its fix
# played through machine.js, made by the lab's own JavaScript.
HARNESS = r"""
import fs from "fs";
const window = {};
for (const f of ["machine.js", "lab_checks.js"]) new Function("window", fs.readFileSync(process.argv[1] + "/" + f, "utf8"))(window);
const L = window.PyIDELab, K = window.PyIDELabChecks, CAT = JSON.parse(fs.readFileSync(process.argv[1] + "/parts.json", "utf8"));
const sc = (id) => JSON.parse(fs.readFileSync(process.argv[1] + "/scenarios/" + id + ".json", "utf8"));
const out = {};
let s = K.start(CAT, sc("overheat"));
out.start = JSON.parse(JSON.stringify(s));
L.reseatCooler(s); L.powerOn(CAT, s);
out.fixed = s;
s = K.start(CAT, sc("beeps"));
// The dead stick claimed to be fine: the page's items say so.
s.items.r2 = { part: "ram-ddr4-8" }; L.powerOn(CAT, s);
out.forged = s;
console.log(JSON.stringify(out));
"""


def user(sub, email, name):
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


def q(model, **kw):
    db = P.SessionLocal()
    try:
        return db.query(model).filter_by(**kw).all()
    finally:
        db.close()


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    run = subprocess.run(["node", "--input-type=module", "-e", HARNESS, os.path.join(ROOT, "static", "lab")],
                         capture_output=True, text=True, timeout=60)
    machines = json.loads(run.stdout.strip().splitlines()[-1])

    tid, oid = user("t", "teacher@example.org", "Teach"), user("o", "other@example.org", "Other")
    sid, s2 = user("s", "kid@example.org", "Kid Student"), user("s2", "pal@example.org", "Pal Student")
    teacher, other, kid, pal, nobody = client(tid), client(oid), client(sid), client(s2), client()
    cls = teacher.post("/api/class", json={"name": "A+ P3"}).get_json()["id"]
    db = P.SessionLocal()
    for email, name in (("kid@example.org", "Kid Student"), ("pal@example.org", "Pal Student")):
        db.add(accounts.Enrollment(class_id=cls, email=email, name=name))
    db.commit()
    db.close()

    print("The tickets are the teacher's")
    check("signed out, the tickets page asks for a sign-in", nobody.get("/lab/scenarios").status_code == 302)
    check("a student gets nothing there", kid.get("/lab/scenarios").status_code == 404)
    check("…nor on a ticket's try page", kid.get("/lab/try/overheat").status_code == 404)
    page = teacher.get("/lab/scenarios", query_string={"class": cls}).get_data(as_text=True)
    check("the teacher sees every ticket, each with Assign and their classes",
          page.count('class="ticket-card"') == len(P.lab_checks.scenario_ids()) and "js-assign" in page and "A+ P3" in page)
    check("…the class from Add to class chosen already", ('value="%d" selected' % cls) in page)
    nums = [int(n) for n in re.findall(r"<h3>Lab (\d+) · ", page)]
    check("…numbered, in course order", nums == list(range(1, len(nums) + 1)) and len(nums) == len(P.lab_checks.scenario_ids()), nums)
    hp = nobody.get("/help/lab").get_data(as_text=True)
    every = [(t["id"], t["hint"]) for sid in P.lab_checks.scenario_ids() for t in P.lab_checks.scenario(sid)["tasks"]]
    check("/help/lab lists every lab's tasks by id, for the step cards", all("<code>%s</code>" % i in hp for i, _ in every))
    check("…and none of the hints (they're the answers)", not any(h in hp for _, h in every))
    check("the teacher can try one", teacher.get("/lab/try/overheat").status_code == 200)
    check("the sandbox stays open to anyone", nobody.get("/lab/sandbox").status_code == 200)

    print("Assign")
    r = teacher.post("/api/class/%d/new" % cls, json={"kind": "lab", "scenario": "overheat"})
    out = r.get_json() or {}
    check("Assign makes a lab in that class", r.status_code == 200 and "/teacher/" in out.get("url", ""), out)
    slug = out.get("slug")
    item = q(accounts.Assignment, slug=slug)[0]
    check("…kind lab, named after its ticket, out of its tasks' and its notes' questions' points (6 + 2)",
          item.kind == "lab" and item.title == "Lab 6 · It shuts itself off" and item.out_of == 8, (item.kind, item.title, item.out_of))
    starter = open(os.path.join(ROOT, "static", "lab", "scenarios", "overheat.md")).read()
    check("…with the ticket's starter notes, as lab.md", item.file_map().get("lab.md") == starter)
    tut = q(accounts.LibraryItem, id=item.tutorial_id) if item.tutorial_id else []
    check("…made a tutorial in the teacher's library, to rewrite", tut and tut[0].body == starter and tut[0].teacher_id == tid)
    cls2 = teacher.post("/api/class", json={"name": "A+ P5"}).get_json()["id"]
    twin = q(accounts.Assignment, slug=teacher.post("/api/class/%d/new" % cls2, json={"kind": "lab", "scenario": "overheat"}).get_json()["slug"])[0]
    check("the same ticket in another period: the SAME tutorial, so one rewrite reaches both",
          twin.tutorial_id == item.tutorial_id and twin.tutorial_id)
    check("…its ticket in lab.json", json.loads(item.file_map()["lab.json"]) == {"scenario": "overheat"})
    check("…on the class's page", any(ci.assignment_id == item.id for ci in q(accounts.ClassItem, class_id=cls)))
    check("…and no live link made for it", not q(accounts.LiveSession, assignment_id=item.id))
    check("a ticket that doesn't exist is refused", teacher.post("/api/class/%d/new" % cls, json={"kind": "lab", "scenario": "../parts"}).status_code == 400)
    check("another teacher can't put one in this class", other.post("/api/class/%d/new" % cls, json={"kind": "lab", "scenario": "overheat"}).status_code in (403, 404))

    print("Its notes")
    mine = [i for i in teacher.get("/api/library").get_json()["items"] if i["title"] == "Lab 6 · It shuts itself off"]
    rewritten = starter.replace("## Heat, and how Windows remembers", "## Heat (Mr F's version)")
    r = teacher.post("/api/library/" + mine[0]["slug"], json={"body": rewritten}) if mine else None
    check("rewriting the tutorial in the library reaches both periods' labs",
          r is not None and r.status_code == 200 and all("Mr F's version" in q(accounts.Assignment, id=a.id)[0].file_map()["lab.md"] for a in (item, twin)))

    r = teacher.post("/api/assignment/%s/title" % twin.slug, json={"title": "Lab 6 · It shuts itself off (P5)"})
    renamed = q(accounts.Assignment, id=twin.id)[0]
    check("a lab can be renamed, and stays the same lab", r.status_code == 200 and renamed.title.endswith("(P5)")
          and json.loads(renamed.file_map()["lab.json"]) == {"scenario": "overheat"})
    check("…but not by another teacher, nor to nothing",
          other.post("/api/assignment/%s/title" % twin.slug, json={"title": "Mine"}).status_code == 404
          and teacher.post("/api/assignment/%s/title" % twin.slug, json={"title": "  "}).status_code == 400)

    print("Opening it")
    sp = kid.get("/a/" + slug)
    html = sp.get_data(as_text=True)
    check("a student's link opens the lab, saving to the server", sp.status_code == 200 and "lab/page.js" in html and "/api/lab/%s/state" % slug in html)
    check("…its notes beside it (the teacher's rewrite), the answer keys out",
          "Mr F" in html and "Kernel-Power 41" in html and "[x]" not in html and "lab/lab_notes.js" in html)
    check("…with the idle sign-out (_idle.html, beating for this class), and the class's attendance",
          ("var CLASS = %d;" % cls) in html and q(accounts.Visit, user_id=sid, class_id=cls))
    tp = teacher.get("/a/" + slug)
    check("the teacher's own link goes to its results", tp.status_code == 302 and tp.headers["Location"].endswith("/teacher/" + slug), tp.headers.get("Location"))
    pv = teacher.get("/a/%s?preview=1" % slug).get_data(as_text=True)
    check("…with ?preview=1, the lab, saving nothing", "Preview" in pv and "/api/lab/%s/state" % slug not in pv)
    check("Edit goes to the results too (nothing to edit)", teacher.get("/teacher/%s/edit" % slug).headers.get("Location", "").endswith("/teacher/" + slug))
    res = teacher.get("/teacher/" + slug).get_data(as_text=True)
    check("the results page shows the ticket's tasks and Try it, and no live link",
          "A+ lab 6: It shuts itself off" in res and "lab-try" in res and 'id="live-url"' not in res)

    print("Saving and marking")
    save = lambda c, state: c.post("/api/lab/%s/state" % slug, json={"state": state})
    r = save(kid, machines["start"])
    d = r.get_json() or {}
    check("the start saved: marked on the server, nothing passed", r.status_code == 200 and d.get("saved") and d.get("earned") == 0 and d.get("possible") == 6, d)
    sub = q(accounts.Submission, assignment_id=item.id, student_id=sid)
    check("…turned in for them, with no attempt counted", len(sub) == 1 and sub[0].times_submitted == 0 and sub[0].snippet_slug == "")
    when = sub[0].submitted_at if sub else None
    check("the same machine again: nothing saved, the turn-in time unmoved",
          not save(kid, machines["start"]).get_json().get("saved") and q(accounts.Submission, assignment_id=item.id, student_id=sid)[0].submitted_at == when)
    ticked = dict(machines["start"], power={"on": True, "uptime": 90})
    check("…nor with only its clock moved", not save(kid, ticked).get_json().get("saved"))
    d = save(kid, machines["fixed"]).get_json()
    check("the fixed machine: 6 of 6", d.get("earned") == 6 and all(m["ok"] for m in d.get("marks", [])), d)
    db = P.SessionLocal()
    try:
        check("…in the grade's total (_earned), so Classroom and Skyward send it", P._earned(db, item.id).get(sid) == 6, P._earned(db, item.id))
        paid = db.query(accounts.XpAward).filter(accounts.XpAward.user_id == sid, accounts.XpAward.source.like("test:%d:%%" % item.id)).count()
    finally:
        db.close()
    check("…and its task paid XP", paid == 1, paid)
    k = [x for x in P.quiz.keys(q(accounts.Assignment, id=item.id)[0].file_map()["lab.md"]) if "Kernel-Power 41" in json.dumps(x)][0]
    right = next(c for c in k["choices"] if "Kernel-Power 41" in c)        # an answer is the choice's text
    a = kid.post("/api/quiz/answer", json={"assignment": slug, "question": k["qid"], "response": right})
    db = P.SessionLocal()
    try:
        total = P._earned(db, item.id).get(sid)
    finally:
        db.close()
    check("a question in its notes, answered right: its point added to the lab's (7)", a.status_code == 200 and total == 7, (a.get_json(), total))
    again = dict(machines["fixed"], monitor=machines["fixed"]["monitor"], coolerSeated=True, cmos=True)
    again["os"] = dict(again["os"], hostname="PC-RENAMED")
    save(kid, again)
    db = P.SessionLocal()
    try:
        paid2 = db.query(accounts.XpAward).filter(accounts.XpAward.user_id == sid, accounts.XpAward.source.like("test:%d:%%" % item.id)).count()
    finally:
        db.close()
    check("saved again, passing still: no XP twice", paid2 == 1, paid2)
    stored = json.loads(q(P.LabState, assignment_id=item.id, student_id=sid)[0].state)
    check("what's stored is the machine, as the scenario's parts", stored["scenario"] == "overheat" and stored["coolerSeated"] is True)
    check("…and read back by the student", kid.get("/api/lab/%s/state" % slug).get_json()["state"]["coolerSeated"] is True)
    check("another student reads only their own (none)", pal.get("/api/lab/%s/state" % slug).get_json()["state"] is None)
    res = teacher.get("/teacher/" + slug).get_data(as_text=True)
    check("the results page: their lab score and each task ticked", "Lab 6 / 6" in res and "✓ The CPU cooler is seated" in res)

    print("What isn't saved, or isn't believed")
    b = teacher.post("/api/class/%d/new" % cls, json={"kind": "lab", "scenario": "beeps"}).get_json()["slug"]
    bi = q(accounts.Assignment, slug=b)[0]
    d = pal.post("/api/lab/%s/state" % b, json={"state": machines["forged"]}).get_json()
    check("the dead stick claimed fine in the save: still dead, nothing passed", d.get("earned") == 0, d)
    kept = json.loads(q(P.LabState, assignment_id=bi.id, student_id=s2)[0].state)
    check("…and stored as dead", kept["items"]["r2"].get("faulty") == "dead")
    check("signed out: refused, sign in", nobody.post("/api/lab/%s/state" % slug, json={"state": machines["start"]}).status_code == 401)
    check("the teacher's own: not saved", not save(teacher, machines["start"]).get_json().get("saved")
          and not q(P.LabState, assignment_id=item.id, student_id=tid))
    check("not a machine: refused", save(pal, "x").status_code == 400)
    check("too big to be a machine: refused", save(pal, dict(machines["start"], junk="x" * 300000)).status_code == 413)
    check("a code assignment's link isn't a lab", kid.post("/api/lab/nope/state", json={"state": {}}).status_code == 404)
    db = P.SessionLocal()
    db.query(accounts.Assignment).filter_by(id=bi.id).update({"closed": 1})
    db.commit()
    db.close()
    check("a closed lab: refused", pal.post("/api/lab/%s/state" % b, json={"state": machines["forged"]}).status_code == 403)

    print("Never live")
    live = teacher.get("/api/live/assignments").get_json()["assignments"]
    check("not in the Go-live chooser", slug not in [a["slug"] for a in live])
    gl = teacher.get("/teacher/%s/live" % slug)
    check("Go live goes to its results instead", gl.status_code == 302 and gl.headers["Location"].endswith("/teacher/" + slug))
    st = teacher.post("/api/live/start", json={"assignment": slug, "body": "", "name": "main.py"})
    check("a live lesson can't take it", st.status_code >= 400 or not (st.get_json() or {}).get("assignment"), st.get_json())
    check("…and still no live link was made", not q(accounts.LiveSession, assignment_id=item.id))

    print("The class pages")
    cp = teacher.get("/teacher/class/%d" % cls).get_data(as_text=True)
    check("Add to class has Lab (A+), going to the tickets for this class",
          '<option value="lab">Lab (A+)</option>' in cp and ("/lab/scenarios?class=%d" % cls) in cp)
    check("…its row says lab, with Results and no Go live", 'kind-tag">lab<' in cp and "/teacher/%s/live" % slug not in cp)
    sc = kid.get("/class/%d" % cls)
    check("a student's class page says Open the lab", "Open the lab" in sc.get_data(as_text=True), sc.status_code)

    print("Delete")
    d2 = teacher.post("/api/class/%d/new" % cls, json={"kind": "lab", "scenario": "apipa"}).get_json()["slug"]
    di = q(accounts.Assignment, slug=d2)[0]
    db = P.SessionLocal()
    db.add(P.LabState(assignment_id=di.id, student_id=sid, state="{}"))
    db.add(accounts.TestResult(assignment_id=di.id, student_id=sid, kind="self", earned=0, possible=5, details="[]"))
    db.commit()
    db.close()
    r = teacher.delete("/api/assignment/" + d2)
    check("a lab with a saved machine and a checked result deletes", r.status_code == 200, r.get_json())
    check("…and takes them with it", not q(P.LabState, assignment_id=di.id) and not q(accounts.TestResult, assignment_id=di.id))

    print("\n%d checks, %s" % (len(results), "%d FAILED" % results.count(False) if False in results else "all ok"))
    sys.exit(1 if False in results else 0)


if __name__ == "__main__":
    main()
