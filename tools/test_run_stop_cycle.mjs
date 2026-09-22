/* Run -> Stop -> Run, the cycle a student does all lesson.
 *
 *     node tools/test_run_stop_cycle.mjs
 *
 * This replaces test_canvas_cycle.mjs, which tested the Kaplay days: a lost
 * WebGL context and a `window.__pyideCanvas` the bridge read. Neither exists
 * now. kaypy draws through SDL, which has no context to lose — so the canvas
 * half of this got simpler, and a new half appeared that is worse.
 *
 * THE BUG THIS FILE IS REALLY ABOUT
 *
 * SDL takes the keyboard by putting keydown/keyup/keypress listeners on
 * `document`, and never takes them off. After Stop they are still there,
 * still eating keystrokes meant for the editor — a student presses Stop and
 * cannot type. It is the one bug in this project that reproduced for its
 * author and not for me, which is the kind that has to be held down by a test
 * rather than by having looked at it once.
 *
 * So: three cycles, and after each one the editor must be able to type.
 *
 * WHAT IS BEING TESTED AGAINST
 *
 * The real static/game.js, loaded as source. Pyodide is a stand-in here —
 * there is no way to run WASM in this check — but it is a stand-in for
 * Pyodide, which has a small and stable surface, not for the game engine,
 * which does not. Nothing about kaypy is faked; kaypy is not involved. What
 * a program does once it starts is tools/test_guide.py's job, on the real
 * engine.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const results = [];
const check = (label, cond, extra = "") => {
  results.push(!!cond);
  console.log("  %s %s%s", cond ? "ok  " : "FAIL", label.padEnd(54), extra);
};

/* ---------------------------------------------------------- the document --
 * Real enough for this: listeners go on a list and come off it, so "can the
 * student type?" is a question with an answer.
 */
const docListeners = [];   // {type, fn} — live, deduplicated like the DOM
let keyRegistrations = 0;  // every add call, including ones the DOM ignores
let canvasEl = null;
let created = 0;

function makeCanvas() {
  created++;
  return {
    id: "", className: "pane", width: 800, height: 600, tabIndex: 0,
    title: "the game", parentNode: null,
    focus() {}, addEventListener() {},
  };
}

canvasEl = makeCanvas();
canvasEl.id = "canvas";
const parent = {
  replaceChild(next, old) { next.parentNode = parent; canvasEl = next; },
};
canvasEl.parentNode = parent;

globalThis.window = {};
globalThis.document = {
  getElementById: (id) => (id === "canvas" ? canvasEl : null),
  createElement: (tag) =>
    tag === "canvas" ? makeCanvas() : { style: {}, addEventListener() {} },
  head: { appendChild() {} },
  /* The DOM ignores a listener registered twice with the same type and
     function — so this does too, or the test would fail things a browser
     forgives. The call is still counted, because registering the same
     listener again and again is a leak the browser hides rather than a
     thing that is fine. */
  addEventListener(type, fn) {
    if (/^key/.test(type)) keyRegistrations++;
    if (docListeners.some((l) => l.type === type && l.fn === fn)) return;
    docListeners.push({ type, fn });
  },
  removeEventListener(type, fn) {
    const i = docListeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) docListeners.splice(i, 1);
  },
};

const keyListeners = () => docListeners.filter((l) => /^key/.test(l.type));

/* PyIDE's own document shortcuts — Ctrl+Enter runs, Escape stops — are put on
   at page load, before any game. They must survive everything below. */
const ctrlEnter = () => {};
const escape = () => {};
document.addEventListener("keydown", ctrlEnter);
document.addEventListener("keydown", escape);
const pyideShortcutsIntact = () =>
  docListeners.some((l) => l.fn === ctrlEnter) &&
  docListeners.some((l) => l.fn === escape);

/* ----------------------------------------------------------- Pyodide -----*/
const bundle = JSON.parse(
  readFileSync(join(ROOT, "static", "py", "kaypy_bundle.json"), "utf8"));

let canvasHandedTo = null;
const writes = [];
const pyodide = {
  loadPackage: async (name) => { pyodide.loaded.push(name); },
  loaded: [],
  canvas: { setCanvas2D: (el) => { canvasHandedTo = el; } },
  FS: {
    mkdirTree() {},
    writeFile(path) { writes.push(path); },
  },
  runPython(src) { pyodide.ran.push(src); },
  ran: [],
  _api: {},
};

const fetchStub = async (url) => {
  if (url.endsWith("kaypy_bundle.json")) {
    return { ok: true, json: async () => bundle };
  }
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
};

