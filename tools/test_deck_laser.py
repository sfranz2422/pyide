#!/usr/bin/env python3
"""The teacher's laser pointer over the slides shown on the class's screens.

    python3 tools/test_deck_laser.py          (the browser half needs node and Chrome)

WHY THIS FILE EXISTS

The teacher asked for the live lessons' laser (hold Alt and point) on the
slides they show on every student's screen (Show to class, deck_show.js).
Students are sent a written-out copy of the slide, never the deck, so the
dot can only land on the right word if the copy keeps every node at its
place among its parent's children: deck_show.js writes an empty comment
where it leaves something out, and laser.js's path of child numbers leads
to the same letter on both screens.

The SERVER half: only the lesson's teacher can point; a pointer is checked
against LASER before it is stored; pointers are kept in order by their own
stamp; a page that asks with `p` and is behind gets the pointer alone, and
one from before the laser (no `p`) keeps its 304s.

The BROWSER half (tools/deck_laser_browser.mjs): a deck on a 1400-wide
screen and a student on a 900-wide one, the deck's text sized by the
window. The dot must land on the word pointed at, after a script and a
teacher's hint the class is not sent, and on the next slide after a
comment; go out on letting go of Alt; and go with the slide when the show
stops.
"""
import base64
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "deck_laser.db")
os.environ["TEACHER_EMAILS"] = "teacher@school.org,other@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-66s %s" % ("ok" if condition else "FAIL", label, detail))


def add(row):
    db = P.SessionLocal()
    try:
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def client(uid):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


TEACHER = add(accounts.User(google_sub="t", email="teacher@school.org", name="T"))
OTHER = add(accounts.User(google_sub="o", email="other@school.org", name="O"))
teacher, other, anyone = client(TEACHER), client(OTHER), client(None)
add(accounts.Assignment(slug="hw1", app=P.APP_NAME, teacher_id=TEACHER, title="HW1",
                        code="print(1)\n", files=json.dumps({"notes.md": "# Hi\n"})))
DECK = """<!doctype html><html><head><style>
body { margin: 0; font-family: Arial, sans-serif; }
.slide { display: none; position: fixed; inset: 0; padding: 4vw; font-size: 3.2vw; }
.slide.on { display: block; }
.hint { color: gray; }
#next { position: fixed; right: 10px; bottom: 10px; }
</style></head><body>
<div id="setup">Class list: Ana, Ben</div>
<section class="slide on"><h1>Loops</h1><script>var x = 1;</script>
<p class="hint">Only the teacher sees this hint.</p>
<p>A for loop repeats code once for each item. Look at THIS word in the middle of a longer sentence that wraps.</p></section>
<section class="slide"><h2>Second</h2><!-- a comment in the deck -->
<p>The word range gives numbers counting up.</p></section>
<button id="next">Next</button>
<script>
var at = 0;
document.getElementById("next").onclick = function () {
  var s = document.querySelectorAll(".slide");
  s[at].classList.remove("on"); at = (at + 1) % s.length; s[at].classList.add("on");
};
</script></body></html>"""
teacher.post("/api/assignment/hw1/slides",
             json={"name": "d.html", "data": base64.b64encode(DECK.encode()).decode()})

print("the teacher's deck page")
page = teacher.get("/teacher/hw1/slides?show=1").get_data(as_text=True)
check("loads laser.js before deck_show.js",
      "laser.js" in page and page.index("laser.js") < page.index("deck_show.js"))
code = json.loads(page.split("window.DECK_SHOW=", 1)[1].split(";</script>", 1)[0])["code"]
plain = teacher.get("/teacher/hw1/slides").get_data(as_text=True)
check("  and the plain link is still the file as uploaded", "laser.js" not in plain)
with open(os.path.join(PYIDE, "templates", "class_student.html"), encoding="utf-8") as f:
    cs = f.read()
check("the class page loads laser.js before deck_view.js",
      "filename='laser.js'" in cs and cs.index("filename='laser.js'") < cs.index("filename='deck_view.js'"))

print("the server")
frame = {"head": "", "body": "<p>one</p>", "html_attrs": "", "body_attrs": ""}
teacher.post("/api/live/%s/deck" % code, json={
    "seq": 5, "showing": True, "data": base64.b64encode(json.dumps(frame).encode()).decode()})
POINT, POLL = "/api/live/%s/deck/point" % code, "/api/live/%s/deck" % code
r = other.post(POINT, json={"seq": 10, "pointer": "s:1:0:t3"})
check("another teacher can't point at this class's slides", r.status_code == 403, r.status_code)
r = anyone.post(POINT, json={"seq": 10, "pointer": "s:1:0:t3"})
check("  nor anyone signed out", r.status_code == 403, r.status_code)
r = teacher.post(POINT, json={"seq": 10, "pointer": "<script>"})
check("a pointer that isn't a place is refused", r.status_code == 400, r.status_code)
r = teacher.post(POINT, json={"seq": 10, "pointer": "s:1:0:t3", "path": "1@s:1:0:t3;x"})
check("  and so is a path with anything else in it", r.status_code == 400, r.status_code)
r = teacher.post(POINT, json={"seq": 10, "pointer": "s:1:0:t3", "path": "9@s:1:0:t3"})
check("the teacher points", r.status_code == 200 and not r.get_json()["stale"], r.get_json())
r = teacher.post(POINT, json={"seq": 9, "pointer": "s:1:0:t9"})
check("  and a late, older pointer doesn't replace it", r.get_json()["stale"] is True, r.get_json())
d = anyone.get(POLL + "?d=0&p=0").get_json()
check("a new page gets the slide and the pointer",
      d["frame"]["body"] == "<p>one</p>" and d["pointer"] == "s:1:0:t3" and d["pointer_seq"] == 10, d.get("pointer"))
d = anyone.get(POLL + "?d=5&p=0")
check("a page with the slide but behind on the pointer gets the pointer alone",
      d.status_code == 200 and d.get_json().get("pointer_only") and "frame" not in d.get_json(), d.status_code)
check("  and one that is up to date, a 304", anyone.get(POLL + "?d=5&p=10").status_code == 304)
check("a page from before the laser (no p) keeps its 304", anyone.get(POLL + "?d=5").status_code == 304)
teacher.post(POINT, json={"seq": 11, "pointer": "", "path": "9@s:1:0:t3"})
d = anyone.get(POLL + "?d=5&p=10").get_json()
check("letting go is sent as an empty pointer, with no path", d["pointer"] == "" and d["pointer_path"] == "", d)
teacher.post("/api/live/%s/deck" % code, json={"seq": 20, "showing": False})

print("In a real browser")


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here — the dot's placement is not checked")
else:
    from werkzeug.serving import make_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"cookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": TEACHER}),
                   "slug": "hw1"}, f)
    out = subprocess.run(["node", os.path.join(HERE, "deck_laser_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=240)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:200])
    check("the browser run reported every check", len(lines) == 11,
          (len(lines), out.stderr.strip()[-300:]))
    server.shutdown()

failed = results.count(False)
print("%s (%d checks, %d failed)" % ("ALL PASSED" if not failed else "SOME FAILED",
                                     len(results), failed))
sys.exit(1 if failed else 0)
