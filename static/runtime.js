/* PyIDE — the Python side of running a console program.
 *
 * Lives in its own file because two pages need it: the editor, and the demo
 * page a "hide my code" share link opens. Keeping one copy means the input()
 * shim, the runaway-loop guard and the traceback filtering can't drift apart
 * between them.
 *
 * quote_source is the one thing that differs. Normally a traceback quotes the
 * offending line, which is most of what makes an error useful to a beginner.
 * On a demo link the whole point is that the source isn't on display, so the
 * error still names the line number but prints no code.
 *
 * ---------------------------------------------------------------------------
 * How input() reads a line
 *
 * input() is synchronous and reading a keystroke is not, which for years left
 * window.prompt() as the only way to get a string from a student without
 * making them write `await`. WebAssembly stack switching removes that
 * constraint: run_sync() suspends the Python frame, lets the browser deliver
 * the keystrokes, and resumes with the answer. The student's code stays
 * exactly what the textbook says — `name = input("Your name? ")` — and the
 * typing happens in the output pane, where the rest of the transcript is.
 *
 * Stack switching needs two things, and both are checked at the moment of the
 * call rather than assumed: a browser that supports it, and a program started
 * through runPythonAsync (a plain runPython call has no suspender on the stack
 * to switch to). Where either is missing this falls back to the old dialog, so
 * an older browser gets a working IDE rather than a hung one.
 */

