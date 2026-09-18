/* Run every Python code block in a guide through the real Kaplay bridge.
 *
 *     node tools/test_guide.mjs ../learn_pykaplay.md
 *
 * Every fenced ```python block containing `from kaplay import *` is treated as
 * a whole lesson: it is executed through _pyide_run_game exactly as pressing
 * Run would, against a stand-in for Kaplay, and then every callback it
 * registered is fired once. A lesson passes only if nothing reached stderr.
 *
 * This is what a guide needs that a spell-check cannot give: it catches a
 * function that isn't star-imported, a keyword argument Kaplay doesn't take,
 * and a callback whose arguments don't line up — all of which look perfectly
 * fine on the page. It found three such bugs the first time it was run.
 */
import { loadPyodide } from "pyodide";
import { readFileSync } from "fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/test_guide.mjs <markdown file>");
  process.exit(2);
}
const md = readFileSync(target, "utf8");
const blocks = [...md.matchAll(/```python\n([\s\S]*?)```/g)].map(m => m[1]);

// A stand-in broad enough for every lesson.
const handlers = [];
function comp(k) { return (...a) => ({ __comp: k, a }); }
function obj(comps) {
  const o = {
    comps, pos: { x: 0, y: 0, sub: () => ({ unit: () => ({}) }), },
    text: "", flipX: false, paused: false, volume: 1,
    move(){}, moveTo(){}, jump(){}, isGrounded: () => true, destroy(){},
    exists: () => true, use(){}, play(){}, curAnim: () => "idle",
    add(cs) { return obj(Array.from(cs)); },
    onCollide(t, f) { handlers.push(f); }, onCollideUpdate(){}, onCollideEnd(){},
    onClick(f) { handlers.push(f); }, onGround(f) { handlers.push(f); },
    onStateEnter(s, f) { handlers.push(f); }, onStateUpdate(s, f) { handlers.push(f); },
    enterState(){}, onUpdate(f){ handlers.push(f); },
  };
  return o;
}
globalThis.kaplay = () => {
  const ctx = {
    loadRoot(){}, loadSprite(){}, loadSound(){}, loadSpriteAtlas(){}, loadFont(){},
    add: (cs) => obj(Array.from(cs)),
    get: (t) => [obj([])],
    addLevel: (layout, cfg) => {
      /* Call every tile factory AND use what it gives back, the way the real
         addLevel does. Merely calling them is not enough: the bug this
         missed was a Python list returned to JavaScript, which only fails at
         the moment Kaplay touches it. */
      const tiles = cfg.tiles || (cfg.get && cfg.get("tiles"));
      if (tiles) for (const k of Object.keys(tiles)) {
        const comps = tiles[k]();
        if (!Array.isArray(comps)) {
          throw new Error("tile '" + k + "' returned " + typeof comps +
                          ", not an array of components");
        }
        comps.parent = "level";      // what really blew up
      }
      return { get: () => [obj([])], tile2Pos: () => ({ x: 0, y: 0 }) };
    },
    addKaboom(){}, destroy(){},
    setGravity(){}, setBackground(){}, setCamPos(){}, setCamScale(){}, shake(){},
    width: () => 800, height: () => 600, center: () => ({ x: 400, y: 300 }),
    dt: () => 1/60, time: () => 0,
    vec2: (x, y) => ({ x, y, sub: () => ({ unit: () => ({}) }) }),
    rand: (a, b) => (a + b) / 2, randi: (a, b) => a, choose: (l) => Array.from(l)[0],
    rgb: () => ({}), mousePos: () => ({ x: 0, y: 0 }), toWorld: (p) => p,
    play: () => ({ paused: false, volume: 1 }),
    scene(){}, go(){}, wait(s, f) { handlers.push(f); }, loop(s, f) { handlers.push(f); },
    tween(){}, onUpdate(...a) { handlers.push(a[a.length-1]); },
    onDraw(){}, onKeyDown(...a) { handlers.push(a[a.length-1]); },
    onKeyPress(...a) { handlers.push(a[a.length-1]); },
    onKeyRelease(...a) { handlers.push(a[a.length-1]); },
    onClick(...a) { handlers.push(a[a.length-1]); },
    onCollide(...a) { handlers.push(a[a.length-1]); },
    debug: { inspect: false },
    quit(){},
  };
  for (const c of ["sprite","pos","area","body","anchor","scale","rotate","color",
                   "opacity","outline","text","rect","circle","z","fixed","move",
                   "offscreen","lifespan","health","timer","stay","state","tile","animate"])
    ctx[c] = comp(c);
  return ctx;
};

const py = await loadPyodide();
let err = "";
py.setStderr({ batched: s => { err += s + "\n"; } });
py.setStdout({ batched: () => {} });
py.FS.mkdirTree("/lib");
py.FS.writeFile("/lib/kaplay.py",
  readFileSync(new URL("../static/py/kaplay.py", import.meta.url), "utf8"));
py.runPython("import sys; sys.path.insert(0, '/lib')");

const runtimeSrc = readFileSync(new URL("../static/runtime.js", import.meta.url), "utf8");
const sh = { window: {} };
new Function("window","document","fetch",runtimeSrc)(sh.window, {}, ()=>{});
py.runPython(sh.window.PyIDERuntime.BOOTSTRAP);

let pass = 0, fail = 0;
blocks.forEach((b, i) => {
  if (!b.includes("from kaplay import")) return;     // fragments, not whole lessons
  handlers.length = 0;
  err = "";
  const status = py.runPython(`_pyide_run_game(${JSON.stringify(b)})`);
  let fired = 0;
  for (const h of handlers) { try { h(obj([])); fired++; } catch (e) {} }
  const ok = status === "ok" && !err.trim();
  console.log("  %s block %s  %s handlers registered, %s fired",
              ok ? "ok  " : "FAIL", String(i + 1).padStart(2), String(handlers.length).padStart(2), fired);
  if (!ok) { fail++; console.log(err.split("\n").slice(0, 6).map(l => "        " + l).join("\n")); }
  else pass++;
});
console.log("\n%d whole lessons ran, %d failed", pass, fail);
process.exit(fail ? 1 : 0);
