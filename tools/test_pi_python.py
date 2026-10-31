#!/usr/bin/env python3
"""The simulated Raspberry Pi, end to end: real Pyodide, the real
static/py/pi packages (from their bundle), runtime.js's _pyide_run_pi, and
pi.js with pi_circuit.js underneath — the book's programs on a breadboard
wired the way the book wires it, and the ways a wrong one fails.

    python3 tools/test_pi_python.py

Needs node (and Pyodide in node_modules, as the other Pyodide suites do).
Runs once with JSPI (Chrome's turns) and a few programs again without it
(Safari: no turns, the console's limit).
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_pi  # noqa: E402

PYODIDE = os.path.join(ROOT, "node_modules", "pyodide", "pyodide.mjs")
FILES = [os.path.join(ROOT, "static", f) for f in ("runtime.js", "world_model.js", "pi_circuit.js", "pi.js")]
BUNDLE = os.path.join(ROOT, "static", "py", "pi_bundle.json")

failures = 0
count = 0


def check(name, ok, detail=""):
    global failures, count
    count += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  -- " + str(detail)[:600]))
    if not ok:
        failures += 1


# The book's Hello LED wiring: GPIO 25 (pin 22) to the LED's long leg, its
# short leg through a 330Ω resistor to GND (pin 6).
LED25 = {"v": 1, "parts": [
    {"id": "led", "type": "led", "legs": ["c10", "c11"], "colour": "red"},
    {"id": "res", "type": "resistor", "legs": ["d11", "d14"], "ohms": 330}],
    "wires": [{"id": "w1", "from": "P22", "to": "a10"}, {"id": "w2", "from": "a14", "to": "P6"}]}
BACKWARDS = json.loads(json.dumps(LED25))
BACKWARDS["parts"][0]["legs"] = ["c11", "c10"]
NO_RESISTOR = {"v": 1, "parts": [{"id": "led", "type": "led", "legs": ["c10", "c11"]}],
               "wires": [{"id": "w1", "from": "P22", "to": "a10"}, {"id": "w2", "from": "a11", "to": "P6"}]}
# A button from GPIO 15 (pin 10) and one from GPIO 14 (pin 8), both to GND
# (pin 14): the Quick Reaction Game's, with its LED on GPIO 4 (pin 7).
REACTION = {"v": 1, "parts": [
    {"id": "led", "type": "led", "legs": ["c5", "c6"]},
    {"id": "res", "type": "resistor", "legs": ["d6", "d9"]},
    {"id": "right", "type": "button", "legs": ["e15", "f17"]},
    {"id": "left", "type": "button", "legs": ["e22", "f24"]}],
    "wires": [{"id": "w1", "from": "P7", "to": "a5"}, {"id": "w2", "from": "a9", "to": "t-9"},
              {"id": "w3", "from": "P10", "to": "a15"}, {"id": "w4", "from": "j17", "to": "b-17"},
              {"id": "w5", "from": "P8", "to": "a22"}, {"id": "w6", "from": "j24", "to": "b-24"},
              {"id": "w7", "from": "P14", "to": "t-1"}, {"id": "w8", "from": "t-30", "to": "b-30"}]}

# name, circuit, program, events [[ms, "press"|"release"|"stop"|"sample", partId]], extra
RUNS = [
    ("hello", LED25, "from gpiozero import LED\nfrom time import sleep\nled = LED(25)\nled.on()\nsleep(0.3)\n"
     "print('lit', led.is_lit)\nled.off()\nprint('off', led.is_lit)\n", [[150, "sample", None]], ""),
    ("backwards", BACKWARDS, "from gpiozero import LED\nfrom time import sleep\nled = LED(25)\nled.on()\nsleep(0.3)\n",
     [[150, "sample", None]], ""),
    ("bare", NO_RESISTOR, "from gpiozero import LED\nfrom time import sleep\nled = LED(25)\nled.on()\nsleep(0.3)\n",
     [[150, "sample", None]], ""),
    ("unpowered", LED25, "from gpiozero import LED\nfrom time import sleep\nled = LED(24)\nled.on()\nsleep(0.3)\n",
     [[150, "sample", None]], ""),
    ("wait", REACTION, "from gpiozero import Button\nb = Button(15)\nprint('waiting')\nb.wait_for_press()\n"
     "print('pressed', b.is_pressed)\nb.wait_for_release()\nprint('released', b.is_pressed)\n",
     [[150, "press", "right"], [250, "release", "right"]], ""),
    ("reaction", REACTION, "from gpiozero import LED, Button\nfrom time import sleep\nfrom os import _exit\n"
     "led = LED(4)\nright_button = Button(15)\nleft_button = Button(14)\nled.on()\nsleep(0.1)\nled.off()\n"
     "def pressed(button):\n    if button.pin.number == 14:\n        print('Left won the game')\n"
     "    else:\n        print('Right won the game')\n    _exit(0)\n"
     "right_button.when_pressed = pressed\nleft_button.when_pressed = pressed\n",
     [[400, "press", "left"], [450, "release", "left"], [600, "press", "right"], [2500, "stop", None]], ""),
    ("lefton", LED25, "from gpiozero import LED\nled = LED(25)\nled.on()\n", [], ""),
    ("unwired", REACTION, "from gpiozero import Button\nb = Button(18)\nprint(b.wait_for_press(timeout=0.2))\n", [], ""),
    ("loop", LED25, "from gpiozero import LED\nfrom time import sleep\nled = LED(25)\ntry:\n    while True:\n"
     "        led.toggle()\n        sleep(0.05)\nexcept KeyboardInterrupt:\n    print('tidied up')\n",
     [[300, "stop", None]], ""),
    ("inuse", LED25, "from gpiozero import LED\na = LED(25)\nb = LED(25)\n", [], ""),
    ("badpin", LED25, "from gpiozero import LED\nLED(40)\n", [], ""),
    ("blink", LED25, "from gpiozero import LED\nfrom time import sleep\nled = LED(25)\nled.blink(0.05, 0.05)\n"
     "sleep(0.4)\nprint('done')\n", [[60, "sample", None], [80, "sample", None], [110, "sample", None],
                                     [130, "sample", None], [160, "sample", None], [185, "sample", None]], ""),
    ("traffic", LED25, "from gpiozero import TrafficLights\nlights = TrafficLights(25, 8, 7)\nlights.green.on()\n"
     "print(lights.value, lights.amber is lights.yellow)\n", [], ""),
]

HARNESS = r"""
import { loadPyodide } from %(pyodide)s;
import fs from "fs";

