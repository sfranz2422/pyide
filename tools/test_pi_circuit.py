#!/usr/bin/env python3
"""The simulated Pi's breadboard (static/pi_circuit.js), in node: what a
circuit does when the program sets its pins, and the ways a real one wired
wrong fails, which is the point of students wiring it themselves.

    python3 tools/test_pi_circuit.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.path.join(ROOT, "static", "pi_circuit.js")

HARNESS = r"""
import fs from "fs";
globalThis.window = globalThis;
eval(fs.readFileSync(%(model)s, "utf8"));
const C = window.PyIDEPiCircuit, out = {};
const led = (legs, extra) => Object.assign({ id: "led", type: "led", legs }, extra || {});
const res = (legs) => ({ id: "res", type: "resistor", legs });
const wire = (id, from, to) => ({ id, from, to });
const ev = (circuit, pins, pressed) => C.evaluate(C.load(JSON.stringify(circuit)), pins, pressed);
const HELLO = { parts: [led(["c10", "c11"]), res(["d11", "d14"])], wires: [wire("w1", "P22", "a10"), wire("w2", "a14", "P6")] };
const ON = { 25: { mode: "out", value: 1 } }, OFF = { 25: { mode: "out", value: 0 } };

out.helloOn = ev(HELLO, ON);
out.helloOff = ev(HELLO, OFF);
out.helloUnset = ev(HELLO, {});
// The book's very first circuit: no program, 3V3 (pin 1) through the LED and resistor to GND.
out.threeV3 = ev({ parts: HELLO.parts, wires: [wire("w1", "P1", "a10"), wire("w2", "a14", "P6")] }, {});
out.backwards = ev({ parts: [led(["c11", "c10"]), res(["d11", "d14"])], wires: HELLO.wires }, ON);
out.noResistor = ev({ parts: [led(["c10", "c11"])], wires: [wire("w1", "P22", "a10"), wire("w2", "a11", "P6")] }, ON);
out.resistorFirst = ev({ parts: [res(["c6", "c9"]), led(["c9", "c10"])], wires: [wire("w1", "P22", "a6"), wire("w2", "a10", "P6")] }, ON);
out.sameStrip = ev({ parts: [led(["c10", "d10"])], wires: [wire("w1", "P22", "a10"), wire("w2", "e10", "P6")] }, ON);
out.acrossGap = ev({ parts: [led(["e10", "f10"]), res(["g10", "g13"])], wires: [wire("w1", "P22", "a10"), wire("w2", "j13", "P6")] }, ON);
out.rails = ev({ parts: [led(["c10", "c11"]), res(["d11", "d14"])],
                 wires: [wire("w1", "P22", "a10"), wire("w2", "a14", "t-14"), wire("w3", "t-1", "P6")] }, ON);
out.short = ev({ parts: [], wires: [wire("w1", "P22", "P6")] }, ON);
out.short3v3 = ev({ parts: [], wires: [wire("w1", "P1", "a3"), wire("w2", "b3", "P9")] }, {});
out.pwm = ev(HELLO, { 25: { mode: "out", value: 0.4 } });

const BUTTON = { parts: [{ id: "btn", type: "button", legs: ["e20", "f22"] }],
                 wires: [wire("w1", "P3", "a20"), wire("w2", "j22", "P9")] };
const IN = { 2: { mode: "in", pull: "up" } };
out.btnUp = ev(BUTTON, IN);
out.btnDown = ev(BUTTON, IN, { btn: true });
out.btnOtherPressed = ev(BUTTON, IN, { other: true });
out.btnNoGround = ev({ parts: BUTTON.parts, wires: [wire("w1", "P3", "a20")] }, IN, { btn: true });

const BUZZ = { parts: [{ id: "bz", type: "buzzer", legs: ["c20", "c21"] }], wires: [wire("w1", "P10", "a20"), wire("w2", "a21", "P14")] };
out.buzzOn = ev(BUZZ, { 15: { mode: "out", value: 1 } });
out.buzzOff = ev(BUZZ, { 15: { mode: "out", value: 0 } });

// The file: canonical, empty saves empty, junk loads empty, bad points dropped.
const c = C.load(JSON.stringify(HELLO));
out.saveSame = C.save(C.load(C.save(c))) === C.save(c);
out.emptySave = C.save(C.create());
out.junk = C.load("{nope").parts.length;
out.badPoint = C.load(JSON.stringify({ parts: [led(["z99", "c11"])], wires: [wire("w", "P41", "a1")] }));
out.used = C.used(c);
out.addTwice = (() => { const k = C.create(); C.addPart(k, "led", ["c1", "c2"]); C.addPart(k, "led", ["c3", "c4"]);
  return k.parts.map(p => p.id); })();
