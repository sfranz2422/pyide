#!/usr/bin/env python3
"""Fetching JSON from the web, end to end and without a browser.

    python3 tools/test_requests.py

`requests` is not in Pyodide's package set, so PyIDE installs it itself from
five wheels vendored into static/py/wheels/. Everything about that can fail
quietly:

  * a wheel that is not pure-python vendors fine on a Mac and then fails for
    every student, because Pyodide can only load py3-none-any
  * the editor falling back to micropip.install("requests") would work
    perfectly for whoever tested it and put PyPI on the critical path of
    first period for everybody else
  * a syntax error in the Python embedded in runtime.js breaks the entire
    editor, not one feature — and that Python is written inside a JavaScript
    array, where nothing checks it
  * the note explaining a refused cross-origin fetch could stop appearing,
    and the student would be left with a ConnectionError that never says CORS

None of those shows up as a failing page. They show up as a lesson that does
not work, in front of a class.
"""
from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WHEELS = os.path.join(ROOT, "static", "py", "wheels")
MANIFEST = os.path.join(ROOT, "static", "py", "wheels.json")
RUNTIME = os.path.join(ROOT, "static", "runtime.js")
APPJS = os.path.join(ROOT, "static", "app.js")

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-58s %s" % ("ok" if ok else "FAIL", label, detail))


def done():
    bad = results.count(False)
    print("\n%s (%d checks, %d failed)"
          % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
    sys.exit(1 if bad else 0)


# ----------------------------------------------------------- the wheels
check("wheels.json exists", os.path.isfile(MANIFEST))
manifest = json.load(open(MANIFEST)) if os.path.isfile(MANIFEST) else {"wheels": []}
wheels = manifest.get("wheels", [])

check("  and lists the five packages requests needs", len(wheels) == 5,
      "%d listed" % len(wheels))

missing = [w["file"] for w in wheels
           if not os.path.isfile(os.path.join(WHEELS, w["file"]))]
check("every listed wheel is actually there", not missing, str(missing))

changed = []
for w in wheels:
    path = os.path.join(WHEELS, w["file"])
    if os.path.isfile(path):
        h = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if h != w["sha256"]:
            changed.append(w["file"])
check("  and unchanged since it was vendored", not changed, str(changed))

# THE ONE THAT FAILS ONLY FOR STUDENTS. pip on a Mac will hand you a macOS
# build of charset-normalizer without complaint. It vendors, it passes a
# file-exists check, and Pyodide cannot load it.
impure = [w["file"] for w in wheels if not w["file"].endswith("-none-any.whl")]
check("every wheel is pure python, which is all Pyodide can load",
      not impure, str(impure))

total = sum(w.get("bytes", 0) for w in wheels)
check("  and the whole set is small enough to serve a class",
      0 < total < 1_500_000, "%.0f KB" % (total / 1024))

# --------------------------------------------- the editor installs locally
app = open(APPJS).read()


def code_only(js):
    """The file with its comments removed.

    The comment above the installer explains why it does NOT call
    micropip.install("requests") — and names it, because that is the clearest
    way to say so. Scanning raw text for that call therefore failed on the
    comment that exists to prevent it. A guard that punishes an accurate
    comment gets deleted for being annoying rather than for being wrong.
    """
    out, i, n = [], 0, len(js)
    while i < n:
        two = js[i:i + 2]
        if two == "//":
            i = js.find("\n", i)
            if i < 0:
                break
        elif two == "/*":
            end = js.find("*/", i + 2)
            i = n if end < 0 else end + 2
        else:
            out.append(js[i])
            i += 1
    return "".join(out)


app_code = code_only(app)
check("the editor installs from this app, not from PyPI",
      "/static/py/wheels/" in app_code
      and 'micropip.install("requests")' not in app_code)
check("  and only when a program imports requests",
      "wantsRequests" in app and "REQUESTS_RE" in app)
check("  reusing one install rather than repeating it",
      "requestsReady" in app and "requestsWorking" in app)

# The regex is tested as it ships, by running it in node, rather than by
# retyping it here — a copy would be a different regex that happens to agree.
m = re.search(r"var REQUESTS_RE =\s*(/.*?/[a-z]*);", app, re.S)
check("  the detector was found in app.js", m is not None)
if m:
    probe = """
const re = %s;
const cases = {
  "import requests": "import requests\\nprint(1)",
  "from requests import get": "from requests import get",
  "indented import": "def f():\\n    import requests",
  "no import at all": "print('requests are fun')",
  "a variable named requests": "requests = 5",
  "requests in a comment": "# import requests",
  "a string mentioning it": "print('import requests')"
};
const out = {};
for (const k in cases) out[k] = re.test(cases[k]);
console.log(JSON.stringify(out));
""" % m.group(1)
    got = json.loads(subprocess.run(["node", "-e", probe],
                                    capture_output=True, text=True).stdout)
    want = {
        "import requests": True,
        "from requests import get": True,
        "indented import": True,
        "no import at all": False,
        "a variable named requests": False,
        "requests in a comment": False,
        "a string mentioning it": False,
    }
    for k, expected in want.items():
        check("  detects %r: %s" % (k, "yes" if expected else "no"),
              got.get(k) == expected, "got %s" % got.get(k))

# ------------------------------------- the Python living inside runtime.js
#
# It is written as a JavaScript array of strings and exec'd in Pyodide. A
# syntax error there does not break one feature, it breaks the editor — and
# no linter on either side looks at it. Unwrapped by node so the escaping
# checked is the escaping that ships.
extract = """
const fs = require("fs");
const src = fs.readFileSync(%r, "utf8");
const start = src.indexOf("var BOOTSTRAP = [");
const end = src.indexOf("].join(\\"\\\\n\\");", start);
process.stdout.write(eval(src.slice(start + "var BOOTSTRAP = ".length, end + 1)).join("\\n"));
""" % RUNTIME
proc = subprocess.run(["node", "-e", extract], capture_output=True, text=True)
boot = proc.stdout
check("the Python inside runtime.js could be unwrapped", len(boot) > 2000,
      "%d chars" % len(boot))
try:
    ast.parse(boot)
    ok, why = True, ""
except SyntaxError as e:                                          # noqa: BLE001
    ok, why = False, "line %s: %s" % (e.lineno, e.msg)
check("  and it is valid Python", ok, why)

# ------------------------------------------- the note about a blocked fetch
fn = None
if ok:
    tree = ast.parse(boot)
    fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef)
               and n.name == "_explain_blocked_request"), None)
