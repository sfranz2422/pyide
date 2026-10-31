/* PyIDE — the simulated Raspberry Pi, the page's side: what the Python
 * packages in static/py/pi (gpiozero, …) call through window.PyIDEPi, and
 * the panel that shows it.
 *
 * Python's side (static/py/pi/_pyide_pi, gpiozero):
 *   beginRun / endRun / requestStop / nextFrame / sleep — the turns, the
 *     same bridge as the block world's (world_model.js makeBridge);
 *   gpioSetup(bcm, "out"|"in", pull) / gpioRelease(bcm)
 *   gpioWrite(bcm, 0..1) / gpioValue(bcm)
 *   gpioBlink(bcm, onMs, offMs, n, fadeInMs, fadeOutMs, level) /
 *     gpioStopBlink(bcm) / gpioBlinking(bcm)   — blinking on the page's
 *     clock, so an LED keeps blinking while the program sleeps, as
 *     gpiozero's background thread keeps it blinking on a Pi
 *   gpioRead(bcm) → 0|1, gpioEdges(bcm) → [rises, falls]
 *   boardToBcm(physical) → bcm, or -1
 *
 * The page's side (app.js, demo.js):
 *   loadPackage(pyodide), show(host, uses), hide(), load(text), save(),
 *   onEdit(f), setReadonly(ro)
 *
 * The circuit is the student's own wiring (pi_circuit.js), saved with the
 * project as circuit.pi. Every pin change and every press re-evaluates it.
 */
