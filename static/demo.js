/* PyIDE — the demo page.
 *
 * What a "hide my code" share link opens: Run, the output, and nothing else.
 * No editor, no tabs, no fork, no download.
 *
 * The honest limit, stated once here so nobody has to guess at it later:
 * Pyodide runs Python in the browser, so the program has to arrive in the
 * browser. This page removes every ordinary way of reading it — it is never
 * written into the document, never held by an editor, and only fetched once a
 * run is actually asked for — but a network panel will still show the request.
 * That is the difference between a cupboard and a safe, and the cupboard is
 * what a classroom needs.
 */

(function () {
  "use strict";

  var TIME_LIMIT_SECONDS = 15;   // console programs only; games run until stopped
  var PROJECT_DIR = "/project";

  var $ = function (id) { return document.getElementById(id); };
  var outputEl = $("output");
  var runBtn = $("run");
  var runLabel = $("run-label");
  var stopBtn = $("stop");
  var stage = $("stage");
  var canvas = $("canvas");

  // ----------------------------------------------------------------- output
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

  // ------------------------------------------------------------------ theme
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
    themeGlyph.textContent = name === "light" ? "☾" : "☀";
    themeBtn.title = name === "light"
      ? "Switch to dark (easier on the eyes up close)"
      : "Switch to light (easier to read on a projector)";
    themeBtn.setAttribute("aria-label", themeBtn.title);
    if (remember) {
      try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* blocked */ }
    }
  }

  applyTheme(currentTheme(), false);

  themeBtn.addEventListener("click", function () {
    applyTheme(currentTheme() === "light" ? "dark" : "light", true);
  });

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

  // -------------------------------------------------------------- text size
  // Worth keeping on a page with no code: a demo is usually being projected,
  // and the back row still has to read the output.
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

  // ---------------------------------------------------------------- runtime
  var pyodide = null;
  var pyRun = null;
  var running = false;

  /* Held in this closure and nowhere else — not on window, not in an editor,
     not in the markup. Fetched once and kept, so pressing Run a second time
     adds nothing new to the network log. */
  var project = null;

  (async function () {
    try {
      pyodide = await loadPyodide();
      pyodide.setStdout({ batched: function (s) { write(s + "\n"); } });
      pyodide.setStderr({ batched: function (s) { write(s + "\n", "err"); } });
      pyodide.runPython(window.PyIDERuntime.BOOTSTRAP);
      pyRun = pyodide.globals.get("_pyide_run");
      status("Ready. Press Run to see what this program does.");
      runBtn.disabled = false;
      runLabel.textContent = "Run";
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

  async function loadProject() {
    if (project) return project;
    var res = await fetch(window.PYIDE_DEMO.sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("This demo link is no longer available.");
    var data = await res.json();
    project = { code: String(data.code || ""), files: data.files || {} };
    return project;
  }

  /* Data files the program reads still have to exist, even though there is no
     tab showing them. Nothing is read back out afterwards: whatever the
     program writes stays in Pyodide's filesystem and off the page. */
  function pushFilesToPython(files) {
    if (!pyodide) return;
    pyodide.FS.mkdirTree(PROJECT_DIR);
    Object.keys(files).forEach(function (name) {
      try {
        pyodide.FS.writeFile(PROJECT_DIR + "/" + name,
                             new TextEncoder().encode(files[name]));
      } catch (e) { /* an unwritable name is not worth stopping the demo for */ }
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

    setBusy(true, "console");
    clearOutput();
    await repaint();

    var loaded;
    try {
      loaded = await loadProject();
    } catch (e) {
      status(e.message);
      setBusy(false, "console");
      return;
    }

    var isGame = window.PyIDEGame.looksLikeGame(loaded.code);
    document.body.classList.toggle("is-game", isGame);
    return isGame ? runGame(loaded) : runConsole(loaded);
  }

  async function runConsole(loaded) {
    setBusy(true, "console");
    stage.hidden = true;
    clearOutput();
    await repaint();

    try {
      await pyodide.loadPackagesFromImports(loaded.code, {
        messageCallback: function () {},
        errorCallback: function () {}
      });
    } catch (e) {
      /* an unavailable import surfaces as a normal ModuleNotFoundError below */
    }

    pushFilesToPython(loaded.files);
    try {
      // quote_source false: an error still names the line, but prints no code
      var result = pyRun(loaded.code, TIME_LIMIT_SECONDS, false);
      if (result === "ok") write("\n— finished —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      setBusy(false, "console");
    }
  }

  async function runGame(loaded) {
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

    pushFilesToPython(loaded.files);
    try {
      pyodide.runPython("reset_game_state()");
      var result = await pyodide.runPythonAsync(
        "await run_game(" + JSON.stringify(loaded.code) +
        ", 0, quote_source=False)"
      );
      if (result === "stopped") write("\n— stopped —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      // give the keyboard back, or the page stops responding to typed keys
      window.PyIDEGame.releaseKeyboard(pyodide, canvas);
      setBusy(false, "game");
    }
  }

  function stopGame() {
    if (!running || !pyodide) return;
    try { pyodide.runPython("request_stop()"); } catch (e) { /* not loaded */ }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stopGame);

  canvas.addEventListener("keydown", function (e) {
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) >= 0) {
      e.preventDefault();
    }
  });
  canvas.addEventListener("mousedown", function () { canvas.focus(); });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Escape" && running) stopGame();
  });
})();
