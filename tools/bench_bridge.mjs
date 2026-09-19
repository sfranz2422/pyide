/* What the bridge costs per frame, measured rather than guessed.
 *
 *     node tools/bench_bridge.mjs
 *
 * The number quoted in static/py/kaplay.py's docstring comes from here. Run it
 * again after changing anything on the hot path — every call a running game
 * makes goes through _call, so a few microseconds there is milliseconds a
 * second in a student's game.
 */
import { loadPyodide } from "pyodide";
import { readFileSync } from "fs";

function comp(k) { return (...a) => ({ __comp: k, a }); }
function obj() {
  const o = { pos: { x: 0, y: 0 }, use() {}, add() { return obj(); },
              move(dx, dy) { o.pos.x += dx; o.pos.y += dy; },
              exists: () => true };
  return o;
}
globalThis.kaplay = () => {
  const ctx = { loadRoot() {}, add: () => obj(), get: () => [], quit() {},
                width: () => 800, height: () => 600, dt: () => 1 / 60,
                vec2: (x, y) => ({ x, y }), debug: {},
                onUpdate() {}, tween() { return { then() {}, cancel() {} }; } };
  for (const c of ["sprite", "pos", "area", "body", "rect"]) ctx[c] = comp(c);
  return ctx;
};

const root = new URL("../", import.meta.url);
const py = await loadPyodide();
py.setStdout({ batched: s => console.log(s) });
py.setStderr({ batched: s => console.log("ERR " + s) });
py.FS.mkdirTree("/lib");
py.FS.writeFile("/lib/kaplay.py",
  readFileSync(new URL("static/py/kaplay.py", root), "utf8"));
py.runPython("import sys; sys.path.insert(0, '/lib')");

const sh = { window: {} };
new Function("window", "document", "fetch",
             readFileSync(new URL("static/runtime.js", root), "utf8"))
  (sh.window, {}, () => {});
py.runPython(sh.window.PyIDERuntime.BOOTSTRAP);

py.runPython(`_pyide_run_game(${JSON.stringify(`
from kaplay import *
import time

kaplay()

N = 200
FRAMES = 120
objs = [add([rect(8, 8), pos(i, 0)]) for i in range(N)]


def bench(label, step):
    for o in objs:                          # warm up
        step(o)
    start = time.perf_counter()
    for _ in range(FRAMES):
        for o in objs:
            step(o)
    total = (time.perf_counter() - start) * 1000
    print("  %-34s %6.2f ms/frame  %4.1f%% of a frame"
          % (label, total / FRAMES, (total / FRAMES) / 16.7 * 100))


def move(o):
    o.move(1.5, 0.5)


def nested(o):
    o.pos.x = o.pos.x + 1.5


def nothing(o):
    pass


print("%d objects, %d frames" % (N, FRAMES))
bench("the loop itself, doing nothing", nothing)
bench("o.move(1.5, 0.5)", move)
bench("o.pos.x = o.pos.x + 1.5", nested)
`)})`);
