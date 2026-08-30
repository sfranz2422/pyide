/* PyIDE — browser-side editor + Python runtime */

(function () {
  "use strict";

  var TIME_LIMIT_SECONDS = 15; // guards against runaway loops

  var $ = function (id) { return document.getElementById(id); };
  var outputEl = $("output");
  var runBtn = $("run");
  var runLabel = $("run-label");

  // ---------------------------------------------------------------- editor
  var editor = CodeMirror.fromTextArea($("editor"), {
    mode: "python",
    theme: "material-darker",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    readOnly: window.PYIDE.readonly ? "nocursor" : false,
    extraKeys: {
      "Ctrl-Enter": function () { run(); },
      "Cmd-Enter": function () { run(); },
      Tab: function (cm) {
        if (cm.somethingSelected()) cm.indentSelection("add");
        else cm.replaceSelection("    ", "end");
      }
    }
  });
  editor.setSize("100%", "100%");

  // ---------------------------------------------------------------- output
  function write(text, cls) {
    var node = document.createElement("span");
    if (cls) node.className = cls;
    node.textContent = text;
    outputEl.appendChild(node);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function clearOutput() { outputEl.textContent = ""; }

  $("clear").addEventListener("click", clearOutput);

  // --------------------------------------------------------------- runtime
  // Installed into Python once, at startup. Wraps user code so that:
  //  - input() uses a browser prompt and echoes into the output pane
  //  - a line-tracing guard stops runaway loops after TIME_LIMIT_SECONDS
  //  - tracebacks show only the student's own frames
  var BOOTSTRAP = [
    "import builtins, linecache, sys, time, traceback",
    "import js",
    "",
    "_deadline = [0.0]",
    "_limit = [0.0]",
    "",
    "class _TimeLimit(Exception):",
    "    pass",
    "",
    "class _Cancelled(Exception):",
    "    pass",
    "",
    "def _pyide_input(prompt=''):",
    "    label = str(prompt)",
    "    value = js.window.prompt(label if label.strip() else 'Program input:')",
    "    # a cancelled prompt returns JS null, which is not a Python str",
    "    if not isinstance(value, str):",
    "        raise _Cancelled()",
    "    print(label + value)",
    "    _deadline[0] = time.monotonic() + _limit[0]",
    "    return value",
    "",
    "builtins.input = _pyide_input",
    "",
    "def _pyide_run(source, seconds):",
    "    _limit[0] = seconds",
    "    _deadline[0] = time.monotonic() + seconds",
    "    ticks = [0]",
    "    # let tracebacks quote the student's own source lines",
    "    linecache.cache['main.py'] = (",
    "        len(source), None, source.splitlines(True), 'main.py')",
    "",
    "    def guard(frame, event, arg):",
    "        ticks[0] += 1",
    "        if ticks[0] % 1500 == 0 and time.monotonic() > _deadline[0]:",
    "            raise _TimeLimit()",
    "        return guard",
    "",
    "    try:",
    "        code = compile(source, 'main.py', 'exec')",
    "    except SyntaxError as err:",
    "        line = err.lineno or 0",
    "        text = (err.text or '').rstrip()",
    "        msg = 'SyntaxError on line %d: %s' % (line, err.msg)",
    "        if text:",
    "            msg += '\\n    ' + text.strip()",
    "        print(msg, file=sys.stderr)",
    "        return 'error'",
    "",
    "    scope = {'__name__': '__main__', '__builtins__': builtins}",
    "    sys.settrace(guard)",
    "    try:",
    "        exec(code, scope)",
    "        return 'ok'",
    "    except _TimeLimit:",
    "        sys.settrace(None)",
    "        print('Stopped after %g seconds. Is there a loop that never ends?'",
    "              % seconds, file=sys.stderr)",
    "        return 'timeout'",
    "    except _Cancelled:",
    "        sys.settrace(None)",
    "        print('Stopped — you cancelled the input box.', file=sys.stderr)",
    "        return 'cancelled'",
    "    except SystemExit:",
    "        return 'ok'",
    "    except BaseException as err:",
    "        sys.settrace(None)",
    "        tb = err.__traceback__.tb_next if err.__traceback__ else None",
    "        traceback.print_exception(type(err), err, tb, file=sys.stderr)",
    "        return 'error'",
    "    finally:",
    "        sys.settrace(None)",
    ""
  ].join("\n");

  var pyodide = null;
  var pyRun = null;
  var running = false;

  (async function () {
    try {
      pyodide = await loadPyodide();
      pyodide.setStdout({ batched: function (s) { write(s + "\n"); } });
      pyodide.setStderr({ batched: function (s) { write(s + "\n", "err"); } });
      pyodide.runPython(BOOTSTRAP);
      pyRun = pyodide.globals.get("_pyide_run");
      var version = pyodide.runPython(
        "import sys; '.'.join(str(v) for v in sys.version_info[:3])"
      );
      clearOutput();
      write("Python " + version + " ready. Press Run to start.\n", "dim");
      runBtn.disabled = false;
      runLabel.textContent = "Run";
    } catch (e) {
      clearOutput();
      write("Python failed to load. Check your connection and refresh.\n" + e + "\n", "err");
    }
  })();

  function repaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }

  async function run() {
    if (running || !pyRun) return;
    running = true;
    runBtn.disabled = true;
    runLabel.textContent = "Running…";
    clearOutput();
    await repaint();

    var source = editor.getValue();
    try {
      await pyodide.loadPackagesFromImports(source, {
        messageCallback: function () {},
        errorCallback: function () {}
      });
    } catch (e) {
      /* an unavailable third-party import will surface as a normal
         ModuleNotFoundError when the code runs */
    }

    try {
      var status = pyRun(source, TIME_LIMIT_SECONDS);
      if (status === "ok") write("\n— finished —\n", "dim");
    } catch (e) {
      write(String(e) + "\n", "err");
    } finally {
      running = false;
      runBtn.disabled = false;
      runLabel.textContent = "Run";
    }
  }

  runBtn.addEventListener("click", run);

  // ----------------------------------------------------------------- share
  var shareBtn = $("share");
  if (shareBtn) {
    shareBtn.addEventListener("click", async function () {
      shareBtn.disabled = true;
      var original = shareBtn.textContent;
      shareBtn.textContent = "Sharing…";
      try {
        var res = await fetch(window.PYIDE.shareUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: editor.getValue(),
            title: $("title").value,
            author: $("author").value
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not share this project.");
        $("share-url").value = data.url;
        $("modal").hidden = false;
        $("share-url").select();
      } catch (e) {
        write("\nShare failed: " + e.message + "\n", "err");
      } finally {
        shareBtn.disabled = false;
        shareBtn.textContent = original;
      }
    });
  }

  $("copy").addEventListener("click", function () {
    var field = $("share-url");
    field.select();
    navigator.clipboard.writeText(field.value).then(function () {
      $("copy").textContent = "Copied";
      setTimeout(function () { $("copy").textContent = "Copy"; }, 1500);
    }, function () {
      document.execCommand("copy");
    });
  });

  $("close-modal").addEventListener("click", function () { $("modal").hidden = true; });
  $("modal").addEventListener("click", function (e) {
    if (e.target === $("modal")) $("modal").hidden = true;
  });

  // -------------------------------------------------------------- download
  $("download").addEventListener("click", function () {
    var name = ($("title").value || "main").replace(/[^\w\-]+/g, "_").toLowerCase();
    var blob = new Blob([editor.getValue()], { type: "text/x-python" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".py";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
})();
