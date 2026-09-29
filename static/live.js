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

  /* And if a selection is made anyway, it cannot be taken.
   *
   * The stylesheet stops the ordinary drag. This is the second half, because
   * user-select is a rendering hint and not a rule: a browser extension, a
   * "select all" from the browser's own menu, or find-on-page can still leave
   * text selected inside the mirror, and then Ctrl+C would lift the lesson.
   * Cancelling the event is what actually refuses.
   *
   * Only over the mirror. The student's own editor is theirs to copy from,
   * and this listener is attached to the mirror's element, not the document,
   * so there is no way for it to reach the wrong one. */
  var mirrorEl = mirror.getWrapperElement();
  ["copy", "cut"].forEach(function (kind) {
    mirrorEl.addEventListener(kind, function (e) {
      e.preventDefault();
      note("Type it out — that is the exercise");
    });
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
      autosave();
    }, 500);
  });

  /* ------------------------------------------------- into their projects
   *
   * Signed in, the copy they type here is an ordinary PyIDE project: press
   * Save once and it autosaves from then on, exactly as the editor does. It
   * turns up in My projects, opens at /p/<slug>, and can be turned in.
   *
   * The browser copy above stays either way. It is the only thing a
   * signed-out student has, and for a signed-in one it is what survives the
   * network being down for the ten minutes the school's wifi is having a
   * moment. The two never disagree about anything important, because both
   * are written from the same editor a fraction of a second apart.
   *
   * EVERYTHING BELOW SENDS `mine`. The mirror is not theirs and must never
   * end up in their projects with their name on it.
   */
  var saveBtn = $("live-save");
  var saveState = $("live-save-state");
  var openLink = $("live-open");
  var turnInBtn = $("live-turn-in");
  var SLUG_KEY = DRAFT_KEY + "-slug";
  var draftSlug = null;
  var pendingSave = false;
  /* Whether the lesson has an assignment behind it. Trusted from the save's
     own reply rather than assumed from the page, so a lesson whose
     assignment was closed between loading the page and pressing Save does
     not leave a Turn in button that cannot work. */
  var canTurnIn = false;

  try {
    draftSlug = window.localStorage.getItem(SLUG_KEY) || null;
  } catch (e) { /* they will press Save and get a fresh one */ }

  function savedNow(text) {
    if (!saveState) return;
    saveState.hidden = false;
    saveState.textContent = text;
    if (saveBtn) saveBtn.hidden = true;
    if (openLink && draftSlug) {
      openLink.hidden = false;
      openLink.href = "/p/" + encodeURIComponent(draftSlug);
    }
    if (turnInBtn) turnInBtn.hidden = !(draftSlug && canTurnIn);
  }

  if (draftSlug) {
    // Reopened mid-lesson with a copy already saved. The page knows whether
    // the lesson has an assignment, so Turn in can be offered straight away
    // rather than waiting for the next keystroke to trigger an autosave.
    canTurnIn = !!L.assignment;
    savedNow(L.submittedAt ? "Turned in " + L.submittedAt : "Saved");
  }

  /* Handing it in. The same endpoint the editor uses, against the same
     draft, so what the teacher sees on the dashboard is identical whichever
     way the student got there. */
  function turnIn() {
    if (!draftSlug || !canTurnIn) return;
    if (!window.confirm("Turn this in to " + (L.assignmentTitle || "your teacher")
                        + "? You can keep working and turn it in again.")) {
      return;
    }
    turnInBtn.disabled = true;
    fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft: draftSlug,
        code: mine.getValue(),            // theirs, never the mirror's
        files: {}
      })
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        turnInBtn.disabled = false;
        if (data.error) { window.alert(data.error); return; }
        turnInBtn.textContent = "Turn in again";
        savedNow("Turned in" + (data.submitted_at ? " " + data.submitted_at : ""));
      })
      .catch(function () {
        turnInBtn.disabled = false;
        window.alert("Could not turn it in. Check your connection and try again.");
      });
  }

  if (turnInBtn) turnInBtn.addEventListener("click", turnIn);

  function startDraft() {
    if (!L.signedIn || pendingSave) return;
    var text = mine.getValue();
    if (!text.trim()) { note("Type something first"); return; }
    pendingSave = true;
    /* /api/live/<code>/keep, NOT /api/draft.
       
       /api/draft makes a free-standing project with no assignment on it, and
       a draft with no assignment can never be turned in — which is what made
       handing work in from a live lesson impossible. This route puts the
       work in the assignment's own draft when the lesson has one, so it is
       the same row the handout link would have made and Turn in appears. */
    fetch("/api/live/" + encodeURIComponent(L.code) + "/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: text,                       // theirs, never the mirror's
        files: {}
      })
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        pendingSave = false;
        if (data.error) { window.alert(data.error); return; }
        draftSlug = data.slug;
        canTurnIn = !!data.can_turn_in;
        try { window.localStorage.setItem(SLUG_KEY, draftSlug); } catch (e) {}
        savedNow("Saved");
      })
      .catch(function () {
        pendingSave = false;
        window.alert("Could not save. Check your connection and try again.");
      });
  }

  function autosave() {
    if (!draftSlug || !L.signedIn) return;
    fetch("/api/draft/" + encodeURIComponent(draftSlug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: mine.getValue(),            // theirs, never the mirror's
        files: {},
        title: L.title || "Live lesson"
      })
    }).then(function (res) {
      if (res.status === 404) {
        /* The project was deleted from another tab, or from My projects.
           Forgetting the slug turns the next Save into a fresh one rather
           than leaving this page autosaving into nothing for the rest of
           the lesson and telling the student it was saved. */
        draftSlug = null;
        try { window.localStorage.removeItem(SLUG_KEY); } catch (e) {}
        if (saveBtn) saveBtn.hidden = false;
        if (saveState) saveState.hidden = true;
        if (openLink) openLink.hidden = true;
        return null;
      }
      return res.json();
    }).then(function (data) {
      if (data && data.saved_at) savedNow("Saved " + data.saved_at);
    }).catch(function () {
      if (saveState) saveState.textContent = "Not saved — still in this browser";
    });
  }

  if (saveBtn) saveBtn.addEventListener("click", startDraft);

  var noteTimer = null;
  function note(text) {
    if (!savedNote) return;
    savedNote.textContent = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { savedNote.textContent = ""; }, 2500);
  }

  // -------------------------------------------------------------- the mirror

  var seen = -1;
  /* What the notes pane was last rendered from. Compared before re-rendering
     because every poll hands over the whole file, and re-parsing markdown
     once a second would throw away a link the moment anyone moved to click
     it — the element under the cursor is replaced. */
  var lastNotes = null;

  var mirrorWrap = $("mirror-wrap");
  var mirrorNotes = $("mirror-notes");

  function showMirror(data) {
    /* A .md file is class notes, not code. Rendering it is what makes a link
       the teacher puts up something the class can actually click — raw
       markdown in a code pane is just `[click here](http://…)` in grey.
       notes.js sanitises the HTML and points every link at a new tab. */
    var asNotes = data.filename
      && window.PyIDENotes && window.PyIDENotes.isMarkdown(data.filename);

    if (asNotes) {
      mirrorWrap.hidden = true;
      mirrorNotes.hidden = false;
      if (typeof data.body === "string" && data.body !== lastNotes) {
        lastNotes = data.body;
        window.PyIDENotes.render(mirrorNotes, data.body);
      }
    } else {
      mirrorNotes.hidden = true;
      var wasHidden = mirrorWrap.hidden;
      mirrorWrap.hidden = false;
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
      /* CodeMirror measures itself when it is built. Built or updated while
         its container is display:none it measures zero, and comes back from
         the notes pane as an empty box that only fills in when something
         forces a redraw. Switching a tab in front of a class is exactly when
         that would happen, so refresh on the way back. */
      if (wasHidden) mirror.refresh();
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
  /* Which run the game finally belongs to — Stop resets the toolbar itself,
     so an old pending promise must not reset a newer run's. */
  var runToken = 0;

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
      document.body.classList.remove("is-game");
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

    var token = ++runToken;
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
    /* The same class the editor sets. It is what turns the output pane into
       a log strip under the picture instead of letting it fight the canvas
       for the right-hand column. */
    document.body.classList.add("is-game");
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
      // Only if this is still the run the toolbar is showing. See runToken.
      if (token === runToken) {
        window.PyIDEGame.stop(pyodide);
        setBusy(false);
      }
    }
  }

  function stopRun() {
    if (!running) return;
    if (consoleIO.isWaiting()) { consoleIO.cancel(); return; }
    if (runMode !== "game") return;
    /* THE TOOLBAR IS PUT BACK HERE, not by the finally above.

       Measured on the deployed editor, which had the same shape: pressing
       Stop on a kaypy game freezes the canvas and prints "— stopped —", and
       then the await on `_pyide_drive_game()` never settles, so Run stays on
       "Running…" with Stop showing until the page is reloaded. The engine has
       stopped; only the button disagrees. The student asked to stop and the
       engine has been told, so the UI is correct to say so now. */
    window.PyIDEGame.stop(pyodide);
    write("\n— stopped —\n", "dim");
    setBusy(false);
    document.body.classList.remove("is-game");
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
