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
    function place() {
      if (!bubble) return;
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      editor.addWidget({ line: lastLine(), ch: 0 }, bubble, false);
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
      bubble.classList.toggle("is-done", !!t.passed);
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
