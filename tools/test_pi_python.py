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
FILES = [os.path.join(ROOT, "static", f) for f in ("runtime.js", "world_model.js", "pi_circuit.js", "pi_sense.js", "pi_camera.js", "turtle.js", "pi.js")]
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

HAT = "from sense_hat import SenseHat\nfrom time import sleep\nsense = SenseHat()\n"

CAM = "from picamera import PiCamera\nfrom time import sleep\ncamera = PiCamera()\n"

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
    # The Sense HAT (chapter 7).
    ("hat", {}, HAT + "sense.clear()\nsense.set_pixel(0, 0, 255, 0, 0)\nsense.set_pixel(7, 0, (0, 255, 0))\n"
     "print(sense.get_pixel(0, 0), sense.get_pixel(7, 0))\n", [], ""),
    ("hatkept", {}, HAT + "print(sense.get_pixel(0, 0))\n", [], ""),
    ("rotate", {}, HAT + "sense.clear()\nsense.set_pixel(0, 0, 255, 0, 0)\nsense.set_rotation(90)\n"
     "print(sense.get_pixel(0, 0))\nsense.set_rotation(0)\nflipped = sense.flip_h()\nprint(flipped[7], flipped[0])\n", [], ""),
    ("rotateonly", {}, HAT + "sense.clear()\nsense.set_pixel(0, 0, 255, 0, 0)\nsense.set_rotation(90)\n", [], ""),
    ("scroll", {}, HAT + "sense.show_message('Hi', scroll_speed=0.02, text_colour=(255, 255, 0))\nprint('done')\n",
     [[150, "sample", None], [250, "sample", None]], ""),
    ("letter", {}, HAT + "sense.show_letter('I', (0, 0, 255))\n"
     "print([x for x in range(8) if sense.get_pixel(x, 1) != [0, 0, 0]])\n", [], ""),
    ("sensors", {}, HAT + "sleep(0.15)\nprint(round(sense.get_temperature(), 1), sense.get_humidity(), sense.get_pressure())\n"
     "o = sense.get_orientation()\nprint(o['pitch'], o['roll'], o['yaw'], sense.get_compass())\n"
     "a = sense.get_accelerometer_raw()\nprint(round(a['x'], 2), round(a['y'], 2), round(a['z'], 2))\n",
     [[10, "env", ["temperature", 31.47]], [10, "env", ["humidity", 60]], [10, "env", ["pressure", 990.5]],
      [10, "env", ["pitch", 90]], [10, "env", ["yaw", 270]]], ""),
    ("events", {}, HAT + "sleep(0.3)\nfor event in sense.stick.get_events():\n    print(event.direction, event.action)\n"
     "print(len(sense.stick.get_events()))\n",
     [[50, "stick", ["up", "pressed"]], [80, "stick", ["up", "released"]]], ""),
    ("waitev", {}, HAT + "e = sense.stick.wait_for_event()\nprint(e.direction, e.action, type(e).__name__)\n",
     [[150, "stick", ["left", "pressed"]]], ""),
    ("callbacks", {}, HAT + "sense.clear()\ndef red():\n    sense.clear(255, 0, 0)\n"
     "def which(event):\n    print('any', event.direction, event.action)\n"
     "sense.stick.direction_up = red\nsense.stick.direction_middle = sense.clear\nsense.stick.direction_any = which\n"
     "while True:\n    pass\n",
     [[100, "stick", ["up", "pressed"]], [200, "sample", None], [250, "stick", ["middle", "pressed"]],
      [350, "sample", None], [450, "stop", None]], ""),
    ("cberror", {}, HAT + "def up():\n    print('up')\n    1 / 0\nsense.stick.direction_up = up\nwhile True:\n    pass\n",
     [[100, "stick", ["up", "pressed"]], [2500, "stop", None]], ""),
    ("hatlinger", {}, HAT + "sense.stick.direction_any = lambda: print('pushed')\n",
     [[200, "stick", ["down", "pressed"]], [400, "stop", None]], ""),
    ("hatbad", {}, HAT + "sense.set_pixel(8, 0, 255, 0, 0)\n", [], ""),
    ("hatcolour", {}, HAT + "sense.set_pixel(0, 0, 300, 0, 0)\n", [], ""),
    ("emu", {}, "from sense_emu import SenseHat\nsense = SenseHat()\nsense.low_light = True\nprint(sense.low_light)\n"
     "sense.clear()\n", [], ""),
    # The camera (chapter 8).
    ("photo", {}, CAM + "camera.rotation = 180\ncamera.start_preview()\nsleep(0.1)\ncamera.capture('image.jpg')\n"
     "camera.stop_preview()\nwith open('image.jpg', 'rb') as file:\n    print(file.read()[:3] == b'\\xff\\xd8\\xff')\n", [], ""),
    ("bookpath", {}, CAM + "camera.capture('/home/pi/Desktop/image.jpg')\nimport os\nprint(os.path.exists('/home/pi/Desktop/image.jpg'))\n", [], ""),
    ("frames", {}, CAM + "for frame in range(1, 4):\n    camera.capture('frame%03d.jpg' % frame)\n", [], ""),
    ("bright", {}, CAM + "camera.brightness = 120\n", [], ""),
    ("effect", {}, CAM + "camera.image_effect = 'sparkly'\n", [], ""),
    ("rot", {}, CAM + "camera.rotation = 100\nprint(camera.rotation)\n", [], ""),
    ("twocams", {}, CAM + "other = PiCamera()\n", [], ""),
    ("withcam", {}, "from picamera import PiCamera\nwith PiCamera() as camera:\n    camera.capture('a.png')\nprint(camera.closed)\n"
     "camera.capture('b.jpg')\n", [], ""),
    ("record", {}, CAM + "camera.start_recording('video.h264')\ncamera.wait_recording(0.1)\ncamera.stop_recording()\nprint('ended')\n", [], ""),
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
    else if (what === "stick") Pi.stick(part[0], part[1]);
    else if (what === "env") Pi.setEnv(part[0], part[1]);
    else if (what === "tpush") window.PyIDETurtle.push(part);
    else if (what === "sample") samples.push(Object.assign(JSON.parse(JSON.stringify(Pi.state().result)), { fb: Pi.sense().fb, turtles: JSON.parse(JSON.stringify(window.PyIDETurtle.drawing().turtles)) }));
  }, ms));
  py.globals.set("_pyide_source", src);
  const t0 = Date.now();
  const status = await py.runPythonAsync("_pyide_run_pi(_pyide_source, " + id + extra + ")");
  timers.forEach(clearTimeout);
  Pi.endRun();
  out.runs[name] = { status, ms: Date.now() - t0, text: lines.join(""), samples,
                     afterLit: Object.keys(Pi.state().result.lit).length, hat: Pi.sense(), photos: Pi.camera.photos(),
                     drawing: window.PyIDETurtle.drawing() };
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

    # The Sense HAT.
    def px(fb, i):
        return fb[i * 4:i * 4 + 4] if fb else None

    hat = g("hat")
    check("Sense HAT: a colour reads back as the LEDs show it (5-6-5 bits), as on the real board",
          "[248, 0, 0] [0, 252, 0]" in hat.get("text", ""), hat)
    check("Sense HAT: set_pixel lights that LED on the page", px(hat.get("hat", {}).get("fb"), 0) == "f800"
          and px(hat.get("hat", {}).get("fb"), 7) == "07e0", hat)
    check("Sense HAT: the LEDs stay lit after the run, and the next run reads them",
          "[248, 0, 0]" in g("hatkept").get("text", ""), g("hatkept"))
    ro = g("rotate")
    check("set_rotation(90) turns the picture on the board, and (0, 0) still reads the same",
          ro.get("text", "").startswith("[248, 0, 0]"), ro)
    rf = g("rotateonly").get("hat", {}).get("fb")
    check("…on the board, the top-left pixel moves to the top-right at 90°", px(rf, 7) == "f800" and px(rf, 0) == "0000", rf)
    check("flip_h mirrors each row (and returns the pixels)", "[248, 0, 0] [0, 0, 0]" in ro.get("text", "")
          and px(ro.get("hat", {}).get("fb"), 7) == "f800" and px(ro.get("hat", {}).get("fb"), 0) == "0000", ro)
    sc = g("scroll")
    lit = [any(px(s["fb"], i) != "0000" for i in range(64)) for s in sc.get("samples", [])]
    check("show_message scrolls across the LEDs while the program waits for it", sc.get("status") == "ok"
          and "done" in sc.get("text", "") and lit and all(lit) and sc["samples"][0]["fb"] != sc["samples"][1]["fb"], sc)
    check("…and ends scrolled off, the LEDs dark", sc.get("hat", {}).get("fb") == "0" * 256, sc.get("hat"))
    check("show_letter draws the letter in the middle columns", g("letter").get("text", "").strip() == "[2, 3, 4]", g("letter"))
    se = g("sensors")
    check("the sensors read the panel's sliders", "31.5 60.0 990.5" in se.get("text", ""), se)
    check("orientation and compass are the pitch, roll and yaw sliders", "90.0 0.0 270.0 270.0" in se.get("text", ""), se)
    check("tilted 90° the accelerometer feels gravity on x", "-1.0 0.0 0.0" in se.get("text", ""), se)
    ev = g("events")
    check("the book's joystick loop: get_events gives pressed then released, then nothing",
          ev.get("text", "") == "up pressed\nup released\n0\n", ev)
    check("wait_for_event waits for a push and returns an InputEvent", g("waitev").get("text", "").strip()
          == "left pressed InputEvent" and g("waitev").get("ms", 0) >= 140, g("waitev"))
    cb = g("callbacks")
    sm = cb.get("samples", [])
    check("joystick callbacks: direction_up = red turns the matrix red, under `while True: pass`",
          len(sm) == 2 and px(sm[0]["fb"], 0) == "f800" and px(sm[0]["fb"], 63) == "f800", cb)
    check("…direction_middle = sense.clear (called with nothing) clears it",
          len(sm) == 2 and px(sm[0]["fb"], 0) == "f800" and sm[1]["fb"] == "0" * 256, cb)
    check("…a callback that takes an argument gets the event, and direction_any sees every one",
          "any up pressed" in cb.get("text", "") and "any middle pressed" in cb.get("text", ""), cb)
    ce = g("cberror")
    check("an error in a callback under `while True: pass` is the student's error, at once (not a 10 s freeze)",
          ce.get("status") == "error" and "ZeroDivisionError" in ce.get("text", "") and ce.get("ms", 9999) < 1500, ce)
    hl = g("hatlinger")
    check("a program whose last line set a joystick callback keeps running for it",
          "pushed" in hl.get("text", "") and hl.get("status") == "stopped", hl)
    check("set_pixel off the matrix is the real ValueError", "X position must be between 0 and 7" in g("hatbad").get("text", ""), g("hatbad"))
    check("a colour over 255 is the real ValueError", "Pixel elements must be between 0 and 255" in g("hatcolour").get("text", ""), g("hatcolour"))
    em = g("emu")
    check("from sense_emu import SenseHat works the same (the book's emulator)", em.get("status") == "ok"
          and "True" in em.get("text", "") and em.get("hat", {}).get("low") is True, em)

    # The camera.
    ph = g("photo")
    check("camera.capture writes a real JPEG the program can open", ph.get("status") == "ok" and "True" in ph.get("text", ""), ph)
    check("…and the photo shows on the camera panel", (ph.get("photos") or [None])[-1] == "image.jpg", ph.get("photos"))
    check("the book's capture('/home/pi/Desktop/image.jpg') works as written", "True" in g("bookpath").get("text", ""), g("bookpath"))
    fr = g("frames").get("photos", [])
    check("stop-motion: frame001.jpg, frame002.jpg, frame003.jpg, in order", fr[-3:] == ["frame001.jpg", "frame002.jpg", "frame003.jpg"], fr)
    check("brightness out of range is picamera's own error", "PiCameraValueError" in g("bright").get("text", "")
          and "Invalid brightness value: 120" in g("bright").get("text", ""), g("bright"))
    check("an image effect it hasn't is picamera's own error", "Invalid image effect: sparkly" in g("effect").get("text", ""), g("effect"))
    check("a rotation is rounded down to a multiple of 90, as picamera does", g("rot").get("text", "").strip() == "90", g("rot"))
    check("a second PiCamera while one is open fails as on a Pi", "Out of resources" in g("twocams").get("text", ""), g("twocams"))
    wc = g("withcam")
    check("`with PiCamera() as camera:` closes it, and a closed camera says so",
          "True" in wc.get("text", "") and "PiCameraClosed" in wc.get("text", "") and "a.png" in wc.get("photos", []), wc)
    rc = g("record")
    check("recording where the browser can't still runs the program, and says no video was saved",
          rc.get("status") == "ok" and "ended" in rc.get("text", "") and "no video was saved" in rc.get("text", ""), rc)

    check("time.sleep is the real one again after a run", g("after").get("sleepModule") == "time", g("after"))

    # Safari: no turns. A program that lights and ends still works.
    r2 = run_node([RUNS[0]] + [x for x in RUNS if x[0] == "hat"], False)
    h2 = r2.get("hello", {})
    check("without JSPI: says why, and Hello LED still runs", h2.get("status") == "ok"
          and "can't keep the Pi moving" in h2.get("text", "") and "lit True" in h2.get("text", ""), h2)
    check("without JSPI: the Sense HAT still draws", "[248, 0, 0] [0, 252, 0]" in r2.get("hat", {}).get("text", ""), r2.get("hat"))

    print("%d checks, %s" % (count, "all ok" if not failures else "%d FAILED" % failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
