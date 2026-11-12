/* The name picker (class_picker.html; "The name picker" in app.py).
 *
 * The teacher presses Pick: the class's first names cycle in the big box,
 * slowing down, and land on one. The cycling is this screen's alone — the
 * projector — and the server is told only the name it landed on, by roster
 * id, which flashes on the students' screens (xp.js, pickFlash) when "Show
 * the name on students' screens" is ticked.
 *
 * The winner is chosen FIRST, at random from whoever can be picked, and the
 * names shown on the way are only for show: the slowing-down never decides
 * anything, so a cycle that ends a step early or late can't favour anyone.
 *
 * Who can be picked: everyone on the roster, less whoever the teacher left
 * out (absent), less — with No repeats — whoever has had a turn. When that
 * leaves nobody, everyone's back in and it says so. What's left out and
 * who's had a turn are kept in this browser, per class, so a reload or the
 * next period keeps the round going; a student no longer on the roster is
 * dropped from both.
 *
 * While the page is open it beats (/picker/beat) so the class's pages ask
 * for picks every couple of seconds rather than every twenty, and says it's
 * closing as it goes.
 */
window.PyIDEPicker = (function () {
  "use strict";

  /* Who can be picked now: ids of `names`, less `out`, less `picked` when
     noRepeats. {ids, fresh}: fresh when everyone left in had had a turn, so
     the round starts again (the caller clears `picked`). */
  function pool(names, out, picked, noRepeats) {
    var left = names.map(function (n) { return n.id; }).filter(function (id) { return out.indexOf(id) < 0; });
    if (!noRepeats) return { ids: left, fresh: false };
    var unpicked = left.filter(function (id) { return picked.indexOf(id) < 0; });
    return unpicked.length ? { ids: unpicked, fresh: false } : { ids: left, fresh: left.length > 0 };
  }

  /* The cycle's pauses, in ms: quick, then slower and slower, about three
     seconds in all, so the room can watch it settle. */
  function pauses() {
    var out = [];
    for (var i = 0; i < 24; i++) out.push(Math.round(45 + 380 * Math.pow(i / 23, 2.4)));
    return out;
  }

  /* The names shown on the way, ending on `winner`: random from `ids`, never
     the same twice running (it would look stuck). */
  function route(ids, winner, steps, rand) {
    // Built backwards from the winner, each name differing from the one
    // after it: forwards, two names left in the hat could be forced onto
    // the winner one step early, and the box would sit on it twice.
    var shown = [winner];
    for (var i = 1; i < steps; i++) {
      var after = shown[0];
      var choices = ids.length > 1 ? ids.filter(function (id) { return id !== after; }) : ids;
      shown.unshift(choices[Math.floor(rand() * choices.length)]);
    }
    return shown;
  }

  function choose(ids, rand) { return ids[Math.floor(rand() * ids.length)]; }

  var api = { pool: pool, pauses: pauses, route: route, choose: choose };

  var dataEl = typeof document !== "undefined" && document.getElementById("pick-data");
  if (!dataEl) return api;              // loaded by a test, or a page with no roster
  var data = JSON.parse(dataEl.textContent);
  var names = data.names || [];
  if (!names.length) return api;

  var $ = function (id) { return document.getElementById(id); };
  var byId = {};
  names.forEach(function (n) { byId[n.id] = n; });
  var KEY = "pyide-picker:" + data.classId;
  var state = { out: [], picked: [], noRepeats: true, send: true };
  try {
    var kept = JSON.parse(localStorage.getItem(KEY) || "null");
    if (kept) {
      state.out = (kept.out || []).filter(function (id) { return byId[id]; });
      state.picked = (kept.picked || []).filter(function (id) { return byId[id]; });
      state.noRepeats = kept.noRepeats !== false;
      state.send = kept.send !== false;
    }
  } catch (e) { /* storage blocked: a fresh round, every time */ }
  function keep() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* blocked */ }
  }

  var stage = $("pick-stage"), nameEl = $("pick-name"), go = $("pick-go");
  var noRep = $("pick-norepeat"), send = $("pick-send"), status = $("pick-status"), grid = $("pick-grid");
  noRep.checked = state.noRepeats;
  send.checked = state.send;
  var spinning = false;

  function say(text) { status.textContent = text; }
  function counts() {
    var p = pool(names, state.out, state.picked, state.noRepeats);
    var inHat = names.length - state.out.length;
    if (!inHat) return "Everyone is left out. Click a name below to put it back.";
    if (!state.noRepeats) return inHat + " in the hat.";
    return (p.fresh ? inHat : p.ids.length) + " of " + inHat + " still to have a turn.";
  }

  function drawGrid() {
    grid.textContent = "";
    names.forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      var isOut = state.out.indexOf(n.id) >= 0, had = state.picked.indexOf(n.id) >= 0;
      b.className = "picker-chip" + (isOut ? " is-out" : "") + (had ? " is-picked" : "");
      b.textContent = (had ? "✓ " : "") + n.name;
      b.setAttribute("aria-pressed", isOut ? "false" : "true");
      b.title = isOut ? "Left out — click to put back" : "Click to leave out";
      b.addEventListener("click", function () {
        if (spinning) return;
        var at = state.out.indexOf(n.id);
        if (at >= 0) state.out.splice(at, 1); else state.out.push(n.id);
        keep(); drawGrid(); say(counts());
      });
      grid.appendChild(b);
    });
    go.disabled = spinning || state.out.length >= names.length;
  }

  function post(path, body, keepalive) {
    return fetch("/api/class/" + data.classId + "/picker/" + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}), keepalive: !!keepalive
    });
  }

  function pick() {
    if (spinning) return;
    var p = pool(names, state.out, state.picked, state.noRepeats);
    if (!p.ids.length) return;
    if (p.fresh) state.picked = [];
    var winner = choose(p.ids, Math.random);
    var waits = pauses();
    var shown = route(p.ids, winner, waits.length, Math.random);
    spinning = true;
    go.disabled = true;
    stage.classList.remove("is-landed");
    stage.classList.add("is-spinning");
    say(p.fresh ? "Everyone's had a turn — starting a new round." : "");
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var i = still ? shown.length - 1 : 0;
    (function step() {
      nameEl.textContent = byId[shown[i]].name;
      if (i < shown.length - 1) { setTimeout(step, waits[i]); i++; return; }
      landed(winner, p.fresh);
    })();
  }

  function landed(id, fresh) {
    spinning = false;
    stage.classList.remove("is-spinning");
    void stage.offsetWidth;            // the pop plays again on a second pick
    stage.classList.add("is-landed");
    if (state.noRepeats && state.picked.indexOf(id) < 0) state.picked.push(id);
    keep();
    drawGrid();
    var left = counts();
    var head = fresh ? "New round. " : "";
    if (!state.send) { say(head + left); return; }
    post("pick", { id: id })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        say(head + (x.ok ? "Shown on the class's screens. " : "Not shown on their screens: " + (x.d.error || "the server said no") + " ") + left);
      })
      .catch(function () { say(head + "Not shown on their screens: no connection. " + left); });
  }

  go.addEventListener("click", pick);
  noRep.addEventListener("change", function () { state.noRepeats = noRep.checked; keep(); drawGrid(); say(counts()); });
  send.addEventListener("change", function () { state.send = send.checked; keep(); });
  $("pick-all").addEventListener("click", function () { if (spinning) return; state.out = []; keep(); drawGrid(); say(counts()); });
  var here = $("pick-here");
  var present = data.here || [];
  here.disabled = !present.length;
  if (!present.length) here.title = "Nobody has opened anything of this class today yet (Attendance)";
  here.addEventListener("click", function () {
    if (spinning) return;
    state.out = names.map(function (n) { return n.id; }).filter(function (id) { return present.indexOf(id) < 0; });
    keep(); drawGrid(); say(counts());
  });
  $("pick-reset").addEventListener("click", function () {
    if (spinning) return;
    state.picked = []; keep(); drawGrid(); say(counts());
  });
  // Space picks, unless a checkbox or button has the focus (Space is theirs).
  document.addEventListener("keydown", function (e) {
    if (e.key !== " " && e.key !== "Enter") return;
    var t = e.target || {};
    if (/^(INPUT|BUTTON|TEXTAREA|SELECT|A)$/.test(t.tagName || "")) return;
    e.preventDefault();
    pick();
  });

  // Open: the class's pages ask quickly. Closing: they go back to slow.
  function beat() { post("beat", { open: true }).catch(function () {}); }
  beat();
  setInterval(beat, (data.beatSeconds || 10) * 1000);
  window.addEventListener("pagehide", function () { post("beat", { open: false }, true).catch(function () {}); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) beat(); });

  drawGrid();
  say(counts());
  return api;
})();
