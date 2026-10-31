/* PyIDE — turtle graphics, the page's side: the canvas that Python's turtle
 * module (static/py/pi/turtle.py) draws on, through window.PyIDEPi.
 *
 *   PyIDETurtle.op(json)     one drawing command from Python (below)
 *   PyIDETurtle.events()     → JSON of keys and clicks since last asked
 *   PyIDETurtle.mount(el)    the canvas; .reset() as a run begins
 *
 * Commands: ["reset", w, h], ["size", w, h], ["bg", colour], ["title", t],
 * ["listen"], ["line", id, x1, y1, x2, y2, colour, width], ["dot", id, x, y,
 * size, colour], ["text", id, x, y, text, align, family, size, style,
 * colour], ["fillmark", id], ["fill", id, points, colour], ["stamp", id, x,
 * y, heading, shape, pen, fill, stretch], ["clear", id], ["turtle", id, x,
 * y, heading, visible, shape, pen, fill, stretch].
 *
 * Turtle's coordinates: (0, 0) in the middle, y up, a unit a pixel. The
 * drawing is kept as its list of commands, so a fill can go under the lines
 * drawn while it was being made (as desktop turtle's does) and the canvas
 * can be drawn again at any size. Turtles themselves go on a second canvas
 * on top, redrawn every frame.
 */
