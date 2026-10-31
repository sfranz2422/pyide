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
    "import builtins, linecache, os, re, sys, time, traceback, types",
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
    "    _explain_blocked_request(err)",
    "",
    "def _explain_blocked_request(err):",
    "    \"\"\"Say what a refused fetch actually means.",
    "",
    "    A request the browser refuses arrives as a ConnectionError wrapping",
    "    \"Failed to execute 'send' on 'XMLHttpRequest'\", which never says the",
    "    word CORS and reads exactly like a bug in the student's own code.",
    "",
    "    It almost never is. The fetch happens in the browser, so the site has",
    "    to send a header saying other pages may read it, and most sites do",
    "    not. Without this note a student rewrites working code for twenty",
    "    minutes looking for their mistake.",
    "    \"\"\"",
    "    text = '%s %s' % (type(err).__name__, err)",
    "    if 'XMLHttpRequest' not in text and 'NetworkError' not in text:",
    "        return",
    "    sys.stderr.write(",
    "        '\\nThe browser would not let the program read that address.\\n'",
    "        'This is usually not a mistake in your code. A website has to'",
    "        ' say that other pages may read it, and many do not.\\n'",
    "        'Try an address meant to be read by programs, and check that it'",
    "        ' starts with https://\\n')",
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
    "# ---------------------------------------------------------------- charts",
    "# plt.show() puts the chart in the output pane, as a picture, between the",
    "# lines printed before and after it — where a student expects it.",
    "#",
    "# Pyodide's own matplotlib backend draws into a box it adds to the end of",
    "# the page, outside the output pane, which is cleared and scrolled without",
    "# it. So matplotlib is pointed at a backend of ours instead: an ordinary",
    "# Agg canvas whose show() saves each open figure as a PNG and hands it to",
    "# window.__pyide_chart (attachConsole, which owns the pane). MPLBACKEND",
    "# is read when matplotlib is first imported, so it must be set here, before",
    "# any program runs; matplotlib.use() in a program still overrides it.",
    "#",
    "# The backend is a module made in memory rather than a file, because",
    "# matplotlib may not even be loaded yet: its parts are fetched only when",
    "# matplotlib asks for them, which is after the student's import.",
    "os.environ['MPLBACKEND'] = 'module://_pyide_charts'",
    "",
    "def _charts_attr(name):",
    "    # Fills the module in for real on the first touch, not just answers.",
    "    # pyplot reads module.FigureCanvas once and then copies the rest out",
    "    # with vars(module), which never calls __getattr__ — answering alone",
    "    # left FigureCanvas None there, and the first plt.plot() crashed.",
    "    if name not in ('FigureCanvas', 'FigureManager'):",
    "        raise AttributeError(name)",
    "    from matplotlib.backends.backend_agg import FigureCanvasAgg",
    "    from matplotlib.backend_bases import FigureManagerBase",
    "    _charts.FigureCanvas = FigureCanvasAgg",
    "    _charts.FigureManager = FigureManagerBase",
    "    return getattr(_charts, name)",
    "",
    "def _pyide_show(*args, **kwargs):",
    "    import base64, io, warnings",
    "    from matplotlib._pylab_helpers import Gcf",
    "    import matplotlib.pyplot as plt",
    "    # Text printed before show() must land above the chart, not below it.",
    "    sys.stdout.flush()",
    "    sys.stderr.flush()",
    "    hand_over = getattr(js.window, '__pyide_chart', None)",
    "    if hand_over is None:",
    "        print('Charts cannot be shown on this page.', file=sys.stderr)",
    "        plt.close('all')",
    "        return",
    "    # Drawing a chart is a few seconds of matplotlib's Python. Traced line",
    "    # by line by the loop guard it took several times longer, and the time",
    "    # counted against the student's limit — a program with three charts",
    "    # was stopped as an endless loop. So the guard is paused while it draws",
    "    # and the deadline moved on by however long the drawing took.",
    "    guard = sys.gettrace()",
    "    sys.settrace(None)",
    "    began = time.monotonic()",
    "    try:",
    "        for manager in Gcf.get_all_fig_managers():",
    "            buf = io.BytesIO()",
    "            # Twice the pixels, shown at half size: sharp on a laptop's",
    "            # high-density screen and on the classroom projector alike.",
    "            # Pyodide's matplotlib 3.10 warns about its own float sizes on",
    "            # every savefig, whatever is asked of it. The warning is about",
    "            # matplotlib, not the student's code, and in red above their",
    "            # chart it reads as their mistake — so only this call is hushed.",
    "            with warnings.catch_warnings():",
    "                warnings.simplefilter('ignore', DeprecationWarning)",
    "                manager.canvas.figure.savefig(buf, format='png', dpi=200,",
    "                                              bbox_inches='tight')",
    "            hand_over(base64.b64encode(buf.getvalue()).decode('ascii'))",
    "    finally:",
    "        # As in desktop Python, a shown figure is finished with: the next",
    "        # plt.plot() starts a fresh chart instead of drawing over this one.",
    "        plt.close('all')",
    "        _deadline[0] += time.monotonic() - began",
    "        sys.settrace(guard)",
    "",
    "_charts = types.ModuleType('_pyide_charts')",
    "_charts.__getattr__ = _charts_attr",
    "_charts.show = _pyide_show",
    "sys.modules['_pyide_charts'] = _charts",
    "",
    "def _open_charts():",
    "    \"\"\"How many figures were drawn and never shown. 0 without pyplot.\"\"\"",
    "    plt = sys.modules.get('matplotlib.pyplot')",
    "    return len(plt.get_fignums()) if plt else 0",
    "",
    "def _forget_charts():",
    "    plt = sys.modules.get('matplotlib.pyplot')",
    "    if plt:",
    "        plt.close('all')",
    "",
    "def _pyide_check(source, others_json='{}'):",
    "    \"\"\"The first syntax error in the project, as JSON, or '' when Python can",
    "    read every file. Run BEFORE the program, by the page, for syntax.js's",
    "    card: a typo is reported before a game loads its engine, and a typo in",
    "    helper.py before main.py imports it.",
    "",
    "    Compiles only, never runs anything, so it cannot have side effects and",
    "    has nothing to say about what a program does. That is the point: the",
    "    card is for code Python cannot read at all, and logic is never its",
    "    business. main.py first, then the other .py files by name, the order a",
    "    student would look in.",
    "    \"\"\"",
    "    import json",
    "    files = [('main.py', source)]",
    "    try:",
    "        others = json.loads(others_json or '{}')",
    "    except ValueError:",
    "        others = {}",
    "    files += sorted((n, t) for n, t in others.items()",
    "                    if n.endswith('.py') and n != 'main.py' and isinstance(t, str))",
    "    for name, text in files:",
    "        try:",
    "            compile(text, name, 'exec')",
    "        except SyntaxError as err:",
    "            return json.dumps({",
    "                'file': name, 'kind': type(err).__name__, 'msg': err.msg or '',",
    "                'line': err.lineno or 0, 'col': err.offset or 0,",
    "                'end_line': err.end_lineno or 0, 'end_col': err.end_offset or 0,",
    "                'text': (err.text or '').rstrip('\\n'),",
    "            })",
    "    return ''",
    "",
    "def _pyide_run(source, seconds, quote_source=True):",
    "    _limit[0] = seconds",
    "    _deadline[0] = time.monotonic() + seconds",
    "    ticks = [0]",
    "    os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    os.chdir(PROJECT_DIR)",
    "    _forget_project_modules()",
    "    # matplotlib outlives a run (it is not in the project folder), and so",
    "    # would the figures of a run that was stopped before plt.show(): the",
    "    # next run's chart would be drawn on top of them.",
    "    _forget_charts()",
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
    "        sys.settrace(None)",
    "        # Desktop Python says nothing here either: no show(), no window.",
    "        # But a blank pane gives a student nothing to go on, and the fix",
    "        # is one line they would never guess from the silence.",
    "        if _open_charts():",
    "            print('\\nYour program drew a chart but never showed it.'",
    "                  ' Add plt.show() after drawing it to see it.')",
    "            _forget_charts()",
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
    "",
    "def _pyide_run_world(source, run_id, quote_source=True, quiet_limit=10, fallback_limit=15):",
    "    \"\"\"Run a program that drives the block world (it imports mcpi).\"\"\"",
    "    return _pyide_run_turns(source, run_id, 'mcpi._pyide', ('mcpi',), 'the world',",
    "                            quote_source, quiet_limit, fallback_limit)",
    "",
    "def _pyide_run_pi(source, run_id, quote_source=True, quiet_limit=10, fallback_limit=15):",
    "    \"\"\"Run a program that drives the simulated Raspberry Pi (gpiozero, the",
    "    Sense HAT, the camera): the same turns as the world, through",
    "    _pyide_pi (static/py/pi/_pyide_pi) and pi.js.\"\"\"",
    "    return _pyide_run_turns(source, run_id, '_pyide_pi', _PI_PACKAGES, 'the Pi',",
    "                            quote_source, quiet_limit, fallback_limit)",
    "",
    "# Everything static/py/pi holds: imported fresh on every run, as mcpi is.",
    "_PI_PACKAGES = ('gpiozero', 'sense_hat', 'sense_emu', 'picamera', '_pyide_pi')",
    "",
    "def _pyide_run_turns(source, run_id, turns_name, packages, place, quote_source=True,",
    "                     quiet_limit=10, fallback_limit=15):",
    "    \"\"\"Run a program that takes turns with the page: the block world's or",
    "    the Pi's. `turns_name` is the module that takes them (mcpi/_pyide.py,",
    "    or _pyide_pi, which is the same shape), `packages` are imported fresh",
    "    for the run, and `place` is what the messages call the page's side.",
    "",
    "    Like _pyide_run, but such a program is meant to keep going — a Pi",
    "    lesson's `while True:` loop — so there is no time limit while it lets",
    "    the world have its turns: every mcpi call and every time.sleep does",
    "    (mcpi/_pyide.py says how), and the guard below does in a loop that",
    "    makes neither. A run ends when the program ends or Stop is pressed.",
    "",
    "    What a run can't survive is a loop that never lets the page have a",
    "    turn at all: the page is frozen and Stop can't be pressed. If the",
    "    guard's own turns don't work in some browser, quiet_limit catches that",
    "    loop after that many seconds without one, and says what to add.",
    "",
    "    Without stack switching there are no turns, so the run gets the",
    "    console's limit instead, after a sentence saying why.",
    "",
    "    Returns 'ok', 'stopped', 'timeout', 'cancelled' (Stop while waiting for",
    "    input()) or 'error'.",
    "    \"\"\"",
    "    # A fresh package every run: it stays imported between runs, so a",
    "    # program that changed it (block.STONE.id = 5, or anything in _pyide)",
    "    # would otherwise change every run after it, until a reload.",
    "    for name in [n for n in sys.modules if n.split('.')[0] in packages]:",
    "        del sys.modules[name]",
    "    import importlib",
    "    world = importlib.import_module(turns_name)",
    "    world.begin(run_id)",
    "    live = world.can_yield()",
    "    os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    os.chdir(PROJECT_DIR)",
    "    _forget_project_modules()",
    "    if quote_source:",
    "        linecache.cache['main.py'] = (",
    "            len(source), None, source.splitlines(True), 'main.py')",
    "    else:",
    "        linecache.cache.pop('main.py', None)",
    "    if not live:",
    "        print(\"This browser can't keep %s moving while your program runs.\"",
    "              \" You'll see what it did when it finishes, and a program that keeps\"",
    "              \" going is stopped after %g seconds. Chrome or Edge can do both.\"",
    "              % (place, fallback_limit))",
    "    _limit[0] = fallback_limit",
    "    _deadline[0] = time.monotonic() + fallback_limit",
    "    ticks = [0]",
    "    turns = {'broken': False}",
    "",
    "    def guard(frame, event, arg):",
    "        # Only the student's own code is watched: mcpi and the standard",
    "        # library run untraced, at full speed.",
    "        if event == 'call' and not _own_file(frame.f_code.co_filename):",
    "            return None",
    "        ticks[0] += 1",
    "        if ticks[0] % 1500:",
    "            return guard",
    "        if world.state['suspended']:",
    "            # Python run by the page while the program waits for its turn",
    "            # (the editor's completions): not the program's time.",
    "            return guard",
    "        now = time.monotonic()",
    "        if not live:",
    "            if now > _deadline[0]:",
    "                raise _TimeLimit()",
    "            return guard",
    "        if now - world.state['last'] > quiet_limit:",
    "            raise _TimeLimit()",
    "        if not turns['broken'] and now - world.state['last'] > 0.05:",
    "            try:",
    "                world.breathe(force=True)",
    "            except KeyboardInterrupt:",
    "                raise",
    "            except Exception:",
    "                # A browser that can't switch stacks from inside the",
    "                # tracer: quiet_limit is the backstop from now on.",
    "                turns['broken'] = True",
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
    "    real_sleep = time.sleep",
    "    time.sleep = world.sleep",
    "    # os._exit(0) ends a Pi program at once (the book's Quick Reaction Game",
    "    # does it from a button's callback). The real one would end Python",
    "    # itself, for this page, until a reload: here the run just ends.",
    "    real_exit = os._exit",
    "    os._exit = _pyide_exit",
    "    sys.settrace(guard)",
    "    try:",
    "        exec(code, scope)",
    "        # A Pi program whose last line set a callback (when_pressed) keeps",
    "        # running until Stop, as it does in Thonny: _pyide_pi.linger.",
    "        if hasattr(world, 'linger'):",
    "            world.linger()",
    "        sys.settrace(None)",
    "        # A program that caught the Stop and finished tidily was still stopped.",
    "        return 'stopped' if world.state['stopped_at'] is not None else 'ok'",
    "    except (world.WorldStopped, world.StopNow):",
    "        return 'stopped'",
    "    except _TimeLimit:",
    "        sys.settrace(None)",
    "        if live:",
    "            print('Stopped: your program ran for %g seconds without giving %s a'",
    "                  ' turn, so the page froze. A loop that runs for ever needs'",
    "                  ' time.sleep(0.1) inside it.' % (quiet_limit, place), file=sys.stderr)",
    "        else:",
    "            print('Stopped after %g seconds. Is there a loop that never ends?'",
    "                  % fallback_limit, file=sys.stderr)",
    "        return 'timeout'",
    "    except _Cancelled:",
    "        sys.settrace(None)",
    "        print('Stopped — the program was waiting for input.', file=sys.stderr)",
    "        return 'cancelled'",
    "    except SystemExit:",
    "        return 'ok'",
    "    except BaseException as err:",
    "        sys.settrace(None)",
    "        _write_traceback(err, quote_source)",
    "        return 'error'",
    "    finally:",
    "        sys.settrace(None)",
    "        time.sleep = real_sleep",
    "        os._exit = real_exit",
    "",
    "def _pyide_exit(status=0):",
    "    raise SystemExit(status)",
    "",
    "def _pyide_run_game(source, quote_source=True):",
    "    \"\"\"Run a game's top level. The frame loop is started separately.",
    "",
    "    Same shape as _pyide_run, minus the time limit and the trace guard.",
    "    A game loop is an infinite loop on purpose, so there is nothing to",
    "    time out, and per-line tracing would slow every callback down for the",
    "    rest of the run.",
    "",
    "    This runs the program the way `python game.py` runs it: top to bottom,",
    "    once. kaypy() builds the engine, everything after it registers",
    "    handlers, and then this returns — with the game built and not yet",
    "    moving. _pyide_drive_game() below is what sets it going.",
    "",
    "    The two are separate so that an error in the setup is reported as an",
    "    error in the setup, with the student's own traceback, rather than",
    "    arriving tangled up in whatever the loop was doing.",
    "    \"\"\"",
    "    os.makedirs(PROJECT_DIR, exist_ok=True)",
    "    os.chdir(PROJECT_DIR)",
    "    _forget_project_modules()",
    "",
    "    # The engine used to be called `kaplay`. A project saved before the",
    "    # rename still says so, and `import kaplay` now fails — correctly,",
    "    # there is no alias. But ModuleNotFoundError does not tell a student",
    "    # that one word is the whole problem, so this does, before running a",
    "    # line. game.js deliberately still recognises the old spelling as a",
    "    # game so that the message arrives here rather than in the console.",
    "    _old = re.search(r'^[ \\t]*(from[ \\t]+kaplay[ \\t]+import|import[ \\t]+kaplay)\\b',",
    "                     source, re.M)",
    "    if _old:",
    "        _line = source[:_old.start()].count('\\n') + 1",
    "        print('The engine is called kaypy now, not kaplay.\\n'",
    "              '    Line %d says:  %s\\n'",
    "              '    Change it to:  %s'",
    "              % (_line, _old.group(1).strip(),",
    "                 _old.group(1).strip().replace('kaplay', 'kaypy')),",
    "              file=sys.stderr)",
    "        return 'error'",
    "",
    "    if quote_source:",
    "        linecache.cache['main.py'] = (",
    "            len(source), None, source.splitlines(True), 'main.py')",
    "    else:",
    "        linecache.cache.pop('main.py', None)",
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
    "    # A real module, not a bare dict: the callbacks a game registers keep",
    "    # referring to its globals long after this function has returned, so",
    "    # the namespace has to outlive the call.",
    "    mod = types.ModuleType('__main__')",
    "    mod.__dict__['__builtins__'] = builtins",
    "    mod.__file__ = 'main.py'",
    "    previous = sys.modules.get('__main__')",
    "    sys.modules['__main__'] = mod",
    "    # _write_traceback lives on the old __main__ and the bridge looks for",
    "    # it there, so carry it across rather than losing tracebacks mid-game.",
    "    for name in ('_write_traceback', '_own_file', '_short'):",
    "        helper = getattr(previous, name, None)",
    "        if helper is not None:",
    "            setattr(mod, name, helper)",
    "    try:",
    "        exec(code, mod.__dict__)",
    "        return 'ok'",
    "    except SystemExit:",
    "        return 'ok'",
    "    except BaseException as err:",
    "        _write_traceback(err, quote_source)",
    "        try:",
    "            import kaypy as _k",
    "            _k.shutdown()",
    "        except Exception:",
    "            pass",
    "        return 'error'",
    "",
    "",
    "async def _pyide_drive_game():",
    "    \"\"\"Run the frame loop until the game ends or Stop is pressed.",
    "",
    "    kaypy's loop is a coroutine that yields with `await asyncio.sleep(0)`",
    "    every frame, which is what hands control back to the browser. Awaited",
    "    here, so this call does not return until the game is actually over —",
    "    the opposite of the old Kaplay runner, where JavaScript owned the loop",
    "    and this returned within milliseconds while the game carried on.",
    "",
    "    That difference is deliberate and useful: the Run button can now go",
    "    back to normal when the game ends by itself, instead of waiting to be",
    "    told.",
    "    \"\"\"",
    "    import kaypy.engine as _ke",
    "",
    "    engine = _ke._engine",
    "    if engine is None:",
    "        print('No game started. A game needs kaypy() before anything'",
    "              ' else — see the Sprites panel or press + Game for a'",
    "              ' starter.', file=sys.stderr)",
    "        return 'error'",
    "",
    "    try:",
    "        await engine.run_async()",
    "        return 'ok'",
    "    except BaseException as err:",
    "        # An error inside a callback surfaces here, sixty frames a second",
    "        # after the line that registered it. Report it once and stop,",
    "        # rather than a thousand identical tracebacks.",
    "        engine._running = False",
    "        _write_traceback(err, True)",
    "        return 'error'",
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

    /* plt.show() lands here (_pyide_show in BOOTSTRAP), one call per figure,
       with a PNG drawn at twice the size it should appear — halved once it has
       loaded, so a projector and a high-density laptop screen both get a sharp
       chart. max-width keeps a wide figure inside a narrow pane. Appended to
       the pane like any printed line, so Clear and the next Run remove it. */
    window.__pyide_chart = function (pngBase64) {
      var img = document.createElement("img");
      img.className = "chart";
      img.alt = "Chart drawn by the program";
      img.onload = function () {
        img.style.width = Math.round(img.naturalWidth / 2) + "px";
        outputEl.scrollTop = outputEl.scrollHeight;
      };
      img.src = "data:image/png;base64," + pngBase64;
      outputEl.appendChild(img);
      outputEl.scrollTop = outputEl.scrollHeight;
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

  /* Fetch whatever Pyodide packages (numpy, pandas, ...) the project imports,
   * before it runs.
   *
   * EVERY .py FILE, NOT JUST main.py
   *
   * loadPackagesFromImports only reads the text it is handed. Given main.py
   * alone, a helpers.py doing `import pandas` was never seen, and the program
   * died with ModuleNotFoundError on a line that is perfectly correct — with
   * nothing on screen to say the import had to be in main.py too.
   *
   * ONE CALL PER FILE, NOT ONE JOINED STRING
   *
   * Two files that each compile are not one file that compiles: a
   * `from __future__` import is only legal at the top, so gluing them together
   * could make the import scan fail and load nothing, silently.
   *
   * A failure here is swallowed on purpose: an import Pyodide can't provide
   * surfaces as the ordinary ModuleNotFoundError when the program runs, which
   * is the message a student can look up. */
  async function loadImports(pyodide, source, files) {
    var sources = [source];
    Object.keys(files || {}).forEach(function (name) {
      if (/\.py$/.test(name)) sources.push(files[name]);
    });
    for (var i = 0; i < sources.length; i++) {
      try {
        await pyodide.loadPackagesFromImports(sources[i], {
          messageCallback: function () {},
          errorCallback: function () {}
        });
      } catch (e) { /* see above */ }
    }
  }

  return {
    BOOTSTRAP: BOOTSTRAP,
    pipeOutput: pipeOutput,
    attachConsole: attachConsole,
    loadImports: loadImports
  };
})();
