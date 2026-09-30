/* PyIDE — Tab and Backspace that move between tab stops.
 *
 * Used by both editors that a student types Python into: the main one
 * (app.js) and their own copy during a live lesson (live.js). It was once
 * written inside app.js alone, and the live editor, built separately, quietly
 * went without it — Tab inserted four spaces wherever the caret was and
 * Backspace took one space at a time, in exactly the lesson where a whole
 * class is copying indentation off the board. One file means an editor
 * either has it or visibly does not bind it.
 */

window.PyIDETabStops = (function () {
  "use strict";

  /* Indentation that moves in whole steps, the way a ruler does.
   *
   * Tab used to insert four spaces wherever the caret was, so a line that
   * had drifted to column 2 went to column 6 — still wrong, and now wrong
   * by a number nobody can see. Backspace deleted one space at a time, so
   * leaving a block took four presses and stopping after three left an
   * indent that looks right and is not.
   *
   * In Python that is not cosmetic. A line off by a space or two is an
   * IndentationError at best and, inside a nested block, a program that
   * runs and does the wrong thing. This is the most common way a beginner
   * breaks a working file, and it is the one mistake the editor can simply
   * decline to let them make.
   *
   * So both keys move to the next stop rather than by a fixed amount, and
   * the indentation is always a multiple of four whatever the caret does.
   */
  function spaces(n) {
    return new Array(n + 1).join(" ");
  }

  function indentToTabStop(cm) {
    if (cm.somethingSelected()) {
      cm.indentSelection("add");
      return;
    }
    var unit = cm.getOption("indentUnit");
    // More than one caret: no single column to align to, so fall back to a
    // whole unit at each. Rare enough not to be worth a wrong answer.
    if (cm.listSelections().length > 1) {
      cm.replaceSelection(spaces(unit), "end");
      return;
    }
    var head = cm.getCursor();
    var col = CodeMirror.countColumn(cm.getLine(head.line), head.ch,
                                     cm.getOption("tabSize"));
    // Never 0 and never more than a full unit: at a stop it moves a whole
    // one, off a stop it moves just enough to land on the next.
    cm.replaceSelection(spaces(unit - (col % unit)), "end");
  }

  function backspaceToTabStop(cm) {
    if (cm.somethingSelected() || cm.listSelections().length > 1) {
      return CodeMirror.Pass;
    }
    var head = cm.getCursor();
    var before = cm.getLine(head.line).slice(0, head.ch);

    /* ONLY IN THE INDENTATION, AND ONLY SPACES.
     *
     * With anything but spaces to the left, this is ordinary typing and one
     * press must delete one character — a Backspace that swallowed four
     * characters of a word would be unusable. A literal tab (from a paste)
     * is excluded too: one tab is one character but four columns, so
     * "delete back to the stop" has two different right answers and the
     * wrong one eats code. Both cases fall through to CodeMirror. */
    if (before.length === 0 || !/^ +$/.test(before)) {
      return CodeMirror.Pass;
    }

    var unit = cm.getOption("indentUnit");
    var col = before.length;
    var target = (col % unit === 0) ? col - unit : col - (col % unit);
    if (target < 0) target = 0;
    cm.replaceRange("", { line: head.line, ch: target }, head, "+delete");
  }

  return {
    indentToTabStop: indentToTabStop,
    backspaceToTabStop: backspaceToTabStop
  };
})();
