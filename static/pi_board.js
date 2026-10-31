/* PyIDE — the simulated Raspberry Pi's breadboard, drawn: the Pi 3 B+'s
 * GPIO header on the left, a breadboard on the right, and a tray of parts.
 * Students wire it themselves (the teacher's choice): pick a part, click a
 * hole to plug it in; pick Wire, click two holes or pins to join them.
 *
 *   var board = PyIDEPiBoard.mount(el, {
 *     circuit: function () { return the circuit (pi_circuit.js) },
 *     edited: function () { the student changed the wiring },
 *     press: function (partId, down) { a push button went down or up },
 *     readonly: bool
 *   });
 *   board.paint(result)     what evaluate() said: lit LEDs, buzzers, warnings
 *   board.redraw()          after the circuit was replaced
 *
 * Drawing only: what the circuit does is pi_circuit.js's, and pi.js owns the
 * circuit and the pins.
 */
window.PyIDEPiBoard = (function () {
  "use strict";

  var C = window.PyIDEPiCircuit;
  var SVGNS = "http://www.w3.org/2000/svg";
  var P = 16;                         // hole pitch
  var HX = 62, HY = 40;               // header's top-left pin (labels go either side)
  var BX = 236, BY = 22;              // breadboard's first hole (rail t+, column 1)
  // Rows top to bottom, with the gaps a real board has between them.
  var ROWS = ["t+", "t-", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "b+", "b-"];
  var ROW_Y = {};
  (function () {
    var y = BY;
    ROWS.forEach(function (r, i) {
      if (r === "a" || r === "b+") y += P * 0.9;      // rail to strip gap
      if (r === "f") y += P * 1.2;                      // the centre gap
      ROW_Y[r] = y;
      y += P;
    });
  })();
  var WIDTH = BX + C.COLS * P + 20, HEIGHT = Math.max(ROW_Y["b-"] + 30, HY + 20 * P + 20);

  var SPANS = { led: 1, resistor: 3, button: 2, buzzer: 1 };
  var WIRE_COLOURS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0f172a", "#ea580c"];
  var ROLE_COLOUR = { "3V3": "#f97316", "5V": "#dc2626", "GND": "#111827" };

  function el(tag, attrs, kids) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function html(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }

  /* Where a point is drawn. */
  function xy(p) {
    var m = /^P(\d+)$/.exec(p);
    if (m) {
      var n = +m[1];
      return { x: HX + (n % 2 ? 0 : P), y: HY + Math.floor((n - 1) / 2) * P };
    }
    m = /^([a-j]|t\+|t-|b\+|b-)(\d+)$/.exec(p);
    return { x: BX + (+m[2] - 1) * P, y: ROW_Y[m[1]] };
  }
  function rowOf(p) { var m = /^([a-j]|t\+|t-|b\+|b-)(\d+)$/.exec(p); return m ? m[1] : null; }
  function colOf(p) { var m = /^([a-j]|t\+|t-|b\+|b-)(\d+)$/.exec(p); return m ? +m[2] : null; }

  // A part's second leg, from where its first leg went in.
  function secondLeg(first, type, vertical) {
    var r = rowOf(first), c = colOf(first), span = SPANS[type];
    if (!r) return null;
    if (vertical) {
      var i = ROWS.indexOf(r) + span;
      return i < ROWS.length ? ROWS[i] + c : null;
    }
    return c + span <= C.COLS ? r + (c + span) : null;
  }

  function roleText(role) {
    if (typeof role === "number") return "GPIO" + role;
    if (role === "ID_SD" || role === "ID_SC") return "DNC";
    return role;
  }

  function mount(host, opts) {
    var circuit = opts.circuit;
    var state = { tool: null, vertical: false, colour: "red", wireFrom: null, selected: null, hover: null, result: null };
    host.classList.add("pi-board");
    host.textContent = "";

    /* --------------------------------------------------------- the tray */
    var tools = {};
    function toolBtn(name, label, title) {
      var b = html("button", { type: "button", class: "pi-tool", "data-tool": name, title: title, text: label,
        onclick: function () { setTool(state.tool === name ? null : name); } });
      tools[name] = b;
      return b;
    }
    var colourSel = html("select", { class: "pi-colour", title: "The LED's colour", onchange: function () { state.colour = this.value; } },
      C.LED_COLOURS.map(function (c) { return html("option", { value: c, text: c }); }));
    var rotateBtn = html("button", { type: "button", class: "pi-tool", title: "Place parts across or up and down (R)",
      text: "↔ Across", onclick: function () { rotate(); } });
    var flipBtn = html("button", { type: "button", class: "pi-tool", title: "Turn the selected LED or buzzer round (F)",
      text: "⇄ Turn round", onclick: function () { flip(); } });
    var delBtn = html("button", { type: "button", class: "pi-tool", title: "Take out the selected part or wire (Delete)",
      text: "✕ Remove", onclick: function () { removeSelected(); } });
    var clearBtn = html("button", { type: "button", class: "pi-tool pi-clear", title: "Take everything off the breadboard",
      text: "Clear board", onclick: function () {
        var c = circuit();
        if (!c.parts.length && !c.wires.length) return;
        if (!window.confirm("Take every part and wire off the breadboard?")) return;
        c.parts = []; c.wires = []; state.selected = null;
        changed();
      } });
    var tray = html("div", { class: "pi-tray" }, [
      toolBtn("led", "💡 LED", "An LED: its long leg (+) goes in first"), colourSel,
      toolBtn("resistor", "▭ Resistor", "A 330Ω resistor"),
      toolBtn("button", "◉ Button", "A push button"),
      toolBtn("buzzer", "🔊 Buzzer", "An active buzzer: its + leg goes in first"),
      toolBtn("wire", "〰 Wire", "A jumper wire: drag from one end to the other, or click one end, then the other"),
      rotateBtn, flipBtn, delBtn, clearBtn
    ]);
    var status = html("div", { class: "pi-status", "aria-live": "polite" });
    var svg = el("svg", { class: "pi-svg", viewBox: "0 0 " + WIDTH + " " + HEIGHT, role: "img",
                          "aria-label": "A Raspberry Pi's GPIO pins and a breadboard" });
    if (!opts.readonly) host.appendChild(tray);
    host.appendChild(svg);
    host.appendChild(status);

    var layers = { base: el("g"), parts: el("g"), wires: el("g"), ghost: el("g", { class: "pi-ghost" }) };
    svg.appendChild(layers.base); svg.appendChild(layers.parts); svg.appendChild(layers.wires); svg.appendChild(layers.ghost);

    /* ----------------------------------------------- header and board */
    function drawBase() {
      var g = layers.base;
      g.textContent = "";
      var hg = el("g", { class: "pi-header" });
      g.appendChild(hg);
      hg.appendChild(el("rect", { x: HX - 56, y: HY - 24, width: P + 112, height: 20 * P + 32, rx: 6, class: "pi-pcb" }));
      hg.appendChild(el("text", { x: HX + P / 2, y: HY - 11, class: "pi-label pi-mid pi-title" }, [document.createTextNode("Raspberry Pi 3 B+ · GPIO")]));
      for (var n = 1; n <= 40; n++) {
        var p = xy("P" + n), role = C.HEADER[n];
        var pin = el("rect", { x: p.x - 5, y: p.y - 5, width: 10, height: 10, rx: n === 1 ? 0 : 2,
          class: "pi-pin pi-point", "data-point": "P" + n,
          fill: ROLE_COLOUR[role] || (typeof role === "number" ? "#16a34a" : "#9ca3af") });
        var t = el("title"); t.textContent = "Pin " + n + ": " + roleText(role);
        pin.appendChild(t);
        hg.appendChild(pin);
        var odd = n % 2 === 1;
        hg.appendChild(el("text", { x: odd ? p.x - 9 : p.x + 9, y: p.y + 3,
          class: "pi-label " + (odd ? "pi-end" : "pi-start") }, [document.createTextNode(roleText(role))]));
      }
      // The breadboard.
      g.appendChild(el("rect", { x: BX - 12, y: BY - 12, width: C.COLS * P + 8, height: ROW_Y["b-"] - BY + 24, rx: 6, class: "pi-bb" }));
      [["t+", "+"], ["t-", "−"], ["b+", "+"], ["b-", "−"]].forEach(function (r) {
        g.appendChild(el("line", { x1: BX - 6, x2: BX + (C.COLS - 1) * P + 6, y1: ROW_Y[r[0]] + (r[0][1] === "+" ? -7 : 7) * (r[0][0] === "t" ? 1 : 1),
          y2: ROW_Y[r[0]] + (r[0][1] === "+" ? -7 : 7), class: r[1] === "+" ? "pi-rail-plus" : "pi-rail-minus" }));
      });
      ROWS.forEach(function (r) {
        if (r.length === 1) g.appendChild(el("text", { x: BX - 10, y: ROW_Y[r] + 3, class: "pi-label pi-end pi-row" }, [document.createTextNode(r)]));
        for (var col = 1; col <= C.COLS; col++) {
          var q = xy(r + col);
          g.appendChild(el("rect", { x: q.x - 3, y: q.y - 3, width: 6, height: 6, rx: 1, class: "pi-hole pi-point", "data-point": r + col }));
        }
      });
      for (var col = 1; col <= C.COLS; col += (col === 1 ? 4 : 5)) {
        g.appendChild(el("text", { x: BX + (col - 1) * P, y: ROW_Y.a - 9, class: "pi-label pi-mid pi-num" }, [document.createTextNode(String(col))]));
      }
    }

    /* ------------------------------------------------ parts and wires */
    function drawParts() {
      var c = circuit(), lit = (state.result && state.result.lit) || {}, sounding = (state.result && state.result.sounding) || {};
      layers.parts.textContent = "";
      layers.wires.textContent = "";
      c.parts.forEach(function (p) {
        var a = xy(p.legs[0]), b = xy(p.legs[1]);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var g = el("g", { class: "pi-part pi-" + p.type + (state.selected === p.id ? " is-selected" : "")
          + (lit[p.id] ? " is-lit" : "") + (sounding[p.id] ? " is-sounding" : "") + (pressedIds[p.id] ? " is-pressed" : ""),
          "data-id": p.id });
        g.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "pi-leg" }));
        if (p.type === "led") {
          var glow = lit[p.id] || 0;
          g.appendChild(el("circle", { cx: mx, cy: my - 8, r: 7, class: "pi-led-body", fill: ledFill(p.colour, glow) }));
          if (glow) g.appendChild(el("circle", { cx: mx, cy: my - 8, r: 13, class: "pi-led-glow", fill: ledFill(p.colour, 1), opacity: 0.25 + 0.35 * glow }));
          g.appendChild(el("text", { x: a.x, y: a.y - 6, class: "pi-label pi-mid pi-plus" }, [document.createTextNode("+")]));
        } else if (p.type === "resistor") {
          g.appendChild(el("rect", { x: mx - 13, y: my - 4.5, width: 26, height: 9, rx: 4, class: "pi-res-body" }));
          // 330Ω: orange, orange, brown, gold.
          [["#f97316", -7], ["#f97316", -3], ["#92400e", 1], ["#ca8a04", 7]].forEach(function (band) {
            g.appendChild(el("rect", { x: mx + band[1], y: my - 4.5, width: 2.2, height: 9, fill: band[0] }));
          });
        } else if (p.type === "button") {
          g.appendChild(el("rect", { x: mx - 10, y: my - 10, width: 20, height: 20, rx: 3, class: "pi-btn-body" }));
          g.appendChild(el("circle", { cx: mx, cy: my, r: 6, class: "pi-btn-cap" }));
        } else if (p.type === "buzzer") {
          g.appendChild(el("circle", { cx: mx, cy: my - 6, r: 10, class: "pi-buzz-body" }));
          g.appendChild(el("circle", { cx: mx, cy: my - 6, r: 2.5, class: "pi-buzz-hole" }));
          g.appendChild(el("text", { x: a.x, y: a.y - 6, class: "pi-label pi-mid pi-plus" }, [document.createTextNode("+")]));
          if (sounding[p.id]) g.appendChild(el("text", { x: mx + 13, y: my - 14, class: "pi-label pi-start pi-sound" }, [document.createTextNode("♪")]));
        }
        [a, b].forEach(function (q) { g.appendChild(el("circle", { cx: q.x, cy: q.y, r: 2.6, class: "pi-foot" })); });
        var tt = el("title"); tt.textContent = describe(p);
        g.appendChild(tt);
        layers.parts.appendChild(g);
      });
      c.wires.forEach(function (w, i) {
        var a = xy(w.from), b = xy(w.to);
        var lift = Math.min(60, 12 + Math.abs(a.x - b.x) * 0.15 + Math.abs(a.y - b.y) * 0.1);
        var d = "M" + a.x + "," + a.y + " C" + a.x + "," + (a.y - lift) + " " + b.x + "," + (b.y - lift) + " " + b.x + "," + b.y;
        var colour = w.colour || WIRE_COLOURS[i % WIRE_COLOURS.length];
        var g = el("g", { class: "pi-wire" + (state.selected === w.id ? " is-selected" : ""), "data-id": w.id });
        g.appendChild(el("path", { d: d, class: "pi-wire-hit" }));
        g.appendChild(el("path", { d: d, class: "pi-wire-line", stroke: colour }));
        [a, b].forEach(function (q) { g.appendChild(el("circle", { cx: q.x, cy: q.y, r: 3.2, fill: colour, class: "pi-wire-end" })); });
        var tt = el("title"); tt.textContent = "Wire: " + pointName(w.from) + " to " + pointName(w.to);
        g.appendChild(tt);
        layers.wires.appendChild(g);
      });
    }
    function ledFill(colour, glow) {
      var on = { red: "#ef4444", yellow: "#facc15", green: "#22c55e", blue: "#3b82f6", white: "#f8fafc" }[colour] || "#ef4444";
      var off = { red: "#7f1d1d", yellow: "#713f12", green: "#14532d", blue: "#1e3a8a", white: "#94a3b8" }[colour] || "#7f1d1d";
      return glow ? on : off;
    }
    // Where a loose end is, in the words a student can check against the board.
    function looseText(p) {
      var r = rowOf(p), col = colOf(p);
      if (r.length === 2) return pointName(p);
      return p + " (column " + col + ", rows " + (C.ROWS_TOP.indexOf(r) >= 0 ? "a–e" : "f–j") + ")";
    }
    function pointName(p) {
      var m = /^P(\d+)$/.exec(p);
      if (m) return "pin " + m[1] + " (" + roleText(C.HEADER[+m[1]]) + ")";
      var r = rowOf(p);
      if (r.length === 2) return (r[0] === "t" ? "top " : "bottom ") + (r[1] === "+" ? "+" : "−") + " rail";
      return "hole " + p;
    }
    function describe(p) {
      var name = p.type === "led" ? p.colour + " LED" : p.type === "resistor" ? (p.ohms || 330) + "Ω resistor" : p.type === "button" ? "push button" : "buzzer";
      var legs = p.type === "led" || p.type === "buzzer"
        ? " (+ in " + pointName(p.legs[0]) + ", − in " + pointName(p.legs[1]) + ")"
        : " (" + pointName(p.legs[0]) + " and " + pointName(p.legs[1]) + ")";
      return name + legs;
    }

    /* ------------------------------------------------------ interaction */
    var pressedIds = {};
    var hint = "";
    function setTool(t) {
      state.tool = t;
      state.wireFrom = null;
      Object.keys(tools).forEach(function (k) { tools[k].classList.toggle("on", k === t); });
      svg.classList.toggle("is-placing", !!t);
      ghost();
      say(t === "wire" ? "Drag from where the wire starts to where it ends (a pin on the Pi or a hole), or click one end, then the other."
        : t ? "Click a hole to plug it in. " + (t === "led" || t === "buzzer" ? "The + (long) leg goes in the hole you click." : "")
        : "");
    }
    function rotate() {
      state.vertical = !state.vertical;
      rotateBtn.textContent = state.vertical ? "↕ Up and down" : "↔ Across";
      ghost();
    }
    function flip() {
      var c = circuit(), p = c.parts.filter(function (x) { return x.id === state.selected; })[0];
      if (!p || opts.readonly) return;
      p.legs = [p.legs[1], p.legs[0]];
      changed();
    }
    function removeSelected() {
      if (!state.selected || opts.readonly) return;
      C.remove(circuit(), state.selected);
      state.selected = null;
      changed();
    }
    function changed() {
      drawParts();
      ghost();
      opts.edited();
    }
    function say(text) {
      hint = text || "";
      var warn = (state.result && state.result.warnings) || [];
      status.textContent = "";
      if (text) status.appendChild(html("div", { class: "pi-hint", text: text }));
      warn.forEach(function (w) { status.appendChild(html("div", { class: "pi-warn", text: "⚠ " + w })); });
      var loose = (state.result && state.result.loose) || [];
      if (loose.length) {
        status.appendChild(html("div", { class: "pi-loose", text: "○ Loose end" + (loose.length > 1 ? "s" : "") + ": " +
          loose.map(looseText).join("; ") + ". Nothing else is plugged in beside " + (loose.length > 1 ? "them" : "it") +
          ", so " + (loose.length > 1 ? "they join" : "it joins") + " nothing." }));
      }
    }
    /* The hole or pin nearest the pointer, within about half a hole's
       spacing. The holes are drawn 6 units across with 16 between them, and
       the board is usually shown smaller than it's drawn, so aiming at the
       hole itself was touchy: a click between two holes did nothing, and one
       a little off went in the next column with no sign it had. */
    var POINTS = [];
    (function () {
      for (var n = 1; n <= 40; n++) POINTS.push({ name: "P" + n, at: xy("P" + n) });
      ROWS.forEach(function (r) { for (var col = 1; col <= C.COLS; col++) POINTS.push({ name: r + col, at: xy(r + col) }); });
    })();
    function pointAt(e) {
      if (typeof e.clientX !== "number" || !svg.getScreenCTM) return null;
      var m = svg.getScreenCTM();
      if (!m) return null;
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var q = pt.matrixTransform(m.inverse()), best = null, bestD = (P * 0.6) * (P * 0.6);
      POINTS.forEach(function (o) {
        var dx = o.at.x - q.x, dy = o.at.y - q.y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = o.name; }
      });
      return best;
    }
    function shortName(p) {
      var m = /^P(\d+)$/.exec(p);
      return m ? "pin " + m[1] + " · " + roleText(C.HEADER[+m[1]]) : pointName(p).replace(/^hole /, "");
    }
    function itemAt(e) {
      var t = e.target.closest ? e.target.closest("[data-id]") : null;
      return t ? t.getAttribute("data-id") : null;
    }
    function free(points) {
      var u = C.used(circuit());
      return points.every(function (p) { return p && !u[p]; });
    }
    function label(p) {
      var q = xy(p), text = shortName(p);
      var w = text.length * 5 + 8, left = q.x + 8 + w > WIDTH ? q.x - 8 - w : q.x + 8;
      layers.ghost.appendChild(el("rect", { x: left, y: q.y - 20, width: w, height: 13, rx: 3, class: "pi-tag" }));
      layers.ghost.appendChild(el("text", { x: left + 4, y: q.y - 10.5, class: "pi-label pi-tag-text" }, [document.createTextNode(text)]));
    }
    function ghost() {
      layers.ghost.textContent = "";
      (state.result && state.result.loose || []).forEach(function (p) {
        var q = xy(p);
        layers.ghost.appendChild(el("circle", { cx: q.x, cy: q.y, r: 6, class: "pi-loose-ring" }));
      });
      if (drag && drag.moved && state.hover) {
        var a0 = xy(drag.from), b0 = xy(state.hover);
        layers.ghost.appendChild(el("line", { x1: a0.x, y1: a0.y, x2: b0.x, y2: b0.y, class: "pi-ghost-wire" }));
      }
      if (state.hover && (state.tool || drag)) label(state.hover);
      if (!state.tool || !state.hover) return;
      if (state.tool === "wire") {
        if (state.wireFrom) {
          var a = xy(state.wireFrom), b = xy(state.hover);
          layers.ghost.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "pi-ghost-wire" }));
        }
        var q = xy(state.hover);
        layers.ghost.appendChild(el("circle", { cx: q.x, cy: q.y, r: 5, class: "pi-ghost-dot" }));
        return;
      }
      if (/^P/.test(state.hover)) return;
      var second = secondLeg(state.hover, state.tool, state.vertical);
      var ok = second && free([state.hover, second]);
      [state.hover, second].forEach(function (p) {
        if (!p) return;
        var r = xy(p);
        layers.ghost.appendChild(el("circle", { cx: r.x, cy: r.y, r: 5, class: ok ? "pi-ghost-dot" : "pi-ghost-bad" }));
      });
    }

    /* A wire can be dragged from one end to the other — with Wire picked,
       or with no tool picked at all, from any hole or pin — as well as
       clicked one end, then the other. */
    var drag = null, swallowClick = false;
    function addWire(from, to) {
      var c = circuit();
      C.addWire(c, from, to, WIRE_COLOURS[c.wires.length % WIRE_COLOURS.length]);
      state.wireFrom = null;
      changed();
      say("Wire added: " + shortName(from) + " to " + shortName(to) + "." +
          (state.tool === "wire" ? " Drag or click the next one, or press Wire again to stop." : ""));
    }
    svg.addEventListener("pointermove", function (e) {
      var p = pointAt(e);
      if (drag && p && p !== drag.from) drag.moved = true;
      if (p !== state.hover || drag) { state.hover = p; ghost(); }
    });
    svg.addEventListener("pointerleave", function () { if (!drag) { state.hover = null; ghost(); } });
    svg.addEventListener("pointerdown", function (e) {
      if (opts.readonly || e.button > 0) return;
      if (state.tool && state.tool !== "wire") return;
      if (!state.tool && itemAt(e)) return;          // a part or wire: select it, or press a button
      var p = pointAt(e);
      if (!p) return;
      drag = { from: p, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not everywhere */ }
    });
    svg.addEventListener("pointerup", function (e) {
      if (!drag) return;
      var d = drag, p = pointAt(e);
      drag = null;
      if (d.moved) {
        swallowClick = true;
        if (p && p !== d.from) addWire(d.from, p);
        else ghost();
      }
    });
    svg.addEventListener("click", function (e) {
      if (swallowClick) { swallowClick = false; return; }
      if (opts.readonly) return;
      var p = pointAt(e);
      if (state.tool === "wire") {
        if (!p) return;
        if (!state.wireFrom) { state.wireFrom = p; say("From " + shortName(p) + ". Now click where the wire ends."); ghost(); return; }
        if (p === state.wireFrom) { state.wireFrom = null; say("Click where the wire starts."); ghost(); return; }
        addWire(state.wireFrom, p);
        return;
      }
      if (state.tool) {
        if (!p || /^P/.test(p)) { say("Parts go in the breadboard's holes. Use a wire to reach the Pi's pins."); return; }
        var second = secondLeg(p, state.tool, state.vertical);
        if (!second) { say("There's no room for it there."); return; }
        if (!free([p, second])) { say("Something is already plugged into one of those holes."); return; }
        C.addPart(circuit(), state.tool, [p, second], { colour: state.colour });
        changed();
        say("In " + p + " and " + second + ".");
        return;
      }
      var id = itemAt(e);
      state.selected = id;
      drawParts();
      if (id) say("Selected. Remove takes it out" + (/^p/.test(id) ? "; Turn round swaps an LED's or buzzer's legs." : "."));
      else say("");
    });

    /* Push buttons: held down with the mouse (or a finger) while no tool is
       picked — the same as holding a real one. */
    svg.addEventListener("pointerdown", function (e) {
      if (state.tool) return;
      var id = itemAt(e);
      var p = id && circuit().parts.filter(function (x) { return x.id === id && x.type === "button"; })[0];
      if (!p) return;
      e.preventDefault();
      pressedIds[p.id] = true;
      drawParts();
      opts.press(p.id, true);
      var up = function () {
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        delete pressedIds[p.id];
        drawParts();
        opts.press(p.id, false);
      };
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });

    host.tabIndex = 0;
    host.addEventListener("keydown", function (e) {
      if (opts.readonly) return;
      if (e.key === "Delete" || e.key === "Backspace") { removeSelected(); e.preventDefault(); }
      else if (e.key === "r" || e.key === "R") rotate();
      else if (e.key === "f" || e.key === "F") flip();
      else if (e.key === "Escape") { setTool(null); state.selected = null; drawParts(); }
    });

    drawBase();
    drawParts();

    return {
      paint: function (result) {
        state.result = result;
        drawParts();
        ghost();
        say(hint);
      },
      redraw: function () { state.selected = null; drawParts(); },
      setReadonly: function (ro) { opts.readonly = !!ro; tray.hidden = !!ro; }
    };
  }

  return { mount: mount, xy: xy };
})();
