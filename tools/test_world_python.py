#!/usr/bin/env python3
"""Programs that import mcpi, run as the page runs them, in node's Pyodide.

    python3 tools/test_world_python.py

A world program runs on the page's own thread, and has to take turns with
the page (mcpi/_pyide.py, _pyide_run_world in runtime.js) or the world
freezes and Stop can't be pressed. Here the real bootstrap, the real
world_model.js and the BUNDLED mcpi package (what the browser loads, not the
.py files) run in node's Pyodide — with stack switching switched on, as it
is in Chrome, and once more without it, as in Safari.

The ways it breaks without a sign, which these checks are for:

  * Pi lesson code building the wrong thing, or getPos and getTilePos coming
    back as the wrong kind of number (a lesson that does range(x, x + 5)
    with a float x stops with a TypeError on a Pi too, but not the other way)
  * time.sleep blocking the page instead of giving it a turn
  * Stop not ending a `while True:` loop — with mcpi calls, with sleep, with
    neither, and when the program catches KeyboardInterrupt and carries on
  * time.sleep left patched after the run, slowing the next console program
  * the bundle not being the package (a change that was never rebuilt)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNTIME = os.path.join(ROOT, "static", "runtime.js")
MODEL = os.path.join(ROOT, "static", "world_model.js")
BUNDLE = os.path.join(ROOT, "static", "py", "mcpi_bundle.json")
PYODIDE = os.path.join(ROOT, "node_modules", "pyodide", "pyodide.mjs")
sys.path.insert(0, HERE)

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-70s %s" % ("ok" if ok else "FAIL", label, "" if ok else detail))


HEAD = "from mcpi.minecraft import Minecraft\nfrom mcpi import block\nimport time\nmc = Minecraft.create()\n"

RUNS = [
    # name, source, stop after (ms) or None, extra Python arguments
    ("turns", HEAD + "import mcpi._pyide as w\nprint('turns', w.can_yield())\n", None, ""),
    ("house", HEAD + """
mc.player.setTilePos(0, 10, 0)
x, y, z = mc.player.getTilePos()
mc.setBlocks(x + 2, y, z + 2, x + 6, y + 4, z + 6, block.STONE.id)
mc.setBlocks(x + 3, y, z + 3, x + 5, y + 3, z + 5, block.AIR.id)
mc.setBlock(x + 4, y, z + 2, block.AIR.id)
mc.postToChat("House built!")
print("done")
""", None, ""),
    ("types", HEAD + """
from mcpi.vec3 import Vec3
mc.player.setPos(1.5, 20, -2.25)
p = mc.player.getPos()
t = mc.player.getTilePos()
print(type(p.x).__name__, type(t.x).__name__, p, t)
v = Vec3(1, 2, 3) + Vec3(1, 1, 1) * 2
print(v, v.length() == (9 + 16 + 25) ** 0.5, -v)
mc.setBlock(Vec3(5, 30, 5), block.WOOL.withData(14))
print(mc.getBlockWithData(5, 30, 5), mc.getBlock(5.9, 30.2, 5.5))
print(mc.getHeight(5, 5) >= 30, mc.getPlayerEntityIds())
try:
    mc.entity.getPos(7)
except Exception as err:
    print(type(err).__name__)
""", None, ""),
    ("events", HEAD + """
for h in mc.events.pollBlockHits():
    print("hit", h.pos, h.face, h.entityId, h.type)
for c in mc.events.pollChatPosts():
    print("chat", c.entityId, c.message)
print(mc.events.pollBlockHits(), mc.events.pollChatPosts())
""", None, ""),
    ("sleeps", HEAD + """
from time import sleep
for i in range(4):
    time.sleep(0.05)
    sleep(0.05)
print("slept")
""", None, ""),
    ("forever_calls", HEAD + "while True:\n    mc.getBlock(0, 0, 0)\n", 300, ""),
    ("forever_sleep", HEAD + "while True:\n    pos = mc.player.getPos()\n    time.sleep(0.1)\n", 300, ""),
    ("forever_busy", HEAD + "n = 0\nwhile True:\n    n += 1\n", 300, ""),
    # Stop in the middle of a long sleep: Pyodide's own time.sleep would
    # finish the 30 seconds first; mcpi's wakes for Stop.
    ("long_sleep", HEAD + "time.sleep(30)\nprint('woke on its own')\n", 300, ""),
    # A loop the guard doesn't watch (code from somewhere other than the
    # student's files, as a library's would be): only the mcpi calls' own
    # turns let the page hear Stop.
    ("calls_unwatched", HEAD + "exec(compile('while True:\\n    mc.getBlock(0, 0, 0)\\n', '<library>', 'exec'))\n", 300, ""),
    ("tidy", HEAD + """
try:
    while True:
        mc.player.getPos()
        time.sleep(0.05)
except KeyboardInterrupt:
    mc.postToChat("bye")
    print("tidied up")
""", 300, ""),
    ("swallows", HEAD + """
while True:
    try:
        time.sleep(0.05)
    except KeyboardInterrupt:
        pass
