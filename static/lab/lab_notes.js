/* PyIDE — an A+ lab's step cards, in its notes.
 *
 * A ```lab block in a lab's notes names some of its ticket's tasks, one id
 * a line:
 *
 *     ```lab
 *     power
 *     monitor
 *     ```
 *
 * and is drawn as a card of those tasks, ○ until the machine passes one,
 * then ✓ — so the notes can walk a student through the ticket a step at a
 * time, the card beside the step it is about. The marks are lab_checks.js's
 * (page.js hands them here after every change); the grade is still the
 * server's. notes.js calls renderBlocks as it draws each slide; elsewhere
 * (the library, PresMaker) a ```lab block stays the code block it is.
 *
 * Each card is a .tests-card[data-checks], data-passed when every task on
 * it passes: notes.js's slideView holds the next slide under `locked: yes`
 * while the slide has such a card without data-passed, as it does for a
 * ```tests card in a coding assignment. (No "ide-checks" event: that only
 * keeps a code check's progress, which isn't kept anywhere else; a lab
 * card's ticks are worked out from the machine every time.)
 */
window.PyIDELabNotes = (function () {
  "use strict";

  var tasks = {};          // id -> task, from the ticket
  var marks = null;        // id -> passed, from the last marking

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function setTasks(sc) {
    tasks = {};
    (sc && sc.tasks || []).forEach(function (t) { tasks[t.id] = t; });
  }

  function card(ids) {
    var box = el("div", "tests-card lab-card");
    box.setAttribute("data-checks", "");
    box.appendChild(el("div", "tests-head", "🛠 On the computer"));
    var list = el("ul", "tests-lines");
    ids.forEach(function (id) {
      var t = tasks[id], li = el("li", "test-line");
      li.setAttribute("data-task", id);
      li.appendChild(el("span", "tests-mark", "○"));
      // A line naming no task (a typo in the notes) says so, rather than
      // waiting for something that can never pass.
      li.appendChild(el("span", "tests-text", t ? t.text : "No task called “" + id + "” in this lab's ticket."));
      list.appendChild(li);
    });
    box.appendChild(list);
    box.appendChild(el("p", "tests-lock small", "🔒 Do everything on this card to go on to the next slide."));
    paint(box);
    return box;
  }

  function paint(box) {
    var lines = box.querySelectorAll(".test-line"), passing = 0;
    Array.prototype.forEach.call(lines, function (li) {
      var ok = !!(marks && marks[li.getAttribute("data-task")]);
      li.classList.toggle("pass", ok);
      li.querySelector(".tests-mark").textContent = ok ? "✓" : "○";
      if (ok) passing++;
    });
    if (lines.length && passing === lines.length) box.setAttribute("data-passed", "");
    else box.removeAttribute("data-passed");
  }

  function renderBlocks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("pre > code.language-lab"), function (code) {
      var ids = code.textContent.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (ids.length) code.parentNode.replaceWith(card(ids));
    });
  }

  // New marks ([{id, ok}], lab_checks.js's grade): every card repainted.
  function update(got) {
    marks = {};
    (got || []).forEach(function (g) { marks[g.id] = !!g.ok; });
    Array.prototype.forEach.call(document.querySelectorAll(".lab-card[data-checks]"), paint);
  }

  return { setTasks: setTasks, renderBlocks: renderBlocks, update: update, card: card };
})();
