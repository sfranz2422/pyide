/* The class, live (Nov 2026, the teacher's request: make live mode "more
 * interesting for the kids"). One file, three pages:
 *
 *   student(...)  the class's live page (live.js, web/live.js). Says when
 *                 this student passes a step's check (and is told "You were
 *                 #5!"), what they first predicted, and "I'm stuck" / "I'm
 *                 done"; shows the teacher's countdown and the celebration
 *                 when the whole class has passed a step.
 *   teacher(...)  the teacher's editor while live (app.js). Asks for the
 *                 class's side every few seconds (/api/live/<code>/class),
 *                 paints it on the notes, keeps the stuck/done count and the
 *                 countdown on the top bar, and calls the celebration.
 *   paint(...)    what both the editor and its pop-out on the projector
 *                 (present.js) draw: "17 / 22 finished" on each step's card,
 *                 and a chart of the class's first guesses under each
 *                 prediction, as they come in (the teacher's choice:
 *                 automatically, anonymous).
 *
 * A card and a prediction are matched between the teacher's copy and the
 * class's by a key made from what's in them (a card's check labels, a
 * prediction's code), never by their place: the teacher's notes have the
 * answer keys in and the class's don't, and a slide can be edited live.
 *
 * Counts only, never names (the teacher's choice). The server counts only
 * the students here now, and a signed-out student says nothing (app.py,
 * "The class, live").
 */
