/* PyIDE — kaypy support.
 *
 * Games are written in Python and run on kaypy, which is pygame-ce all the way
 * down. There is no JavaScript engine and no bridge: the code a student writes
 * here is the same code that runs on their desktop with `python game.py`, byte
 * for byte, because it is the same package.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * Before this, Python built game objects and a 480-line bridge marshalled every
 * call into Kaplay, the JavaScript library. It worked, and the four worst bugs
 * this project has had all came from that seam: callbacks arriving as borrowed
 * proxies that were freed too early, a tile factory's return value reaching
 * JavaScript as an opaque object, a lambda's arity not matching what Kaplay
 * passed it, and a controller that came back as a Promise so `.cancel()`
 * cancelled nothing. None of those can happen now, because nothing crosses a
 * language boundary. The bridge is deleted.
 *
 * WHAT MAKES IT POSSIBLE
 *
 * Pyodide ships pygame-ce 2.5.7 — the same build pygbag hands kaypy for its own
 * web export — and supports SDL through a canvas. kaypy's frame loop is already
 * an `async` coroutine that yields with `await asyncio.sleep(0)`, and it already
 * takes its `sys.platform == "emscripten"` branch here, because that is what
 * Pyodide reports. So the browser is a target kaypy already knew about.
 *
 * WHAT THIS MODULE DOES
 *
 * Loads pygame-ce, writes the vendored kaypy package into Pyodide's filesystem,
 * gives SDL a canvas, fetches the sprites and sounds the program actually names,
 * and stops a running game.
 */

