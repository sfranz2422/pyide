#!/usr/bin/env python3
"""A discussion in Chrome: two students and their teacher on the real page.

    python3 tools/test_discussion_browser.py
    DISC_SHOT=/some/dir python3 tools/test_discussion_browser.py   # and screenshots

Drives discussion_browser.mjs: the board locked until a student posts, the
word meter going red → yellow → green as they type, Post, replies nested
under the post they answer, the counts on the student's own page and in the
teacher's table, and the teacher's rules regrading at once. The server's
side is test_discussion.py.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "discb.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402
from werkzeug.serving import make_server                     # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-76s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:400]))


def find_chrome():
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


def user(sub, email, name, first="", last=""):
    db = P.SessionLocal()
    try:
        u = accounts.User(google_sub=sub, email=email, name=name, first_name=first, last_name=last)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


chrome = find_chrome()
if not chrome or not shutil.which("node"):
    print("Chrome and node are needed.")
    sys.exit(1)

tid = user("t", "teacher@example.org", "Pat Teach")
ana = user("a", "ana@example.org", "Ana Lopez", "Ana", "Lopez")
ben = user("b", "ben@example.org", "Ben Ray", "Ben", "Ray")
teacher = P.app.test_client()
with teacher.session_transaction() as s:
    s["uid"] = tid
benc = P.app.test_client()
with benc.session_transaction() as s:
    s["uid"] = ben
cls = teacher.post("/api/class", json={"name": "Inf Sys"}).get_json()["id"]
db = P.SessionLocal()
for email, name in (("ana@example.org", "Ana Lopez"), ("ben@example.org", "Ben Ray")):
    db.add(accounts.Enrollment(class_id=cls, email=email, name=name))
db.commit()
db.close()
slug = teacher.post("/api/class/%d/new" % cls, json={"kind": "discussion", "title": "OK or not?"}).get_json()["slug"]
item = P.SessionLocal().query(accounts.Assignment).filter_by(slug=slug).first()
tut = P.SessionLocal().query(accounts.LibraryItem).filter_by(id=item.tutorial_id).first()
teacher.post("/api/library/" + tut.slug, json={"body": "# OK or not?\n\nIs a delete box with **two OK buttons** good design? Why?"})
teacher.post("/api/discussion/%s/rules" % slug, json={"posts": 1, "replies": 1, "min_words": 20})
benc.post("/api/discussion/" + slug, json={"html": "<p>" + " ".join(["Bad"] * 25) + ".</p>"})

server = make_server("127.0.0.1", 0, P.app, threaded=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sign = P.app.session_interface.get_signing_serializer(P.app)
setup = os.path.join(TMP, "setup.json")
with open(setup, "w") as f:
    json.dump({"base": "http://127.0.0.1:%d" % server.server_port, "page": "/a/" + slug,
               "ana": sign.dumps({"uid": ana}), "teacher": sign.dumps({"uid": tid}),
               "short": "Two OK buttons are bad.",
               "more": "You cannot tell which one deletes the photos, so people will lose them by accident.",
               "long": ("A good button says what it does. Delete and Keep would be clear. "
                        "The design looks finished, but it fails the usable pillar. "
                        "I would test it with three people and watch where they press first, "
                        "then change the labels and test it again before shipping it.")}, f)
run = subprocess.run(["node", os.path.join(HERE, "discussion_browser.mjs"), setup, chrome],
                     cwd=ROOT, capture_output=True, text=True, timeout=300)
try:
    r = json.loads(run.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    r = {"error": run.stdout[-300:] + run.stderr[-300:]}

print("A discussion in Chrome")
check("the browser run finished", not r.get("error"), r.get("error", ""))
b = r.get("before") or {}
check("before posting: the teacher's post (rendered), the board locked, no posts, only how many",
      "two OK buttons" in (b.get("prompt") or "") and "**" not in (b.get("prompt") or "")
      and b.get("locked") and b.get("posts") == 0 and b.get("count") == "1 post so far.", b)
check("  and what's needed to finish", "1 post" in (b.get("needs") or "") and "20 words" in (b.get("needs") or ""), b)
check("typing: under the minimum it counts toward it, in red",
      "is-short" in (r.get("short") or "") and "/ 20 words" in (r.get("short") or ""), r.get("short"))
check("  past the minimum, yellow", "is-yellow" in (r.get("yellow") or ""), r.get("yellow"))
check("  long and in several sentences, green", "is-green" in (r.get("green") or ""), r.get("green"))
af = r.get("after") or {}
check("posted: the board opens, every post by first name and last initial",
      af.get("locked") is False and af.get("names") == ["Ana L.", "Ben R."], af)
check("  her post marked Substantial; Ben's carries no mark for her",
      "Substantial" in (af.get("myMark") or "") and af.get("otherMark") is False, af)
check("  the box emptied, now for another post", af.get("boxEmpty") and af.get("title") == "Add another post", af)
rp = r.get("reply") or {}
check("Reply under Ben's post: posted, nested under it, the box closed",
      rp.get("nested") == 1 and rp.get("boxGone"), rp)
check("  her counts say she's done", (rp.get("needs") or "").startswith("✓ Done"), rp)
t = r.get("teacher") or {}
rows = {row[0]: row for row in (t.get("rows") or [])}
check("the teacher's table: Ana 1/1 posts, 1/1 replies, 10/10; Ben 1/1, 0/1, 5/10",
      rows.get("Ana L.") == ["Ana L.", "1 / 1", "1 / 1", "10 / 10"]
      and rows.get("Ben R.") == ["Ben R.", "1 / 1", "0 / 1", "5 / 10"], t.get("rows"))
check("  and the teacher sees every post's mark", t.get("marks") == t.get("posts") == 3, t)
rg = {row[0]: row for row in (r.get("regraded") or [])}
check("asking for 2 replies regrades at once (Ana now 1/2, 6.67)",
      rg.get("Ana L.") == ["Ana L.", "1 / 1", "1 / 2", "6.67 / 10"], r.get("regraded"))
check("on a phone, nothing runs off the side", r.get("phone") is True, r.get("phone"))

print()
failed = results.count(False)
print(("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
server.shutdown()
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if failed else 0)