window.PyIDERuntime = (function () {
  "use strict";

  var BOOTSTRAP = [
    "import builtins, linecache, os, sys, time, traceback",
    "import js",
    "",
    "try:",
    "    from pyodide.ffi import can_run_sync, run_sync",
    "except ImportError:      # a Pyodide without stack switching",
    "    run_sync = None",
    "    def can_run_sync():",
    "        return False",
    "",
    "# Console programs get their own folder, so open('notes.txt') always lands",
    "# somewhere predictable — and never in the game's asset folder, which a",
    "# previous run may have left as the working directory.",
    "PROJECT_DIR = '/project'",
    "os.makedirs(PROJECT_DIR, exist_ok=True)",
    "",
    "# Their own .py files are importable, which is the point of letting them",
    "# make more than one. chdir alone would not do it: Python searches",
    "# sys.path, not the working directory.",
    "if PROJECT_DIR not in sys.path:",
    "    sys.path.insert(0, PROJECT_DIR)",
    "",
    "# No __pycache__. A stale .pyc surviving an edit is a miserable thing to",
    "# debug, and the directory would clutter a folder the student can see.",
    "sys.dont_write_bytecode = True",
    "",
    "def _forget_project_modules():",
    "    \"\"\"Drop anything imported from the project folder.",
    "",
    "    Python caches modules in sys.modules and will happily hand back the",
    "    version it imported ten minutes ago. Without this, editing helper.py",
    "    and pressing Run again keeps running the old code — the student sees",
    "    their change have no effect and has no way to find out why.",
    "    \"\"\"",
    "    import importlib",
    "    root = PROJECT_DIR + '/'",
    "    stale = []",
    "    for name, mod in list(sys.modules.items()):",
    "        where = getattr(mod, '__file__', None)",
    "        if where and str(where).startswith(root):",
    "            stale.append(name)",
    "    for name in stale:",
    "        sys.modules.pop(name, None)",
    "    importlib.invalidate_caches()",
    "",
    "def _own_file(filename):",
    "    \"\"\"Did the student write this file? main.py, or a module beside it.\"\"\"",
    "    if filename == 'main.py':",
    "        return True",
    "    return (filename.startswith(PROJECT_DIR + '/')",
    "            and filename.endswith('.py'))",
    "",
    "def _short(filename):",
    "    if filename.startswith(PROJECT_DIR + '/'):",
    "        return filename[len(PROJECT_DIR) + 1:]",
    "    return filename",
    "",
    "def _write_traceback(err, quote_source=True):",
    "    \"\"\"Only the student's own frames, named by their own file.",
    "",
    "    Written out by hand rather than with traceback.format_list because the",
    "    quoted source line has to be optional: a demo link shows where an error",
    "    happened without showing the code it happened in.",
    "    \"\"\"",
    "    frames = [f for f in traceback.extract_tb(err.__traceback__)",
    "              if _own_file(f.filename)]",
    "    if frames:",
    "        sys.stderr.write('Traceback (most recent call last):\\n')",
    "        for f in frames:",
    "            sys.stderr.write('  File \"%s\", line %d, in %s\\n'",
    "                             % (_short(f.filename), f.lineno, f.name))",
    "            if quote_source and f.line:",
    "                sys.stderr.write('    %s\\n' % f.line.strip())",
    "    if isinstance(err, SyntaxError):",
    "        # A syntax error in an imported module arrives here rather than at",
    "        # the top. format_exception_only would print the offending source",
    "        # line and the full /project/ path, so it is written out by hand.",
    "        where = _short(err.filename or '')",
    "        msg = 'SyntaxError'",
    "        if where:",
    "            msg += ' in ' + where",
    "        if err.lineno:",
    "            msg += ' on line %d' % err.lineno",
    "        sys.stderr.write('%s: %s\\n' % (msg, err.msg))",
    "        if quote_source and err.text:",
    "            sys.stderr.write('    %s\\n' % err.text.strip())",
    "        return",
    "    for line in traceback.format_exception_only(type(err), err):",
    "        sys.stderr.write(line)",
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
    "def _inline_ready():",
    "    \"\"\"Can this call be answered in the output pane?",
    "",
    "    Three separate things, all of which can be false on their own: the page",
    "    offers an input line (__pyide_inline is switched off during a game,",
    "    where SDL owns the keyboard), the browser supports stack switching, and",
    "    we are inside a runPythonAsync call so there is a stack to switch.",
    "    \"\"\"",
    "    try:",
    "        if not js.window.__pyide_inline:",
    "            return False",
    "        return bool(can_run_sync())",
    "    except Exception:",
    "        return False",
    "",
    "def _pyide_input(prompt=''):",
    "    label = str(prompt)",
    "    # Anything printed without a trailing newline is still sitting in the",
    "    # buffer. Push it out before stopping to wait, or a student who wrote",
    "    #     print('Your name? ', end='')",
    "    #     name = input()",
    "    # ends up typing above a question that has not appeared yet. This only",
    "    # works because the page takes stdout raw rather than batched — see",
    "    # pipeOutput, where the same problem is explained from the other side.",
    "    sys.stdout.flush()",
    "",
    "    if _inline_ready():",
    "        # The page writes both the question and what was typed, so the",
    "        # transcript is built as it happens rather than reconstructed after.",
    "        value = run_sync(js.window.__pyide_read_line(label))",
    "    else:",
    "        value = js.window.prompt(label if label.strip() else 'Program input:')",
    "        # No pane to type into, so the transcript has to be assembled here.",
    "        if isinstance(value, str):",
    "            print(label + value)",
    "",
    "    # a cancelled dialog returns JS null, which is not a Python str",
    "    if not isinstance(value, str):",
    "        raise _Cancelled()",
    "    # Thinking time is not running time: a student who takes a minute to",
    "    # answer should still get the full limit for the rest of the program.",
    "    _deadline[0] = time.monotonic() + _limit[0]",
    "    return value",
    "",
    "builtins.input = _pyide_input",
    "",
    "def _pyide_run(source, seconds, quote_source=True):",
    "    _limit[0] = seconds",
    "    _deadline[0] = time.monotonic() + seconds",
    "    ticks = [0]",
    "    os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    os.chdir(PROJECT_DIR)",
    "    _forget_project_modules()",
    "    # Tracebacks quote the student's own source lines — except on a demo",
    "    # link, where the source is deliberately not on display. Clearing the",
    "    # entry matters as much as setting it: an earlier run in the same page",
    "    # would otherwise leave the code sitting in the cache.",
    "    if quote_source:",
    "        linecache.cache['main.py'] = (",
    "            len(source), None, source.splitlines(True), 'main.py')",
    "    else:",
    "        linecache.cache.pop('main.py', None)",
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
    "        if text and quote_source:",
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
    "        print('Stopped — the program was waiting for input.', file=sys.stderr)",
    "        return 'cancelled'",
    "    except SystemExit:",
    "        return 'ok'",
    "    except BaseException as err:",
    "        sys.settrace(None)",
    "        # the student's own frames only — across every file they wrote,",
    "        # so an error inside an imported module still says where it was",
    "        _write_traceback(err, quote_source)",
    "        return 'error'",
    "    finally:",
    "        sys.settrace(None)",
    ""
  ].join("\n");

  /* Pipe Python's stdout and stderr into an output pane.
   *
   * `write` rather than the more obvious `batched`, and the reason is the
   * whole point of the input line. A batched stream only hands text over when
   * it sees a newline, and `sys.stdout.flush()` does not move it — so
   *
   *     print("Your name? ", end="")
   *     name = input()
   *
   * would stop and wait for an answer while the question was still sitting in
   * the buffer, and the student would be typing above a prompt that hadn't
   * appeared yet. Measured, not guessed: with `batched` the question landed
   * after the answer. Taking the bytes raw puts the timing back under Python's
   * control, where flush() means what it says.
   *
   * A decoder per stream, kept across calls with {stream: true}, because a
   * character that straddles two chunks would otherwise arrive as garbage —
   * any accented letter or emoji a student prints is three or four bytes.
   */
  function pipeOutput(pyodide, write) {
    var outDecoder = new TextDecoder("utf-8");
    var errDecoder = new TextDecoder("utf-8");

    pyodide.setStdout({
      write: function (bytes) {
        write(outDecoder.decode(bytes, { stream: true }));
        return bytes.length;
      }
    });
    pyodide.setStderr({
      write: function (bytes) {
        write(errDecoder.decode(bytes, { stream: true }), "err");
        return bytes.length;
      }
    });
  }

  /* The other half of input(): the line a student types into.
   *
   * Both pages have an output pane and both need this, so it lives here rather
   * than being written twice. Python calls window.__pyide_read_line(prompt)
   * and blocks on the promise it returns.
   */
  function attachConsole(opts) {
    var outputEl = opts.outputEl;
    var onWaiting = opts.onWaiting || function () {};
    var pending = null;   // { resolve, field, line }

    function settle(value) {
      if (!pending) return;
      var done = pending;
      pending = null;
      /* Freeze what was typed into the transcript. Replacing the field with
         plain text rather than disabling it means the finished line is
         ordinary output — selectable, copyable, and impossible to type into
         again by clicking an old prompt. */
      var typed = document.createElement("span");
      typed.className = "typed";
      typed.textContent = (typeof value === "string" ? value : "") + "\n";
      if (done.field.parentNode === done.line) {
        done.line.replaceChild(typed, done.field);
      }
      onWaiting(false);
      done.resolve(value);
    }

    function build(prompt) {
      var line = document.createElement("span");
      line.className = "askline";

      if (prompt) {
        var label = document.createElement("span");
        label.textContent = String(prompt);
        line.appendChild(label);
      }

      var field = document.createElement("input");
      field.type = "text";
      field.className = "ask";
      field.autocomplete = "off";
      field.spellcheck = false;
      // a phone keyboard that autocapitalises turns "fred" into "Fred" and the
      // student's == comparison quietly stops matching
      field.setAttribute("autocorrect", "off");
      field.setAttribute("autocapitalize", "off");
      field.setAttribute("aria-label", String(prompt || "Program input"));
      line.appendChild(field);

      field.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          settle(field.value);
        } else if (e.key === "Escape") {
          // stopping the program is this page's job, not the document
          // shortcut's, which would otherwise fire on the same keystroke
          e.preventDefault();
          e.stopPropagation();
          settle(null);
        }
      });

      return { line: line, field: field };
    }

    window.__pyide_read_line = function (prompt) {
      return new Promise(function (resolve) {
        var made = build(prompt);
        pending = { resolve: resolve, field: made.field, line: made.line };
        outputEl.appendChild(made.line);
        made.field.focus();
        outputEl.scrollTop = outputEl.scrollHeight;
        onWaiting(true);
      });
    };

    // Clicking anywhere in the pane puts the caret back, the way clicking a
    // terminal window does. Ignored when text is being selected to copy.
    outputEl.addEventListener("mouseup", function () {
      if (!pending) return;
      var selection = window.getSelection();
      if (selection && String(selection).length) return;
      pending.field.focus();
    });

    window.__pyide_inline = true;

    return {
      isWaiting: function () { return !!pending; },
      /* Cancel the read. Python sees this as a cancelled input and stops the
         program, which is what Stop and Escape both mean here. */
      cancel: function () { settle(null); },
      /* Clearing the pane would otherwise delete the line the program is
         blocked on, leaving it waiting for a keystroke that can never arrive. */
      restore: function () {
        if (!pending) return;
        outputEl.appendChild(pending.line);
        pending.field.focus();
      },
      /* Switched off while a game runs: SDL takes the keyboard for the canvas,
         so a field in the output pane would collect nothing. */
      setEnabled: function (on) { window.__pyide_inline = !!on; }
    };
  }

  return {
    BOOTSTRAP: BOOTSTRAP,
    pipeOutput: pipeOutput,
    attachConsole: attachConsole
  };
})();