globalThis.window = globalThis;
globalThis.getSelection = () => null;
for (const f of %(files)s) eval(fs.readFileSync(f, "utf8"));
const R = window.PyIDERuntime, Pi = window.PyIDEPi;

let lines = [];
const py = await loadPyodide();
R.pipeOutput(py, (text, cls) => lines.push((cls === "err" ? "!" : "") + text));
py.runPython(R.BOOTSTRAP);
const files = JSON.parse(fs.readFileSync(%(bundle)s, "utf8"));
for (const rel of Object.keys(files)) {
  py.FS.mkdirTree("/lib/" + rel.split("/").slice(0, -1).join("/"));
  py.FS.writeFile("/lib/" + rel, files[rel]);
}
py.runPython("import sys\nif '/lib' not in sys.path: sys.path.insert(0, '/lib')");

const out = { runs: {} };
for (const [name, circuit, src, events, extra] of %(runs)s) {
  Pi.load(JSON.stringify(circuit));
  lines = [];
  const samples = [];
  const id = Pi.beginRun();
  const timers = events.map(([ms, what, part]) => setTimeout(() => {
    if (what === "press") Pi.press(part, true);
    else if (what === "release") Pi.press(part, false);
    else if (what === "stop") Pi.requestStop();
    else if (what === "sample") samples.push(JSON.parse(JSON.stringify(Pi.state().result)));
  }, ms));
  py.globals.set("_pyide_source", src);
  const t0 = Date.now();
  const status = await py.runPythonAsync("_pyide_run_pi(_pyide_source, " + id + extra + ")");
  timers.forEach(clearTimeout);
  Pi.endRun();
  out.runs[name] = { status, ms: Date.now() - t0, text: lines.join(""), samples,
                     afterLit: Object.keys(Pi.state().result.lit).length };
  console.log("RUN " + JSON.stringify([name, out.runs[name]]));
}
console.log("RUN " + JSON.stringify(["after", { sleepModule: py.runPython("import time\ntime.sleep.__module__") }]));
"""


def run_node(runs, jspi):
    flags = ["--experimental-wasm-jspi"] if jspi else []
    proc = subprocess.run(
        ["node"] + flags + ["--input-type=module", "-e", HARNESS % {
            "pyodide": json.dumps(PYODIDE), "files": json.dumps(FILES),
            "bundle": json.dumps(BUNDLE), "runs": json.dumps(runs)}],
        capture_output=True, text=True, cwd=ROOT, timeout=300)
    found = {}
    for line in proc.stdout.splitlines():
        if line.startswith("RUN "):
            name, data = json.loads(line[4:])
            found[name] = data
    if proc.returncode != 0 and not found:
        print(proc.stderr[-2000:])
    return found


def main():
    check("the bundle is the package as it is now (python3 tools/build_pi.py)",
          json.load(open(BUNDLE)) == build_pi.bundle())

    r = run_node(RUNS, True)
    g = lambda n: r.get(n, {})

    h = g("hello")
    check("Hello LED: the program runs and ends", h.get("status") == "ok", h)
    check("Hello LED: lit on the breadboard while on, with no warning",
          h.get("samples") and h["samples"][0]["lit"].get("led") == 1 and not h["samples"][0]["warnings"], h)
    check("Hello LED: is_lit is True while on, False after off", "lit True" in h.get("text", "") and "off False" in h.get("text", ""), h)
    lo = g("lefton")
    check("after a run every pin is let go: an LED left on goes out", lo.get("status") == "ok" and lo.get("afterLit") == 0, lo)

    b = g("backwards")
    check("an LED in backwards stays dark", b.get("samples") and not b["samples"][0]["lit"], b)
    bare = g("bare")
    check("an LED with no resistor lights, and is flagged",
          bare.get("samples") and bare["samples"][0]["lit"].get("led") and
          any("resistor" in w for w in bare["samples"][0]["warnings"]), bare)
    u = g("unpowered")
    check("an LED on a pin the program doesn't drive stays dark", u.get("samples") and not u["samples"][0]["lit"], u)

    w = g("wait")
    check("wait_for_press waits for the button, then is_pressed is True",
          "waiting" in w.get("text", "") and "pressed True" in w.get("text", "") and w.get("ms", 0) >= 140, w)
    check("wait_for_release, then is_pressed is False", "released False" in w.get("text", ""), w)

    q = g("reaction")
    check("Quick Reaction Game: the program keeps running after its last line, for its callbacks",
          q.get("ms", 0) >= 350, q)
    check("Quick Reaction Game: when_pressed gets the button, and pin.number says which",
          "Left won the game" in q.get("text", ""), q)
    check("Quick Reaction Game: _exit(0) ends it at the first press (no second winner)",
          q.get("status") == "ok" and "Right won" not in q.get("text", "") and q.get("ms", 9999) < 590, q)

    uw = g("unwired")
    check("a button on a pin nothing is wired to never reads pressed (timeout → False)",
          uw.get("text", "").strip() == "False", uw)

    lp = g("loop")
    check("Stop is a KeyboardInterrupt, as Ctrl+C is on a Pi", lp.get("status") == "stopped" and "tidied up" in lp.get("text", ""), lp)

    iu = g("inuse")
    check("the same pin twice is GPIOPinInUse", "GPIOPinInUse" in iu.get("text", "") and iu.get("status") == "error", iu)
    bp = g("badpin")
    check("a pin a Pi 3 hasn't is refused, saying which pins are", "PinInvalidPin" in bp.get("text", "")
          and "GPIO2 to GPIO27" in bp.get("text", ""), bp)

    bl = g("blink")
    seen = [bool(s["lit"]) for s in bl.get("samples", [])]
    check("blink() blinks on the page's clock while the program sleeps", True in seen and False in seen, bl)

    t = g("traffic")
    check("TrafficLights: three LEDs, amber is yellow", "(0, 0, 1) True" in t.get("text", ""), t)

    check("time.sleep is the real one again after a run", g("after").get("sleepModule") == "time", g("after"))

    # Safari: no turns. A program that lights and ends still works.
    r2 = run_node([RUNS[0]], False)
    h2 = r2.get("hello", {})
    check("without JSPI: says why, and Hello LED still runs", h2.get("status") == "ok"
          and "can't keep the Pi moving" in h2.get("text", "") and "lit True" in h2.get("text", ""), h2)

    print("%d checks, %s" % (count, "all ok" if not failures else "%d FAILED" % failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
