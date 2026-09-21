"""Take an exported game apart and run what is inside it.

    python3 tools/test_export_runs.py

tools/test_export.mjs asks whether the downloaded file looks right. This asks
whether the thing inside it works: the engine it carries is unpacked, the
assets it carries are written at the paths the program names, and the program
is run by the same two calls the page makes — on real pygame-ce, with real
sprite and sound files.

WHY BOTH

An exported game is the one thing in this project that nobody watches fail. It
is downloaded, taken home, and opened on a machine with no console open and
nobody to ask. Every failure mode is quiet: an engine written one directory
too deep is an ImportError nobody reads; a sprite written beside the program
instead of under its working directory is a FileNotFoundError behind a blank
page. "The file contains a base64 PNG" does not answer either one. Loading it
does.

WHAT IS FAITHFUL HERE, AND WHAT IS NOT

Faithful: the engine files, the asset bytes, the program text and the Python
bootstrap all come out of a real export built by the real export.js. Nothing
is re-derived. The two calls are the two calls.

Not faithful, and deliberately so:

  * The page writes to /project and /lib. This cannot, so both are relocated
    into a temporary directory. That the page uses those exact paths, and that
    they are the ones the bootstrap chdirs into, is checked in test_export.mjs
    — where it is a string comparison and needs no root.
  * Pyodide's `js` module is stubbed. It exists in the bootstrap for input(),
    which an exported game has no editor for.
  * SDL is on its dummy driver, so this cannot tell you the game is visible.
    Only a browser can.
  * The two calls are made directly, so nothing here can see how the PAGE
    sequences them. Delete the `await` in front of the frame loop and every
    check below still passes. That belongs to test_export.mjs, which reads the
    boot code rather than running it — the two files divide the job, and
    neither one covers the other.
"""
import asyncio
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import types

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

HERE = pathlib.Path(__file__).resolve().parent
PYIDE = HERE.parent

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-52s %s" % ("ok" if ok else "FAIL", label, detail))


def done(code=None):
    bad = results.count(False)
    print("\n%s (%d checks, %d failed)"
          % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
    sys.exit(code if code is not None else (1 if bad else 0))


# A program that uses a sprite, a sound, a key, a collision and a timer — so
# that "it ran" means several different things went right, not one.
GAME = '''from kaplay import *

kaplay(width=320, height=240, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")
loadSound("ding", "sounds/ding.wav")

player = add([sprite("bean"), pos(40, 40), area(), "player"])
coin = add([sprite("bean"), pos(44, 44), area(), "coin"])

seen = []


@onKeyDown("right")
def go_right():
    player.move(120, 0)


@player.onCollide("coin")
def got(c):
    seen.append("coin")
    c.destroy()


@wait(0.2)
def later():
    seen.append("timer")


onUpdate(lambda: seen.append("frame"))
'''

# ------------------------------------------------------------ build an export
build = """
import { readFileSync, writeFileSync } from "fs";
const ROOT = %s;
globalThis.fetch = async (url) => {
  try {
    const buf = readFileSync(ROOT + url);
    return { ok: true, text: async () => buf.toString("utf8"),
             arrayBuffer: async () =>
               buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  } catch { return { ok: false, text: async () => "",
                     arrayBuffer: async () => new ArrayBuffer(0) }; }
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {} }) };
new Function("window","document","fetch",
  readFileSync(ROOT + "/static/runtime.js","utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch);
new Function("window","document","fetch","btoa",
  readFileSync(ROOT + "/static/export.js","utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch, globalThis.btoa);
const html = await globalThis.window.PyIDEExport.buildGamePage(
  readFileSync(process.argv[2], "utf8"), "Replay Test");
writeFileSync(process.argv[3], html);
""" % json.dumps(str(PYIDE))

work = pathlib.Path(tempfile.mkdtemp())
(work / "build.mjs").write_text(build)
(work / "game.py").write_text(GAME)

built = subprocess.run(
    ["node", str(work / "build.mjs"), str(work / "game.py"), str(work / "out.html")],
    capture_output=True, text=True)
check("export.js builds a page", built.returncode == 0,
      built.stderr.strip().splitlines()[-1] if built.returncode else
      "%.0f KB" % ((work / "out.html").stat().st_size / 1024))
if built.returncode:
    done(1)

html = (work / "out.html").read_text()


def declared(name):
    """Read back a `var NAME = ...;` the page declares, by line."""
    prefix = "var %s = " % name
    for line in html.splitlines():
        if line.startswith(prefix) and line.endswith(";"):
            return json.loads(line[len(prefix):-1])
    raise AssertionError("the export declares no %s on one line" % name)


engine = declared("ENGINE")
assets = declared("ASSETS")
program = declared("PROGRAM")
bootstrap = declared("BOOTSTRAP")

check("it carries the whole engine", len(engine) > 20, "%d files" % len(engine))
check("it carries the assets the program names",
      sorted(assets) == ["images/bean.png", "sounds/ding.wav"], " ".join(sorted(assets)))
check("it carries the program unchanged", program == GAME)

# ------------------------------------------------- unpack it, as the page does
root = work / "root"
project = root / "project"        # where the bootstrap will chdir to

# Where things go is read OUT OF THE PAGE, not decided here.
#
# An earlier version of this file wrote the assets into the project directory
# because that is where they belong — which meant that pointing export.js at
# some other directory changed nothing and every check still passed. A replay
# that supplies the answer it is checking is not a replay. Both destinations
# now come from the page's own source, so moving either one lands the files
# somewhere the program does not look, and the game fails here the way it
# would on a student's laptop.
asset_dir = re.search(r"writeFile\(py, '(/[A-Za-z0-9_\-/]*)' \+ path", html)
engine_dir = re.search(r"writeFile\(py, '(/[A-Za-z0-9_\-/]*)' \+ rel", html)
check("the page says where it puts the assets", asset_dir is not None,
      asset_dir.group(1) if asset_dir else "no writeFile for assets")
check("and where it puts the engine", engine_dir is not None,
      engine_dir.group(1) if engine_dir else "no writeFile for the engine")
if not (asset_dir and engine_dir):
    done(1)


def relocate(absolute):
    """An absolute path from the page, under this test's temporary root."""
    return root / absolute.strip("/")


for rel, text in engine.items():
    target = relocate(engine_dir.group(1)) / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)

