/* Check my work, in the notes — the same file in PyIDE, WebIDE and FlaskIDE.
 *
 * A ```tests block in the notes is drawn as a card (autograde.js's
 * renderBlocks hands its tests here): each test a line, ○ until it's
 * checked, then ✓ or ✗ with why. Where the page can check code — the
 * student's editor, the class's page in a live lesson — the card has its own
 * ✔ Check my work, and the results land in the card, next to the step they
 * are about, without opening the console. That's how GameIDE's Notes tab
 * does it, and students no longer go looking for their results.
 * It is the only Check my work there is: the button at the top of the
 * editor and the class's page came out, so students check beside the step.
 *
 * Elsewhere (a lesson's page, a class page's preview) there is no runner, so
 * the card is the list of what will be checked, as it always was.
 *
 * The page registers its runner with setRunner(fn): fn() runs every test in
 * the notes and resolves {results: [{label, ok, detail}]} (or null when it
 * couldn't). Every test is run, not just one card's — the result kept for
 * the teacher is the whole check, as before — and each card shows its own
 * lines from it, by label: a test's label is the test, so two cards with
 * the same line show the same answer.
 *
 * A card whose every line passed has data-passed; after each check every
 * card sends an "ide-checks" event (it bubbles) — notes.js's slideView
 * listens for it, to open the next slide when the notes say `locked: yes`.
 *
 * A QUIZ (`quiz: yes` in the notes' header; notes.js calls setQuiz) never tells a student how a check went (the teacher, Nov
 * 2026: "i don't want them to know if they pass the code tests"): the
 * check runs and is kept for the teacher exactly as before, and the card
 * says only that it was checked — no ✓ or ✗, no reasons, no "3 of 5", and
 * no data-passed, so nothing reading that (the lock, the editor bubble, the
 * live lesson's step count) can give it away either. data-checked says the
 * card's own check was pressed, whatever it found. Pages where the teacher is the one looking
 * (authoring, teaching live) say so with reveal(fn), and see everything.
 */