window.PyIDEPi = (function () {
  "use strict";

  var C = window.PyIDEPiCircuit;
  var BUNDLE = (window.PyIDEPaths && window.PyIDEPaths.piBundle) || "/static/py/pi_bundle.json";

  function schedule(cb) {
    var done = false;
    function go() { if (!done) { done = true; cb(); } }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  var bridge = window.PyIDEWorldModel.makeBridge(null, schedule);

  var circuit = C.create();
  var pins = {};              // bcm -> {mode, value, pull}
  var pressed = {};           // button part id -> true while held
  var reads = {};             // bcm -> last value read (for edges)
  var edges = {};             // bcm -> [rises, falls]
  var blinkers = {};          // bcm -> {timer, ...}
  var result = { lit: {}, sounding: {}, reads: {}, warnings: [] };
  var board = null, host = null, readonly = false;
  var editHandlers = [];

  /* ------------------------------------------------------------ the pins */
  function evaluate() {
    result = C.evaluate(circuit, pins, pressed);
    Object.keys(result.reads).forEach(function (bcm) {
      var now = result.reads[bcm], before = reads[bcm];
      if (before !== undefined && now !== before) {
        var e = edges[bcm] || (edges[bcm] = [0, 0]);
        if (now) e[0] += 1; else e[1] += 1;
      }
      reads[bcm] = now;
    });
    if (board) board.paint(result);
    sound(Object.keys(result.sounding).length > 0);
  }

  function setup(bcm, mode, pull) {
    bcm = Number(bcm);
    stopBlink(bcm);
    pins[bcm] = { mode: String(mode), value: 0, pull: pull ? String(pull) : "up" };
    edges[bcm] = [0, 0];
    delete reads[bcm];
    evaluate();
  }
  function release(bcm) {
    bcm = Number(bcm);
    stopBlink(bcm);
    delete pins[bcm];
    evaluate();
  }
  function write(bcm, value) {
    bcm = Number(bcm);
    if (!pins[bcm]) pins[bcm] = { mode: "out", value: 0 };
    pins[bcm].value = Math.max(0, Math.min(1, Number(value) || 0));
    evaluate();
  }
  function value(bcm) { var p = pins[Number(bcm)]; return p ? p.value : 0; }
  function read(bcm) {
    bcm = Number(bcm);
    if (!(bcm in result.reads)) evaluate();
    return result.reads[bcm] === undefined ? 1 : result.reads[bcm];
  }
  function edgesOf(bcm) { var e = edges[Number(bcm)] || [0, 0]; return [e[0], e[1]]; }

  /* Blinking and fading, on the page's clock. n < 0 is for ever. */
  function blink(bcm, onMs, offMs, n, fadeIn, fadeOut, level) {
    bcm = Number(bcm);
    stopBlink(bcm);
    var b = { left: Number(n), start: Date.now() };
    var on = Math.max(0, Number(onMs)), off = Math.max(0, Number(offMs));
    var fi = Math.max(0, Number(fadeIn) || 0), fo = Math.max(0, Number(fadeOut) || 0);
    var period = fi + on + fo + off;
    if (period <= 0) { write(bcm, level); return; }
    b.timer = setInterval(function () {
      var t = Date.now() - b.start, cycle = Math.floor(t / period), at = t % period, v;
      if (b.left >= 0 && cycle >= b.left) { stopBlink(bcm); write(bcm, 0); return; }
      if (at < fi) v = at / fi;
      else if (at < fi + on) v = 1;
      else if (at < fi + on + fo) v = 1 - (at - fi - on) / fo;
      else v = 0;
      v = (fi || fo) ? v : (v > 0 ? 1 : 0);
      if (!pins[bcm] || pins[bcm].value !== v) write(bcm, v * Number(level || 1));
    }, 15);
    blinkers[bcm] = b;
    write(bcm, fi ? 0 : level);
  }
  function stopBlink(bcm) {
    var b = blinkers[Number(bcm)];
    if (b) { clearInterval(b.timer); delete blinkers[Number(bcm)]; }
  }
  function blinking(bcm) { return !!blinkers[Number(bcm)]; }

  function boardToBcm(n) {
    var role = C.HEADER[Number(n)];
    return typeof role === "number" ? role : -1;
  }

  /* After a run, as gpiozero's cleanup does on a Pi: every pin let go, so
     LEDs go out and a buzzer goes quiet. */
  function resetPins() {
    Object.keys(blinkers).forEach(stopBlink);
    pins = {};
    edges = {};
    reads = {};
    evaluate();
  }

  /* --------------------------------------------------------- the buzzer */
  var audio = null, osc = null;
  function sound(on) {
    try {
      if (on && !osc) {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        osc = audio.createOscillator();
        var gain = audio.createGain();
        gain.gain.value = 0.06;
        osc.type = "square";
        osc.frequency.value = 2400;      // an active buzzer's one note
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start();
      } else if (!on && osc) {
        osc.stop();
        osc.disconnect();
        osc = null;
      }
    } catch (e) { /* no sound here: the ♪ on the board still shows it */ }
  }

  /* ----------------------------------------------------------- the panel */
  function show(el, uses) {
    host = el;
    host.hidden = false;
    uses = uses || { gpio: true };
    var bbHost = host.querySelector(".pi-board-host");
    if (!bbHost) {
      bbHost = document.createElement("div");
      bbHost.className = "pi-board-host";
      host.appendChild(bbHost);
    }
    bbHost.hidden = !uses.gpio;
    if (uses.gpio && !board) {
      board = window.PyIDEPiBoard.mount(bbHost, {
        circuit: function () { return circuit; },
        readonly: readonly,
        edited: function () {
          evaluate();
          editHandlers.forEach(function (f) { f(); });
        },
        press: function (id, down) {
          if (down) pressed[id] = true; else delete pressed[id];
          evaluate();
        }
      });
      board.paint(result);
    }
  }
  function hide() {
    if (host) host.hidden = true;
    sound(false);
  }
  function load(text) {
    circuit = C.load(text);
    pressed = {};
    evaluate();
    if (board) board.redraw();
  }
  function save() { return C.save(circuit); }

  /* ------------------------------------------------------ the package */
  var packagePromise = null;
  function loadPackage(pyodide) {
    if (!packagePromise) {
      packagePromise = fetch(BUNDLE).then(function (r) {
        if (!r.ok) throw new Error("Couldn't load the Raspberry Pi packages (" + r.status + ").");
        return r.json();
      }).then(function (files) {
        Object.keys(files).forEach(function (rel) {
          var dir = "/lib/" + rel.split("/").slice(0, -1).join("/");
          pyodide.FS.mkdirTree(dir);
          pyodide.FS.writeFile("/lib/" + rel, files[rel]);
        });
        pyodide.runPython("import sys\nif '/lib' not in sys.path:\n    sys.path.insert(0, '/lib')\n");
      });
      packagePromise.catch(function () { packagePromise = null; });
    }
    return packagePromise;
  }

  // The mode rule: a program that imports one of these drives the Pi.
  function looksLikePi(source) {
    return /^[ \t]*(?:from[ \t]+(?:gpiozero|sense_hat|sense_emu|picamera)\b[\w.]*[ \t]+import|import[ \t]+(?:gpiozero|sense_hat|sense_emu|picamera)\b)/m.test(source);
  }
  // Which boards a program needs on screen.
  function usesOf(source) {
    return {
      gpio: /\bgpiozero\b/.test(source),
      sense: /\bsense_(?:hat|emu)\b/.test(source),
      camera: /\bpicamera\b/.test(source)
    };
  }

  return {
    // Python's side.
    beginRun: function () { resetPins(); return bridge.beginRun(); },
    endRun: function () { bridge.endRun(); resetPins(); },
    requestStop: bridge.requestStop,
    isStopping: bridge.isStopping,
    nextFrame: bridge.nextFrame,
    sleep: bridge.sleep,
    gpioSetup: setup, gpioRelease: release, gpioWrite: write, gpioValue: value,
    gpioBlink: blink, gpioStopBlink: stopBlink, gpioBlinking: blinking,
    gpioRead: read, gpioEdges: edgesOf, boardToBcm: boardToBcm,
    // The page's side.
    loadPackage: loadPackage, show: show, hide: hide, load: load, save: save,
    onEdit: function (f) { editHandlers.push(f); },
    setReadonly: function (ro) { readonly = !!ro; if (board) board.setReadonly(readonly); },
    looksLikePi: looksLikePi, usesOf: usesOf,
    // For tests: the circuit and what it is doing.
    circuit: function () { return circuit; },
    state: function () { return { pins: pins, result: result, pressed: pressed }; },
    press: function (id, down) { if (down) pressed[id] = true; else delete pressed[id]; evaluate(); }
  };
})();
