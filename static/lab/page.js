/* PyIDE — the A+ lab's page: the bench, the computer's screen over it, and
 * (for a scenario) the ticket with its tasks above them. The pages that
 * show the lab (lab_sandbox.html for the sandbox and /lab/try/<id>) give
 * it where things are and how to keep the machine; this wires the rest.
 *
 *   PyIDELabPage.start({base, imgBase, scenario, key, load, save,
 *                       notes, slug, signedIn, viewOnly})
 *
 * base: static/lab/; scenario: a scenario's id, or none for the sandbox;
 * key: the localStorage name the machine is kept under when load/save
 * aren't given (a lab set in a class saves to the server instead).
 *
 * A scenario's ticket marks its tasks after every change, with
 * lab_checks.js — the same marking the server repeats for the grade.
 *
 * A lab set in a class has notes (`notes`, its tutorial, keys taken out):
 * a pane beside the lab, as slides, its questions answered into the
 * assignment (notes.js, /api/quiz) and its ```lab cards ticked from the same
 * marking (lab_notes.js). `locked: yes` in them holds a slide until its
 * card is done.
 */
window.PyIDELabPage = (function () {
  "use strict";

  var L = window.PyIDELab, K = window.PyIDELabChecks;
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) { return window.PyIDELabDesktop.el(tag, attrs, kids); }

  function start(opts) {
    var get = function (name) { return fetch(opts.base + name).then(function (r) { if (!r.ok) throw new Error(name); return r.json(); }); };
    var local = {
      load: function () { try { return JSON.parse(localStorage.getItem(opts.key) || "null"); } catch (e) { return null; } },
      save: function (s) { try { localStorage.setItem(opts.key, JSON.stringify(s)); } catch (e) { /* full or blocked */ } }
    };
    var load = opts.load || function () { return Promise.resolve(local.load()); };
    var save = opts.save || local.save;
    return Promise.all([get("parts.json"), get("img/credits.json").catch(function () { return {}; }),
                        opts.scenario ? get("scenarios/" + opts.scenario + ".json") : null, load()])
      .then(function (got) { run(opts, got[0], got[1], got[2], got[3], save); });
  }

  function run(opts, cat, credits, sc, saved, save) {
    var known = L.catalogOf(cat), monitor = $("lab-monitor"), desktop = null, bench = null;
    function fresh() { return sc ? K.start(cat, sc) : L.sandbox(cat); }
    // A machine saved before the parts changed names parts that are gone,
    // and one saved for another scenario is that scenario's: start fresh.
    var state = saved;
    var stale = !state || state.v !== 1 || (state.scenario || null) !== (sc ? sc.id : null) ||
                Object.keys(state.items || {}).some(function (u) { return !known[state.items[u].part]; });
    if (stale) state = fresh();
    else if (sc) state = K.sanitize(sc, state);
    state.power = { on: false, uptime: 0 };

    function changed(s) {
      save(s);
      mark(s);
    }
    function showScreen() {
      if (!desktop) desktop = window.PyIDELabDesktop.mount($("lab-desktop"), {
        catalog: cat, state: bench.state(), onChange: changed, onOff: toBench });
      monitor.hidden = false;
      desktop.redraw();
    }
    function toBench() {
      monitor.hidden = true;
      // Windows stopped (Shut down, or the bench turned it off): the next
      // start is a fresh desktop, as a real restart is.
      if (desktop && !L.running(bench.state())) { desktop.destroy(); desktop = null; }
      bench.redraw();
    }
    bench = window.PyIDELabBench.mount($("lab"), {
      catalog: cat, state: state, credits: credits, imgBase: opts.imgBase,
      onBoot: showScreen,
      onChange: function (s) {
        changed(s);
        // The bench turned it off (it overheated) while the screen was up.
        if (desktop && !L.running(s)) toBench();
      }
    });
    $("lab-to-bench").addEventListener("click", toBench);

    // Switch on and go to the desktop: the machine must already start Windows.
    function boot(s) {
      if (desktop) { desktop.destroy(); desktop = null; }
      // On before the bench takes it, so the bench keeps the machine's time
      // (a loose cooler still overheats while the desktop is up).
      L.powerOff(s);
      var r = L.powerOn(cat, s);
      bench.setState(s);
      changed(s);
      if (r.stage === "windows" && !r.dark) showScreen();
    }

    /* Start in Windows (the sandbox): straight to the desktop, for practising
       the tools and the Command Prompt without building a PC first. A build
       of the student's own that starts Windows is used as it is; anything
       else is replaced by the ready-made one. ?start=windows opens the page
       this way, for a link posted to a class. */
    function startInWindows(ask) {
      var s = bench.state(), probe = JSON.parse(JSON.stringify(s)), r = L.powerOn(cat, probe);
      if (!(r.stage === "windows" && !r.dark)) {
        var built = s.shelf.length < Object.keys(s.items).length;
        if (ask && built && !confirm("Your build doesn't start Windows. Put a ready-made PC on the bench instead? (Your build will be taken apart.)")) return;
        s = L.ready(cat);
      }
      boot(s);
    }
    if ($("lab-windows")) {
      $("lab-windows").addEventListener("click", function () { startInWindows(true); });
      if (/[?&]start=windows\b/.test(location.search)) startInWindows(false);
    }

    $("lab-reset").addEventListener("click", function () {
      if (!confirm(sc ? "Start this ticket again from the beginning? What you've done will be undone." : "Put every part back on the shelf?")) return;
      var s = fresh();
      if (desktop) { desktop.destroy(); desktop = null; monitor.hidden = true; }
      bench.setState(s);
      changed(s);
      if (sc && sc.start === "windows") boot(s);
    });

    /* ---------------------------------------------------------- the ticket */
    var ticket = $("lab-ticket"), marks = {};
    function drawTicket() {
      if (!sc || !ticket) return;
      ticket.hidden = false;
      ticket.textContent = "";
      var head = el("div", { class: "lab-ticket-head" }, [
        el("span", { class: "lab-ticket-area", text: sc.area }),
        el("strong", { text: "Lab " + sc.order + " · " + sc.title }),
        el("span", { class: "lab-ticket-score", id: "lab-score" }),
        el("button", { type: "button", class: "btn", id: "lab-ticket-toggle", "aria-expanded": "true", text: "Hide", onclick: function () {
          var open = ticket.classList.toggle("closed");
          this.textContent = open ? "Show" : "Hide";
          this.setAttribute("aria-expanded", String(!open));
        } })
      ]);
      var tasks = el("ol", { class: "lab-tasks" });
      sc.tasks.forEach(function (t) {
        var hint = el("p", { class: "lab-hint", hidden: true, text: t.hint });
        var li = el("li", { class: "lab-task", "data-task": t.id }, [
          el("span", { class: "lab-task-mark", "aria-hidden": "true" }),
          el("span", { class: "lab-task-text", text: t.text }),
          el("span", { class: "lab-task-pts", text: t.points + (t.points === 1 ? " pt" : " pts") }),
          el("button", { type: "button", class: "lab-hint-btn", text: "Hint", onclick: function () { hint.hidden = !hint.hidden; } }),
          hint
        ]);
        tasks.appendChild(li);
      });
      ticket.appendChild(head);
      ticket.appendChild(el("div", { class: "lab-ticket-body" }, [el("p", { class: "lab-ticket-text", text: sc.ticket }), tasks]));
    }
    function mark(s) {
      if (!sc || !ticket) return null;
      var got = K.grade(cat, sc, s), score = 0, total = 0;
      got.forEach(function (g) {
        total += g.points;
        if (g.ok) score += g.points;
        marks[g.id] = g.ok;
        var li = ticket.querySelector('[data-task="' + g.id + '"]');
        if (li) {
          li.classList.toggle("done", g.ok);
          li.querySelector(".lab-task-mark").textContent = g.ok ? "✓" : "○";
          li.setAttribute("aria-label", (g.ok ? "Done: " : "To do: ") + li.querySelector(".lab-task-text").textContent);
        }
      });
      $("lab-score").textContent = score + " / " + total + " points" + (score === total ? " · fixed!" : "");
      return got;
    }
    /* ---------------------------------------------------------- the notes */
    function mountNotes() {
      var pane = $("lab-notes"), body = $("lab-notes-body"), N = window.PyIDENotes;
      if (!opts.notes || !pane || !N) return;
      window.PyIDELabNotes.setTasks(sc);
      N.setQuizContext({ assignment: opts.slug, signedIn: !!opts.signedIn, viewOnly: !!opts.viewOnly });
      var view = N.slideView(body, { key: "lab:" + opts.slug, locked: true });
      view.show(opts.notes);
      // Open the first time; after that, as the student left it.
      var KEY = "pyide-lab-notes-open", open = true;
      try { open = localStorage.getItem(KEY) !== "0"; } catch (e) { /* open */ }
      var btn = $("lab-notes-toggle");
      function show(on) {
        pane.hidden = !on;
        btn.setAttribute("aria-expanded", String(on));
        btn.classList.toggle("on", on);
        try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* this visit */ }
      }
      btn.hidden = false;
      btn.addEventListener("click", function () { show(pane.hidden); });
      $("lab-notes-close").addEventListener("click", function () { show(false); });
      show(open);
    }
    var marked = mark;
    mark = function (s) {
      var got = marked(s);
      if (window.PyIDELabNotes && got) window.PyIDELabNotes.update(got);
      return got;
    };

    drawTicket();
    mountNotes();
    mark(state);
    if (sc && sc.start === "windows") boot(state);
  }

  return { start: start };
})();
