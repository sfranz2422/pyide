"""The kaypy game runtime, as far as it can be checked without a browser.

    python3 tools/test_game_runtime.py

WHAT THIS CAN AND CANNOT COVER

The half that needs a browser — pygame-ce loading under Pyodide, SDL drawing to
a canvas, the frame loop yielding to the page — is confirmed by
kaypy's tools/smoke_pyodide.html, run by hand. It cannot be done here: this
sandbox has no access to Pyodide's package CDN, and an SDL canvas is a browser
object.

What CAN be checked here is everything either side of that, and it is most of
what breaks:

  * the bundle the browser downloads unpacks into a working package;
  * the two runtime functions do what app.js expects of them — setup and loop
    reported separately, an error in either one caught and attributed;
  * the asset paths game.js fetches are the paths a program actually names;
  * the game starter students are handed still runs.

The engine is imported FROM THE BUNDLE, not from the vendored directory beside
it, because the bundle is what the browser actually gets. A bundle that had
gone stale would pass every other check in this file.
"""
import asyncio
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

HERE = pathlib.Path(__file__).resolve().parent
PYIDE = HERE.parent
STATIC = PYIDE / "static"
ASSETS = STATIC / "assets"

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-52s %s" % ("ok" if ok else "FAIL", label, detail))


# ------------------------------------------------- the bundle the browser gets
bundle_path = STATIC / "py" / "kaypy_bundle.json"
check("the engine bundle exists", bundle_path.is_file(),
      "run tools/vendor_kaypy.py" if not bundle_path.is_file() else
      "%.0f KB" % (bundle_path.stat().st_size / 1024))
if not bundle_path.is_file():
    sys.exit(1)

bundle = json.loads(bundle_path.read_text())
check("it is one request, not twenty-eight", len(bundle) > 20,
      "%d files" % len(bundle))
check("it carries the package entry point", "__init__.py" in bundle)

work = pathlib.Path(tempfile.mkdtemp())
lib = work / "lib"
for rel, text in bundle.items():
    target = lib / "kaypy" / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
sys.path.insert(0, str(lib))

import kaypy as _mod                                          # noqa: E402
import kaypy.engine as ke                                     # noqa: E402

check("it unpacks into an importable package",
      pathlib.Path(_mod.__file__).is_relative_to(lib),
      pathlib.Path(_mod.__file__).name)

# The bundle must not have drifted from the vendored copy beside it.
vendored = STATIC / "py" / "kaypy"
drifted = [rel for rel, text in bundle.items()
           if not (vendored / rel).is_file() or (vendored / rel).read_text() != text]
check("and matches the vendored copy exactly", not drifted,
      "differs: %s" % drifted[:3] if drifted else "")

stamp = json.loads((STATIC / "py" / "kaypy.json").read_text())
check("the version stamp agrees with the bundle",
      stamp.get("files") == len(bundle),
      "stamp says %s, bundle has %d" % (stamp.get("files"), len(bundle)))

# --------------------------------------------- the names PyIDE's guide teaches
TEACHES = ["kaplay", "add", "sprite", "pos", "area", "body", "anchor", "scale",
           "rotate", "color", "opacity", "outline", "text", "rect", "circle",
           "onUpdate", "onKeyDown", "onKeyPress", "onKeyRelease", "onClick",
           "onCollide", "wait", "loop", "tween", "easings", "scene", "go",
           "width", "height", "center", "dt", "vec2", "Vec2", "rand", "randi",
           "choose", "chance", "lerp", "clamp", "wave", "time", "destroy",
           "destroyAll", "isKeyDown", "rgb", "mousePos", "toWorld", "setCamPos",
           "setCamScale", "shake", "play", "debug", "addLevel", "addKaboom",
           "loadSprite", "loadSpriteAtlas", "loadSound", "setGravity",
           "setBackground", "get", "state", "fixed", "move", "offscreen", "tile",
           # the four gaps — a game that aims, draws a health bar, kills an
           # enemy and keeps a high score
           "onMousePress", "onMouseRelease", "onMouseDown", "onMouseMove",
           "isMouseDown", "isMousePressed", "isMouseReleased", "isMouseMoved",
           "mouseDeltaPos", "onDraw", "drawRect", "drawCircle", "drawLine",
           "drawLines", "drawText", "drawSprite", "health", "lifespan",
           "setData", "getData"]
absent = [n for n in TEACHES if not hasattr(_mod, n)]
check("every name the guide teaches is in the bundle", not absent,
      "missing %s" % absent)

