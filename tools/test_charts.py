#!/usr/bin/env python3
"""matplotlib charts in the output pane, against the real Pyodide.

    python3 tools/test_charts.py

plt.show() is answered by a backend of PyIDE's own (_pyide_charts, in
runtime.js's BOOTSTRAP) that turns each figure into a PNG and hands it to the
output pane. Each way that can break shows nothing at all, which on a chart
lesson reads as "my code is wrong":

  * Pyodide's own backend winning, and drawing the chart somewhere off the
    bottom of the page instead of in the pane
  * the chart landing above text the program printed before it
  * a figure surviving to the next run, so its lines appear on the next chart
  * a program that forgot plt.show() finishing in silence
  * drawing a chart, which is slow under the loop guard's tracing, being
    counted against the time limit until three charts look like a hang

So the bootstrap runs here in node's Pyodide — the same build the browser
loads — with matplotlib and pandas fetched as a Run would fetch them, and the
pane is a stand-in that records what was appended to it, in order.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNTIME = os.path.join(ROOT, "static", "runtime.js")
PYODIDE = os.path.join(ROOT, "node_modules", "pyodide", "pyodide.mjs")

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-58s %s" % ("ok" if ok else "FAIL", label, detail))


def done():
    bad = results.count(False)
    print("\n%s (%d checks, %d failed)"
          % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
    sys.exit(1 if bad else 0)


PLOT = "import matplotlib.pyplot as plt\n"
PROGRAMS = {
    # end='' because a line ending flushes by itself: only text still sitting
    # in the buffer shows whether show() flushes before drawing.
    "inline": PLOT + "print('before', end='')\nplt.plot([1, 4, 2])\nplt.show()\n"
              "print('after', len(plt.get_fignums()))\n",
    "two": PLOT + "plt.figure()\nplt.plot([1, 2])\nplt.figure()\nplt.bar(['a', 'b'], [3, 1])\nplt.show()\n",
    "again": PLOT + "plt.plot([1, 2])\nplt.show()\nplt.plot([2, 1])\nplt.show()\n",
    "unshown": PLOT + "plt.plot([1, 2])\nprint('done')\n",
    "crash": PLOT + "plt.plot([1, 2])\nprint(1 / 0)\nplt.show()\n",
    "leftover": PLOT + "print('open', len(plt.get_fignums()))\n",
    "pandas": "import pandas as pd\nimport matplotlib.pyplot as plt\n"
              "pd.Series([3, 1, 2]).plot(kind='bar')\nplt.show()\n",
    # Three charts against a limit shorter than drawing them takes. Only the
    # drawing is the IDE's; if it counts, this is stopped as an endless loop.
    # Drawing here takes a few dozen milliseconds, far quicker than on a
    # school Chromebook, so each draw is held up half a second on purpose —
    # without that, this passed with the deadline handling deleted.
    "slow": PLOT + "import time\n"
            "for n in range(3):\n    plt.plot(list(range(50)))\n"
            "    plt.gcf().canvas.mpl_connect('draw_event', lambda e: time.sleep(0.5))\n"
            "    plt.show()\n"
            "print('finished')\n",
    "loop": "while True:\n    pass\n",
}

if not shutil.which("node"):
    check("node is available to run Pyodide", False, "brew install node")
    done()
if not os.path.exists(PYODIDE):
    check("node_modules/pyodide is here", False, "npm install")
    done()

harness = r"""
import { loadPyodide } from %(pyodide)s;
import fs from "fs";

globalThis.window = { getSelection: () => null };
globalThis.document = {
  createElement: tag => ({ tagName: tag.toUpperCase(), style: {},
                           setAttribute() {}, appendChild() {}, focus() {},
                           addEventListener() {} })
};
eval(fs.readFileSync(%(runtime)s, "utf8"));
const R = window.PyIDERuntime;

// The pane: everything appended, in order. Text arrives as {text}.
const pane = { kids: [], scrollTop: 0, scrollHeight: 0,
               appendChild(n) { this.kids.push(n); }, addEventListener() {} };
R.attachConsole({ outputEl: pane });

const py = await loadPyodide();
R.pipeOutput(py, (text, cls) => pane.kids.push({ text: text, cls: cls || "" }));
py.runPython(R.BOOTSTRAP);

