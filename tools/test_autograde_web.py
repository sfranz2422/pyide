#!/usr/bin/env python3
"""A web project's tests: WebIDE's, moved into PyIDE (Nov 2026)
(autograde_web.py, static/web/autograde.js, run by runners/web.js).

    python3 tools/test_autograde_web.py

This is WebIDE's tools/test_autograde.py, its first half: the format, the
two readers agreeing, and the checks run in a real Chrome. Its second half —
the server's Check all, kept results and XP — comes over when web
assignments reach the teacher's pages here (step 4 of the move); until then
those routes answer only Python assignments.

WHY THIS FILE EXISTS

A test that passes a wrong page, or fails a right one, is a wrong grade —
and once the teacher presses Check all, it is the grade that goes to
Classroom. So this pins:

  * the format: what each line is, its points, its page, and a line that
    isn't a test being said rather than quietly skipped;
  * autograde.js reads every block exactly as autograde.py does (node);
  * the checks, run in a real browser (headless Chrome), pass the right site
    and fail each wrong one for the right reason — a colour, a missing alt,
    a button that does nothing, a count, a page that never finishes, a page
    that isn't there;
  * the server: a student's own check is kept and counts for nothing; only
    the teacher's verified result is added to the grade; it can complete a
    quest; a verified result older than the work is marked stale; a page
    can't claim more points than the lines it sent; only the teacher can
    fetch the work or post a verified result; the help's example parses.

Needs node, Chrome, and the `ws` package (from ../pyide/node_modules).
"""
import html as _html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AUTOGRADE = os.path.join(ROOT, "static", "web", "autograde.js")
RUNNER = os.path.join(ROOT, "static", "web", "runner.js")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WS = os.path.join(ROOT, "node_modules", "ws")

