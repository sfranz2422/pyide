#!/usr/bin/env python3
"""The simulated Raspberry Pi in the editor: the wiring, read from the source,
and the class page's Raspberry Pi assignments.

    python3 tools/test_pi_editor.py

The breadboard is tested in node (test_pi_circuit.py) and the Pi's Python in
Pyodide (test_pi_python.py). What's left is how the editor hands programs
to it, and each piece fails without a sign when it's missing:

  * the mode rule not knowing gpiozero, so `LED(25)` runs as console code and
    stops with "No module named gpiozero"
  * Run or Stop with no Pi branch, so Stop does nothing to a `while True:`
  * circuit.pi showing as a tab (deleted by a student "tidying up", and the
    wiring with it), or written into Python's files on every run
  * the wiring never saved, so it is gone at the next visit
  * the page not loading pi.js, or loading it before what it needs
"""
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-72s %s" % ("ok" if ok else "FAIL", label, "" if ok else str(detail)[:300]))


def body(source, name):
    m = re.search(r"(?:async )?function %s\(.*?\n  \}\n" % re.escape(name), source, re.S)
    return m.group(0) if m else ""


app = (ROOT / "static" / "app.js").read_text()
demo = (ROOT / "static" / "demo.js").read_text()
pi_js = (ROOT / "static" / "pi.js").read_text()
runtime = (ROOT / "static" / "runtime.js").read_text()
css = (ROOT / "static" / "style.css").read_text()

print("which programs are Pi programs")
mode = re.search(r"function currentMode\(source\)\s*\{(.*?)\n  \}", app, re.S)
mode = mode.group(1) if mode else ""
check("the mode rule knows the Pi", "looksLikePi(source)" in mode, mode)
check("…after kaypy and the block world", mode.find("looksLikeGame") < mode.find("looksLikeWorld") < mode.find("looksLikePi"), mode)
look = re.search(r"function looksLikePi\(source\) \{\s*return (/.*/m)\.test", pi_js)
check("looksLikePi is a regex in pi.js", look is not None)
if look:
    import subprocess
    probe = subprocess.run(["node", "-e", """
const re = %s;
const cases = { "from gpiozero import LED": true, "import gpiozero": true, "from sense_hat import SenseHat": true,
  "from sense_emu import SenseHat": true, "from picamera import PiCamera": true, "  from gpiozero import Button": true,
  "# from gpiozero import LED": false, "print('gpiozero')": false, "import gpiozeroo": false, "x = 1": false,
  "import turtle": true, "from turtle import *": true, "import turtles": false, "# import turtle": false };
let bad = [];
for (const [src, want] of Object.entries(cases)) if (re.test(src) !== want) bad.push(src);
console.log(JSON.stringify(bad));
""" % look.group(1)], capture_output=True, text=True)
    check("…matches gpiozero, sense_hat, sense_emu, picamera and turtle imports, not comments or strings",
          probe.stdout.strip() == "[]", probe.stdout + probe.stderr)

print("running and stopping")
check("Run sends a Pi program to runPi", 'mode === "pi" ? runPi(source)' in app)
rp = body(app, "runPi")
check("runPi loads the packages, then runs _pyide_run_pi with the source in a global",
      "PyIDEPi.loadPackage(pyodide)" in rp and "_pyide_run_pi(_pyide_source" in rp and 'globals.set("_pyide_source", source)' in rp)
check("…and lets the pins go at the end (PyIDEPi.endRun)", "PyIDEPi.endRun()" in rp)
sr = body(app, "stopRun")
check("Stop has a Pi branch that asks the program to stop", 'runMode === "pi"' in sr and "PyIDEPi.requestStop()" in sr)
check("the Stop button shows for a Pi run", 'runMode === "pi"' in body(app, "paintStop"))
check("runtime.js has _pyide_run_pi, sharing the world's turns", "def _pyide_run_pi(" in runtime and "_pyide_run_turns(" in runtime)
check("…and os._exit ends the run, not Python", "os._exit = _pyide_exit" in runtime and "os._exit = real_exit" in runtime)

print("circuit.pi, the student's wiring")
hidden_fn = re.search(r"function hidden\(name\) \{(.*?)\}", app)
check("circuit.pi is hidden like world.mcpi", bool(hidden_fn) and "CIRCUIT_FILE" in hidden_fn.group(1))
check("…no tab", "!hidden(n)" in body(app, "fileNames"))
check("…never written into Python's files", "delete files[CIRCUIT_FILE]" in body(app, "pushFilesToPython"))
check("…nor read back as a new file", "hidden(name)" in body(app, "pullFilesFromPython"))
check("…and a student can't make a file by that name", "CIRCUIT_FILE" in app[app.find("function addFile") if "function addFile" in app else 0:]
      and "where the Pi's breadboard is kept" in app)