const programs = %(programs)s;
const limits = { slow: %(slow_limit)s, loop: 1 };
const out = { runs: {} };
for (const name of Object.keys(programs)) {
  const src = programs[name];
  await R.loadImports(py, src, {});
  pane.kids = [];
  py.globals.set("_pyide_source", src);
  const t0 = Date.now();
  const status = await py.runPythonAsync(
    "_pyide_run(_pyide_source, " + (limits[name] || 15) + ")");
  const kids = pane.kids.map(k => k.tagName === "IMG"
    ? { img: k.src, cls: k.className, alt: k.alt, onload: !!k.onload }
    : { text: k.text, cls: k.cls });
  out.runs[name] = { status: status, ms: Date.now() - t0, kids: kids };
  if (name === "inline") {
    out.backend = py.runPython("import matplotlib; matplotlib.get_backend()");
    // the page halves the picture once it has loaded
    const img = pane.kids.find(k => k.tagName === "IMG");
    if (img) { img.naturalWidth = 1000; img.onload(); out.shownWidth = img.style.width; }
  }
}
console.log(JSON.stringify(out));
"""

# How long one chart takes to draw here, untraced, sets the "slow" limit:
# shorter than drawing three, long enough for everything else in the program.
SLOW_LIMIT = 1

proc = subprocess.run(
    ["node", "--input-type=module", "-e", harness % {
        "pyodide": json.dumps(PYODIDE), "runtime": json.dumps(RUNTIME),
        "programs": json.dumps(PROGRAMS), "slow_limit": SLOW_LIMIT}],
    capture_output=True, text=True, cwd=ROOT, timeout=600)
try:
    got = json.loads(proc.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    got = {}
check("Pyodide ran every program", len(got.get("runs", {})) == len(PROGRAMS),
      proc.stderr.strip()[-400:])
runs = got.get("runs", {})


def run(name):
    return runs.get(name, {"status": None, "kids": [], "ms": 0})


def images(name):
    return [k for k in run(name)["kids"] if "img" in k]


def text(name):
    return "".join(k.get("text", "") for k in run(name)["kids"])


def png_width(data_url):
    import base64
    raw = base64.b64decode(data_url.split(",", 1)[1][:44])
    return int.from_bytes(raw[16:20], "big") if raw[:8] == b"\x89PNG\r\n\x1a\n" else 0


print("\nplt.show() draws into the pane")
check("matplotlib uses PyIDE's backend, not Pyodide's",
      got.get("backend") == "module://_pyide_charts", repr(got.get("backend")))
inline = run("inline")
check("one chart, and the program finished", len(images("inline")) == 1
      and inline["status"] == "ok", inline["status"])
order = ["img" if "img" in k else k["text"].strip() for k in inline["kids"]
         if "img" in k or k["text"].strip()]
check("  between what was printed before and after it",
      order[:3] == ["before", "img", "after 0"], repr(order))
check("  with nothing in red around it",
      not any(k.get("cls") == "err" and k["text"].strip() for k in inline["kids"]),
      repr([k["text"][:60] for k in inline["kids"] if k.get("cls") == "err"][:1]))
img = (images("inline") or [{}])[0]
check("  as a PNG", img.get("img", "").startswith("data:image/png;base64,iVBORw0KGgo"))
check("  drawn at twice the size it is shown", png_width(img.get("img", "")) > 1000,
      "%d px" % png_width(img.get("img", "x,")))
check("  and halved once loaded", got.get("shownWidth") == "500px",
      repr(got.get("shownWidth")))
check("  styled and described", img.get("cls") == "chart" and img.get("alt"))
# Counted inside the program, straight after show(): by the end of the run
# the never-shown cleanup would have closed it anyway and hidden the fault.
check("a shown figure is closed, as in desktop Python",
      "after 0" in text("inline") and "never showed" not in text("inline"))

print("\nMore than one")
check("two figures, one show(): two charts", len(images("two")) == 2)
again = images("again")
check("show() twice: two charts, the second not drawn over the first",
      len(again) == 2 and again[0]["img"] != again[1]["img"])
check("pandas' .plot() lands the same way", len(images("pandas")) == 1
      and run("pandas")["status"] == "ok", run("pandas")["status"])

print("\nWhat a student gets wrong")
check("drawn but never shown: says to add plt.show()",
      "Add plt.show()" in text("unshown") and not images("unshown"),
      repr(text("unshown")[-80:]))
check("a run stopped before show() leaves nothing for the next one",
      run("crash")["status"] == "error" and "open 0" in text("leftover"),
      repr(text("leftover")))

print("\nThe time limit")
check("drawing three charts is not counted as an endless loop",
      run("slow")["status"] == "ok" and "finished" in text("slow"),
      "%s after %d ms" % (run("slow")["status"], run("slow")["ms"]))
check("  and the test means it: they took longer than the limit",
      run("slow")["ms"] > SLOW_LIMIT * 1000, "%d ms" % run("slow")["ms"])
check("an endless loop is still stopped", run("loop")["status"] == "timeout")

# ------------------------------------------------------------ the wiring
print("\nThe wiring")
css = open(os.path.join(ROOT, "static", "style.css")).read()
check("the pane gives a chart its own line, inside the pane",
      re.search(r"\.output img\.chart\s*\{[^}]*display:\s*block[^}]*max-width:\s*100%",
                css) is not None)
for page in ("app.js", "live.js", "demo.js"):
    src = open(os.path.join(ROOT, "static", page)).read()
    check("%s's pane can take a chart (attachConsole)" % page,
          "PyIDERuntime.attachConsole({" in src and "outputEl: outputEl" in src)

done()
