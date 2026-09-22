"""The game PyIDE downloads and the game `kaypy web` builds are the same page.

    python3 tools/test_same_as_kaypy.py [--kaypy ~/kaypy]

This is the check the whole arrangement exists for. A student writes a game in
the browser, downloads it, and later installs kaypy at home and builds the same
game from the command line. Both should give them the same thing. If the two
exporters drift, what a student hits is "it works at school but not on my
laptop" — and they are fourteen, and the difference is in a boot sequence
neither of us will think to look at.

So the two are not kept in step by care. PyIDE does not write HTML at all: it
fills in kaypy's own web_page.html, carried in the engine bundle it vendors.
This proves that is still true, by building the same game both ways and
comparing what comes out.

WHAT MUST MATCH, AND WHAT MAY NOT

Everything except the three values that are the game itself — ENGINE, ASSETS
and PROGRAM — must match exactly. Those three may differ in one direction
only: PyIDE vendors a particular kaypy, so its engine can be *older* than the
checkout's without that being a fault. A difference in the page around them is
always a fault.

Skipped, not failed, when there is no kaypy checkout to compare against: this
runs on a machine that has PyIDE, and the developer's kaypy may be elsewhere.
Pass --kaypy if it is.
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PYIDE = HERE.parent

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-52s %s" % ("ok" if ok else "FAIL", label, detail))


GAME = '''from kaypy import *

kaplay(width=320, height=240, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")

player = add([sprite("bean"), pos(40, 40), area(), "player"])


@onKeyDown("right")
def go_right():
    player.move(120, 0)
'''

ap = argparse.ArgumentParser()
ap.add_argument("--kaypy", type=pathlib.Path,
                default=pathlib.Path(os.path.expanduser("~/kaypy")))
args = ap.parse_args()

kaypy = args.kaypy.resolve()
if not (kaypy / "kaypy" / "webbuild.py").is_file():
    print("  skip  no kaypy checkout at %s — pass --kaypy to compare" % kaypy)
    print("\nSKIPPED (nothing to compare against)")
    sys.exit(0)

work = pathlib.Path(tempfile.mkdtemp())
(work / "images").mkdir()
(work / "images" / "bean.png").write_bytes(
    (PYIDE / "static" / "assets" / "images" / "bean.png").read_bytes())
(work / "game.py").write_text(GAME)

# ------------------------------------------------------- build it with kaypy
sys.path.insert(0, str(kaypy))
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
from kaypy import webbuild                                     # noqa: E402

kaypy_page, _ = webbuild.build_page(work / "game.py", [], "Same Test",
                                    webbuild.read_size(work / "game.py"))

# ------------------------------------------------------ build it with PyIDE
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
  } catch { return { ok: false, text: async () => "", json: async () => ({}),
                     arrayBuffer: async () => new ArrayBuffer(0) }; }
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {} }) };
new Function("window","document","fetch","btoa",
  readFileSync(ROOT + "/static/export.js","utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch, globalThis.btoa);
writeFileSync(process.argv[3], await globalThis.window.PyIDEExport.buildGamePage(
  readFileSync(process.argv[2], "utf8"), "Same Test"));
""" % json.dumps(str(PYIDE))

(work / "build.mjs").write_text(build)
built = subprocess.run(
    ["node", str(work / "build.mjs"), str(work / "game.py"), str(work / "pyide.html")],
    capture_output=True, text=True)
check("PyIDE builds a page", built.returncode == 0,
      built.stderr.strip().splitlines()[-1] if built.returncode else "")
if built.returncode:
    print("\nSOME FAILED")
    sys.exit(1)
pyide_page = (work / "pyide.html").read_text()

# ------------------------------------------------------------- compare them
VALUES = ("ENGINE", "ASSETS", "PROGRAM")


def split(page):
    """The page's own lines, and the three values, apart."""
    body, values = [], {}
    for line in page.splitlines():
        for name in VALUES:
            prefix = "var %s = " % name
            if line.startswith(prefix):
                values[name] = json.loads(line[len(prefix):-1])
                break
        else:
            body.append(line)
    return "\n".join(body), values


kaypy_body, kaypy_values = split(kaypy_page)
pyide_body, pyide_values = split(pyide_page)

check("both pages declare the same three values",
      sorted(kaypy_values) == sorted(pyide_values) == sorted(VALUES),
      "%s vs %s" % (sorted(kaypy_values), sorted(pyide_values)))

# The page itself — every line that is not one of the three values. This is
# the boot sequence, the styling, the canvas, the error handling: everything
# that decides HOW the game runs rather than WHICH game it is.
if kaypy_body == pyide_body:
    check("the page around them is identical", True,
          "%d lines" % len(kaypy_body.splitlines()))
else:
    k = kaypy_body.splitlines()
    p = pyide_body.splitlines()
    first = next((i for i in range(max(len(k), len(p)))
                  if (k[i] if i < len(k) else None) != (p[i] if i < len(p) else None)), 0)
    check("the page around them is identical", False,
          "first differs at line %d" % (first + 1))
    print("        kaypy: %s" % (k[first] if first < len(k) else "<end>")[:70])
    print("        pyide: %s" % (p[first] if first < len(p) else "<end>")[:70])

# The program is the one thing that must be byte-identical to the input.
check("both carry the student's program unchanged",
      kaypy_values["PROGRAM"] == pyide_values["PROGRAM"] == GAME)

# The asset is the same file, so it must arrive as the same bytes.
check("both carry the same sprite, byte for byte",
      kaypy_values["ASSETS"] == pyide_values["ASSETS"],
      " ".join(sorted(kaypy_values["ASSETS"])))

# The engines may differ in version — PyIDE vendors a particular kaypy — but
# not in shape. A file in one and not the other means a vendor run is overdue,
# which is worth saying out loud rather than letting drift quietly.
k_files, p_files = set(kaypy_values["ENGINE"]), set(pyide_values["ENGINE"])
check("both carry the same set of engine files", k_files == p_files,
      "only in kaypy: %s | only in PyIDE: %s"
      % (sorted(k_files - p_files) or "-", sorted(p_files - k_files) or "-"))

same = [n for n in k_files & p_files
        if kaypy_values["ENGINE"][n] == pyide_values["ENGINE"][n]]
identical = len(same) == len(k_files & p_files)
check("and the same engine code" if identical
      else "the vendored engine is behind the checkout",
      True,
      "identical" if identical else
      "%d of %d files differ — run tools/vendor_kaypy.py"
      % (len(k_files & p_files) - len(same), len(k_files & p_files)))
if not identical:
    print("        (not a failure: PyIDE vendors a chosen kaypy on purpose)")

import shutil                                                   # noqa: E402
shutil.rmtree(work, ignore_errors=True)

bad = results.count(False)
print("\n%s (%d checks, %d failed)"
      % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
sys.exit(1 if bad else 0)
