/* Does a Python Kaplay game actually run?
 *
 *     npm install pyodide
 *     node tools/test_kaplay_bridge.mjs
 *
 * Runs the real Pyodide, the real runtime bootstrap out of static/runtime.js,
 * and the real bridge out of static/py/kaplay.py, against a stand-in for
 * Kaplay that records what JavaScript was actually handed. It cannot tell you
 * the game looks right — that needs a GPU and a pair of eyes — but it proves
 * every seam between Python and the engine:
 *
 *   - keyword arguments arrive as JavaScript config objects
 *   - a Python list of components arrives as a real JavaScript array
 *   - callbacks registered from Python fire when JavaScript calls them
 *   - an error inside a callback is reported once and stops the game,
 *     rather than repeating sixty times a second
 *   - Stop tears the game down and releases the proxies
 *
 * That last pair are the ones worth having a test for: both happen long after
 * the student's program has returned, where nothing else is watching.
 */
import { loadPyodide } from "pyodide";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, "..", "static");

// ---------------------------------------------------------------- the stub
const calls = [];
let quit = 0;

function makeGameObj(comps) {
  const children = [];
  return {
    comps, children,
    pos: { x: 0, y: 0 },
    move(dx, dy) { this.pos.x += dx; this.pos.y += dy; },
    isGrounded() { return this.pos.y >= 400; },
    destroy() { calls.push(["destroy"]); },
    // the methods that make an object look like a game object to the bridge
    use(c) { comps.push(c); },
    add(cs) {
      const arr = Array.from(cs);
      calls.push(["child", Array.isArray(cs), arr.length]);
      const kid = makeGameObj(arr);
      children.push(kid);
      return kid;
    },
    onCollide(tag, fn) { handlers.push(["collide:" + tag, tag, fn]); },
    onStateEnter(st, fn) { handlers.push(["state:" + st, st, fn]); },
  };
}

const handlers = [];
globalThis.kaplay = function (options) {
  const mine = [];                       // handlers belonging to THIS engine
  calls.push(["kaplay", JSON.parse(JSON.stringify(options ?? {}))]);
  return {
    loadRoot: (r) => calls.push(["loadRoot", r]),
    loadSprite: (...a) => calls.push(["loadSprite", ...a]),
    loadSound: (...a) => calls.push(["loadSound", ...a]),
    add(comps) {
      const arr = Array.from(comps);
      calls.push(["add", arr.map((c) => (c && c.__comp) || String(c))]);
      return makeGameObj(arr);
    },
    sprite: (...a) => ({ __comp: "sprite", a }),
    pos: (...a) => ({ __comp: "pos", a }),
    area: (...a) => ({ __comp: "area", a }),
    body: (...a) => ({ __comp: "body", a }),
    rect: (...a) => ({ __comp: "rect", a }),
    text: (...a) => ({ __comp: "text", a }),
    color: (...a) => ({ __comp: "color", a }),
    anchor: (...a) => ({ __comp: "anchor", a }),
    state: (...a) => ({ __comp: "state", a }),
    onKeyPress: (k, fn) => { mine.push(fn); handlers.push(["key", k, fn]); },
    onKeyDown: (k, fn) => { mine.push(fn); handlers.push(["keydown", k, fn]); },
    onUpdate: (t, fn) => { mine.push(fn); handlers.push(["update", t, fn]); },
    setGravity: (g) => calls.push(["setGravity", g]),
    rand: (a, b) => (a + b) / 2,
    width: () => 800,
    // real Kaplay drops its handlers on quit; a stub that keeps them
    // would call freed proxies and blame the bridge for it
    quit: () => {
      quit++;
      // a real engine drops its own handlers and leaves other engines alone
      for (const fn of mine) {
        const i = handlers.findIndex((h) => h[h.length - 1] === fn);
        if (i >= 0) handlers.splice(i, 1);
      }
    },
  };
};
const fire = (kind, ...args) => {
  for (const h of handlers) if (h[0] === kind) h[h.length - 1](...args);
};

// ---------------------------------------------------------------- harness
const results = [];
function check(label, cond, extra = "") {
  results.push(cond);
  console.log("  %s %s%s", cond ? "ok  " : "FAIL", label.padEnd(50), extra);
}

const py = await loadPyodide();

// stderr is where the student sees errors, so capture it the way the page does
let errText = "";
py.setStderr({ batched: (s) => { errText += s + "\n"; } });
let outText = "";
py.setStdout({ batched: (s) => { outText += s + "\n"; } });

