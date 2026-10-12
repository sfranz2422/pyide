#!/usr/bin/env python3
"""numpy, pandas and the rest of Pyodide's packages, loaded before a Run.

    python3 tools/test_packages.py

Pyodide ships numpy and pandas, but only fetches them when asked. Each page
asks through PyIDERuntime.loadImports, and both ways that went wrong failed
quietly — a ModuleNotFoundError on a correct line, nothing else:

  * the live page never asked at all, so `import pandas` that ran in the
    editor failed in front of a class following a live lesson
  * only main.py was scanned, so an import that lived in helpers.py was never
    seen and never fetched

loadImports is run here in node against a stand-in pyodide that records what
it was handed, rather than read for the right words.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STATIC = os.path.join(ROOT, "static")

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-58s %s" % ("ok" if ok else "FAIL", label, detail))


def done():
    bad = results.count(False)
    print("\n%s (%d checks, %d failed)"
          % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
    sys.exit(1 if bad else 0)


def read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


# --------------------------------------------------- loadImports itself
probe = r"""
global.window = {};
eval(require("fs").readFileSync(process.argv[1], "utf8"));
const seen = [];
let calls = 0;
const fake = {
  loadPackagesFromImports: async function (code) {
    calls++;
    if (code.includes("BOOM")) throw new Error("scan failed");
    seen.push(code);
  }
};
(async function () {
  await window.PyIDERuntime.loadImports(fake, "import numpy", {
    "helpers.py": "import pandas",
    "broken.py": "BOOM",
    "data.csv": "import scipy",
    "notes.md": "import sympy",
    "late.py": "from __future__ import annotations\nimport matplotlib"
  });
  console.log(JSON.stringify({ seen: seen, calls: calls }));
})().catch(function (e) { console.log(JSON.stringify({ error: String(e) })); });
"""
proc = subprocess.run(["node", "-e", probe, os.path.join(STATIC, "runtime.js")],
                      capture_output=True, text=True)
try:
    got = json.loads(proc.stdout.strip().splitlines()[-1])
except (IndexError, ValueError):
    got = {"error": proc.stderr.strip()[-300:]}

check("loadImports runs without throwing", "error" not in got,
      got.get("error", ""))
seen = got.get("seen", [])
check("main.py's imports are loaded", "import numpy" in seen)
check("a helper .py file's imports are loaded", "import pandas" in seen)
check("each .py file is scanned on its own, not glued together",
      any(s.startswith("from __future__") for s in seen))
check("a file that fails to scan doesn't stop the rest",
      got.get("calls") == 4 and len(seen) == 3, repr(got))
check("data files and notes are not scanned as Python",
      not any("scipy" in s or "sympy" in s for s in seen))

# ------------------------------------------------------- every page uses it
# Each Run path must go through loadImports, with the project's files, and
# none may call loadPackagesFromImports itself — a direct call is how the
# main.py-only scan would come back.
for page, call in (("app.js", "loadImports(pyodide, source, dataFiles())"),
                   ("live.js", "loadImports(pyodide, source, dataFiles())"),
                   ("demo.js", "loadImports(pyodide, loaded.code, loaded.files)")):
    js = read(page)
    check("%s loads imports from every file" % page, call in js)
    check("  and never scans one source by itself",
          "loadPackagesFromImports(" not in js)

# On the live page the scan has to sit on the console path, before the
# program runs — after it would be too late to help.
live = read("live.js")
m = re.search(r"if \(!window\.PyIDEGame\.looksLikeGame\(source\)\) \{(.*?)return;",
              live, re.S)
body = m.group(1) if m else ""
check("live.js scans imports before running console code",
      "loadImports" in body and "_pyide_run" in body
      and body.index("loadImports") < body.index("_pyide_run"))

# requests is installed by the editor, not by Pyodide, so it has its own
# detector — which must look past main.py as well.
app = read("app.js")
m = re.search(r"function wantsRequests\(source\) \{(.*?)\n  \}", app, re.S)
check("the editor looks for `import requests` in every .py file",
      m is not None and "dataFiles()" in m.group(1)
      and ".py" in m.group(1))

done()
