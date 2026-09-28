/* The live lesson page.
 *
 * Two editors, stacked. The upper one mirrors whatever the teacher is typing
 * in their own PyIDE tab; the lower one is the student's, and they type the
 * lesson out themselves.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 *
 *   Nothing that arrives from the network is ever written into the student's
 *   editor. Not on a poll, not on a reconnect, not when the lesson ends.
 *   `mirror` is the only CodeMirror this file ever calls setValue on, and
 *   `mine` is the only one the student types in. A class losing their own
 *   work because the teacher pressed a key is the failure that would stop
 *   anyone using this a second time, so it is arranged to be impossible
 *   rather than carefully avoided.
 *
 *   There is deliberately no button that copies the teacher's code down.
 *   Typing it is the exercise.
 *
 * WHY POLLING AND NOT A WEBSOCKET
 *
 *   PyIDE runs on `gunicorn --workers 2`. A socket lives inside one worker,
 *   so broadcasting across both would need a message broker — another Render
 *   service, another bill. A row in the Postgres that is already there costs
 *   nothing new, and the poll below asks "has the version changed?" and is
 *   answered 304 almost every time.
 */
(function () {
  "use strict";

  var L = window.PYIDE_LIVE || {};
  if (!L.joined || L.isHost) {
    hostControls();
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  var outputEl = $("output");
  var stage = $("stage");
  var runBtn = $("run");
  var runLabel = $("run-label");
  var stopBtn = $("stop");
  var stateChip = $("live-state");
  var savedNote = $("mine-saved");

  var DRAFT_KEY = "pyide-live-" + L.code;

  // ------------------------------------------------------------ the editors

  function isDark() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set === "dark") return true;
    if (set === "light") return false;
    return window.matchMedia
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function cmTheme() { return isDark() ? "material-darker" : "default"; }

  /* Read-only, and `readOnly: "nocursor"` rather than plain true: with a
     cursor the mirror can be focused and looks typeable, and a student who
     clicks in and starts typing finds nothing happens and assumes the page
     is broken. */
  var mirror = CodeMirror.fromTextArea($("mirror"), {
    mode: "python",
    theme: cmTheme(),
    lineNumbers: true,
    readOnly: "nocursor",
    lineWrapping: false
  });

  var mine = CodeMirror.fromTextArea($("mine"), {
    mode: "python",
    theme: cmTheme(),
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    extraKeys: {
      "Ctrl-/": "toggleComment",
      "Cmd-/": "toggleComment",
      "Ctrl-Enter": function () { run(); },
      "Cmd-Enter": function () { run(); }
    }
  });

  /* The student's own work, in their browser only. There is no account
     needed to follow a lesson, so there is nowhere on the server this could
     go — and a refresh in the middle of a lesson must not cost them the
     twenty lines they have typed. Every read and write is wrapped, because
     localStorage throws outright in a private window and on a locked-down
     school laptop. */
  try {
    var kept = window.localStorage.getItem(DRAFT_KEY);
    if (kept) mine.setValue(kept);
  } catch (e) { /* nothing kept; an empty editor is a fine starting point */ }
  mine.clearHistory();

  var saveTimer = null;
  mine.on("change", function () {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(DRAFT_KEY, mine.getValue());
        note("Saved on this computer");
      } catch (e) {
        note("Could not save here — keep this tab open");
      }
    }, 500);
  });

  var noteTimer = null;
  function note(text) {
    if (!savedNote) return;
    savedNote.textContent = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { savedNote.textContent = ""; }, 2500);
  }

  // -------------------------------------------------------------- the mirror

  var seen = -1;

  function showMirror(data) {
    // The ONLY setValue on the mirror, and there is no setValue on `mine`
    // anywhere below this line.
    if (typeof data.body === "string" && data.body !== mirror.getValue()) {
      var scroll = mirror.getScrollInfo();
      mirror.setValue(data.body);
      // Keep the reader where they were. Without this every keystroke from
      // the teacher throws a student who has scrolled back to look at line 4
      // straight back to the top, which makes the mirror unreadable.
      mirror.scrollTo(scroll.left, scroll.top);
    }
    if (data.filename) {
      var name = document.getElementById("mirror-name");
      if (name) name.textContent = data.filename;
    }
    seen = data.version;
  }

  function setState(text, kind) {
    if (!stateChip) return;
    stateChip.textContent = text;
    stateChip.className = "chip live-chip" + (kind ? " live-" + kind : "");
  }

  if (typeof L.body === "string") {
    showMirror({ body: L.body, version: L.version, filename: L.filename });
  }

  var POLL_MS = 1000;
  var misses = 0;

  function poll() {
    fetch("/api/live/" + encodeURIComponent(L.code) + "?v=" + seen,
          { cache: "no-store" })
      .then(function (res) {
        if (res.status === 304) {         // the usual answer: nothing new
          misses = 0;
          setState("Live", "on");
          return null;
        }
        if (res.status === 404) {
          setState("Lesson not found", "off");
          throw new Error("gone");
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        misses = 0;
        if (!data) return;
        if (data.ended) {
          showMirror(data);
          setState("Lesson ended", "off");
          // Stop asking. The row is not going to change again, and thirty
          // browsers politely polling a finished lesson until home time is
          // exactly the kind of traffic nobody notices they are paying for.
          throw new Error("ended");
        }
        showMirror(data);
        setState("Live", "on");
      })
      .catch(function (err) {
        if (err && (err.message === "ended" || err.message === "gone")) return;
        // A dropped poll is normal on school wifi and says nothing about the
        // lesson. Only a run of them is worth telling anyone about, and the
        // next success clears it.
        misses = misses + 1;
        if (misses >= 3) setState("Reconnecting…", "wait");
      })
      .finally(function () {
        if (stateChip && stateChip.textContent === "Lesson ended") return;
        if (stateChip && stateChip.textContent === "Lesson not found") return;
        setTimeout(poll, POLL_MS);
      });
  }

  poll();

  // ------------------------------------------------------------- their Run

  function write(text, cls) {
    var span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  var consoleIO = window.PyIDERuntime.attachConsole({
    outputEl: outputEl,
    onWaiting: function () { paintStop(); }
  });

  function clearOutput() {
    outputEl.textContent = "";
    consoleIO.restore();
  }

  var pyodide = null;
  var running = false;
  var runMode = null;
  var canvas = $("canvas");
  var TIME_LIMIT_SECONDS = 15;

  function paintStop() {
    stopBtn.hidden = !(running && (runMode === "game" || consoleIO.isWaiting()));
  }

  function setBusy(on, mode) {
    running = on;
    runMode = on ? mode : null;
    runBtn.hidden = on;
    paintStop();
  }

  (async function boot() {
    try {
      pyodide = await loadPyodide();
      window.PyIDERuntime.pipeOutput(pyodide, write);
      pyodide.runPython(window.PyIDERuntime.BOOTSTRAP);
      clearOutput();
      write("Python is ready. Type along, then press Run.\n", "dim");
      runBtn.disabled = false;
      runLabel.textContent = "Run";
    } catch (e) {
      write("Python could not load. Check your connection and refresh.\n"
            + String(e) + "\n", "err");
    }
  })();

  async function run() {
    if (running || !pyodide) return;
    var source = mine.getValue();          // theirs, never the mirror's

    if (!window.PyIDEGame.looksLikeGame(source)) {
      setBusy(true, "console");
      stage.hidden = true;
      clearOutput();
      consoleIO.setEnabled(true);
      try {
        pyodide.globals.set("_pyide_source", source);
        var result = await pyodide.runPythonAsync(
          "_pyide_run(_pyide_source, " + TIME_LIMIT_SECONDS + ")"
        );
        if (result === "ok") write("\n— finished —\n", "dim");
      } catch (e) {
        write(String(e) + "\n", "err");
      } finally {
        setBusy(false);
        mine.focus();
      }
      return;
    }

    setBusy(true, "game");
    try {
      canvas = await window.PyIDEGame.ensureReady(pyodide, function () {}, source);
      canvas.addEventListener("mousedown", function () { canvas.focus(); });
    } catch (e) {
      write("The game engine could not load.\n" + String(e) + "\n", "err");
      setBusy(false);
      return;
    }
    clearOutput();
    write("Game running. Click the picture first so the keys reach it.\n", "dim");
    stage.hidden = false;
    consoleIO.setEnabled(false);
    canvas.focus();
    try {
      var status = await pyodide.runPythonAsync(
        "_pyide_run_game(" + JSON.stringify(source) + ")"
      );
      if (status === "ok") await pyodide.runPythonAsync("await _pyide_drive_game()");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      window.PyIDEGame.stop(pyodide);
      setBusy(false);
    }
  }

  function stopRun() {
    if (!running) return;
    if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
    if (runMode !== "game") return;
    window.PyIDEGame.stop(pyodide);
    write("\n— stopped —\n", "dim");
    mine.focus();
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stopRun);
  $("clear").addEventListener("click", clearOutput);

  // ----------------------------------------------------------- host's page

  function hostControls() {
    var stop = document.getElementById("live-stop");
    if (!stop) return;
    stop.addEventListener("click", function () {
      if (!window.confirm("End the lesson? Your class stops seeing your editor.")) {
        return;
      }
      fetch("/api/live/" + encodeURIComponent(L.code) + "/stop", { method: "POST" })
        .then(function () { stop.disabled = true; stop.textContent = "Ended"; });
    });
  }
})();
