/* The teacher's laser pointer, in a live lesson. Identical in PyIDE, WebIDE
 * and FlaskIDE.
 *
 * The teacher holds Alt (Option on a Mac) and moves the mouse over their
 * code or a slide; every student sees a red dot there, with a short trail,
 * until Alt is let go. The highlight already went out with every push, but
 * a yellow block is easy to miss from the back of the room, and pointing at
 * a word on a slide was not possible at all.
 *
 * WHERE, NOT PIXELS. Nobody's screen is the teacher's size, so a place is
 * sent as what is under the mouse rather than where it is on screen:
 *
 *   c:12:4                   line 12, character 4 of the open file, as the
 *                            caret is (LiveSession.cursor). The mirror holds
 *                            the same text, so it lands on the same letter.
 *   s:2:0.3.1:t17            slide 2 (from 0); down the slide's box by child
 *                            index 0, then 3, then 1, to a text node; its
 *                            17th character. Slides are rendered from the
 *                            same markdown by the same render() on every
 *                            page, so the same path leads to the same word,
 *                            however differently the lines wrap.
 *   s:2:4:e450,300           an element instead (a picture, a table cell):
 *                            450/1000 across it and 300/1000 down.
 *
 * A path that does not lead all the way on a student's page — a question
 * card is drawn differently for the teacher, who sees the key — stops at
 * the deepest part that does, and the dot goes in the middle of that. Close
 * is the most it can be there; nothing is refused for it.
 *
 * NOT A PUSH. Pointing goes to /api/live/<code>/point and moves only the
 * pointer's own stamp (LiveSession.pointer), so thirty students are not
 * sent the whole file and notes several times a second. The teacher sends
 * at most every SEND_MS, and again every BEAT_MS while holding still, which
 * is how a student's page tells "still pointing here" from "the teacher's
 * tab went away with Alt held": a pointer not heard about for FADE_MS goes
 * out by itself. Otherwise a crashed laptop leaves a dot lit all lesson.
 *
 * It is a second or so behind and moves in steps a few times a second; the
 * dot glides between them (a CSS transition) and the trail is the same dot
 * drawn again with slower transitions. Good for "this line" and "this word",
 * not for drawing circles.
 */