out.removed = (() => { const k = C.load(JSON.stringify(HELLO)); const ok = C.remove(k, "res"); return [ok, k.parts.length]; })();
out.header = [C.HEADER[1], C.HEADER[6], C.HEADER[22], C.HEADER[3], C.HEADER[40], C.physicalOf(25), C.physicalOf(2)];
console.log(JSON.stringify(out));
"""

failures = 0
count = 0


def check(name, ok, detail=""):
    global failures, count
    count += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  -- " + json.dumps(detail)[:400]))
    if not ok:
        failures += 1


def main():
    proc = subprocess.run(["node", "--input-type=module", "-e", HARNESS % {"model": json.dumps(MODEL)}],
                          capture_output=True, text=True, cwd=ROOT, timeout=60)
    if proc.returncode:
        print(proc.stderr[-2000:])
        sys.exit(1)
    o = json.loads(proc.stdout.strip().splitlines()[-1])
    check("Hello LED: GPIO 25 on lights it, with no warning", o["helloOn"]["lit"].get("led") == 1 and not o["helloOn"]["warnings"], o["helloOn"])
    check("Hello LED: off is dark", not o["helloOff"]["lit"], o["helloOff"])
    check("a pin the program never set up powers nothing", not o["helloUnset"]["lit"], o["helloUnset"])
    check("the book's first circuit: 3V3 through LED and resistor lights with no program", o["threeV3"]["lit"].get("led"), o["threeV3"])
    check("an LED in backwards stays dark", not o["backwards"]["lit"], o["backwards"])
    check("no resistor: lit, and flagged", o["noResistor"]["lit"].get("led") and any("resistor" in w for w in o["noResistor"]["warnings"]), o["noResistor"])
    check("a resistor on the + side counts too", o["resistorFirst"]["lit"].get("led") and not o["resistorFirst"]["warnings"], o["resistorFirst"])
    check("both legs in one strip: shorted out, dark", not o["sameStrip"]["lit"], o["sameStrip"])
    check("across the centre gap works", o["acrossGap"]["lit"].get("led"), o["acrossGap"])
    check("a rail is one conductor end to end", o["rails"]["lit"].get("led"), o["rails"])
    check("a powered pin wired to GND is a short", any("Short" in w for w in o["short"]["warnings"]), o["short"])
    check("3V3 to GND is a short too", any("Short" in w for w in o["short3v3"]["warnings"]), o["short3v3"])
    check("PWM: brightness is the pin's value", abs(o["pwm"]["lit"].get("led", 0) - 0.4) < 1e-9, o["pwm"])
    check("button up: the pulled-up pin reads 1", o["btnUp"]["reads"].get("2") == 1, o["btnUp"])
    check("button held: it joins the pin to GND, reads 0", o["btnDown"]["reads"].get("2") == 0, o["btnDown"])
    check("another button held changes nothing here", o["btnOtherPressed"]["reads"].get("2") == 1, o["btnOtherPressed"])
    check("a button with no GND wire never reads pressed", o["btnNoGround"]["reads"].get("2") == 1, o["btnNoGround"])
    check("buzzer: sounds when its pin is on", o["buzzOn"]["sounding"].get("bz") and not o["buzzOff"]["sounding"], [o["buzzOn"], o["buzzOff"]])
    check("saving is canonical: load→save is the same text", o["saveSame"], o["saveSame"])
    check("an empty board saves as nothing", o["emptySave"] == "", o["emptySave"])
    check("a file that isn't JSON loads as an empty board", o["junk"] == 0, o["junk"])
    check("parts and wires on points that don't exist are dropped", not o["badPoint"]["parts"] and not o["badPoint"]["wires"], o["badPoint"])
    check("used() knows every leg and wire end", o["used"].get("c10") == "led" and o["used"].get("d14") == "res" and o["used"].get("a14"), o["used"])
    check("new parts get new ids", len(set(o["addTwice"])) == 2, o["addTwice"])
    check("remove takes the part out", o["removed"] == [True, 1], o["removed"])
    check("the header: pin 1 3V3, 6 GND, 22 is GPIO25, 3 is GPIO2, 40 is GPIO21; GPIO25 is pin 22",
          o["header"] == ["3V3", "GND", 25, 2, 21, 22, 3], o["header"])
    print("%d checks, %s" % (count, "all ok" if not failures else "%d FAILED" % failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