check("wiring changes are saved into circuit.pi", "PyIDEPi.onEdit(" in app and "setCircuitFile(window.PyIDEPi.save())" in app)
check("…but never from a read-only snapshot", "if (!window.PYIDE.readonly) setCircuitFile" in app)
check("the board is read-only on a read-only snapshot", "PyIDEPi.setReadonly(!!window.PYIDE.readonly)" in app)

print("the new tab and shared links")
check("demo.js runs Pi programs too, on the project's breadboard",
      "runPi(loaded)" in demo and "loaded.files[CIRCUIT_FILE]" in demo and "_pyide_run_pi(_pyide_source, " in demo)
check("…and keeps circuit.pi out of Python's files", "n !== CIRCUIT_FILE" in demo)

print("the pages")
for page in ("index.html", "demo.html"):
    html = (ROOT / "templates" / page).read_text()
    order = [html.find("filename='%s'" % f) for f in ("world_model.js", "pi_circuit.js", "pi_board.js", "pi_sense.js", "pi_camera.js", "pi.js")]
    check("%s loads world_model.js, then pi_circuit.js, pi_board.js, pi_sense.js, pi_camera.js and pi.js" % page,
          all(i >= 0 for i in order) and order == sorted(order), order)
    check("%s has the Pi's panel in the stage" % page, 'id="pi-view"' in html)
show = body(pi_js, "show")
check("a program that uses the Sense HAT gets its panel (and only then)",
      "hatHost.hidden = !uses.sense" in show and "PyIDEPiSense.mount(" in show)
check("…its joystick's pushes are queued for the program", "stick: stickEvent" in show)
check("a program that uses the camera gets its panel", "camHost.hidden = !uses.camera" in show
      and "PyIDEPiCamera.mount(camHost)" in show)
check("…and the webcam is let go after every run (its light goes off)", "PyIDEPiCamera.reset()" in pi_js[pi_js.find("endRun:"):])
cam_js = (ROOT / "static" / "pi_camera.js").read_text()
check("the webcam is asked for only by the program (start_preview, capture, recording), never on opening",
      cam_js.count("askWebcam();") == 3 and "function preview(" in cam_js)
check("a turtle program gets the turtle's canvas", "turtleHost.hidden = !uses.turtle" in show and "PyIDETurtle.mount(turtleHost)" in show)
check("…and the stage says Turtle, not Raspberry Pi, when that's all it is", '"Turtle" : "Raspberry Pi"' in app)
check("turtle is imported fresh every run, as the Pi's packages are", "'turtle'" in runtime[runtime.find("_PI_PACKAGES ="):runtime.find("_PI_PACKAGES =") + 200])
check("the stage swaps the canvas for the board in Pi mode", "body.is-pi #canvas { display: none; }" in css)

print("Raspberry Pi assignments")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "p.db")
os.environ["SECRET_KEY"] = "k" * 32
sys.path.insert(0, str(ROOT))
import app as P                                               # noqa: E402

db = P.SessionLocal()
t = P.accounts.User(google_sub="tp", email="teacher-p@example.org", name="T")
db.add(t); db.commit(); tid = t.id; db.close()
os.environ["TEACHER_EMAILS"] = "teacher-p@example.org"
tc = P.app.test_client()
with tc.session_transaction() as s:
    s["uid"] = tid
cls = tc.post("/api/class", json={"name": "Hardware"}).get_json()["id"]
made = tc.post("/api/class/%d/new" % cls, json={"title": "Hello LED", "kind": "pi"}).get_json()
row = made and P.SessionLocal().query(P.accounts.Assignment).filter_by(slug=made["slug"]).one()
check("Add to class → Raspberry Pi makes an assignment with an empty breadboard",
      row is not None and row.file_map().get("circuit.pi") == "" and made["url"].endswith("/edit"), made)
check("…and the book's first program, as the starter", row is not None and "from gpiozero import LED" in row.code
      and "LED(25)" in row.code)
check("…with no f-string, since the classroom's Pis run Python 3.4", row is not None and not re.search(r"\bf[\"']", row.code))

bad = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
sys.exit(1 if bad else 0)
