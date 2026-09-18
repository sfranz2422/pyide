/* PyIDE — Kaplay support.
 *
 * Games are written in Python and run on Kaplay, the JavaScript game library.
 * Python does not draw anything: it builds game objects and answers callbacks,
 * and Kaplay renders them on the GPU at full speed.
 *
 * This replaced Pygame Zero, and the replacement deleted more than it added.
 * Pygame Zero needed pygame-ce, numpy and pgzero fetched at first run (about
 * 4 MB), its blocking `while True` mainloop reimplemented as an async loop,
 * the sprite pack copied file by file into Pyodide's virtual filesystem, an
 * SDL canvas binding, and a workaround for SDL keeping the keyboard after the
 * game ended. None of that exists here. Kaplay is 184 KB, owns its own loop,
 * loads sprites over HTTP like any web page, and gives the keyboard back
 * because it never took it from the document in the first place.
 *
 * What this module does: load the library once, put the Python side of the
 * bridge where `import kaplay` can find it, and stop a running game.
 */

window.PyIDEGame = (function () {
  "use strict";

  var LIB = "/static/game/kaplay.js";
  var SHIM = "/static/py/kaplay.py";
  var SHIM_PATH = "/lib/kaplay.py";     // inside Pyodide, not the project folder
  var PROJECT_DIR = "/project";

  var libLoaded = false;
  var shimLoaded = false;

  /* A Kaplay program is recognised by importing the bridge. That is a much
     firmer signal than Pygame Zero's old one (defining draw() or update()),
     which a console program could trip over by accident. */
  function looksLikeGame(source) {
    return /^[ \t]*(?:from[ \t]+kaplay[ \t]+import|import[ \t]+kaplay)\b/m
      .test(source);
  }

  function loadLibrary() {
    if (libLoaded) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = LIB;
      tag.onload = function () {
        if (typeof window.kaplay !== "function") {
          reject(new Error("kaplay.js loaded but defined nothing."));
          return;
        }
        libLoaded = true;
        resolve();
      };
      tag.onerror = function () {
        reject(new Error("Could not load " + LIB));
      };
      document.head.appendChild(tag);
    });
  }

  /* The bridge is a real file fetched at run time rather than a string baked
     into this script, so it can be read, and blamed, like any other Python:
     a traceback through it names kaplay.py and a line number that exists. */
  async function loadShim(pyodide) {
    if (shimLoaded) return;
    var res = await fetch(SHIM);
    if (!res.ok) throw new Error("Could not load the Python side of Kaplay.");
    var source = await res.text();

    pyodide.FS.mkdirTree("/lib");
    pyodide.FS.writeFile(SHIM_PATH, source);
    pyodide.runPython(
      "import sys, os\n" +
      "if '/lib' not in sys.path:\n" +
      "    sys.path.insert(0, '/lib')\n" +
      // Same working directory as a console program, so open('scores.txt')
      // means the same thing in a game as it does anywhere else.
      "os.makedirs('" + PROJECT_DIR + "', exist_ok=True)\n" +
      "os.chdir('" + PROJECT_DIR + "')\n"
    );
    shimLoaded = true;
  }

  async function ensureReady(pyodide, canvas, onProgress) {
    if (onProgress && !libLoaded) onProgress("Loading the game engine…");
    await loadLibrary();
    await loadShim(pyodide);
    // The bridge defaults every game to this canvas, so a student never has to
    // know the page has one.
    window.__pyideCanvas = canvas;
  }

  /* End a running game.
   *
   * Kaplay's quit() stops its loop and releases its listeners. The bridge then
   * drops the proxies it handed out, because a Python function reachable from
   * a dead engine is just memory nobody will free.
   *
   * Deliberately leaves the last frame on the canvas: a game that ends with a
   * score on screen should still show it while the student reads the code.
   */
  function stop(pyodide) {
    if (!pyodide || !shimLoaded) return;
    try {
      pyodide.runPython(
        "import kaplay as _k\n" +
        "_k.shutdown()\n"
      );
    } catch (e) {
      /* Nothing worth surfacing: the student pressed Stop, and whether the
         engine was mid-teardown is not their problem. */
    }
  }

  return {
    looksLikeGame: looksLikeGame,
    ensureReady: ensureReady,
    stop: stop,
    isReady: function () { return libLoaded && shimLoaded; }
  };
})();