import base64                                                  # noqa: E402
for path, b64 in assets.items():
    target = relocate(asset_dir.group(1)) / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(b64))

# kaplay/ is the package directory inside wherever the engine went; its parent
# is what goes on sys.path.
lib = relocate(engine_dir.group(1)).parent

check("the engine unpacks to an importable package",
      (relocate(engine_dir.group(1)) / "__init__.py").is_file())
sprite = relocate(asset_dir.group(1)) / "images/bean.png"
sound = relocate(asset_dir.group(1)) / "sounds/ding.wav"
check("a carried sprite is a real PNG on disk",
      sprite.read_bytes()[1:4] == b"PNG", "%d bytes" % sprite.stat().st_size)
check("a carried sound is a real WAV on disk",
      sound.read_bytes()[:4] == b"RIFF", "%d bytes" % sound.stat().st_size)

# ------------------------------------------------------------- run it, as well
# The bootstrap owns one absolute path — the working directory it chdirs into
# — and it becomes a path this process may write to. Everything else about the
# bootstrap is untouched.
relocated = bootstrap.replace("PROJECT_DIR = '/project'",
                              "PROJECT_DIR = %r" % str(project))
check("the bootstrap's working directory was relocated",
      relocated != bootstrap and str(project) in relocated,
      "" if relocated != bootstrap else "PROJECT_DIR is no longer spelled that way")

# The engine's directory is not the bootstrap's doing: the page puts it on
# sys.path itself, right after writing the files. Replayed here rather than
# assumed, so that dropping that line from export.js fails this test.
put_on_path = re.search(r"sys\.path\.insert\(0, '(/lib)'\)", html)
check("the page puts the engine's directory on sys.path", put_on_path is not None)
check("and writes the engine into that same directory",
      put_on_path is not None and ("'%s/kaplay/' + rel" % put_on_path.group(1)) in html)
if put_on_path:
    sys.path.insert(0, str(lib))

# Pyodide's js module, which the bootstrap imports for input().
js = types.ModuleType("js")
js.window = types.SimpleNamespace(__pyide_inline=False, prompt=lambda *a: "")
sys.modules["js"] = js

os.environ["KAYPY_TEST_MAX_FRAMES"] = "30"

scope = {"__name__": "__main__"}
try:
    exec(compile(relocated, "bootstrap", "exec"), scope)
    booted, why = True, ""
except Exception as exc:
    booted, why = False, "%s: %s" % (type(exc).__name__, exc)
check("the carried bootstrap runs", booted, why)
if not booted:
    done(1)

check("and defines the two calls the page makes",
      callable(scope.get("_pyide_run_game")) and callable(scope.get("_pyide_drive_game")))

status = scope["_pyide_run_game"](program)
check("the program's top level runs, on the carried engine", status == "ok",
      "status %r" % status)

if status == "ok":
    loop_status = asyncio.run(scope["_pyide_drive_game"]())
    check("and the frame loop runs and ends", loop_status == "ok",
          "status %r" % loop_status)

    # What the game itself recorded. This is the part that says the assets
    # were found: a sprite that failed to load raises before any of it.
    import kaplay.engine as ke
    main = sys.modules.get("__main__")
    seen = getattr(main, "seen", None)
    check("the game's own update handler ran", seen and "frame" in seen,
          "%d frames" % (seen.count("frame") if seen else 0))
    check("its collision fired, so the sprites really loaded",
          seen and "coin" in seen)
    if ke._engine is not None:
        ke._engine._started = True
        ke._engine._running = False
        ke._engine = None

# ---------------------------------------- and the same thing without an asset
# A program naming a sprite that was never carried must fail the way it would
# anywhere else — by name — rather than drawing nothing and saying nothing.
missing = GAME.replace("images/bean.png", "images/not_a_sprite.png")
ke_mod = sys.modules.get("kaplay.engine")
if ke_mod is not None:
    ke_mod._engine = None
import io                                                       # noqa: E402
err = io.StringIO()
real_stderr, sys.stderr = sys.stderr, err
try:
    bad_status = scope["_pyide_run_game"](missing)
finally:
    sys.stderr = real_stderr
check("a sprite that was not carried fails loudly, by name",
      bad_status == "error" and "not_a_sprite.png" in err.getvalue(),
      err.getvalue().strip().splitlines()[-1][:60] if err.getvalue() else "silent")
if ke_mod is not None and ke_mod._engine is not None:
    ke_mod._engine._started = True
    ke_mod._engine._running = False
    ke_mod._engine = None

shutil.rmtree(work, ignore_errors=True)
done()
