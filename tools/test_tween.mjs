/* Does tween() survive the bridge?
 *
 *     node tools/test_tween.mjs
 *
 * Kaplay's real signature, read out of the vendored library:
 *
 *     tween(from, to, duration, setValue, easeFn = easings.linear)
 *       -> { paused, onEnd(cb), then(cb) -> this, cancel(), finish() }
 *
 * Two things here are unlike anything else the bridge handles. The fourth
 * argument is a callback Kaplay keeps and calls sixty times a second, and the
 * return value is a controller object with methods of its own — which is the
 * shape behind every proxy bug this project has had.
 *
 * So the stub below copies the real thing's behaviour, not its shape: it
 * drives setValue frame by frame, interpolates, fires the end callbacks, and
 * returns a controller that controls something. And every check here asks what
 * ARRIVED, not merely whether an error was raised — a tween that silently does
 * nothing raises nothing at all, and that is the failure worth catching.
 */
import { loadPyodide } from "pyodide";
import { readFileSync } from "fs";

let fail = 0, checks = 0;
function check(ok, label, detail) {
  checks++;
  console.log("  %s %s%s", ok ? "ok  " : "FAIL", label.padEnd(50),
              detail === undefined ? "" : detail);
  if (!ok) fail++;
}

// ---------------------------------------------------------------- the stub
/* The easing NAMES are read out of the vendored library rather than typed
   here, so "easings.easeOutBounce works" is a claim about Kaplay and not about
   this file. The curves themselves are stand-ins; what is being tested is
   whether the name survives the trip from Python into JavaScript. */
const easings = {};
for (const name of new Set(
       readFileSync(new URL("static/game/kaplay.js", new URL("../", import.meta.url)), "utf8")
         .match(/\bease(?:In|Out|InOut)[A-Z][A-Za-z]*\b/g) || [])) {
  easings[name] = t => t;
}
easings.linear = t => t;
easings.easeOutElastic = t => (t === 0 || t === 1) ? t
  : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;

const tweens = [];                       // every live tween, stepped by frame()
const played = [];                       // sounds, used to observe a callback
const clicks = [];                       // click handlers Kaplay was given
function comp(k) { return (...a) => ({ __comp: k, a }); }

function makeTween(from, to, duration, setValue, ease) {
  const ends = [];
  const t = {
    time: 0, done: false, cancelled: false, paused: false,
    values: [],        // every value handed to setValue
    endsFired: 0,
    onEnd(cb) { ends.push(cb); return t; },
    then(cb) { return t.onEnd(cb); },
    cancel() { t.cancelled = true; },
    finish() { t.cancelled = true; setValue(to); t.fireEnds(); },
    fireEnds() { ends.forEach(f => f()); t.endsFired++; },
    step(dt) {
      if (t.cancelled || t.done || t.paused) return;
      t.time += dt;
      const p = Math.min(t.time / duration, 1);
      const e = (ease || easings.linear)(p);
      const v = typeof from === "number"
        ? from + (to - from) * e
        : { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      t.values.push(v);
      setValue(v);
      if (p === 1) { t.done = true; setValue(to); t.values.push(to); t.fireEnds(); }
    },
  };
  tweens.push(t);
  return t;
}

function frame(dt) { tweens.slice().forEach(t => t.step(dt)); }
function play(seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) frame(1 / 60);
}

function obj(comps) {
  return {
    comps, pos: { x: 0, y: 0 }, opacity: 1, angle: 0,
    use() {}, add(cs) { return obj(Array.from(cs)); }, destroy() {},
    exists: () => true, play() {},
    onUpdate() { return { cancel() {} }; },
    tween: (...a) => makeTween(...a),   // the timer() component's own tween
  };
}

globalThis.kaplay = () => {
  const ctx = {
    loadRoot() {}, loadSprite() {}, loadSound() {},
    add: (cs) => obj(Array.from(cs)),
    tween: (...a) => makeTween(...a),
    wait() { return { cancel() {} }; },
    play(name) { played.push(name); return { paused: false }; },
    onClick(f) { clicks.push(f); },
    vec2: (x, y) => ({ x, y: y === undefined ? x : y }),
    width: () => 800, height: () => 600,
    center: () => ({ x: 400, y: 300 }),
    dt: () => 1 / 60, time: () => 0,
    rand: (a, b) => (a + b) / 2,
    easings,
    debug: { inspect: false },
    quit() {},
  };
  for (const c of ["sprite", "pos", "area", "body", "anchor", "scale", "opacity",
                   "rotate", "color", "timer", "text", "rect", "circle"])
    ctx[c] = comp(c);
  return ctx;
};

