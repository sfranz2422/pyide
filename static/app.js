/* PyIDE — the editor's shell: tabs, notes, theme, saving, sharing, teaching
   live. What Run does belongs to the project's runner (static/runners/), so
   the same shell can hold a Python project or, soon, an HTML one. */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var outputEl = $("output");
  var authorField = $("author");

  /* The runner for this project's IDE (IDES in app.py), e.g. runners/python.js.
     Its definition answers at once (the entry file, each tab's mode, which
     files have no tab); the rest is attached once the shell below exists. */
  var R = window.IDERunners[window.PYIDE.ide || "pyide"];
  var runner = null;


  // ------------------------------------------------------------- tab stops
  // Shared with the live-lesson editor, so it lives in tabstops.js.
  var indentToTabStop = window.PyIDETabStops.indentToTabStop;
  var backspaceToTabStop = window.PyIDETabStops.backspaceToTabStop;

  // ---------------------------------------------------------------- editor
  var editor = CodeMirror.fromTextArea($("editor"), {
    mode: R.editorOptions.mode,
    theme: "material-darker",
    lineNumbers: true,
    indentUnit: R.editorOptions.indentUnit,
    tabSize: R.editorOptions.tabSize,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    readOnly: window.PYIDE.readonly ? "nocursor" : false,
    extraKeys: {
      "Ctrl-Enter": function () { runner.run(); },
      "Cmd-Enter": function () { runner.run(); },
      Tab: indentToTabStop,
      Backspace: backspaceToTabStop,
      "Shift-Tab": function (cm) { cm.indentSelection("subtract"); },
      // indent:true keeps the # at the code's own indentation rather than
      // shoving it to column 0, which is how Python is normally written
      "Ctrl-/": function (cm) { cm.toggleComment({ indent: true }); },
      "Cmd-/": function (cm) { cm.toggleComment({ indent: true }); }
    }
  });
  // Whatever else the runner asks of the editor: a web project closes its
  // tags as they are typed (runners/web.js).
  Object.keys(R.editorOptions).forEach(function (k) {
    if (["mode", "indentUnit", "tabSize"].indexOf(k) < 0) editor.setOption(k, R.editorOptions[k]);
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

  /* A theme bought in the shop (xp.js namedTheme): its own CodeMirror
     colours, and the button offers the way back to light/dark. */
  var named = window.PyIDEXP ? window.PyIDEXP.namedTheme() : "";
  function showNamed() {
    editor.setOption("theme", "pyide-" + named);
    themeGlyph.textContent = "🎨";
    themeBtn.title = "Your theme — click for light, then dark, then back";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  // In dark, the next click brings their theme back (xp.js), so say so.
  function hintBack() {
    if (named || currentTheme() !== "dark" || !window.PyIDEXP || !window.PyIDEXP.lastTheme()) return;
    themeGlyph.textContent = "🎨";
    themeBtn.title = "Back to your theme";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  if (named) {
    showNamed();
  } else {
    applyTheme(currentTheme(), false);
    hintBack();
  }

  themeBtn.addEventListener("click", function () {
    if (named) {
      named = "";
      window.PyIDEXP.clearTheme();
      applyTheme("light", true);
      return;
    }
    if (currentTheme() === "dark" && window.PyIDEXP && window.PyIDEXP.lastTheme()) {
      window.PyIDEXP.restoreTheme().then(function (t) {
        if (t) { named = t; showNamed(); relayout(); }
        else applyTheme("light", true);
      });
      return;
    }
    applyTheme(currentTheme() === "light" ? "dark" : "light", true);
    hintBack();
  });

  // Follow the computer's setting as it changes, until a choice is made here.
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onSystemChange = function () {
      if (named) return;                      // a bought theme stays put
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
  /* The entry is the project's first tab and can't be removed: main.py, the
     program, in a Python project (the runner says which). Each file keeps its
     own CodeMirror document, so switching tabs preserves the caret and the
     undo history. */
  // A FlaskIDE project's depends on its files: app.py, query.sql or
  // index.php (runners/flask.js), so the runner can say it from them.
  var MAIN = typeof R.entry === "function" ? R.entry(window.PYIDE.files || {}) : R.entry;
  // The editor was made before the entry was known; give it the entry's own
  // mode (a SQL project opens on query.sql). The same mode it had otherwise.
  editor.setOption("mode", R.modeFor(MAIN));
  // Files kept with the project that are no tab (a block world, a Pi's
  // breadboard): the runner's to say.
  var hidden = R.hidden;
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

  /* Questions in the notes answer into this assignment. On a project that
     is not one, or the teacher's own copy, there is nowhere to record an
     answer, and notes.js says so on the question rather than taking one. */
  window.PyIDENotes.setQuizContext({ assignment: window.PYIDE.assignmentSlug,
                                     signedIn: window.PYIDE.signedIn,
                                     viewOnly: window.PYIDE.viewOnly });
  // Predictions in the notes: XP for a first-try one, and the teacher
  // writing them is never held by one (snippets.js).
  if (window.IDESnippets) window.IDESnippets.configure({ assignment: window.PYIDE.assignmentSlug,
    signedIn: window.PYIDE.signedIn, viewOnly: window.PYIDE.viewOnly, teacher: !!window.PYIDE.authoring });

  /* A STUDENT SEES BOTH: the output and the notes, the notes under it, as
     on the live page. They took turns, and a student told to check after
     every step lost the step's slide each time they pressed Run or Check my
     work, and lost the results each time they went back to the slide. The
     notes button shows and hides the pane instead. Whoever is writing the
     notes keeps the turns: their .md opens in the editor (Edit source), and
     the teacher's editor has "Class sees" under it while live. */
  function notesBeside() { return !window.PYIDE.authoring; }
  var notesOpen = "";        // which notes are up, while notesBeside()

  /* The notes are a column of their own now (index.html), so showing them
     never hides the output and Run never hides them: both stay up until
     the notes' Hide, or their button, puts them away. */
  function hideNotes() {
    notesView.hidden = true;
    notesOpen = "";
    // The author's .md tab stops being the lit one with its notes away —
    // unless its source is open in the editor, which is what they're editing.
    if (window.PyIDENotes.isMarkdown(active) && !mdSourceOpen) active = lastCodeFile;
    renderTabs();
    relayout();
  }
  var notesClose = $("notes-close");
  if (notesClose) notesClose.addEventListener("click", hideNotes);

  function showOutput() {
    outputView.hidden = false;
  }

  /* Always as slides when the notes have `---` in them, with ◀ ▶ under
     them (notes.js, slideView) — here, on a shared link, and on the class's
     page in a live lesson alike. */
  // `animate:` notes play a section at a time (notes.js, slideView): for a
  // student reading them, and for whoever is writing them, who gets Skip to
  // get past a part, or a slide, while they edit. Never while teaching live:
  // the projector shows the slide whole. Asked each time the notes are
  // shown, since going live and ending a lesson both change the answer.
  var notesSlides = window.PyIDENotes.slideView(notesBody, {
    animate: function () { return !window.PYIDE.readonly && !liveCode; },
    skip: function () { return !!window.PYIDE.authoring; },
    key: (window.PYIDE.authoring ? "author:" : "") + (window.PYIDE.assignmentSlug || location.pathname),
    // `locked: yes` holds the next slide until its checks pass — for a
    // student working, never the teacher writing them, nor while live.
    locked: function () { return !window.PYIDE.authoring && !window.PYIDE.readonly && !liveCode; }
  });

  function showNotes(name) {
    notesName.textContent = name;
    notesView.hidden = false;
    notesSlides.show(docs[name].getValue());
  }

  docs[MAIN] = editor.getDoc();

  function makeDoc(text) { return CodeMirror.Doc(text, null); }

  // The entry is already the editor's own document (the template puts its
  // text in the textarea). A web project's files include it; a second
  // document under the same name would take its place unseen by the editor.
  Object.keys(window.PYIDE.files || {}).sort().forEach(function (name) {
    if (name === MAIN) return;
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
    var rest = Object.keys(docs).filter(function (n) {
      return n !== MAIN && !hidden(n);
    }).sort();
    // In the runner's order when it has one: a Flask project's templates
    // come after its top-level files, and static/ last.
    return [MAIN].concat(R.tabOrder ? R.tabOrder(rest) : rest);
  }

  /* A .md tab is a view switch, not an editor swap: the notes render on the
     right and the editor keeps showing the last code file. While authoring,
     "Edit source" swaps the editor onto the markdown for a live preview. */
  var lastCodeFile = MAIN;
  var mdSourceOpen = false;

  var modeFor = R.modeFor;   // a tab's CodeMirror mode

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

    if (window.PyIDENotes.isMarkdown(name) && notesBeside()) {
      notesOpen = name;      // the editor and `active` stay on the code
      showNotes(name);
      renderTabs();
      relayout();
      return;
    }

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

  /* NOTES ARE A BUTTON, NOT A TAB, for anyone reading notes they did not
     write — a student on an assignment, a shared link. They never edit the
     .md, so a tab beside main.py read as another file to type in, and once
     they went back to the code nothing said where the instructions had gone.
     A button in the top bar, named for the file (instructions.md is
     "instructions"), shows them and stays there to show them again.

     Whoever owns the notes — the teacher on their assignment, a student in
     their own project — keeps the tab, because that is where Edit source is.

     EXCEPT WHILE TEACHING LIVE. The teacher's editor is on the projector
     then, and a class whose own page has the notes as a button was being
     shown them as a tab. So live, the teacher gets the button too; Edit
     source is still in the notes pane it opens. A function, not a flag,
     because going live and ending a lesson both change the answer. */
  function notesAsButtons() { return !window.PYIDE.authoring || !!liveCode; }
  var notesBar = $("notes-buttons");

  function renderNotesButtons() {
    if (!notesBar) return;
    notesBar.textContent = "";
    if (!notesAsButtons()) return;
    fileNames().filter(window.PyIDENotes.isMarkdown).forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn notes-btn";
      var on = !notesView.hidden && (notesBeside() ? notesOpen === name : name === active);
      b.setAttribute("aria-pressed", String(on));
      b.textContent = name.replace(/\.(md|markdown)$/i, "");
      b.title = on ? "Hide " + name : "Show " + name;
      b.addEventListener("click", function () {
        // A second press hides them.
        if (on) hideNotes();
        else switchTo(name);
      });
      notesBar.appendChild(b);
    });
  }

  function renderTabs() {
    tabsEl.textContent = "";
    renderNotesButtons();
    fileNames().filter(function (name) {
      return !(notesAsButtons() && window.PyIDENotes.isMarkdown(name));
    }).forEach(function (name) {
      var tab = document.createElement("button");
      tab.type = "button";
      // With the notes up from their button, the editor still holds the
      // code file, so that tab stays lit rather than none at all.
      var on = name === active || (notesAsButtons() && name === lastCodeFile
                                   && window.PyIDENotes.isMarkdown(active));
      tab.className = "tab" + (on ? " tab-on" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(on));

      var label = document.createElement("span");
      // A file in a folder (a Flask project's templates/index.html): the
      // folder in grey and the file in full, so a column of templates/...
      // doesn't read as one long smear of the same prefix.
      var cut = name.lastIndexOf("/");
      if (cut > 0) {
        var dir = document.createElement("span");
        dir.className = "tab-dir";
        dir.textContent = name.slice(0, cut + 1);
        label.appendChild(dir);
      }
      label.appendChild(document.createTextNode(name.slice(cut + 1)));
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
    // A file can change what kind of project this is (a query.sql makes a
    // Flask project a SQL one), so the runner hears of it.
    if (runner && runner.onFiles) runner.onFiles();
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
      editor.setOption("mode", modeFor(MAIN));
    }
    delete docs[name];
    runner.forget(name);
    if (runner.onFiles) runner.onFiles();
    renderTabs();
    relayout();
    if (account) account.noteEdit();
  }

  var newFileBtn = $("new-file");
  if (newFileBtn) {
    newFileBtn.addEventListener("click", function () {
      // The runner's words, which may depend on the project (a PHP site is
      // asked for pages, a Flask app for templates).
      var ask = typeof R.newFile === "function" ? R.newFile(fileNames()) : R.newFile;
      var name = (window.prompt(ask.question, ask.example) || "").trim();
      if (!name) return;
      if (!(R.nameOk ? R.nameOk(name) : NAME_OK.test(name))) {
        write("\n'" + name + "' won't work as a file name. Use letters, digits," +
              " dashes and underscores, ending in something like " +
              R.nameExample + ".\n", "err");
        return;
      }
      if (name.toLowerCase() === MAIN) { switchTo(MAIN); return; }
      var refused = R.refuseName(name);
      if (refused) { write("\n" + refused + "\n", "err"); return; }
      if (docs[name]) { switchTo(name); return; }

      var warning = runner.warnName(name);
      if (warning) write("\n" + warning + "\n", "dim");

      // A new web page starts as a page, linked to the stylesheet (the
      // runner's starterFor); anything else starts empty.
      addFile(name, R.starterFor ? R.starterFor(name, fileNames()) : "");
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

  /* PICTURES IN THE NOTES, for a teacher (pictures.js; the server refuses
     anyone else). Add picture opens the source first, so the teacher sees
     where it lands; paste and drop work only while the .md source is in the
     editor — the same CodeMirror holds main.py, and a picture dropped on
     code is left to the browser as it always was. */
  var notesPicBtn = $("notes-pic");
  if (notesPicBtn && notesEditBtn) {
    window.PyIDEPictures.attach(editor, function () {
      return mdSourceOpen && window.PyIDENotes.isMarkdown(active);
    });
    notesPicBtn.addEventListener("click", function () {
      if (!window.PyIDENotes.isMarkdown(active)) return;
      if (!mdSourceOpen) notesEditBtn.click();
      var doc = docs[active];
      window.PyIDEPictures.choose(function (files) {
        window.PyIDEPictures.insertInto(doc, files);
        editor.focus();
      });
    });
  }

  // live preview while the markdown source is open
  editor.on("change", function () {
    if (mdSourceOpen && window.PyIDENotes.isMarkdown(active)) {
      notesSlides.show(docs[active].getValue());
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


  /* What a runner keeps in the output pane besides what was printed — a
     Python program's input line — is put back by it after a Clear, or Clear
     deletes the thing a program is waiting for and it hangs on a keystroke
     that can never come. */
  var clearHooks = [];
  function clearOutput() {
    outputEl.textContent = "";
    clearHooks.forEach(function (f) { f(); });
  }


  $("clear").addEventListener("click", clearOutput);

  // ---------------------------------------------------------------- runner
  runner = R.attach({
    $: $,
    editor: editor,
    docs: docs,
    makeDoc: makeDoc,
    MAIN: MAIN,
    write: write,
    clearOutput: clearOutput,
    onClear: function (f) { clearHooks.push(f); },
    showOutput: showOutput,
    relayout: relayout,
    renderTabs: renderTabs,
    switchTo: switchTo,
    editingFile: editingFile,
    addFile: addFile,
    mainSource: mainSource,
    dataFiles: dataFiles,
    active: function () { return active; },
    lastCodeFile: function () { return lastCodeFile; },
    // A change the editor fires no event for (a world built, a Pi wired):
    // saving and the rescue are told here.
    noteEdit: function () {
      if (account) account.noteEdit();
      if (rescue) rescue.noteEdit();
    }
  });

  /* Check my work: the tests in the notes (autograde.js), run here on what
     is in the editor now, as often as the student likes, from the ✔ on each
     tests card in the notes (checks_in_notes.js). There is no button at the
     top any more: the cards show the results beside the step they're about,
     and the teacher wanted students checking there. It is feedback: the
     result is kept for the teacher to see, but what counts is the teacher's
     Check all on what was turned in — a check run in this browser could be
     faked. */
  async function runChecks() {
    var got = await runner.checks();
    if (got) keepSelfCheck(got);
    return got;
  }

  function keepSelfCheck(got) {
    if (!(window.PYIDE.signedIn && window.PYIDE.assignmentSlug && !window.PYIDE.viewOnly)) return;
    fetch("/api/tests/self", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: window.PYIDE.assignmentSlug, results: got.results })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // A little XP for each test passing for the first time (app.py, _self_tests_xp).
        if (d && d.xp > 0 && window.PyIDEXP) {
          window.PyIDEXP.toast("+" + d.xp + " XP · new tests passing");
        }
      })
      .catch(function () {});
  }
  // The notes' own ✔ Check my work, on each tests card.
  if (window.IDENotesChecks) window.IDENotesChecks.setRunner(runChecks);


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


  // ----------------------------------------------------- saving and turn-in
  /* Dormant unless somebody is signed in and this is a saved project. */
  /* The safety net for anyone not signed in. Attached before the account
     module, so a rescued project is in the editor before autosave has any
     opinion about what the project is. */
  var rescue = window.IDERescue.attach({
    // Kept per IDE, so work rescued from a web project can never be put
    // back into a Python one.
    app: window.PYIDE.ide || "pyide",
    cfg: {
      signedIn: window.PYIDE.signedIn,
      assignmentSlug: window.PYIDE.assignmentSlug,
      draftSlug: window.PYIDE.draftSlug,
      draftFresh: window.PYIDE.draftFresh
    },
    readAll: function () {
      var all = dataFiles();
      all[MAIN] = mainSource();
      return runner.forRescue(all);
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
      var p = runner.payload();
      p.title = $("title").value;
      return p;
    },
    say: write
  });

  // Every change to any file counts, including a data file or the notes
  editor.on("change", function (cm, change) {
    account.noteEdit();
    rescue.noteEdit();
    // Typed, pasted or dropped — not a starter or a rescue put in by the page.
    if (change.origin !== "setValue") typedHere = true;
  });

  /* THE LOGO GOES TO THE FRONT DOOR — a student's classes, a teacher's
     dashboard. A saved project has lost nothing by leaving: it autosaves,
     and pagehide sends whatever is pending (account.js). A project with
     nowhere to save to — the blank editor, before Save — is the one case
     where a click on the logo would throw typing away without a word, so
     that one asks. */
  var typedHere = false;
  // Update assignment (or Publish) saved what's here: nothing to lose now.
  // Without this the teacher's own edit page, which has no draft, warned
  // "isn't saved" right after a successful update.
  document.addEventListener("pyide:assignmentsaved", function () { typedHere = false; });
  var homeLink = $("home-link");
  if (homeLink) {
    homeLink.addEventListener("click", function (e) {
      if (window.PYIDE.readonly || window.PYIDE.draftSlug || !typedHere) return;
      if (!window.confirm("Leave this page? What you've typed here isn't saved.")) {
        e.preventDefault();
      }
    });
  }

  /* The handles between the panes (split.js), the same ones the class's live
     page has. The editor is told, because CodeMirror measures itself only
     on a window resize. */
  window.PyIDESplit.attachAll(document, {
    wide: window.matchMedia ? window.matchMedia("(min-width: 861px)") : null,
    onResize: function () { editor.refresh(); runner.onResize(); }
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
        body: JSON.stringify(Object.assign(runner.payload(), {
          title: $("title").value,
          author: $("author").value,
          hidden: !!hidden
        }))
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
  /* Download sits in the toolbar for a signed-out student and in the account
     menu for a signed-in one, so bind whichever is actually on the page. What
     it hands over is the runner's to decide (a game packs itself). */
  ["download", "download-menu", "download-share"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("click", function () { runner.download(); });
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runner.run();
    }
    if (e.key === "Escape") runner.escape();
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

    /* WHICH TAB IS ON THE AIR. A reload of the tab teaching must carry on
       broadcasting, so the lesson is remembered — but per TAB
       (sessionStorage), with the page it was on. It was remembered for the
       whole browser, so ANY editor the teacher opened while live — a new
       tab, the logo, New project, Student view — rejoined the lesson and
       sent the class its own file: the class watched an untitled default
       template while the teacher typed in another tab, and a Go live there
       then ended the real lesson under them. Now only that tab, on that
       page, picks the lesson back up. */
    var HOST_KEY = "pyide-live-host";
    try { localStorage.removeItem(HOST_KEY); } catch (e) { /* the old, shared marker */ }
    var rememberLive = function (code, slug) {
      try {
        sessionStorage.setItem(HOST_KEY, JSON.stringify({ code: code, path: location.pathname,
                                                          slug: slug || "" }));
      } catch (e) { /* storage blocked: a reload will need Go live again */ }
    };
    var forgetLive = function () {
      try {
        sessionStorage.removeItem(HOST_KEY);
        sessionStorage.removeItem(FILES_KEY);
      } catch (e) {}
    };

    /* WHAT WAS ON SCREEN, for a reload mid-lesson. Go live from the class
       page teaches on /new, the editor's blank page, and clears the lesson
       out of the address bar — so a reload there came back as the default
       template, resumed the broadcast, and sent that template to the class
       over the lesson's last code. The teacher's work was gone from the
       editor AND from the server, with nothing saying so. Now the tab keeps
       its files as it unloads (sessionStorage: this tab only, gone when it
       closes) and a reload puts them back before it goes back on the air.
       Written on pagehide rather than every push: data files can be
       megabytes, and a reload is the only thing this is for. */
    var FILES_KEY = "pyide-live-files";
    window.addEventListener("pagehide", function () {
      if (!liveCode) return;
      var all = dataFiles();
      all[MAIN] = mainSource();
      try {
        sessionStorage.setItem(FILES_KEY, JSON.stringify({
          code: liveCode, path: location.pathname, files: all, active: active,
          title: ($("title") && $("title").value) || ""
        }));
      } catch (e) {
        // Too big for storage: the reload falls back on the lesson's last file.
        try { sessionStorage.removeItem(FILES_KEY); } catch (e2) {}
      }
    });
    var keptFiles = function (code) {
      try {
        var kept = JSON.parse(sessionStorage.getItem(FILES_KEY) || "null");
        return kept && kept.code === code && kept.path === location.pathname
          && kept.files && typeof kept.files[MAIN] === "string" ? kept : null;
      } catch (e) { return null; }
    };
    var liveSlug = function () {
      try { return (JSON.parse(sessionStorage.getItem(HOST_KEY) || "null") || {}).slug || ""; }
      catch (e) { return ""; }
    };
    var liveToResume = function () {
      try {
        var saved = JSON.parse(sessionStorage.getItem(HOST_KEY) || "null");
        return saved && saved.path === location.pathname ? saved.code : null;
      } catch (e) { return null; }
    };
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
       Notes with `---` dividers are slides. The class is sent the WHOLE
       file and "3/5", the slide this teacher is on: every student can move
       through the slides on their own (notes.js, slideView), and each time
       the teacher moves, every screen jumps to the teacher's slide. Sending
       one slide at a time, as this did first, made reading ahead or going
       back to an earlier question impossible.

       `slideAt` is an index that survives editing the notes mid-lesson, and
       is clamped when slides are deleted out from under it. Two slides at
       least, or it is not slides: a file whose one `---` leaves only one
       slide with anything on it goes whole.

       There was a Show all button that sent the whole file as one page.
       With students free to move through the slides it had nothing left
       to do, and it went. */
    var slideAt = 0;
    var slideCtl = $("live-slides");
    var slideLabel = $("slide-at");

    function currentSlides() {
      var cut = window.PyIDENotes.slides(liveNotes());
      return cut.length >= 2 ? cut : null;
    }

    function paintSlides(cut) {
      if (!slideCtl) return;
      slideCtl.hidden = !(liveCode && cut);
      if (slideCtl.hidden) return;
      slideLabel.textContent = (slideAt + 1) + " / " + cut.length;
      $("slide-prev").disabled = slideAt <= 0;
      $("slide-next").disabled = slideAt >= cut.length - 1;
    }

    function moveSlide(by) {
      var cut = currentSlides();
      if (!liveCode || !cut) return;
      slideAt = Math.max(0, Math.min(cut.length - 1, slideAt + by));
      pushNow();                 // now, not on the next tick
    }

    if (slideCtl) {
      $("slide-prev").addEventListener("click", function () { moveSlide(-1); });
      $("slide-next").addEventListener("click", function () { moveSlide(1); });
    }

    /* The slide the class is on, shown here under the output — or the whole
       notes when they are not slides. Fed by pushNow from the very cut and
       `slide` it sends, so it cannot disagree with the class about which
       slide that is — a copy worked out separately from slideAt could.

       Re-rendered only when they change. pushNow runs on every tick, and
       rendering markdown that often would reset the scroll under the
       teacher's hand. */
    var classView = $("class-view");
    var classNotes = $("class-notes");
    var classShownNotes = null, classShownSlide = null;

    /* `theme` is the deck's (notes.js, takeTheme). One slide on its own no
       longer has the theme: line, which sits above the first slide, and
       rendered without it this pane showed the deck plain while the class
       saw it themed. Part of what is compared, so changing only the theme
       line redraws. */
    var classShownTheme = null;
    function paintClassView(notes, slide, theme) {
      if (!classView) return;
      if (notes === classShownNotes && slide === classShownSlide
          && theme === classShownTheme) return;
      classShownTheme = theme;
      var moved = slide !== classShownSlide;
      classShownNotes = notes;
      classShownSlide = slide;
      classView.hidden = !(notes && notes.trim());
      if (classView.hidden) return;
      window.PyIDENotes.render(classNotes, notes,
                                 slide ? { theme: theme } : undefined).then(function () {
        if (moved) classNotes.scrollTop = 0;
      });
    }

    // ------------------------------------------------ the laser pointer
    /* Hold Alt and point (static/laser.js has how, and why it is not a
       push). Over the code, the open file's line and character — not for a
       markdown file, which the class reads rendered, so its lines are
       nowhere on their screen. Over the notes here, the "Class sees" pane
       or the popped-out slides, a place on that slide: each says which
       slide it is showing, and a student on another one sees no dot. */
    function sendPointer(pointer, path) {
      if (!liveCode) return;
      fetch("/api/live/" + encodeURIComponent(liveCode) + "/point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointer: pointer, path: path || "", seq: nextSeq() })
      }).catch(function () {
        // A dropped one is fine: the next move, or the beat, sends it again.
      });
    }
    window.LiveLaser.teacher({
      active: function () { return !!liveCode; },
      send: sendPointer,
      surfaces: function () {
        var L = window.LiveLaser, list = [];
        if (!window.PyIDENotes.isMarkdown(active)) {
          list.push({ el: editor.getWrapperElement(),
                      point: function (x, y) { return L.pointAtCode(editor, x, y); } });
        }
        if (!notesView.hidden) {
          list.push({ el: notesBody,
                      point: function (x, y) { return L.pointAtSlide(notesBody, notesSlides.at(), x, y); } });
        }
        if (classView && !classView.hidden) {
          list.push({ el: classNotes,
                      point: function (x, y) {
                        return L.pointAtSlide(classNotes, currentSlides() ? slideAt : 0, x, y);
                      } });
        }
        return list;
      }
    });

    /* The tail of what the last Run printed. textContent, so an input()
       prompt waiting for the teacher's answer goes as the words of the
       prompt and nothing else. Trimmed here as well as on the server, to
       keep a print loop from sending 200 KB every 400ms to thirty polls. */
    var OUTPUT_CHARS = 16000;
    function liveOutput() {
      if (!runner.hasRun()) return "";
      var text = outputEl.textContent || "";
      return text.length > OUTPUT_CHARS ? text.slice(-OUTPUT_CHARS) : text;
    }

    function pushNow() {
      if (!liveCode) return;
      var name = active;
      var text = docs[name] ? docs[name].getValue() : mainSource();
      var notes = liveNotes();          // whole: students cut it themselves
      var slide = "";
      var onSlide = notes;              // what "Class sees" shows
      var cut = currentSlides();
      if (cut) {
        slideAt = Math.min(slideAt, cut.length - 1);
        onSlide = cut[slideAt];
        slide = (slideAt + 1) + "/" + cut.length;
        /* With the notes tab open, the mirror shows that file too — whole,
           which would put every slide on screen at once in a pane that has
           no arrows. It gets the teacher's slide. */
        if (name === notesFile()) text = onSlide;
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
      paintClassView(onSlide, slide, window.PyIDENotes.takeTheme(notes).name);
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
      renderTabs();          // live, the notes are a button (notesAsButtons)
      // Live, the notes show whole (no playing a part at a time); after, they play again.
      if (!notesView.hidden && notesName.textContent && docs[notesName.textContent]) {
        notesSlides.show(docs[notesName.textContent].getValue());
      }
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
      paintLive();
      forgetLive();
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
    function chooseAssignment(data) {
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
        runner.forget(name);
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

    function startLive(assignment, resume, reopen) {
      var name = active;
      var text = docs[name] ? docs[name].getValue() : mainSource();
      fetch("/api/live/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignment === undefined
          ? { body: text, filename: name, resume: resume || "",
              reopen: reopen || "",
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
            forgetLive();
            return;
          }
          liveCode = data.code;
          liveFor = data.assignment_title || "";
          lastVersion = data.version || 0;
          // Back on the slide the class is looking at, after a reload. A
          // fresh lesson has none and starts at the beginning.
          var at = /^(\d+)\//.exec(data.slide || "");
          slideAt = at ? Math.max(0, parseInt(at[1], 10) - 1) : 0;
          lastSent = null;
          rememberLive(liveCode, data.assignment);
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

    /* "Teach this lesson again", from the lesson's own link.

       THE LINK IS THE LESSON. A teacher who wants yesterday's lesson back
       opens the link the class already has, and its page (live.html, as
       the host) sends them here with ?teach=<code>. Go live used to offer
       "your last lesson" instead, which was whichever one happened to be
       most recent — not the one they meant — and it left the editor as it
       was, so the class's screens filled with whatever happened to be open.

       So this opens the project first: the assignment's starter, with the
       lesson's last file laid over its namesake so the teacher carries on
       from where the class saw them stop. Only then does it reopen the
       lesson, so the very first push is the lesson's own code. Arrived at
       from a link, on the editor's home page, which never keeps unsaved
       work — so replacing what is on screen costs nothing and is not asked.
       A reload never comes back here; see the address bar cleared below. */
    function teachAgain(code, slug, resuming) {
      function json(res) { return res.json(); }
      var starter = slug
        ? fetch("/api/live/assignment/" + encodeURIComponent(slug))
            .then(json).catch(function () { return null; })
        : Promise.resolve(null);
      var last = fetch("/api/live/" + encodeURIComponent(code) + "?v=-1")
        .then(json).catch(function () { return null; });
      Promise.all([starter, last]).then(function (got) {
        var s = got[0], l = got[1];
        if (s && !s.error) loadStarter(s.code, s.files);
        // The notes travel separately (see pushNow), so only code is laid
        // over: a lesson that ended on the notes tab leaves them as written.
        if (l && !l.error && l.body && l.filename
            && !/\.md$/i.test(l.filename)) {
          if (!docs[l.filename]) docs[l.filename] = makeDoc("");
          docs[l.filename].setValue(l.body);
          switchTo(l.filename);           // and so the first push sends it
        }
        if (resuming) startLive(undefined, code);
        else startLive(undefined, "", code);
      });
    }

    /* Back from a reload mid-lesson: the tab's own files if it kept them
       (see FILES_KEY), else the lesson rebuilt as Teach again builds it —
       which only /new needs, since any other page loaded its own project. */
    function resumeLive(code) {
      var kept = keptFiles(code);
      if (kept) {
        var files = {};
        Object.keys(kept.files).forEach(function (n) { if (n !== MAIN) files[n] = kept.files[n]; });
        loadStarter(kept.files[MAIN], files);
        if (kept.active && docs[kept.active]) switchTo(kept.active);
        if ($("title") && kept.title) $("title").value = kept.title;
        startLive(undefined, code);
      } else if (location.pathname === "/new") {
        teachAgain(code, liveSlug(), true);
      } else {
        startLive(undefined, code);
      }
    }

    liveBtn.addEventListener("click", function () {
      if (liveCode) {
        if (window.confirm("End the lesson? Your class stops seeing this editor.")) {
          stopLive(false);
        }
      } else {
        fetch("/api/live/assignments")
          .then(function (res) { return res.json(); })
          .catch(function () { return {}; })
          .then(function (data) {
            var slug = chooseAssignment(data);
            if (slug === null) return;      // they cancelled the chooser
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
    var teach = null, teachFor = "";
    try {
      var q = new URLSearchParams(location.search);
      teach = q.get("teach");
      teachFor = q.get("a") || "";
    } catch (e) { /* no URLSearchParams: an old browser, not a teacher's */ }

    if (teach) {
      // Off the address bar at once, so a reload resumes the broadcast the
      // ordinary way instead of loading the starter over the lesson again.
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
      teachAgain(teach, teachFor);
    } else {
      try {
        // Resuming after a reload: no assignment argument at all, so the
        // server keeps whatever the session already had. The code is sent so
        // the server can refuse anything but that same lesson — see
        // live_start.
        var resumeCode = liveToResume();
        if (resumeCode) resumeLive(resumeCode);
      } catch (e) { /* storage blocked: press Go live again */ }
    }

    // ------------------------------------------------- notes, popped out
    /* Pop out: the notes as big slides in a tab of their own
       (templates/notes_present.html, static/present.js), for the projector
       while this tab stays on the teacher's laptop.

       THIS TAB STAYS IN CHARGE. Everything the class is sent still goes
       out from pushNow here; the pop-out has no lesson code and never
       talks to the server. It asks this tab to move ("go"), and this tab
       tells it what to show ("state") — the notes, the slide, whether it
       is live. When live, a move there is a move of slideAt, the very one
       the ◀ ▶ under "Class sees" make, so the class follows exactly as if
       those had been pressed. When not live it moves this page's own
       notes, which is only presenting.

       A BroadcastChannel, named by an id made when the button is pressed,
       so two editors open on two lessons each drive only their own. Same
       browser only: it is a channel between tabs, which is also why the
       pop-out says so the moment this tab goes quiet (closed, reloaded,
       crashed) rather than freezing on a slide that looks live. */
    var popChan = null, popId = null, popSent = null;
    // This page's own notes viewer (the one the pop-out moves when not
    // live). A function, because FlaskIDE makes its viewer on first use.
    function popNotes() { return notesSlides; }

    function popState() {
      var cut = currentSlides();
      var live = !!(liveCode && cut);
      return { type: "state", notes: liveNotes(), live: !!liveCode,
               slide: live ? Math.min(slideAt, cut.length - 1)
                           : (popNotes() ? popNotes().at() : 0),
               title: ($("title") && $("title").value) || document.title };
    }

    /* Sent when anything in it changed. Checked twice a second rather than
       hooked into every way the notes or the slide can change (typing in
       the .md, either set of arrows, a push, Teach again): a hook missed
       would be a projector quietly showing the wrong slide. */
    function tellPopout(force) {
      if (!popChan) return;
      var state = popState();
      var stamp = JSON.stringify(state);
      if (!force && stamp === popSent) return;
      popSent = stamp;
      popChan.postMessage(state);
    }

    function popoutGo(i) {
      var cut = currentSlides();
      if (liveCode && cut) {
        slideAt = Math.max(0, Math.min(cut.length - 1, i));
        pushNow();                     // the class moves now, not next tick
      } else if (popNotes()) {
        popNotes().go(i);
      }
      tellPopout(true);
    }

    function openPopout() {
      if (!popChan) {
        popId = Math.random().toString(36).slice(2, 10);
        popChan = new BroadcastChannel("pyide-notes-" + popId);
        popChan.onmessage = function (e) {
          var d = e.data || {};
          if (d.type === "go" && typeof d.slide === "number") popoutGo(d.slide);
          // The laser, pointed in the pop-out: sent from here, like all else.
          else if (d.type === "point" && typeof d.pointer === "string") sendPointer(d.pointer, d.path);
          else if (d.type === "hello") tellPopout(true);
        };
        setInterval(function () { tellPopout(false); }, 500);
        window.addEventListener("pagehide", function () {
          popChan.postMessage({ type: "bye" });
        });
      }
      // The same name each time, so pressing it again brings that tab
      // forward instead of opening another.
      window.open("/notes/present?ch=" + popId, "pyide-notes-" + popId);
    }

    // No BroadcastChannel (Safari before 15.4): no button, rather than a
    // pop-out that would never hear from this tab. The click is listened
    // for on the document, so a button that is not on the page yet when
    // this runs still works when it is.
    function hidePopoutButtons() {
      if ("BroadcastChannel" in window) return;
      document.querySelectorAll(".js-popout").forEach(function (b) { b.hidden = true; });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", hidePopoutButtons);
    } else {
      hidePopoutButtons();
    }
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest(".js-popout");
      if (b && "BroadcastChannel" in window) openPopout();
    });

    // ---------------------------------------------------- answers, counted
    /* While live, each question card in the teacher's notes and in "Class
       sees" shows how many of the students here have answered it: "18 / 22
       answered". The server counts (/api/live/<code>/answers, which says
       what "here" means); this asks every few seconds while there is a
       question in the notes, and puts the count on the card for it.

       The teacher's cards are their own copy, answer key and all, with no
       question id in them, so a card is found by its prompt — with the
       blanks emptied, as the class's copy has them.

       The cards are rebuilt whenever the notes are drawn again (a keystroke
       in the .md, the class moving on), which takes the count off them. A
       MutationObserver puts it back from the last answer at once rather
       than at the next ask. paintCounts only writes what differs, or the
       observer would see its own writes and never stop. */
    var counts = null;
    var ANSWERS_MS = 3000;
    // Where the cards are. A function, because FlaskIDE's notes pane is
    // made after this runs.
    function countRoots() { return [classNotes, notesBody]; }

    function samePrompt(t) { return String(t || "").replace(/\[\[[^\[\]\n]*\]\]/g, "[[]]").trim(); }

    function countText(hit) {
      if (!hit) return "";
      return counts.here === null || counts.here === undefined
        ? hit.answered + " answered"
        : hit.answered + " / " + counts.here + " answered";
    }

    function paintCounts() {
      countRoots().forEach(function (root) {
        if (!root) return;
        root.querySelectorAll(".quiz").forEach(function (box) {
          var hit = null;
          if (counts && box.quizPrompt !== undefined) {
            var want = samePrompt(box.quizPrompt);
            hit = counts.questions.filter(function (q) { return q.prompt === want; })[0] || null;
          }
          var badge = box.querySelector(".quiz-count");
          if (!hit) {
            if (badge) badge.remove();
            return;
          }
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "quiz-count";
            var head = box.querySelector(".quiz-head");
            (head || box).appendChild(badge);
          }
          var text = countText(hit);
          if (badge.textContent !== text) badge.textContent = text;
          var all = counts.here > 0 && hit.answered >= counts.here;
          if (badge.classList.contains("all-in") !== all) badge.classList.toggle("all-in", all);
        });
      });
    }

    function askCounts() {
      watchCards();
      // Nothing to count: not live, or no question in the notes.
      if (!liveCode || !/^ {0,3}(`{3,}|~{3,})\s*quiz\s*$/m.test(liveNotes())) {
        if (counts) { counts = null; paintCounts(); }
        return;
      }
      fetch("/api/live/" + encodeURIComponent(liveCode) + "/answers")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.questions) { counts = d; paintCounts(); }
        })
        .catch(function () { /* the next ask will do */ });
    }
    var recount = "MutationObserver" in window
      ? new MutationObserver(function () { if (counts) paintCounts(); }) : null;
    var watched = [];
    function watchCards() {
      if (!recount) return;
      countRoots().forEach(function (root) {
        if (!root || watched.indexOf(root) >= 0) return;
        watched.push(root);
        recount.observe(root, { childList: true, subtree: true });
      });
    }
    watchCards();
    setInterval(askCounts, ANSWERS_MS);
  } else {
    /* No Go live button: signed out, or not a teacher. Whatever lesson this
       browser remembers is not one this person can resume, so forget it
       here rather than let it wait for the next teacher to sign in. */
    try {
      sessionStorage.removeItem("pyide-live-host");
      sessionStorage.removeItem("pyide-live-files");
      localStorage.removeItem("pyide-live-host");      // the old, shared marker
    } catch (e) {}
  }
})();
