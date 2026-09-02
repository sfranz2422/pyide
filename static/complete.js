/* PyIDE — completion for names the student has defined.
 *
 * Only their own names: variables, loop targets, unpacked tuples, with-as
 * targets, functions and their parameters, classes, imports. No builtins and
 * no signature help — the point is to stop NameError typos, not to write the
 * program for them.
 *
 * Names come from Python's own ast module rather than a regular expression,
 * so tuple unpacking and comprehensions are picked up correctly. Nothing is
 * executed to find them.
 */

window.PyIDEComplete = (function () {
  "use strict";

  var COLLECTOR = [
    "import ast, json",
    "",
    "def _pyide_names(source):",
    "    try:",
    "        tree = ast.parse(source)",
    "    except SyntaxError:",
    "        # half-typed code: the caller keeps the previous list rather than",
    "        # having suggestions vanish exactly while you are typing",
    "        return ''",
    "    except Exception:",
    "        return ''",
    "    names = set()",
    "    for node in ast.walk(tree):",
    "        # one check covers assignment, augmented assignment, tuple",
    "        # unpacking, for targets, with-as and comprehension targets",
    "        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):",
    "            names.add(node.id)",
    "        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):",
    "            names.add(node.name)",
    "            a = node.args",
    "            for arg in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):",
    "                names.add(arg.arg)",
    "            if a.vararg:",
    "                names.add(a.vararg.arg)",
    "            if a.kwarg:",
    "                names.add(a.kwarg.arg)",
    "        elif isinstance(node, ast.ClassDef):",
    "            names.add(node.name)",
    "        elif isinstance(node, (ast.Import, ast.ImportFrom)):",
    "            for al in node.names:",
    "                names.add(al.asname or al.name.split('.')[0])",
    "        elif isinstance(node, ast.ExceptHandler) and node.name:",
    "            names.add(node.name)",
    "    # JSON rather than a returned list: no PyProxy to remember to free",
    "    return json.dumps(sorted(n for n in names if not n.startswith('_')))",
    ""
  ].join("\n");

  var names = [];        // last successful parse
  var pyNames = null;

  function attach(pyodide) {
    try {
      pyodide.runPython(COLLECTOR);
      pyNames = pyodide.globals.get("_pyide_names");
    } catch (e) {
      pyNames = null;    // completion simply stays off
    }
  }

  function refresh(source) {
    if (!pyNames) return;
    try {
      var json = pyNames(source);
      if (!json) return;              // syntax error mid-typing; keep the list
      names = JSON.parse(json);
    } catch (e) {
      /* keep whatever we had */
    }
  }

  function ready() { return !!pyNames && names.length > 0; }

  function hint(cm) {
    var cur = cm.getCursor();

    // never inside a string or a comment
    var type = cm.getTokenTypeAt(cur);
    if (type === "string" || type === "comment") return null;

    var line = cm.getLine(cur.line);
    var start = cur.ch;
    while (start > 0 && /[A-Za-z0-9_]/.test(line.charAt(start - 1))) start--;
    var word = line.slice(start, cur.ch);

    // two characters before suggesting, so it stays out of the way
    if (word.length < 2 || !/^[A-Za-z_]/.test(word)) return null;

    // don't suggest straight after a dot — that's an attribute, not a name
    if (start > 0 && line.charAt(start - 1) === ".") return null;

    var lower = word.toLowerCase();
    var list = names.filter(function (n) {
      return n !== word && n.toLowerCase().indexOf(lower) === 0;
    });
    if (!list.length) return null;

    return {
      list: list,
      from: CodeMirror.Pos(cur.line, start),
      to: CodeMirror.Pos(cur.line, cur.ch)
    };
  }

  /* Enter is deliberately not a pick key: a student pressing Enter to start a
     new line must get a new line, not a surprise completion. Tab picks. */
  var KEYS = {
    Up: function (cm, h) { h.moveFocus(-1); },
    Down: function (cm, h) { h.moveFocus(1); },
    Tab: function (cm, h) { h.pick(); },
    Esc: function (cm, h) { h.close(); }
  };

  function show(cm) {
    if (!ready()) return;
    cm.showHint({
      hint: hint,
      completeSingle: false,   // never insert without the student choosing
      customKeys: KEYS
    });
  }

  return { attach: attach, refresh: refresh, show: show, ready: ready };
})();
