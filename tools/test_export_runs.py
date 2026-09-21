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

Faithful: the engine files, the asset bytes and the program text all come out
of a real export built by the real export.js, which fills in kaypy's own page
template. Nothing is re-derived. The two calls the page makes — kaypy's
webrun.run() and webrun.drive() — are the two calls made here, out of the
engine the page carried rather than out of this repo.

Not faithful, and deliberately so:

  * The page writes to /lib and /project. This cannot, so both are relocated
    into a temporary directory. The page's own declarations are what say where
    they go, so pointing the exporter elsewhere still fails here.
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
             json: async () => JSON.parse(buf.toString("utf8")),
             arrayBuffer: async () =>
               buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  } catch { return { ok: false, text: async () => "",
                     json: async () => ({}),
                     arrayBuffer: async () => new ArrayBuffer(0) }; }
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {} }) };
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

check("it carries the whole engine", len(engine) > 20, "%d files" % len(engine))
check("including kaypy's own runner, which the page calls", "webrun.py" in engine,
      "no separate bootstrap any more — the page calls kaplay.webrun")
check("it carries the assets the program names",
      sorted(assets) == ["images/bean.png", "sounds/ding.wav"], " ".join(sorted(assets)))
check("it carries the program unchanged", program == GAME)

# ------------------------------------------------- unpack it, as the page does
root = work / "root"

# Where things go is read OUT OF THE PAGE, not decided here.
#
# An earlier version of this file wrote the assets into the project directory
# because that is where they belong — which meant that pointing the exporter
# at some other directory changed nothing and every check still passed. A
# replay that supplies the answer it is checking is not a replay. Both
# destinations now come from the page's own source, so moving either one lands
# the files somewhere the program does not look, and the game fails here the
# way it would on a student's laptop.
lib_decl = re.search(r'var LIB = "([^"]+)"', html)
project_decl = re.search(r'var PROJECT = "([^"]+)"', html)
check("the page says where the engine goes", lib_decl is not None,
      lib_decl.group(1) if lib_decl else "no LIB in the page")
check("and where it runs the program from", project_decl is not None,
      project_decl.group(1) if project_decl else "no PROJECT in the page")
if not (lib_decl and project_decl):
    done(1)

# And that it really uses them for the writes, rather than declaring them and
# then writing somewhere else.
check("the engine is written under LIB",
      'writeFile(py, LIB + "/kaplay/" + rel' in html)
check("and the assets under PROJECT",
      'writeFile(py, PROJECT + "/" + path' in html)


def relocate(absolute):
    """An absolute path from the page, under this test's temporary root."""
    return root / absolute.strip("/")


lib = relocate(lib_decl.group(1))
project = relocate(project_decl.group(1))

for rel, text in engine.items():
    target = lib / "kaplay" / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)

import base64                                                  # noqa: E402
for path, b64 in assets.items():
    target = project / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(b64))

check("the engine unpacks to an importable package",
      (lib / "kaplay" / "__init__.py").is_file())
sprite = project / "images/bean.png"
sound = project / "sounds/ding.wav"
check("a carried sprite is a real PNG on disk",
      sprite.read_bytes()[1:4] == b"PNG", "%d bytes" % sprite.stat().st_size)
check("a carried sound is a real WAV on disk",
      sound.read_bytes()[:4] == b"RIFF", "%d bytes" % sound.stat().st_size)

# ------------------------------------------------------------- run it, as well
# The page puts the engine on sys.path and changes into the project directory
# before it runs anything. Both are replayed, and both are checked against the
# page rather than assumed — a page that stopped doing either would leave a
# game that cannot import its engine or cannot find its sprites, and this
# would go on passing.
check("the page puts the engine's directory on sys.path",
      "sys.path.insert(0, " in html and "LIB" in html)
check("and changes into the directory the assets went to",
      "os.chdir(" in html, "so relative paths in the program resolve")

os.environ["KAYPY_TEST_MAX_FRAMES"] = "30"
sys.path.insert(0, str(lib))
os.chdir(project)

try:
    from kaplay import webrun
    import kaplay.engine as ke
    imported, why = True, ""
except Exception as exc:
    imported, why = False, "%s: %s" % (type(exc).__name__, exc)
check("the engine the page carries imports on its own", imported, why)
if not imported:
    done(1)

check("and it is the copy out of the page, not this repo's",
      pathlib.Path(webrun.__file__).is_relative_to(root),
      pathlib.Path(webrun.__file__).parent.parent.name)

status = webrun.run(program)
check("the program's top level runs, on the carried engine", status == "ok",
      "status %r" % status)

if status == "ok":
    loop_status = asyncio.run(webrun.drive())
    check("and the frame loop runs and ends", loop_status == "ok",
          "status %r" % loop_status)

    # What the game itself recorded. This is the part that says the assets
    # were found: a sprite that failed to load raises before any of it.
    seen = getattr(sys.modules.get("__main__"), "seen", None)
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
if ke._engine is not None:
    ke._engine = None
import io                                                       # noqa: E402
err = io.StringIO()
real_stderr, sys.stderr = sys.stderr, err
try:
    bad_status = webrun.run(missing)
finally:
    sys.stderr = real_stderr
check("a sprite that was not carried fails loudly, by name",
      bad_status == "error" and "not_a_sprite.png" in err.getvalue(),
      err.getvalue().strip().splitlines()[-1][:60] if err.getvalue() else "silent")
if ke._engine is not None:
    ke._engine._started = True
    ke._engine._running = False
    ke._engine = None

shutil.rmtree(work, ignore_errors=True)
done()
