/* PyIDE — the Python runner.
 *
 * Everything the editor does that is about RUNNING a Python project: the
 * console and its input line, a kaypy game's stage, the block world, the
 * simulated Pi, the Python runtime itself, Run and Stop, the sprite panel,
 * name completion and the hints above a call, the syntax card, and
 * Download (a game packs itself into a playable page).
 *
 * WHY IT IS ITS OWN FILE. WebIDE and FlaskIDE are moving into this app
 * (CLAUDE.md, "WebIDE and FlaskIDE are moving in"), and one editor page has
 * to open a Python project or an HTML one. app.js is the shell they share —
 * tabs, notes, theme, saving, sharing, teaching live — and asks the runner
 * for the rest. The code below was MOVED here from app.js unchanged, apart
 * from reaching the shell through `ctx`; a rewrite would have lost the
 * reasons written beside it, and they are most of its value.
 *
 * The shell picks a runner by the project's IDE (window.PYIDE.ide). Two
 * halves, because the shell needs some answers before anything runs —
 * which file is the entry, which files have no tab, what mode a tab's
 * editor is in — and the rest only once the editor and the output exist:
 *
 *   entry, editorOptions, modeFor(name), hidden(name),
 *   newFile {question, example}, nameExample, refuseName(name)
 *                                     answered at once, by the definition
 *   attach(ctx) -> { run, stop, escape, isRunning, hasRun, checks,
 *                    payload, forRescue, forget, warnName, download,
 *                    onResize }
 *                                     once the shell is built
 */