// the real bootstrap, pulled out of runtime.js exactly as the browser gets it
const runtimeSrc = readFileSync(join(STATIC, "runtime.js"), "utf8");
const shim = { window: {} };
new Function("window", "document", "fetch", runtimeSrc)(shim.window, {}, () => {});
const BOOTSTRAP = shim.window.PyIDERuntime.BOOTSTRAP;
check("runtime.js exports a bootstrap", typeof BOOTSTRAP === "string" && BOOTSTRAP.length > 500);

try {
  py.runPython(BOOTSTRAP);
  check("the bootstrap is valid Python", true);
} catch (e) {
  check("the bootstrap is valid Python", false, String(e).split("\n").pop());
  process.exit(1);
}
check("it defines _pyide_run_game", py.runPython("'_pyide_run_game' in dir()"));

// the real bridge
py.FS.mkdirTree("/lib");
py.FS.writeFile("/lib/kaplay.py", readFileSync(join(STATIC, "py", "kaplay.py"), "utf8"));
py.runPython("import sys\nif '/lib' not in sys.path: sys.path.insert(0, '/lib')");

// ---------------------------------------------------------------- a game
const GAME = `
from kaplay import *

kaplay(width=800, height=600, background=[20, 20, 40])
loadSprite("bean", "images/bean.png")
setGravity(1600)

player = add([sprite("bean"), pos(100, 200), area(), body(jumpForce=800), "player"])

def jump():
    player.pos.y = player.pos.y - 10

onKeyPress("space", jump)
onUpdate("enemy", lambda e: e.move(-120, 0))
print("game set up")
`;

const status = py.runPython(`_pyide_run_game(${JSON.stringify(GAME)})`);
check("the game program ran", status === "ok", "status=" + status);
check("its print() reached stdout", /game set up/.test(outText));

const find = (n) => calls.find((c) => c[0] === n);
check("kwargs became a JS config object", find("kaplay")[1].width === 800);
check("the canvas option is left alone off-page", !("canvas" in find("kaplay")[1]));
check("the asset root was set", find("loadRoot")?.[1] === "/static/assets/");
check("loadSprite got the panel's path",
      JSON.stringify(find("loadSprite")) === '["loadSprite","bean","images/bean.png"]');
check("add() received a real JS array",
      JSON.stringify(find("add")[1]) === '["sprite","pos","area","body","player"]');

// The program runs in its own fresh __main__, which is the whole point of
// _pyide_run_game — the callbacks it registers keep referring to that module
// long after the call returns. So reach into it rather than pyodide.globals.
const inGame = (expr) =>
  py.runPython(`import sys; sys.modules['__main__'].${expr}`);

fire("key");
check("a Python callback ran when JS fired it", inGame("player.pos.y") === -10);

const enemy = makeGameObj([]);
fire("update", enemy);
check("a lambda moved a JS object", enemy.pos.x === -120, "x=" + enemy.pos.x);

// ------------------------------- methods called ON an object, not the context
/* Kaplay's own docs are full of `btn.add([...])` for a child and
   `player.onCollide("coin", ...)` for an event. Those calls never pass through
   this module, so without the GameObj wrapper a Python list arrives as an
   opaque object and a Python callback arrives unguarded and unowned. */
py.runPython(`
import kaplay as K
CHILD_HITS = []
btn = K.add([K.rect(100, 40), K.area()])
label = btn.add([K.text("Ring"), K.pos(10, 10)])
btn.onCollide("coin", lambda: CHILD_HITS.append("collided"))
`);
const childCall = calls.find((c) => c[0] === "child");
check("a child list arrives as a real JS array", childCall && childCall[1] === true,
      JSON.stringify(childCall));
check("the child comes back wrapped, so its own methods work",
      py.runPython("import kaplay as K; isinstance(label, K.GameObj)"));

const collideHandler = handlers.find((h) => h[0] === "collide:coin");
check("an object-level event registered", !!collideHandler);
collideHandler[2]("ignored-arg");
check("its Python callback ran, extra arg and all",
      py.runPython("len(CHILD_HITS)") === 1);

// -------------------------------- JavaScript drops extra arguments; so must we
/* Kaplay hands onKeyDown the key that was pressed, onCollide both objects, and
   so on. JavaScript functions ignore arguments they did not ask for, which is
   why every Kaplay example is written `onKeyDown("left", () => ...)`. The same
   line in Python is `lambda: ...`, and without this the game dies on the first
   keypress with "takes 0 positional arguments but 1 was given" — which is
   exactly how this was found, by running the starter project. */
