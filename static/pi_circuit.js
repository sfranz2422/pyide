/* PyIDE — the simulated Raspberry Pi's breadboard, as data: the Pi 3 B+'s
 * 40-pin header, a breadboard, the parts a student plugged in and the jumper
 * wires between them, and what all that does when the program sets its pins.
 *
 *   PyIDEPiCircuit.create()            an empty circuit
 *   PyIDEPiCircuit.load(text)          from circuit.pi (JSON), or empty
 *   PyIDEPiCircuit.save(circuit)       to circuit.pi's text ("" when empty)
 *   PyIDEPiCircuit.evaluate(circuit, pins)
 *       pins: {17: {mode: "out", value: 1}, 2: {mode: "in"}, ...} (BCM numbers)
 *       → {lit: {partId: brightness}, sounding: {partId: true},
 *          reads: {bcm: 0|1}, warnings: [text]}
 *
 * Pure: no DOM, so tools/test_pi_circuit.py runs it in node, as
 * world_model.js is. pi_board.js draws it and pi.js drives it.
 *
 * Students wire it themselves (the teacher's choice), so it has to be wrong
 * in the ways a real one is wrong, or wiring it teaches nothing:
 *   - a strip of five holes is one conductor; the centre gap breaks it;
 *   - an LED only lights the right way round (its long leg, the anode, to
 *     the + side), and with no resistor it lights but is flagged — on a real
 *     Pi that is how an LED or a pin gets burnt out;
 *   - a button reads pressed only when pressing it joins the pin to GND
 *     (gpiozero's Button pulls the pin up, so pressed reads low);
 *   - joining a powered pin straight to GND is flagged as a short.
 * It is not a circuit simulator: there are no volts or amps, only "is there
 * a way from a + to a − through this part, the right way round".
 */