# ---------------------------------- the two runtime functions app.js relies on
# Lifted out of runtime.js rather than reimplemented, so this checks the real
# source. The bootstrap is a JS array of Python lines.
runtime_js = (STATIC / "runtime.js").read_text()
check("runtime.js still defines both halves",
      "_pyide_run_game" in runtime_js and "_pyide_drive_game" in runtime_js)
check("and app.js calls them in that order",
      re.search(r"_pyide_run_game[\s\S]{0,400}_pyide_drive_game",
                (STATIC / "app.js").read_text()) is not None)
game_js_text = (STATIC / "game.js").read_text()
check("game.js stops by clearing the engine's running flag, not by tearing down",
      "_running = False" in game_js_text)

# SDL puts keydown/keyup/keypress on `document` and never takes them off, so a
# student who presses Stop cannot type. The listeners have to be tracked as
# they go on — which means wrapping addEventListener BEFORE pygame-ce loads,
# since one that is never seen going on cannot be taken off.
check("the keyboard is handed back on stop",
      "keyboardToGame(false)" in game_js_text)
check("and taken again on the next run",
      "keyboardToGame(true)" in game_js_text)
check("the listeners are watched before pygame-ce loads",
      game_js_text.index("watchKeyListeners()")
      < game_js_text.index('loadPackage("pygame-ce")'),
      "or SDL's registrations are never seen")

# ------------------------------------------------------ the loop's own contract
# app.js awaits the loop and puts the toolbar back when it resolves, so the
# loop MUST return rather than run for ever once _running goes false.
eng = _mod.kaplay(width=64, height=64)
frames = []
_mod.onUpdate(lambda: frames.append(1))


async def drive_then_stop():
    task = asyncio.ensure_future(eng.run_async())
    for _ in range(200):
        await asyncio.sleep(0)
        if len(frames) > 5:
            break
    eng._running = False           # exactly what game.js's stop() does
    await asyncio.wait_for(task, timeout=5)


try:
    asyncio.run(drive_then_stop())
    returned = True
except Exception as exc:
    returned = False
    why = "%s: %s" % (type(exc).__name__, exc)
check("clearing _running makes the loop return", returned,
      "" if returned else why)
check("and it ran frames before that", len(frames) > 5, "%d frames" % len(frames))
ke._engine = None

# -------------------------------------------------- the assets game.js fetches
# The regex in game.js decides which files get written into the filesystem
# before a program runs. A path it misses is a sprite that silently is not
# there, so it is checked against the real inserts rather than by eye.
game_js = (STATIC / "game.js").read_text()
pattern = re.search(r"var ASSET_RE =\s*/(.+?)/g;", game_js, re.S)
check("game.js has an asset pattern", pattern is not None)
asset_re = re.compile(pattern.group(1).replace("\\/", "/"))

manifest = json.loads((ASSETS / "manifest.json").read_text())
SAMPLES = [
    ('loadSprite("bean", "images/bean.png")', "images/bean.png"),
    ('loadSprite("elf", "dungeon/elf_m.png", sliceX=9)', "dungeon/elf_m.png"),
    ('loadSound("ding", "sounds/ding.wav")', "sounds/ding.wav"),
    ('loadSpriteAtlas("dungeon.png", {})', "dungeon.png"),
]
for snippet, wanted in SAMPLES:
    found = [m.group(1) for m in asset_re.finditer(snippet)]
    check("it finds %s" % wanted, found == [wanted], repr(found))

# and every path it finds must be a file that exists to be fetched
for _, wanted in SAMPLES:
    check("  and %s is really there" % wanted, (ASSETS / wanted).is_file())

# ------------------------------------------------- the starter students get
starter = re.search(r"GAME_CODE = '''(.*?)'''", (PYIDE / "app.py").read_text(), re.S)
check("app.py still has a game starter", starter is not None)
if starter:
    source = starter.group(1)
    check("the starter is recognised as a game",
          re.search(r"^[ \t]*(?:from[ \t]+kaypy[ \t]+import|import[ \t]+kaypy)\b",
                    source, re.M) is not None)
    # Run it for real, from the directory the assets live in.
    os.chdir(ASSETS)
    ke._engine = None
    os.environ["KAYPY_TEST_MAX_FRAMES"] = "20"
    try:
        scope = {}
        exec(compile(source, "main.py", "exec"), scope)
        asyncio.run(ke.current_engine().run_async())
        ran, why = True, ""
    except Exception as exc:
        ran, why = False, "%s: %s" % (type(exc).__name__, str(exc)[:70])
    check("and it runs on kaypy, with the real sprite pack", ran, why)
    if ke._engine is not None:
        ke._engine._started = True
        ke._engine._running = False
        ke._engine = None

shutil.rmtree(work, ignore_errors=True)

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
