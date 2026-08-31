/* PyIDE — editor, Python runtime, sharing */

(function () {
  "use strict";

  var TIME_LIMIT_SECONDS = 15; // console programs only; games run until stopped

  var $ = function (id) { return document.getElementById(id); };
  var outputEl = $("output");
  var runBtn = $("run");
  var runLabel = $("run-label");
  var stopBtn = $("stop");
  var modeTag = $("mode");
  var stage = $("stage");
  var canvas = $("canvas");

  // ---------------------------------------------------------------- editor
  var editor = CodeMirror.fromTextArea($("editor"), {
    mode: "python",
    theme: "material-darker",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    readOnly: window.PYIDE.readonly ? "nocursor" : false,
    extraKeys: {
      "Ctrl-Enter": function () { run(); },
      "Cmd-Enter": function () { run(); },
      Tab: function (cm) {
        if (cm.somethingSelected()) cm.indentSelection("add");
        else cm.replaceSelection("    ", "end");
      }
    }
  });
  editor.setSize("100%", "100%");

  // ---------------------------------------------------------------- output
  function write(text, cls) {
    var node = document.createElement("span");
    if (cls) node.className = cls;
    node.textContent = text;
    outputEl.appendChild(node);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function clearOutput() { outputEl.textContent = ""; }
  function status(text) { clearOutput(); write(text + "\n", "dim"); }

  $("clear").addEventListener("click", clearOutput);

  // ------------------------------------------------------------ mode state
  // null = decide from the code, "console"/"game" = the student overrode it
  var modeOverride = null;

  function currentMode(source) {
    if (modeOverride) return modeOverride;
    return window.PyIDEGame.looksLikeGame(source) ? "game" : "console";
  }

  function paintMode(mode) {
    modeTag.textContent = mode === "game" ? "Game" : "Console";
    modeTag.className = "mode mode-" + mode + (modeOverride ? " mode-pinned" : "");
    modeTag.title = modeOverride
      ? "Locked to " + mode + " mode. Click to go back to automatic."
      : "Detected automatically from your code. Click to lock the mode.";
    document.body.classList.toggle("is-game", mode === "game");
  }

  function refreshMode() { paintMode(currentMode(editor.getValue())); }

  editor.on("change", function () { if (!running) refreshMode(); });

  modeTag.addEventListener("click", function () {
    var now = currentMode(editor.getValue());
    // click cycles: auto -> pinned to the other mode -> auto
    modeOverride = modeOverride ? null : (now === "game" ? "console" : "game");
    refreshMode();
  });

  // --------------------------------------------------------------- runtime
  // Wraps console programs so that input() uses a browser prompt, a tracing
  // guard stops runaway loops, and tracebacks show only the student's frames.
  var BOOTSTRAP = [
    "import builtins, linecache, sys, time, traceback",
    "import js",
    "",
    "_deadline = [0.0]",
    "_limit = [0.0]",
    "",
    "class _TimeLimit(Exception):",
    "    pass",
    "",
    "class _Cancelled(Exception):",
    "    pass",
    "",
    "def _pyide_input(prompt=''):",
    "    label = str(prompt)",
    "    value = js.window.prompt(label if label.strip() else 'Program input:')",
    "    # a cancelled prompt returns JS null, which is not a Python str",
    "    if not isinstance(value, str):",
    "        raise _Cancelled()",
    "    print(label + value)",
    "    _deadline[0] = time.monotonic() + _limit[0]",
    "    return value",
    "",
    "builtins.input = _pyide_input",
    "",
    "def _pyide_run(source, seconds):",
    "    _limit[0] = seconds",
    "    _deadline[0] = time.monotonic() + seconds",
    "    ticks = [0]",
    "    # let tracebacks quote the student's own source lines",
    "    linecache.cache['main.py'] = (",
    "        len(source), None, source.splitlines(True), 'main.py')",
    "",
    "    def guard(frame, event, arg):",
    "        ticks[0] += 1",
    "        if ticks[0] % 1500 == 0 and time.monotonic() > _deadline[0]:",
    "            raise _TimeLimit()",
    "        return guard",
    "",
    "    try:",
    "        code = compile(source, 'main.py', 'exec')",
    "    except SyntaxError as err:",
    "        line = err.lineno or 0",
    "        text = (err.text or '').rstrip()",
    "        msg = 'SyntaxError on line %d: %s' % (line, err.msg)",
    "        if text:",
    "            msg += '\\n    ' + text.strip()",
    "        print(msg, file=sys.stderr)",
    "        return 'error'",
    "",
    "    scope = {'__name__': '__main__', '__builtins__': builtins}",
    "    sys.settrace(guard)",
    "    try:",
    "        exec(code, scope)",
    "        return 'ok'",
    "    except _TimeLimit:",
    "        sys.settrace(None)",
    "        print('Stopped after %g seconds. Is there a loop that never ends?'",
    "              % seconds, file=sys.stderr)",
    "        return 'timeout'",
    "    except _Cancelled:",
    "        sys.settrace(None)",
    "        print('Stopped — you cancelled the input box.', file=sys.stderr)",
    "        return 'cancelled'",
    "    except SystemExit:",
    "        return 'ok'",
    "    except BaseException as err:",
    "        sys.settrace(None)",
    "        # keep only the student's own frames; library internals are noise",
    "        frames = [f for f in traceback.extract_tb(err.__traceback__)",
    "                  if f.filename == 'main.py']",
    "        if frames:",
    "            sys.stderr.write('Traceback (most recent call last):\\n')",
    "            for line in traceback.format_list(frames):",
    "                sys.stderr.write(line)",
    "        for line in traceback.format_exception_only(type(err), err):",
    "            sys.stderr.write(line)",
    "        return 'error'",
    "    finally:",
    "        sys.settrace(None)",
    ""
  ].join("\n");

  var pyodide = null;
  var pyRun = null;
  var running = false;

  (async function () {
    try {
      pyodide = await loadPyodide();
      pyodide.setStdout({ batched: function (s) { write(s + "\n"); } });
      pyodide.setStderr({ batched: function (s) { write(s + "\n", "err"); } });
      pyodide.runPython(BOOTSTRAP);
      pyRun = pyodide.globals.get("_pyide_run");
      var version = pyodide.runPython(
        "import sys; '.'.join(str(v) for v in sys.version_info[:3])"
      );
      status("Python " + version + " ready. Press Run to start.");
      runBtn.disabled = false;
      runLabel.textContent = "Run";
      refreshMode();
    } catch (e) {
      status("Python failed to load. Check your connection and refresh.");
      write(String(e) + "\n", "err");
    }
  })();

  function repaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }

  function setBusy(isRunning, mode) {
    running = isRunning;
    runBtn.disabled = isRunning;
    runLabel.textContent = isRunning ? "Running…" : "Run";
    stopBtn.hidden = !(isRunning && mode === "game");
  }

  // ---------------------------------------------------------------- run it
  async function run() {
    if (running || !pyRun) return;
    var source = editor.getValue();
    var mode = currentMode(source);
    paintMode(mode);
    return mode === "game" ? runGame(source) : runConsole(source);
  }

  async function runConsole(source) {
    setBusy(true, "console");
    stage.hidden = true;   // put the picture away when going back to text
    clearOutput();
    await repaint();

    try {
      await pyodide.loadPackagesFromImports(source, {
        messageCallback: function () {},
        errorCallback: function () {}
      });
    } catch (e) {
      /* an unavailable import surfaces as a normal ModuleNotFoundError below */
    }

    try {
      var result = pyRun(source, TIME_LIMIT_SECONDS);
      if (result === "ok") write("\n— finished —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      setBusy(false, "console");
    }
  }

  async function runGame(source) {
    setBusy(true, "game");
    clearOutput();
    await repaint();

    try {
      await window.PyIDEGame.ensureReady(pyodide, canvas, function (msg) {
        status(msg);
      });
    } catch (e) {
      status("");
      write("The game engine could not load.\n" + e + "\n", "err");
      setBusy(false, "game");
      return;
    }

    clearOutput();
    write("Game running. Click the picture first so the keys reach it.\n", "dim");
    stage.hidden = false;
    canvas.focus();

    try {
      pyodide.runPython("reset_game_state()");
      var result = await pyodide.runPythonAsync(
        "await run_game(" + JSON.stringify(source) + ")"
      );
      if (result === "stopped") write("\n— stopped —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      setBusy(false, "game");
    }
  }

  function stopGame() {
    if (!running || !pyodide) return;
    try { pyodide.runPython("request_stop()"); } catch (e) { /* not loaded */ }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stopGame);

  // Keys must reach the canvas, not scroll the page, while a game is running.
  canvas.addEventListener("keydown", function (e) {
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) >= 0) {
      e.preventDefault();
    }
  });
  canvas.addEventListener("mousedown", function () { canvas.focus(); });

  // --------------------------------------------------------- sprite panel
  var panel = $("sprites");
  var spriteGrid = $("sprite-grid");
  var soundList = $("sound-list");
  var spritesFetched = false;

  function insertAtCursor(text) {
    if (window.PYIDE.readonly) return;
    editor.replaceSelection(text, "end");
    editor.focus();
  }

  async function fillSpritePanel() {
    if (spritesFetched) return;
    spritesFetched = true;
    var manifest;
    try {
      manifest = await fetch("/static/assets/manifest.json").then(function (r) { return r.json(); });
    } catch (e) {
      spriteGrid.textContent = "Could not load the sprite list.";
      return;
    }

    spriteGrid.textContent = "";
    manifest.images.forEach(function (img) {
      var cell = document.createElement("button");
      cell.className = "sprite";
      cell.type = "button";
      cell.dataset.name = img.name;
      cell.title = img.name + " — " + img.w + "×" + img.h + " — click to insert";
      cell.innerHTML =
        '<span class="sprite-img"><img src="/static/assets/images/' +
        img.name + '.png" alt="" loading="lazy"></span>' +
        '<span class="sprite-name">' + img.name + "</span>";
      cell.addEventListener("click", function () {
        insertAtCursor("Actor('" + img.name + "', (100, 100))");
      });
      spriteGrid.appendChild(cell);
    });

    var sounds = manifest.sounds || [];
    if (!sounds.length) {
      $("sound-section").hidden = true;
    } else {
      soundList.textContent = "";
      sounds.forEach(function (file) {
        var name = file.replace(/\.[^.]+$/, "");
        var b = document.createElement("button");
        b.className = "chip";
        b.type = "button";
        b.textContent = name;
        b.title = "Insert sounds." + name + ".play()";
        b.addEventListener("click", function () {
          insertAtCursor("sounds." + name + ".play()");
        });
        soundList.appendChild(b);
      });
    }
  }

  $("sprites-toggle").addEventListener("click", function () {
    var open = panel.hasAttribute("hidden");
    if (open) { panel.removeAttribute("hidden"); fillSpritePanel(); }
    else panel.setAttribute("hidden", "");
    $("sprites-toggle").setAttribute("aria-expanded", String(open));
  });

  $("sprite-search").addEventListener("input", function (e) {
    var q = e.target.value.trim().toLowerCase();
    var shown = 0;
    Array.prototype.forEach.call(spriteGrid.children, function (cell) {
      var hit = !q || cell.dataset.name.indexOf(q) >= 0;
      cell.hidden = !hit;
      if (hit) shown++;
    });
    $("sprite-empty").hidden = shown > 0;
  });

  $("sprites-close").addEventListener("click", function () {
    panel.setAttribute("hidden", "");
    $("sprites-toggle").setAttribute("aria-expanded", "false");
  });

  // ----------------------------------------------------------------- share
  var shareBtn = $("share");
  if (shareBtn) {
    shareBtn.addEventListener("click", async function () {
      shareBtn.disabled = true;
      var original = shareBtn.textContent;
      shareBtn.textContent = "Sharing…";
      try {
        var res = await fetch(window.PYIDE.shareUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: editor.getValue(),
            title: $("title").value,
            author: $("author").value
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not share this project.");
        $("share-url").value = data.url;
        $("modal").hidden = false;
        $("share-url").select();
      } catch (e) {
        write("\nShare failed: " + e.message + "\n", "err");
      } finally {
        shareBtn.disabled = false;
        shareBtn.textContent = original;
      }
    });
  }

  $("copy").addEventListener("click", function () {
    var field = $("share-url");
    field.select();
    navigator.clipboard.writeText(field.value).then(function () {
      $("copy").textContent = "Copied";
      setTimeout(function () { $("copy").textContent = "Copy"; }, 1500);
    }, function () {
      document.execCommand("copy");
    });
  });

  $("close-modal").addEventListener("click", function () { $("modal").hidden = true; });
  $("modal").addEventListener("click", function (e) {
    if (e.target === $("modal")) $("modal").hidden = true;
  });

  // -------------------------------------------------------------- download
  $("download").addEventListener("click", function () {
    var name = ($("title").value || "main").replace(/[^\w\-]+/g, "_").toLowerCase();
    var blob = new Blob([editor.getValue()], { type: "text/x-python" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".py";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Escape" && running) stopGame();
  });
})();
