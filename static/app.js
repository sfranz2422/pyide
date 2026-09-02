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
  var spritesToggle = $("sprites-toggle");
  var authorField = $("author");
  var panel = $("sprites");
  var spriteGrid = $("sprite-grid");
  var soundList = $("sound-list");

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

  /* CodeMirror caches its own width and only rechecks on a window resize.
     Showing the canvas or the sprite panel resizes the editor without any
     resize event, leaving those measurements stale — clicks then land on the
     wrong characters and the caret looks stuck. Tell it after the CSS lands.

     A timeout rather than requestAnimationFrame: rAF is paused in a background
     tab, so a student switching tabs mid-lesson would come back to a dead
     caret. */
  function relayout() {
    setTimeout(function () { editor.refresh(); }, 0);
  }

  // ----------------------------------------------------------------- theme
  /* Light mode exists mainly for projecting the editor in class, where a dark
     screen washes out. The choice is remembered per browser; with none saved
     the computer's own light/dark setting decides. */
  var THEME_KEY = "pyide-theme";
  var themeBtn = $("theme");
  var themeGlyph = $("theme-glyph");

  function systemPrefersLight() {
    return window.matchMedia &&
           window.matchMedia("(prefers-color-scheme: light)").matches;
  }

  function currentTheme() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
    return systemPrefersLight() ? "light" : "dark";
  }

  function applyTheme(name, remember) {
    document.documentElement.setAttribute("data-theme", name);
    // CodeMirror carries its own colours, so it needs telling separately
    editor.setOption("theme", name === "light" ? "default" : "material-darker");
    themeGlyph.textContent = name === "light" ? "☾" : "☀";
    themeBtn.title = name === "light"
      ? "Switch to dark (easier on the eyes up close)"
      : "Switch to light (easier to read on a projector)";
    themeBtn.setAttribute("aria-label", themeBtn.title);
    if (remember) {
      try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* blocked */ }
    }
    relayout();
  }

  applyTheme(currentTheme(), false);

  themeBtn.addEventListener("click", function () {
    applyTheme(currentTheme() === "light" ? "dark" : "light", true);
  });

  // Follow the computer's setting as it changes, until a choice is made here.
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onSystemChange = function () {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* blocked */ }
      if (saved !== "light" && saved !== "dark") {
        applyTheme(systemPrefersLight() ? "light" : "dark", false);
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  // ------------------------------------------------------------- text size
  /* Scales the editor and the output pane together, and nothing else — the
     point is to project readable code without the toolbar ballooning the way
     browser zoom makes it. */
  var SIZE_KEY = "pyide-code-size";
  var SIZES = [11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32];
  var sizeLabel = $("font-size");
  var sizeDown = $("font-down");
  var sizeUp = $("font-up");

  function readSize() {
    var css = getComputedStyle(document.documentElement)
      .getPropertyValue("--code-size");
    var n = parseInt(css, 10);
    return isNaN(n) ? 14 : n;
  }

  function nearestIndex(px) {
    var best = 0;
    for (var i = 1; i < SIZES.length; i++) {
      if (Math.abs(SIZES[i] - px) < Math.abs(SIZES[best] - px)) best = i;
    }
    return best;
  }

  var sizeIndex = nearestIndex(readSize());

  function applySize(remember) {
    var px = SIZES[sizeIndex];
    document.documentElement.style.setProperty("--code-size", px + "px");
    sizeLabel.textContent = String(px);
    sizeDown.disabled = sizeIndex === 0;
    sizeUp.disabled = sizeIndex === SIZES.length - 1;
    // CodeMirror measures character width once; it must remeasure after this
    relayout();
    if (remember) {
      try { localStorage.setItem(SIZE_KEY, String(px)); } catch (e) { /* blocked */ }
    }
  }

  function stepSize(by) {
    var next = Math.min(SIZES.length - 1, Math.max(0, sizeIndex + by));
    if (next === sizeIndex) return;
    sizeIndex = next;
    applySize(true);
  }

  sizeDown.addEventListener("click", function () { stepSize(-1); });
  sizeUp.addEventListener("click", function () { stepSize(1); });
  applySize(false);

  // ----------------------------------------------------------------- files
  /* main.py is the program; every other file is data it can open(). Each file
     keeps its own CodeMirror document, so switching tabs preserves the caret
     and the undo history. */
  var MAIN = "main.py";
  var PROJECT_DIR = "/project";
  var NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,50}\.[A-Za-z0-9]{1,8}$/;

  var docs = {};
  var active = MAIN;
  var tabsEl = $("file-tabs");
  var outputView = $("output-view");
  var notesView = $("notes-view");
  var notesBody = $("notes-body");
  var notesName = $("notes-name");
  var notesEditBtn = $("notes-edit");   // present only while authoring

  function showOutput() {
    notesView.hidden = true;
    outputView.hidden = false;
  }

  function showNotes(name) {
    notesName.textContent = name;
    outputView.hidden = true;
    notesView.hidden = false;
    window.PyIDENotes.render(notesBody, docs[name].getValue());
  }

  docs[MAIN] = editor.getDoc();

  function makeDoc(text) { return CodeMirror.Doc(text, null); }

  Object.keys(window.PYIDE.files || {}).sort().forEach(function (name) {
    docs[name] = makeDoc(window.PYIDE.files[name]);
  });

  function mainSource() { return docs[MAIN].getValue(); }

  function dataFiles() {
    var out = {};
    Object.keys(docs).forEach(function (n) {
      if (n !== MAIN) out[n] = docs[n].getValue();
    });
    return out;
  }

  function fileNames() {
    return [MAIN].concat(Object.keys(docs).filter(function (n) {
      return n !== MAIN;
    }).sort());
  }

  /* A .md tab is a view switch, not an editor swap: the notes render on the
     right and the editor keeps showing the last code file. While authoring,
     "Edit source" swaps the editor onto the markdown for a live preview. */
  var lastCodeFile = MAIN;
  var mdSourceOpen = false;

  /* docs[] holds the Doc objects themselves, and swapDoc doesn't change their
     identity, so there is nothing to write back when switching away. */
  function showEditorDoc(name) {
    if (editor.getDoc() !== docs[name]) editor.swapDoc(docs[name]);
    editor.setOption("mode", name === MAIN ? "python" : null);
    editor.setOption("readOnly", window.PYIDE.readonly ? "nocursor" : false);
  }

  function switchTo(name) {
    if (!docs[name]) return;

    if (window.PyIDENotes.isMarkdown(name)) {
      active = name;
      mdSourceOpen = false;
      showEditorDoc(lastCodeFile);   // editor stays on the code
      showNotes(name);
      renderTabs();
      relayout();
      return;
    }

    if (name === active && !mdSourceOpen) return;
    active = name;
    lastCodeFile = name;
    mdSourceOpen = false;
    showEditorDoc(name);
    showOutput();
    renderTabs();
    relayout();
    editor.focus();
  }

  function renderTabs() {
    tabsEl.textContent = "";
    fileNames().forEach(function (name) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab" + (name === active ? " tab-on" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(name === active));

      var label = document.createElement("span");
      label.textContent = name;
      tab.appendChild(label);
      tab.addEventListener("click", function () { switchTo(name); });

      // notes belong to whoever wrote the assignment, so viewers and forkers
      // get no way to delete them
      var removable = name !== MAIN && !window.PYIDE.readonly &&
        (!window.PyIDENotes.isMarkdown(name) || window.PYIDE.authoring);
      if (removable) {
        var x = document.createElement("span");
        x.className = "tab-x";
        x.textContent = "×";
        x.title = "Remove " + name;
        x.addEventListener("click", function (e) {
          e.stopPropagation();
          removeFile(name);
        });
        tab.appendChild(x);
      }
      tabsEl.appendChild(tab);
    });
  }

  function addFile(name, text) {
    docs[name] = makeDoc(text || "");
    renderTabs();
  }

  function removeFile(name) {
    if (name === MAIN) return;
    if (!window.confirm("Remove " + name + " from this project?")) return;
    if (active === name) {
      active = MAIN;
      editor.swapDoc(docs[MAIN]);
      editor.setOption("mode", "python");
    }
    delete docs[name];
    try { pyodide.FS.unlink(PROJECT_DIR + "/" + name); } catch (e) { /* not written yet */ }
    renderTabs();
    relayout();
  }

  var newFileBtn = $("new-file");
  if (newFileBtn) {
    newFileBtn.addEventListener("click", function () {
      var name = (window.prompt(
        "Name for the new file, with an extension:", "data.txt") || "").trim();
      if (!name) return;
      if (!NAME_OK.test(name) || /\.py$/i.test(name)) {
        write("\n'" + name + "' won't work as a file name. Use letters, digits," +
              " dashes and underscores, ending in something like .txt or .csv." +
              "\n", "err");
        return;
      }
      if (docs[name]) { switchTo(name); return; }
      addFile(name, "");
      switchTo(name);
    });
  }

  if (notesEditBtn) {
    notesEditBtn.addEventListener("click", function () {
      if (!window.PyIDENotes.isMarkdown(active)) return;
      mdSourceOpen = !mdSourceOpen;
      notesEditBtn.textContent = mdSourceOpen ? "Done" : "Edit source";
      showEditorDoc(mdSourceOpen ? active : lastCodeFile);
      relayout();
      if (mdSourceOpen) editor.focus();
    });
  }

  // live preview while the markdown source is open
  editor.on("change", function () {
    if (mdSourceOpen && window.PyIDENotes.isMarkdown(active)) {
      window.PyIDENotes.render(notesBody, docs[active].getValue());
    }
  });

  renderTabs();

  /* A shared assignment should open on the notes, not on main.py — otherwise
     nobody reads them. Viewers only; while authoring you start in the code. */
  (function openNotesForViewers() {
    if (window.PYIDE.authoring) return;
    var md = fileNames().filter(window.PyIDENotes.isMarkdown);
    if (md.length) switchTo(md[0]);
  })();

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

    // Sprites are only meaningful to a game, so the button appears with one.
    var isGame = mode === "game";
    spritesToggle.hidden = !isGame;
    if (!isGame) closeSprites();
    relayout();
  }

  function refreshMode() { paintMode(currentMode(mainSource())); }

  editor.on("change", function () { if (!running) refreshMode(); });

  /* Name completion, for main.py only. A .txt or .md tab is not Python, and a
     read-only snapshot can't be typed into anyway. */
  var nameTimer = null, hintTimer = null;

  editor.on("change", function (cm, change) {
    if (window.PYIDE.readonly) return;
    if (active !== MAIN || mdSourceOpen) return;

    clearTimeout(nameTimer);
    nameTimer = setTimeout(function () {
      window.PyIDEComplete.refresh(mainSource());
    }, 250);

    // only offer suggestions while a word is actually being typed
    var typed = change.origin === "+input" && change.text.join("") ;
    if (typed && /^[A-Za-z0-9_]$/.test(typed)) {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        if (!cm.state.completionActive) window.PyIDEComplete.show(cm);
      }, 120);
    }
  });

  modeTag.addEventListener("click", function () {
    var now = currentMode(mainSource());
    // click cycles: auto -> pinned to the other mode -> auto
    modeOverride = modeOverride ? null : (now === "game" ? "console" : "game");
    refreshMode();
  });

  // Paint the mode before Python loads, so opening a shared game project shows
  // the Sprites button straight away rather than several seconds later.
  refreshMode();

  // --------------------------------------------------------------- runtime
  // Wraps console programs so that input() uses a browser prompt, a tracing
  // guard stops runaway loops, and tracebacks show only the student's frames.
  var BOOTSTRAP = [
    "import builtins, linecache, os, sys, time, traceback",
    "import js",
    "",
    "# Console programs get their own folder, so open('notes.txt') always lands",
    "# somewhere predictable — and never in the game's asset folder, which a",
    "# previous run may have left as the working directory.",
    "PROJECT_DIR = '/project'",
    "os.makedirs(PROJECT_DIR, exist_ok=True)",
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
    "    # Echo the prompt and what was typed, so the output pane reads like a",
    "    # terminal transcript rather than jumping straight to the next print.",
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
    "    os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    os.chdir(PROJECT_DIR)",
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
      window.PyIDEComplete.attach(pyodide);
      window.PyIDEComplete.refresh(mainSource());
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

  /* Attached files are written into Python's filesystem before the program
     runs, and read back afterwards so anything the program created with
     open('out.txt', 'w') shows up as a tab the student can open. */
  function pushFilesToPython() {
    if (!pyodide) return;
    pyodide.FS.mkdirTree(PROJECT_DIR);
    var files = dataFiles();
    Object.keys(files).forEach(function (name) {
      pyodide.FS.writeFile(PROJECT_DIR + "/" + name,
                           new TextEncoder().encode(files[name]));
    });
  }

  function pullFilesFromPython() {
    if (!pyodide) return;
    var entries;
    try { entries = pyodide.FS.readdir(PROJECT_DIR); } catch (e) { return; }
    var appeared = [];

    entries.forEach(function (name) {
      if (name === "." || name === ".." || name === MAIN) return;
      var path = PROJECT_DIR + "/" + name;
      try {
        if (pyodide.FS.isDir(pyodide.FS.stat(path).mode)) return;
      } catch (e) { return; }

      var text;
      try {
        // fatal:true so an image or other binary is skipped, not mangled
        text = new TextDecoder("utf-8", { fatal: true })
          .decode(pyodide.FS.readFile(path));
      } catch (e) { return; }

      if (!docs[name]) {
        addFile(name, text);
        appeared.push(name);
      } else if (docs[name].getValue() !== text) {
        docs[name].setValue(text);
      }
    });

    renderTabs();
    if (appeared.length) {
      write("\nYour program wrote " + appeared.join(", ") +
            " — open the tab to see it.\n", "dim");
    }
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
    var source = mainSource();
    var mode = currentMode(source);
    paintMode(mode);
    return mode === "game" ? runGame(source) : runConsole(source);
  }

  async function runConsole(source) {
    setBusy(true, "console");
    stage.hidden = true;   // put the picture away when going back to text
    showOutput();          // notes must not swallow the program's output
    relayout();
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

    pushFilesToPython();
    try {
      var result = pyRun(source, TIME_LIMIT_SECONDS);
      if (result === "ok") write("\n— finished —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      pullFilesFromPython();
      setBusy(false, "console");
    }
  }

  async function runGame(source) {
    setBusy(true, "game");
    showOutput();
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
    relayout();
    canvas.focus();

    pushFilesToPython();
    try {
      pyodide.runPython("reset_game_state()");
      var result = await pyodide.runPythonAsync(
        "await run_game(" + JSON.stringify(source) + ")"
      );
      if (result === "stopped") write("\n— stopped —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      pullFilesFromPython();
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
  var spritesFetched = false;

  function insertAtCursor(text) {
    if (window.PYIDE.readonly) return;
    // sprites belong in the program, not in a data file
    if (active !== MAIN) switchTo(MAIN);
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

  function closeSprites() {
    panel.setAttribute("hidden", "");
    spritesToggle.setAttribute("aria-expanded", "false");
    relayout();
  }

  function openSprites() {
    panel.removeAttribute("hidden");
    spritesToggle.setAttribute("aria-expanded", "true");
    fillSpritePanel();
    relayout();
  }

  spritesToggle.addEventListener("click", function () {
    if (panel.hasAttribute("hidden")) openSprites();
    else closeSprites();
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

  $("sprites-close").addEventListener("click", closeSprites);

  // ----------------------------------------------------------------- share
  var shareBtn = $("share");

  function flagAuthor(message) {
    authorField.classList.add("field-bad");
    authorField.setAttribute("aria-invalid", "true");
    authorField.focus();
    write("\n" + message + "\n", "err");
  }

  if (authorField) {
    authorField.addEventListener("input", function () {
      authorField.classList.remove("field-bad");
      authorField.removeAttribute("aria-invalid");
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", async function () {
      // a submission nobody can be identified from is no use to a teacher
      if (!authorField.value.trim()) {
        flagAuthor("Put your name in the box at the top before sharing.");
        return;
      }
      shareBtn.disabled = true;
      var original = shareBtn.textContent;
      shareBtn.textContent = "Sharing…";
      try {
        var res = await fetch(window.PYIDE.shareUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: mainSource(),
            files: dataFiles(),
            title: $("title").value,
            author: $("author").value
          })
        });
        var data = await res.json();
        if (!res.ok) {
          if (data.field === "author") {
            flagAuthor(data.error);
            return;
          }
          throw new Error(data.error || "Could not share this project.");
        }
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
    var blob = new Blob([mainSource()], { type: "text/x-python" });
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