(function () {
  "use strict";

  /* A program that imports mcpi builds in a world, and the world is kept
     with the project as this file (world_model.js: its changes from the
     terrain). It travels like any data file — saving, drafts, turn-ins,
     the rescue, shares, the new tab — but it is no tab and never reaches
     Python: nobody edits it as text, and it can be 1.4 MB. */
  var WORLD_FILE = "world.mcpi";
  /* The simulated Raspberry Pi's breadboard, as the student wired it
     (pi_circuit.js). Kept with the project the same way as the world file:
     no tab, never written into Python's files. */
  var CIRCUIT_FILE = "circuit.pi";
  function hidden(name) { return name === WORLD_FILE || name === CIRCUIT_FILE; }
  var PROJECT_DIR = "/project";

  function modeFor(name) {
    return /\.py$/i.test(name) ? "python" : null;   // .txt and .csv are text
  }

  function refuseName(name) {
    // The world's own file: making it by hand would make any project a
    // block-world one, which only a teacher's assignment is meant to be.
    if (name.toLowerCase() === CIRCUIT_FILE) {
      return "'" + name + "' is where the Pi's breadboard is kept. Choose another name.";
    }
    if (name.toLowerCase() === WORLD_FILE) {
      return "'" + name + "' is kept for block-world assignments. Choose another name.";
    }
    return "";
  }

  window.IDERunners = window.IDERunners || {};
  window.IDERunners.pyide = {
    entry: "main.py",
    editorOptions: { mode: "python", indentUnit: 4, tabSize: 4 },
    modeFor: modeFor,
    hidden: hidden,
    newFile: { question: "Name for the new file — data.txt, notes.md or helper.py:",
               example: "helper.py" },
    nameExample: ".py, .txt or .csv",
    refuseName: refuseName,
    attach: attach
  };

  function attach(ctx) {
    var $ = ctx.$;
    var editor = ctx.editor;
    var docs = ctx.docs;
    var makeDoc = ctx.makeDoc;
    var MAIN = ctx.MAIN;
    var write = ctx.write;
    var clearOutput = ctx.clearOutput;
    var showOutput = ctx.showOutput;
    var relayout = ctx.relayout;
    var renderTabs = ctx.renderTabs;
    var switchTo = ctx.switchTo;
    var editingFile = ctx.editingFile;
    var addFile = ctx.addFile;
    var mainSource = ctx.mainSource;
    var dataFiles = ctx.dataFiles;

    var TIME_LIMIT_SECONDS = 15; // console programs only; games run until stopped

    var outputEl = $("output");
    var runBtn = $("run");
    var runLabel = $("run-label");
    var stopBtn = $("stop");
    var modeTag = $("mode");
    var stage = $("stage");
    var canvas = $("canvas");

    /* A GAME PANE DRAGGED TO A SIZE OF ITS OWN (split.js marks it is-sized)
       has the canvas fitted to it: the largest that fits, in the game's own
       shape, up as well as down. Not otherwise — left alone, the pane is as
       tall as the canvas under style.css's own cap, as it always was, and the
       inline size from here is taken off again. */
    var stageFrame = stage ? stage.querySelector(".stage-frame") : null;

    function fitCanvas() {
      var el = document.getElementById("canvas");
      if (!el || !stageFrame || stage.hidden) return;
      if (!stage.classList.contains("is-sized")) {
        el.style.width = el.style.height = "";
        return;
      }
      var cs = getComputedStyle(stageFrame);
      var w = stageFrame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var h = stageFrame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      var ratio = el.width / el.height;
      if (!(w > 0 && h > 0 && ratio > 0)) return;
      var cw = Math.floor(Math.min(w, h * ratio));
      el.style.width = cw + "px";
      el.style.height = Math.floor(cw / ratio) + "px";
    }

    if (stageFrame && window.ResizeObserver) {
      new ResizeObserver(fitCanvas).observe(stageFrame);
    }

    /* The syntax card, covering the output pane. `reveal` opens the file the
       error is in, so an error in helper.py is shown in helper.py. */
    var syntaxCard = window.PyIDESyntax.attach({
      host: $("output-view"),
      editor: editor,
      reveal: function (file) {
        if (!docs[file]) return null;
        if (file !== editingFile()) switchTo(file);
        return docs[file];
      }
    });

    /* Declared before anything that calls into it: clearOutput() runs during the
       Python boot, and a hoisted `var` would still be undefined at that point. */
    var consoleIO = window.PyIDERuntime.attachConsole({
      outputEl: outputEl,
      // Stop is the way out for a student who changes their mind mid-question.
      onWaiting: function () { paintStop(); }
    });
  
  // ...and Clear has to put that input line back, or a program waiting on
  // input() hangs on a keystroke that can never come (app.js, clearOutput).
  ctx.onClear(function () { consoleIO.restore(); });

  function status(text) { clearOutput(); write(text + "\n", "dim"); }


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
    /* ------------------------------------------------- the game in a new tab
     *
     * The project goes to /play through this browser's storage, not the
     * server: nothing is saved or shared by it, and a signed-out student can
     * use it as freely as Run. /play is the demo page's player (demo.js),
     * which reads it from there and starts at once.
     *
     * One named tab, reused: pressing it again after an edit reloads that tab
     * with the new code instead of opening another one per press. A game
     * already running here is stopped first — two copies of one game running
     * at once is two soundtracks and a page that is twice as slow. */
    var PLAY_KEY = "pyide-play";
    var runTabBtn = $("run-tab");

    function runInNewTab() {
      if (running) stopRun();
      var files = dataFiles(), handed = function (f) {
        localStorage.setItem(PLAY_KEY, JSON.stringify({
          code: mainSource(),
          files: f,
          title: ($("title") && $("title").value) || "Game"
        }));
      };
      try {
        try {
          handed(files);
        } catch (full) {
          // A big world can be more than this browser lets one site keep.
          // The program still goes; the new tab opens it on a fresh world.
          if (!files[WORLD_FILE]) throw full;
          delete files[WORLD_FILE];
          handed(files);
          write("\nThis world is too big to hand to a new tab, so it opens there on a new world.\n", "dim");
        }
      } catch (e) {
        window.alert("This browser is blocking site storage, so the game "
                     + "cannot be handed to a new tab. Run it here instead.");
        return;
      }
      window.open("/play", "pyide-play");
    }

    if (runTabBtn) runTabBtn.addEventListener("click", runInNewTab);

    /* kaypy before mcpi: a program that somehow imports both stays the game it
       was. And the block world only in a project that has a world file: the
       teacher's choice is that it comes with block-world assignments they set
       (Add to class → Block world, which makes the file), never a project a
       student starts. Every copy of such an assignment carries the file. */
    function hasWorld() { return Object.prototype.hasOwnProperty.call(docs, WORLD_FILE); }
    function currentMode(source) {
      if (window.PyIDEGame.looksLikeGame(source)) return "game";
      if (window.PyIDEWorldModel.looksLikeWorld(source) && hasWorld()) return "world";
      // The simulated Pi needs no file to run: gpiozero, the Sense HAT and the
      // camera work in any project, and the breadboard is made when wired.
      if (window.PyIDEPi && window.PyIDEPi.looksLikePi(source)) return "pi";
      return "console";
    }

    // Before paintMode, which runs straight away and shows or hides its button.
    var spritePanel = window.PyIDESprites.attachPanel({
      insert: insertAtCursor,
      relayout: relayout
    });

    function paintMode(mode) {
      modeTag.textContent = mode === "game" ? "Game" : mode === "world" ? "World" : mode === "pi" ? "Pi" : "Console";
      modeTag.className = "mode mode-" + mode;
      modeTag.title = mode === "game"
        ? "Your code imports kaypy, so Run opens a game window."
        : mode === "world"
          ? "Your code imports mcpi, so Run builds in the block world."
          : mode === "pi"
            ? "Your code uses a Raspberry Pi's parts, so Run drives the simulated Pi."
            : "Run will run this in the console. Import kaypy to make it a game.";
      // A world lays out as a game does (a picture above, the output under it).
      document.body.classList.toggle("is-game", mode === "game" || mode === "world" || mode === "pi");
      document.body.classList.toggle("is-world", mode === "world");
      document.body.classList.toggle("is-pi", mode === "pi");

      // Sprites are only meaningful to a game, so the button appears with one.
      // So is the engine's documentation: in console mode it would be a link
      // to the wrong manual.
      var isGame = mode === "game";
      spritePanel.showFor(isGame);
      if (runTabBtn) runTabBtn.hidden = !(isGame || mode === "world" || mode === "pi");
      var docs = $("kaypy-docs");
      if (docs) docs.hidden = !isGame;
      var worldDocs = $("world-docs");
      if (worldDocs) worldDocs.hidden = mode !== "world";
      paintWorld(mode === "world");
      paintPi(mode === "pi");
      relayout();
    }

    function refreshMode() { paintMode(currentMode(mainSource())); }

    // ---------------------------------------------------------- the block world
    /* The world shows whenever the code is a world program — before any Run,
       so a teacher opening a turned-in snapshot can fly round what was built.
       paintMode calls this on every keystroke, so it does nothing unless the
       mode changed or the world file did (a rescue, a starter, a reload). */
    var worldView = $("world-view");
    var stageLabel = $("stage-label");
    var newWorldBtn = $("new-world");
    var worldUp = false, worldShowing = null;

    function worldText() { return docs[WORLD_FILE] ? docs[WORLD_FILE].getValue() : ""; }

    function paintWorld(on) {
      if (!worldView || !window.PyIDEWorld) return;
      if (newWorldBtn) newWorldBtn.hidden = !on || !!window.PYIDE.readonly;
      if (!on) {
        if (worldUp) {
          worldUp = false;
          worldView.hidden = true;
          window.PyIDEWorld.hide();
          if (stageLabel) stageLabel.textContent = "Game";
          if (!running) stage.hidden = true;
        }
        return;
      }
      if (worldUp && worldShowing === worldText()) return;
      worldUp = true;
      worldView.hidden = false;
      stage.hidden = false;
      if (stageLabel) stageLabel.textContent = "World";
      showWorld().catch(function (e) {
        write("The block world could not load. " + (e && e.message || e) + "\n", "err");
      });
    }

    function showWorld() {
      var text = worldText();
      worldShowing = text;
      return window.PyIDEWorld.load(text).then(function () {
        return window.PyIDEWorld.ensureView(worldView);
      }).then(function () { relayout(); });
    }

    /* The world into its file, when it changed (world.js compares the changes
       themselves, so walking about, or a run that built nothing, saves
       nothing and turns nothing in again). Never on a read-only snapshot. */
    function saveWorld() {
      if (!worldUp || window.PYIDE.readonly) return Promise.resolve();
      return window.PyIDEWorld.save().then(function (r) {
        if (r && r.text) setWorldFile(r.text);
      }).catch(function (e) {
        write("The world couldn't be saved. " + (e && e.message || e) + "\n", "err");
      });
    }
    function setWorldFile(text) {
      if (worldText() === text) return;
      if (docs[WORLD_FILE]) docs[WORLD_FILE].setValue(text);
      else docs[WORLD_FILE] = makeDoc(text);
      worldShowing = text;
      // Not the open document, so no change event tells anyone: say so here.
      ctx.noteEdit();
    }

    if (window.PyIDEWorld) {
      // Blocks broken or placed by hand: kept a few seconds after the last
      // one, and at once when the student lets go of the mouse.
      var handTimer = null;
      window.PyIDEWorld.onHandEdit(function (what) {
        clearTimeout(handTimer);
        if (what === "unlocked") saveWorld();
        else handTimer = setTimeout(function () { if (!running) saveWorld(); }, 5000);
      });
      // Chat in the output too: it's where a student looks for what their program said.
      window.PyIDEWorld.onChat(function (text) { write("<chat> " + text + "\n", "dim"); });
    }
    if (newWorldBtn) {
      newWorldBtn.addEventListener("click", function () {
        if (running) return;
        if (!window.confirm("Start a new world? Everything built in this one goes.")) return;
        window.PyIDEWorld.newWorld().then(function (r) {
          if (r && r.text) setWorldFile(r.text);
        });
      });
    }

    // ------------------------------------------------------ the simulated Pi
    /* The breadboard (and later the Sense HAT and camera) shows whenever the
       code is a Pi program, before any Run, so it can be wired first — the
       order a real one is built in. Wiring is saved into circuit.pi as it
       changes; nothing is saved by just looking at it. */
    var piView = $("pi-view");
    var piUp = false, piShowing = null;

    function circuitText() { return docs[CIRCUIT_FILE] ? docs[CIRCUIT_FILE].getValue() : ""; }

    function paintPi(on) {
      if (!piView || !window.PyIDEPi) return;
      if (!on) {
        if (piUp) {
          piUp = false;
          window.PyIDEPi.hide();
          if (stageLabel) stageLabel.textContent = "Game";
          if (!running) stage.hidden = true;
        }
        return;
      }
      var uses = window.PyIDEPi.usesOf(mainSource());
      if (!piUp) window.PyIDEPi.setReadonly(!!window.PYIDE.readonly);
      if (!piUp || piShowing !== circuitText()) {
        piShowing = circuitText();
        window.PyIDEPi.load(piShowing);
      }
      piUp = true;
      stage.hidden = false;
      if (stageLabel) stageLabel.textContent = uses.turtle && !uses.gpio && !uses.sense && !uses.camera ? "Turtle" : "Raspberry Pi";
      window.PyIDEPi.show(piView, uses);
    }

    function setCircuitFile(text) {
      if (circuitText() === text) return;
      if (docs[CIRCUIT_FILE]) docs[CIRCUIT_FILE].setValue(text);
      else docs[CIRCUIT_FILE] = makeDoc(text);
      piShowing = text;
      // Not the open document, so no change event tells anyone: say so here.
      ctx.noteEdit();
    }
    if (window.PyIDEPi) {
      window.PyIDEPi.onEdit(function () {
        if (!window.PYIDE.readonly) setCircuitFile(window.PyIDEPi.save());
      });
    }

    editor.on("change", function () { if (!running) refreshMode(); });

    /* What goes in the brackets, above the line while a call is typed
       (sighint.js). Their own defs come from every .py tab; kaypy's only in a
       program that imports it. */
    window.PyIDESigHint.attach(editor, {
      sources: function () {
        return Object.keys(docs).filter(function (n) { return /\.py$/i.test(n); })
          .map(function (n) { return docs[n].getValue(); });
      },
      isPython: function () { return /\.py$/i.test(editingFile()); },
      kaypyUrl: "/static/py/kaypy_sigs.json",
      mcpiUrl: "/static/py/mcpi_sigs.json"
    });

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
      delete files[WORLD_FILE];      // the world's own; no program reads it
      delete files[CIRCUIT_FILE];    // the breadboard's, likewise
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
        if (name === "." || name === ".." || name === MAIN || hidden(name)) return;
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
      stopBtn.hidden = !(running && (runMode === "game" || runMode === "world" || runMode === "pi" || consoleIO.isWaiting()));
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

    /* Every .py file, for the reason in PyIDERuntime.loadImports: an import in
       helpers.py alone was never seen, and requests was never installed. */
    function wantsRequests(source) {
      var files = dataFiles();
      return REQUESTS_RE.test(source) || Object.keys(files).some(function (n) {
        return /\.py$/.test(n) && REQUESTS_RE.test(files[n]);
      });
    }

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

      /* Can Python read it at all? Asked before anything runs or loads, so a
         missing bracket gets a plain-words card over the editor (syntax.js)
         instead of a game engine loading only to fail. Python's own message
         still goes in the output, where it always was. */
      syntaxCard.clear();
      // mcpi outside a block-world assignment: said plainly, rather than
      // "No module named 'mcpi'", which reads as a mistake in their code.
      if (mode === "console" && window.PyIDEWorldModel.looksLikeWorld(source)) {
        stage.hidden = true;
        showOutput();
        clearOutput();
        write("The block world (mcpi) comes with block-world assignments from your teacher.\n" +
              "Open one from your class page to build in it.\n", "err");
        return;
      }
      var bad = window.PyIDESyntax.check(pyodide, source, dataFiles());
      if (bad) {
        stage.hidden = true;
        showOutput();
        relayout();
        clearOutput();
        write("SyntaxError" + (bad.file !== "main.py" ? " in " + bad.file : "")
              + " on line " + bad.line + ": " + bad.msg + "\n"
              + (bad.text.trim() ? "    " + bad.text.trim() + "\n" : ""), "err");
        syntaxCard.show(bad);
        return;
      }
      return mode === "game" ? runGame(source) : mode === "world" ? runWorld(source)
        : mode === "pi" ? runPi(source) : runConsole(source);
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

      await window.PyIDERuntime.loadImports(pyodide, source, dataFiles());

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
        // Stopped while it waited for input() is a program that worked.
        if (result === "ok" || result === "cancelled") reportRun();
      } catch (e) {
        write(String(e) + "\n", "err");
      } finally {
        pullFilesFromPython();
        setBusy(false, "console");
      }
    }

    /* A run that worked, for XP (xp.js). Only a signed-in student's own
       work: not a snapshot opened read-only, not a view-only link, and not a
       teacher, who earns nothing. The server checks the rest. */
    function reportRun() {
      if (!window.PYIDE.signedIn || window.PYIDE.viewOnly || window.PYIDE.readonly ||
          window.PYIDE.isTeacher || !window.PyIDEXP) return;
      var files = dataFiles();
      files[MAIN] = mainSource();
      window.PyIDEXP.ran(files);
    }

    /* Check my work: the tests in the notes (autograde.js), run here on what
       is in the editor now, as often as the student likes, from the ✔ on each
       tests card in the notes (checks_in_notes.js). There is no button at the
       top any more: the cards show the results beside the step they're about,
       and the teacher wanted students checking there. It is feedback: the
       result is kept for the teacher to see, but what counts is the teacher's
       Check all on what was turned in — a check run in this browser could be
       faked. */
    function projectFiles() {
      var files = dataFiles();
      files[MAIN] = mainSource();
      return files;
    }

    function testsHere() {
      return window.PyIDETests ? window.PyIDETests.fromFiles(projectFiles()).tests : [];
    }

    /* The run itself: every test in the notes, on what is in the editor
       now. The notes' tests cards (checks_in_notes.js) show the results;
       the student's result is kept for the teacher here. Null when it can't
       run now. */
    async function runChecks() {
      if (running || !pyodide) return null;
      var files = projectFiles(), tests = testsHere();
      if (!tests.length) return null;
      setBusy(true, "console");
      try {
        await ensureRequests(mainSource());
        return await window.PyIDETests.run(pyodide, files, tests);
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
      write("Game running. Click the picture to play, and the editor to type.\n", "dim");
      stage.hidden = false;
      relayout();
      fitCanvas();
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
        fitCanvas();             // kaypy(width=…, height=…) has set its size now
        if (status_ === "ok") {
          reportRun();   // now: the await below may never settle (stopRun)
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

    /* A program that drives the block world (it imports mcpi): it runs until
       it ends or Stop, taking turns with the page so the world keeps moving
       (mcpi/_pyide.py; _pyide_run_world in runtime.js). The world it built is
       saved into the project as the run ends, and every 30 s while it runs. */
    async function runWorld(source) {
      var token = ++runToken;
      setBusy(true, "world");
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
        await window.PyIDERuntime.loadImports(pyodide, source, dataFiles());
        await showWorld();
        await window.PyIDEWorld.loadPackage(pyodide);
      } catch (e) {
        write("The block world could not load.\n" + (e && e.message || e) + "\n", "err");
        if (token === runToken) setBusy(false, "world");
        return;
      }
      write("World running. Click the world to walk about in it, and the editor to type.\n", "dim");
      pushFilesToPython();
      consoleIO.setEnabled(true);
      var id = window.PyIDEWorld.beginRun();
      var keeper = setInterval(saveWorld, 30000);
      try {
        // Through a global, as on the console path, so quotes can't break the call.
        pyodide.globals.set("_pyide_source", source);
        var result = await pyodide.runPythonAsync("_pyide_run_world(_pyide_source, " + id + ")");
        if (token === runToken) {
          if (result === "ok") write("\n— finished —\n", "dim");
          if (result === "stopped") write("\n— stopped —\n", "dim");
          // Stopped is how a world program usually ends: it worked.
          if (result === "ok" || result === "stopped" || result === "cancelled") reportRun();
        }
      } catch (e) {
        write(String(e) + "\n", "err");
      } finally {
        clearInterval(keeper);
        if (token === runToken) {
          window.PyIDEWorld.endRun();
          await saveWorld();
          pullFilesFromPython();
          setBusy(false, "world");
        }
      }
    }

    /* A program that drives the simulated Pi: the same turns as the block
       world (_pyide_pi; _pyide_run_pi in runtime.js), and the same Stop. Its
       pins are let go as it ends, as gpiozero's cleanup does on a Pi. */
    async function runPi(source) {
      var token = ++runToken;
      setBusy(true, "pi");
      showOutput();
      clearOutput();
      paintPi(true);
      await repaint();

      try {
        await ensureRequests(source);
      } catch (e) {
        setBusy(false);
        return;
      }
      try {
        await window.PyIDERuntime.loadImports(pyodide, source, dataFiles());
        await window.PyIDEPi.loadPackage(pyodide);
      } catch (e) {
        write("The Raspberry Pi could not load.\n" + (e && e.message || e) + "\n", "err");
        if (token === runToken) setBusy(false, "pi");
        return;
      }
      pushFilesToPython();
      consoleIO.setEnabled(true);
      var id = window.PyIDEPi.beginRun();
      try {
        pyodide.globals.set("_pyide_source", source);
        var result = await pyodide.runPythonAsync("_pyide_run_pi(_pyide_source, " + id + ")");
        if (token === runToken) {
          if (result === "ok") write("\n— finished —\n", "dim");
          if (result === "stopped") write("\n— stopped —\n", "dim");
          if (result === "ok" || result === "stopped" || result === "cancelled") reportRun();
        }
      } catch (e) {
        write(String(e) + "\n", "err");
      } finally {
        if (token === runToken) {
          window.PyIDEPi.endRun();
          pullFilesFromPython();
          setBusy(false, "pi");
        }
      }
    }

    function stopRun() {
      if (!running) return;
      if (runMode === "pi") {
        if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
        // As for the world, below.
        window.PyIDEPi.requestStop();
        var piToken = runToken;
        setTimeout(function () {
          if (!running || runMode !== "pi" || piToken !== runToken) return;
          runToken += 1;
          window.PyIDEPi.endRun();
          write("\n— stopped —\n", "dim");
          setBusy(false);
          pullFilesFromPython();
        }, 1500);
        return;
      }
      if (runMode === "world") {
        if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
        /* Asked, and heard at the program's next turn — within a frame. If it
           doesn't come back by 1.5 s the toolbar is put back anyway (as for a
           game, below: the user asked to stop, so the UI says stopped), and
           the run token makes the late finally a no-op. */
        window.PyIDEWorld.requestStop();
        var token = runToken;
        setTimeout(function () {
          if (!running || runMode !== "world" || token !== runToken) return;
          runToken += 1;
          window.PyIDEWorld.endRun();
          write("\n— stopped —\n", "dim");
          setBusy(false);
          saveWorld();
          pullFilesFromPython();
        }, 1500);
        return;
      }
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
        if (!window.PyIDENotes.isMarkdown(ctx.active())) editor.focus();
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
    // The panel itself is shared with the live-lesson page, so it lives in
    // sprites.js and is attached above paintMode, which shows its button.
    function insertAtCursor(text) {
      if (window.PYIDE.readonly) return;
      /* Sprites belong in the program, not in a data file. Same distinction as
         above: if the editor is already on main.py there is nothing to switch,
         and switching anyway would close the notes a student is reading. */
      if (editingFile() !== MAIN) switchTo(MAIN);
      editor.replaceSelection(text, "end");
      editor.focus();
    }

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

    return {
      run: run,
      stop: stopRun,
      // Escape also gives back the mouse the block world was holding; that
      // press is the student letting go, not asking to stop their program.
      escape: function () {
        if (running && !(window.PyIDEWorld && window.PyIDEWorld.holdsEscape())) stopRun();
      },
      isRunning: function () { return running; },
      hasRun: function () { return hasRun; },
      checks: runChecks,
      // What a save, a share or a turn-in sends: main.py apart from the rest,
      // the shape every Python route has always taken.
      payload: function () { return { code: mainSource(), files: dataFiles() }; },
      forRescue: function (all) {
        // The rescue keeps everything in one localStorage item, and a full one
        // fails without a word — so a big world is left out, and the student's
        // code is always what's kept.
        // Its name is kept, empty: the file is what makes this a block-world
        // project, and dropped altogether a restored project would stop being one.
        if (all[WORLD_FILE] && all[WORLD_FILE].length > 400000) all[WORLD_FILE] = "";
        return all;
      },
      // A file taken out of the project is taken out of Python's files too.
      forget: function (name) {
        try { pyodide.FS.unlink(PROJECT_DIR + "/" + name); } catch (e) { /* not written yet */ }
      },
      warnName: function (name) {
        var clash = shadowedLibrary(name);
        return clash
          ? "Heads up: '" + name + "' has the same name as a Python" +
            " library, so `import " + clash + "` will find this file instead" +
            " of the real one. Rename it if you meant to use the library."
          : "";
      },
      download: onDownload,
      onResize: fitCanvas
    };
  }
})();
