#!/usr/bin/env python3
"""Discussion assignments ("Discussions" in app.py): made, posted, hidden,
graded.

    python3 tools/test_discussion.py

Through the Flask test client, and discussion.js's rule in node:

  * Add to class → Discussion makes kind "discussion" with its post as a
    library tutorial, the requirements at the defaults, Out of 10, and no
    live link
  * a student sees NO posts (not even names) until they've posted to the
    question; then every post, first name + last initial, never an email
  * a post under the minimum is refused, so is a reply before their own
    post, a post to a closed discussion, and anyone off the roster
  * markup is cleaned; posts can't be edited or deleted (no route)
  * the grade: one line per required post, each its share of Out of, in
    _earned (so the gradebook and every total see it); a reply counts only
    to ANOTHER student's post; turned in without counting an attempt
  * the green/yellow mark goes only to its author and the teacher, and the
    page's rule (discussion.js) and the server's agree on every sample
  * the teacher's rules regrade everyone; a raised minimum counts short
    posts out
  * never live; the class pages show Discussion / Open Discussion; Delete
    takes the posts with it
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "disc.db")
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


def user(sub, email, name, first="", last=""):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name, first_name=first, last_name=last)
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


def words(n, sentences=1):
    """n words in that many sentences."""
    w = ["word"] * n
    step = max(1, n // sentences)
    out = []
    for i, x in enumerate(w):
        out.append(x + ("." if (i + 1) % step == 0 or i == n - 1 else ""))
    return " ".join(out)


SAMPLES = [words(10), words(25), words(49, 3), words(50, 3), words(50, 2), words(60, 4),
           "One. Two. Three.", "", "Is it? Yes! Sure. " * 20, words(80, 1),
           "e.g. this has dots.inside words " * 12]

NODE = r"""
const fs = require("fs");
const window = {};
new Function("window", "document", fs.readFileSync(process.argv[1], "utf8"))(window, {});
const D = window.PyIDEDiscussion;
const samples = JSON.parse(process.argv[2]);
console.log(JSON.stringify(samples.map(s => [D.words(s), D.substantial(s, 25)])));
"""


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)

    tid, oid = user("t", "teacher@example.org", "Pat Teach"), user("o", "other@example.org", "Other")
    ana = user("a", "ana@example.org", "Ana Lopez", "Ana", "Lopez")
    ben = user("b", "ben@example.org", "Ben Ray", "Ben", "Ray")
    cal = user("c", "cal@example.org", "Cal Moe", "Cal", "Moe")
    out_id = user("x", "stranger@example.org", "Stranger Danger")
    teacher, other, A, B, C, stranger, nobody = (client(tid), client(oid), client(ana), client(ben),
                                                 client(cal), client(out_id), client())
    cls = teacher.post("/api/class", json={"name": "Inf Sys P2"}).get_json()["id"]
    db = P.SessionLocal()
    for email, name in (("ana@example.org", "Ana Lopez"), ("ben@example.org", "Ben Ray"),
                        ("cal@example.org", "Cal Moe")):
        db.add(accounts.Enrollment(class_id=cls, email=email, name=name))
    db.commit()
    db.close()

    print("Add to class → Discussion")
    r = teacher.post("/api/class/%d/new" % cls, json={"kind": "discussion", "title": "Good design?"})
    out = r.get_json() or {}
    check("it's made, and opens its results page", r.status_code == 200 and out.get("url", "").endswith("/teacher/" + out.get("slug", "?")), out)
    slug = out["slug"]
    item = q(accounts.Assignment, slug=slug)[0]
    check("…kind discussion, Out of 10, the post as discussion.md, the rules at the defaults",
          item.kind == "discussion" and item.out_of == 10 and "# Good design?" in item.file_map()["discussion.md"]
          and json.loads(item.file_map()["discussion.json"]) == P.DISCUSSION_DEFAULTS, (item.kind, item.out_of))
    tut = q(accounts.LibraryItem, id=item.tutorial_id) if item.tutorial_id else []
    check("…its post a tutorial in the library, to write there", tut and tut[0].teacher_id == tid)
    check("…and no live link made", not q(accounts.LiveSession, assignment_id=item.id))
    check("another teacher can't add one to this class",
          other.post("/api/class/%d/new" % cls, json={"kind": "discussion"}).status_code in (403, 404))
    # The teacher writes the post in the library, with a key in it that must
    # never leave (every exit redacts).
    prompt = ("# Good design?\n\nIs the OK/OK delete box good design? Say why.\n\n"
              "```quiz\nPick one\n- [x] SECRETKEY\n- [ ] no\n```\n")
    teacher.post("/api/library/" + tut[0].slug, json={"body": prompt})
    teacher.post("/api/discussion/%s/rules" % slug, json={"posts": 1, "replies": 2, "min_words": 25})

    print("The pages")
    page = A.get("/a/" + slug).get_data(as_text=True)
    check("a student's link opens the discussion: the post, the box, the board",
          "Is the OK/OK delete box good design" in page and "discussion.js" in page and 'id="disc-compose"' in page)
    check("…the answer key out of it (the choice is there, its [x] isn't)", "SECRETKEY" in page and "[x]" not in page)
    tp = teacher.get("/a/" + slug)
    tpage = tp.get_data(as_text=True)
    check("the teacher's own link opens it too, with the requirements and the counts",
          tp.status_code == 200 and 'id="disc-rules"' in tpage and 'id="disc-counts"' in tpage and "Edit post in library" in tpage)
    check("Edit goes to the results (nothing to edit)",
          teacher.get("/teacher/%s/edit" % slug).headers.get("Location", "").endswith("/teacher/" + slug))
    res = teacher.get("/teacher/" + slug).get_data(as_text=True)
    check("the results page opens the discussion, and has no live link", 'id="discussion-open"' in res and 'id="live-url"' not in res)
    sp = nobody.get("/a/" + slug).get_data(as_text=True)
    check("signed out: the post, no box, no board", "Is the OK/OK" in sp and 'id="disc-compose"' not in sp and 'id="disc-posts"' not in sp)
    check("signed out, the API answers 401", nobody.get("/api/discussion/" + slug).status_code == 401)
    check("off the roster, the API answers 403", stranger.get("/api/discussion/" + slug).status_code == 403
          and stranger.post("/api/discussion/" + slug, json={"html": words(30)}).status_code == 403)

    print("Posting")
    post = lambda c, html, parent=None: c.post("/api/discussion/" + slug, json={"html": html, "parent": parent})
    r = post(A, "<p>" + words(10) + "</p>")
    check("under the minimum: refused, saying how many words", r.status_code == 400 and "25" in r.get_json()["error"], r.get_json())
    r = post(A, "")
    check("empty: refused", r.status_code == 400)
    first_ben = post(B, "<p>" + words(30) + "</p>").get_json()
    r = post(A, "<p>" + words(30) + "</p>", first_ben["id"])
    check("a reply before your own post to the question: refused", r.status_code == 403, r.get_json())
    seen = A.get("/api/discussion/" + slug).get_json()
    check("before posting: NO posts, not even names, only how many there are",
          seen["posts"] == [] and seen["hidden"] == 1 and not seen["see_all"] and "Ben" not in json.dumps(seen), seen)
    r = post(A, '<p onclick="x()">' + words(20) + ' <b>bold</b> <script>bad()</script> <img src=x onerror=y> more words here to pass</p>')
    a1 = r.get_json()
    check("her own post (with tags) is taken", r.status_code == 200 and a1.get("id"), a1)
    stored = q(P.DiscussionPost, id=a1["id"])[0].body
    check("…cleaned: no script, no attributes, no img; bold kept",
          "<script" not in stored and "onclick" not in stored and "<img" not in stored and "<b>bold</b>" in stored, stored)
    seen = A.get("/api/discussion/" + slug).get_json()
    names = sorted(p["name"] for p in seen["posts"])
    check("after posting: every post, by first name and last initial", seen["see_all"] and names == ["Ana L.", "Ben R."], names)
    check("…never an email", "@example.org" not in json.dumps(seen))
    marks = {p["name"]: p.get("mark") for p in seen["posts"]}
    check("the green/yellow mark only on her own post (Ben's is his and the teacher's)",
          marks["Ana L."] in ("green", "yellow") and marks["Ben R."] is None, marks)
    tseen = teacher.get("/api/discussion/" + slug).get_json()
    check("…the teacher sees every mark", all(p.get("mark") for p in tseen["posts"]))

    sub = q(accounts.Submission, assignment_id=item.id, student_id=ana)
    check("posting turned it in for her, with no attempt counted", len(sub) == 1 and sub[0].times_submitted == 0)

    print("The grade")
    earned = lambda: P._earned(P.SessionLocal(), item.id)
    check("1 post of 3 required: 10/3 points, in _earned (every total, the gradebook)",
          abs(earned().get(ana, 0) - 10 / 3) < 0.01, earned())
    post(A, "<p>" + words(30) + "</p>", a1["id"])            # replying to herself
    check("a reply to her OWN post doesn't count", abs(earned().get(ana, 0) - 10 / 3) < 0.01, earned())
    post(A, "<p>" + words(30) + "</p>", first_ben["id"])
    check("a reply to a classmate does", abs(earned().get(ana, 0) - 20 / 3) < 0.01, earned())
    t1 = post(teacher, "<p>Good start, Ana.</p>", a1["id"]).get_json()
    check("the teacher may post under the minimum, and isn't graded", t1.get("id") and tid not in earned())
    post(A, "<p>" + words(30) + "</p>", t1["id"])
    check("a reply to the TEACHER doesn't count as a classmate's", abs(earned().get(ana, 0) - 20 / 3) < 0.01, earned())
    post(C, "<p>" + words(30) + "</p>")
    cposts = [p for p in A.get("/api/discussion/" + slug).get_json()["posts"] if p["name"] == "Cal M." and p["parent"] is None]
    post(A, "<p>" + words(30) + "</p>", cposts[0]["id"])
    check("a second classmate's reply: full marks, 10", abs(earned().get(ana, 0) - 10) < 0.01, earned())
    mine = A.get("/api/discussion/" + slug).get_json()["mine"]
    check("…and her page is told her counts (1 post, 2 replies)", mine == {"posts": 1, "replies": 2}, mine)
    counts = {s["name"]: s for s in teacher.get("/api/discussion/" + slug).get_json()["students"]}
    check("the teacher's table: each student's posts, replies and points",
          counts["Ana L."]["posts"] == 1 and counts["Ana L."]["replies"] == 2 and counts["Ana L."]["earned"] == "10"
          and counts["Ben R."]["replies"] == 0, counts)

    print("Changing the requirements")
    r = teacher.post("/api/discussion/%s/rules" % slug, json={"posts": 1, "replies": 1, "min_words": 25, "out_of": 20})
    check("the teacher sets them; everyone is graded again (Ben: 1 post of 2 → 10 of 20)",
          r.status_code == 200 and abs(earned().get(ben, 0) - 10) < 0.01 and abs(earned().get(ana, 0) - 20) < 0.01, earned())
    teacher.post("/api/discussion/%s/rules" % slug, json={"min_words": 31})
    check("a raised minimum counts the shorter posts out (Ben's 30 words: 0)", earned().get(ben, 0) == 0, earned())
    teacher.post("/api/discussion/%s/rules" % slug, json={"min_words": 25})
    check("…and back", abs(earned().get(ben, 0) - 10) < 0.01, earned())
    check("a student can't change them", A.post("/api/discussion/%s/rules" % slug, json={"posts": 0}).status_code == 403)
    check("nothing required at all is refused",
          teacher.post("/api/discussion/%s/rules" % slug, json={"posts": 0, "replies": 0}).status_code == 400)
    check("there is no route to edit or delete a post",
          A.delete("/api/discussion/%s" % slug).status_code == 405 and A.put("/api/discussion/%s" % slug).status_code == 405)

    print("Closed, never live")
    db = P.SessionLocal()
    it = db.query(accounts.Assignment).filter_by(id=item.id).first()
    it.closed = 1
    db.commit()
    db.close()
    check("a closed discussion takes no posts", post(B, "<p>" + words(30) + "</p>").status_code == 403)
    db = P.SessionLocal()
    it = db.query(accounts.Assignment).filter_by(id=item.id).first()
    it.closed = 0
    db.commit()
    db.close()
    chooser = teacher.get("/api/live/assignments").get_json() or {}
    check("not in the Go-live chooser", slug not in json.dumps(chooser), chooser)
    check("Go live goes to its page", teacher.get("/teacher/%s/live" % slug).headers.get("Location", "").endswith("/a/" + slug))

    print("The class pages")
    cp = teacher.get("/teacher/class/%d" % cls).get_data(as_text=True)
    check("the teacher's: the Discussion option, its tag, Open and Results, no Go live for it",
          'value="discussion"' in cp and ">discussion</span>" in cp and ("/a/" + slug) in cp
          and ("/teacher/%s/live" % slug) not in cp)
    teacher.post("/api/class/%d/item/%d/hide" % (cls, q(accounts.ClassItem, assignment_id=item.id)[0].id))
    sp = A.get("/class/%d" % cls).get_data(as_text=True)
    check("the student's: Open Discussion", "Open Discussion" in sp, sp[:0])

    print("The page's rule and the server's")
    run = subprocess.run(["node", "-e", NODE, os.path.join(ROOT, "static", "discussion.js"), json.dumps(SAMPLES)],
                         capture_output=True, text=True, timeout=60)
    try:
        js = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        js = None
    py = [[P._post_words(s), P._substantial(s, 25)] for s in SAMPLES]
    check("discussion.js and app.py agree on every sample's words and green/yellow", js == py, (js, py, run.stderr[-300:]))
    check("…and the samples have both colors", any(x[1] for x in py) and not all(x[1] for x in py), py)

    print("Delete")
    db = P.SessionLocal()
    lone = accounts.Assignment(slug="zzdisc1", app="pyide", teacher_id=tid, title="Spare", kind="discussion",
                               code="", files=json.dumps({"discussion.md": "# Spare"}), out_of=10)
    db.add(lone)
    db.commit()
    db.add(P.DiscussionPost(assignment_id=lone.id, author_id=tid, body="<p>hi</p>", words=1))
    db.commit()
    lone_id = lone.id
    db.close()
    r = teacher.delete("/api/assignment/zzdisc1")
    check("Delete takes its posts with it", r.status_code == 200 and not q(P.DiscussionPost, assignment_id=lone_id), r.get_json())

    print()
    failed = results.count(False)
    print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
    shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