(function () {
  "use strict";

  var SEND_MS = 200;      // the teacher sends at most this often
  var BEAT_MS = 1500;     // and again this often while holding still
  var FADE_MS = 4000;     // a pointer not heard of for this long goes out
  var DEPTH = 12;         // the most child indices a path may hold
  var TRAIL = 3;          // dots behind the dot

  // ------------------------------------------------------- the teacher's side

  /* Child indices from `root` down to `node`, or null when it is not inside,
     or an index is too big to send (LASER in app.py: three digits). */
  function pathTo(root, node) {
    var path = [];
    while (node && node !== root) {
      var parent = node.parentNode;
      if (!parent) return null;
      var i = Array.prototype.indexOf.call(parent.childNodes, node);
      if (i < 0 || i > 999) return null;
      path.unshift(i);
      node = parent;
    }
    return node === root ? path : null;
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      return p && { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      return r && { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  function charRect(node, i) {
    if (i < 0 || i >= node.length) return null;
    var range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    var rects = range.getClientRects();
    return rects.length ? rects[0] : null;
  }

  function inside(r, x, y, slack) {
    return r && x >= r.left - slack && x <= r.right + slack
      && y >= r.top - slack && y <= r.bottom + slack;
  }

  /* The character under (x, y) in a text node, or -1. The caret the browser
     finds is BETWEEN two characters, and on the far half of a letter it is
     after it; and in the margin beside a paragraph it is still the nearest
     one, which would put the dot on a word the mouse is nowhere near. */
  function charUnder(node, offset, x, y) {
    for (var i = offset; i >= offset - 1; i--) {
      if (inside(charRect(node, i), x, y, 3)) return i;
    }
    return -1;
  }

  function thousandths(v) {
    return Math.max(0, Math.min(1000, Math.round(v * 1000)));
  }

  /* A place on a slide: `body` is the box the slide is rendered into,
     `slide` which slide it is, from 0. "" when (x, y) is not on it. */
  function pointAtSlide(body, slide, x, y) {
    if (!inside(body.getBoundingClientRect(), x, y, 0)) return "";
    var head = "s:" + Math.max(0, Math.min(9999, slide | 0)) + ":";
    var c = caretAt(x, y);
    if (c && c.node && c.node.nodeType === 3 && body.contains(c.node)) {
      var at = charUnder(c.node, c.offset, x, y);
      var path = at >= 0 ? pathTo(body, c.node) : null;
      if (path && path.length <= DEPTH) return head + path.join(".") + ":t" + at;
    }
    var el = document.elementFromPoint(x, y);
    if (!el || !body.contains(el)) el = body;
    var p = pathTo(body, el);
    if (!p) { el = body; p = []; }
    while (p.length > DEPTH) { el = el.parentNode; p.pop(); }
    var b = el.getBoundingClientRect();
    if (!b.width || !b.height) return head + ":e500,500";
    return head + p.join(".") + ":e" + thousandths((x - b.left) / b.width)
      + "," + thousandths((y - b.top) / b.height);
  }

  /* A place in a CodeMirror, as its line and character. "" off its text. */
  function pointAtCode(cm, x, y) {
    if (!inside(cm.getScrollerElement().getBoundingClientRect(), x, y, 0)) return "";
    var pos = cm.coordsChar({ left: x, top: y }, "window");
    /* coordsChar gives the gap between letters nearest the mouse, so on the
       right half of a letter it is the gap AFTER it, and the class saw the
       dot one letter along from where the teacher was pointing. The letter
       is the one whose box the mouse is in. */
    if (pos.ch > 0) {
      var before = cm.charCoords({ line: pos.line, ch: pos.ch - 1 }, "window");
      if (x >= before.left && x < before.right) pos = { line: pos.line, ch: pos.ch - 1 };
    }
    return "c:" + pos.line + ":" + pos.ch;
  }

  function makeDot(cls) {
    var d = document.createElement("div");
    d.className = "laser-dot " + (cls || "");
    d.setAttribute("aria-hidden", "true");
    document.body.appendChild(d);
    return d;
  }

  function moveDot(d, x, y) {
    d.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
  }

  /* Pointing, on a teacher's page.

       surfaces()  what can be pointed at now: [{ el, point(x, y) }], where
                   point gives the place as above, or "". Asked on every
                   move, so a surface that comes and goes (the notes pane, a
                   markdown file open in the editor) needs no bookkeeping.
       send(p)     tell the class; p is "" for "let go".
       active()    whether there is a class to tell (live).

     The teacher sees the dot too, under the mouse and with no delay: the
     projector is showing this screen, and a red dot reads from the back of
     the room where a mouse arrow does not. */
  function teacher(opts) {
    var sent = "", want = "", lastAt = 0, timer = null, beat = null;
    var mouseX = -1, mouseY = -1, on = false, dot = null;

    function flush() {
      timer = null;
      if (want === sent) return;
      sent = want;
      lastAt = Date.now();
      opts.send(sent);
      clearInterval(beat);
      beat = sent ? setInterval(function () { opts.send(sent); }, BEAT_MS) : null;
    }

    function aim(p) {
      want = p;
      // Letting go goes at once, a send already waiting or not: the class
      // should not see the dot linger after the teacher has moved on.
      if (!want && sent) { clearTimeout(timer); flush(); return; }
      if (want === sent || timer) return;
      var wait = SEND_MS - (Date.now() - lastAt);
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    }

    function letGo() {
      on = false;
      if (dot) dot.classList.remove("on");
      aim("");
    }

    function at(x, y) {
      if (!opts.active()) { letGo(); return; }
      var list = opts.surfaces() || [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || !s.el || !s.el.isConnected) continue;
        var r = s.el.getBoundingClientRect();
        if (!r.width || !inside(r, x, y, 0)) continue;
        var p = s.point(x, y);
        if (!p) continue;
        on = true;
        if (!dot) dot = makeDot("laser-here");
        moveDot(dot, x, y);
        dot.classList.add("on");
        aim(p);
        return;
      }
      if (dot) dot.classList.remove("on");
      aim("");
    }

    document.addEventListener("mousemove", function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (e.altKey) at(mouseX, mouseY);
      else if (on) letGo();
    }, { passive: true, capture: true });

    document.addEventListener("keydown", function (e) {
      // Pressed with the mouse already resting on something: point there now.
      if (e.key === "Alt" && !e.repeat && mouseX >= 0) at(mouseX, mouseY);
    }, true);

    document.addEventListener("keyup", function (e) {
      if (e.key !== "Alt") return;
      /* Alt pressed and let go on its own moves the keyboard to the
         browser's menu on Windows, so the next key the teacher types goes
         there instead of into the code. Only after pointing: an Alt that
         was not the laser is left to do what it always did. */
      if (on) e.preventDefault();
      letGo();
    }, true);

    // Alt let go in another window never arrives here.
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) letGo();
    });

    return { letGo: letGo };
  }

  // ------------------------------------------------------- the class's side

  /* Where a slide place is on this screen, or null: not this slide, not on
     screen, or nothing there to point at. */
  function slideSpot(body, onSlide, pointer) {
    var m = /^s:(\d+):([\d.]*):(?:t(\d+)|e(\d+),(\d+))$/.exec(pointer);
    if (!m || +m[1] !== onSlide) return null;
    var node = body, whole = true;
    var path = m[2] ? m[2].split(".") : [];
    for (var i = 0; i < path.length; i++) {
      var next = node.childNodes[+path[i]];
      if (!next) { whole = false; break; }
      node = next;
    }
    var r = null, fx = 0.5, fy = 0.5;
    if (whole && m[3] !== undefined && node.nodeType === 3 && node.length) {
      r = charRect(node, Math.min(+m[3], node.length - 1));
    }
    if (!r && node.nodeType === 3) {
      var range = document.createRange();
      range.selectNodeContents(node);
      r = range.getBoundingClientRect();
    } else if (!r) {
      r = node.getBoundingClientRect();
      if (whole && m[4] !== undefined) { fx = +m[4] / 1000; fy = +m[5] / 1000; }
    }
    if (!r || (!r.width && !r.height)) return null;
    var x = r.left + r.width * fx, y = r.top + r.height * fy;
    return inside(body.getBoundingClientRect(), x, y, 0) ? { x: x, y: y } : null;
  }

  function codePos(cm, pointer) {
    var m = /^c:(\d+):(\d+)$/.exec(pointer);
    if (!m) return null;
    var line = Math.min(+m[1], cm.lastLine());
    return { line: line, ch: Math.min(+m[2], cm.getLine(line).length) };
  }

  function codeSpot(cm, pointer) {
    var pos = codePos(cm, pointer);
    if (!pos) return null;
    var c = cm.charCoords(pos, "window");
    var x = c.right > c.left ? (c.left + c.right) / 2 : c.left + 4;
    var y = (c.top + c.bottom) / 2;
    return inside(cm.getScrollerElement().getBoundingClientRect(), x, y, 0)
      ? { x: x, y: y } : null;
  }

  /* The dot, on a student's page.

       code    { cm, follow(pos) } — the mirror, and what to do when the
               teacher points at a line that is scrolled out of sight
               (the page decides: a student reading elsewhere is not yanked).
       slides  { body, at() } — the slide box, and which slide the student
               is on. A student who has read ahead sees no dot: the teacher
               is pointing at a slide that is not in front of them.

     show(pointer) with each answer that carries one. Placed again on every
     frame while lit, because the slide re-renders and the mirror scrolls
     under it, and neither says so. */
  function student(opts) {
    var pointer = "", heard = 0, frame = 0, spot = null, dots = [];

    function hide() {
      dots.forEach(function (d) { d.classList.remove("on"); });
      spot = null;
    }

    function place() {
      frame = 0;
      if (!pointer || Date.now() - heard > FADE_MS) { pointer = ""; hide(); return; }
      var s = null;
      if (pointer.charAt(0) === "c" && opts.code) s = codeSpot(opts.code.cm, pointer);
      if (pointer.charAt(0) === "s" && opts.slides) {
        s = slideSpot(opts.slides.body, opts.slides.at(), pointer);
      }
      if (!s) hide();
      else {
        if (!dots.length) {
          for (var i = TRAIL; i >= 1; i--) dots.push(makeDot("laser-trail laser-trail-" + i));
          dots.push(makeDot());
        }
        // A dot that was out appears where it is, rather than gliding in
        // from wherever it last was.
        var jump = !spot;
        if (jump || s.x !== spot.x || s.y !== spot.y) {
          dots.forEach(function (d) {
            if (jump) d.classList.add("laser-jump");
            moveDot(d, s.x, s.y);
          });
          if (jump) {
            void dots[0].offsetWidth;          // take the position, unanimated
            dots.forEach(function (d) { d.classList.remove("laser-jump"); });
          }
        }
        dots.forEach(function (d) { d.classList.add("on"); });
        spot = s;
      }
      frame = requestAnimationFrame(place);
    }

    return {
      show: function (p) {
        p = typeof p === "string" ? p : "";
        var moved = p !== pointer;
        pointer = p;
        heard = Date.now();
        if (moved && p && opts.code && opts.code.follow) {
          var pos = p.charAt(0) === "c" ? codePos(opts.code.cm, p) : null;
          if (pos) opts.code.follow(pos);
        }
        if (!frame) frame = requestAnimationFrame(place);
      },
      // Whether a dot is lit, so the page can poll faster while it is.
      lit: function () { return !!pointer && Date.now() - heard <= FADE_MS; }
    };
  }

  window.LiveLaser = {
    pointAtSlide: pointAtSlide,
    pointAtCode: pointAtCode,
    teacher: teacher,
    student: student,
    // For tools/test_laser.py, which runs these in node.
    _pathTo: pathTo,
    _slideSpot: slideSpot,
    _codePos: codePos
  };
})();