// ------------------------------------------------------------- the runtime
const root = new URL("../", import.meta.url);
const py = await loadPyodide();
let err = "";
py.setStderr({ batched: s => { err += s + "\n"; } });
py.setStdout({ batched: () => {} });
py.FS.mkdirTree("/lib");
py.FS.writeFile("/lib/kaplay.py",
  readFileSync(new URL("static/py/kaplay.py", root), "utf8"));
py.runPython("import sys; sys.path.insert(0, '/lib')");

const sh = { window: {} };
new Function("window", "document", "fetch",
             readFileSync(new URL("static/runtime.js", root), "utf8"))
  (sh.window, {}, () => {});
py.runPython(sh.window.PyIDERuntime.BOOTSTRAP);

const HEAD = "from kaplay import *\nkaplay()\n";

/* Run a program, let some seconds of game time pass, and hand back the tweens
   it created so the caller can look at what actually happened. */
function run(source, seconds) {
  err = "";
  tweens.length = 0;
  clicks.length = 0;
  const status = py.runPython(`_pyide_run_game(${JSON.stringify(HEAD + source)})`);
  if (seconds) play(seconds);
  return { status, err: err.trim(), tweens: tweens.slice() };
}

function quiet(r, label) {
  const ok = r.status === "ok" && !r.err;
  check(ok, label, ok ? "" : "");
  if (!ok) {
    console.log((r.err || r.status).split("\n").slice(-4)
                .map(l => "        " + l).join("\n"));
  }
  return ok;
}

const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

// 1 — the plain case ------------------------------------------------------
let r = run(`
box = add([rect(40, 40), pos(100, 100), opacity(1)])
tween(1.0, 0.0, 0.5, lambda v: setattr(box, "opacity", v))
`, 0.6);
if (quiet(r, "a number tween runs without error")) {
  const t = r.tweens[0];
  check(t && t.values.length > 20,
        "  it was driven every frame", t && t.values.length + " values");
  check(t && near(t.values[t.values.length - 1], 0),
        "  it arrived exactly at the end value",
        t && String(t.values[t.values.length - 1]));
  check(t && t.endsFired === 1, "  it reported finishing once");
}

// 2 — a setter that ignores its argument -----------------------------------
r = run(`
hits = []
tween(0, 100, 0.2, lambda: hits.append(1))
`, 0.3);
quiet(r, "a setter taking no argument is tolerated");

// 3 — vec2, so `from` and `to` are JavaScript objects ----------------------
r = run(`
box = add([rect(40, 40), pos(0, 0)])
tween(vec2(0, 0), vec2(400, 300), 0.5, lambda p: setattr(box, "pos", p))
`, 0.6);
if (quiet(r, "a vec2 tween runs without error")) {
  const last = r.tweens[0] && r.tweens[0].values.slice(-1)[0];
  check(last && near(last.x, 400) && near(last.y, 300),
        "  it arrived at the target position",
        last && "(" + last.x + ", " + last.y + ")");
}

// 4 — the controller. `.then()` hands Kaplay a Python function through an
//     object the bridge does not wrap, which is the shape that produced the
//     "borrowed proxy was automatically destroyed" bug.
played.length = 0;
r = run(`
tween(0, 10, 0.2, lambda v: None).then(lambda: play("ding"))
`, 0.3);
quiet(r, "tween(...).then(callback) survives being called later");
/* Not "did it throw" but "did the Python actually run": the callback plays a
   sound, and the sound is visible from out here. A proxy destroyed at the end
   of the call that created it would fail at exactly this point, long after the
   program finished, which is what made the same bug so hard to place before. */
check(played.length === 1 && played[0] === "ding",
      "  and the Python inside it really ran", JSON.stringify(played));

// 5 — easing, which is most of the reason to use a tween -------------------
r = run(`
box = add([rect(40, 40), pos(0, 0)])
tween(0, 400, 0.5, lambda v: setattr(box.pos, "x", v), easings.easeOutElastic)
`, 0.6);
quiet(r, "a built-in easing can be named");

