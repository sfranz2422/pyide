/* Tests in an assignment's notes: reading them, and running them.
 *
 * autograde.py has the format and the reasons. This reads a ```tests block
 * exactly as autograde.parse does — test_autograde.py holds the two to each
 * other — and runs the tests in Pyodide: on the student's page for Check my
 * work, on the teacher's for Check all. Nothing here runs on the server.
 *
 * Each test runs the program afresh, with input() fed from the test and the
 * output caught, under a time limit so a loop that never ends fails its test
 * rather than freezing the page.
 */
window.PyIDETests = (function () {
  "use strict";

  var FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  var POINTS = /\s*\((\d{1,4}(?:\.\d{1,2})?)\s*points?\)\s*$/i;
  var OUTPUT = /^input\s+(.*?)\s*->\s*prints(\s+exactly)?\s+(.+)$/i;
  var PRINTS = /^prints(\s+exactly)?\s+(.+)$/i;
  var CODE = /^(uses|avoids|defines)\s+(.+?)\s*$/i;
  var WORDS = { "for": "a for loop", "while": "a while loop", "if": "an if statement",
                "def": "a function", "function": "a function", "return": "return",
                "else": "else", "elif": "elif", "try": "try / except",
                "list": "a list", "dict": "a dictionary", "class": "a class" };

  function blocks(md) {
    var out = [], lines = String(md || "").split("\n"), i = 0;
    while (i < lines.length) {
      var f = FENCE.exec(lines[i]);
      if (f && f[2].trim().toLowerCase() === "tests") {
        var fence = f[1], body = [];
        i++;
        while (i < lines.length) {
          var g = FENCE.exec(lines[i]);
          if (g && g[1][0] === fence[0] && g[1].length >= fence.length && !g[2].trim()) break;
          body.push(lines[i]);
          i++;
        }
        out.push(body.join("\n"));
      }
      i++;
    }
    return out;
  }

  function label(t) {
    if (t.kind === "output") {
      var said = (t.exact ? "prints exactly " : "prints ") + t.expect;
      if (t.inputs.length) return "With input " + t.inputs.join(", ") + ", " + said;
      return said.charAt(0).toUpperCase() + said.slice(1);
    }
    if (t.kind === "call") return t.expr + " gives " + t.expect;
    if (t.kind === "defines") return "Defines " + t.name + "()";
    var word = Object.prototype.hasOwnProperty.call(WORDS, t.name.toLowerCase())
      ? WORDS[t.name.toLowerCase()] : t.name;
    return (t.kind === "uses" ? "Uses " : "Doesn't use ") + word;
  }

  function parseBlock(body) {
    var tests = [], errors = [];
    String(body || "").split("\n").forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line || line.charAt(0) === "#") return;
      var points = 1, m = POINTS.exec(line), t = null;
      if (m) {
        points = parseFloat(m[1]);
        line = line.slice(0, m.index).replace(/\s+$/, "");
      }
      if ((m = OUTPUT.exec(line))) {
        t = { kind: "output", exact: !!m[2], expect: m[3].trim(),
              inputs: m[1].trim() ? m[1].split(",").map(function (s) { return s.trim(); }) : [] };
      } else if ((m = PRINTS.exec(line))) {
        t = { kind: "output", exact: !!m[1], expect: m[2].trim(), inputs: [] };
      } else if ((m = CODE.exec(line))) {
        var name = m[2].trim();
        if (name.slice(-2) === "()") name = name.slice(0, -2);
        t = { kind: m[1].toLowerCase(), name: name };
      } else if (line.indexOf(" == ") >= 0) {
        var at = line.indexOf(" == ");
        t = { kind: "call", expr: line.slice(0, at).trim(), expect: line.slice(at + 4).trim() };
      }
      if (!t) {
        errors.push("Line " + (idx + 1) + " of the tests isn't a test: " + line);
        return;
      }
      t.points = points;
      t.label = label(t);
      tests.push(t);
    });
    return { tests: tests, errors: errors };
  }

  function parse(md) {
    var tests = [], errors = [];
    blocks(md).forEach(function (b) {
      var got = parseBlock(b);
      tests = tests.concat(got.tests);
      errors = errors.concat(got.errors);
    });
    return { tests: tests, errors: errors };
  }

  /* Every test in a project's notes (each .md), as autograde.file_tests. */
  function fromFiles(files) {
    var tests = [], errors = [];
    Object.keys(files || {}).sort().forEach(function (name) {
      if (/\.md$/i.test(name)) {
        var got = parse(files[name]);
        tests = tests.concat(got.tests);
        errors = errors.concat(got.errors);
      }
    });
    return { tests: tests, errors: errors };
  }

  /* Which slide each of fromFiles(files)'s tests is written on, in the same
     order: [{slide, title}] (slide from 1, as the slide counter shows it;
     title the slide's first heading), null for a test in notes with no
     slides. Check my work heads its results with these, so a student told
     "check after every step" sees the step they are on, not one long list.

     The notes are cut by `Notes` (notes.js's slides()), the viewer's own
     cutter, so the numbers can't differ from the ones on screen. If the
     count comes out different from fromFiles' anyway, it returns null and
     the results are shown as one list — an unheaded list beats headings
     over the wrong tests. */
  /* A slide's first heading, skipping fenced code: "# a comment" in a
     Python example is not the slide's title. */
  function heading(text) {
    var fence = null, lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (f) {
        if (fence === null) fence = f[1];
        else if (f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length) fence = null;
        continue;
      }
      var h = fence === null && /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(lines[i]);
      if (h) return h[1];
    }
    return "";
  }

  function places(files, Notes) {
    if (!Notes || !Notes.slides) return null;
    var out = [];
    Object.keys(files || {}).sort().forEach(function (name) {
      if (!/\.md$/i.test(name)) return;
      var cut = Notes.slides(files[name]);
      if (!cut.length) {
        parse(files[name]).tests.forEach(function () { out.push(null); });
        return;
      }
      cut.forEach(function (text, i) {
        var where = { slide: i + 1, title: heading(text) };
        parse(text).tests.forEach(function () { out.push(where); });
      });
    });
    return out.length === fromFiles(files).tests.length ? out : null;
  }

  /* The Python that runs the tests. Defined once per Pyodide, after
     runtime.js's BOOTSTRAP (it uses PROJECT_DIR and _forget_project_modules
     from there). */
  var HARNESS = [
    "import ast as _ag_ast, builtins as _ag_b, contextlib as _ag_ctx, io as _ag_io",
    "import json as _ag_json, math as _ag_math, os as _ag_os, sys as _ag_sys, time as _ag_time",
    "",
    "class _AgNoInput(Exception): pass",
    "class _AgTimeUp(Exception): pass",
    "",
    "def _ag_turns_begin(kind):",
    "    '''A Pi (or turtle) or block-world program: its packages fresh, on a",
    "    page of its own with no one watching (_ag_new_page, from run() in",
    "    autograde.js). None for any other program.'''",
    "    if kind not in ('pi', 'world'):",
    "        return None",
    "    import importlib",
    "    packages = _PI_PACKAGES if kind == 'pi' else ('mcpi',)",
    "    for name in [n for n in _ag_sys.modules if n.split('.')[0] in packages]:",
    "        del _ag_sys.modules[name]",
    "    w = importlib.import_module('_pyide_pi' if kind == 'pi' else 'mcpi._pyide')",
    "    w.use_page(_ag_new_page())",
    "    w.begin(0)",
    "    return w",
    "",
    "def _ag_run(source, inputs, seconds, turns=''):",
    "    '''Run main.py once, typing `inputs`. (output, problem, scope).'''",
    "    w = _ag_turns_begin(turns)",
    "    # A Pi or world program that is still going (its `while True:`) is",
    "    # stopped as Stop would stop it, and checked on what it did by then.",
    "    stops = (w.WorldStopped, w.StopNow) if w else ()",
    "    if w:",
    "        seconds = min(seconds, 3)",
    "    feed = list(inputs)",
    "    out = _ag_io.StringIO()",
    "    def fake_input(prompt=''):",
    "        out.write(str(prompt))",
    "        if not feed:",
    "            raise _AgNoInput()",
    "        return feed.pop(0)",
    "    deadline = _ag_time.monotonic() + seconds",
    "    ticks = [0]",
    "    def guard(frame, event, arg):",
    "        ticks[0] += 1",
    "        if ticks[0] % 1000 == 0 and _ag_time.monotonic() > deadline:",
    "            raise _AgTimeUp()",
    "        return guard",
    "    _forget_project_modules()",
    "    scope = {'__name__': '__main__', '__builtins__': _ag_b}",
    "    problem = None",
    "    real_input = _ag_b.input",
    "    _ag_b.input = fake_input",
    "    import threading as _ag_threading",
    "    real_sleep, real_exit, real_start = _ag_time.sleep, _ag_os._exit, _ag_threading.Thread.start",
    "    if w:",
    "        _ag_time.sleep = w.sleep",
    "        _ag_os._exit = _pyide_exit",
    "        _ag_threading.Thread.start = _pyide_no_thread",
    "    try:",
    "        code = compile(source, 'main.py', 'exec')",
    "        with _ag_ctx.redirect_stdout(out):",
    "            _ag_sys.settrace(guard)",
    "            try:",
    "                exec(code, scope)",
    "            finally:",
    "                _ag_sys.settrace(None)",
    "    except _AgNoInput:",
    "        problem = 'It asked for more input than this test types (%d).' % len(inputs)",
    "    except stops:",
    "        pass",
    "    except _AgTimeUp:",
    "        if not w:",
    "            problem = 'Still running after %d seconds. Is there a loop that never ends?' % seconds",
    "    except SystemExit:",
    "        pass",
    "    except SyntaxError as e:",
    "        problem = 'main.py can\\'t be read: line %s: %s' % (e.lineno, e.msg)",
    "    except BaseException as e:",
    "        problem = '%s: %s' % (type(e).__name__, e)",
    "    finally:",
    "        _ag_b.input = real_input",
    "        _ag_time.sleep, _ag_os._exit, _ag_threading.Thread.start = real_sleep, real_exit, real_start",
    "    return out.getvalue(), problem, scope",
    "",
    "def _ag_norm(text):",
    "    return ' '.join(str(text).split()).lower()",
    "",
    "def _ag_same(a, b):",
    "    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):",
    "        return _ag_math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)",
    "    return a == b",
    "",
    "def _ag_short(text, n=160):",
    "    text = str(text).strip()",
    "    return text if len(text) <= n else text[:n] + '…'",
    "",
    "_AG_NODES = {'for': (_ag_ast.For, _ag_ast.comprehension), 'while': (_ag_ast.While,),",
    "             'if': (_ag_ast.If, _ag_ast.IfExp), 'def': (_ag_ast.FunctionDef,),",
    "             'function': (_ag_ast.FunctionDef,), 'return': (_ag_ast.Return,),",
    "             'try': (_ag_ast.Try,), 'class': (_ag_ast.ClassDef,),",
    "             'list': (_ag_ast.List, _ag_ast.ListComp), 'dict': (_ag_ast.Dict, _ag_ast.DictComp),",
    "             'pass': (_ag_ast.Pass,), 'break': (_ag_ast.Break,), 'continue': (_ag_ast.Continue,),",
    "             'global': (_ag_ast.Global,), 'nonlocal': (_ag_ast.Nonlocal,), 'del': (_ag_ast.Delete,),",
    "             'with': (_ag_ast.With,), 'lambda': (_ag_ast.Lambda,)}",
    "",
    "_AG_OPS = {'+': (_ag_ast.Add, _ag_ast.UAdd), '-': (_ag_ast.Sub, _ag_ast.USub), '*': (_ag_ast.Mult,),",
    "           '/': (_ag_ast.Div,), '//': (_ag_ast.FloorDiv,), '%': (_ag_ast.Mod,), '**': (_ag_ast.Pow,),",
    "           '==': (_ag_ast.Eq,), '!=': (_ag_ast.NotEq,), '<': (_ag_ast.Lt,), '<=': (_ag_ast.LtE,),",
    "           '>': (_ag_ast.Gt,), '>=': (_ag_ast.GtE,), 'and': (_ag_ast.And,), 'or': (_ag_ast.Or,),",
    "           'not': (_ag_ast.Not,), 'in': (_ag_ast.In, _ag_ast.NotIn), 'not in': (_ag_ast.NotIn,),",
    "           'is': (_ag_ast.Is, _ag_ast.IsNot)}",
    "",
    "def _ag_uses(trees, word):",
    "    w = word.strip()",
    "    low = w.lower()",
    "    if low.startswith('import '):",
    "        mod = w.split(None, 1)[1].strip()",
    "        for tree in trees:",
    "            for n in _ag_ast.walk(tree):",
    "                if isinstance(n, _ag_ast.Import) and any(a.name.split('.')[0] == mod for a in n.names):",
    "                    return True",
    "                if isinstance(n, _ag_ast.ImportFrom) and (n.module or '').split('.')[0] == mod:",
    "                    return True",
    "        return False",
    "    if low in ('else', 'elif'):",
    "        for tree in trees:",
    "            for n in _ag_ast.walk(tree):",
    "                if isinstance(n, _ag_ast.If) and n.orelse:",
    "                    elif_ = len(n.orelse) == 1 and isinstance(n.orelse[0], _ag_ast.If)",
    "                    if (low == 'elif') == elif_:",
    "                        return True",
    "        return False",
    "    # An operator (uses +, uses ==, uses and): found in the code's tree,",
    "    # so a + inside a string doesn't count. Read as a name it could never",
    "    # be found, and the check failed on code that plainly used it.",
    "    # These were never found, and teachers kept writing them: a",
    "    # += (uses +=), a finally, a keyword argument (uses sep, uses",
    "    # text_colour) and pass, global, del, not in (in the tables above).",
    "    if low.endswith('=') and _AG_OPS.get(low[:-1]) and low[:-1] not in ('=', '!', '<', '>'):",
    "        aug = _AG_OPS[low[:-1]]",
    "        return any(isinstance(n, _ag_ast.AugAssign) and isinstance(n.op, aug)",
    "                   for tree in trees for n in _ag_ast.walk(tree))",
    "    if low == 'finally':",
    "        return any(isinstance(n, _ag_ast.Try) and n.finalbody for tree in trees for n in _ag_ast.walk(tree))",
    "    ops = _AG_OPS.get(low)",
    "    if ops:",
    "        return any(isinstance(n, ops) for tree in trees for n in _ag_ast.walk(tree))",
    "    kinds = _AG_NODES.get(low)",
    "    for tree in trees:",
    "        for n in _ag_ast.walk(tree):",
    "            if kinds and isinstance(n, kinds):",
    "                return True",
    "            if not kinds and ((isinstance(n, _ag_ast.Name) and n.id == w) or",
    "                              (isinstance(n, _ag_ast.Attribute) and n.attr == w) or",
    "                              (isinstance(n, _ag_ast.keyword) and n.arg == w)):",
    "                return True",
    "    return False",
    "",
    "def _pyide_autograde(files_json, tests_json, seconds=5, turns=''):",
    "    files = _ag_json.loads(files_json)",
    "    tests = _ag_json.loads(tests_json)",
    "    _ag_os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    for name, text in files.items():",
    "        if name.lower().endswith('.md') or '..' in name:",
    "            continue",
    "        path = _ag_os.path.join(PROJECT_DIR, name)",
    "        _ag_os.makedirs(_ag_os.path.dirname(path), exist_ok=True)",
    "        with open(path, 'w') as f:",
    "            f.write(text)",
    "    _ag_os.chdir(PROJECT_DIR)",
    "    source = files.get('main.py', '')",
    "    trees, unreadable = [], None",
    "    for name, text in sorted(files.items()):",
    "        if name.endswith('.py'):",
    "            try:",
    "                trees.append(_ag_ast.parse(text, name))",
    "            except SyntaxError as e:",
    "                unreadable = '%s can\\'t be read: line %s: %s' % (name, e.lineno, e.msg)",
    "    results = []",
    "    for t in tests:",
    "        ok, detail = False, ''",
    "        try:",
    "            if unreadable:",
    "                detail = unreadable",
    "            elif t['kind'] == 'output':",
    "                out, problem, _ = _ag_run(source, t['inputs'], seconds, turns)",
    "                if problem:",
    "                    detail = problem",
    "                elif t['exact']:",
    "                    got = '\\n'.join(l.rstrip() for l in out.strip().splitlines())",
    "                    ok = got == t['expect'].strip()",
    "                else:",
    "                    ok = _ag_norm(t['expect']) in _ag_norm(out)",
    "                if not ok and not detail:",
    "                    detail = 'It printed: ' + (_ag_short(out) or '(nothing)')",
    "            elif t['kind'] == 'call':",
    "                _, _, scope = _ag_run(source, [], seconds, turns)",
    "                deadline = _ag_time.monotonic() + seconds",
    "                def guard(frame, event, arg):",
    "                    if _ag_time.monotonic() > deadline:",
    "                        raise _AgTimeUp()",
    "                    return guard",
    "                try:",
    "                    with _ag_ctx.redirect_stdout(_ag_io.StringIO()):",
    "                        _ag_sys.settrace(guard)",
    "                        try:",
    "                            got = eval(t['expr'], scope)",
    "                        finally:",
    "                            _ag_sys.settrace(None)",
    "                    want = eval(t['expect'], scope)",
    "                    ok = _ag_same(got, want)",
    "                    if not ok:",
    "                        detail = 'It gave %s, not %s.' % (_ag_short(repr(got)), _ag_short(repr(want)))",
    "                except NameError as e:",
    "                    name = str(e).split(\"'\")[1] if \"'\" in str(e) else str(e)",
    "                    detail = 'There\\'s no %s. Is it defined, and spelled the same?' % name",
    "                except _AgTimeUp:",
    "                    detail = 'Still running after %d seconds. Is there a loop that never ends?' % seconds",
    "                except BaseException as e:",
    "                    detail = '%s: %s' % (type(e).__name__, e)",
    "            elif t['kind'] == 'defines':",
    "                ok = any(isinstance(n, (_ag_ast.FunctionDef, _ag_ast.AsyncFunctionDef))",
    "                         and n.name == t['name'] for tree in trees for n in _ag_ast.walk(tree))",
    "                if not ok:",
    "                    detail = 'There\\'s no def %s(...) in the code.' % t['name']",
    "            elif t['kind'] in ('uses', 'avoids'):",
    "                used = _ag_uses(trees, t['name'])",
    "                ok = used if t['kind'] == 'uses' else not used",
    "                if not ok:",
    "                    detail = ('It isn\\'t in the code yet.' if t['kind'] == 'uses'",
    "                              else 'The code uses it.')",
    "        except BaseException as e:",
    "            detail = '%s: %s' % (type(e).__name__, e)",
    "        results.append({'label': t['label'], 'ok': bool(ok), 'detail': detail,",
    "                        'points': t['points']})",
    "    earned = round(sum(r['points'] for r in results if r['ok']), 2)",
    "    possible = round(sum(r['points'] for r in results), 2)",
    "    return _ag_json.dumps({'results': results, 'earned': earned, 'possible': possible})",
    ""
  ].join("\n");

  var ready = typeof WeakSet === "function" ? new WeakSet() : null;

  /* A Pi (or turtle) program, or a block-world one, is checked on a page of
     its own with no one watching: a headless Pi with the project's own
     wiring (circuit.pi) — the student's, in the teacher's Check all — or a
     block world made from its world.mcpi. Without these the checks in a Pi
     or world assignment all failed with "No module named gpiozero". Pages
     that don't load pi.js / world_model.js check as before. */
  var bundles = typeof WeakMap === "function" ? new WeakMap() : null;
  function loadBundle(pyodide, url, under) {
    var done = bundles && bundles.get(pyodide) || {};
    if (!done[url]) {
      done[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error("Couldn't load " + url + " (" + r.status + ")");
        return r.json();
      }).then(function (files) {
        Object.keys(files).forEach(function (rel) {
          var path = under + rel;
          pyodide.FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
          pyodide.FS.writeFile(path, files[rel]);
        });
        pyodide.runPython("import sys\nif '/lib' not in sys.path:\n    sys.path.insert(0, '/lib')\n");
      });
      done[url].catch(function () { delete done[url]; });
      if (bundles) bundles.set(pyodide, done);
    }
    return done[url];
  }
  async function turnsFor(pyodide, source, files) {
    var paths = window.PyIDEPaths || {};
    var M = window.PyIDEWorldModel;
    if (M && M.looksLikeWorld(source)) {
      await loadBundle(pyodide, paths.mcpiBundle || "/static/py/mcpi_bundle.json", "/lib/mcpi/");
      // One world for the whole check, built once: making one is the slow part.
      // Every run of the program starts from it as it was built, with the
      // player at the spawn: a check runs the program once per test, and a
      // run that moved the player or placed blocks made the next run's
      // checks fail on a right program.
      var world = await M.decode(files["world.mcpi"] || null, null);
      var ids0 = world.ids().slice(), data0 = world.datas().slice();
      var bridge = M.makeBridge(world, function (cb) { setTimeout(cb, 0); });
      pyodide.globals.set("_ag_new_page", function () {
        world.ids().set(ids0);
        world.datas().set(data0);
        world.spawn();
        return bridge;
      });
      return "world";
    }
    if (window.PyIDEPi && window.PyIDEPi.looksLikePi(source)) {
      await loadBundle(pyodide, paths.piBundle || "/static/py/pi_bundle.json", "/lib/");
      var circuit = files["circuit.pi"] || "";
      // A fresh Pi for every run of the program, so no LED is left on by the one before.
      pyodide.globals.set("_ag_new_page", function () { return window.PyIDEPi.headless(circuit); });
      return "pi";
    }
    return "";
  }

  /* Run `tests` against `files` (name → text) in `pyodide`, which has had
     runtime.js's BOOTSTRAP. Resolves {results, earned, possible}. Imports the
     packages the program needs first, as Run does. */
  async function run(pyodide, files, tests) {
    if (!ready || !ready.has(pyodide)) {
      pyodide.runPython(HARNESS);
      if (ready) ready.add(pyodide);
    }
    var source = files["main.py"] || "";
    if (window.PyIDERuntime && window.PyIDERuntime.loadImports) {
      try { await window.PyIDERuntime.loadImports(pyodide, source, files); } catch (e) {}
    }
    var turns = "";
    try { turns = await turnsFor(pyodide, source, files); } catch (e) { turns = ""; }
    pyodide.globals.set("_ag_files", JSON.stringify(files));
    pyodide.globals.set("_ag_tests", JSON.stringify(tests));
    var out = await pyodide.runPythonAsync("_pyide_autograde(_ag_files, _ag_tests, 5, " + JSON.stringify(turns) + ")");
    return JSON.parse(out);
  }

  /* A ```tests block in rendered notes, as a list a student can read: what
     they will be checked on, in words. Left as code when it can't be read. */
  function renderBlocks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("pre > code.language-tests"), function (code) {
      var got = parseBlock(code.textContent);
      if (!got.tests.length) return;
      // With checks_in_notes.js on the page, a card the student checks their
      // work from, results and all; without it, the list of what's checked.
      if (window.IDENotesChecks) {
        code.parentNode.replaceWith(window.IDENotesChecks.card(got.tests, "✔ Tests your code will be checked against"));
        return;
      }
      var box = document.createElement("div");
      box.className = "tests-card";
      var head = document.createElement("div");
      head.className = "tests-head";
      head.textContent = "✔ Tests your code will be checked against";
      box.appendChild(head);
      var list = document.createElement("ul");
      got.tests.forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t.label + (t.points !== 1 ? "  (" + t.points + " points)" : "");
        list.appendChild(li);
      });
      box.appendChild(list);
      code.parentNode.replaceWith(box);
    });
  }

  return { parse: parse, parseBlock: parseBlock, fromFiles: fromFiles, places: places, run: run,
           renderBlocks: renderBlocks, HARNESS: HARNESS };
})();
