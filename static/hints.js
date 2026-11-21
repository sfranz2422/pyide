/* Hints, in the editor ("Hints" in app.py, hints.py has the format).
 *
 * The teacher's request (Nov 2026): students ignored the small grey reason
 * under a failed test. So when a check fails, a big panel comes up over the
 * bottom of the student's own editor, where they're looking: what failed,
 * why, and — for a test the notes give hints for — 💡 Hint (free), then a
 * second hint for part of that test's points, then 👀 Show me the code for
 * more. Checking is free, always: only opening a paid hint costs.
 *
 * The hints aren't on the page (quiz.redact takes them out of the notes):
 * each is asked for here, and the server records it and takes its cost off
 * the test's points. A paid one asks to be pressed a second time before it
 * spends anything — no browser dialog (they block the page).
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
  var panel = null, current = null, opened = {}, armed = null, lastPassed = {};
  var pending = null;

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

  function hide() {
    if (panel) panel.hidden = true;
    armed = null;
  }

  function steps(label) { return (info.tests[label] || { steps: [] }).steps; }
  function takenOf(label) { return info.taken[label] || []; }
  function costOf(level) { return (info.costs && info.costs[level]) || 0; }

  function draw() {
    if (!panel) {
      panel = el("aside", "hint-panel");
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      cfg.host.appendChild(panel);
    }
    panel.innerHTML = "";
    panel.hidden = false;
    panel.classList.remove("is-pass");
    var close = el("button", "hint-close", "✕");
    close.type = "button";
    close.title = "Hide this until your next check";
    close.setAttribute("aria-label", "Hide");
    close.addEventListener("click", hide);
    panel.appendChild(close);
    if (current.passed) {
      panel.classList.add("is-pass");
      panel.appendChild(el("div", "hint-title", "✓ " + current.label + ": that one passes now!"));
      return;
    }
    panel.appendChild(el("div", "hint-title", "✗ Not yet: " + current.label));
    if (current.detail) panel.appendChild(el("div", "hint-why", current.detail));

    var label = current.label, have = takenOf(label), all = steps(label);
    // What's been opened already, in order: shown again, free.
    all.forEach(function (lv) {
      var text = opened[label + "|" + lv];
      if (!text) return;
      if (lv === 3) {
        panel.appendChild(el("div", "hint-head", "👀 The code"));
        panel.appendChild(el("pre", "hint-code", text));
      } else {
        panel.appendChild(el("div", "hint-text", "💡 " + text));
      }
    });
    var next = all.filter(function (lv) { return have.indexOf(lv) < 0 || !opened[label + "|" + lv]; })[0];
    if (next == null) return;
    var cost = costOf(next), paid = cost > 0 && info.signed_in;
    var words = next === 3 ? "👀 Show me the code" : next === 1 ? "💡 Hint (free)" : "💡 Another hint";
    var already = have.indexOf(next) >= 0;
    if (paid && !already) words += " · costs " + share(cost) + " of this test's points";
    var b = el("button", "btn hint-go" + (paid && !already ? " is-paid" : ""), words);
    b.type = "button";
    if (armed === label + "|" + next) {
      b.textContent = "Press again to spend " + share(cost) + " of this test's points";
      b.classList.add("is-armed");
    }
    b.addEventListener("click", function () {
      var k = label + "|" + next;
      if (paid && !already && armed !== k) { armed = k; draw(); return; }
      armed = null;
      take(label, next);
    });
    var row = el("div", "hint-actions");
    row.appendChild(b);
    panel.appendChild(row);
    if (!all.length) row.hidden = true;
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

  var timer = null;
  function onChecks() {
    // One event per card: answer once, when they've all gone by.
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var results = window.IDENotesChecks && window.IDENotesChecks.results();
      if (!results || info.quiz) return;
      var was = current && !current.passed ? current.label : null;
      var fail = pick(results);
      if (!fail) {
        if (was && results[was] && results[was].ok) { current = { label: was, passed: true }; draw(); }
        else hide();
        return;
      }
      if (was && was !== fail.label && results[was] && results[was].ok) {
        // The one they were stuck on passes: say so, then the next one.
        current = { label: was, passed: true };
        draw();
        setTimeout(function () { current = fail; draw(); reopen(fail.label); }, 1600);
        return;
      }
      current = fail;
      armed = null;
      draw();
      reopen(fail.label);
    }, 50);
  }

  function attach(o) {
    if (!o || !o.slug || !o.host || cfg) return;
    cfg = o;
    load().then(function () {
      if (info.quiz) return;
      document.addEventListener("ide-checks", onChecks);
    });
  }

  return { attach: attach, _pick: pick };
})();