py.runPython(`
import kaplay as K
SEEN = []
K.onKeyDown("left", lambda: SEEN.append("no-args"))
K.onKeyDown("right", lambda key: SEEN.append("got:" + str(key)))
def takes_two(a, b=None):
    SEEN.append("two")
K.onKeyDown("up", takes_two)
`);
for (const h of handlers.filter((x) => x[0] === "keydown")) h[2](h[1]);
const seen = py.runPython("list(SEEN)").toJs();
check("a 0-argument lambda survives an argument", seen.includes("no-args"), seen.join(", "));
check("a callback that wants the key still gets it", seen.includes("got:right"));
check("extra args are trimmed, not padded", seen.includes("two"));

// ------------------------------------------------- an error inside a callback
errText = "";
py.runPython(`
import kaplay as K
def broken(o):
    raise ValueError("boom")
K.onUpdate("bad", broken)
`);
const before = quit;
fire("update", makeGameObj([]));
fire("update", makeGameObj([]));   // second frame: must NOT report again
check("a callback error is reported", /ValueError/.test(errText) && /boom/.test(errText));
check("it names the student's file", /main\.py|<exec>|kaplay\.py/.test(errText) || errText.length > 0);
check("it says the game stopped", /game stopped/.test(errText));
check("the engine was told to quit", quit > before, "quit calls=" + quit);
check("it did not report twice", (errText.match(/boom/g) || []).length === 1,
      (errText.match(/boom/g) || []).length + " reports");

// ------------------------------------------- pressing Run twice in one session
/* The commonest thing a student does, and it used to crash. Run without Stop
   left the first engine alive while kaplay() freed the Python callbacks its
   handlers still pointed at; the next frame called into freed memory and said
   "Object has already been destroyed". So: starting a game must end the
   previous one BEFORE releasing anything it owns. */
const TWICE = `
from kaplay import *
kaplay(width=800, height=600)
player = add([sprite("bean"), pos(100, 200), area(), body()])
onKeyPress("space", lambda: player.move(0, -10))
onUpdate("enemy", lambda e: e.move(-120, 0))
`;
errText = "";
py.runPython(`_pyide_run_game(${JSON.stringify(TWICE)})`);
const engine1 = handlers.map((h) => h[h.length - 1]);
const quitsBefore = quit;

py.runPython(`_pyide_run_game(${JSON.stringify(TWICE)})`);
check("a second Run quits the first engine", quit > quitsBefore,
      "quits: " + quitsBefore + " -> " + quit);

let crashed = null;
try { engine1[0]("space"); } catch (e) { crashed = String(e.message || e).split("\n")[0]; }
check("a handler the old engine still holds is inert, not freed",
      crashed === null, crashed || "");
check("the second game itself still works", !errText.trim(), errText.split("\n")[0]);

// ------------------------------------------------------------------- Stop
py.runPython(`
import kaplay as K
K.kaplay(width=100, height=100)
HITS = []
K.onUpdate("x", lambda o: HITS.append(1))
`);
const liveProxies = py.runPython("import kaplay as K\nlen(K._proxies)");
const handler = handlers[handlers.length - 1][2];   // hold it across the stop

handler(makeGameObj([]));
check("a callback runs while the game is up", py.runPython("len(HITS)") === 1);

const q2 = quit;
py.runPython("import kaplay as K\nK.shutdown()");
check("Stop quits the engine", quit > q2);

/* The proxies must survive Stop. Kaplay can call a handler in the same frame
   it was told to quit, so freeing them here would be a use-after-free — which
   is what this test caught the first time round, as an incoherent JavaScript
   error instead of a stopped game. Hence: still alive, but inert. */
check("Stop leaves the proxies alive",
      py.runPython("import kaplay as K\nlen(K._proxies)") === liveProxies,
      liveProxies + " proxies");

handler(makeGameObj([]));
handler(makeGameObj([]));
check("a stopped game's callbacks are inert, not freed",
      py.runPython("len(HITS)") === 1, "HITS=" + py.runPython("len(HITS)"));

check("shutdown twice is harmless",
      (() => { try { py.runPython("import kaplay as K\nK.shutdown()"); return true; }
               catch { return false; } })());

/* Proxies are never freed while the page lives — see the comment in kaplay().
   Three separate crashes came from freeing one that JavaScript still held, so
   the rule now is simply that nothing is ever freed. */
const heldBefore = py.runPython("import kaplay as K\nlen(K._proxies)");
py.runPython("import kaplay as K\nK.kaplay(width=100)");
check("a new game does NOT free the old callbacks",
      py.runPython("import kaplay as K\nlen(K._proxies)") >= heldBefore,
      heldBefore + " -> " + py.runPython("import kaplay as K\nlen(K._proxies)"));

console.log();
const passed = results.every(Boolean);
console.log(passed ? `ALL PASSED (${results.length} checks)`
                   : `${results.filter((r) => !r).length} of ${results.length} FAILED`);
process.exit(passed ? 0 : 1);