window.PyIDEPiCircuit = (function () {
  "use strict";

  /* The header, by physical pin number (1–40, odd on the inside row as on
     the board: pin 1 is the square pad nearest the corner). A number is a
     GPIO's BCM number; strings are the fixed pins. */
  var HEADER = [null,
    "3V3", "5V", 2, "5V", 3, "GND", 4, 14, "GND", 15,
    17, 18, 27, "GND", 22, 23, "3V3", 24, 10, "GND",
    9, 25, 11, 8, "GND", 7, "ID_SD", "ID_SC", 5, "GND",
    6, 12, 13, "GND", 19, 16, 26, 20, "GND", 21];

  // The breadboard: 30 columns; rows a–e above the centre gap, f–j below;
  // a + and a − rail along the top and along the bottom.
  var COLS = 30;
  var ROWS_TOP = ["a", "b", "c", "d", "e"], ROWS_BOTTOM = ["f", "g", "h", "i", "j"];
  var RAILS = ["t+", "t-", "b+", "b-"];

  // How many columns (or rows) apart a part's two legs are, as placed by
  // the board; the model takes whatever legs it is given.
  var PARTS = {
    led: { legs: 2, label: "LED" },
    resistor: { legs: 2, label: "Resistor" },
    button: { legs: 2, label: "Push button" },
    buzzer: { legs: 2, label: "Buzzer" }
  };
  var LED_COLOURS = ["red", "yellow", "green", "blue", "white"];

  function create() { return { v: 1, parts: [], wires: [], next: 1 }; }

  function load(text) {
    var c = create();
    if (!text || !String(text).trim()) return c;
    var data;
    try { data = JSON.parse(text); } catch (e) { return c; }
    if (!data || typeof data !== "object") return c;
    (Array.isArray(data.parts) ? data.parts : []).forEach(function (p) {
      if (!p || !PARTS[p.type] || !Array.isArray(p.legs) || p.legs.length !== 2) return;
      if (!p.legs.every(isPoint)) return;
      var part = { id: String(p.id || ("p" + c.next)), type: p.type, legs: p.legs.slice() };
      if (p.type === "led") part.colour = LED_COLOURS.indexOf(p.colour) >= 0 ? p.colour : "red";
      if (p.type === "resistor") part.ohms = Number(p.ohms) > 0 ? Number(p.ohms) : 330;
      c.parts.push(part);
    });
    (Array.isArray(data.wires) ? data.wires : []).forEach(function (w) {
      if (!w || !isPoint(w.from) || !isPoint(w.to) || w.from === w.to) return;
      c.wires.push({ id: String(w.id || ("w" + c.next)), from: w.from, to: w.to, colour: String(w.colour || "") });
    });
    // Ids stay unique however the file was edited.
    var seen = {};
    c.parts.concat(c.wires).forEach(function (x) {
      while (seen[x.id]) x.id = x.id + "x";
      seen[x.id] = true;
    });
    c.next = c.parts.length + c.wires.length + 1;
    return c;
  }

  /* Canonical: the same circuit always saves the same text, so opening and
     closing the board without changing it saves (and turns in) nothing. */
  function save(c) {
    if (!c.parts.length && !c.wires.length) return "";
    return JSON.stringify({
      v: 1,
      parts: c.parts.map(function (p) {
        var o = { id: p.id, type: p.type, legs: p.legs };
        if (p.colour) o.colour = p.colour;
        if (p.ohms) o.ohms = p.ohms;
        return o;
      }),
      wires: c.wires.map(function (w) { return { id: w.id, from: w.from, to: w.to, colour: w.colour || "" }; })
    });
  }

  /* -------------------------------------------------------------- points */
  // A point is a header pin ("P1"–"P40"), a hole ("a1"–"j30") or a rail hole
  // ("t+1", "b-30").
  function isPoint(s) {
    if (typeof s !== "string") return false;
    var m = /^P(\d+)$/.exec(s);
    if (m) return +m[1] >= 1 && +m[1] <= 40;
    m = /^([a-j]|t\+|t-|b\+|b-)(\d+)$/.exec(s);
    return !!m && +m[2] >= 1 && +m[2] <= COLS;
  }

  /* Which conductor a point is on, before any wire: a hole's strip of five,
     a rail's whole length, a header pin by itself. */
  function stripOf(p) {
    var m = /^([a-j])(\d+)$/.exec(p);
    if (m) return (ROWS_TOP.indexOf(m[1]) >= 0 ? "top" : "bottom") + m[2];
    m = /^(t\+|t-|b\+|b-)\d+$/.exec(p);
    if (m) return "rail" + m[1];
    return p;
  }

  // What a header pin is: "3V3", "5V", "GND", "ID_SD"…, or a BCM number.
  function pinRole(p) {
    var m = /^P(\d+)$/.exec(p);
    return m ? HEADER[+m[1]] : null;
  }
  function physicalOf(bcm) {
    for (var i = 1; i <= 40; i++) if (HEADER[i] === bcm) return i;
    return null;
  }

  /* ------------------------------------------------------------- the nets */
  function Union() { this.up = {}; }
  Union.prototype.find = function (a) {
    if (!(a in this.up)) this.up[a] = a;
    while (this.up[a] !== a) { this.up[a] = this.up[this.up[a]]; a = this.up[a]; }
    return a;
  };
  Union.prototype.join = function (a, b) {
    var x = this.find(a), y = this.find(b);
    if (x !== y) this.up[x] = y;
  };

  /* Everything that is one conductor: strips, rails, wires, and a button
     while it is held down (pressed: {partId: true}). */
  function nets(c, pressed) {
    var u = new Union();
    c.wires.forEach(function (w) { u.join(stripOf(w.from), stripOf(w.to)); });
    c.parts.forEach(function (p) {
      p.legs.forEach(function (l) { u.find(stripOf(l)); });
      if (p.type === "button" && pressed && pressed[p.id]) u.join(stripOf(p.legs[0]), stripOf(p.legs[1]));
    });
    for (var i = 1; i <= 40; i++) u.find("P" + i);
    // All the GND pins are one conductor on the board itself; so are 3V3 and 5V.
    var first = {};
    for (var j = 1; j <= 40; j++) {
      var role = HEADER[j];
      if (role === "GND" || role === "3V3" || role === "5V") {
        if (first[role]) u.join(first[role], "P" + j);
        else first[role] = "P" + j;
      }
    }
    return u;
  }

  /* ----------------------------------------------------------- evaluating */
  /* pins: {bcm: {mode: "out", value: 0..1} | {mode: "in"}}. A pin the program
     hasn't set up is left floating — it neither powers nor grounds anything,
     as an unconfigured pin on a Pi doesn't. */
  function evaluate(c, pins, pressed) {
    pins = pins || {};
    var u = nets(c, pressed);
    var high = {}, low = {}, level = {};
    for (var i = 1; i <= 40; i++) {
      var role = HEADER[i], net = u.find("P" + i);
      if (role === "3V3" || role === "5V") { high[net] = true; level[net] = Math.max(level[net] || 0, 1); }
      else if (role === "GND") low[net] = true;
      else if (typeof role === "number" && pins[role] && pins[role].mode === "out") {
        var v = Math.max(0, Math.min(1, Number(pins[role].value) || 0));
        if (v > 0) { high[net] = true; level[net] = Math.max(level[net] || 0, v); }
        else low[net] = true;
      }
    }
    var warnings = [];
    Object.keys(high).forEach(function (n) {
      if (low[n]) warnings.push("Short circuit: a powered pin is wired straight to GND. On a real Pi this can damage it.");
    });

    /* Parts as one-way (LED, buzzer) or two-way (resistor) links between
       nets. A net can be driven high if a + reaches it through parts that
       let current that way; it can sink if it reaches a − the same way. */
    var parts = c.parts.filter(function (p) { return p.type !== "button"; });
    function netOf(p, k) { return u.find(stripOf(p.legs[k])); }
    function reach(start, forward) {
      // forward: from + towards −, through LEDs/buzzers anode→cathode.
      var seen = {}, queue = Object.keys(start), through = {};
      queue.forEach(function (n) { seen[n] = true; });
      while (queue.length) {
        var n = queue.shift();
        parts.forEach(function (p) {
          var a = netOf(p, 0), b = netOf(p, 1), next = null;
          if (p.type === "resistor") next = n === a ? b : n === b ? a : null;
          else next = forward ? (n === a ? b : null) : (n === b ? a : null);
          if (next !== null && !seen[next]) {
            seen[next] = true;
            if (p.type === "resistor") through[next] = true;
            if (through[n]) through[next] = true;
            queue.push(next);
          }
        });
      }
      return { seen: seen, resisted: through };
    }
    var fromHigh = reach(high, true), toLow = reach(low, false);

    var lit = {}, sounding = {};
    parts.forEach(function (p) {
      if (p.type === "resistor") return;
      var a = netOf(p, 0), b = netOf(p, 1);
      if (!(fromHigh.seen[a] && toLow.seen[b])) return;
      if (a === b) return;                      // both legs in one strip: shorted out
      if (p.type === "led") {
        lit[p.id] = levelInto(a);
        if (!fromHigh.resisted[a] && !toLow.resisted[b]) {
          warnings.push("An LED is lit with no resistor in its path. On a real Pi that burns it out — add a 330Ω resistor.");
        }
      } else if (p.type === "buzzer") {
        sounding[p.id] = true;
      }
    });
    // How bright: the strongest pin that powers the net (PWM brightness).
    function levelInto(net) {
      if (level[net]) return level[net];
      var best = 0;
      Object.keys(level).forEach(function (n) { if (high[n]) best = Math.max(best, level[n]); });
      return best || 1;
    }

    /* Inputs: gpiozero's Button pulls its pin up, so it reads 1 unless the
       pin's net is joined to a − (GND, or a pin set low). Pressed = 0. */
    var reads = {};
    Object.keys(pins).forEach(function (bcm) {
      if (pins[bcm].mode !== "in") return;
      var phys = physicalOf(+bcm);
      if (!phys) return;
      var net = u.find("P" + phys);
      if (pins[bcm].pull === "down") reads[bcm] = high[net] ? 1 : 0;
      else reads[bcm] = low[net] ? 0 : 1;
    });
    return { lit: lit, sounding: sounding, reads: reads, warnings: unique(warnings) };
  }

  function unique(list) {
    var out = [];
    list.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ------------------------------------------------------------- editing */
  function addPart(c, type, legs, extra) {
    if (!PARTS[type] || !Array.isArray(legs) || legs.length !== 2 || !legs.every(isPoint)) return null;
    var p = { id: "p" + (c.next++), type: type, legs: legs.slice() };
    if (type === "led") p.colour = (extra && LED_COLOURS.indexOf(extra.colour) >= 0) ? extra.colour : "red";
    if (type === "resistor") p.ohms = (extra && Number(extra.ohms) > 0) ? Number(extra.ohms) : 330;
    c.parts.push(p);
    return p;
  }
  function addWire(c, from, to, colour) {
    if (!isPoint(from) || !isPoint(to) || from === to) return null;
    var w = { id: "w" + (c.next++), from: from, to: to, colour: colour || "" };
    c.wires.push(w);
    return w;
  }
  function remove(c, id) {
    var n = c.parts.length + c.wires.length;
    c.parts = c.parts.filter(function (p) { return p.id !== id; });
    c.wires = c.wires.filter(function (w) { return w.id !== id; });
    return c.parts.length + c.wires.length < n;
  }
  // Every hole a part or wire end already uses: one thing per hole, as on a real board.
  function used(c) {
    var out = {};
    c.parts.forEach(function (p) { p.legs.forEach(function (l) { out[l] = p.id; }); });
    c.wires.forEach(function (w) { out[w.from] = out[w.from] || w.id; out[w.to] = out[w.to] || w.id; });
    return out;
  }

  return {
    HEADER: HEADER, COLS: COLS, ROWS_TOP: ROWS_TOP, ROWS_BOTTOM: ROWS_BOTTOM, RAILS: RAILS,
    PARTS: PARTS, LED_COLOURS: LED_COLOURS,
    create: create, load: load, save: save,
    isPoint: isPoint, stripOf: stripOf, pinRole: pinRole, physicalOf: physicalOf,
    evaluate: evaluate, addPart: addPart, addWire: addWire, remove: remove, used: used
  };
})();
