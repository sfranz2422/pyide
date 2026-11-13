#!/usr/bin/env python3
"""The name picker (class_picker.html, static/picker.js, "The name picker"
in app.py, and the flash in static/xp.js).

    python3 tools/test_picker.py

Server: only the class's own teacher has the page and its two posts; names
are first names from the roster (Google's own when signed in, initials for
two of one name); "here today" is today's attendance; a pick is by roster id
and reaches that class's signed-in students only — `me` for the one picked —
for PICK_SHOW_SECONDS; `picking` follows the page's beat.

Node: picker.js picks only from who's in the hat, starts a new round when
everyone's had a turn, and its cycle always ends on the winner. xp.js
flashes a pick once, says "That's you!" to the one picked, and asks quickly
only while a picker is open.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB = os.path.join(tempfile.mkdtemp(), "picker.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@school.org,other@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, ROOT)
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
        return getattr(row, "id", None)
    finally:
        db.close()


def client(uid):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def user(sub, email, name, first="", last=""):
    return add(accounts.User(google_sub=sub, email=email, name=name, first_name=first, last_name=last))


TEACHER = user("t", "teacher@school.org", "Ms Teacher")
OTHER = user("o", "other@school.org", "Mr Other")
ANA = user("a", "ana@school.org", "Ana Cruz", "Ana", "Cruz")
MARY = user("m", "mary@school.org", "Mary Ann Smith", "Mary Ann", "Smith")
OUT = user("x", "out@school.org", "Out Sider", "Out", "Sider")
CLASS = add(accounts.Course(teacher_id=TEACHER, name="P4 Intro", app="pyide"))
CLASS2 = add(accounts.Course(teacher_id=TEACHER, name="P7 Intro", app="pyide"))
E_ANA = add(accounts.Enrollment(class_id=CLASS, email="ana@school.org", name="Ana Cruz"))
E_ANA2 = add(accounts.Enrollment(class_id=CLASS, email="ana.b@school.org", name="Ana Bell"))
E_MARY = add(accounts.Enrollment(class_id=CLASS, email="mary@school.org", name="Mary Ann Smith"))
E_NONAME = add(accounts.Enrollment(class_id=CLASS, email="zed.q@school.org", name=""))
E_OUT = add(accounts.Enrollment(class_id=CLASS2, email="out@school.org", name="Out Sider"))

print("The page: the class's own teacher only")
t = client(TEACHER)
r = t.get("/teacher/class/%d/picker" % CLASS)
page = r.get_data(as_text=True)
check("the teacher of the class gets the picker", r.status_code == 200 and 'id="pick-go"' in page, r.status_code)
check("  another teacher doesn't", client(OTHER).get("/teacher/class/%d/picker" % CLASS).status_code == 404)
check("  nor a student", client(ANA).get("/teacher/class/%d/picker" % CLASS).status_code == 404)
check("  and signed out it's the sign-in", client(None).get("/teacher/class/%d/picker" % CLASS).status_code == 302)
check("the class page has the Name picker button, opening in a tab of its own",
      re.search(r'href="/teacher/class/%d/picker" target="_blank"' % CLASS,
                t.get("/teacher/class/%d" % CLASS).get_data(as_text=True)) is not None)
student_page = client(ANA).get("/class/%d" % CLASS).get_data(as_text=True)
check("  and the class's own page doesn't", "picker" not in student_page.lower(), len(student_page))

print("\nThe names")
data = json.loads(re.search(r'<script type="application/json" id="pick-data">(.*?)</script>', page, re.S).group(1))
names = {n["id"]: n["name"] for n in data["names"]}
check("first names only, from the roster", names.get(E_MARY) == "Mary Ann", names)
check("  two Anas get their last initials", names.get(E_ANA) == "Ana C." and names.get(E_ANA2) == "Ana B.", names)
check("  a nameless student is their email's first part", names.get(E_NONAME) == "Zed", names)
check("  and only this class's", E_OUT not in names and len(names) == 4, names)
check("no emails on the page", "@school.org" not in page)
check("nobody is here today yet", data["here"] == [], data["here"])
add(accounts.Visit(class_id=CLASS, user_id=ANA, email="ana@school.org", name="Ana Cruz",
                   started_at=accounts.now(), last_at=accounts.now()))
add(accounts.Visit(class_id=CLASS, user_id=MARY, email="mary@school.org", name="Mary Ann Smith",
                   started_at=accounts.now() - timedelta(days=2), last_at=accounts.now() - timedelta(days=2)))
data = json.loads(re.search(r'id="pick-data">(.*?)</script>',
                            t.get("/teacher/class/%d/picker" % CLASS).get_data(as_text=True), re.S).group(1))
check("here today: who opened something of the class today, not two days ago", data["here"] == [E_ANA], data["here"])


def news(uid):
    return client(uid).get("/api/me/xp/news?after=0&events_after=0").get_json()


def quick(uid):
    return client(uid).get("/api/me/pick").get_json()


print("\nOpen: the class asks quickly")
check("closed, nobody's picking", news(ANA)["picking"] is False and quick(ANA)["picking"] is False)
beat = "/api/class/%d/picker/beat" % CLASS
check("a student can't beat", client(ANA).post(beat, json={"open": True}).status_code == 403)
check("  nor another teacher", client(OTHER).post(beat, json={"open": True}).status_code == 404)
check("the teacher's beat opens it", t.post(beat, json={"open": True}).status_code == 200)
check("  the class's news says picking", news(ANA)["picking"] is True and quick(MARY)["picking"] is True)
check("  another class's students aren't told", news(OUT)["picking"] is False)
check("  nor is the teacher", quick(TEACHER)["picking"] is False)
t.post(beat, json={"open": False})
check("closing it says so at once", quick(ANA)["picking"] is False)
t.post(beat, json={"open": True})
db = P.SessionLocal()
row = db.get(P.ClassPicker, CLASS)
row.beat -= (P.PICKER_OPEN_SECONDS + 1) * 1000
db.commit()
db.close()
check("a beat older than PICKER_OPEN_SECONDS is a closed tab", quick(ANA)["picking"] is False)
t.post(beat, json={"open": True})

print("\nA pick")
pick = "/api/class/%d/picker/pick" % CLASS
check("a student can't pick", client(ANA).post(pick, json={"id": E_ANA}).status_code == 403)
check("  nor anyone from another class's roster", t.post(pick, json={"id": E_OUT}).status_code == 404)
check("  nor nobody", t.post(pick, json={}).status_code == 400)
r = t.post(pick, json={"id": E_ANA})
check("the teacher picks by roster id", r.status_code == 200 and r.get_json()["name"] == "Ana C.", r.get_json())
got = quick(MARY)["pick"]
check("the class is shown the first name, not the email", got and got["name"] == "Ana C." and got["me"] is False
      and "@" not in json.dumps(got), got)
check("  the one picked is told it's them", quick(ANA)["pick"]["me"] is True)
check("  the XP news carries it too, for a page not yet asking quickly", news(MARY)["pick"]["name"] == "Ana C.")
check("  another class's students see nothing", quick(OUT)["pick"] is None)
key = got["key"]
t.post(pick, json={"id": E_MARY})
check("a second pick is a new key", quick(ANA)["pick"]["key"] != key and quick(ANA)["pick"]["name"] == "Mary Ann")

print("\nXP for a right answer (the teacher's button, never automatic)")
give = "/api/class/%d/picker/xp" % CLASS
TOK = "0123abcd0123abcd"
check("picking pays nobody", P.xp.total(P.SessionLocal(), ANA) == 0 and P.xp.total(P.SessionLocal(), MARY) == 0)
check("a student can't give it", client(ANA).post(give, json={"id": E_ANA, "token": TOK}).status_code == 403)
check("  nor another teacher", client(OTHER).post(give, json={"id": E_ANA, "token": TOK}).status_code == 404)
check("  nor to another class's student", t.post(give, json={"id": E_OUT, "token": TOK}).status_code == 404)
check("  nor without a pick's token", t.post(give, json={"id": E_ANA}).status_code == 400
      and t.post(give, json={"id": E_ANA, "token": "x'; drop"}).status_code == 400)
r = t.post(give, json={"id": E_ANA2, "token": TOK})
check("  a student who never signed in is told so, not paid", r.status_code == 409 and "signed in" in r.get_json()["error"],
      r.get_json())
r = t.post(give, json={"id": E_ANA, "token": TOK})
check("the teacher gives the one picked PICK_XP", r.status_code == 200 and r.get_json()["xp"] == P.PICK_XP
      and P.xp.total(P.SessionLocal(), ANA) == P.PICK_XP, r.get_json())
r = t.post(give, json={"id": E_ANA, "token": TOK})
check("  a double click pays once", r.get_json()["again"] is True and P.xp.total(P.SessionLocal(), ANA) == P.PICK_XP)
t.post(give, json={"id": E_ANA, "token": "feedfacefeedface"})
check("  the next pick (a new token) can pay again", P.xp.total(P.SessionLocal(), ANA) == 2 * P.PICK_XP)
db = P.SessionLocal()
reasons = [a.reason for a in db.query(accounts.XpAward).filter_by(user_id=ANA)]
db.close()
check("  with a reason the student sees", reasons == [P.PICK_XP_REASON] * 2, reasons)
check("the page knows who can be given XP", data["names"] and {n["id"]: n["xp"] for n in data["names"]}
      == {E_ANA: True, E_ANA2: False, E_MARY: True, E_NONAME: False}, data["names"])

db = P.SessionLocal()
row = db.get(P.ClassPicker, CLASS)
row.picked -= (P.PICK_SHOW_SECONDS + 1) * 1000
db.commit()
db.close()
check("a pick older than PICK_SHOW_SECONDS isn't flashed", quick(ANA)["pick"] is None)

print("\nIn node: picker.js and xp.js")
node = shutil.which("node")
if node is None:
    check("node is here to run the page's own JavaScript", False, "brew install node")
else:
    PICKER = open(os.path.join(ROOT, "static", "picker.js")).read()
    XP = open(os.path.join(ROOT, "static", "xp.js")).read()
    script = r"""