""", 300, ""),
    # The guard's own turns broken, as in a browser that can't switch stacks
    # from inside the tracer: the quiet limit is what's left, and says so.
    ("frozen", HEAD + """
import mcpi._pyide as w
def broken(force=False):
    raise RuntimeError("no turns from the tracer here")
w.breathe = broken
while True:
    pass
""", None, ", True, 1"),
    ("example", open(os.path.join(ROOT, "examples", "06_block_world.py")).read(), 400, ""),
    ("mistake", HEAD + "mc.setBlock(1, 2)\n", None, ""),
    # A program that changes mcpi itself: the next run gets the package as it is.
    ("meddle", HEAD + "block.STONE.id = 99\nprint('changed', block.STONE)\n", None, ""),
    ("after_meddle", HEAD + "print('stone is', block.STONE)\n", None, ""),
]

HARNESS = r"""
import { loadPyodide } from %(pyodide)s;
import fs from "fs";

globalThis.window = globalThis;
globalThis.getSelection = () => null;
eval(fs.readFileSync(%(runtime)s, "utf8"));
eval(fs.readFileSync(%(model)s, "utf8"));
const R = window.PyIDERuntime, M = window.PyIDEWorldModel;
let world = M.create({ seed: 5 });
const bridge = M.makeBridge(world, cb => setTimeout(cb, 0));
globalThis.PyIDEWorld = bridge;
const said = [];
world.onChange((what, text) => { if (what === "chat") said.push(text); });

let lines = [];
const py = await loadPyodide();
R.pipeOutput(py, (text, cls) => lines.push((cls === "err" ? "!" : "") + text));
py.runPython(R.BOOTSTRAP);
const files = JSON.parse(fs.readFileSync(%(bundle)s, "utf8"));
for (const rel of Object.keys(files)) {
  py.FS.mkdirTree("/lib/mcpi");
  py.FS.writeFile("/lib/mcpi/" + rel, files[rel]);
}
py.runPython("import sys\nif '/lib' not in sys.path: sys.path.insert(0, '/lib')");

