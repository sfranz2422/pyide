/* Run -> Stop -> Run, the cycle a student does all lesson.
 *
 *     node tools/test_canvas_cycle.mjs
 *
 * Two separate bugs have lived in this cycle, both of which let the first game
 * run perfectly and broke the second:
 *
 *   1. kaplay() freed the previous game's Python callbacks while the previous
 *      engine was still running  ->  "Object has already been destroyed"
 *   2. the canvas was reused after Kaplay had lost its WebGL context  ->  the
 *      second game ran, drew to nothing, and looked like it had not started
 *
 * The second is what this file is really for: it models a canvas the way a
 * browser behaves, where losing the context is permanent.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const results = [];
const check = (label, cond, extra = "") => {
  results.push(cond);
  console.log("  %s %s%s", cond ? "ok  " : "FAIL", label.padEnd(50), extra);
};

// --- a canvas that behaves like a real one ---------------------------------
let created = 0;
function makeCanvas() {
  created++;
  return {
    id: "canvas", className: "", width: 800, height: 600, tabIndex: 0, title: "",
    contextLost: false,
    listeners: 0,
    addEventListener() { this.listeners++; },
    focus() {},
    // a browser hands out one context per canvas, forever
    getContext() { return this.contextLost ? null : { live: true }; },
    parentNode: null,
  };
}

let current = makeCanvas();
const parent = {
  replaceChild(next, old) { next.parentNode = parent; current = next; },
};
current.parentNode = parent;

globalThis.window = {};
globalThis.document = {
  getElementById: (id) => (id === "canvas" ? current : null),
  createElement: (tag) => (tag === "canvas" ? makeCanvas() : { style: {}, addEventListener(){} }),
  head: { appendChild() {} },
};

new Function("window", "document", "fetch",
             readFileSync(join(ROOT, "static", "game.js"), "utf8"))
  (globalThis.window, globalThis.document, async () => ({ ok: false }));

const G = globalThis.window.PyIDEGame;
check("game.js exposes freshCanvas", typeof G.freshCanvas === "function");

// --- the cycle -------------------------------------------------------------
const first = G.freshCanvas();
check("starting a game installs a canvas", !!first && first === current);
check("the bridge is pointed at it", globalThis.window.__pyideCanvas === first);
check("it can render", first.getContext() !== null);

// Kaplay quits: the context is lost, permanently, and the element is now dead
first.contextLost = true;
check("after Stop the old canvas cannot render again", first.getContext() === null);

const second = G.freshCanvas();
check("a second Run installs a NEW element", second !== first, "created " + created);
check("the new one can render", second.getContext() !== null);
check("the bridge follows the swap", globalThis.window.__pyideCanvas === second);
check("the dead one is out of the document", document.getElementById("canvas") === second);
check("it keeps the size and id", second.id === "canvas" && second.width === 800);

const third = G.freshCanvas();
check("and again, a third time", third !== second && third.getContext() !== null);

console.log();
const passed = results.every(Boolean);
console.log(passed ? `ALL PASSED (${results.length} checks)`
                   : `${results.filter((r) => !r).length} of ${results.length} FAILED`);
process.exit(passed ? 0 : 1);
