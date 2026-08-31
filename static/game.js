/* PyIDE — Pygame Zero support.
 *
 * Pygame Zero's own mainloop is a blocking `while True`, which would freeze the
 * browser tab. This module reimplements that loop as an async loop that yields
 * once per frame, which is the pattern Pyodide's SDL docs prescribe. Everything
 * else — draw(), update(dt), Actor, keyboard, the event handlers — is real
 * Pygame Zero.
 */

window.PyIDEGame = (function () {
  "use strict";

  // Installed into Python the first time a game is run.
  var BOOTSTRAP = [
    "import asyncio, linecache, sys, types, traceback",
    "import pygame",
    "import pgzero, pgzero.game, pgzero.loaders, pgzero.builtins, pgzero.clock",
    "",
    "# the bundled window icon can't be loaded under wasm, and the browser tab",
    "# already has its own favicon",
    "pgzero.game.PGZeroGame.show_default_icon = lambda self: None",
    "",
    "_stop = [False]",
    "_frames = [0]",
    "",
    "def request_stop():",
    "    _stop[0] = True",
    "",
    "def frame_count():",
    "    return _frames[0]",
    "",
    "def _build_module(source):",
    "    mod = types.ModuleType('__main__')",
    "    mod.__dict__.update(pgzero.builtins.__dict__)",
    "    mod.__file__ = 'main.py'",
    "    sys.modules['__main__'] = mod",
    "    # let tracebacks quote the student's own source lines",
    "    linecache.cache['main.py'] = (",
    "        len(source), None, source.splitlines(True), 'main.py')",
    "    exec(compile(source, 'main.py', 'exec'), mod.__dict__)",
    "    return mod",
    "",
    "def _report(err):",
    "    # keep only the student's own frames; pgzero and pygame internals are",
    "    # noise to a beginner staring at their first missing-sprite error",
    "    frames = [f for f in traceback.extract_tb(err.__traceback__)",
    "              if f.filename == 'main.py']",
    "    if frames:",
    "        sys.stderr.write('Traceback (most recent call last):\\n')",
    "        for line in traceback.format_list(frames):",
    "            sys.stderr.write(line)",
    "    for line in traceback.format_exception_only(type(err), err):",
    "        sys.stderr.write(line)",
    "",
    "async def run_game(source, max_frames=0):",
    "    _stop[0] = False",
    "    _frames[0] = 0",
    "    pygame.init()",
    "    # A display surface must exist before the student's code runs: a",
    "    # module-level Actor(...) loads its image and calls convert_alpha(),",
    "    # which fails without one. Pygame Zero's own runner does exactly this.",
    "    # reinit_screen() resizes to the real WIDTH/HEIGHT a moment later.",
    "    pygame.display.set_mode((100, 100), pgzero.game.DISPLAY_FLAGS)",
    "    try:",
    "        mod = _build_module(source)",
    "    except SyntaxError as err:",
    "        text = (err.text or '').strip()",
    "        msg = 'SyntaxError on line %d: %s' % (err.lineno or 0, err.msg)",
    "        if text:",
    "            msg += '\\n    ' + text",
    "        print(msg, file=sys.stderr)",
    "        return 'error'",
    "    except BaseException as err:",
    "        _report(err)",
    "        return 'error'",
    "",
    "    game = pgzero.game.PGZeroGame(mod)",
    "    clock = pygame.time.Clock()",
    "    pgzclock = pgzero.clock.clock",
    "    try:",
    "        game.reinit_screen()",
    "        update = game.get_update_func()",
    "        draw = game.get_draw_func()",
    "        game.load_handlers()",
    "    except BaseException as err:",
    "        _report(err)",
    "        return 'error'",
    "",
    "    game.need_redraw = True",
    "    while not _stop[0]:",
    "        # cap dt so a backgrounded tab doesn't resume with a huge jump",
    "        dt = min(clock.tick(60) / 1000.0, 0.05)",
    "        try:",
    "            for event in pygame.event.get():",
    "                if event.type == pygame.QUIT:",
    "                    return 'quit'",
    "                if event.type == pygame.KEYDOWN:",
    "                    game.keyboard._press(event.key)",
    "                elif event.type == pygame.KEYUP:",
    "                    game.keyboard._release(event.key)",
    "                game.dispatch_event(event)",
    "            pgzclock.tick(dt)",
    "            if update:",
    "                update(dt)",
    "            changed = game.reinit_screen()",
    "            if changed or update or pgzclock.fired or game.need_redraw:",
    "                draw()",
    "                pygame.display.flip()",
    "                game.need_redraw = False",
    "        except BaseException as err:",
    "            _report(err)",
    "            return 'error'",
    "        _frames[0] += 1",
    "        if max_frames and _frames[0] >= max_frames:",
    "            return 'done'",
    "        await asyncio.sleep(0)",
    "    return 'stopped'",
    "",
    "def reset_game_state():",
    "    \"\"\"Clear scheduled callbacks and cached art between runs.\"\"\"",
    "    try:",
    "        pgzero.clock.clock.unschedule_all()",
    "    except Exception:",
    "        pass",
    "    for loader in (pgzero.loaders.images, pgzero.loaders.sounds):",
    "        try:",
    "            loader._cache.clear()",
    "        except Exception:",
    "            pass",
    ""
  ].join("\n");

  var ROOT = "/game";
  var ready = false;      // packages + bootstrap installed
  var assetsLoaded = false;
  var canvasBound = false;

  /* A Pygame Zero program is recognised by defining draw() or update() at the
     top level and never calling them. Nothing in a normal console program
     looks like that. */
  function looksLikeGame(source) {
    return /^[ \t]*def[ \t]+(draw|update)[ \t]*\(/m.test(source);
  }

  function bindCanvas(pyodide, canvas) {
    if (canvasBound) return;
    pyodide._api._skip_unwind_fatal_error = true;
    pyodide.canvas.setCanvas2D(canvas);
    canvasBound = true;
  }

  async function loadAssets(pyodide, onProgress) {
    if (assetsLoaded) return;
    var manifest = await fetch("/static/assets/manifest.json").then(function (r) {
      if (!r.ok) throw new Error("asset manifest missing");
      return r.json();
    });

    pyodide.FS.mkdirTree(ROOT + "/images");
    pyodide.FS.mkdirTree(ROOT + "/sounds");

    var jobs = [];
    manifest.images.forEach(function (img) {
      jobs.push(["images/" + img.name + ".png", "/static/assets/images/" + img.name + ".png"]);
    });
    (manifest.sounds || []).forEach(function (file) {
      jobs.push(["sounds/" + file, "/static/assets/sounds/" + file]);
    });

    if (onProgress) onProgress("Loading " + jobs.length + " assets…");
    await Promise.all(jobs.map(async function (job) {
      var res = await fetch(job[1]);
      if (!res.ok) return;
      var bytes = new Uint8Array(await res.arrayBuffer());
      pyodide.FS.writeFile(ROOT + "/" + job[0], bytes);
    }));

    pyodide.runPython(
      "import os, pgzero.loaders\n" +
      "os.chdir('" + ROOT + "')\n" +
      "pgzero.loaders.set_root('" + ROOT + "')\n"
    );
    assetsLoaded = true;
    return manifest;
  }

  /* Loads pygame-ce, numpy and pgzero. About 4 MB, so it happens on the first
     game run rather than at page load — console programs never pay for it. */
  async function ensureReady(pyodide, canvas, onProgress) {
    bindCanvas(pyodide, canvas);
    if (ready) {
      await loadAssets(pyodide, onProgress);
      return;
    }
    if (onProgress) onProgress("Loading the game engine (about 4 MB, one time)…");
    await pyodide.loadPackage(["pygame-ce", "numpy", "micropip"], {
      messageCallback: function () {},
      errorCallback: function () {}
    });
    if (onProgress) onProgress("Installing Pygame Zero…");
    // deps=False: pgzero asks for stock `pygame`, which has no WebAssembly
    // build. pygame-ce provides the same `pygame` module and is already loaded.
    await pyodide.runPythonAsync(
      "import micropip\nawait micropip.install('pgzero', deps=False)"
    );
    pyodide.runPython(BOOTSTRAP);
    ready = true;
    await loadAssets(pyodide, onProgress);
  }

  return {
    looksLikeGame: looksLikeGame,
    ensureReady: ensureReady,
    isReady: function () { return ready; }
  };
})();
