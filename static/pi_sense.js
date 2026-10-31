/* PyIDE — the simulated Raspberry Pi's Sense HAT, drawn: the 8×8 LED matrix,
 * the joystick, and sliders for what its sensors read, as the official
 * Sense HAT emulator has them (the book's "from sense_emu import SenseHat").
 *
 *   var hat = PyIDEPiSense.mount(el, {
 *     env: function () { the readings: {temperature, humidity, pressure, pitch, roll, yaw} },
 *     setEnv: function (name, value) { a slider moved },
 *     stick: function (direction, action) { the joystick: "up".."middle", "pressed"|"held"|"released" }
 *   });
 *   hat.paint(framebuffer, lowLight)   64 RGB565 values as 256 hex digits, row by row
 *
 * Drawing only: pi.js keeps the LEDs, the readings and the joystick's events.
 */
window.PyIDEPiSense = (function () {
  "use strict";

  // The emulator's ranges.
  var SLIDERS = [
    { name: "temperature", label: "Temperature", unit: "°C", min: -30, max: 105, step: 0.1 },
    { name: "pressure", label: "Pressure", unit: "mbar", min: 260, max: 1260, step: 0.5 },
    { name: "humidity", label: "Humidity", unit: "%", min: 0, max: 100, step: 0.1 },
    { name: "pitch", label: "Pitch", unit: "°", min: 0, max: 360, step: 1 },
    { name: "roll", label: "Roll", unit: "°", min: 0, max: 360, step: 1 },
    { name: "yaw", label: "Yaw (compass)", unit: "°", min: 0, max: 360, step: 1 }
  ];
  var KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "middle", " ": "middle" };
  // Held down, the real stick repeats "held" (the kernel's key repeat).
  var HOLD_AFTER = 500, HOLD_EVERY = 100;

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

  function colourOf(v, low) {
    var r = (v >> 11 & 0x1f) << 3, g = (v >> 5 & 0x3f) << 2, b = (v & 0x1f) << 3;
    if (!r && !g && !b) return null;
    var k = low ? 0.45 : 1;
    // A dim colour still glows on a real LED: lift it a little, keep its hue.
    var top = Math.max(r, g, b), lift = top ? Math.min(255 / top, 1 + 120 / top) : 1;
    function c(x) { return Math.round(Math.min(255, x * lift) * k); }
    return "rgb(" + c(r) + "," + c(g) + "," + c(b) + ")";
  }

  function mount(host, opts) {
    host.innerHTML = "";
    var root = html("div", { "class": "pi-sense", tabindex: "0",
                             "aria-label": "Sense HAT: arrow keys and Enter push the joystick" });
    var matrix = html("div", { "class": "pi-sense-matrix" });
    var leds = [];
    for (var i = 0; i < 64; i++) {
      var led = html("span", { "class": "pi-sense-led" });
      leds.push(led);
      matrix.appendChild(led);
    }

    /* The joystick: hold a direction down, as on the board. */
    var holding = null, holdTimer = null;
    function press(dir) {
      if (holding === dir) return;
      if (holding) release();
      holding = dir;
      opts.stick(dir, "pressed");
      paintStick();
      holdTimer = setTimeout(function repeat() {
        if (holding !== dir) return;
        opts.stick(dir, "held");
        holdTimer = setTimeout(repeat, HOLD_EVERY);
      }, HOLD_AFTER);
    }
    function release() {
      if (!holding) return;
      var dir = holding;
      holding = null;
      clearTimeout(holdTimer);
      opts.stick(dir, "released");
      paintStick();
    }
    var stickButtons = {};
    var stick = html("div", { "class": "pi-sense-stick", title: "The joystick: hold a direction down, or use the arrow keys and Enter" });
    [["", ""], ["up", "▲"], ["", ""], ["left", "◀"], ["middle", "●"], ["right", "▶"], ["", ""], ["down", "▼"], ["", ""]]
      .forEach(function (d) {
        if (!d[0]) { stick.appendChild(html("span")); return; }
        var b = html("button", { type: "button", "class": "pi-sense-dir", "data-dir": d[0], "aria-label": d[0], text: d[1] });
        b.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          try { b.setPointerCapture(e.pointerId); } catch (err) { /* not everywhere */ }
          root.focus();
          press(d[0]);
        });
        b.addEventListener("pointerup", release);
        b.addEventListener("pointercancel", release);
        b.addEventListener("lostpointercapture", release);
        stickButtons[d[0]] = b;
        stick.appendChild(b);
      });
    function paintStick() {
      Object.keys(stickButtons).forEach(function (k) {
        stickButtons[k].classList.toggle("is-pressed", holding === k);
      });
    }
    root.addEventListener("keydown", function (e) {
      var dir = KEYS[e.key];
      if (!dir) return;
      e.preventDefault();
      if (!e.repeat) press(dir);
    });
    root.addEventListener("keyup", function (e) { if (KEYS[e.key] === holding) release(); });
    root.addEventListener("blur", release);

    /* The sensors. */
    var sliders = html("div", { "class": "pi-sense-sliders" });
    var outs = {};
    SLIDERS.forEach(function (s) {
      var value = opts.env()[s.name];
      var out = html("output", { "class": "pi-sense-value" });
      var input = html("input", { type: "range", min: s.min, max: s.max, step: s.step, value: value,
                                  "aria-label": s.label });
      function show(v) { out.textContent = (+v).toFixed(s.step < 1 ? 1 : 0) + " " + s.unit; }
      input.addEventListener("input", function () { opts.setEnv(s.name, +input.value); show(input.value); });
      // Keys on a slider move the slider, not the joystick.
      input.addEventListener("keydown", function (e) { e.stopPropagation(); });
      show(value);
      outs[s.name] = { input: input, show: show };
      sliders.appendChild(html("label", { "class": "pi-sense-slider" },
        [html("span", { "class": "pi-sense-name", text: s.label }), input, out]));
    });

    var board = html("div", { "class": "pi-sense-board" }, [
      html("div", { "class": "pi-sense-title", text: "Sense HAT" }), matrix, stick]);
    root.appendChild(board);
    root.appendChild(sliders);
    host.appendChild(root);

    return {
      paint: function (fb, low) {
        for (var i = 0; i < 64; i++) {
          var c = colourOf(parseInt(fb.substr(i * 4, 4), 16) || 0, low);
          leds[i].style.background = c || "";
          leds[i].style.boxShadow = c ? "0 0 6px 1px " + c : "";
          leds[i].classList.toggle("is-on", !!c);
        }
      },
      // After the readings were set from outside (a test), move the sliders.
      refresh: function () {
        var env = opts.env();
        Object.keys(outs).forEach(function (k) { outs[k].input.value = env[k]; outs[k].show(env[k]); });
      }
    };
  }

  return { mount: mount, SLIDERS: SLIDERS };
})();