const out = { runs: {} };
const runs = %(runs)s;
for (const [name, src, stopAfter, extra] of runs) {
  if (name === "events") { world.hitBlock(3, 4, 5, 1); world.chatPost("hi there"); }
  lines = [];
  said.length = 0;
  let beats = 0;
  const beat = setInterval(() => { beats += 1; }, 5);
  const id = bridge.beginRun();
  if (stopAfter) setTimeout(() => bridge.requestStop(), stopAfter);
  py.globals.set("_pyide_source", src);
  const t0 = Date.now();
  const status = await py.runPythonAsync("_pyide_run_world(_pyide_source, " + id + extra + ")");
  bridge.endRun();
  clearInterval(beat);
  out.runs[name] = { status, ms: Date.now() - t0, text: lines.join(""), said: said.slice(), beats };
  // Each run as it ends: a run that never ends (a broken turn) leaves the
  // ones before it reported when the test gives up on it.
  console.log("RUN " + JSON.stringify([name, out.runs[name]]));
  if (name === "house") {
    let stone = 0;
    for (let x = 2; x <= 6; x++) for (let y = 10; y <= 14; y++) for (let z = 2; z <= 6; z++) if (world.get(x, y, z) === 1) stone++;
    out.runs[name].stone = stone;
    out.runs[name].door = world.get(4, 10, 2);
    out.runs[name].inside = world.get(4, 11, 4);
  }
}
out.sleepAfter = py.runPython("import time\ntime.sleep.__module__");
console.log(JSON.stringify(out));
"""


def run_node(runs, jspi):
    flags = ["--experimental-wasm-jspi"] if jspi else []
    try:
        proc = subprocess.run(
            ["node"] + flags + ["--input-type=module", "-e", HARNESS % {
                "pyodide": json.dumps(PYODIDE), "runtime": json.dumps(RUNTIME), "model": json.dumps(MODEL),
                "bundle": json.dumps(BUNDLE), "runs": json.dumps(runs)}],
            capture_output=True, text=True, cwd=ROOT, timeout=300)
    except subprocess.TimeoutExpired as hung:
        # A run that never gave the page a turn: the page (here, node) can't
        # even fire the Stop. The runs before it still count.
        stdout = hung.stdout.decode() if isinstance(hung.stdout, bytes) else (hung.stdout or "")
        print("  (gave up on a run that never let the page have a turn)")
        return {"runs": dict(json.loads(l[4:]) for l in stdout.splitlines() if l.startswith("RUN "))}
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(proc.stdout[-2000:], proc.stderr[-3000:])
        return {"runs": {}}


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    if not os.path.exists(PYODIDE):
        print("node_modules/pyodide is missing: npm install")
        sys.exit(1)

    print("the bundle")
    import build_mcpi
    with open(BUNDLE, encoding="utf-8") as f:
        bundled = json.load(f)
    check("static/py/mcpi_bundle.json is the package as it is (python3 tools/build_mcpi.py)",
          bundled == build_mcpi.bundle(), sorted(set(bundled) ^ set(build_mcpi.bundle())))
    check("…our own code: no one else's copyright notice in it",
          not any("Copyright" in t or "All rights reserved" in t for t in bundled.values()))

    got = run_node(RUNS, jspi=True)
    r = got["runs"]
    print("with stack switching (Chrome, Edge)")
    check("a world program can take turns with the page here", "turns True" in r.get("turns", {}).get("text", ""), r.get("turns"))
    h = r.get("house", {})
    check("a Pi lesson's house: stone walls, hollow inside, a door", h.get("status") == "ok"
          and h.get("stone") == 88 and h.get("door") == 0 and h.get("inside") == 0, h)
    check("…its chat posted, its print printed", h.get("said") == ["House built!"] and "done" in h.get("text", ""), h)
    t = r.get("types", {}).get("text", "")
    check("getPos gives floats, getTilePos whole blocks, as on a Pi",
          "float int Vec3(1.5,20.0,-2.25) Vec3(1,20,-3)" in t, t)
    check("Vec3 sums, scaling, length and minus", "Vec3(3,4,5) True Vec3(-3,-4,-5)" in t, t)
    check("setBlock takes a Vec3 and a Block with data; getBlock rounds down",
          "Block(35, 14) 35" in t, t)
    check("getHeight and the player's entity id", "True [1]" in t, t)
    check("a command the world refuses is a RequestError", "RequestError" in t, t)
    e = r.get("events", {}).get("text", "")
    check("a block hit with the sword comes back from pollBlockHits", "hit Vec3(3,4,5) 1 1 0" in e, e)
    check("…chat typed in the world from pollChatPosts", "chat 1 hi there" in e, e)
    check("…and each only once", "[] []" in e, e)
    s = r.get("sleeps", {})
    check("time.sleep lets the page run meanwhile (time and from-import alike)",
          s.get("status") == "ok" and s.get("beats", 0) >= 30, s)
    for name, what in (("forever_calls", "a loop of mcpi calls"), ("forever_sleep", "a loop that sleeps"),
                       ("forever_busy", "a loop that does neither")):
        run = r.get(name, {})
        check("Stop ends %s" % what, run.get("status") == "stopped" and run.get("ms", 9e9) < 1500,
              {k: run.get(k) for k in ("status", "ms", "text")})
    ls = r.get("long_sleep", {})
    check("Stop wakes a program in the middle of a long time.sleep",
          ls.get("status") == "stopped" and ls.get("ms", 9e9) < 1500 and "woke" not in ls.get("text", ""), ls)
    cu = r.get("calls_unwatched", {})
    check("…and a loop of mcpi calls the guard doesn't watch (each call takes its turn)",
          cu.get("status") == "stopped" and cu.get("ms", 9e9) < 1500, cu)
    td = r.get("tidy", {})
    check("…as KeyboardInterrupt, so a lesson's except can tidy up",
          td.get("status") == "stopped" and "tidied up" in td.get("text", "") and td.get("said") == ["bye"], td)
    sw = r.get("swallows", {})
    check("…and a program that catches it and carries on is ended anyway",
          sw.get("status") == "stopped" and sw.get("ms", 9e9) < 4000, sw)
    fz = r.get("frozen", {})
    check("a loop that never lets the world have a turn is stopped, saying what to add",
          fz.get("status") == "timeout" and "time.sleep(0.1)" in fz.get("text", ""), fz)
    ex = r.get("example", {})
    check("examples/06_block_world.py builds its house and ends tidily on Stop",
          ex.get("status") == "stopped" and ex.get("said", [])[-1:] == ["Bye!"]
          and "Done!" in " ".join(ex.get("said", [])), ex)
    mk = r.get("mistake", {})
    check("a mistake is a traceback naming the line", mk.get("status") == "error"
          and "RequestError" in mk.get("text", "") and "line 5" in mk.get("text", ""), mk)
    check("a change a program makes to mcpi is gone by the next run",
          "changed Block(99, 0)" in r.get("meddle", {}).get("text", "")
          and "stone is Block(1, 0)" in r.get("after_meddle", {}).get("text", ""),
          (r.get("meddle"), r.get("after_meddle")))
    check("time.sleep is Python's own again after a world program", got.get("sleepAfter") == "time",
          got.get("sleepAfter"))

    print("without stack switching (Safari)")
    plain = run_node([RUNS[0], RUNS[1], ("forever_sleep", RUNS[6][1], None, ", True, 10, 1")], jspi=False)
    pr = plain["runs"]
    check("…and can't here, without the flag", "turns False" in pr.get("turns", {}).get("text", ""), pr.get("turns"))
    check("a program that builds and finishes still works", pr.get("house", {}).get("status") == "ok"
          and pr.get("house", {}).get("stone") == 88, pr.get("house"))
    fs = pr.get("forever_sleep", {})
    check("…one that keeps going gets the time limit, with a sentence saying why",
          fs.get("status") == "timeout" and "This browser can't keep the world moving" in fs.get("text", ""), fs)

    bad = results.count(False)
    print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