new Function("window", "document", "fetch",
             readFileSync(join(ROOT, "static", "game.js"), "utf8"))
  (globalThis.window, globalThis.document, fetchStub);

const G = globalThis.window.PyIDEGame;

/* SDL registering its three listeners, which happens inside
   pygame.display.set_mode() — that is, while the student's program runs,
   after ensureReady has returned. */
function sdlStarts() {
  const fns = ["keydown", "keyup", "keypress"].map((type) => {
    const fn = () => {};
    document.addEventListener(type, fn);
    return fn;
  });
  return fns;
}

const SOURCE = 'from kaypy import *\nkaplay()\nloadSprite("bean", "images/bean.png")\n';

// ---------------------------------------------------------------- cycle 1
await G.ensureReady(pyodide, null, SOURCE);
check("the first Run installs a canvas", !!canvasEl && canvasEl.id === "canvas");
check("SDL is handed that exact element", canvasHandedTo === canvasEl);
check("pygame-ce is loaded once", pyodide.loaded.filter(n => n === "pygame-ce").length === 1);
check("the engine is written into the filesystem",
      writes.some((p) => p.endsWith("/lib/kaypy/__init__.py")),
      writes.length + " files");
check("so is the sprite the program names",
      writes.some((p) => p.endsWith("/project/images/bean.png")));
check("the unwind guard is set", pyodide._api._skip_unwind_fatal_error === true);

sdlStarts();
check("while the game runs, SDL holds the keys", keyListeners().length === 5,
      keyListeners().length + " key listeners on document");

G.stop(pyodide);
check("after Stop the student can type", keyListeners().length === 2,
      keyListeners().length + " left — PyIDE's own");
check("and PyIDE's own shortcuts still work", pyideShortcutsIntact());
check("stop asks the engine to end its loop",
      pyodide.ran.some((s) => s.includes("_running = False")));

// ---------------------------------------------------------------- cycle 2
const firstCanvas = canvasEl;
const writesBefore = writes.length;
await G.ensureReady(pyodide, null, SOURCE);
check("a second Run installs a NEW element", canvasEl !== firstCanvas,
      created + " created");
check("and hands the new one to SDL", canvasHandedTo === canvasEl);
check("it keeps the id, size and class",
      canvasEl.id === "canvas" && canvasEl.width === 800
      && canvasEl.className === "pane");
check("the dead one is out of the document",
      document.getElementById("canvas") === canvasEl);
check("SDL's keys come back without SDL re-registering",
      keyListeners().length === 5, "the same three listeners, put back");
check("pygame-ce is not downloaded again",
      pyodide.loaded.filter((n) => n === "pygame-ce").length === 1);
check("nor is the engine unpacked again", writes.length === writesBefore,
      "0 new writes");

G.stop(pyodide);
check("Stop gives the keyboard back a second time", keyListeners().length === 2);

// ---------------------------------------------------------------- cycle 3
// Stop pressed twice, Run pressed while already running: a student will do
// both, and neither may leave a listener on or take one off twice.
G.stop(pyodide);
check("Stop twice is harmless", keyListeners().length === 2);

const registrationsBefore = keyRegistrations;
await G.ensureReady(pyodide, null, SOURCE);
await G.ensureReady(pyodide, null, SOURCE);
check("Run twice does not double the listeners", keyListeners().length === 5);
/* Not "the document looks right" but "how many times were they put on".
   A browser forgives the difference; the list game.js keeps does not, and a
   list that grows by three every Run is the same bug wearing a hat. */
check("and puts SDL's three back exactly once each",
      keyRegistrations - registrationsBefore === 3,
      (keyRegistrations - registrationsBefore) + " registrations");
G.stop(pyodide);
check("and one Stop still clears them", keyListeners().length === 2);
check("PyIDE's shortcuts survived all three cycles", pyideShortcutsIntact());

// ------------------------------------------- a shortcut added after a Run
// The wrapper on document.addEventListener cannot ask who a listener belongs
// to. If it captured everything, a keyboard shortcut registered later — from
// a click handler, say — would be taken away by the next Stop, and Ctrl+Enter
// would quietly die mid-lesson.
const lateShortcut = () => {};
document.addEventListener("keydown", lateShortcut);
await G.ensureReady(pyodide, null, SOURCE);
G.stop(pyodide);
check("a shortcut added after a Run is not eaten by Stop",
      docListeners.some((l) => l.fn === lateShortcut));

console.log();
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} FAILED`
                   : `ALL PASSED (${results.length} checks)`);
process.exit(failed ? 1 : 0);
