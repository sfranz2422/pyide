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
  function attach(editor) {
    var bubble = null, tip = null, gone = null;

    // Under the last line with something on it, not below trailing blank lines.
    function lastLine() {
      var n = editor.lastLine();
      while (n > 0 && !editor.getLine(n).trim()) n -= 1;
      return n;
    }
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
    }
    function remove() {
      if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
      bubble = null;
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
          Promise.resolve(window.IDENotesChecks.check()).then(function () {
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
              if (t.card) {
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
        mark.textContent = "✓ Done!";
        bubble.appendChild(mark);
        gone = setTimeout(remove, 1600);
      }
      place();
    }
    document.addEventListener("ide-editor-tip", function (e) { draw(e.detail); });
    editor.on("change", function () { if (bubble) place(); });
    editor.on("swapDoc", function () { if (bubble) place(); });
  }
  return { attach: attach };
})();