window.PyIDEGame = (function () {
  "use strict";

  /* Where the engine and the sprite packs are served from.

     PyIDE's own answer is these two paths, and nothing here needs to change
     for PyIDE. They are overridable because this file is vendored verbatim by
     the kaypy site, which serves the same two things from its own layout and
     from a page one directory down.

     Overridable rather than rewritten on the way out: a copy edited by a
     regex during vendoring is a copy that stops matching the day somebody
     reformats this line, and the failure is a 404 inside a game engine — the
     kind nobody sees until a student presses Run. Byte-identical copies can
     be checksummed against the original instead, which is what the site's
     vendor.py does. */
  var PATHS = window.PyIDEPaths || {};
  var BUNDLE = PATHS.bundle || "/static/py/kaypy_bundle.json";
  var ASSET_ROOT = PATHS.assets || "/static/assets/";

  var PKG_DIR = "/lib/kaypy";                    // inside Pyodide
  var PROJECT_DIR = "/project";

  /* Asset paths as a student writes them. The same four shapes the Sprites
     panel inserts: images/, dungeon/, sounds/, and a bare filename, which is
     how a sprite atlas is loaded — `loadSpriteAtlas("dungeon.png", {...})`. */
  var ASSET_RE =
    /["']((?:images|dungeon)\/[A-Za-z0-9_\-]+\.png|sounds\/[A-Za-z0-9_\-]+\.wav|[A-Za-z0-9_\-]+\.png)["']/g;

  var engineReady = false;
  var fetched = {};        // asset path -> true, so a second Run re-fetches nothing

  /* ------------------------------------------------------- the keyboard --
   *
   * SDL takes the keyboard by putting keydown/keyup/keypress listeners on
   * `document`, and it never takes them off. They are still there after the
   * game stops, still swallowing keys that were meant for the editor — which
   * is a student pressing Stop and then finding they cannot type.
   *
   * This is not a new problem. PyIDE hit it under Pygame Zero and needed a
   * workaround then; Kaplay never had it, because a JavaScript library listens
   * on the element it was given rather than on the whole document. Coming back
   * to SDL brings it back.
   *
   * It does not reproduce in every browser — five Run/Stop cycles in one
   * Chromium build typed fine — which is the worst kind of bug to leave in: it
   * works on the machine you test on and not on the one in the classroom.
   *
   * So the listeners are tracked as SDL registers them, and lifted off while
   * no game is running. Not disabled, not shadowed: removed, and put back on
   * the next Run. `document.addEventListener` is wrapped once, before
   * pygame-ce is ever loaded, because a listener that is never seen going on
   * cannot be taken off.
   */
  var sdlKeyListeners = [];       // [type, fn, opts] that SDL put on document
  var listenersAreOn = true;
  var watchingDocument = false;
  var gameWindowOpen = false;     // is a game being set up or running?

  /* Only what SDL registers, and only while a game is up.
   *
   * The wrapper below cannot ask a listener who added it, so it goes by when:
   * anything that puts a key listener on `document` between "a game is
   * starting" and "the game has stopped" is SDL's, and nothing else is.
   *
   * That window matters, because PyIDE listens on `document` too — Ctrl+Enter
   * runs, Escape stops, Escape closes the account menu. Those go on at page
   * load, before any game, so they are not caught. But "before any game" is
   * an accident of load order, and relying on it means the day someone adds a
   * keyboard shortcut from a click handler, pressing Stop would quietly take
   * Ctrl+Enter away with it — a bug that looks like nothing at all, and that
   * only shows up in the one thing a student does after Stop. Bounding the
   * window is one line and settles it.
   */
  var nativeAdd = null, nativeRemove = null;

  function watchKeyListeners() {
    if (watchingDocument) return;
    watchingDocument = true;

    nativeAdd = document.addEventListener.bind(document);
    nativeRemove = document.removeEventListener.bind(document);
    document.addEventListener = function (type, fn, opts) {
      if (gameWindowOpen && /^key(down|up|press)$/.test(type)) {
        sdlKeyListeners.push([type, fn, opts]);
      }
      return nativeAdd(type, fn, opts);
    };
  }

  /* Hand the keyboard to the game, or back to the editor.
   *
   * Through nativeAdd, deliberately, and not through the wrapper above: a
   * listener put back here is one already on the list, and going through the
   * wrapper would add it a second time. That grows the list by three on every
   * Run, and a browser hides it — the DOM ignores a listener registered twice
   * with the same type and function, so nothing misbehaves and the array just
   * gets longer all lesson. It showed up here only because
   * tools/test_run_stop_cycle.mjs counts registrations rather than
   * deduplicating them the way a browser does.
   */
  function keyboardToGame(on) {
    if (on === listenersAreOn) return;
    sdlKeyListeners.forEach(function (entry) {
      if (on) nativeAdd(entry[0], entry[1], entry[2]);
      else nativeRemove(entry[0], entry[1], entry[2]);
    });
    listenersAreOn = on;
  }

  /* A kaypy program is recognised by importing it. Unchanged from the Kaplay
     days, and still a much firmer signal than Pygame Zero's old one (defining
     draw() or update()), which a console program could trip over by accident. */
  /* Both spellings count as a game, and only one of them works.
   *
   * The package was called `kaplay` until the rename, so a project saved
   * before it says `from kaplay import *`. That import now fails — deliberately;
   * there is no compatibility alias — but the failure has to arrive in GAME
   * mode. Recognising only the new spelling would send an old project down the
   * console path, where it would be run as an ordinary program, print
   * "ModuleNotFoundError: No module named 'kaplay'" with no canvas in sight,
   * and leave a student with no clue that one word is the whole problem.
   *
   * Detected as a game, it instead reaches runtime.js's check and gets told
   * which line to change. Recognising the old name costs one alternation and
   * buys a sentence that fixes the project. */
  function looksLikeGame(source) {
    return /^[ \t]*(?:from[ \t]+ka(?:ypy|play)[ \t]+import|import[ \t]+ka(?:ypy|play))\b/m
      .test(source);
  }

  /* pygame-ce is a compiled C extension, so it comes from Pyodide's own
     package set rather than from PyPI — micropip could not use a PyPI wheel
     here even if it fetched one. It is the single biggest thing a game run
     downloads, and the browser caches it after the first time. */
  async function loadPygame(pyodide, say) {
    // Before the load, not after: SDL registers its listeners during
    // pygame.display.set_mode(), and one that is never seen going on cannot
    // be taken off again.
    watchKeyListeners();
    gameWindowOpen = true;          // from here until stop(), key listeners are SDL's
    if (pyodide.__pyideHasPygame) return;
    if (say) say("Loading the game engine…");
    await pyodide.loadPackage("pygame-ce");
    pyodide.__pyideHasPygame = true;
  }

  /* The engine, written into Pyodide's filesystem as real files.
   *
   * Real files rather than a string exec'd into a module, so a traceback
   * through the engine names kaypy/engine.py and a line number that exists —
   * and so `import kaypy` is an ordinary import with nothing clever about it.
   *
   * One fetch, not twenty-eight: tools/vendor_kaypy.py bundles the package
   * into a single JSON file for exactly this.
   */
  async function loadEngine(pyodide, say) {
    if (engineReady) return;
    if (say) say("Unpacking kaypy…");

    var res = await fetch(BUNDLE);
    if (!res.ok) {
      throw new Error("Could not load the game engine. Has "
                      + "tools/vendor_kaypy.py been run?");
    }
    var files = await res.json();

    Object.keys(files).forEach(function (rel) {
      var full = PKG_DIR + "/" + rel;
      var dir = full.slice(0, full.lastIndexOf("/"));
      pyodide.FS.mkdirTree(dir);
      pyodide.FS.writeFile(full, files[rel]);
    });

    pyodide.runPython(
      "import sys, os\n" +
      "if '/lib' not in sys.path:\n" +
      "    sys.path.insert(0, '/lib')\n" +
      // Same working directory as a console program, so open('scores.txt')
      // means the same thing in a game as it does anywhere else — and so
      // loadSprite("images/bean.png") resolves against the assets below.
      "os.makedirs('" + PROJECT_DIR + "', exist_ok=True)\n" +
      "os.chdir('" + PROJECT_DIR + "')\n"
    );
    engineReady = true;
  }

  /* The sprites and sounds the program names, fetched into the filesystem.
   *
   * kaypy opens assets as real files — `pygame.image.load(path)` — so they have
   * to exist before the program runs. Only the ones it actually mentions: the
   * two packs and the sounds come to about 5 MB together, and nobody's game
   * uses all of them.
   *
   * A path that is mentioned but missing is deliberately left alone, so the
   * game fails the way it would anywhere else — kaypy raises a FileNotFoundError
   * naming the path, which is a better error than anything invented here.
   */
  async function loadAssets(pyodide, source, say) {
    var wanted = {}, m;
    ASSET_RE.lastIndex = 0;
    while ((m = ASSET_RE.exec(source)) !== null) {
      if (!fetched[m[1]]) wanted[m[1]] = true;
    }
    var paths = Object.keys(wanted);
    if (!paths.length) return;

    if (say) say("Fetching " + paths.length
                 + (paths.length === 1 ? " picture…" : " pictures and sounds…"));

    await Promise.all(paths.map(async function (path) {
      try {
        var res = await fetch(ASSET_ROOT + path);
        if (!res.ok) return;              // let kaypy report the missing file
        var bytes = new Uint8Array(await res.arrayBuffer());
        var full = PROJECT_DIR + "/" + path;
        var dir = full.slice(0, full.lastIndexOf("/"));
        pyodide.FS.mkdirTree(dir);
        pyodide.FS.writeFile(full, bytes);
        fetched[path] = true;
      } catch (e) {
        /* Same again: a fetch that fails leaves the file absent, and the
           Python error names it. */
      }
    }));
  }

  /* Every game gets a brand new canvas element, and SDL is pointed at it.
   *
   * The id matters: Pyodide's SDL support requires the element to be called
   * "canvas", and setCanvas2D is how it is handed over. Without both, the
   * pygame.display.set_mode() inside kaypy() fails.
   *
   * Replacing rather than reusing carries over from the Kaplay days for a
   * different but related reason: SDL keeps state about the surface it was
   * given, and a second game on a used canvas is the kind of thing that works
   * on one browser and not another. A fresh element costs nothing.
   */
  function freshCanvas(pyodide) {
    var old = document.getElementById("canvas");
    var next = document.createElement("canvas");
    next.id = "canvas";                     // SDL insists on this exact id
    next.className = old.className;
    next.width = old.width;
    next.height = old.height;
    next.tabIndex = old.tabIndex;
    next.title = old.title;
    old.parentNode.replaceChild(next, old);
    if (pyodide && pyodide.canvas && pyodide.canvas.setCanvas2D) {
      pyodide.canvas.setCanvas2D(next);
    }
    return next;
  }

  async function ensureReady(pyodide, onProgress, source) {
    await loadPygame(pyodide, onProgress);
    await loadEngine(pyodide, onProgress);
    if (source) await loadAssets(pyodide, source, onProgress);

    /* Pyodide's own opt-in for SDL: without it, a main loop that hands control
       back to the browser is treated as a fatal unwind. Documented as
       experimental, and it is what makes a frame loop possible at all. */
    try { pyodide._api._skip_unwind_fatal_error = true; } catch (e) { /* older */ }

    keyboardToGame(true);           // the game is about to want the keys
    return freshCanvas(pyodide);
  }

  /* End a running game.
   *
   * kaypy's loop checks `_running` once a frame, so clearing it lets
   * run_async() return normally and the await in app.js resolves. Nothing is
   * torn down violently, which is the whole difference from the Kaplay days:
   * there is no WebGL context to lose, so the last frame stays on screen
   * instead of the picture going white.
   */
  function stop(pyodide) {
    // First, and whatever else happens: give the keyboard back. A student who
    // has pressed Stop wants to type, and that must not depend on the engine
    // shutting down tidily.
    keyboardToGame(false);
    gameWindowOpen = false;         // key listeners from here on are PyIDE's own
    if (!pyodide || !engineReady) return;
    try {
      pyodide.runPython(
        "import kaypy.engine as _ke\n" +
        "if _ke._engine is not None:\n" +
        "    _ke._engine._running = False\n"
      );
    } catch (e) {
      /* The student pressed Stop. Whether the engine was mid-frame is not
         their problem. */
    }
  }

  return {
    looksLikeGame: looksLikeGame,
    ensureReady: ensureReady,
    freshCanvas: freshCanvas,
    stop: stop,
    isReady: function () { return engineReady; }
  };
})();