window.PyIDETurtle = (function () {
  "use strict";

  var hasDom = typeof document !== "undefined" && typeof document.createElement === "function";
  var ops = [];               // the drawing, in order
  var turtles = {};           // id -> the turtle's latest ["turtle", ...]
  var queue = [];             // keys and clicks for Python
  var size = { w: 640, h: 480 }, bg = "#ffffff";
  var view = null, drawn = 0, dirty = false, full = false;

  // Tk's names for the keys turtle's onkey takes.
  var KEYS = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", " ": "space",
               Enter: "Return", Escape: "Escape", Tab: "Tab", Backspace: "BackSpace", Delete: "Delete" };

  function op(json) {
    var o;
    try { o = JSON.parse(String(json)); } catch (e) { return; }
    var kind = o[0];
    if (kind === "reset") {
      ops = [];
      turtles = {};
      size = { w: o[1], h: o[2] };
      bg = "#ffffff";
      full = true;
    } else if (kind === "size") {
      size = { w: Math.max(50, Math.min(4000, o[1])), h: Math.max(50, Math.min(4000, o[2])) };
      full = true;
    } else if (kind === "bg") {
      bg = o[1];
      full = true;
    } else if (kind === "title") {
      if (view) view.title.textContent = o[1];
    } else if (kind === "listen") {
      if (view) view.root.focus();
    } else if (kind === "turtle") {
      turtles[o[1]] = o;
    } else if (kind === "clear") {
      ops = ops.filter(function (x) { return x[1] !== o[1]; });
      full = true;
    } else if (kind === "fill") {
      // Under the lines drawn since its begin_fill: in at the mark.
      for (var i = ops.length - 1; i >= 0; i--) {
        if (ops[i][0] === "fillmark" && ops[i][1] === o[1]) { ops[i] = o; break; }
      }
      if (i < 0) ops.push(o);
      full = true;
    } else {
      ops.push(o);
    }
    dirty = true;
    schedule();
  }

  var pending = false;
  function schedule() {
    if (pending || !view) return;
    pending = true;
    var go = function () { pending = false; paint(); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
    else setTimeout(go, 16);
  }

  /* ---------------------------------------------------------- drawing */
  function toCanvas(x, y) { return [size.w / 2 + x, size.h / 2 - y]; }

  function drawOp(ctx, o) {
    var p, q;
    if (o[0] === "line") {
      p = toCanvas(o[2], o[3]); q = toCanvas(o[4], o[5]);
      ctx.strokeStyle = o[6];
      ctx.lineWidth = Math.max(1, o[7]);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    } else if (o[0] === "dot") {
      p = toCanvas(o[2], o[3]);
      ctx.fillStyle = o[5];
      ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.5, o[4] / 2), 0, Math.PI * 2); ctx.fill();
    } else if (o[0] === "fill") {
      ctx.fillStyle = o[3];
      ctx.beginPath();
      o[2].forEach(function (pt, i) { var c = toCanvas(pt[0], pt[1]); if (i) ctx.lineTo(c[0], c[1]); else ctx.moveTo(c[0], c[1]); });
      ctx.closePath();
      ctx.fill("evenodd");
    } else if (o[0] === "text") {
      p = toCanvas(o[2], o[3]);
      var style = String(o[8] || "normal");
      ctx.font = (style.indexOf("italic") >= 0 ? "italic " : "") + (style.indexOf("bold") >= 0 ? "bold " : "") +
        Math.round(o[7] * 1.33) + "px " + JSON.stringify(String(o[6])) + ", sans-serif";
      ctx.fillStyle = o[9];
      ctx.textAlign = o[5] === "center" ? "center" : o[5] === "right" ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(o[4], p[0], p[1]);
    } else if (o[0] === "stamp") {
      drawShape(ctx, o[2], o[3], o[4], o[5], o[6], o[7], o[8]);
    }
  }

  function drawShape(ctx, x, y, heading, shape, pen, fill, stretch) {
    if (!shape || !shape.length) return;
    var p = toCanvas(x, y);
    ctx.save();
    ctx.translate(p[0], p[1]);
    // Shapes point along +y; a heading of 0 is east. Canvas y is down.
    ctx.rotate(-(heading - 90) * Math.PI / 180);
    ctx.scale(stretch ? stretch[1] : 1, stretch ? stretch[0] : 1);
    ctx.beginPath();
    shape.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], -pt[1]); else ctx.moveTo(pt[0], -pt[1]); });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = pen;
    ctx.stroke();
    ctx.restore();
  }

  function paint() {
    if (!view) return;
    var c = view.canvas, top = view.top;
    if (c.width !== size.w || c.height !== size.h) {
      c.width = top.width = size.w;
      c.height = top.height = size.h;
      full = true;
    }
    var ctx = c.getContext("2d");
    if (full) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size.w, size.h);
      drawn = 0;
      full = false;
    }
    for (; drawn < ops.length; drawn++) drawOp(ctx, ops[drawn]);
    var t = top.getContext("2d");
    t.clearRect(0, 0, size.w, size.h);
    Object.keys(turtles).forEach(function (id) {
      var o = turtles[id];
      if (o[5]) drawShape(t, o[2], o[3], o[4], o[6], o[7], o[8], o[9]);
    });
    dirty = false;
  }

  /* ------------------------------------------------------------ input */
  function events() {
    var out = JSON.stringify(queue);
    queue = [];
    return out;
  }
  function push(e) {
    queue.push(e);
    if (queue.length > 200) queue.shift();
  }
  function keyName(e) { return KEYS[e.key] || e.key; }

  function mount(host) {
    if (!hasDom) return;
    host.innerHTML = "";
    var root = document.createElement("div");
    root.className = "pi-turtle";
    root.tabIndex = 0;
    root.setAttribute("aria-label", "Turtle graphics: click here for the keys to reach the program");
    var title = document.createElement("div");
    title.className = "pi-turtle-title";
    title.textContent = "Python Turtle Graphics";
    var stack = document.createElement("div");
    stack.className = "pi-turtle-stack";
    var canvas = document.createElement("canvas");
    var top = document.createElement("canvas");
    canvas.className = "pi-turtle-canvas";
    top.className = "pi-turtle-top";
    stack.appendChild(canvas);
    stack.appendChild(top);
    root.appendChild(title);
    root.appendChild(stack);
    host.appendChild(root);
    view = { root: root, canvas: canvas, top: top, title: title };
    root.addEventListener("keydown", function (e) {
      var k = keyName(e);
      if (!k) return;
      if (KEYS[e.key] || e.key.length === 1) e.preventDefault();
      push(["press", k]);         // held down, it repeats, as Tk's does
    });
    root.addEventListener("keyup", function (e) { var k = keyName(e); if (k) push(["release", k]); });
    top.addEventListener("pointerdown", function (e) {
      root.focus();
      var r = top.getBoundingClientRect();
      var x = (e.clientX - r.left) * size.w / r.width - size.w / 2;
      var y = size.h / 2 - (e.clientY - r.top) * size.h / r.height;
      push(["click", Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    });
    full = true;
    paint();
  }

  return {
    op: op, events: events, mount: mount,
    // For tests: the drawing as commands, and the turtles.
    drawing: function () { return { ops: ops, turtles: turtles, size: size, bg: bg }; },
    push: push
  };
})();
