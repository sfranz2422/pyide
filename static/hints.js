/* Hints, in the editor ("Hints" in app.py, hints.py has the format).
 *
 * The teacher's request (Nov 2026): students ignored the small grey reason
 * under a failed test. So when a check fails, a big panel comes up over the
 * bottom of the student's own editor, where they're looking: what failed,
 * why, and — for a test the notes give hints for — 💡 Hint (free), then a
 * second hint for part of that test's points, then 👀 Show me the code for
 * more (the buttons say none of that: the teacher wanted just "Hint"). Checking is free, always: only opening a paid hint costs.
 *
 * The hints aren't on the page (quiz.redact takes them out of the notes):
 * each is asked for here, and the server records it and takes its cost off
 * the test's points. One press opens one: a paid hint once asked to be
 * pressed twice, and the teacher found that looked like the button didn't
 * work (Nov 2026). A Try It step's hints cost nothing (`free`, hints.py:
 * the box in the editor already says what to type). Only the newest opened
 * step is on the card: the code alone once it's shown.
 *
 * Every check of a card says how it went: ✗ with the hints, or ✓ when the
 * card passes (the teacher liked the pass box and wanted it every time, not
 * only after a hint). Only the card whose ✔ was pressed is talked about —
 * a Try It slide holds four steps' cards, and passing the first isn't
 * failing the second. A program that asks for input() runs after the
 * check (app.js), and the card waits until it's done (wait()): it came up
 * over the console before a student could type their answer.
 *
 * attach({slug, host}) on a page with a student's editor: app.js (their
 * own editor) and live.js (the class's page, their own editor, never the
 * teacher's mirror). Nothing in a quiz (`quiz: yes`): students there aren't
 * told what failed. The panel follows checks_in_notes.js's "ide-checks"
 * event, reading its results(): the first failing test on the slide in
 * view, else the first failing one anywhere.
 */