var store = {};
global.window = global;
global.localStorage = { getItem: function (k) { return k in store ? store[k] : null; },
                        setItem: function (k, v) { store[k] = String(v); } };
function El(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.className = ""; this.textContent = ""; this.parentNode = null; }
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.remove = function () { if (this.parentNode) { var p = this.parentNode; p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } };
El.prototype.text = function () { return this.textContent + this.children.map(function (c) { return c.text(); }).join("|"); };
var made = 0;
global.document = { body: new El("body"), hidden: false, createElement: function (t) { return new El(t); },
                    getElementById: function () { return null; }, addEventListener: function () {} };
var timers = [];
global.setInterval = function (f, ms) { timers.push({ f: f, ms: ms, on: true }); return timers.length; };
global.clearInterval = function (id) { if (timers[id - 1]) timers[id - 1].on = false; };
global.setTimeout = function () { return 0; };
var asked = 0;
global.fetch = function (url) { asked++; return Promise.resolve({ ok: true, json: function () { return Promise.resolve(null); } }); };
""" + PICKER + "\n" + XP + r"""
var Pk = window.PyIDEPicker, X = window.PyIDEXP;
var out = {};
var names = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
out.pool = Pk.pool(names, [2], [], true).ids;
out.poolRep = Pk.pool(names, [], [1, 3], true).ids;
out.poolAll = Pk.pool(names, [2], [1, 3], true);
out.poolFree = Pk.pool(names, [], [1, 2, 3], false);
out.nobody = Pk.pool(names, [1, 2, 3], [], true).ids;
var seed = 7, rand = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
var ends = true, twice = false, inHat = true;
for (var k = 0; k < 300; k++) {
  var ids = k % 3 ? [1, 2, 3] : [1, 3];
  var w = Pk.choose(ids, rand), r = Pk.route(ids, w, 24, rand);
  if (r[r.length - 1] !== w || r.length !== 24) ends = false;
  for (var j = 1; j < r.length; j++) if (r[j] === r[j - 1]) twice = true;
  if (r.some(function (id) { return ids.indexOf(id) < 0; })) inHat = false;
}
out.route = { ends: ends, twice: twice, inHat: inHat, one: Pk.route([5], 5, 24, rand).every(function (id) { return id === 5; }) };
var p = Pk.pauses();
out.pauses = { n: p.length, slower: p.every(function (x, i) { return !i || x >= p[i - 1]; }),
               total: p.reduce(function (a, b) { return a + b; }, 0) };
