"""Run every lesson in a guide, on the real engine, and press its keys.

    python3 tools/test_guide.py                    # ../learn_pykaplay.md
    python3 tools/test_guide.py ../fruit_catcher.md ../adventure_game.md

Every fenced ```python block containing `from kaypy import *` is a whole
lesson. Each one is executed the way pressing Run executes it, then the game
is actually played for a few hundred frames: every key the lesson registered
a handler for is held down and released, the mouse is clicked, and every timer
the lesson set is run out. A lesson passes only if nothing raised.

WHAT REPLACED WHAT, AND WHY IT MATTERS

The old version of this file booted Pyodide and ran each lesson against a
hand-written JavaScript object pretending to be Kaplay — four hundred lines of
`loadSprite(){}` and `width: () => 800`. That stand-in was the test's weakest
point: it answered every call, so a lesson could only fail by raising, and
anything the stand-in got wrong (an argument order, a return type) was a bug
the test would never see because the test *was* the bug. It also meant the
lessons were checked against something no student ever runs.

Now there is no stand-in. `import kaypy` imports kaypy — the same package the
browser writes into Pyodide's filesystem, read out of the same bundle — and a
lesson that runs here is a lesson that runs in front of a class.

That is also why the keys are pressed rather than the handlers called. Calling
`fn()` directly proves the function's body works; it does not prove the
function is reachable. A handler registered for a key name kaypy does not know,
or attached to an object destroyed on the first frame, is silently never called
in the classroom, and calling it by hand hides exactly that.

WHAT IS STILL NOT COVERED

Nothing here draws to a screen anyone looks at: SDL is on its dummy driver, so
this can tell you a lesson runs and cannot tell you it looks right. Drawing is
confirmed in a browser by kaypy's tools/smoke_pyodide.html.
"""
import asyncio
import json
import os
import pathlib
import re
import sys
import tempfile

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

HERE = pathlib.Path(__file__).resolve().parent
PYIDE = HERE.parent
STATIC = PYIDE / "static"
ASSETS = STATIC / "assets"

FRAMES_PER_KEY = 4        # frames each key is held before the next one
SETTLE_FRAMES = 30        # frames to run before touching anything
TIMER_STEPS = 24          # quarter-seconds of game time run out at the end
TIMER_STEP = 0.25
MAX_KEY_ROUNDS = 8        # scene changes to follow before giving up


# ---------------------------------------------------- the engine, from the bundle
# The bundle, not the directory beside it, for the same reason
# test_game_runtime.py does it: the bundle is what the browser actually gets,
# and a stale one would pass every other check.
bundle_path = STATIC / "py" / "kaypy_bundle.json"
if not bundle_path.is_file():
    sys.exit("No static/py/kaypy_bundle.json — run tools/vendor_kaypy.py first.")

work = pathlib.Path(tempfile.mkdtemp())
lib = work / "lib"
for rel, text in json.loads(bundle_path.read_text()).items():
    target = lib / "kaypy" / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
sys.path.insert(0, str(lib))

import pygame                                                  # noqa: E402
import kaypy                                                   # noqa: E402
import kaypy.engine as ke                                     # noqa: E402

# Which names start a game, asked of the engine rather than written down here.
#
# This test already went blind once, when the package was renamed and it kept
# looking for the old import. It was hardened afterwards — but the hardening
# ALSO hardcoded the name, so when the init function was renamed both the
# check and the alarm meant to catch it missed in the same instant, and it
# reported "0 lessons" again, green.
#
# A guard written in terms of a name is only as current as that name. So the
# names come from the package: add an alias there and this follows it.
_init = kaypy.kaypy
INIT_NAMES = sorted(n for n in kaypy.__all__
                    if getattr(kaypy, n, None) is _init)
INIT_CALL = re.compile(r"^[ \t]*(?:%s)\(" % "|".join(INIT_NAMES), re.M)


# ------------------------------------------------------------- held keys
# onKeyDown does not read the event queue. It asks SDL which keys are held
# right now — `pygame.key.get_pressed()` — and under the dummy video driver
# nothing is ever held, so posting a KEYDOWN would fire onKeyPress and leave
# every onKeyDown handler untouched. Since onKeyDown is what nearly every
# lesson moves the player with, that would be most of the guide untested.
#
# So the harness holds keys itself: get_pressed() is answered from a set this
# file controls. isKeyDown() reads the same function, so it agrees.
_held = set()
# Which scene, if any, is being built right now — so a failure can say so.
# A scene built directly is built with zeros for its arguments, and knowing
# that is the difference between "the win screen is broken" and "the win
# screen wants a real score".
building = []


class _Keys:
    def __getitem__(self, code):
        return code in _held

    def __len__(self):
        return 512


pygame.key.get_pressed = lambda: _Keys()