window.IDEHints = (function () {
  "use strict";

  var cfg = null, info = { tests: {}, taken: {}, costs: {}, quiz: false, signed_in: false };
  var panel = null, backdrop = null, current = null, opened = {};
  var pending = null, waiting = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function share(x) {
    return x === 0.25 ? "a quarter" : x === 0.5 ? "half" : x === 0.75 ? "three quarters" : Math.round(x * 100) + "%";
  }

  function load() {
    return fetch("/api/hints/" + encodeURIComponent(cfg.slug), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) info = d; })
      .catch(function () { /* no hints offered; the reasons still show */ });
  }

  /* The test to talk about: the first failing one on the slide in view (by
     the cards' order), else the first failing one in any card. */
  function pick(results) {
    var lines = Array.prototype.slice.call(document.querySelectorAll(".tests-card[data-checks]:not([data-bonus]) .test-line"));
    var shown = lines.filter(function (li) { return li.offsetParent !== null; });
    var order = (shown.length ? shown : lines).map(function (li) { return li.getAttribute("data-label"); });
    for (var i = 0; i < order.length; i++) {
      var r = results[order[i]];
      if (r && !r.ok) return { label: order[i], detail: r.detail || "" };
    }
    return null;
  }

  /* Closed (✕, Back to my code, Esc, a click outside): until the next check. */
  function hide() {
    if (panel) panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  function steps(label) { return (info.tests[label] || { steps: [] }).steps; }
  function takenOf(label) { return info.taken[label] || []; }
  function costOf(label, level) {
    if ((info.tests[label] || {}).free) return 0;
    return (info.costs && info.costs[level]) || 0;
  }

  /* What a test asks for, in a student's words. The label is the checker's
     ("With input apple, sun, flower, prints hayride"): the inputs are the
     whole program's answers typed in for the check, which says nothing to
     a kid on a step that has no input() at all (the teacher, Nov 2026). */
  function goal(label) {
    var m;
    if ((m = /^(?:With input .*?, )?prints exactly (.*)$/i.exec(label))) return "It should print exactly " + m[1];
    if ((m = /^(?:With input .*?, )?prints (.*)$/i.exec(label))) return "It should print " + m[1];
    if ((m = /^Uses (.*)$/.exec(label))) return "Your code should use " + m[1];
    if ((m = /^Doesn't use (.*)$/.exec(label))) return "Your code shouldn't use " + m[1];
    if ((m = /^Defines (.*)$/.exec(label))) return "Your code should have def " + m[1];
    if ((m = /^(\w+) is made with (.*)$/.exec(label))) return "The line that makes " + m[1] + " should use " + m[2];
    if ((m = /^(.*) gives (.*)$/.exec(label))) return m[1] + " should give " + m[2];
    return label;
  }

  /* Why it failed, in a student's words. The checker says what Python
     said ("NameError: name 'hay' is not defined"); a syntax error gets the
     Run button's own plain words (syntax.js), the line read from their
     editor. Anything not known here is shown as Python said it. */
  function lineOf(n) {
    var cm = cfg.host && cfg.host.querySelector(".CodeMirror");
    try { return cm && cm.CodeMirror ? cm.CodeMirror.getLine(n - 1) || "" : ""; } catch (e) { return ""; }
  }
  function why(detail) {
    var m, d = String(detail || "");
    if (!d) return "";
    if ((m = /^(\S+) can't be read: line (\d+): (.*)$/.exec(d))) {
      if (window.PyIDESyntax && window.PyIDESyntax.explain) {
        return window.PyIDESyntax.explain({ file: m[1], line: +m[2], msg: m[3], kind: "SyntaxError",
                                           text: m[1] === "main.py" ? lineOf(+m[2]) : "" }).friendly;
      }
      return "Python can't read line " + m[2] + ". Look for a missing quote, bracket or symbol there.";
    }
    if ((m = /NameError: name '(\w+)' is not defined/.exec(d))) {
      return "Python doesn't know " + m[1] + ". If " + m[1] + " is a word to print, it needs quotes: \"" + m[1]
        + "\". If it's a variable, check it's spelled exactly as where you made it.";
    }
    if (/can only concatenate str \(not "(int|float)"\) to str/.test(d)) {
      return "+ can only glue text to text. A number needs str( ) around it first.";
    }
    if ((m = /^It printed: \(nothing\)$/.exec(d))) return "Your program didn't print anything.";
    if ((m = /^It printed: ([\s\S]*)$/.exec(d))) return "Your program printed: " + m[1];
    if (/^It isn't in the code yet\.$/.test(d)) return "It isn't in your code yet.";
    return d;
  }

  function ensurePanel() {
    if (!panel) {
      // A card in the middle of the screen, over the page dimmed behind it:
      // at the bottom of the editor it was under the fold on a Chromebook,
      // where nobody scrolls to look (the teacher, Nov 2026).
      backdrop = el("div", "hint-backdrop");
      backdrop.addEventListener("click", hide);
      panel = el("aside", "hint-panel");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-live", "polite");
      panel.setAttribute("aria-label", "Hint");
      /* Nothing on the card can be copied (the teacher, Nov 2026: students
         copied the hint's code into the editor). Typing it is the point.
         Unselectable in style.css too; this catches the keyboard and the
         right-click menu. A speed bump, as the live page's teacher pane is. */
      ["copy", "cut", "dragstart", "contextmenu", "selectstart"].forEach(function (t) {
        panel.addEventListener(t, function (e) { e.preventDefault(); });
      });
      document.body.appendChild(backdrop);
      document.body.appendChild(panel);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && panel && !panel.hidden) hide();
      });
    }
  }

  function draw() {
    ensurePanel();
    panel.innerHTML = "";
    panel.hidden = false;
    backdrop.hidden = false;
    panel.classList.remove("is-pass");
    var close = el("button", "hint-close", "✕");
    close.type = "button";
    close.title = "Back to my code";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", hide);
    panel.appendChild(close);
    var back = el("button", "btn hint-back", "Back to my code");
    back.type = "button";
    back.addEventListener("click", hide);
    if (current.passed) {
      panel.classList.add("is-pass");
      panel.appendChild(el("div", "hint-title", "✓ Great Job!"));
      (current.labels || []).forEach(function (lab) { panel.appendChild(el("div", "hint-why", "✓ " + goal(lab))); });
      back.textContent = "Keep going";
      var r0 = el("div", "hint-actions");
      r0.appendChild(back);
      panel.appendChild(r0);
      try { back.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
      return;
    }
    panel.appendChild(el("div", "hint-title", "✗ Not yet: " + goal(current.label)));
    var said = why(current.detail);
    if (said) panel.appendChild(el("div", "hint-why", said));

    var label = current.label, have = takenOf(label), all = steps(label);
    /* Only the newest opened step is shown (the teacher, Nov 2026: "in the
       final hint just show the code remove the other hints above"): each
       step says more than the one before, so the last one is all they need.
       Opened ones still open again free after a reload. */
    var newest = all.filter(function (lv) { return !!opened[label + "|" + lv]; }).pop();
    all.forEach(function (lv) {
      var text = opened[label + "|" + lv];
      if (!text || lv !== newest) return;
      if (lv === 3) {
        panel.appendChild(el("div", "hint-head", "👀 The code"));
        panel.appendChild(el("pre", "hint-code", text));
      } else {
        panel.appendChild(el("div", "hint-text", "💡 " + text));
      }
    });
    var row = el("div", "hint-actions");
    var next = all.filter(function (lv) { return have.indexOf(lv) < 0 || !opened[label + "|" + lv]; })[0];
    if (next == null) {
      // Nothing more to give: say so, or it looks stuck (the teacher pressed
      // Check three times on a Try It step waiting for the next one). A Try
      // It step has its one hint and no code: the code is in its box.
      if (all.length) {
        panel.appendChild(el("div", "hint-end", all.indexOf(3) < 0
          ? "That's the only hint for this step. The line to type is in the box in your editor."
          : "That's every hint for this one."));
      }
      row.appendChild(back);
      panel.appendChild(row);
      return;
    }
    var cost = costOf(label, next), paid = cost > 0 && info.signed_in;
    var words = next === 3 ? "👀 Show me the code" : next === 1 ? "💡 Hint" : "💡 Another hint";
    var already = have.indexOf(next) >= 0;
    // Just the words, nothing about cost or "(free)" (the teacher, Nov 2026:
    // "don't put anything on the button ... just say hint"). What a hint
    // costs is still charged on the server; the button no longer says it.
    var b = el("button", "btn hint-go" + (paid && !already ? " is-paid" : ""), words);
    b.type = "button";
    b.addEventListener("click", function () { take(label, next); });
    row.appendChild(b);
    row.appendChild(back);
    panel.appendChild(row);
    try { b.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  }

  /* The same card for a prediction's wrong guess (snippets.js): what was
     wrong, the hints so far — each wrong guess adds the next, free, as
     before — and once they're all out, 👀 Show me the answer. A prediction
     is worth no points, so the answer costs nothing; it's shown, never
     filled in, and they still type (or pick) it to go on. The teacher
     (Nov 2026): "expand the hint system to the code prediction questions". */
  function predictCard(o) {
    ensurePanel();
    panel.innerHTML = "";
    panel.hidden = false;
    backdrop.hidden = false;
    panel.classList.toggle("is-pass", !!o.pass);
    var close = el("button", "hint-close", "✕");
    close.type = "button";
    close.title = "Back to the question";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", hide);
    panel.appendChild(close);
    panel.appendChild(el("div", "hint-title", (o.pass ? "✓ " : "✗ ") + (o.title || (o.pass ? "Right!" : "Not yet"))));
    if (o.why) panel.appendChild(el("div", "hint-why", o.why));
    // Only the newest hint (the teacher, Nov 2026: as on a test's card).
    var hs = o.hints || [];
    if (hs.length) panel.appendChild(el("div", "hint-text", "💡 " + hs[hs.length - 1]));
    if (o.shown) {
      panel.appendChild(el("div", "hint-head", "👀 " + (o.answerLabel || "The answer")));
      panel.appendChild(el("pre", "hint-code", o.answer));
    }
    var row = el("div", "hint-actions");
    if (o.canReveal && !o.shown) {
      var b = el("button", "btn hint-go", "👀 Show me the answer");
      b.type = "button";
      b.addEventListener("click", function () { if (o.onReveal) o.onReveal(); });
      row.appendChild(b);
    } else if (o.more) {
      panel.appendChild(el("div", "hint-end", o.more));
    }
    var back = el("button", "btn hint-back", o.pass ? "Keep going" : "Back to the question");
    back.type = "button";
    back.addEventListener("click", hide);
    row.appendChild(back);
    panel.appendChild(row);
    try { (row.querySelector(".hint-go") || back).focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  }

  /* One hint's text from the server, kept in `opened`. A level already
     taken is answered without charging again (app.py, hints_take). */
  function fetchHint(label, level) {
    return fetch("/api/hints/" + encodeURIComponent(cfg.slug), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label, level: level })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) return x;
        opened[label + "|" + level] = x.d.text;
        var t = info.taken[label] = info.taken[label] || [];
        if (t.indexOf(level) < 0) t.push(level);
        return x;
      });
  }

  /* A press: one at a time, so a double click can't ask twice. */
  function take(label, level) {
    if (pending) return;
    pending = fetchHint(label, level).then(function (x) {
      pending = null;
      if (!x.ok && current && current.label === label) current.detail = x.d.error || current.detail;
      if (current && current.label === label) draw();
    }, function () { pending = null; });
  }

  /* Hints already paid for open again free, in order — one after another,
     not through take(), whose one-at-a-time guard dropped all but the first
     after a reload. */
  function reopen(label) {
    var todo = takenOf(label).slice().sort().filter(function (lv) { return !opened[label + "|" + lv]; });
    todo.reduce(function (p, lv) {
      return p.then(function () { return fetchHint(label, lv); });
    }, Promise.resolve()).then(function () {
      if (todo.length && current && current.label === label) draw();
    }, function () { /* the panel still has what it had */ });
  }

  /* What to say after a check: about the card whose ✔ was pressed (or
     the editor bubble's), its first failing test, or that it all passes.
     A check from nowhere in particular (no card known) falls back to the
     first failing test on the slide in view. */
  function judge(results) {
    var box = window.IDENotesChecks && window.IDENotesChecks.pressed && window.IDENotesChecks.pressed();
    if (box && box.isConnected) {
      var labels = Array.prototype.map.call(box.querySelectorAll(".test-line"), function (li) {
        return li.getAttribute("data-label");
      }).filter(function (lab) { return results[lab]; });
      if (labels.length) {
        for (var i = 0; i < labels.length; i++) {
          if (!results[labels[i]].ok) return { label: labels[i], detail: results[labels[i]].detail || "" };
        }
        return { passed: true, labels: labels };
      }
    }
    return pick(results);
  }

  /* Shown now, or once the program that asks for input has finished. */
  function show(c) {
    current = c;
    function go() {
      if (current !== c) return;
      draw();
      if (!c.passed) reopen(c.label);
    }
    if (waiting) { hide(); waiting.then(go, go); }
    else go();
  }

  var timer = null;
  function onChecks() {
    // One event per card: answer once, when they've all gone by.
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var C = window.IDENotesChecks, box = C && C.pressed && C.pressed();
      // A Try It card on the slide has results of its own (its box's code).
      var results = C && (box && C.resultsFor ? C.resultsFor(box) : C.results());
      if (!results || info.quiz) return;
      var said = judge(results);
      if (!said) { current = null; hide(); return; }
      show(said);
    }, 50);
  }

  /* The page's run after a check (app.js, live.js), when the program asks
     for input(): the card waits for it, so the console can be typed in. */
  function wait(p) {
    var w = waiting = Promise.resolve(p).then(function () {}, function () {});
    w.then(function () { if (waiting === w) waiting = null; });
  }

  function attach(o) {
    if (!o || !o.slug || !o.host || cfg) return;
    cfg = o;
    load().then(function () {
      if (info.quiz) return;
      document.addEventListener("ide-checks", onChecks);
    });
  }

  return { attach: attach, _pick: pick, _goal: goal, _why: why, predictCard: predictCard, hide: hide, wait: wait,
           // editor_tip.js: the hint card says why a check failed, so the bubble doesn't too.
           active: function () { return !!cfg && !info.quiz; } };
})();
