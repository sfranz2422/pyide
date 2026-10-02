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
  var dungeonGrid = $("dungeon-grid");
  var atlasList = $("atlas-list");
  var soundList = $("sound-list");

  // ------------------------------------------------------------- tab stops
  // Shared with the live-lesson editor, so it lives in tabstops.js.
  var indentToTabStop = window.PyIDETabStops.indentToTabStop;
  var backspaceToTabStop = window.PyIDETabStops.backspaceToTabStop;

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
      Tab: indentToTabStop,
      Backspace: backspaceToTabStop,
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

  var account = null;      // assigned further down, once the editor exists
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

  function modeFor(name) {
    return /\.py$/i.test(name) ? "python" : null;   // .txt and .csv are text
  }

  /* Which file the editor is actually editing.
     Deliberately not the same as `active`, and the gap between them caused a
     bug: selecting a .md tab makes it active but leaves the editor on the last
     code file, because notes render on the right rather than opening to be
     edited. So anything asking "what am I typing into?" — name completion,
     inserting a sprite — has to ask this instead. Asking `active` meant
     completion went silent the moment a project gained notes, and stayed
     silent until the student happened to click the main.py tab again. */
  function editingFile() {
    if (window.PyIDENotes.isMarkdown(active)) {
      return mdSourceOpen ? active : lastCodeFile;
    }
    return active;
  }

  /* docs[] holds the Doc objects themselves, and swapDoc doesn't change their
     identity, so there is nothing to write back when switching away. */
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
    // adding a file is a change, but fires no editor change event
    if (account) account.noteEdit();
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
    if (account) account.noteEdit();
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
  /* The code decides, and nothing else can.
   *
   * The chip used to be a button that pinned the mode. It was the wrong
   * shape for the problem: a student could pin Console on a game and then
   * press Run and get nothing, with the reason sitting in a chip they had
   * stopped reading. Pinning also had to be remembered, undone and painted
   * differently, which is three states where one will do.
   *
   * Now an import of kaypy means a game and anything else means console, so
   * what Run will do is always a fact about the code on screen.
   */
  function currentMode(source) {
    return window.PyIDEGame.looksLikeGame(source) ? "game" : "console";
  }

  function paintMode(mode) {
    modeTag.textContent = mode === "game" ? "Game" : "Console";
    modeTag.className = "mode mode-" + mode;
    modeTag.title = mode === "game"
      ? "Your code imports kaypy, so Run opens a game window."
      : "Run will run this in the console. Import kaypy to make it a game.";
    document.body.classList.toggle("is-game", mode === "game");

    // Sprites are only meaningful to a game, so the button appears with one.
    // So is the engine's documentation: in console mode it would be a link
    // to the wrong manual.
    var isGame = mode === "game";
    spritesToggle.hidden = !isGame;
    var docs = $("kaypy-docs");
    if (docs) docs.hidden = !isGame;
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
    // what the editor holds, not which tab is lit — see editingFile()
    if (editingFile() !== MAIN) return;

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

  // -------------------------------------------------------------- requests
  /* `requests` works in Pyodide — urllib3 talks to the browser's
     XMLHttpRequest, so a plain synchronous requests.get() really does return
     a response. It is not in Pyodide's own package set, though, so
     loadPackagesFromImports cannot find it and `import requests` would be a
     ModuleNotFoundError. It gets installed here instead.
   
     FROM THIS APP, NOT FROM PyPI
   
     micropip.install("requests") works and costs 445 KB per student per
     session from files.pythonhosted.org — 13 MB of PyPI traffic for one
     class, at the exact moment they all press Run. A school network that
     blocks PyPI would stop the lesson with nothing on screen to explain it.
     The wheels are vendored, so this fetches from the same host that served
     the page. See tools/vendor_requests.py.
   
     ONLY WHEN ASKED FOR
   
     Most programs never import it, and half a megabyte on every Run for a
     print() exercise is a bad trade. */
  var REQUESTS_RE =
    /^[ \t]*(?:import[ \t]+requests\b|from[ \t]+requests[ \t]+import\b)/m;
  var requestsReady = false;
  var requestsWorking = null;

  function wantsRequests(source) { return REQUESTS_RE.test(source); }

  async function ensureRequests(source) {
    if (requestsReady || !wantsRequests(source)) return;
    // Two Runs in quick succession must not install it twice; the second
    // waits on the first rather than starting its own.
    if (requestsWorking) return requestsWorking;

    requestsWorking = (async function () {
      status("Loading requests…");
      var manifest = await fetch("/static/py/wheels.json",
                                 { cache: "force-cache" }).then(function (r) {
        if (!r.ok) throw new Error("wheels.json is missing (" + r.status + ")");
        return r.json();
      });
      var urls = manifest.wheels.map(function (w) {
        return "/static/py/wheels/" + w.file;
      });
      await pyodide.loadPackage("micropip");
      /* All five in one call. Installed one at a time, requests would go in
         before urllib3 exists and micropip would go looking for it on PyPI —
         which is the trip this whole arrangement exists to avoid. */
      pyodide.globals.set("_pyide_wheels", JSON.stringify(urls));
      await pyodide.runPythonAsync(
        "import json, micropip\n" +
        "await micropip.install(json.loads(_pyide_wheels))\n");
      requestsReady = true;
      status("");
    })();

    try {
      await requestsWorking;
    } catch (e) {
      requestsWorking = null;
      status("");
      write("Could not load requests: " + e + "\n" +
            "Your teacher may need to run tools/vendor_requests.py.\n", "err");
      throw e;
    }
    requestsWorking = null;
  }

  // ---------------------------------------------------------------- run it
  /* Whether anything here has been run yet. Until it has, the output pane
     holds only "Python is ready" and the like, and a live lesson sends no
     output at all — otherwise every class would be shown the teacher's
     loading messages as if they were a program. */
  var hasRun = false;

  async function run() {
    if (running || !pyRun) return;
    hasRun = true;
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
      await ensureRequests(source);
    } catch (e) {
      setBusy(false);
      return;                       // the reason is already on screen
    }

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

  /* Which run the finally below belongs to.
   *
   * Stop now puts the toolbar back itself, so a game can be stopped and
   * another started while the first run's promise is still pending. If that
   * old promise ever settles, its finally would call PyIDEGame.stop() and
   * setBusy(false) on whatever is running NOW — stopping the new game for no
   * visible reason, seconds after it started. The token makes a finally that
   * no longer owns the toolbar do nothing at all. */
  var runToken = 0;

  async function runGame(source) {
    var token = ++runToken;
    setBusy(true, "game");
    showOutput();
    clearOutput();
    await repaint();

    try {
      await ensureRequests(source);
    } catch (e) {
      setBusy(false);
      return;
    }

    try {
      /* ensureReady hands back a NEW canvas each time, and points SDL at it.
         Rebinding here is what keeps focus() and the key handlers on the live
         element. The source goes along so it can fetch the sprites and sounds
         this particular program names, and only those. */
      canvas = await window.PyIDEGame.ensureReady(pyodide, function (msg) {
        status(msg);
      }, source);
      bindCanvas(canvas);
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
      /* Two steps, because they fail differently. The first runs the program
         top to bottom, the way `python game.py` does — kaypy() builds the
         engine and everything after it registers handlers. An error there is
         an error in the student's setup and stops the run.

         The second awaits the frame loop, which is a Python coroutine now and
         does not return until the game ends or Stop is pressed. That is the
         opposite of the Kaplay days, when JavaScript owned the loop and this
         returned in milliseconds while the game carried on — and it is
         better: a game that ends by itself now puts the Run button back
         without being told. */
      var status_ = await pyodide.runPythonAsync(
        "_pyide_run_game(" + JSON.stringify(source) + ")"
      );
      if (status_ === "ok") {
        await pyodide.runPythonAsync("await _pyide_drive_game()");
      }
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      // Only if this is still the run the toolbar is showing. See runToken.
      if (token === runToken) {
        window.PyIDEGame.stop(pyodide);
        setBusy(false, "game");
        pullFilesFromPython();
      }
    }
  }

  function stopRun() {
    if (!running) return;
    if (runMode === "game") {
      /* Ask, don't tear down: Stop clears the engine's `running` flag and the
         loop returns on its next frame.

         THE TOOLBAR IS PUT BACK HERE, not by runGame's finally.

         It used to be left to the finally, on the reasoning that resetting in
         two places would be two answers to one question. That reasoning was
         wrong in the only way that matters: the first answer never arrives.
         Measured on the deployed app — press Stop on a kaypy game and the
         canvas freezes, "— stopped —" is printed, and the await on
         `_pyide_drive_game()` stays pending for ever, so Run sat on
         "Running…" with Stop showing until the page was reloaded. The engine
         had stopped; only the button disagreed.

         Calling stop() re-enters Python synchronously while that coroutine is
         suspended, which is the likely reason the promise never settles — but
         the fix does not depend on being right about that. The user asked to
         stop, the engine has been told, so the UI is now correct to say so,
         whatever the promise does afterwards. runGame's finally is guarded by
         a run token so it cannot undo a later run. */
      window.PyIDEGame.stop(pyodide);
      write("\n— stopped —\n", "dim");
      setBusy(false);
      pullFilesFromPython();
      if (!window.PyIDENotes.isMarkdown(active)) editor.focus();
      return;
    }
    /* A program blocked on input() isn't executing, so there is no loop to ask
       to stop — cancelling the read is what ends it, and Python turns that
       into the same "stopped" path a cancelled dialog used to take. */
    if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
    /* Nothing else to do: Stop is only offered for a game or for a program
       sitting on input(). A console program that is merely computing is ended
       by the time limit, not by this button, which is why it stays hidden. */
  }

  /* The support address, put together at run time.
     Split so the whole address never appears as one string anywhere a
     scraper can read it — this page is public. Writing the address out in
     THIS comment would have defeated the entire exercise, which is exactly
     what the first version of it did. */
  var support = $("support");
  if (support) {
    var who = ["stephenfranz22", "gmail.com"].join("\u0040");
    support.href = "mailto:" + who +
      "?subject=" + encodeURIComponent("PyIDE — a question from a teacher");
    support.title = "Email " + who + " about using PyIDE with your class";
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stopRun);

  /* Re-bound after every canvas swap, because the listeners belong to the
     element and the element is replaced for each new game. */
  function bindCanvas(el) {
    el.addEventListener("keydown", function (e) {
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) >= 0) {
        e.preventDefault();
      }
    });
    el.addEventListener("mousedown", function () { el.focus(); });
  }

  bindCanvas(canvas);

  // --------------------------------------------------------- sprite panel
  var spritesFetched = false;

  function insertAtCursor(text) {
    if (window.PYIDE.readonly) return;
    /* Sprites belong in the program, not in a data file. Same distinction as
       above: if the editor is already on main.py there is nothing to switch,
       and switching anyway would close the notes a student is reading. */
    if (editingFile() !== MAIN) switchTo(MAIN);
    editor.replaceSelection(text, "end");
    editor.focus();
  }

  /* How tall a thumbnail may be, and how wide before it is shrunk to fit a
     third of a 268px panel. */
  var THUMB_H = 44, THUMB_W = 60;

  /* A cell showing one sprite. `frames` is how many frames sit side by side in
     the file, so the cell can show just the first one. */
  function spriteCell(name, dir, w, h, frames, note) {
    var cell = document.createElement("button");
    cell.className = "sprite";
    cell.type = "button";
    cell.dataset.name = name;
    cell.title = name + " — " + w + "×" + h +
      (note ? " — " + note : "") + " — click to insert";

    var scale = Math.min(THUMB_H / h, THUMB_W / w, 3);
    var box = document.createElement("span");
    box.className = "sprite-img";

    var window_ = document.createElement("span");
    window_.className = "sprite-frame";
    window_.style.width = Math.round(w * scale) + "px";
    window_.style.height = Math.round(h * scale) + "px";

    var img = document.createElement("img");
    img.src = "/static/assets/" + dir + "/" + name + ".png";
    img.alt = "";
    img.loading = "lazy";
    img.style.width = Math.round(w * scale) * frames + "px";

    window_.appendChild(img);
    box.appendChild(window_);
    cell.appendChild(box);

    if (frames > 1) {
      var mark = document.createElement("span");
      mark.className = "sprite-anim";
      mark.textContent = "▶";
      cell.appendChild(mark);
    }

    var label = document.createElement("span");
    label.className = "sprite-name";
    label.textContent = name;
    cell.appendChild(label);
    return cell;
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

    /* Both packs are drawn the same way. The only difference is the folder the
       pictures live in, and that the dungeon pack has animated entries. */
    function addPack(entries, dir, grid) {
      entries.forEach(function (entry) {
        var frames = entry.frames || 1;
        var names = entry.anims ? Object.keys(entry.anims) : [];
        var cell = spriteCell(entry.name, dir, entry.w, entry.h, frames,
                              names.join(", "));
        cell.addEventListener("click", function () {
          insertAtCursor(window.PyIDESprites.insertFor(entry, dir));
        });
        grid.appendChild(cell);
      });
    }

    spriteGrid.textContent = "";
    addPack(manifest.images || [], "images", spriteGrid);
    addPack(manifest.dungeon || [], "dungeon", dungeonGrid);
    $("dungeon-section").hidden = !dungeonGrid.children.length;

    /* The atlas: one image holding many sprites, cut out by coordinates. The
       dungeon pack above is this same artwork already cut up — quicker to use,
       but it hides where sprites come from, which is the thing the atlas
       lesson is for. So both are here. */
    (manifest.atlases || []).forEach(function (atlas) {
      var card = document.createElement("button");
      card.className = "atlas-card";
      card.type = "button";
      card.dataset.name = atlas.name + " atlas spritesheet";
      var regions = Object.keys(atlas.regions);
      card.title = atlas.file + " — " + atlas.w + "×" + atlas.h + " — " +
                   regions.join(", ") + " — click to insert";
      card.innerHTML =
        '<img src="/static/assets/' + atlas.file + '" alt="" loading="lazy">' +
        '<span class="sprite-name">' + atlas.file + "</span>" +
        '<p class="atlas-note">' + regions.length +
        " regions cut out by coordinates: " + regions.join(", ") + "</p>";
      card.addEventListener("click", function () {
        insertAtCursor(window.PyIDESprites.insertAtlas(atlas));
      });
      atlasList.appendChild(card);
    });
    $("atlas-section").hidden = !atlasList.children.length;

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
        b.title = 'Insert loadSound("' + name + '", ...) and play("' + name + '")';
        b.addEventListener("click", function () {
          insertAtCursor(
            'loadSound("' + name + '", "sounds/' + file + '")\n' +
            'play("' + name + '")');
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
    var total = 0;

    /* Each pack is filtered on its own so an empty one can take its heading
       with it: searching "elf" should not leave a "Kaplay pack" label sitting
       above nothing. */
    [[spriteGrid, "images-section"], [dungeonGrid, "dungeon-section"],
     [atlasList, "atlas-section"]]
      .forEach(function (pair) {
        var shown = 0;
        Array.prototype.forEach.call(pair[0].children, function (cell) {
          if (!cell.dataset.name) return;      // the "Loading…" placeholder
          var hit = !q || cell.dataset.name.indexOf(q) >= 0;
          cell.hidden = !hit;
          if (hit) shown++;
        });
        $(pair[1]).hidden = pair[0].children.length > 0 && shown === 0;
        total += shown;
      });

    $("sprite-empty").hidden = total > 0;
  });

  $("sprites-close").addEventListener("click", closeSprites);

  // ----------------------------------------------------- saving and turn-in
  /* Dormant unless somebody is signed in and this is a saved project. */
  /* The safety net for anyone not signed in. Attached before the account
     module, so a rescued project is in the editor before autosave has any
     opinion about what the project is. */
  var rescue = window.IDERescue.attach({
    app: "pyide",
    cfg: {
      signedIn: window.PYIDE.signedIn,
      assignmentSlug: window.PYIDE.assignmentSlug,
      draftSlug: window.PYIDE.draftSlug,
      draftFresh: window.PYIDE.draftFresh
    },
    readAll: function () {
      var all = dataFiles();
      all[MAIN] = mainSource();
      return all;
    },
    writeAll: function (incoming) {
      Object.keys(docs).forEach(function (name) {
        if (name !== MAIN) delete docs[name];
      });
      Object.keys(incoming).forEach(function (name) {
        if (name === MAIN) docs[MAIN].setValue(incoming[name]);
        else docs[name] = makeDoc(incoming[name]);
      });
      active = MAIN;
      lastCodeFile = MAIN;
      mdSourceOpen = false;
      showEditorDoc(MAIN);
      renderTabs();
      relayout();
    },
    onRestored: function () { if (account) account.noteEdit(); }
  });

  account = window.PyIDEAccount.attach({
    read: function () {
      return {
        code: mainSource(),
        files: dataFiles(),
        title: $("title").value
      };
    },
    say: write
  });

  // Every change to any file counts, including a data file or the notes
  editor.on("change", function () {
    account.noteEdit();
    rescue.noteEdit();
  });


  // ----------------------------------------------------------------- share
  var shareBtn = $("share");
  var hideCode = $("hide-code");   // a teacher's, in the share-ask dialog
  var shareAsk = $("share-ask");

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

  /* A teacher's Share opens share-ask first, to choose between a plain link
     and a demo link; a student's goes straight to sharing. The box is
     unticked every time the dialog opens, so a demo link is always a choice
     made just now and never one left over from the last share. */
  async function doShare(hidden) {
    // a submission nobody can be identified from is no use to a teacher
    if (!authorField.value.trim()) {
      flagAuthor("Put your name in the box at the top before sharing.");
      return;
    }
    // Pressed from the account menu there is no Share on the bar to show
    // "Sharing…" on, and a stand-in keeps the lines below from caring.
    var btn = shareBtn || document.createElement("button");
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = "Sharing…";
    try {
      var res = await fetch(window.PYIDE.shareUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: mainSource(),
          files: dataFiles(),
          title: $("title").value,
          author: $("author").value,
          hidden: !!hidden
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
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      if (!shareAsk) { doShare(false); return; }
      if (hideCode) hideCode.checked = false;
      shareAsk.hidden = false;
      $("share-go").focus();
    });
  }
  // A signed-in student's Share, out of the way in the account menu: they
  // have Save or Turn in on the bar, and that is the one thing to press.
  if ($("share-menu")) {
    $("share-menu").addEventListener("click", function () { doShare(false); });
  }
  if (shareAsk) {
    $("share-go").addEventListener("click", function () {
      shareAsk.hidden = true;
      doShare(!!(hideCode && hideCode.checked));
    });
    $("share-cancel").addEventListener("click", function () { shareAsk.hidden = true; });
    shareAsk.addEventListener("click", function (e) {
      if (e.target === shareAsk) shareAsk.hidden = true;
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
  /* Download sits in the toolbar for a signed-out student and in the account
     menu for a signed-in one, so bind whichever is actually on the page. */
  async function onDownload() {
    var base = ($("title").value || "main").replace(/[^\w\-]+/g, "_").toLowerCase();
    var source = mainSource();

    /* A game downloads as a zip: the playable page AND the source.
       main.py on its own needs the engine, a canvas and a Python interpreter
       to do anything, none of which a student has at home — so the .html
       carries all three and can be double-clicked.

       But the .html cannot be edited. The program is in there byte for byte,
       and so is the whole engine, base64'd, so a student who keeps only the
       page has a game they can play and can never change again. The .py files
       go in beside it, which is what the kaypy playground does for the same
       reason. */
    if (currentMode(source) === "game") {
      var was = runLabel.textContent;
      runBtn.disabled = true;
      runLabel.textContent = "Packing…";
      try {
        var html = await window.PyIDEExport.buildGamePage(
          source, $("title").value || "Game", function (msg) {
            runLabel.textContent = msg.length > 14 ? "Packing…" : msg;
          });

        var gameEntries = [
          { name: base + ".html", data: html },
          { name: MAIN, data: source }
        ];
        // every other file the project has: imported modules, data files
        var alsoFiles = dataFiles();
        Object.keys(alsoFiles).sort().forEach(function (n) {
          gameEntries.push({ name: n, data: alsoFiles[n] });
        });

        window.PyIDEZip.download(base + ".zip", gameEntries);
        write("\nSaved " + base + ".zip\n" +
              "  " + base + ".html  — double-click to play, or upload it\n" +
              "  " + MAIN + "        — your code, to keep working on\n" +
              (Object.keys(alsoFiles).length
                ? "  and " + Object.keys(alsoFiles).length + " more file(s)\n"
                : "") +
              "The game needs the internet the first time it runs.\n", "dim");
      } catch (e) {
        write("\nCould not pack the game: " + e.message + "\n", "err");
      } finally {
        runBtn.disabled = running;
        runLabel.textContent = was;
      }
      return;
    }

    /* One file downloads as one file; a project with imports or data files
       downloads as a zip. Handing over main.py alone would silently drop the
       module it imports, and the student would find out at home when nothing
       runs. */
    var extras = dataFiles();
    var names = Object.keys(extras);

    if (!names.length) {
      var blob = new Blob([source], { type: "text/x-python" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = base + ".py";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      return;
    }

    var entries = [{ name: MAIN, data: source }];
    names.sort().forEach(function (n) {
      entries.push({ name: n, data: extras[n] });
    });
    window.PyIDEZip.download(base + ".zip", entries);
  }

  ["download", "download-menu", "download-share"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("click", onDownload);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Escape" && running) stopRun();
  });

  // ------------------------------------------------------------ teach live
  //
  // Go live and carry on working. Whatever file is open here is what the
  // class sees at /live/<code>; switching tabs switches what they are
  // watching, which is what a teacher means by "look at this bit".
  //
  // The file is sent WHOLE, every time, rather than as a diff. A diff stream
  // is smaller and needs every update to arrive, in order — which polling
  // cannot promise. Sending the whole file means a student whose wifi drops
  // ten updates is correct again on the eleventh, and a student who joins in
  // the middle needs no catch-up path at all.

  var liveBtn = $("go-live");
  var liveChip = $("live-code");

  if (liveBtn) {
    var liveCode = null;
    var liveTimer = null;
    var lastSent = null;
    var lastVersion = 0;
    var liveFor = "";           // assignment title, for the chip's tooltip
    var PUSH_MS = 400;

    /* A stamp that only ever goes up, and the server refuses anything lower
       than the row already has. Two pushes overtaking each other on a slow
       connection would otherwise leave the OLDER text on screen with the
       newer version number, and the class would sit looking at a line that
       had already been fixed.

       Date.now() rather than a counter starting at 1, so that reloading this
       page mid-lesson does not start numbering below what the row has
       reached — which would get every push after the reload rejected, with
       the mirror silently frozen and the button still saying Live. The
       max() covers a machine whose clock is behind the one that started it. */
    function nextSeq() {
      lastVersion = Math.max(Date.now(), lastVersion + 1);
      return lastVersion;
    }

    /* The project's notes: its first .md file, the same one a student
       opening the assignment link is shown first. Sent on every push so the
       class keeps them beside the lesson whichever tab is open here — before
       this, they reached the class only while the .md tab was selected. */
    function notesFile() {
      var md = fileNames().filter(window.PyIDENotes.isMarkdown);
      return md.length ? md[0] : null;
    }

    function liveNotes() {
      var md = notesFile();
      return md ? docs[md].getValue() : "";
    }

    /* ------------------------------------------------------------ slides
       Notes with `---` dividers are slides, and the class is sent ONE: the
       one this teacher is on. Here the whole file stays in the editor, as
       ever. The cutting happens in this browser, so the server stores and
       students render exactly what they did before — the only new thing on
       the wire is "3/5".

       `slideAt` is an index that survives editing the notes mid-lesson, and
       is clamped when slides are deleted out from under it. Two slides at
       least, or it is not slides: a file whose one `---` leaves only one
       slide with anything on it goes whole.

       `wholeNotes` is Show all: the class gets the whole file, as if it had
       no `---` at all. For notes that are a page of directions rather than
       a deck, whose rules would otherwise chop them into pieces the
       class can only see one at a time. slideAt is kept, so turning it off
       goes back to the slide the class was on. Remembered for this lesson
       across a reload of this page — otherwise a reload would snap thirty
       screens back to one slide with nobody having asked. */
    var slideAt = 0;
    var wholeNotes = false;
    var slideCtl = $("live-slides");
    var slideLabel = $("slide-at");
    var wholeBtn = $("slide-whole");

    function currentSlides() {
      var cut = window.PyIDENotes.slides(liveNotes());
      return cut.length >= 2 ? cut : null;
    }

    function paintSlides(cut) {
      if (!slideCtl) return;
      slideCtl.hidden = !(liveCode && cut);
      if (slideCtl.hidden) return;
      slideLabel.textContent = (slideAt + 1) + " / " + cut.length;
      slideLabel.hidden = $("slide-prev").hidden = $("slide-next").hidden
        = wholeNotes;
      $("slide-prev").disabled = slideAt <= 0;
      $("slide-next").disabled = slideAt >= cut.length - 1;
      wholeBtn.textContent = wholeNotes ? "Slides" : "Show all";
      wholeBtn.title = wholeNotes
        ? "Go back to sending the class one slide at a time"
        : "Send the whole notes file to the class instead of one slide";
    }

    function setWhole(on) {
      wholeNotes = on;
      try {
        if (on) localStorage.setItem("pyide-live-whole", liveCode + "/" + slideAt);
        else localStorage.removeItem("pyide-live-whole");
      } catch (e) {}
      pushNow();                 // now, not on the next tick
    }

    function moveSlide(by) {
      var cut = currentSlides();
      if (!liveCode || !cut || wholeNotes) return;
      slideAt = Math.max(0, Math.min(cut.length - 1, slideAt + by));
      pushNow();                 // now, not on the next tick
    }

    if (slideCtl) {
      $("slide-prev").addEventListener("click", function () { moveSlide(-1); });
      $("slide-next").addEventListener("click", function () { moveSlide(1); });
      wholeBtn.addEventListener("click", function () { setWhole(!wholeNotes); });
    }

    /* What the class's Notes pane shows, shown here under the output: the
       current slide, or the whole notes when they are not slides or Show
       all is on. Fed the
       very `notes` and `slide` pushNow sends, so it cannot disagree with
       the class about which slide they are on — a copy worked out
       separately from slideAt could.

       Re-rendered only when they change. pushNow runs on every tick, and
       rendering markdown that often would reset the scroll under the
       teacher's hand. */
    var classView = $("class-view");
    var classNotes = $("class-notes");
    var classShownNotes = null, classShownSlide = null;

    function paintClassView(notes, slide) {
      if (!classView) return;
      if (notes === classShownNotes && slide === classShownSlide) return;
      var moved = slide !== classShownSlide;
      classShownNotes = notes;
      classShownSlide = slide;
      classView.hidden = !(notes && notes.trim());
      if (classView.hidden) return;
      window.PyIDENotes.render(classNotes, notes).then(function () {
        if (moved) classNotes.scrollTop = 0;
      });
    }

    /* The tail of what the last Run printed. textContent, so an input()
       prompt waiting for the teacher's answer goes as the words of the
       prompt and nothing else. Trimmed here as well as on the server, to
       keep a print loop from sending 200 KB every 400ms to thirty polls. */
    var OUTPUT_CHARS = 16000;
    function liveOutput() {
      if (!hasRun) return "";
      var text = outputEl.textContent || "";
      return text.length > OUTPUT_CHARS ? text.slice(-OUTPUT_CHARS) : text;
    }

    function pushNow() {
      if (!liveCode) return;
      var name = active;
      var text = docs[name] ? docs[name].getValue() : mainSource();
      var notes = liveNotes();
      var slide = "";
      var cut = currentSlides();
      if (cut && !wholeNotes) {
        slideAt = Math.min(slideAt, cut.length - 1);
        notes = cut[slideAt];
        slide = (slideAt + 1) + "/" + cut.length;
        /* With the notes tab open, the mirror shows that file too — whole,
           which would put every slide on screen at once and defeat the
           point. It gets the current slide like the notes pane does. */
        if (name === notesFile()) text = notes;
      }
      /* Where the caret is, so the class sees it blink in the mirror and
         the mirror scrolls to follow it. In the stamp below, so moving it
         without typing still goes out — pointing at a line is half of
         teaching from the editor. None for a notes file: the class reads
         that rendered, where a line and column point at nothing.

         A highlighted block goes as "anchor-head", and the class sees it
         in yellow: dragging across a loop to talk about it is pointing
         at more than one line. Only the main selection — a second one
         made with Ctrl-click is rare, and the class would not know which
         one the teacher meant. */
      var cursor = "";
      if (docs[name] && !window.PyIDENotes.isMarkdown(name)) {
        var at = docs[name].getCursor("head");
        cursor = at.line + ":" + at.ch;
        if (docs[name].somethingSelected()) {
          var from = docs[name].getCursor("anchor");
          cursor = from.line + ":" + from.ch + "-" + cursor;
        }
      }
      paintSlides(cut);
      paintClassView(notes, slide);
      var output = liveOutput();
      var stamp = [name, text, notes, slide, output, cursor].join("\u0000");
      if (stamp === lastSent) return;      // nothing typed since last time
      lastSent = stamp;
      fetch("/api/live/" + encodeURIComponent(liveCode) + "/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, filename: name, notes: notes,
                               slide: slide, output: output,
                               cursor: cursor, seq: nextSeq() })
      }).then(function (res) {
        if (res.status === 403 || res.status === 409) { stopLive(true); return; }
        return res.json().then(function (data) {
          /* Lost the race — most likely to a snippet sent a moment later,
             which moves the same version. Without forgetting what was sent,
             the check above would call this file "already pushed" and the
             class would sit on the old one until the next keystroke. */
          if (data && data.stale) lastSent = null;
        });
      }).catch(function () {
        // A dropped push is fine: the next one carries the whole file.
      });
    }

    // ------------------------------------------------ send to students
    /* Highlight, right-click, Send to students. The class gets a card above
       their own editor with an Insert button — for THIS code only. The mirror
       still cannot be copied, because typing the lesson is the exercise; this
       is for the bits that are not (a data list, a helper the lesson uses).

       Only while live and only with something selected. Any other
       right-click is left entirely to the browser, so the menu a teacher
       knows is still there the rest of the time. */
    var sentChip = $("live-sent");
    var ctxMenu = null;

    function paintSent(out) {
      if (sentChip) sentChip.hidden = !(liveCode && out);
    }

    function sendSnippet(text, tries) {
      if (!liveCode) return;
      tries = tries || 0;
      fetch("/api/live/" + encodeURIComponent(liveCode) + "/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: text, seq: nextSeq() })
      }).then(function (res) {
        if (res.status === 403 || res.status === 409) { stopLive(true); return; }
        return res.json().then(function (data) {
          if (data.error) { window.alert(data.error); return; }
          /* A push overtook it. Silently dropping it would leave the teacher
             believing the class had the code; the new stamp is higher than
             anything already sent, so one more try goes through. */
          if (data.stale) {
            if (tries < 3) sendSnippet(text, tries + 1);
            else window.alert("Could not send that. Try again.");
            return;
          }
          paintSent(!!text);
        });
      }).catch(function () {
        window.alert("Could not send that. Check your connection.");
      });
    }

    function closeCtxMenu() {
      if (ctxMenu) ctxMenu.hidden = true;
    }

    function openCtxMenu(x, y, text) {
      if (!ctxMenu) {
        ctxMenu = document.createElement("div");
        ctxMenu.className = "menu ctx-menu";
        ctxMenu.setAttribute("role", "menu");
        var item = document.createElement("button");
        item.className = "menu-item";
        item.textContent = "Send to students";
        item.addEventListener("click", function () {
          closeCtxMenu();
          sendSnippet(ctxMenu.dataset.text || "");
        });
        ctxMenu.appendChild(item);
        document.body.appendChild(ctxMenu);
        document.addEventListener("mousedown", function (e) {
          if (!ctxMenu.contains(e.target)) closeCtxMenu();
        });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape") closeCtxMenu();
        });
        window.addEventListener("blur", closeCtxMenu);
        window.addEventListener("resize", closeCtxMenu);
      }
      ctxMenu.dataset.text = text;
      ctxMenu.hidden = false;
      // Kept on screen: opened near the right or bottom edge it would
      // otherwise hang off it, half unclickable.
      var w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
      ctxMenu.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
      ctxMenu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
    }

    /* CodeMirror's own "contextmenu" event: preventDefault there is what
       stops both the browser's menu and CodeMirror's handling of the click.
       The selection survives a right-click in CodeMirror 5, which is what
       makes highlight-then-right-click work at all. */
    editor.on("contextmenu", function (cm, e) {
      if (!liveCode || !cm.somethingSelected()) return;
      var text = cm.getSelection();
      if (!text.trim()) return;
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, text);
    });
    editor.on("scroll", closeCtxMenu);

    if (sentChip) {
      sentChip.addEventListener("click", function () { sendSnippet(""); });
    }

    function liveLink() {
      return location.origin + "/live/" + encodeURIComponent(liveCode);
    }

    /* The chip still reads as the code, which is what a teacher says out
       loud; clicking it copies the whole address for the class's chat. The
       label flashes "Link copied" and then goes back to the code — unless the
       lesson ended in the meantime, when paintLive has already moved on. */
    liveChip.addEventListener("click", function () {
      if (!liveCode) return;
      var link = liveLink();
      function flash(text) {
        var code = liveCode;
        liveChip.textContent = text;
        setTimeout(function () {
          if (liveCode === code) liveChip.textContent = code;
        }, 1500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () {
          flash("Link copied");
        }, function () { window.prompt("Copy this link for your class:", link); });
      } else {
        window.prompt("Copy this link for your class:", link);
      }
    });

    function paintLive() {
      if (liveCode) {
        liveBtn.textContent = "End lesson";
        liveBtn.classList.add("btn-live-on");
        liveChip.hidden = false;
        liveChip.textContent = liveCode;
        liveChip.title = "Click to copy the class's link: " + liveLink()
          + "\n(or they go to /live and type " + liveCode + ")"
          + (liveFor ? "\nThey can turn in to: " + liveFor
                     : "\nNo assignment, so they cannot turn work in.");
      } else {
        liveBtn.textContent = "Go live";
        liveBtn.classList.remove("btn-live-on");
        liveChip.hidden = true;
        paintSent(false);
        paintSlides(null);
        paintClassView(null, "");
        closeCtxMenu();
      }
    }

    function stopLive(quietly) {
      var code = liveCode;
      liveCode = null;
      if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
      lastSent = null;
      wholeNotes = false;
      paintLive();
      try {
        localStorage.removeItem("pyide-live-host");
        localStorage.removeItem("pyide-live-whole");
      } catch (e) {}
      if (code && !quietly) {
        fetch("/api/live/" + encodeURIComponent(code) + "/stop", { method: "POST" });
      }
    }

    /* Which assignment this lesson is for, asked once when Go live is
       pressed.

       IT IS NOT A NICETY. Turning work in needs a draft with an assignment
       on it, so a lesson with none is a lesson the class cannot hand
       anything in from — and nothing about that is visible while it is
       happening. Asking here is the one moment the teacher is thinking
       about the lesson anyway. */
    function chooseAssignment() {
      return fetch("/api/live/assignments")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var list = (data && data.assignments) || [];
          if (!list.length) return "";       // nothing published yet
          /* WORDED AS WHAT IT DOES. "Which assignment is this lesson for?"
             read like it was about to open the assignment, and it is not —
             it decides where the CLASS's work goes when they press Save.
             Loading the starter is offered separately below, because that
             one does replace what is on screen. */
          var lines = ["Where should the class turn this work in?",
                       "(This does not change what is in your editor.)", "",
                       "0 — nowhere (they can still save, but not turn in)"];
          list.forEach(function (a, i) {
            lines.push((i + 1) + " — " + a.title);
          });
          var pick = window.prompt(lines.join("\n"), "1");
          if (pick === null) return null;    // cancelled: do not go live
          var n = parseInt(pick, 10);
          if (!n || n < 1 || n > list.length) return "";
          return list[n - 1].slug;
        })
        .catch(function () { return ""; });
    }

    /* Open an assignment's starter in the editor.
     *
     * ASKED, NEVER SILENT. This replaces everything open, so a teacher who
     * pressed Go live in the middle of a lesson to resume a broadcast would
     * otherwise lose what they were demonstrating. It is offered only when
     * an assignment was actually chosen, and only on a fresh Go live — the
     * reload-resume path never reaches here.
     */
    function offerStarter(slug) {
      if (!slug) return Promise.resolve();
      return fetch("/api/live/assignment/" + encodeURIComponent(slug))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) return;
          if (!window.confirm(
                "Open the starter for \u201c" + data.title + "\u201d?\n\n"
                + "This replaces what is in your editor now.")) {
            return;
          }
          loadStarter(data.code, data.files);
        })
        .catch(function () { /* the lesson still goes live without it */ });
    }

    function loadStarter(code, files) {
      Object.keys(docs).forEach(function (name) {
        if (name === MAIN) return;
        delete docs[name];
        // The old file is still in Pyodide's filesystem, where an `import`
        // would find it long after its tab has gone.
        try { pyodide.FS.unlink(PROJECT_DIR + "/" + name); } catch (e) {}
      });
      docs[MAIN].setValue(code || "");
      Object.keys(files || {}).sort().forEach(function (name) {
        docs[name] = makeDoc(files[name]);
      });
      active = MAIN;
      lastCodeFile = MAIN;
      mdSourceOpen = false;
      showEditorDoc(MAIN);
      showOutput();
      renderTabs();
      relayout();
      if (account) account.noteEdit();
    }

    function startLive(assignment, resume) {
      var name = active;
      var text = docs[name] ? docs[name].getValue() : mainSource();
      fetch("/api/live/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignment === undefined
          ? { body: text, filename: name, resume: resume || "",
              title: ($("title") && $("title").value) || "Live lesson" }
          /* `assignment` present — even as "" — is what tells the server this
             was a deliberate choice. Left out, a resumed session keeps the
             assignment it already had rather than silently losing it on a
             page reload, which would leave the class unable to hand in with
             nothing on screen to say why. */
          : { body: text, filename: name, assignment: assignment,
              title: ($("title") && $("title").value) || "Live lesson" })
      }).then(function (res) { return res.json(); })
        .then(function (data) {
          if (resume && data.error) return;   // no alert for a quiet resume
          if (data.error) { window.alert(data.error); return; }
          if (data.resumed === false) {
            // That lesson is over. Forget it, and stay off the air.
            try { localStorage.removeItem("pyide-live-host"); } catch (e) {}
            return;
          }
          liveCode = data.code;
          liveFor = data.assignment_title || "";
          lastVersion = data.version || 0;
          // Back on the slide the class is looking at, after a reload. A
          // fresh lesson has none and starts at the beginning.
          var at = /^(\d+)\//.exec(data.slide || "");
          slideAt = at ? Math.max(0, parseInt(at[1], 10) - 1) : 0;
          /* With Show all on, the class has no slide number to come back
             to, so the one they were on is kept beside the flag — turning
             it off after a reload would otherwise start them at slide 1. */
          var whole = null;
          try { whole = localStorage.getItem("pyide-live-whole"); } catch (e) {}
          wholeNotes = !!whole && whole.split("/")[0] === liveCode;
          if (wholeNotes) slideAt = parseInt(whole.split("/")[1], 10) || 0;
          lastSent = null;
          try { localStorage.setItem("pyide-live-host", liveCode); } catch (e) {}
          paintLive();
          paintSent(!!data.snippet_out);
          pushNow();
          liveTimer = setInterval(pushNow, PUSH_MS);
        })
        .catch(function () {
          if (resume) return;
          window.alert("Could not start the live lesson. Check your connection.");
        });
    }

    liveBtn.addEventListener("click", function () {
      if (liveCode) {
        if (window.confirm("End the lesson? Your class stops seeing this editor.")) {
          stopLive(false);
        }
      } else {
        chooseAssignment().then(function (slug) {
          if (slug === null) return;        // they cancelled the chooser
          // Offer the starter first, so the file that goes out on the very
          // first push is the one they are about to teach from.
          offerStarter(slug).then(function () { startLive(slug); });
        });
      }
    });

    /* Reloading the editor mid-lesson must not silently stop the broadcast.
       The session is still open server-side — /api/live/start hands back the
       one already running rather than inventing a second code — so this puts
       the button back into its Live state and resumes pushing. */
    try {
      // Resuming after a reload: no assignment argument at all, so the
      // server keeps whatever the session already had. The code is sent so
      // the server can refuse anything but that same lesson — see live_start.
      var resumeCode = localStorage.getItem("pyide-live-host");
      if (resumeCode) startLive(undefined, resumeCode);
    } catch (e) { /* storage blocked: press Go live again */ }
  } else {
    /* No Go live button: signed out, or not a teacher. Whatever lesson this
       browser remembers is not one this person can resume, so forget it
       here rather than let it wait for the next teacher to sign in. */
    try { localStorage.removeItem("pyide-live-host"); } catch (e) {}
  }
})();
