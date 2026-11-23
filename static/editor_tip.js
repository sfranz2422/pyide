/* The editor's guide bubble (v10 lessons, Nov 2026, the teacher's request).
 *
 * A slide that says "✏ type title = "Mohawk"" in a `:::pop editor` box says
 * it in the student's editor too, just under their last line, where the line
 * they are to type goes. notes.js (slideView's editorTip, with the page's
 * editorTips option) works out which step is current and sends an
 * "ide-editor-tip" event on document; attach(cm) draws it in that CodeMirror.
 * The same file for the student's own editor (app.js) and the live lesson's
 * (live.js): the teacher uses live a lot, and the bubble is for both.
 *
 * A CodeMirror widget, so it scrolls with the code; drawn again under the new
 * last line as they type. Clicks go through it (pointer-events: none in
 * style.css) — it must never be in the way of the typing it asks for. When
 * the step's check passes it turns green with a ✓ for a moment and goes, and
 * the next step's takes its place.
 */
window.PyIDEEditorTip = (function () {
  /* Under the last line with something on it, not below trailing blank
     lines. In a web page (Web Design 1's v10 lessons, Nov 2026) that's
     the last line INSIDE <body>: under the whole file was below
     </html>, where nothing a student types belongs — the starter's
     "<!-- Build your form here -->" and what they've typed under it are
     just above </body>. script.js and style.css have no </body>, so
     they get the last line, as main.py does. Copy to editor puts code
     here too, so it lands where the bubble says to type. */
  function lastCodeLine(editor) {
    var n = editor.lastLine();
    for (var b = n; b > 0; b -= 1) {
      if (/^\s*<\/body\s*>/i.test(editor.getLine(b))) { n = b - 1; break; }
    }
    while (n > 0 && !editor.getLine(n).trim()) n -= 1;
    return n;
  }

  /* Copy to editor (notes.js copyButtons): the code on new lines under the
     last line with code, indented as that line is in a web page (inside
     <body>), and the cursor on its first blank. Pressed twice, the code is
     already there: it isn't put in again, the cursor just goes to it. */
  function insertCode(editor, code) {
    var doc = editor.getDoc(), text = editor.getValue();
    var n = lastCodeLine(editor), line = editor.getLine(n) || "";
    var indent = /<\/body\s*>/i.test(text) ? (line.match(/^\s*/) || [""])[0] : "";
    // Indented first, so that "is it already there?" asks about what a
    // first press put in, and a second press doesn't add it again.
    code = code.split("\n").map(function (l) { return l ? indent + l : l; }).join("\n");
    var at = text.indexOf(code);
    if (at < 0) {
      var empty = !text.trim();
      doc.replaceRange((empty ? "" : "\n") + code, empty ? { line: 0, ch: 0 } : { line: n, ch: line.length });
      at = editor.getValue().indexOf(code);
    }
    var blank = code.indexOf("_____");
    var from = doc.posFromIndex(at + (blank >= 0 ? blank : 0));
    if (blank >= 0) doc.setSelection(from, { line: from.line, ch: from.ch + 5 });
    else doc.setCursor(from);
    editor.focus();
    editor.scrollIntoView(doc.posFromIndex(at + code.length), 40);
    editor.scrollIntoView(from, 40);
  }

  function attach(editor) {
    var bubble = null, tip = null, gone = null;

    function lastLine() { return lastCodeLine(editor); }
    /* The code to type, drawn as a little read-only editor (the teacher,
       Nov 2026: highlight it more, "enclosed in a little editor block"):
       the same CodeMirror, mode and theme as the student's own, so it looks
       exactly like what they're to type. Code on a line of its own (`code`
       alone in a paragraph) and ```python blocks; ```text (expected output)
       stays a plain block. */
    function codeBlocks(root) {
      if (typeof CodeMirror !== "function") return;
      var found = [];
      Array.prototype.forEach.call(root.querySelectorAll("p"), function (p) {
        var c = p.children.length === 1 && p.firstElementChild.tagName === "CODE" ? p.firstElementChild : null;
        if (c && p.textContent.trim() === c.textContent.trim()) found.push([p, c.textContent]);
      });
      Array.prototype.forEach.call(root.querySelectorAll("pre"), function (pre) {
        var c = pre.querySelector("code");
        var cls = (c && c.className) || "";
        if (/language-(text|output|plain)/.test(cls)) return;
        found.push([pre, (c || pre).textContent.replace(/\n$/, "")]);
      });
      found.forEach(function (f) {
        var holder = document.createElement("div");
        holder.className = "editor-tip-code";
        f[0].parentNode.replaceChild(holder, f[0]);
        CodeMirror(holder, {
          value: f[1], mode: editor.getOption("mode"), theme: editor.getOption("theme"),
          readOnly: "nocursor", lineNumbers: false, lineWrapping: false,
          viewportMargin: Infinity, scrollbarStyle: "null"
        });
      });
    }
    /* What it should print, big and in its own colour (the teacher, Nov
       2026: "I don't think the students are paying attention to it, make it
       pop"). A paragraph that says "should print" is marked, and so is a
       ```text block straight after it ("When you type apple, it should
       print:" then the output). Read from the words, as the lessons write
       it; a step that words it otherwise just stays plain. */
    function markExpect(root) {
      Array.prototype.forEach.call(root.querySelectorAll("p"), function (p) {
        if (!/should print/i.test(p.textContent)) return;
        p.classList.add("editor-tip-expect");
        var nx = p.nextElementSibling;
        if (nx && nx.tagName === "PRE") nx.classList.add("editor-tip-expect");
      });
    }
    function refreshCode() {
      if (!bubble) return;
      Array.prototype.forEach.call(bubble.querySelectorAll(".editor-tip-code .CodeMirror"), function (el) {
        if (el.CodeMirror) el.CodeMirror.refresh();
      });
    }
    function place() {
      if (!bubble) return;
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      // One whole line lower than the last line with code: the empty line
      // they're about to type on stays in sight above it (the teacher, Nov
      // 2026: it sat on the very line they had to type into).
      bubble.style.marginTop = (Math.round(editor.defaultTextHeight()) + 12) + "px";
      editor.addWidget({ line: lastLine(), ch: 0 }, bubble, false);
      refreshCode();                 // drawn while detached, it measured nothing
      makeRoom();
    }
    /* Room under the code for the whole bubble, and the bubble in sight (the
       teacher, Nov 2026: "kids are not seeing the popup"). A widget is drawn
       over the editor, not in it, so CodeMirror's scroll height stopped at
       the last line: a bubble under the last line was cut off at the bottom
       and couldn't be scrolled to, until a student happened to press Enter a
       few times. The padding is on .CodeMirror-lines, which CodeMirror
       counts in the document's height (paddingVert), so its own scrollbar
       reaches it too. */
    var lines = editor.getWrapperElement().querySelector(".CodeMirror-lines");
    var basePad = null;
    function makeRoom() {
      if (!lines) return;
      if (basePad === null) basePad = parseFloat(getComputedStyle(lines).paddingBottom) || 0;
      var need = 0;
      if (bubble && bubble.parentNode) {
        var bottom = bubble.offsetTop + bubble.offsetHeight + 16;
        // How far the bubble reaches past the end of the document.
        need = Math.max(0, bottom - (editor.heightAtLine(editor.lastLine() + 1, "local")));
      }
      var pad = (basePad + need) + "px";
      if (lines.style.paddingBottom !== pad) { lines.style.paddingBottom = pad; editor.refresh(); }
    }
    /* Scroll so the whole bubble shows: in the editor, from the line being
       typed on (or the bubble's code line) to the bubble's bottom — if both
       won't fit, CodeMirror keeps the top, so the cursor never goes out of
       sight — and then the page itself, when the editor is below the window
       (a phone, a short laptop screen with the notes above). Only when the
       step is new or the bubble grew (Not yet), never on every keystroke. */
    function reveal(fromCursor) {
      if (!bubble || !bubble.parentNode) return;
      var top = fromCursor ? editor.cursorCoords(null, "local").top
        : editor.charCoords({ line: lastLine(), ch: 0 }, "local").top;
      top = Math.min(top, bubble.offsetTop);
      editor.scrollIntoView({ left: 0, right: 0, top: top, bottom: bubble.offsetTop + bubble.offsetHeight + 8 });
      var r = bubble.getBoundingClientRect();
      var h = window.innerHeight || document.documentElement.clientHeight;
      if (r.bottom > h) window.scrollBy(0, Math.min(r.bottom - h + 8, Math.max(0, r.top - 8)));
      else if (r.top < 0) window.scrollBy(0, r.top - 8);
    }
    function remove() {
      if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
      bubble = null;
      makeRoom();
    }
    function draw(t) {
      clearTimeout(gone);
      if (!t || !t.html) { tip = null; remove(); return; }
      var same = tip && tip.slide === t.slide && tip.step === t.step;
      tip = t;
      // A step already done when it comes into view (passed before this page,
      // or before the teacher moved to this slide): nothing to say.
      if (t.passed && !same) { remove(); return; }
      if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "editor-tip";
        bubble.setAttribute("role", "status");
      }
      bubble.innerHTML = t.html;
      markExpect(bubble);
      codeBlocks(bubble);
      bubble.classList.toggle("is-done", !!t.passed);
      // A step with no check (a challenge) gets no button: nothing to pass.
      if (!t.passed && t.card && window.IDENotesChecks) {
        /* Check my work, right where they typed: the step is said only here,
           so the way to check it is here too. It runs the same check as the
           card on the slide (checks_in_notes.js), whose result moves the
           bubble on. The one part of the bubble that takes clicks. */
        var foot = document.createElement("p");
        foot.className = "editor-tip-foot";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-check editor-tip-check";
        btn.textContent = "✔ Check my work";
        btn.addEventListener("click", function () {
          btn.disabled = true;
          btn.textContent = "Checking…";
          Promise.resolve(window.IDENotesChecks.check(t.card)).then(function () {
            btn.disabled = false;
            btn.textContent = "✔ Check my work";
            // Still this step (a pass would have redrawn it as ✓): say why
            // here — the card on the slide is hidden while the bubble is
            // drawn (notes.js), so its reasons are read out of it into the
            // bubble, or the button would just seem to do nothing.
            if (bubble && !bubble.classList.contains("is-done")) {
              var old = bubble.querySelector(".editor-tip-nope");
              if (old) old.remove();
              var nope = document.createElement("div");
              nope.className = "editor-tip-nope";
              var why = [];
              // The hint card (hints.js) says why, in a student's words: said
              // in both places it was twice the reading (the teacher, Nov 2026).
              var hinted = window.IDEHints && window.IDEHints.active && window.IDEHints.active();
              if (t.card && !hinted) {
                Array.prototype.forEach.call(t.card.querySelectorAll(".test-line.fail"), function (li) {
                  var w = li.querySelector(".tests-why");
                  why.push(li.querySelector(".tests-label").textContent + (w && w.textContent ? ": " + w.textContent : ""));
                });
              }
              nope.appendChild(document.createTextNode("Not yet."));
              // A few at most: a coding exercise's card has a dozen lines,
              // and a bubble that long would cover the code it's about.
              if (why.length > 3) why = why.slice(0, 3).concat(["and " + (why.length - 3) + " more"]);
              why.forEach(function (line) {
                var p = document.createElement("div");
                p.className = "editor-tip-why";
                p.textContent = (/^and \d+ more$/.test(line) ? "" : "✗ ") + line;
                nope.appendChild(p);
              });
              bubble.insertBefore(nope, foot);
              makeRoom();
              reveal(true);
            }
          }, function () {
            btn.disabled = false;
            btn.textContent = "✔ Check my work";
          });
        });
        foot.appendChild(btn);
        bubble.appendChild(foot);
      }
      if (t.passed) {
        var mark = document.createElement("p");
        mark.className = "editor-tip-done";
        // A quiz's step is "done" once checked, never once passed (notes.js):
        // saying Done! would say it passed.
        mark.textContent = t.quiz ? "✓ Checked" : "✓ Done!";
        bubble.appendChild(mark);
        gone = setTimeout(remove, 1600);
      }
      place();
      // A new step: show it whole. Its code blocks lay out a frame later.
      if (!same && !t.passed) requestAnimationFrame(function () { makeRoom(); reveal(false); });
    }
    document.addEventListener("ide-editor-tip", function (e) { draw(e.detail); });
    editor.on("change", function () {
      if (!bubble) return;
      place();
      /* Typing on the line the bubble is under (Enter there moves it down):
         keep it in sight as it moves. Typing higher up in the file, leave
         the view where the student put it. */
      if (editor.getCursor().line >= lastLine() - 1) reveal(true);
    });
    editor.on("swapDoc", function () { if (bubble) place(); });
  }
  return { attach: attach, insertCode: insertCode };
})();
