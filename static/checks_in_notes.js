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
  var latest = null;      // label -> {ok, detail}, from the last check
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
  function paint(box) {
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
    btn.hidden = !runner;
    btn.disabled = busy;
    btn.textContent = busy ? "Checking…" : "✔ Check my work";
    box.querySelector(".tests-sum").textContent = !runner ? "" : busy ? "" :
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
    if (!runner || busy) return Promise.resolve(null);
    if (box && box.setAttribute) box.setAttribute("data-checked", "");
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
           results: function () { return latest; } };
})();