window.IDENotesChecks = window.IDENotesChecks || (function () {
  "use strict";

  var runner = null;      // the page's: () => Promise<{results}>, or null
  var tryRunner = null;   // the page's: (code, tests) => Promise<{results}>, for a Try It box
  var tryShow = null;     // the page's: (code, tests, out) => draws what the box's code makes (a web page, a table)
  var latest = null;      // label -> {ok, detail}, from the last check
  var pressed = null;     // the card whose ✔ ran the last check (hints.js)
  var busy = false;
  var revealFn = null;    // the page's: () => true where the teacher is looking
  var quizNotes = false;  // notes.js: the notes on this page say `quiz: yes`

  /* Is this card's result kept from whoever's looking? In a quiz's notes
     (notes.js says so with setQuiz as it shows them), unless the page says
     it's the teacher's. Told, not read off the page: a card is drawn — with
     the last check's marks — before it's put into the slide, so going back
     to a slide after a check would show them. */
  function hiding() {
    return quizNotes && !(revealFn && revealFn());
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* The card for one block's tests: [{label, points}], under `heading`
     (each app says what is checked: your code, your page). */
  function card(tests, heading, part) {
    var box = el("div", "tests-card" + (part === "bonus" ? " tests-bonus" : ""));
    box.setAttribute("data-checks", "");
    // A challenge's bonus check (```tests bonus, v11): optional, so it never
    // holds a slide (notes.js's HOLDS skips it) and never shows a ✗ to a
    // student who hasn't tried it — Check my work runs every test at once,
    // so without that everyone who skipped it would see a row of crosses.
    if (part === "bonus") box.setAttribute("data-bonus", "");
    // A Try It step's card (tryStep): checks its own box, keeps its own results.
    if (part === "try") { box.setAttribute("data-try", ""); box._tests = tests; }
    var head = el("div", "tests-head", heading || "✔ Tests your code will be checked against");
    box.appendChild(head);
    var list = el("ul", "tests-lines");
    tests.forEach(function (t) {
      var li = el("li", "test-line");
      li.setAttribute("data-label", t.label);
      li.appendChild(el("span", "tests-mark", "○"));
      var words = el("span", "tests-text");
      words.appendChild(el("span", "tests-label", t.label));
      if (t.points !== 1) words.appendChild(el("span", "dim small", "  (" + t.points + " points)"));
      words.appendChild(el("span", "tests-why"));
      li.appendChild(words);
      list.appendChild(li);
    });
    box.appendChild(list);
    var foot = el("div", "tests-foot");
    var btn = el("button", "btn btn-check tests-run", "✔ Check my work");
    btn.type = "button";
    btn.addEventListener("click", function () { check(box); });
    foot.appendChild(btn);
    foot.appendChild(el("span", "tests-sum dim small"));
    box.appendChild(foot);
    // notes.js shows this while the slide is locked (`locked: yes`).
    box.appendChild(el("p", "tests-lock small", "🔒 Pass every check here to go on to the next slide."));
    paint(box);
    return box;
  }

  /* One card, from the latest results: its lines, its button, its total. */
  /* A Try It card's results are its own (its box's code, not main.py's):
     "Uses +" on a Try It step and on the exercise are different checks. */
  function resultsFor(box) {
    return box && box.hasAttribute && box.hasAttribute("data-try") ? (box._tryResults || null) : latest;
  }

  function paint(box) {
    var latest = resultsFor(box), isTry = box.hasAttribute("data-try");
    var lines = box.querySelectorAll(".test-line"), passing = 0, checked = 0;
    var hide = hiding(), bonus = box.hasAttribute("data-bonus");
    // Not tried yet: nothing on a bonus card passes. Its ✗s would only say
    // "you didn't do the optional part".
    var untried = bonus && !Array.prototype.some.call(lines, function (li) {
      var r = latest && latest[li.getAttribute("data-label")];
      return r && r.ok;
    });
    Array.prototype.forEach.call(lines, function (li) {
      var r = latest && latest[li.getAttribute("data-label")];
      if (r) checked++;
      if (r && r.ok) passing++;
      if (hide || untried) r = null;
      li.classList.toggle("pass", !!(r && r.ok));
      li.classList.toggle("fail", !!(r && !r.ok));
      li.querySelector(".tests-mark").textContent = busy ? "…" : r ? (r.ok ? "✓" : "✗") : "○";
      li.querySelector(".tests-why").textContent = r && !r.ok && r.detail ? r.detail : "";
    });
    var btn = box.querySelector(".tests-run");
    var can = isTry ? !!tryRunner : !!runner;
    btn.hidden = !can;
    btn.disabled = busy;
    btn.textContent = busy ? "Checking…" : "✔ Check my work";
    box.querySelector(".tests-sum").textContent = !can ? "" : busy ? "" :
      hide ? (box.hasAttribute("data-checked") ? "Checked — your teacher will see how it went." : "")
      : untried ? "Optional: a bonus point if it all passes, nothing lost if you skip it."
      : checked ? passing + " of " + lines.length + " passing" : lines.length + " to pass";
    if (!hide && lines.length && passing === lines.length) box.setAttribute("data-passed", "");
    else box.removeAttribute("data-passed");
  }

  function paintAll(announce) {
    Array.prototype.forEach.call(document.querySelectorAll(".tests-card[data-checks]"), function (box) {
      paint(box);
      if (announce) {
        var ev;
        try { ev = new CustomEvent("ide-checks", { bubbles: true }); }
        catch (e) { ev = document.createEvent("Event"); ev.initEvent("ide-checks", true, false); }
        box.dispatchEvent(ev);
      }
    });
  }

  /* Runs the page's check and shows it in every card. Resolves what the
     runner did, or null when there's no runner or one is going already.
     `box`, the card whose button it was (or the editor bubble's card), gets
     data-checked: in a quiz, where nobody's told what passed, that is what
     moves the bubble on to the next step. Only that card's — every check
     runs every test, so "has results" would be every card on the slide. */
  function check(box) {
    if (box && box.hasAttribute && box.hasAttribute("data-try")) return checkTry(box);
    if (!runner || busy) return Promise.resolve(null);
    if (box && box.setAttribute) box.setAttribute("data-checked", "");
    // hints.js talks about this card only: a Try It slide has a card per step.
    pressed = box && box.querySelectorAll ? box : null;
    busy = true;
    paintAll(false);
    return Promise.resolve().then(runner).then(function (got) {
      if (got && got.results) {
        latest = {};
        got.results.forEach(function (r) { latest[r.label] = { ok: !!r.ok, detail: r.detail || "" }; });
      }
      return got;
    }, function (e) {
      // Nothing to show in the cards; the page's own runner says what went wrong.
      return null;
    }).then(function (got) {
      busy = false;
      paintAll(true);
      return got;
    });
  }

  /* ---------------------------------------------------- Try It, on the slide
     ```tests try (Nov 2026, the teacher: "the editor popups are just not
     working but i like the teaching that the try it slides do"): the step
     is typed into a box right under it on the slide, and its card checks
     THAT box — run as main.py would be, with the tests' inputs, in the
     page's Python (tryRunner, app.js / live.js), then run again for the
     output under the box (snippets.js, its own worker). Practice: nothing
     is posted, nothing graded (autograde.py TRY); the hints are free.

     Like typing under the last line in main.py, an empty box starts with
     the Try It step before's code when it's first clicked (in the notes'
     order, on whatever slide: notes.js tryBefore), so `print(crop +
     "seed")` has its `crop`. What's typed is kept in this browser. Paste
     is refused: typing it is the exercise (the teacher's pane is
     unselectable on the live page for the same reason). */
  var TRY_KEY = "pyide-try:";
  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function keep(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* private window */ } }

  function tryKey(source) { return TRY_KEY + location.pathname + ":" + hash(String(source || "").trim()); }
  function tryStep(tests, source) {
    var key = tryKey(source);
    var wrap = el("div", "try-step");
    var area = el("textarea", "try-code");
    area.spellcheck = false;
    area.setAttribute("autocapitalize", "off");
    area.setAttribute("autocomplete", "off");
    area.setAttribute("aria-label", "Type the step here");
    area.placeholder = "Type it here";
    var saved = load(key);
    area.value = saved || "";
    function fit() { area.rows = Math.max(2, Math.min(16, area.value.split("\n").length + 1)); }
    fit();
    var lastKey = TRY_KEY + location.pathname + ":last";
    function remember() {
      keep(key, area.value);
      try { localStorage.setItem(lastKey, JSON.stringify({ k: key, v: area.value })); } catch (e) { /* private window */ }
    }
    area.addEventListener("input", function () { remember(); fit(); });
    // Empty and never typed in: start from the step before's code, as main.py would have it.
    area.addEventListener("focus", function () {
      if (area.value || load(key) !== null) return;
      /* The Try It step before this one in the notes (notes.js tryBefore),
         wherever it is — v14 puts each step on a slide of its own — and
         what was typed in it, kept in this browser. Only a Try It box's:
         they're one program built step by step; nothing else carries. */
      var N = window.PyIDENotes, prior = N && N.tryBefore ? N.tryBefore(source) : undefined, prev = null;
      /* The notes give this step a start (```try-start: the JavaScript
         unit's starter page): that, with the cursor on the empty line inside
         its last <script>, where the step's code goes. */
      var start = N && N.tryStart ? N.tryStart(source) : null;
      if (start) {
        area.value = start.replace(/\s+$/, "") + "\n";
        remember();
        fit();
        var at = area.value.lastIndexOf("<script>");
        var nl = at >= 0 ? area.value.indexOf("\n", at) : -1;
        area.selectionStart = area.selectionEnd = nl >= 0 ? nl + 1 : area.value.length;
        return;
      }
      if (prior === null) return;                        // the first step: nothing before it
      if (prior !== undefined) prev = load(tryKey(prior));
      else {
        // Notes the viewer didn't say (no slideView here): the box above it
        // on the page, else the box last typed in.
        var steps = document.querySelectorAll(".try-step"), before = null;
        for (var i = 0; i < steps.length && steps[i] !== wrap; i++) before = steps[i];
        prev = before && before.querySelector(".try-code").value;
        if (!before) {
          var last = null;
          try { last = JSON.parse(load(lastKey) || "null"); } catch (e) { last = null; }
          if (last && last.k !== key) prev = last.v;
        }
      }
      prev = String(prev || "").replace(/\s+$/, "");
      if (!prev) return;
      area.value = prev + "\n";
      remember();
      fit();
      area.selectionStart = area.selectionEnd = area.value.length;
    });
    area.addEventListener("paste", function (e) { e.preventDefault(); });
    area.addEventListener("drop", function (e) { e.preventDefault(); });
    area.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        var a = area.selectionStart, b = area.selectionEnd;
        area.value = area.value.slice(0, a) + "    " + area.value.slice(b);
        area.selectionStart = area.selectionEnd = a + 4;
        remember();
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Keep the line's indent, and one more after a colon, as the editor does.
        var at = area.selectionStart, line = area.value.slice(area.value.lastIndexOf("\n", at - 1) + 1, at);
        var pad = (/^\s*/.exec(line) || [""])[0] + (/:\s*$/.test(line) ? "    " : "");
        if (!pad) return;
        e.preventDefault();
        area.value = area.value.slice(0, at) + "\n" + pad + area.value.slice(area.selectionEnd);
        area.selectionStart = area.selectionEnd = at + 1 + pad.length;
        remember(); fit();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        check(box);
      }
    });
    wrap.appendChild(area);
    var out = el("div", "try-out");
    out.hidden = true;
    var box = card(tests, "✔ Check this step", "try");
    wrap.appendChild(box);
    wrap.insertBefore(out, box);
    return wrap;
  }

  // What a Try It box's program is given for input(): its first test's that has any.
  function tryInputs(box) {
    var t = (box._tests || []).filter(function (t) { return t.inputs && t.inputs.length; })[0];
    return t ? t.inputs.slice() : [];
  }

  function checkTry(box) {
    var wrap = box.parentNode, area = wrap && wrap.querySelector(".try-code"), out = wrap && wrap.querySelector(".try-out");
    if (!tryRunner || busy || !area) return Promise.resolve(null);
    box.setAttribute("data-checked", "");
    pressed = box;
    busy = true;
    paintAll(false);
    var code = area.value;
    return Promise.resolve().then(function () { return tryRunner(code, box._tests || []); }).then(function (got) {
      if (got && got.results) {
        box._tryResults = {};
        got.results.forEach(function (r) { box._tryResults[r.label] = { ok: !!r.ok, detail: r.detail || "" }; });
      }
      return got;
    }, function () { return null; }).then(function (got) {
      busy = false;
      paintAll(true);
      if (got && out) {
        if (tryShow) {
          out.hidden = false;
          out.className = "try-out try-out-page";
          out.textContent = "";
          try { tryShow(code, box._tests || [], out); } catch (e) { out.textContent = String(e && e.message || e); }
        } else {
          showRun(code, tryInputs(box), out);
        }
      }
      return got;
    });
  }

  /* The box's program, run for its output under the box, as Run would show it. */
  function showRun(code, inputs, out) {
    var S = window.IDESnippets;
    if (!S || !S.run) return;
    out.hidden = false;
    out.className = "try-out";
    out.textContent = "Running…";
    S.run(code, inputs).then(function (r) {
      out.textContent = "";
      out.appendChild(el("span", "try-out-head", "Output:\n"));
      out.appendChild(document.createTextNode(r.text || (r.error ? "" : "(It printed nothing.)")));
      if (r.error) out.appendChild(el("span", "try-out-err", (r.text && !/\n$/.test(r.text) ? "\n" : "") + r.error));
    });
  }

  /* `show`, for an IDE whose box isn't a Python program (a web page, a
     Flask app, a query, a PHP page): draws what it makes into `out`. Without
     it, the box is run as Python and what it prints is shown. */
  function setTryRunner(fn, show) {
    tryRunner = typeof fn === "function" ? fn : null;
    tryShow = typeof show === "function" ? show : null;
    paintAll(false);
  }

  function setRunner(fn) {
    runner = typeof fn === "function" ? fn : null;
    paintAll(false);
  }

  /* New notes, or another student's (a shared Chromebook): forget the last check. */
  function forget() {
    latest = null;
    paintAll(false);
  }

  /* fn() true where the teacher is the one looking (their own notes, their
     live lesson): a quiz's results are shown to them as to any check. */
  function reveal(fn) {
    revealFn = typeof fn === "function" ? fn : null;
    paintAll(false);
  }

  function setQuiz(on) {
    if (!!on === quizNotes) return;
    quizNotes = !!on;
    paintAll(false);
  }

  return { card: card, check: check, setRunner: setRunner, forget: forget, reveal: reveal, setQuiz: setQuiz,
           tryStep: tryStep, setTryRunner: setTryRunner, resultsFor: resultsFor,
           results: function () { return latest; }, pressed: function () { return pressed; } };
})();
