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
      },
      "Shift-Tab": function (cm) { cm.indentSelection("subtract"); },
      // indent:true keeps the # at the code's own indentation rather than
      // shoving it to column 0, which is how Python is normally written
      "Ctrl-/": function (cm) { cm.toggleComment({ indent: true }); },
      "Cmd-/": function (cm) { cm.toggleComment({ indent: true }); }
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
  function modeFor(name) {
    return /\.py$/i.test(name) ? "python" : null;   // .txt and .csv are text
  }

  function showEditorDoc(name) {
    if (editor.getDoc() !== docs[name]) editor.swapDoc(docs[name]);
    editor.setOption("mode", modeFor(name));
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

  /* A file called random.py, math.py or string.py wins over the real library,
     because the project folder is first on sys.path. `import random` then
     silently imports the student's own empty file and every call into it fails
     with something that looks nothing like the cause. Worth a warning, not a
     ban — the name is legal, and seeing why it breaks is a decent lesson. */
  function shadowedLibrary(name) {
    if (!pyodide || !/\.py$/i.test(name)) return null;
    var base = name.replace(/\.py$/i, "");
    try {
      pyodide.globals.set("_pyide_candidate", base);
      var hit = pyodide.runPython(
        "import sys; _pyide_candidate in sys.stdlib_module_names");
      return hit ? base : null;
    } catch (e) {
      return null;                      // older Pyodide; skip the warning
    }
  }

  var newFileBtn = $("new-file");
  if (newFileBtn) {
    newFileBtn.addEventListener("click", function () {
      var name = (window.prompt(
        "Name for the new file — data.txt, notes.md or helper.py:",
        "helper.py") || "").trim();
      if (!name) return;
      if (!NAME_OK.test(name)) {
        write("\n'" + name + "' won't work as a file name. Use letters, digits," +
              " dashes and underscores, ending in something like .py, .txt" +
              " or .csv.\n", "err");
        return;
      }
      if (name.toLowerCase() === MAIN) { switchTo(MAIN); return; }
      if (docs[name]) { switchTo(name); return; }

      var clash = shadowedLibrary(name);
      if (clash) {
        write("\nHeads up: '" + name + "' has the same name as a Python" +
              " library, so `import " + clash + "` will find this file instead" +
              " of the real one. Rename it if you meant to use the library.\n",
              "dim");
      }

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

  /* Declared before anything that calls into it: clearOutput() runs during the
     Python boot, and a hoisted `var` would still be undefined at that point. */
  var consoleIO = window.PyIDERuntime.attachConsole({
    outputEl: outputEl,
    // Stop is the way out for a student who changes their mind mid-question.
    onWaiting: function () { paintStop(); }
  });

  /* The input line a blocked program is waiting on lives in the output pane,
     so clearing has to put it back — otherwise Clear deletes the thing the
     program is waiting for and it hangs on a keystroke that can never come. */
  function clearOutput() {
    outputEl.textContent = "";
    consoleIO.restore();
  }

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
  // Shared with the demo page, so it lives in runtime.js.
  var BOOTSTRAP = window.PyIDERuntime.BOOTSTRAP;

  var pyodide = null;
  var pyRun = null;
  var running = false;

  (async function () {
    try {
      pyodide = await loadPyodide();
      window.PyIDERuntime.pipeOutput(pyodide, write);
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

  var runMode = null;

  /* Stop is offered for a game, which runs until told otherwise, and for a
     console program sitting on an unanswered input(). It stays hidden for a
     console program that is simply computing, where the time limit is what
     ends a runaway. */
  function paintStop() {
    stopBtn.hidden = !(running && (runMode === "game" || consoleIO.isWaiting()));
  }

  function setBusy(isRunning, mode) {
    running = isRunning;
    runMode = isRunning ? mode : null;
    runBtn.disabled = isRunning;
    runLabel.textContent = isRunning ? "Running…" : "Run";
    paintStop();
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
    consoleIO.setEnabled(true);
    try {
      /* runPythonAsync rather than calling _pyide_run directly, because that
         is what puts a suspender on the stack — without it input() has nothing
         to switch to and silently falls back to a dialog box. The source goes
         through a global rather than being pasted into this snippet, so a
         program containing quotes or backslashes can't corrupt the call. */
      pyodide.globals.set("_pyide_source", source);
      var result = await pyodide.runPythonAsync(
        "_pyide_run(_pyide_source, " + TIME_LIMIT_SECONDS + ")"
      );
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
    /* SDL takes the keyboard for the canvas while a game is up, so a field in
       the output pane would sit there collecting nothing. A game that calls
       input() gets the dialog box instead, which still works. */
    consoleIO.setEnabled(false);
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
      // give the keyboard back, or the editor — and the console's own input
      // line — stop accepting typed characters
      window.PyIDEGame.releaseKeyboard(pyodide, canvas);
      consoleIO.setEnabled(true);
      setBusy(false, "game");
      // the student stopped the game to get back to the code
      if (!window.PyIDENotes.isMarkdown(active)) editor.focus();
    }
  }

  function stopRun() {
    if (!running) return;
    /* A program blocked on input() isn't executing, so there is no loop to ask
       to stop — cancelling the read is what ends it, and Python turns that
       into the same "stopped" path a cancelled dialog used to take. */
    if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
    if (!pyodide) return;
    try { pyodide.runPython("request_stop()"); } catch (e) { /* not loaded */ }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stopRun);

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
  var hideCode = $("hide-code");   // absent on a read-only snapshot

  /* Two kinds of link come out of one button, so the dialog has to say which
     one it just produced — an accidental tick is otherwise invisible until a
     student opens the link and finds no code. */
  function describeShare(hidden) {
    $("modal-title").textContent = hidden ? "Demo link ready" : "Project shared";
    $("modal-sub").textContent = hidden
      ? "This link runs the program and shows the output. The code is not on the page."
      : "Anyone with this link can open and run this snapshot.";
    $("modal-note").textContent = hidden
      ? "Nobody can read, fork or download the program from this link — including you, " +
        "so keep your own copy. Recovering the code from it would take the browser's " +
        "developer tools, which is a fair barrier for a class but not a lock."
      : "The link captures your code exactly as it is right now. " +
        "If you keep working, share again to create an updated link.";
  }

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
            author: $("author").value,
            hidden: !!(hideCode && hideCode.checked)
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
        // the server decides, not the checkbox — they agree, but only one of
        // them knows what actually got written
        describeShare(!!data.hidden);
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
  /* One file downloads as one file; a project with imports or data files
     downloads as a zip. Handing over main.py alone would silently drop the
     module it imports, and the student would find out at home when nothing
     runs. */
  $("download").addEventListener("click", function () {
    var base = ($("title").value || "main").replace(/[^\w\-]+/g, "_").toLowerCase();
    var extras = dataFiles();
    var names = Object.keys(extras);

    if (!names.length) {
      var blob = new Blob([mainSource()], { type: "text/x-python" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = base + ".py";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      return;
    }

    var entries = [{ name: MAIN, data: mainSource() }];
    names.sort().forEach(function (n) {
      entries.push({ name: n, data: extras[n] });
    });
    window.PyIDEZip.download(base + ".zip", entries);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Escape" && running) stopRun();
  });
})();