check("runtime.js explains a fetch the browser refused", fn is not None)

# DEFINED IS NOT CALLED. Deleting the one line that invokes this leaves the
# function sitting there, perfectly correct and never reached — and the
# checks below, which call it directly, would all still pass. So ask the AST
# whether the traceback writer actually calls it.
called = False
if ok:
    writer = next((n for n in ast.parse(boot).body
                   if isinstance(n, ast.FunctionDef) and n.name == "_write_traceback"),
                  None)
    if writer:
        called = any(isinstance(node, ast.Call)
                     and isinstance(node.func, ast.Name)
                     and node.func.id == "_explain_blocked_request"
                     for node in ast.walk(writer))
check("  and _write_traceback actually calls it", called,
      "defined but never reached" if not called else "")

if fn:
    scope = {"sys": sys}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "runtime", "exec"), scope)
    explain = scope["_explain_blocked_request"]

    def says_something(err):
        buf, old = io.StringIO(), sys.stderr
        sys.stderr = buf
        try:
            explain(err)
        finally:
            sys.stderr = old
        return buf.getvalue()

    class ConnErr(Exception):
        pass

    refused = ConnErr("('Connection aborted.', HTTPException(\"Failed to "
                      "execute 'send' on 'XMLHttpRequest': Failed to load "
                      "'https://example.com/'.\"))")
    text = says_something(refused)
    check("  it speaks up when a fetch is refused", bool(text))
    check("  and says it is probably not the student's mistake",
          "not a mistake in your code" in text, text.strip()[:60])
    check("  it also catches a NetworkError",
          bool(says_something(ConnErr("NetworkError when attempting to fetch"))))

    # A note on every error would be noise, and would teach students to
    # ignore the one time it matters.
    check("  and stays quiet for an ordinary mistake",
          not says_something(ValueError("invalid literal for int(): 'x'")))
    check("  and for a KeyError", not says_something(KeyError("name")))

# --------------------------------------------------- the server serves them
_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _db.name
sys.path.insert(0, ROOT)
import app as A                                                   # noqa: E402

client = A.app.test_client()
r = client.get("/static/py/wheels.json")
check("the app serves wheels.json", r.status_code == 200, "%d" % r.status_code)
if wheels:
    r = client.get("/static/py/wheels/" + wheels[0]["file"])
    check("  and the wheels themselves", r.status_code == 200,
          "%s -> %d" % (wheels[0]["file"], r.status_code))
    check("  as real zip bytes, not an error page",
          r.data[:2] == b"PK", repr(r.data[:2]))
os.unlink(_db.name)

done()