window.PyIDELiveClass = (function () {
  "use strict";

  var CLASS_MS = 3000;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* A short key for some text (djb2 twice, base 36): the server takes
     [a-z0-9]{1,24}. Not secret, only stable. */
  function key(text) {
    var a = 5381, b = 52711, s = String(text || "");
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a = ((a << 5) + a + c) | 0;
      b = ((b << 5) + b + (c ^ 0x55)) | 0;
    }
    return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).slice(0, 24);
  }
  function cardKey(card) {
    var labels = [];
    Array.prototype.forEach.call(card.querySelectorAll(".test-line"), function (li) {
      labels.push(li.getAttribute("data-label") || "");
    });
    return labels.length ? key(labels.join("\n")) : "";
  }
  function predictKey(box) {
    return typeof box.predictCode === "string" ? key(box.predictCode) : "";
  }

  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  // ------------------------------------------------------------- painting
  /* Draws the class's side onto the notes in `root`. Writes only what
     differs: the editor watches its notes with a MutationObserver to paint
     again after a redraw, and must not set itself off. */
  function paint(root, d) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".tests-card"), function (card) {
      var k = cardKey(card), badge = card.querySelector(".live-count");
      var n = d && k && d.steps ? (d.steps[k] || 0) : null;
      if (n === null) { if (badge) badge.remove(); return; }
      if (!badge) {
        badge = el("span", "live-count");
        (card.querySelector(".tests-head") || card).appendChild(badge);
      }
      var text = typeof d.here === "number" ? n + " / " + d.here + " finished" : n + " finished";
      if (badge.textContent !== text) badge.textContent = text;
      var all = typeof d.here === "number" && d.here > 0 && n >= d.here;
      if (badge.classList.contains("all-in") !== all) badge.classList.toggle("all-in", all);
    });
    Array.prototype.forEach.call(root.querySelectorAll(".snippet-predict"), function (box) {
      var k = predictKey(box), chart = box.querySelector(".live-guesses");
      var g = d && k && d.guesses ? d.guesses[k] : null;
      if (!g || !g.n) { if (chart) chart.remove(); return; }
      var sig = JSON.stringify([g, d.here]);
      if (chart && chart.getAttribute("data-sig") === sig) return;
      if (!chart) { chart = el("div", "live-guesses"); box.appendChild(chart); }
      chart.setAttribute("data-sig", sig);
      chart.textContent = "";
      chart.appendChild(el("div", "live-guesses-head",
        "🤔 The class's first guesses · " + g.n + (typeof d.here === "number" ? " of " + d.here : "")));
      var most = Math.max.apply(null, g.top.map(function (t) { return t.n; }).concat([g.other || 0, 1]));
      g.top.concat(g.other ? [{ text: "something else", n: g.other, other: true }] : []).forEach(function (t) {
        var row = el("div", "live-guess" + (t.right ? " is-right" : "") + (t.other ? " is-other" : ""));
        var bar = el("span", "live-guess-bar");
        bar.style.width = Math.round(100 * t.n / most) + "%";
        row.appendChild(bar);
        var words = el("span", "live-guess-text", (t.right ? "✓ " : "") + (t.text || "(blank)").split("\n").join(" ⏎ "));
        row.appendChild(words);
        row.appendChild(el("span", "live-guess-n", String(t.n)));
        chart.appendChild(row);
      });
    });
  }

  // ------------------------------------------------------------- confetti
  function confetti(message) {
    var layer = el("div", "live-party");
    layer.setAttribute("aria-hidden", "true");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var colors = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#a855f7", "#f97316"];
    for (var i = 0; !reduce && i < 90; i++) {
      var bit = el("i", "live-party-bit");
      bit.style.left = (Math.random() * 100) + "%";
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = (Math.random() * 0.6) + "s";
      bit.style.animationDuration = (1.8 + Math.random() * 1.4) + "s";
      bit.style.transform = "rotate(" + Math.round(Math.random() * 360) + "deg)";
      layer.appendChild(bit);
    }
    document.body.appendChild(layer);
    var note = el("div", "live-party-note", message);
    note.setAttribute("role", "status");
    document.body.appendChild(note);
    setTimeout(function () { layer.remove(); note.remove(); }, 4200);
  }

  // ------------------------------------------------------------- the class
  /* The class's live page. o: {code, signedIn}. Returns {fromPoll(data)}:
     the page hands it every full poll answer. */
  function student(o) {
    var url = "/api/live/" + encodeURIComponent(o.code);
    var sentSteps = {}, passed = {}, guessed = {};
    var lastSlide = null, partySeen = null, timerEnd = 0, timerTotal = 0, upUntil = 0;

    function say(body) {
      if (!o.signedIn) return Promise.resolve(null);
      return fetch(url + "/signal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    function toast(text) {
      if (window.PyIDEXP && window.PyIDEXP.toast) { window.PyIDEXP.toast(text); return; }
      var t = el("div", "live-toast", text);
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 3500);
    }

    // A step passed: its card is data-passed after a check (checks_in_notes.js
    // says so with "ide-checks"). Said once per card; the server keeps the first.
    document.addEventListener("ide-checks", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tests-card[data-passed]"), function (card) {
        var k = cardKey(card);
        if (!k || sentSteps[k]) return;
        sentSteps[k] = true;
        passed[k] = true;
        say({ kind: "step", key: k }).then(function (d) {
          if (d && d.rank) toast(d.rank === 1 ? "🥇 You were the first to finish that step!"
                                              : "✓ You were #" + d.rank + " to finish that step");
        });
      });
    });

    // A first prediction, right or not (snippets.js calls this on the first try).
    if (window.IDESnippets) window.IDESnippets.configure({
      onGuess: function (code, guess, right) {
        var k = key(code);
        if (guessed[k]) return;
        guessed[k] = true;
        say({ kind: "guess", key: k, value: guess, right: !!right });
      }
    });

    // I'm stuck / I'm done: one at a time, pressed again to take it down.
    var hands = null, hand = "";
    if (o.signedIn) {
      hands = el("div", "live-hands");
      var stuck = el("button", "btn live-hand", "🙋 I'm stuck");
      var done = el("button", "btn live-hand", "✅ I'm done");
      stuck.type = done.type = "button";
      stuck.title = "Your teacher sees how many are stuck, never who";
      done.title = "Your teacher sees how many are done with this slide, never who";
      function paintHands() {
        stuck.classList.toggle("is-on", hand === "stuck");
        done.classList.toggle("is-on", hand === "done");
        stuck.setAttribute("aria-pressed", hand === "stuck" ? "true" : "false");
        done.setAttribute("aria-pressed", hand === "done" ? "true" : "false");
      }
      function setHand(v) {
        hand = hand === v ? "" : v;
        paintHands();
        say({ kind: "hand", value: hand });
      }
      stuck.addEventListener("click", function () { setHand("stuck"); });
      done.addEventListener("click", function () { setHand("done"); });
      hands.appendChild(stuck);
      hands.appendChild(done);
      document.body.appendChild(hands);
      paintHands();
    }

    // The countdown, counted by this page's own clock from what's left.
    var chip = el("div", "live-timer");
    chip.hidden = true;
    chip.setAttribute("role", "timer");
    document.body.appendChild(chip);
    setInterval(function () {
      var left = timerEnd - Date.now();
      if (timerEnd && left > 0) {
        chip.hidden = false;
        chip.classList.remove("is-up");
        chip.classList.toggle("is-low", left <= 30000);
        chip.textContent = "⏱ " + clock(left);
      } else if (timerEnd && Date.now() < upUntil) {
        chip.hidden = false;
        chip.classList.add("is-up");
        chip.textContent = "⏰ Time's up!";
      } else {
        chip.hidden = true;
      }
    }, 250);

    function fromPoll(d) {
      if (!d) return;
      if (d.ended) {
        timerEnd = 0;
        if (hands) hands.hidden = true;
        return;
      }
      if (hands) hands.hidden = false;
      // The teacher moved on: "done" was for that slide (the server agrees).
      if (typeof d.slide === "string") {
        if (lastSlide !== null && d.slide !== lastSlide && hand === "done") {
          hand = "";
          if (hands) Array.prototype.forEach.call(hands.children, function (b) { b.classList.remove("is-on"); });
        }
        lastSlide = d.slide;
      }
      if (typeof d.timer_left === "number") {
        if (d.timer_left > 0) {
          timerEnd = Date.now() + d.timer_left;
          timerTotal = d.timer_total || 0;
          upUntil = timerEnd + 6000;
        } else if (!d.timer_total) {
          timerEnd = 0;                                  // stopped
        }
      }
      if (typeof d.party_seq === "number") {
        // A party from before this page came in isn't thrown again (see the
        // ask below); before that answer, none is.
        if (partySeen !== null && d.party_seq > partySeen) {
          confetti(passed[d.party_key] ? "🎉 Everyone finished that step! +5 XP"
                                       : "🎉 Everyone finished that step!");
        }
        partySeen = d.party_seq;
      }
    }
    /* Where the parties stood when this page came in, asked once. The first
       full poll answer can't be trusted for it: the teacher's editor pushes
       only when something changes, so a page opened while the teacher sat
       still hears nothing new until the party itself — and took that as
       its starting point, so nobody on it ever saw the confetti. */
    fetch(url + "?v=-1").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (partySeen === null) partySeen = d && typeof d.party_seq === "number" ? d.party_seq : 0;
      })
      .catch(function () { if (partySeen === null) partySeen = 0; });

    return { fromPoll: fromPoll, _timer: function () { return { end: timerEnd, total: timerTotal }; } };
  }

  // ------------------------------------------------------------- the teacher
  /* The teacher's editor. o: {code(), roots(), seq(), after: element the bar's
     chips go after}. Returns {data(), timer()} for the pop-out. */
  function teacher(o) {
    var data = null, partied = {}, timerEnd = 0, timerTotal = 0;

    var hands = el("span", "chip live-hands-count");
    hands.hidden = true;
    hands.title = "How many of the class pressed I'm stuck / I'm done (on this slide). Never who.";
    var tbtn = el("button", "chip live-timer-btn", "⏱ Timer");
    tbtn.type = "button";
    tbtn.hidden = true;
    tbtn.title = "A countdown on every student's screen";
    var menu = el("div", "live-timer-menu");
    menu.hidden = true;
    [1, 3, 5, 10].forEach(function (m) {
      var b = el("button", "btn", m + " min");
      b.type = "button";
      b.addEventListener("click", function () { setTimer(m * 60); });
      menu.appendChild(b);
    });
    var stop = el("button", "btn", "Stop");
    stop.type = "button";
    stop.addEventListener("click", function () { setTimer(0); });
    menu.appendChild(stop);
    var anchor = o.after && o.after.parentNode ? o.after : null;
    if (anchor) {
      anchor.parentNode.insertBefore(menu, anchor.nextSibling);
      anchor.parentNode.insertBefore(tbtn, anchor.nextSibling);
      anchor.parentNode.insertBefore(hands, anchor.nextSibling);
    }
    tbtn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });

    function extra(body) {
      var code = o.code();
      if (!code) return Promise.resolve(null);
      body.seq = o.seq();
      return fetch("/api/live/" + encodeURIComponent(code) + "/extra", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().catch(function () { return null; }); })
        .catch(function () { return null; });
    }
    function setTimer(secs) {
      menu.hidden = true;
      timerEnd = secs ? Date.now() + secs * 1000 : 0;
      timerTotal = secs;
      paintTimer();
      extra({ timer: secs });
    }
    function paintTimer() {
      var live = !!o.code(), left = timerEnd - Date.now();
      tbtn.hidden = !live;
      if (!live) { menu.hidden = true; timerEnd = 0; }
      tbtn.classList.toggle("is-running", timerEnd > 0 && left > 0);
      tbtn.classList.toggle("is-low", timerEnd > 0 && left > 0 && left <= 30000);
      tbtn.textContent = timerEnd && left > 0 ? "⏱ " + clock(left)
                       : timerEnd && left > -6000 ? "⏰ Time's up" : "⏱ Timer";
    }
    setInterval(paintTimer, 250);

    function paintAll() {
      (o.roots() || []).forEach(function (r) { paint(r, data); });
      hands.hidden = !(o.code() && data);
      if (data) {
        var text = "🙋 " + data.stuck + " stuck · ✅ " + data.done + " done";
        if (hands.textContent !== text) hands.textContent = text;
        hands.classList.toggle("has-stuck", data.stuck > 0);
      }
    }

    // The whole class here has passed a step: the party, once a step. The
    // server checks it again and pays the XP.
    function maybeParty() {
      if (!data || typeof data.here !== "number" || data.here < 2) return;
      Object.keys(data.steps || {}).forEach(function (k) {
        if (partied[k] || data.steps[k] < data.here) return;
        partied[k] = true;
        extra({ party: k });
      });
    }

    function ask() {
      var code = o.code();
      if (!code) { if (data) { data = null; paintAll(); } partied = {}; return; }
      fetch("/api/live/" + encodeURIComponent(code) + "/class")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || o.code() !== code) return;
          data = d;
          paintAll();
          maybeParty();
        })
        .catch(function () { /* the next ask will do */ });
    }
    var again = "MutationObserver" in window
      ? new MutationObserver(function () { if (data) (o.roots() || []).forEach(function (r) { paint(r, data); }); }) : null;
    var watched = [];
    setInterval(function () {
      if (again) (o.roots() || []).forEach(function (r) {
        if (!r || watched.indexOf(r) >= 0) return;
        watched.push(r);
        again.observe(r, { childList: true, subtree: true });
      });
      ask();
    }, CLASS_MS);

    return {
      data: function () { return data; },
      timer: function () { return { end: timerEnd, total: timerTotal }; }
    };
  }

  return { key: key, cardKey: cardKey, predictKey: predictKey, paint: paint, clock: clock,
           confetti: confetti, student: student, teacher: teacher };
})();