DB = os.path.join(tempfile.mkdtemp(), "ag.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@school.org, other@school.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)
sys.path.insert(0, ROOT)
import autograde_web as autograde                            # noqa: E402

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-64s %s" % ("ok" if ok else "FAIL", label, detail))


def set_notes(c, slug, text):
    """An assignment's notes, written where they are written now: its
    tutorial in the library (library.py), saved — and linked first, if it
    has none."""
    items = c.get("/api/library").get_json()["items"]
    mine = next((i for i in items if any(u["url"].rstrip("/").endswith("/" + slug) for u in i["uses"])), None)
    if mine is None:
        return c.post("/api/library", json={"body": text, "linkTo": slug})
    return c.post("/api/library/" + mine["slug"], json={"body": text})


NOTES = """# My site

Make a home page and an about page.

```tests
# a comment
has h1
has 3 li
has exactly 2 img
h1 contains welcome
img has alt
links to about.html
h1 color is red
click #btn -> #out contains 1        (2 points)
logs Hello
uses addEventListener
avoids innerHTML
defines greet
about.html: has h2
```
"""

# ------------------------------------------------------------- the format
print("\nThe format")
tests, errors = autograde.parse(NOTES)
kinds = [t["kind"] for t in tests]
check("thirteen tests, comment skipped",
      kinds == ["count", "count", "count", "contains", "attr", "links", "style",
                "contains", "logs", "uses", "avoids", "defines", "count"], kinds)
check("has counts at least one, a number, or exactly",
      (tests[0]["n"], tests[0]["exact"], tests[1]["n"], tests[2]["exact"], tests[2]["n"])
      == (1, False, 3, True, 2))
check("contains splits on the first ' contains '",
      tests[3]["selector"] == "h1" and tests[3]["text"] == "welcome")
check("a style check is selector, property, value",
      (tests[6]["selector"], tests[6]["prop"], tests[6]["value"]) == ("h1", "color", "red"))
check("a click names what to click and what to check after",
      tests[7]["click"] == "#btn" and tests[7]["selector"] == "#out" and tests[7]["points"] == 2)
check("a page prefix sends the line to that page",
      tests[12]["page"] == "about.html" and tests[12]["selector"] == "h2"
      and all(t["page"] == "" for t in tests[:12]))
check("labels read as sentences",
      [t["label"] for t in tests] == [
          "Has h1", "Has at least 3 li", "Has exactly 2 img", "h1 contains welcome",
          "Every img has alt", "Links to about.html", "h1 color is red",
          "After clicking #btn: #out contains 1", "Logs Hello", "Uses addEventListener",
          "Doesn't use innerHTML", "Defines greet()", "about.html: Has h2"],
      [t["label"] for t in tests])
_, errs = autograde.parse("```tests\nmake it pretty\nhas exactly li\n```")
check("a line that isn't a test is an error, not skipped",
      len(errs) == 2 and all("isn't a test" in e for e in errs), errs)
check("possible points add up", autograde.possible({"notes.md": NOTES}) == 14)

# ------------------------------------------------- the same in JavaScript
node = shutil.which("node")
if not node:
    check("node is here", False, "brew install node")
    sys.exit(1)
check("#id starts a test; only # and a space is a comment",
      [t["selector"] for t in autograde.parse("```tests\n#named color is red\n#\n#  note\n```")[0]]
      == ["#named"])
samples = [NOTES, "```tests\n#named background-color is rgb(255, 99, 71)  (2 points)\n# note\nnav a background-color is #333\nul > li contains  Milk  (3 points)\n```",
           "```tests\nmake it pretty\nabout.html: uses fetch\nhas exactly li\n```", "no block here",
           "```tests\nclick button.go -> has 4 li\nform has action  (1 point)\n```"]
script = ("global.window={};eval(require('fs').readFileSync(%s,'utf8'));"
          "process.stdout.write(JSON.stringify(%s.map(s=>window.WebIDETests.parse(s))))"
          % (json.dumps(AUTOGRADE), json.dumps(samples)))
out = subprocess.run([node, "-e", script], capture_output=True, text=True)
try:
    js = json.loads(out.stdout)
except ValueError:
    js = []
check("node read autograde.js", len(js) == len(samples), out.stderr[-300:])
for i, (s, j) in enumerate(zip(samples, js)):
    py = autograde.parse(s)
    same = j["tests"] == py[0] and j["errors"] == py[1]
    check("  sample %d reads the same in both" % (i + 1), same,
          "" if same else "js=%r py=%r" % (j, py))

# ------------------------------------------- results headed by their slide
print("\nCheck my work heads the results with their slide")
SLIDES_MD = ("theme: arcade\n# Lesson\n\n```tests\nuses for\n```\n\n---\n\n"
             "```python\n# not the title\n```\n\n## Step 1 — show_title\n\n```text\n---\n```\n\n"
             "```tests\ndefines show_title\n```\n\n---\n\n---\n\n## Step 2 — round_header\n\n"
             "```tests\ndefines show_title\ndefines round_header\n```\n")
script = ("global.window={};const fs=require('fs');"
          "eval(fs.readFileSync(%s,'utf8'));eval(fs.readFileSync(%s,'utf8'));"
          "const T=window.%s,N=window.%s,md=%s;"
          "process.stdout.write(JSON.stringify([T.places({'notes.md':md,'main.py':''},N),"
          "T.places({'notes.md':'```tests\\nuses for\\n```'},N)]))"
          % (json.dumps(os.path.join(ROOT, "static", "notes.js")), json.dumps(AUTOGRADE),
             "WebIDETests", "PyIDENotes", json.dumps(SLIDES_MD)))
out = subprocess.run([node, "-e", script], capture_output=True, text=True)
try:
    placed, flat = json.loads(out.stdout)
except ValueError:
    placed, flat = None, None
check("each test is given the slide it's on, numbered as the viewer numbers",
      [(p or {}).get("slide") for p in placed or []] == [1, 2, 3, 3], (placed, out.stderr[-300:]))
check("  under that slide's heading, not a # in its code",
      [(p or {}).get("title") for p in placed or []]
      == ["Lesson", "Step 1 — show_title", "Step 2 — round_header", "Step 2 — round_header"], placed)
check("  and notes without slides get no headings", flat == [None], flat)

# ------------------------------------------ the checks, in a real browser
print("\nRunning the checks (headless Chrome)")
RIGHT = {
    "index.html": """<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
<body><h1>Welcome to   my SITE</h1>
<ul><li>a</li><li>b</li><li>c</li></ul>
<img src="a.png" alt="A"><img src="b.png" alt="B">
<a href="about.html">About</a>
<button id="btn">Go</button><p id="out">0</p>
<script src="script.js"></script></body></html>""",
    "style.css": "h1 { color: red; }",
    "script.js": "function greet() { return 'hi'; }\n"
                 "document.getElementById('btn').addEventListener('click', function () {\n"
                 "  document.getElementById('out').textContent = '1';\n});\n"
                 "console.log('Hello there');\n",
    "about.html": "<h2>About me</h2>",
}


def variant(**changes):
    files = dict(RIGHT)
    for name, (old, new) in changes.items():
        assert old in files[name], (name, old)
        files[name] = files[name].replace(old, new)
    return files


SITES = {
    "right": RIGHT,
    "blue": variant(**{"style.css": ("red", "blue")}),
    "no_alt": variant(**{"index.html": ('alt="B"', "")}),
    "dead_button": variant(**{"script.js": ("addEventListener('click'", "onclick = (")}),
    "three_img": variant(**{"index.html": ('<a href', '<img src="c.png" alt="C"><a href')}),
    "inner": variant(**{"script.js": ("textContent = '1'", "innerHTML = '1'")}),
    "no_about": {k: v for k, v in RIGHT.items() if k != "about.html"},
    "endless": variant(**{"script.js": ("console.log('Hello there');", "while (true) {}")}),
}
if not os.path.exists(CHROME) or not os.path.isdir(WS):
    check("Chrome and node_modules/ws are here", False)
    sys.exit(1)
work = tempfile.mkdtemp()
page = os.path.join(work, "run.html")
with open(page, "w") as f:
    f.write('<!doctype html><html><body><script src="file://%s"></script>'
            '<script src="file://%s"></script></body></html>' % (RUNNER, AUTOGRADE))
driver = r"""
const { spawn } = require("child_process");
const WebSocket = require(process.env.WS);
const [chromePath, page, sitesFile, notes] = process.argv.slice(2);
const sites = JSON.parse(require("fs").readFileSync(sitesFile, "utf8"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--allow-file-access-from-files", "--user-data-dir=" + require("os").tmpdir() + "/agw" + Date.now(),
  "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list;
  for (let i = 0; i < 80 && !list; i++) {
    try { list = await (await fetch("http://127.0.0.1:" + port + "/json")).json(); } catch (e) { await sleep(250); }
  }
  const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));
  let id = 0; const wait = {};
  ws.on("message", m => { const d = JSON.parse(m); if (d.id && wait[d.id]) { wait[d.id](d.result); delete wait[d.id]; } });
  const send = (method, params) => new Promise(r => { const n = ++id; wait[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async e => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };
  await send("Page.navigate", { url: "file://" + page });
  await sleep(1500);
  const out = {};
  for (const name of Object.keys(sites)) {
    const t0 = Date.now();
    out[name] = await js("window.WebIDETests.run(" + JSON.stringify(sites[name]) + ", window.WebIDETests.parse("
                         + JSON.stringify(notes) + ").tests)");
    if (out[name]) out[name].ms = Date.now() - t0;
  }
  process.stdout.write(JSON.stringify(out));
  chrome.kill(); process.exit(0);
})();
"""
dpath = os.path.join(work, "driver.js")
spath = os.path.join(work, "sites.json")
with open(dpath, "w") as f:
    f.write(driver)
with open(spath, "w") as f:
    json.dump(SITES, f)
env = dict(os.environ, WS=WS)
try:
    out = subprocess.run([node, dpath, CHROME, page, spath, NOTES], capture_output=True,
                         text=True, timeout=300, env=env)
    ran = json.loads(out.stdout or "{}")
except (subprocess.TimeoutExpired, ValueError) as e:
    ran = {}
check("Chrome ran every site", all(ran.get(n) for n in SITES),
      sorted(n for n in SITES if not ran.get(n)))


def lines(name):
    return {r["label"]: r for r in (ran.get(name) or {}).get("results", [])}


r = ran.get("right") or {}
check("the right site passes everything: 14 of 14",
      r.get("earned") == 14 and r.get("possible") == 14,
      [(x["label"], x["detail"]) for x in r.get("results", []) if not x["ok"]])
L = lines("blue")
check("a blue h1 fails only the colour, saying what it is",
      not L["h1 color is red"]["ok"] and "rgb(0, 0, 255)" in L["h1 color is red"]["detail"]
      and ran["blue"]["earned"] == 13, L.get("h1 color is red"))
L = lines("no_alt")
check("an img without alt fails 'Every img has alt', saying how many",
      not L["Every img has alt"]["ok"] and "1 of 2" in L["Every img has alt"]["detail"])
L = lines("dead_button")
check("a button that does nothing fails the click, saying what #out says",
      not L["After clicking #btn: #out contains 1"]["ok"]
      and "It says: 0" in L["After clicking #btn: #out contains 1"]["detail"]
      and not L["Uses addEventListener"]["ok"])
L = lines("three_img")
check("three imgs fails 'exactly 2', saying it has 3",
      not L["Has exactly 2 img"]["ok"] and "It has 3" in L["Has exactly 2 img"]["detail"]
      and L["Every img has alt"]["ok"])
L = lines("inner")
check("avoids catches innerHTML", not L["Doesn't use innerHTML"]["ok"]
      and L["After clicking #btn: #out contains 1"]["ok"])
L = lines("no_about")
check("a missing page says so", not L["about.html: Has h2"]["ok"]
      and "There's no about.html" in L["about.html: Has h2"]["detail"])
L = lines("endless")
check("a page that never finishes fails, with a reason, instead of hanging",
      bool(L) and not L["Has h1"]["ok"] and "didn't finish" in L["Has h1"]["detail"]
      and L["Uses addEventListener"]["ok"], (L.get("Has h1"), (ran.get("endless") or {}).get("ms")))
check("contains and logs ignore case and spacing",
      lines("right")["h1 contains welcome"]["ok"] and lines("right")["Logs Hello"]["ok"]
      and lines("blue")["Logs Hello"]["ok"])

print()
failed = results.count(False)
print("%d checks, %s" % (len(results), "all ok" if not failed else "%d FAILED" % failed))
sys.exit(1 if failed else 0)