// 6 — a Python function as the curve ---------------------------------------
r = run(`
def steep(t):
    return t * t

box = add([rect(40, 40), pos(0, 0)])
tween(0, 400, 0.5, lambda v: setattr(box.pos, "x", v), steep)
`, 0.6);
if (quiet(r, "a Python function works as an easing curve")) {
  const t = r.tweens[0];
  // halfway through time, t*t puts it a quarter of the way along, not half
  const mid = t && t.values[Math.floor(t.values.length / 2) - 1];
  check(mid !== undefined && mid < 400 * 0.35,
        "  and the curve was actually applied", mid && mid.toFixed(1));
}

// 7 — the component method -------------------------------------------------
r = run(`
box = add([rect(40, 40), pos(0, 0), timer()])
box.tween(0, 400, 0.5, lambda v: setattr(box.pos, "x", v))
`, 0.6);
if (quiet(r, "obj.tween() works the same way")) {
  check(r.tweens[0] && near(r.tweens[0].values.slice(-1)[0], 400),
        "  and reached its target");
}

// 8 — keeping the controller and cancelling, FROM PYTHON -------------------
//     Cancelling from out here would prove nothing: the question is whether
//     the thing Python is holding is the tween's controller at all. Without
//     the trampoline it is a PyodideFuture, `.cancel()` cancels that instead,
//     nothing raises, and the tween runs merrily on.
r = run(`
box = add([rect(40, 40), pos(0, 0)])
slide = tween(0, 400, 1.0, lambda v: setattr(box.pos, "x", v))
onClick(lambda: slide.cancel())
`, 0.25);
if (quiet(r, "a tween can be held in a variable")) {
  const t = r.tweens[0];
  const before = t.values.length;
  clicks.forEach(f => f());                 // the student clicks
  play(0.5);
  check(t.values.length === before,
        "  cancel() from Python stops it dead",
        before + " values, then " + t.values.length);
}

// 9 — many at once, the way a real game uses them --------------------------
r = run(`
for i in range(30):
    box = add([rect(8, 8), pos(i * 20, 0), opacity(1)])
    tween(1.0, 0.0, 0.3, lambda v, b=box: setattr(b, "opacity", v))
`, 0.4);
if (quiet(r, "thirty tweens at once")) {
  check(r.tweens.length === 30 && r.tweens.every(t => t.endsFired === 1),
        "  all thirty finished",
        r.tweens.filter(t => t.endsFired === 1).length + "/30");
}

// 10 — a tween started from inside a callback, which is where they mostly
//      get started: on a click, on a collision, at the end of another tween.
r = run(`
box = add([rect(40, 40), pos(0, 0), opacity(1)])


def flash():
    tween(1.0, 0.2, 0.2, lambda v: setattr(box, "opacity", v))


onClick(flash)
`, 0);
if (quiet(r, "a tween can be created inside a callback")) {
  check(r.tweens.length === 0, "  nothing runs before the click");
  clicks.forEach(f => f());
  play(0.3);
  check(tweens.length === 1 && tweens[0].endsFired === 1,
        "  clicking starts one and it completes");
}

// 11 — the guide's own tween section, run as written ----------------------
check(Object.keys(easings).length >= 30,
      "the library really has the easings the guide lists",
      Object.keys(easings).length + " curves");

r = run(`
box = add([rect(60, 60), pos(100, 300), opacity(1)])

tween(100, 600, 0.5, lambda x: setattr(box.pos, "x", x))
tween(1.0, 0.0, 1.0, lambda a: setattr(box, "opacity", a)).then(lambda: play("done"))


def move_box(x):
    box.pos.x = x


tween(100, 600, 0.5, move_box, easings.easeOutBounce)
`, 1.2);
if (quiet(r, "the guide's tween examples run as written")) {
  check(r.tweens.length === 3 && r.tweens.every(t => t.endsFired === 1),
        "  all three finished",
        r.tweens.filter(t => t.endsFired === 1).length + "/3");
}

console.log("\n%s (%d checks, %d failed)",
            fail ? "SOME FAILED" : "ALL PASSED", checks, fail);
process.exit(fail ? 1 : 0);
