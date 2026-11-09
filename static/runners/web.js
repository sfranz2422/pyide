/* PyIDE — the web runner: what Run means for an HTML/CSS/JS project.
 *
 * WebIDE's preview, moved here when WebIDE moved into PyIDE (Nov 2026; see
 * runners/python.js for why the editor has runners at all). The code below
 * is WebIDE's app.js, copied unchanged apart from reaching the shell through
 * `ctx`, and its globals: the page config is window.PYIDE here, the notes are
 * PyIDENotes and the zip is PyIDEZip — the same files under PyIDE's names.
 * WebIDE's own runner.js, autograde.js and complete.js came with it, under
 * static/web/, keeping their globals.
 *
 * Run assembles the files into one document (web/runner.js) and puts it in
 * a sandboxed iframe, which reports back by postMessage: console lines,
 * errors, a link to another page, a form. Stop throws the frame away.
 */
(function () {
  "use strict";

  var ENTRY = "index.html";

  function modeFor(name) {
    if (/\.html?$/i.test(name)) return "htmlmixed";
    if (/\.css$/i.test(name)) return "css";
    if (/\.m?js$/i.test(name)) return "javascript";
    if (/\.json$/i.test(name)) return { name: "javascript", json: true };
    return null;                                  // plain text
  }


  /* A new page starts as a real page rather than an empty file. A blank .html
     is a poor place for a beginner to land — they need the doctype and head
     they were given on day one, and the stylesheet link is the thing most
     often forgotten on a second page, so the new page looks unstyled and the
     student concludes their CSS is broken. The link home comes with it,
     because that is the whole point of adding a second page.

     No <script src="script.js"> though, deliberately. Shared JavaScript
     usually reaches for elements that only exist on the page it was written
     for — the starter script.js grabs #cheer, which lives on index.html — so
     including it here would greet every new page with a null reference on
     line 3. The comment says how to add it for anyone who wants it. */
  function starterFor(name) {
    if (!/\.html?$/i.test(name)) return "";
    var title = name.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '  <meta charset="utf-8">\n' +
      '  <title>' + title + '</title>\n' +
      '  <link rel="stylesheet" href="style.css">\n' +
      '</head>\n' +
      '<body>\n' +
      '  <h1>' + title + '</h1>\n' +
      '  <p><a href="' + ENTRY + '">Back to home</a></p>\n' +
      '\n' +
      '  <!-- This page has no JavaScript yet. To give it some, add:\n' +
      '       <script src="script.js"><' + '/script> -->\n' +
      '</body>\n' +
      '</html>\n';
  }

  window.IDERunners = window.IDERunners || {};
  window.IDERunners.webide = {
    entry: ENTRY,
    editorOptions: {
      mode: "htmlmixed",
      indentUnit: 2,
      tabSize: 2,
      /* Close every tag on the line it was opened on.
         The addon otherwise carries a list of "block" tags — h1 to h6, div, p,
         ul, table and a dozen more — that it expands across three lines with the
         cursor on a blank one in the middle. That is a reasonable habit for
         someone writing a page section, and a bad surprise for a beginner typing
         <h1>Hello</h1>, who watches their heading and its closing tag fly apart.
         An empty list is still a list, so the addon uses it and indents nothing;
         leaving dontCloseTags unset keeps <br> and <img> closing themselves. */
      autoCloseTags: { indentTags: [] }
    },
    modeFor: modeFor,
    hidden: function () { return false; },          // every file is a tab
    newFile: { question: "Name for the new file, with an extension:", example: "about.html" },
    nameExample: ".html, .css or .js",
    refuseName: function () { return ""; },
    starterFor: starterFor,
    attach: attach
  };

  function attach(ctx) {
    var $ = ctx.$;
    var editor = ctx.editor;
    var write = ctx.write;
    var clearOutput = ctx.clearOutput;
    var showPreview = ctx.showOutput;     // the preview is the right pane's view
    var relayout = ctx.relayout;
    var switchTo = ctx.switchTo;
    var editingFile = ctx.editingFile;
    var outputEl = $("output");
    var stopBtn = $("stop");
    var runBtn = $("run");
    var frame = $("preview");

    // Every file, index.html included: a web project is nothing but files.
    function allFiles() {
      var out = ctx.dataFiles();
      out[ENTRY] = ctx.mainSource();
      return out;
    }

    /* ------------------------------------------------ the page in a new tab
     *
     * The files go to /play through this browser's storage, not the server:
     * nothing is saved or shared by it, and a signed-out student can use it
     * as freely as Run. /play is the demo page's player (demo.js), which reads
     * them from there and shows the page at once.
     *
     * One named tab, reused: pressing it again after an edit reloads that tab
     * with the new files instead of opening another one per press. */
    function runInNewTab() {
      try {
        localStorage.setItem("webide-play", JSON.stringify({
          files: allFiles(),
          title: ($("title") && $("title").value) || "Page"
        }));
      } catch (e) {
        window.alert("This browser is blocking site storage, so the page "
                     + "cannot be handed to a new tab. Use the preview here instead.");
        return;
      }
      // ?ide=webide: /play is the Python player unless told otherwise.
      window.open("/play?ide=webide", "webide-play");
    }

    if ($("run-tab")) $("run-tab").addEventListener("click", runInNewTab);

    // ------------------------------------------------------------------- run
    var token = null;        // identifies messages from the current preview
    var offsets = {};        // maps document lines back to the student's files
    var running = false;
    var backBar = $("preview-trail");
    var backBtn = $("preview-back");
    var pageLabel = $("preview-page");

    function setBusy(state) {
      running = state;
      stopBtn.hidden = !state;
    }

    /* Throw the old preview away and put a clean one in its place.
       Replacing the element rather than reassigning srcdoc matters: a student's
       `while (true)` wedges that frame's process, and a wedged frame can't
       navigate itself. Removing the element kills it outright, which is why
       Stop still works during an infinite loop. The editor stays responsive
       throughout because the null-origin frame runs in its own process. */
    /* `modals`: alert(), prompt() and confirm() only show in a frame made by
       Run. Without allow-modals the browser ignores them (prompt() gives back
       null), so Web Design 1's alert()/prompt() lessons did nothing at all.
       But the preview also redraws on every pause in typing, and a prompt()
       popping up each time a student stopped to think would make the page
       impossible to edit — so auto-refresh never gets them. */
    function freshFrame(modals) {
      var old = frame;
      var next = document.createElement("iframe");
      next.id = "preview";
      next.title = "Page preview";
      next.setAttribute("sandbox", "allow-scripts allow-forms" + (modals ? " allow-modals" : ""));
      old.parentNode.replaceChild(next, old);
      frame = next;
      return next;
    }

    /* Which of the student's pages the preview is showing, and how it got
       there. A project is usually one page and this stays empty; a site with a
       nav bar walks through it. */
    var page = ENTRY;
    var trail = [];

    /* Render one page. `sent` carries what a form on the previous page
       submitted, so the page it lands on can say something about it. */
    function render(name, sent, modals) {
      var files = allFiles();
      lastBuilt = "";
      if (!files[ENTRY]) {
        write("\nThere's no " + ENTRY + " to open.\n", "err");
        return;
      }
      if (files[name] === undefined) name = ENTRY;
      page = name;

      /* Not over the notes. The page draws itself on load and again on every
         pause in typing, and switching the pane each time hid the notes a
         student was reading — on load the editor opened on the notes and this
         covered them at once, with their tab (now their button) still lit.
         The page still builds underneath; Run is what brings it into view. */
      if (!window.PyIDENotes.isMarkdown(ctx.active())) showPreview();
      clearOutput();

      token = "w" + Date.now() + Math.random().toString(36).slice(2, 8);
      var built = window.WebIDERun.assemble(files, token, page, sent);
      offsets = built.offsets;
      lastBuilt = built.html;

      lastRun = signature(files);
      // Running again is how a student says "carry on" after a Stop.
      autoPaused = false;

      setBusy(true);
      freshFrame(modals).srcdoc = built.html;
      paintTrail();
      relayout();
    }

    /* Run always goes home. A student who has clicked three pages deep and
       wants a clean start shouldn't have to find their way back first — and
       "Run shows me my homepage" is one less rule to remember. Auto-refresh is
       the opposite: it updates whatever is on screen, because being thrown back
       to the homepage every time you edit your About page would be unusable. */
    /* What a live lesson shows the class of this page. `lastBuilt` is every
       render — auto-refresh and clicking through pages included — and
       `sharedPage` is only what Run made. The class is sent the second: the
       preview re-renders on every pause in typing, and each of those pulling
       thirty students' panes over to a half-typed page would be a lesson
       nobody could follow. Pressing Run is the teacher saying "look".

       `hasRun` likewise: until Run is pressed, the console holds only "Page
       loaded" and nothing is sent at all. That is also why the page's own
       first paint, below, is a render and not a run. */
    var lastBuilt = "";
    var sharedPage = "";
    var hasRun = false;

    function run() {
      // Run shows the page, so with the notes up it goes back to the code —
      // through switchTo, which lights the right tab and button as it goes.
      if (window.PyIDENotes.isMarkdown(ctx.active())) switchTo(ctx.lastCodeFile());
      trail = [];
      render(ENTRY, undefined, true);
      sharedPage = lastBuilt;
      hasRun = true;
      xpWatch = { token: token, failed: false };
    }

    /* XP for a page that worked (xp.js). A page has no "finished": it counts
       when Run is pressed — not the redraw on every pause in typing — the page
       loads, and no error comes back from it in the next moment and a half.
       The server decides whether it pays; this only says it worked. */
    var xpWatch = null;
    var XP_CODE = /\.(html?|css|js)$/i;
    function xpLoaded() {
      var w = xpWatch;
      if (!w || w.token !== token) return;
      setTimeout(function () {
        if (xpWatch === w && !w.failed && token === w.token) reportRun();
        if (xpWatch === w) xpWatch = null;
      }, 1500);
    }
    function reportRun() {
      if (!window.PYIDE.signedIn || window.PYIDE.viewOnly || window.PYIDE.readonly ||
          window.PYIDE.isTeacher || !window.PyIDEXP) return;
      window.PyIDEXP.ran(allFiles(), XP_CODE);
    }

    /* Follow a link or a form's action to another of the student's pages. */
    function goToPage(name, sent) {
      if (name !== page) trail.push(page);
      render(name, sent, true);     // a click in the page: the student's own doing
    }

    function goBack() {
      if (!trail.length) return;
      render(trail.pop(), undefined, true);
    }

    function paintTrail() {
      if (!backBar) return;
      var away = page !== ENTRY || trail.length > 0;
      backBar.hidden = !away;
      if (away) pageLabel.textContent = page;
      backBtn.disabled = trail.length === 0;
    }

    function stop() {
      freshFrame();          // tears down timers, listeners, sound and any loop
      token = null;
      setBusy(false);
      /* Stop has to mean stop. Without this the next keystroke would start the
         program up again a moment later, which reads as a broken button —
         especially for the runaway loop Stop exists to deal with. */
      autoPaused = true;
      write("\n— stopped —\n", "dim");
    }

    runBtn.addEventListener("click", run);
    stopBtn.addEventListener("click", stop);

    /* Check my work: the tests in the notes (web/autograde.js), run here on
       the page as it is in the editor now, in a frame of its own. The shell
       keeps the result for the teacher (app.js, keepSelfCheck) and the notes'
       tests cards show it. Null when it can't run now. */
    var checking = false;

    function testsHere() {
      return window.WebIDETests ? window.WebIDETests.fromFiles(allFiles()).tests : [];
    }

    async function runChecks() {
      if (checking) return null;
      var files = allFiles(), tests = testsHere();
      if (!tests.length) return null;
      checking = true;
      try {
        return await window.WebIDETests.run(files, tests);
      } finally {
        checking = false;
      }
    }

    if (backBtn) backBtn.addEventListener("click", goBack);

    /* A link to another site, opened on the preview's behalf.
       The preview can't do this itself — no allow-popups in its sandbox, on
       purpose — so it asks, and the tab is opened from here. The click that
       started it also gives this window transient activation, which is what
       keeps the browser from treating the new tab as an unprompted pop-up.

       The URL arrives from student content, so it is checked again here rather
       than trusted: only http and https, whatever the frame claimed to send. */
    function openExternal(url) {
      if (!/^https?:\/\//i.test(url)) {
        write("\nThat link didn't point at a web address, so nothing opened: "
              + url + "\n", "dim");
        return;
      }
      var opened = null;
      try {
        opened = window.open(url, "_blank");
        // the opened page must not be able to reach back into the editor
        if (opened) { try { opened.opener = null; } catch (e) {} }
      } catch (e) { /* blocked; handled below */ }

      if (opened) {
        write("\nOpened in a new tab: " + url + "\n", "dim");
      } else {
        write("\nYour browser blocked a new tab for " + url +
              "\nAllow pop-ups for this site, or copy the address above.\n", "dim");
      }
    }

    /* What the preview reports when a form is submitted and the student hasn't
       written a handler for it. There is no server to post to, so the next best
       thing is showing them exactly what their form produced — which is the
       part of a form that's worth looking at anyway. */
    function reportForm(data) {
      var fields = data.fields || [];
      var sent = {};
      fields.forEach(function (pair) { sent[pair[0]] = pair[1]; });

      /* Move first, then report: rendering a page clears the console, so a
         summary written before the navigation would be wiped by it. */
      if (data.action) goToPage(data.action, sent);

      if (!fields.length) {
        write("\nForm submitted, but no field had a name attribute — that is "
              + "what a form sends, so give each input a name and the values "
              + "will show up here.\n", "dim");
      } else {
        write("\nForm submitted (" + (data.method || "get") + "):\n", "dim");
        fields.forEach(function (pair) {
          write("   " + pair[0] + " = " + pair[1] + "\n");
        });
      }

      if (!data.action) {
        write("It didn't go anywhere: sending a form somewhere real needs a "
              + "server. Point the form's action at another page in this "
              + "project to move there.\n", "dim");
      }
    }

    // ---------------------------------------------------------- auto refresh
    /* The preview follows the typing, so changing a colour doesn't need a trip
       to the toolbar. Pressing Run stays useful — for restarting a page on
       purpose — but nobody has to press it to see their own edit.
       A pause rather than a keystroke: re-rendering on every character would
       spend most of its time showing half-typed tags and unfinished selectors.
       700ms is long enough for a tag to be finished and short enough to still
       feel like a consequence of what was typed. */
    var AUTO_DELAY = 700;
    var autoTimer = null;
    var autoPaused = false;   // set by Stop, cleared by Run
    var lastRun = null;       // what was on screen last, so a no-op edit is free
    var autoBox = $("auto-run");

    function signature(files) {
      return JSON.stringify(files);
    }

    function autoKey() {
      return "webide-autorun";
    }

    /* Held in memory as well as in storage. A browser with site data blocked
       would otherwise revert the box on the next keystroke, because paintAuto
       re-reads the answer and would find nothing saved. */
    var autoChoice = {};

    function autoWanted() {
      var key = autoKey();
      if (key in autoChoice) return autoChoice[key];
      try {
        var saved = localStorage.getItem(key);
        if (saved === "on" || saved === "off") {
          autoChoice[key] = saved === "on";
          return autoChoice[key];
        }
      } catch (e) { /* storage blocked; fall through to the default */ }
      return true;
    }

    function paintAuto() {
      if (!autoBox) return;
      autoBox.checked = autoWanted();
      autoBox.parentNode.title =
        "Update the preview when you stop typing, without pressing Run.";
    }

    function scheduleAuto() {
      clearTimeout(autoTimer);
      if (!autoBox || !autoBox.checked || autoPaused) return;
      if (window.PYIDE.readonly) return;
      /* Editing the assignment notes changes nothing the preview shows — but
         ask what the editor holds, not which tab is lit. A fork opens on its
         notes tab while the editor is on index.html, and asking `active` here
         meant auto-refresh never fired for anyone working from an assignment. */
      if (window.PyIDENotes.isMarkdown(editingFile())) return;

      autoTimer = setTimeout(function () {
        if (!autoBox.checked || autoPaused) return;
        var files = allFiles();
        // typed and then undone, or a change in a file the page doesn't use
        if (signature(files) === lastRun) return;
        /* render, not run: a student editing about.html should see about.html
           update, not be thrown back to the homepage on every pause. */
        render(page);
      }, AUTO_DELAY);
    }

    if (autoBox) {
      paintAuto();
      autoBox.addEventListener("change", function () {
        var key = autoKey();
        autoChoice[key] = autoBox.checked;
        try {
          localStorage.setItem(key, autoBox.checked ? "on" : "off");
        } catch (e) { /* blocked; the choice lasts for this page only */ }
        if (autoBox.checked) scheduleAuto();
        else clearTimeout(autoTimer);
      });
    }

    window.addEventListener("message", function (e) {
      var data = e.data;
      if (!data || typeof data !== "object" || !token || data.webide !== token) return;
      // only the live preview may write to the console
      if (e.source !== frame.contentWindow) return;

      if (data.kind === "error" && xpWatch) xpWatch.failed = true;
      if (data.kind === "ready") {
        setBusy(false);
        if (!outputEl.textContent.trim()) {
          write("Page loaded. console.log messages appear here.\n", "dim");
        }
        xpLoaded();
        return;
      }

      /* A link to another of the student's pages. The preview can't navigate
         there itself — it has no address — so it asks, and we rebuild. */
      if (data.kind === "nav") {
        goToPage(String(data.text));
        return;
      }
      if (data.kind === "form") {
        reportForm(data);
        return;
      }
      if (data.kind === "open") {
        openExternal(String(data.text));
        return;
      }
      if (data.kind === "note") {
        write(String(data.text) + "\n", "dim");
        return;
      }

      var where = window.WebIDERun.locate(data.file, data.line, offsets);
      var cls = data.kind === "error" ? "err" : (data.kind === "warn" ? "warn" : "");
      write(String(data.text) + (where ? "   (" + where + ")" : "") + "\n", cls);
    });

    // ---------------------------------------------------------- completion
    var hintTimer = null;
    editor.on("change", function (cm, change) {
      if (window.PYIDE.readonly) return;

      // the file being typed into, which is not the lit tab when notes are shown;
      // markdown is prose, with no names to complete (the shell keeps the
      // rendered notes in step while their source is open)
      var file = editingFile();
      if (window.PyIDENotes.isMarkdown(file)) return;

      var typed = change.origin === "+input" && change.text.join("");
      if (typed && /^[A-Za-z0-9_-]$/.test(typed)) {
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function () {
          if (!cm.state.completionActive) {
            window.WebIDEComplete.show(cm, file, allFiles());
          }
        }, 140);
      }
    });

    // The preview follows the typing (auto refresh, above). Saving and the
    // rescue are told by the shell's own change handler.
    editor.on("change", function () {
      paintAuto();
      scheduleAuto();
    });

    // -------------------------------------------------------------- download
    /* The whole project as a zip, so a student can unzip it, double-click
       index.html and have it run with no internet. That works because the files
       keep real relative links rather than being inlined, so
       <link href="style.css"> resolves against the folder just as it resolved
       against this server in the preview. */
    function projectFileName() {
      var base = ($("title").value || "project")
        .replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase();
      return (base || "project") + ".zip";
    }

    function download() {
      var files = allFiles();
      var entries = Object.keys(files).sort().map(function (name) {
        return { name: name, data: files[name] };
      });
      try {
        window.PyIDEZip.download(projectFileName(), entries);
      } catch (e) {
        write("\nCould not build the download: " + e.message + "\n", "err");
      }
    }

    // show something straight away rather than an empty white rectangle —
    // render, not run: nobody has pressed Run yet (see sharedPage)
    render(ENTRY);

    return {
      run: run,
      stop: stop,
      escape: function () {},              // Stop is the button; Escape is the page's
      isRunning: function () { return running; },
      hasRun: function () { return hasRun; },
      // What a live lesson shows the class: what Run made (sharedPage, above)
      // — never every redraw as the teacher types.
      livePage: function () { return sharedPage; },
    // What a live lesson shows the class: what Run made (sharedPage, above)
    // — never every redraw as the teacher types.
    livePage: function () { return sharedPage; },
      checks: runChecks,
      // Everything in files, `code` empty: how WebIDE always stored a project,
      // and what the server keeps for one (read_project in app.py). `ide` makes
      // a new project — Save, Publish, Share — a web one.
      payload: function () { return { ide: "webide", code: "", files: allFiles() }; },
      forRescue: function (all) { return all; },
      forget: function () {},
      warnName: function () { return ""; },
      download: download,
      onResize: function () {}             // the iframe follows its pane by itself
    };
  }
})();
