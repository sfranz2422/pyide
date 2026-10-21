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
    "def _ag_run(source, inputs, seconds):",
    "    '''Run main.py once, typing `inputs`. (output, problem, scope).'''",
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
    "    except _AgTimeUp:",
    "        problem = 'Still running after %d seconds. Is there a loop that never ends?' % seconds",
    "    except SystemExit:",
    "        pass",
    "    except SyntaxError as e:",
    "        problem = 'main.py can\\'t be read: line %s: %s' % (e.lineno, e.msg)",
    "    except BaseException as e:",
    "        problem = '%s: %s' % (type(e).__name__, e)",
    "    finally:",
    "        _ag_b.input = real_input",
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
    "             'list': (_ag_ast.List, _ag_ast.ListComp), 'dict': (_ag_ast.Dict, _ag_ast.DictComp)}",
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
    "    kinds = _AG_NODES.get(low)",
    "    for tree in trees:",
    "        for n in _ag_ast.walk(tree):",
    "            if kinds and isinstance(n, kinds):",
    "                return True",
    "            if not kinds and ((isinstance(n, _ag_ast.Name) and n.id == w) or",
    "                              (isinstance(n, _ag_ast.Attribute) and n.attr == w)):",
    "                return True",
    "    return False",
    "",
    "def _pyide_autograde(files_json, tests_json, seconds=5):",
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
    "                out, problem, _ = _ag_run(source, t['inputs'], seconds)",
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
    "                _, _, scope = _ag_run(source, [], seconds)",
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
    pyodide.globals.set("_ag_files", JSON.stringify(files));
    pyodide.globals.set("_ag_tests", JSON.stringify(tests));
    var out = await pyodide.runPythonAsync("_pyide_autograde(_ag_files, _ag_tests)");
    return JSON.parse(out);
  }

  /* A ```tests block in rendered notes, as a list a student can read: what
     they will be checked on, in words. Left as code when it can't be read. */
  function renderBlocks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("pre > code.language-tests"), function (code) {
      var got = parseBlock(code.textContent);
      if (!got.tests.length) return;
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

  return { parse: parse, parseBlock: parseBlock, fromFiles: fromFiles, run: run,
           renderBlocks: renderBlocks, HARNESS: HARNESS };
})();