var count = Pk.choose([1, 2, 3, 4], function () { return 0.999; });
out.chooseLast = count;

// xp.js: a pick flashes once, "That's you!" for the one picked.
var body = document.body, put = body.appendChild;
body.appendChild = function (c) { if (/pick-flash/.test(c.className)) made++; return put.call(body, c); };
var flashes = function () { return document.body.children.filter(function (c) { return /pick-flash/.test(c.className); }); };
X.takePicks({ picking: false, pick: { key: "4:1", name: "Ana C.", me: false } });
out.first = flashes().map(function (f) { return [f.className, f.text()]; });
X.takePicks({ picking: false, pick: { key: "4:1", name: "Ana C.", me: false } });
out.again = made;     // flashes made, not on screen: a new one replaces the last
X.takePicks({ picking: false, pick: { key: "4:2", name: "Mary Ann", me: true } });
out.me = flashes().map(function (f) { return [f.className, f.text()]; });
out.kept = store["pyide-pick-seen"];
// Quick asking: on while picking, off when not.
var live = function () { return timers.filter(function (t) { return t.on && t.ms === 2500; }).length; };
out.quickOff = live();
X.takePicks({ picking: true, pick: null });
X.takePicks({ picking: true, pick: null });
out.quickOn = live();
var before = asked;
timers.filter(function (t) { return t.on && t.ms === 2500; })[0].f();
out.asks = asked - before;
X.takePicks({ picking: false, pick: null });
out.quickStopped = live();
console.log(JSON.stringify(out));
"""
    res = subprocess.run([node, "-e", script], capture_output=True, text=True, timeout=60)
    try:
        got = json.loads(res.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        got = {}
    check("node ran picker.js and xp.js", bool(got), res.stderr[-400:])
    if got:
        check("only who's in the hat: not someone left out", got["pool"] == [1, 3], got["pool"])
        check("  no repeats: not someone who's had a turn", got["poolRep"] == [2], got["poolRep"])
        check("  everyone's had a turn: a new round, still without who's left out",
              got["poolAll"] == {"ids": [1, 3], "fresh": True}, got["poolAll"])
        check("  repeats allowed: everyone in, every time", got["poolFree"] == {"ids": [1, 2, 3], "fresh": False})
        check("  everyone left out: nobody", got["nobody"] == [], got["nobody"])
        check("the cycle always ends on the winner, only shows who's in the hat, never one name twice running",
              got["route"] == {"ends": True, "twice": False, "inHat": True, "one": True}, got["route"])
        pz = got["pauses"]
        check("  slowing down, about three seconds in all", pz["slower"] and 2000 <= pz["total"] <= 4500, pz)
        check("  and choose can land on the last name", got["chooseLast"] == 4, got["chooseLast"])
        check("a student's page flashes the name picked", got["first"] == [["pick-flash", "Ana C."]], got["first"])
        check("  once: the same pick again shows nothing new", got["again"] == 1, got["again"])
        check("  the one picked is told it's them", got["me"] == [["pick-flash is-me", "Mary Ann|That's you!"]], got["me"])
        check("  and what's been shown is kept, for the next tab or page", got["kept"] == "4:2", got["kept"])
        check("asks quickly only while a picker is open, and only once over",
              got["quickOff"] == 0 and got["quickOn"] == 1 and got["asks"] == 1, got)
        check("  and stops when it closes", got["quickStopped"] == 0, got)

print("\nIn a real browser")


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
if chrome is None or node is None:
    print("  skip  no Chrome (or no node) here — the trip from Pick to a student's screen is not checked")
else:
    import logging
    import threading
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp()
    shots = os.environ.get("PICKER_SHOTS") or tmp
    sign = P.app.session_interface.get_signing_serializer(P.app)
    db = P.SessionLocal()
    browser_names = [n["name"] for n in P._picker_names(db, db.get(accounts.Course, CLASS))]
    db.close()
    setup = os.path.join(tmp, "setup.json")
    with open(setup, "w") as f:
        json.dump({"teacher": sign.dumps({"uid": TEACHER}), "student": sign.dumps({"uid": MARY}),
                   "picker": "/teacher/class/%d/picker" % CLASS, "classPage": "/class/%d" % CLASS,
                   "names": browser_names, "count": len(browser_names)}, f)
    out = subprocess.run([node, os.path.join(HERE, "picker_browser.mjs"), "http://127.0.0.1:%d" % server.server_port,
                          setup, chrome, os.path.join(tmp, "profile"), shots],
                         capture_output=True, text=True, timeout=180, cwd=ROOT)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:300])
    check("the browser run reported every check", len(lines) == 11, (len(lines), out.stderr[-300:]))
    server.shutdown()

failed = results.count(False)
print("\n" + ("ALL PASSED" if not failed else "SOME FAILED") + " (%d checks, %d failed)" % (len(results), failed))
sys.exit(1 if failed else 0)