def registered_keys(eng):
    """Every key code the lesson attached anything to, in a stable order."""
    seen, out = set(), []
    for group in (eng.events.key_down_handlers,
                  eng.events.key_press_handlers,
                  eng.events.key_release_handlers):
        for code, _fn in group:
            if code not in seen:
                seen.add(code)
                out.append(code)
    return out


async def play(eng):
    """Run the lesson's own frame loop, and play it while it runs.

    The loop yields with `await asyncio.sleep(0)` once a frame, so a second
    coroutine gets a turn between frames — which is where the keys go down and
    come up. Driving it from outside like this keeps the engine's loop the
    real one; nothing here reaches into a frame.
    """
    task = asyncio.ensure_future(eng.run_async())

    async def frames(n):
        for _ in range(n):
            if task.done():
                return
            await asyncio.sleep(0)

    await frames(SETTLE_FRAMES)

    # Keys are pressed in rounds rather than in one pass, because pressing one
    # can change which keys exist. A lesson with scenes registers the title
    # screen's handlers first; space calls go("game"), which clears every
    # handler and registers the game's instead. One pass over the keys that
    # existed at the start would test the title screen and never reach the
    # game — and the game is the part with the bugs in it.
    scene_now = getattr(eng, "_current_scene", None)
    pressed = set()
    for _round in range(MAX_KEY_ROUNDS):
        if task.done():
            break
        if getattr(eng, "_current_scene", None) != scene_now:
            scene_now = getattr(eng, "_current_scene", None)
            pressed.clear()          # a new scene: the same key, a new handler
        todo = [c for c in registered_keys(eng) if c not in pressed]
        if not todo:
            break
        for code in todo:
            pressed.add(code)
            pygame.event.post(pygame.event.Event(pygame.KEYDOWN, key=code))
            _held.add(code)
            await frames(FRAMES_PER_KEY)
            _held.discard(code)
            pygame.event.post(pygame.event.Event(pygame.KEYUP, key=code))
            await frames(2)
            if getattr(eng, "_current_scene", None) != scene_now:
                break                # the scene changed under us; start again

    if eng.events.click_handlers or any(
            o.exists() and "click" in o._event_handlers for o in eng._objs):
        middle = (eng.screen.get_width() // 2, eng.screen.get_height() // 2)
        pygame.event.post(pygame.event.Event(
            pygame.MOUSEBUTTONDOWN, button=1, pos=middle))
        await frames(4)

    # Every scene, not just the ones reachable by mashing keys.
    #
    # Pressing space at a title screen gets you into the game. Nothing you can
    # press gets you to the "you win" scene in four frames — you have to walk
    # the player to the portal — so a win screen with a typo in it would never
    # run here, and would first run in front of a class, at the one moment a
    # student is pleased with themselves. So each scene that has not been
    # visited is built directly.
    #
    # A scene that takes arguments (`go("win", score)`) is built with zeros.
    # That is a guess, and it is why a failure below names the scene: it is
    # either a real error in the scene or a scene that wants something a zero
    # cannot stand in for, and both are worth looking at.
    for name in list(getattr(eng, "_scenes", {})):
        if name == getattr(eng, "_current_scene", None):
            continue
        import inspect
        try:
            params = inspect.signature(eng._scenes[name]).parameters.values()
            need = sum(1 for p in params
                       if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
                       and p.default is p.empty)
        except (TypeError, ValueError):
            need = 0
        # Not wrapped in a try. Wrapping it in a fresh RuntimeError replaces
        # the traceback with this file's, and the report then blames the
        # harness for a typo in the lesson — which it did, until this comment
        # was the fix. Letting it propagate keeps the frame inside the scene,
        # which is the line that needs editing.
        building.append(name)
        eng.go(name, *([0] * need))
        building.pop()
        await frames(6)

    eng._running = False
    await asyncio.wait_for(task, timeout=10)

    # Frames here take no measurable time, so dt is ~0 and a wait(1, ...) or a
    # tween would never come due. Run the clock out by hand afterwards: a
    # lesson whose whole point is "after one second, this happens" gets its
    # second.
    for _ in range(TIMER_STEPS):
        eng.timers.update(TIMER_STEP)


def reset():
    if ke._engine is not None:
        ke._engine._started = True      # stop atexit re-entering the loop
        ke._engine._running = False
        ke._engine = None
    _held.clear()
    building.clear()
    try:
        pygame.event.clear()
    except pygame.error:
        pass


def run_lesson(source):
    reset()
    # Hand the block to linecache under the name it is compiled as, so a
    # traceback out of a lesson prints the offending line rather than a blank.
    # Without this the report gives a line number in a file that does not
    # exist, and finding it means counting lines in the markdown by hand.
    import linecache
    lines = source.splitlines(keepends=True)
    linecache.cache["<lesson>"] = (len(source), None, lines, "<lesson>")

    scope = {"__name__": "__main__"}
    exec(compile(source, "<lesson>", "exec"), scope)
    eng = ke._engine
    if eng is None:
        raise RuntimeError("the lesson never called %s()" % INIT_NAMES[-1])
    asyncio.run(play(eng))
    return eng


def lessons_in(path):
    """The blocks in a guide that are whole programs, not fragments.

    A block has to import kaypy AND call it. The import alone is not enough:
    the very first block in the guide is the one line `from kaypy import *`,
    quoted to show what + Game gives you, and a block showing two lines of
    arguments mid-paragraph is not something anyone could press Run on.
    """
    text = pathlib.Path(path).read_text()
    blocks = re.findall(r"```python\n(.*?)```", text, re.S)
    return [(i + 1, b) for i, b in enumerate(blocks)
            if "from kaypy import" in b and INIT_CALL.search(b)]


def main(paths):
    os.chdir(ASSETS)          # so loadSprite("images/bean.png") resolves
    os.environ["KAYPY_TEST_MAX_FRAMES"] = "0"
    failed = total = 0

    for path in paths:
        found = lessons_in(path)
        print("%s — %d whole lessons" % (pathlib.Path(path).name, len(found)))
        if not found:
            # A file with Python in it and no runnable lesson is almost always
            # this test having gone blind, not a guide with nothing in it.
            #
            # It has now happened twice. First when the package was renamed:
            # the lessons still said `from kaplay import *`, this looked for
            # `from kaypy import`, and it reported "ALL PASSED (0 lessons)".
            # An alarm was added — and it went blind too, the day the init
            # function was renamed, because the alarm ALSO matched on a
            # function name, so both halves missed in the same instant.
            #
            # So this one names nothing. It asks a question no rename can
            # change: are there Python blocks here substantial enough to be
            # lessons? If yes, and none was recognised, the recogniser is
            # wrong — whatever it was that got renamed this time.
            blocks = re.findall(r"```python\n(.*?)```",
                                pathlib.Path(path).read_text(), re.S)

            def substantial(b):
                body = [l for l in b.splitlines()
                        if l.strip() and not l.strip().startswith("#")]
                return len(body) >= 4

            candidates = [b for b in blocks if substantial(b)]
            if candidates:
                failed += 1
                print("  FAIL %d Python block(s) here look like whole lessons, "
                      "but none was recognised." % len(candidates))
                print("       lessons_in() wants 'from kaypy import' AND a call to")
                print("       one of: %s" % ", ".join("%s()" % n for n in INIT_NAMES))
                first = candidates[0].strip().splitlines()[:3]
                print("       the first unrecognised block starts:")
                for line in first:
                    print("           %s" % line[:64])
            else:
                print("  (no block runs on its own; nothing here to check)")
        for number, source in found:
            total += 1
            first = next((l.strip() for l in source.splitlines()
                          if l.strip() and not l.strip().startswith("#")), "")
            try:
                eng = run_lesson(source)
                print("  ok   block %-3d %-46s %d objects, %d handlers"
                      % (number, first[:46], len(eng._objs),
                         len(registered_keys(eng)) + len(eng.events.update_handlers)))
            except Exception as exc:
                failed += 1
                import traceback
                frames = traceback.extract_tb(exc.__traceback__)

                # Whose fault is it? A traceback that never passes through the
                # lesson, or through the engine the lesson called, is this
                # file going wrong — and reporting that as a broken lesson
                # would send someone to edit markdown that is perfectly fine.
                # It happened while this was being written: the harness read
                # eng.width as a number when it is a method, and three good
                # lessons were marked FAIL.
                theirs = [f for f in frames
                          if f.filename == "<lesson>" or "kaypy/" in f.filename]
                if theirs:
                    where = (" — building scene %r with zeros" % building[-1]
                             if building else "")
                    print("  FAIL block %-3d %s%s" % (number, first[:46], where))
                    for f in theirs[-3:]:
                        where = ("the lesson, line %d" % f.lineno
                                 if f.filename == "<lesson>"
                                 else "%s:%d" % (f.filename.split("kaypy/")[-1],
                                                 f.lineno))
                        print("        %-28s %s" % (where, (f.line or "").strip()))
                    print("        %s: %s" % (type(exc).__name__, exc))
                else:
                    print("  ??   block %-3d %s" % (number, first[:46]))
                    print("        THIS TEST is broken, not the lesson:")
                    print("".join("        " + l for l in
                                  traceback.format_exception(
                                      type(exc), exc, exc.__traceback__)[-3:]))
        print()

    reset()
    print("%s (%d lessons, %d failed)"
          % ("SOME FAILED" if failed else "ALL PASSED", total, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    # docs/, inside the repo — the guides used to live beside it, outside
    # version control, where this could not find them and nothing backed them
    # up.
    args = sys.argv[1:] or [str(PYIDE / "docs" / "learn_pykaplay.md")]
    missing = [a for a in args if not pathlib.Path(a).is_file()]
    if missing:
        sys.exit("No such file: %s" % ", ".join(missing))
    args = [str(pathlib.Path(a).resolve()) for a in args]
    sys.exit(main(args))
