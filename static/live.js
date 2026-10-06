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
    /* The same keys as the main editor. This editor was once configured on
       its own and went without both tab stops and name completion — nothing
       broke, it just behaved worse than the editor students already knew,
       in the one lesson where the whole class is copying indentation. */
    extraKeys: {
      Tab: window.PyIDETabStops.indentToTabStop,
      Backspace: window.PyIDETabStops.backspaceToTabStop,
      "Shift-Tab": function (cm) { cm.indentSelection("subtract"); },
      "Ctrl-/": function (cm) { cm.toggleComment({ indent: true }); },
      "Cmd-/": function (cm) { cm.toggleComment({ indent: true }); },
      "Ctrl-Enter": function () { run(); },
      "Cmd-Enter": function () { run(); }
    }
  });

  /* Completion of the student's own names, exactly as in the editor. Names
     come from what the student has typed, never from the teacher's pane —
     suggesting the lesson's variables would be the copy button by another
     route. Until Python loads, refresh() and show() do nothing. */
  var nameTimer = null, hintTimer = null;
  mine.on("change", function (cm, change) {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(function () {
      window.PyIDEComplete.refresh(mainSource());
    }, 250);

    // only offer suggestions while a word is actually being typed, and only
    // in Python — a word typed into words.txt is not a name to complete
    var typed = change.origin === "+input" && change.text.join("");
    if (typed && /^[A-Za-z0-9_]$/.test(typed) && modeFor(active) === "python") {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        if (!cm.state.completionActive) window.PyIDEComplete.show(cm);
      }, 120);
    }
  });

  /* The student's own work, in their browser only. There is no account
     needed to follow a lesson, so there is nowhere on the server this could
     go — and a refresh in the middle of a lesson must not cost them the
     twenty lines they have typed. Every read and write is wrapped, because
     localStorage throws outright in a private window and on a locked-down
     school laptop. */
  /* Nothing kept here, and the lesson is for an assignment: start from what
     the handout link would have opened — their own draft of it, or its
     starter (the server decides which; see live_page). What they typed in
     this browser always wins over both, so a reload never puts the starter
     back over twenty minutes of typing. `null` rather than falsy: an editor
     they emptied on purpose stays empty. */
  var kept = null;
  var keptBase = null;
  var BASE_KEY = DRAFT_KEY + "-base";
  try {
    kept = window.localStorage.getItem(DRAFT_KEY);
    keptBase = window.localStorage.getItem(BASE_KEY);
  } catch (e) { /* storage blocked: fall back to the starting point */ }

  /* UNLESS THEIR DRAFT HAS MOVED ON WITHOUT THIS BROWSER. The copy kept
     here remembers which version of their draft it grew from. If the draft
     has been saved since — homework at home last night, through the
     handout link — this browser's copy is the older work, and letting it
     win would put last night's work under it on screen and then, at the
     first Save, over it on the server. A reopened lesson is exactly when
     that happens: the same code, so the same key, a day later.

     A copy with no version beside it (kept before this existed, or never
     saved) still wins, as it always did. */
  var behind = kept !== null && keptBase !== null
    && typeof L.draftVersion === "number"
    && L.draftVersion > Number(keptBase);
  if (behind) {
    kept = null;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
      window.localStorage.removeItem(DRAFT_KEY + "-files");
    } catch (e) { /* nothing kept to remove */ }
  }

  function noteBase(version) {
    try { window.localStorage.setItem(BASE_KEY, String(version)); }
    catch (e) { /* then the copy here simply wins, as before */ }
  }
  if (typeof L.draftVersion === "number" && (keptBase === null || behind)) {
    noteBase(L.draftVersion);
  }
  var start = kept !== null ? kept : (L.starter || "");
  if (start) mine.setValue(start);
  mine.clearHistory();

  /* ------------------------------------------------------------ their files
   *
   * main.py and the rest of their project, each its own CodeMirror document
   * swapped into `mine`, exactly as the editor keeps them — so switching tabs
   * keeps the caret and the undo history, and there is still only the one
   * editor a student types in. The mirror never fills any of these.
   *
   * The other files are kept in this browser beside main.py, under their own
   * key, and the same rule decides where they start: what this browser has
   * wins, else the project's own files (their draft's, or the assignment's).
   * main.py's key is unchanged, so a browser that kept a lesson before tabs
   * existed still gets its typing back — with the project's files beside it.
   *
   * A .md file stays out of the strip. It is the project's notes, which the
   * class already reads in the Notes pane, but it is still part of what is
   * saved: a save that left it out would delete the assignment's notes. */
  var MAIN = "main.py";
  var PROJECT_DIR = "/project";
  var NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,50}\.[A-Za-z0-9]{1,8}$/;
  var FILES_KEY = DRAFT_KEY + "-files";
  var docs = {};
  var active = MAIN;
  var tabsEl = $("mine-tabs");
  docs[MAIN] = mine.getDoc();

  var keptFiles = null;
  try {
    keptFiles = JSON.parse(window.localStorage.getItem(FILES_KEY) || "null");
  } catch (e) { /* blocked, or not ours to read: the project's own files */ }
  var startFiles = (keptFiles && typeof keptFiles === "object")
    ? keptFiles : (L.starterFiles || {});
  Object.keys(startFiles).forEach(function (name) {
    if (name !== MAIN && typeof startFiles[name] === "string") {
      docs[name] = CodeMirror.Doc(startFiles[name], modeFor(name));
    }
  });

  function modeFor(name) {
    return /\.py$/i.test(name) ? "python" : null;   // .txt and .csv are text
  }

  /* The program, whichever tab is open. NOT mine.getValue(): with a .txt tab
     showing, that is the text file, and Run would try to execute words.txt. */
  function mainSource() { return docs[MAIN].getValue(); }

  function dataFiles() {
    var out = {};
    Object.keys(docs).forEach(function (n) {
      if (n !== MAIN) out[n] = docs[n].getValue();
    });
    return out;
  }

  function isNotes(name) {
    return window.PyIDENotes && window.PyIDENotes.isMarkdown(name);
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.textContent = "";
    var names = [MAIN].concat(Object.keys(docs).filter(function (n) {
      return n !== MAIN && !isNotes(n);
    }).sort());
    names.forEach(function (name) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab" + (name === active ? " tab-on" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(name === active));
      tab.textContent = name;
      tab.addEventListener("click", function () { switchTo(name); });
      tabsEl.appendChild(tab);
    });
  }

  function switchTo(name) {
    if (!docs[name] || name === active) return;
    active = name;
    mine.swapDoc(docs[name]);
    mine.setOption("mode", modeFor(name));
    renderTabs();
    mine.focus();
  }

  function keepInBrowser() {
    try {
      window.localStorage.setItem(DRAFT_KEY, mainSource());
      window.localStorage.setItem(FILES_KEY, JSON.stringify(dataFiles()));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* A file of their own, for following a teacher who makes one mid-lesson.
     Same names the editor allows, and the server checks again. No way to
     delete one here, on purpose: the server reads an empty map from this
     page as "leave the files alone" (see live_keep), which is only safe
     while nothing on this page can empty it. */
  var newFileBtn = $("mine-new-file");
  if (newFileBtn) {
    newFileBtn.addEventListener("click", function () {
      var name = window.prompt("Name the new file, for example words.txt");
      if (name === null) return;
      name = name.trim();
      if (!NAME_OK.test(name) || name.toLowerCase() === MAIN || isNotes(name)) {
        window.alert("Use letters, digits, dashes and underscores, and end " +
                     "with an extension like .txt or .py.");
        return;
      }
      if (docs[name]) { switchTo(name); return; }
      docs[name] = CodeMirror.Doc("", modeFor(name));
      switchTo(name);
      changed();
    });
  }

  renderTabs();

  var saveTimer = null;
  /* Every change in any tab, and a new file, which fires no editor event. */
  function changed() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (keepInBrowser()) {
        note("Saved on this computer");
      } else {
        note("Could not save here — keep this tab open");
      }
      autosave();
    }, 500);
  }
  mine.on("change", changed);

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

  /* TWO TABS, ONE DRAFT. Every write says which version of the draft this
     tab last saw, and which tab it is; the server refuses it if another tab
     has saved since. Without that, the Classroom link open in a forgotten
     second tab wrote its old copy over this lesson's work the moment a key
     was pressed in it. Refused, this tab stops saving and says so — the
     other tab's copy is the one to keep. See Draft.version in accounts.py.

     Unknown until the first save when the page had no draft to start from
     (a lesson with no assignment), and then nothing is claimed: the first
     reply carries the version, and the guard holds from there. */
  var TAB = Math.random().toString(36).slice(2, 14);
  /* NOT `seen`. The mirror below keeps the lesson's version in a `seen` of
     its own, and with one function around both they were the same variable:
     the first poll replaced the draft's version with the lesson's, so a
     student whose draft had last been saved anywhere else — the handout
     link, or this page yesterday — had every Save refused as "changed in
     another tab". Nothing about it showed until they pressed Save. */
  var draftSeen = typeof L.draftVersion === "number" ? L.draftVersion : null;
  var stale = false;

  function stamp(payload) {
    if (draftSeen !== null) { payload.base = draftSeen; payload.tab = TAB; }
    return payload;
  }

  function saw(data) {
    if (data && typeof data.version === "number") {
      draftSeen = data.version;
      noteBase(draftSeen);
    }
  }

  function goneStale(message) {
    if (stale) return;
    stale = true;
    if (saveState) {
      saveState.hidden = false;
      saveState.textContent = "Not saved — changed in another tab";
    }
    if (turnInBtn) turnInBtn.disabled = true;
    window.alert(message + " What you typed here is still on screen, and in "
                 + "this browser, so copy it first if you need it.");
  }

  function savedNow(text) {
    if (!saveState) return;
    saveState.hidden = false;
    saveState.textContent = text;
    if (saveBtn) saveBtn.hidden = true;
    if (openLink && draftSlug) {
      openLink.hidden = false;
      openLink.href = "/p/" + encodeURIComponent(draftSlug);
    }
    if (turnInBtn) turnInBtn.hidden = !canTurnIn;
  }

  /* A lesson for an assignment offers Turn in from the start: there is no
     Save to press first, and turnIn() makes the draft itself if the first
     keystroke has not already. */
  canTurnIn = !!L.assignment;
  if (draftSlug || L.submittedAt) {
    // Reopened mid-lesson with a copy already saved, or already turned in.
    savedNow(L.submittedAt ? "Turned in " + L.submittedAt : "Saved");
  }

  /* Handing it in. The same endpoint the editor uses, against the same
     draft, so what the teacher sees on the dashboard is identical whichever
     way the student got there. */
  function turnIn() {
    if (!canTurnIn || stale) return;
    if (!window.confirm("Turn this in to " + (L.assignmentTitle || "your teacher")
                        + "? You can keep working and turn it in again.")) {
      return;
    }
    turnInBtn.disabled = true;
    /* SAVE FIRST, THEN HAND IN WHAT WAS SAVED.
       
       Turning in replaces a draft's files with what is posted, and this pane
       has only the one editor — so posting an empty map would delete every
       data file the assignment shipped, at the exact moment the work is
       handed in and without a word. Keeping first writes the edit and hands
       back the whole project; that is what goes in. */
    keep().then(function (saved) {
      if (!saved) {
        if (stale) return;                // goneStale has said why
        turnInBtn.disabled = false;
        window.alert("Could not save before turning in. Try again.");
        return;
      }
      // the first save of the lesson may be this one
      rememberDraft(saved.slug);
      return fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stamp({
          draft: draftSlug,
          code: mainSource(),             // theirs, never the mirror's
          files: saved.files || {}
        }))
      }).then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.stale) { goneStale(data.error); return; }
          turnInBtn.disabled = false;
          if (data.error) { window.alert(data.error); return; }
          saw(data);
          turnInBtn.textContent = "Turn in again";
          savedNow("Turned in" + (data.submitted_at ? " " + data.submitted_at : ""));
        });
    }).catch(function () {
      turnInBtn.disabled = false;
      window.alert("Could not turn it in. Check your connection and try again.");
    });
  }

  /* One place that writes to the lesson's draft, used by Save, by autosave
     and by Turn in — so the three cannot disagree about what a project is. */
  function keep() {
    return fetch("/api/live/" + encodeURIComponent(L.code) + "/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stamp({ code: mainSource(), files: dataFiles() }))
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.stale) { goneStale(data.error); return null; }
        if (data && !data.error) { saw(data); return data; }
        return null;
      });
  }

  if (turnInBtn) turnInBtn.addEventListener("click", turnIn);

  function rememberDraft(slug) {
    if (!slug) return;
    draftSlug = slug;
    try { window.localStorage.setItem(SLUG_KEY, draftSlug); } catch (e) {}
  }

  /* The silent Save of an assignment lesson: the first keystroke makes the
     draft — the same row the handout link would have made — and autosave
     carries on from there. Without it a student's work would reach the
     server only when they pressed Turn in, and a closed laptop lid before
     that would leave nothing on the My work page. */
  var pendingKeep = false;
  function keepQuietly() {
    if (stale || pendingKeep || draftSlug || !L.signedIn || !L.assignment) return;
    if (!mainSource().trim()) return;
    pendingKeep = true;
    keep().then(function (saved) {
      pendingKeep = false;
      if (!saved) return;
      rememberDraft(saved.slug);
      savedNow(L.submittedAt ? "Turned in " + L.submittedAt : "Saved");
    }).catch(function () { pendingKeep = false; });
  }

  function startDraft() {
    if (!L.signedIn || pendingSave) return;
    var text = mainSource();
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
      body: JSON.stringify(stamp({
        code: text,                       // theirs, never the mirror's
        files: dataFiles()
      }))
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        pendingSave = false;
        if (data.stale) { goneStale(data.error); return; }
        if (data.error) { window.alert(data.error); return; }
        saw(data);
        rememberDraft(data.slug);
        canTurnIn = !!data.can_turn_in;
        savedNow("Saved");
      })
      .catch(function () {
        pendingSave = false;
        window.alert("Could not save. Check your connection and try again.");
      });
  }

  function autosave() {
    if (stale) return;
    if (!draftSlug) { keepQuietly(); return; }
    if (!L.signedIn) return;
    fetch("/api/draft/" + encodeURIComponent(draftSlug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stamp({
        code: mainSource(),               // theirs, never the mirror's
        /* Every file, because this route REPLACES them. It was sent `{}`
           once, when the page had only main.py, and each autosave quietly
           emptied the project of the data files it shipped with. */
        files: dataFiles(),
        title: L.title || "Live lesson"
      }))
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
      if (data && data.stale) { goneStale(data.error); return; }
      saw(data);
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
      // A .txt the teacher opens is text, not Python to be coloured as such.
      var mode = /\.py$/i.test(data.filename || "main.py") ? "python" : null;
      if (mirror.getOption("mode") !== mode) mirror.setOption("mode", mode);
      // The ONLY setValue on the mirror. `mine` is never given anything from
      // the network: its tabs are filled from the page and from their own Run.
      if (typeof data.body === "string" && data.body !== mirror.getValue()) {
        clearCaret();                // its line is about to be replaced
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
      showCaret(typeof data.cursor === "string" ? data.cursor : "");
    }

    if (data.filename) {
      var name = document.getElementById("mirror-name");
      if (name) name.textContent = data.filename;
    }
    seen = data.version;
    showSnippet(data);
    showNotes(data);
    showTeacherOutput(data);
  }

  /* ------------------------------------------------ the teacher's caret
     Where the teacher is typing, drawn as a blinking caret on a tinted line,
     and followed: when it moves off screen the mirror scrolls to it. It is a
     bookmark widget, not a selection or a real cursor, so the mirror stays
     "nocursor" and still cannot be focused or copied from.

     What the teacher has highlighted comes as "anchor-head" and is painted
     yellow with markText — again a mark, not a selection, for the same
     reason. The caret sits at the head, where the drag ended, as it does in
     the teacher's own editor; the line tint is left off then, because a
     tinted line inside a yellow block reads as a second thing to look at.

     Following is the point — a class otherwise watches line 1 while the
     teacher types on line 40 — but a student who scrolls back to read
     something must not be yanked away mid-sentence. So scrolling the
     mirror by hand pauses following for a few seconds, and only that does:
     the scroll events CodeMirror fires for its own scrolling are ignored by
     listening for the wheel, a touch and the scrollbar instead. */
  var caretMark = null;
  var caretLine = null;
  var pickMark = null;
  var followAfter = 0;
  var FOLLOW_PAUSE_MS = 5000;

  ["wheel", "touchmove", "mousedown"].forEach(function (kind) {
    mirrorEl.addEventListener(kind, function () {
      followAfter = Date.now() + FOLLOW_PAUSE_MS;
    }, { passive: true });
  });

  function clearCaret() {
    if (caretMark) { caretMark.clear(); caretMark = null; }
    if (pickMark) { pickMark.clear(); pickMark = null; }
    /* A line handle from before a setValue is detached, and removing a
       class from it throws — getLineNumber is null for exactly those. */
    if (caretLine && mirror.getLineNumber(caretLine) !== null) {
      mirror.removeLineClass(caretLine, "background", "mirror-caret-line");
    }
    caretLine = null;
  }

  // "line:ch" to a position in the mirror. Clamped: the caret and the text
  // arrive together, but a student's mirror is never trusted to be the
  // exact shape the stamp assumed.
  function mirrorPos(line, ch) {
    line = Math.min(+line, mirror.lastLine());
    return { line: line, ch: Math.min(+ch, mirror.getLine(line).length) };
  }

  function showCaret(cursor) {
    clearCaret();
    var m = /^(?:(\d+):(\d+)-)?(\d+):(\d+)$/.exec(cursor);
    if (!m) return;                  // a notes file, or an older editor
    var at = mirrorPos(m[3], m[4]);
    var mark = document.createElement("span");
    mark.className = "mirror-caret";
    caretMark = mirror.setBookmark(at, { widget: mark, insertLeft: true });
    var show = at;
    if (m[1] !== undefined) {
      var other = mirrorPos(m[1], m[2]);
      var backwards = CodeMirror.cmpPos(other, at) > 0;  // dragged upwards
      var from = backwards ? at : other, to = backwards ? other : at;
      pickMark = mirror.markText(from, to, { className: "mirror-pick" });
      show = { from: from, to: to };
    } else {
      caretLine = mirror.addLineClass(at.line, "background", "mirror-caret-line");
    }
    // Only scrolls when it is off screen, so a mirror that already shows it
    // does not twitch on every keystroke.
    if (Date.now() >= followAfter) mirror.scrollIntoView(show, 60);
  }

  /* The project's notes, in their own pane under the output. Re-rendered
     only when they change, for the same reason as the mirror's notes above:
     every poll carries them whole, and re-rendering once a second would
     replace a link under the cursor just as someone clicked it. */
  var notesView = $("live-notes-view");
  var notesBody = $("live-notes");
  var shownNotes = null;

  var slideMark = $("live-slide");
  var shownSlide = null;

  /* Slides need nothing special here. When the teacher's notes are cut into
     slides, `notes` is only the current one — the editor does the cutting —
     and `slide` says where it is ("3/5"). A new slide is new notes, so it
     renders through the same path; all this adds is the marker, and going
     back to the top, because the last slide's scroll position means nothing
     on the next one and a class would start reading it halfway down. */
  function showNotes(data) {
    if (!notesView || typeof data.notes !== "string") return;
    var slide = typeof data.slide === "string" ? data.slide : "";
    if (data.notes === shownNotes && slide === shownSlide) return;
    var moved = slide !== shownSlide;
    shownNotes = data.notes;
    shownSlide = slide;
    if (slideMark) {
      var m = slide.match(/^(\d+)\/(\d+)$/);
      slideMark.textContent = m ? "Slide " + m[1] + " of " + m[2] : "";
    }
    notesView.hidden = !data.notes.trim();
    if (notesView.hidden) return;
    window.PyIDENotes.render(notesBody, data.notes).then(function () {
      if (moved) notesBody.scrollTop = 0;
    });
  }

  // --------------------------------------------- what the teacher's Run printed

  /* In its own pane beside the teacher's code, never in the student's
     output: that is where input() takes their typing, and the one rule of
     this page is that nothing from the network is written into anything of
     theirs.

     The pane appears with the first output and then stays, even when an
     output comes back empty — the teacher's Run clears before it prints,
     and a push can land in between, which would make the code beside it
     jump sideways and back on every Run. */
  var teacherOut = $("teacher-output");
  var teacherView = $("teacher-output-view");
  var shownOutput = null;

  function showTeacherOutput(data) {
    if (!teacherOut || typeof data.output !== "string") return;
    if (data.output === shownOutput) return;
    shownOutput = data.output;
    teacherOut.textContent = data.output;
    teacherOut.scrollTop = teacherOut.scrollHeight;
    if (!data.output || !teacherView.hidden) return;
    teacherView.hidden = false;
    /* The mirror just got narrower, and CodeMirror only measures itself
       on a window resize — without this its scrollbar and the caret's
       follow are worked out for the old width. */
    mirror.refresh();
  }

  /* The output pane starts folded to its head, leaving the column to the
     notes; the head's arrow opens it. The student's own Run opens it too,
     because a program waiting on input() in a folded pane looks exactly
     like one that has hung. Not remembered between visits: folded is the
     state every lesson should start in. */
  var outputView = $("output-view");
  var foldBtn = $("out-fold");

  function openConsole(open) {
    if (!outputView) return;
    outputView.classList.toggle("is-folded", !open);
    if (foldBtn) {
      foldBtn.textContent = open ? "▾" : "▸";
      foldBtn.title = open ? "Fold the output away" : "Show the output";
      foldBtn.setAttribute("aria-expanded", String(open));
    }
  }

  if (foldBtn) {
    foldBtn.addEventListener("click", function () {
      openConsole(outputView.classList.contains("is-folded"));
    });
  }
  openConsole(false);

  // ------------------------------------------------ what the teacher sent

  /* Code the teacher highlighted and sent. Shown in a card above the
     student's editor with an Insert button, and that button is the ONLY way
     anything from the network reaches their editor — on their click, at
     their cursor, added to what they have rather than replacing it. The poll
     only ever fills the card.

     `snippetSeen` is the stamp of the snippet already shown (or closed), so
     a Close stays closed across polls, but the teacher sending again — even
     the same text — brings it back. An empty snippet is the teacher taking
     it back: the card goes, and with it the button. */
  var snippetCard = $("snippet");
  var snippetCode = $("snippet-code");
  var snippetSeen = -1;
  var snippetText = "";

  function showSnippet(data) {
    if (!snippetCard) return;
    var text = typeof data.snippet === "string" ? data.snippet : "";
    var seq = data.snippet_seq || 0;
    if (!text) {
      snippetText = "";
      snippetCard.hidden = true;
      return;
    }
    if (seq === snippetSeen) return;   // already shown, or closed
    snippetSeen = seq;
    snippetText = text;
    snippetCode.textContent = text;
    snippetCard.hidden = false;
    // The card takes room from the editor above it; CodeMirror only notices
    // on a window resize, so clicks would land on the wrong line without this.
    setTimeout(function () { mine.refresh(); }, 0);
  }

  if (snippetCard) {
    $("snippet-insert").addEventListener("click", function () {
      if (!snippetText) return;
      insertSnippet(snippetText);
    });
    $("snippet-close").addEventListener("click", function () {
      snippetCard.hidden = true;
      setTimeout(function () { mine.refresh(); }, 0);
    });
  }

  /* At the caret, as its own line(s). Indented to match the line the caret
     is on, because a snippet sent from inside a function would otherwise
     land at column 0 — or at the teacher's indentation, not the student's —
     and in Python either one is a different program. */
  function insertSnippet(text) {
    var lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    var least = null;
    lines.forEach(function (ln) {
      if (!ln.trim()) return;
      var n = ln.match(/^ */)[0].length;
      if (least === null || n < least) least = n;
    });
    lines = lines.map(function (ln) { return ln.slice(least || 0); });

    var cur = mine.getCursor();
    var here = mine.getLine(cur.line);
    var indent = here.match(/^ */)[0];
    var blank = !here.trim();
    var body = lines.map(function (ln, i) {
      return (ln && (i > 0 || !blank)) ? indent + ln : ln;
    }).join("\n");

    if (blank) {
      // On an empty line: fill it, keeping the indentation already there.
      mine.replaceRange(indent + body,
                        { line: cur.line, ch: 0 },
                        { line: cur.line, ch: here.length }, "+snippet");
    } else {
      // Mid-code: never split what they wrote; go on the next line.
      mine.replaceRange("\n" + body, { line: cur.line, ch: here.length },
                        null, "+snippet");
    }
    mine.focus();
    note("Inserted");
  }

  function setState(text, kind) {
    if (!stateChip) return;
    stateChip.textContent = text;
    stateChip.className = "chip live-chip" + (kind ? " live-" + kind : "");
  }

  if (typeof L.body === "string") {
    showMirror({ body: L.body, version: L.version, filename: L.filename,
                 snippet: L.snippet, snippet_seq: L.snippetSeq,
                 notes: L.notes, slide: L.slide, output: L.output,
                 cursor: L.cursor });
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
      window.PyIDEComplete.attach(pyodide);
      window.PyIDEComplete.refresh(mainSource());
      clearOutput();
      write("Python is ready. Type along, then press Run.\n", "dim");
      runBtn.disabled = false;
      runLabel.textContent = "Run";
    } catch (e) {
      write("Python could not load. Check your connection and refresh.\n"
            + String(e) + "\n", "err");
    }
  })();

  /* Their files go into Python's folder before a run and come back out
     after it, the same as in the editor: a program that reads words.txt
     finds it, and one that writes out.txt gets a tab for it. */
  function pushFilesToPython() {
    pyodide.FS.mkdirTree(PROJECT_DIR);
    var files = dataFiles();
    Object.keys(files).forEach(function (name) {
      pyodide.FS.writeFile(PROJECT_DIR + "/" + name,
                           new TextEncoder().encode(files[name]));
    });
  }

  function pullFilesFromPython() {
    var entries;
    try { entries = pyodide.FS.readdir(PROJECT_DIR); } catch (e) { return; }
    var appeared = [], any = false;
    entries.forEach(function (name) {
      if (name === "." || name === ".." || name === MAIN) return;
      if (!NAME_OK.test(name)) return;      // nothing the server would refuse
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
        docs[name] = CodeMirror.Doc(text, modeFor(name));
        appeared.push(name);
        any = true;
      } else if (docs[name].getValue() !== text) {
        docs[name].setValue(text);
        any = true;
      }
    });
    if (!any) return;
    renderTabs();
    changed();
    if (appeared.length) {
      write("\nYour program wrote " + appeared.join(", ") +
            " — open the tab to see it.\n", "dim");
    }
  }

  async function run() {
    if (running || !pyodide) return;
    var source = mainSource();             // theirs, never the mirror's
    pushFilesToPython();
    openConsole(true);

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
        pullFilesFromPython();
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
        pullFilesFromPython();
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
