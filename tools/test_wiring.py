#!/usr/bin/env python3
"""The editor's own wiring: ids, scripts and class names, both sides.

    python3 tools/test_wiring.py

WHY THIS FILE EXISTS

It was written the day the Game/Console chip stopped being a button and the
`+ Game` starter was removed. Taking a control out of an editor touches the
template, a script, the stylesheet and sometimes a route, and the ways of
getting it wrong are all silent:

  * a `$("new-game")` left behind reaches for an element that no longer
    exists. `addEventListener` is never called and the control is simply
    dead. Nothing errors, and the page looks perfect.
  * a class the JavaScript applies that the stylesheet never styles. The
    element renders, unstyled, looking like a bug in the layout.
  * a script the page loads that is not in the repo: a 404, a page that
    renders fine, and half the editor missing.

That first one actually happened while removing `+ Game` — the link went and
its confirm handler stayed. Nothing in PyIDE would have told anybody.
"""
from __future__ import annotations

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-56s %s" % ("ok" if ok else "FAIL", label, detail))


def done():
    bad = results.count(False)
    print("\n%s (%d checks, %d failed)"
          % ("SOME FAILED" if bad else "ALL PASSED", len(results), bad))
    sys.exit(1 if bad else 0)


# The TEMPLATE is read rather than a rendered page, because half these
# elements only appear for a teacher or a signed-in student, and rendering
# anonymously would report them all missing.
template = (ROOT / "templates" / "index.html").read_text()
ids = set(re.findall(r'id="([^"]+)"', template))
check("the template was read", len(ids) > 25, "%d ids" % len(ids))

SCRIPTS = ["app.js", "account.js", "notes.js", "sprites.js", "game.js",
           "runtime.js", "complete.js"]
present = [n for n in SCRIPTS if (ROOT / "static" / n).is_file()]
check("  and the editor's scripts are there", len(present) >= 5, str(present))

# ------------------------------------------------------------ the dead button
dangling = []
for name in present:
    text = (ROOT / "static" / name).read_text()
    for wanted in sorted(set(re.findall(r'\$\(\s*"([^"]+)"\s*\)', text))):
        if wanted not in ids:
            dangling.append("%s wants #%s" % (name, wanted))
check("every element the JavaScript reaches for exists",
      not dangling, "; ".join(dangling[:3]))

# ------------------------------------------------------------- the 404 script
for src in re.findall(r"filename='([^']+)'", template):
    if src.endswith((".js", ".css")):
        check("  static/%s exists" % src, (ROOT / "static" / src).is_file())

# ------------------------------------------------------- the unstyled class
#
# Collect the whole right-hand side of a className assignment and then every
# literal in it: the class is often built by concatenation, so matching only
# the first string after `className =` misses the interesting half.
css = (ROOT / "static" / "style.css").read_text()
styled = set(re.findall(r"\.([A-Za-z][\w-]*)", css))

applied = set()
for name in present:
    text = (ROOT / "static" / name).read_text()
    for rhs in re.findall(r'className\s*=\s*([^;]+);', text):
        for lit in re.findall(r'"([^"]*)"', rhs):
            applied |= set(lit.split())
    for one in re.findall(r'classList\.(?:add|toggle|remove)\(\s*"([^"]+)"', text):
        applied.add(one)

# A literal ending in "-" is a prefix waiting for a variable, as in
# `"mode mode-" + mode`. It is never a class name on its own — no CSS class
# ends in a hyphen — so it is dropped rather than reported.
#
# The limit that follows is real and worth knowing: the classes that prefix
# actually builds (mode-console, mode-game) are invisible to this check,
# because they only exist at runtime. This catches whole class names, which
# is most of them, not every possible one.
applied = {c for c in applied if not c.endswith("-")}

unstyled = sorted(c for c in applied if c and c not in styled)
check("every class the editor applies has a CSS rule", not unstyled, str(unstyled))
check("  (and it applies some)", len(applied) >= 8, "%d classes" % len(applied))

# --------------------------------------------------- the mode is not a control
#
# The chip reports what the code is; it does not set it. If it goes back to
# being a button, a student can pin the wrong mode, press Run, get nothing,
# and have no way to see why — the state lives in a chip they stopped
# reading. That is the bug this replaced, so it is worth a guard.
chip = re.search(r"<(\w+)[^>]*id=\"mode\"", template)
check("the mode chip exists", chip is not None)
if chip:
    check("  and is not a button", chip.group(1) != "button", chip.group(1))

app_js = (ROOT / "static" / "app.js").read_text()
check("nothing can override the detected mode",
      "modeOverride" not in app_js)
check("  and the chip has no click handler",
      not re.search(r'modeTag\.addEventListener\(\s*"click"', app_js))
check_mode_source = re.search(r"function currentMode\(source\)\s*\{(.*?)\}", app_js, re.S)
check("  the mode comes from the source, and only from it",
      check_mode_source is not None
      and "looksLikeGame" in check_mode_source.group(1)
      and "return" in check_mode_source.group(1))

# ------------------------------------------- publish edits what it published
#
# Publish used to POST a new assignment every single press, so a teacher
# revising a task ended up with three links and no way to tell which one the
# class was holding. Nothing errored — it did exactly what it was told, three
# times. Wanting a second, separate assignment has a better path: share the
# project to yourself and publish the copy, which arrives named "Copy of ...".
account = (ROOT / "static" / "account.js").read_text()

check("publishing twice updates rather than duplicating",
      "if (cfg.editingAssignment)" in account
      and "updateAssignment(btn, read, say)" in account)
check("  and the button says so afterwards",
      'btn.textContent = "Update assignment"' in account)
check("  remembering what it just published",
      "cfg.editingAssignment = out.data.slug" in account)

# One update path, not two copies of the message that explains who a change
# reaches — the Update button and Publish-after-publishing share it.
check("  with one shared update function",
      account.count("function updateAssignment(") == 1
      and account.count("/api/assignment/\" + encodeURIComponent") == 1)

# ------------------------------------------- the game download carries source
#
# The .html is playable and NOT editable: the program is inside it, but so is
# the whole engine, base64'd. A student left with only the page has a game
# they can play and can never change again.
editor = (ROOT / "static" / "app.js").read_text()

# Only the GAME branch. The console download builds its zip with the very
# same `{ name: MAIN, data: source }` line, so a check against the whole file
# stays true while the game path is gutted — which is exactly what happened
# the first time this was written, and it passed.
start = editor.find('if (currentMode(source) === "game") {')
end = editor.find("\n      return;\n    }", start)
game_branch = editor[start:end] if start >= 0 and end > start else ""
check("the game branch of onDownload was found", len(game_branch) > 200,
      "%d chars" % len(game_branch))

check("a game downloads as a zip, not a bare page",
      'PyIDEZip.download(base + ".zip", gameEntries)' in game_branch)
check("  containing the playable page",
      'name: base + ".html", data: html' in game_branch)
check("  and the source beside it",
      "name: MAIN, data: source" in game_branch)
check("  and any other files the project has",
      "var alsoFiles = dataFiles();" in game_branch)

# ------------------------------------------------- the starter is really gone
server = (ROOT / "app.py").read_text()
check("no game starter survives on the server",
      "GAME_CODE" not in server and "def new_game" not in server)
check("  and nothing links to a /game route",
      "new_game" not in template and "new-game" not in template)

# ------------------------------------------------- find and replace is wired
#
# Ctrl-F / Cmd-F comes from CodeMirror's own addons, which means the whole
# feature is four files in the template and nothing else. Three ways that
# goes wrong, none of which raises:
#
#   * search.js without searchcursor.js — search.js USES it and does not
#     fetch it, so Ctrl-F throws inside CodeMirror and the key does nothing.
#   * search.js without dialog.js — same, for the prompt.
#   * everything but dialog.min.css — and this is the nasty one. The feature
#     WORKS. Find, next, replace, all of it. The bar asking for the search
#     term is just an unstyled input floating over the code, so it ships.
template_text = (ROOT / "templates" / "index.html").read_text()
for addon in ("addon/dialog/dialog.min.js",
              "addon/search/searchcursor.min.js",
              "addon/search/search.min.js",
              "addon/dialog/dialog.min.css"):
    check("the editor loads %s" % addon.split("/")[-1],
          addon in template_text)

# Order matters: search.js reads CodeMirror.fromTextArea's searchcursor at
# call time, but registers against the API that searchcursor installs.
check("  and searchcursor is loaded before search",
      template_text.find("searchcursor.min.js") <
      template_text.find("addon/search/search.min.js"))

# The bar CodeMirror builds is about 130px wide for the search term, which
# is four or five characters of it. Sized here rather than left alone.
style_text = (ROOT / "static" / "style.css").read_text()
EDITOR_SCRIPT = "app.js"
# THE ADDONS MUST LOAD BEFORE THE EDITOR IS BUILT.
#
# search.js calls CodeMirror.defineOption("search", {bottom: false}), and a
# default set by defineOption only reaches editors made AFTER it runs. An
# editor built first has options.search undefined, and search.js then reads
# `cm.options.search.bottom` with no guard:
#
#     TypeError: Cannot read properties of undefined (reading 'bottom')
#
# Found by loading the addons into the deployed editor by hand, where the
# editor already existed: Ctrl-F threw that, which names neither the addon
# nor the option nor anything a person would search for. In the page the
# order is right; this is here so it stays right.
check("  and the addons load before %s builds the editor" % EDITOR_SCRIPT,
      template_text.find("addon/search/search.min.js")
      < template_text.find(EDITOR_SCRIPT),
      "search.js at %d, %s at %d"
      % (template_text.find("addon/search/search.min.js"), EDITOR_SCRIPT,
         template_text.find(EDITOR_SCRIPT)))

check("  and the search bar is given a usable width",
      ".CodeMirror-dialog input" in style_text)


# ------------------------------------------------- every page that runs a game
# A kaypy game runs in two steps: _pyide_run_game sets it up, and awaiting
# _pyide_drive_game is the frame loop. The demo page did only the first —
# written for Kaplay, where JavaScript owned the loop — so a demo link drew one
# frame and then nothing moved, which read as "the keys do nothing". And its
# ensureReady was not given the program, so the sprites it named never came.
print("\nEvery page that runs a game")
for name in ("app.js", "live.js", "demo.js"):
    src = (ROOT / "static" / name).read_text()
    if "_pyide_run_game(" not in src:
        continue
    check("%s drives the frame loop, not only the setup" % name,
          "await _pyide_drive_game()" in src)
    calls = re.findall(r"ensureReady\(pyodide,[\s\S]*?\}(\s*,\s*[\w.]+)?\s*\)", src)
    check("  and hands ensureReady the program, for its sprites",
          bool(calls) and all(c.strip() for c in calls), "%d call(s)" % len(calls))

# --------------------------------------------------------- a game in a new tab
print("\nA game in a new tab")
index_html = (ROOT / "templates" / "index.html").read_text()
demo_html = (ROOT / "templates" / "demo.html").read_text()
app_js = (ROOT / "static" / "app.js").read_text()
demo_js = (ROOT / "static" / "demo.js").read_text()
app_py = (ROOT / "app.py").read_text()
check("the editor has the New tab button", 'id="run-tab"' in index_html)
check("  shown only in game mode",
      "runTabBtn.hidden = !isGame" in app_js and 'id="run-tab" class="btn" type="button" hidden' in index_html)
check("  which opens /play in one named tab",
      'window.open("/play", "pyide-play")' in app_js)
_key = re.search(r'var PLAY_KEY = "([^"]+)"', app_js)
check("  and hands over the project under the key /play reads",
      _key is not None and 'localStorage.getItem("%s")' % _key.group(1) in demo_js,
      _key.group(1) if _key else "no PLAY_KEY")
check("/play is the demo page's player, with nothing on the server",
      re.search(r'@app\.get\("/play"\)\s*def play\(\):[\s\S]{0,600}?render_template\("demo\.html",[^)]*play=True\)',
                app_py) is not None)
check("  and the page knows it is playing",
      "{% if play %}" in demo_html and "play: true" in demo_html)
check("  and starts the game itself once Python is ready",
      re.search(r'runLabel\.textContent = "Run";\s*//[^\n]*\n\s*if \(PLAYING\) run\(\);', demo_js) is not None)
check("  reading the handover afresh each Run, never the cached demo",
      re.search(r"async function loadProject\(\) \{\s*if \(PLAYING\) return handedOver\(\);", demo_js)
      is not None)

# ------------------------------------------- the game fills a demo or /play
# The editor's game-mode cap (the canvas at 40vh, the output sharing the rest)
# reached the demo page too, so /play and every demo link gave the game the
# top half of the tab and an empty output the bottom half.
print("\nThe game fills the demo page")
style_now = (ROOT / "static" / "style.css").read_text()
def _rule(sel):
    m = re.search(r"(?m)^%s\s*\{([^}]*)\}" % re.escape(sel), style_now)
    return m.group(1) if m else ""
check("on a demo page the editor's height cap is lifted",
      "max-height: none" in _rule("body.is-demo.is-game .pane-right #canvas"))
check("  the stage takes the column and the output is a strip",
      re.search(r"flex:\s*1 1 0", _rule("body.is-demo.is-game .stage")) is not None
      and re.search(r"flex:\s*0 0 \d+px", _rule("body.is-demo.is-game .pane-right #output-view")) is not None)
check("there is a Full screen button, for games only",
      'id="fullscreen" class="btn" type="button" hidden' in demo_html
      and "fullBtn.hidden = !isGame" in demo_js)
check("  and it puts the stage, not the page, full screen",
      "stage.requestFullscreen()" in demo_js)
check("the canvas is refitted on resize, full screen, and a new game size",
      'window.addEventListener("resize", fitCanvas)' in demo_js
      and re.search(r'addEventListener\("fullscreenchange", function \(\) \{\s*fitCanvas\(\);', demo_js)
      and 'attributeFilter: ["width", "height"]' in demo_js
      and re.search(r"stage\.hidden = false;\s*fitCanvas\(\);", demo_js) is not None)

import shutil, subprocess, json                               # noqa: E402
_fit = re.search(r"  function fitCanvas\(\) \{[\s\S]*?\n  \}\n", demo_js)
if shutil.which("node") and _fit:
    harness = """
var stage = {hidden: false}, document = {body: {classList: {contains: function () { return true; }}}};
function getComputedStyle() { return {paddingLeft: "10", paddingRight: "10", paddingTop: "10", paddingBottom: "10"}; }
var out = [];
[[1020, 520, 600, 400], [620, 1020, 600, 400], [1940, 1100, 800, 600]].forEach(function (c) {
  var canvas = {width: c[2], height: c[3], style: {}, parentNode: {clientWidth: c[0], clientHeight: c[1]}};
  this.canvas = canvas;
  (function () { %s; fitCanvas(); }).call(this);
  out.push([canvas.style.width, canvas.style.height]);
});
console.log(JSON.stringify(out));
""".replace("this.canvas = canvas;", "").replace("(function () { %s; fitCanvas(); }).call(this);", "%s; fitCanvas();")
    res = subprocess.run(["node", "-e", harness % _fit.group(0)], capture_output=True, text=True)
    got = json.loads(res.stdout) if res.returncode == 0 else res.stderr[-300:]
    check("fitCanvas fills a wide space by height, keeping the game's shape",
          isinstance(got, list) and got[0] == ["750px", "500px"], got)
    check("  a tall space by width", isinstance(got, list) and got[1] == ["600px", "400px"], got)
    check("  and scales UP on a big screen, not only down",
          isinstance(got, list) and got[2] == ["1440px", "1080px"], got)
else:
    check("node is available to run fitCanvas", bool(_fit) and False,
          "brew install node" if _fit else "fitCanvas moved")

# Both pages rendered for real: a url_for with no slug is a 500, not a typo.
import os, tempfile                                           # noqa: E402
os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "w.db"))
os.environ.setdefault("SECRET_KEY", "k" * 32)
sys.path.insert(0, str(ROOT))
import app as _P                                              # noqa: E402
_c = _P.app.test_client()
_r = _c.get("/play")
check("/play renders", _r.status_code == 200 and b"play: true" in _r.data, _r.status_code)

# Every page in the app's own style follows the editor's light/dark choice.
# The teacher pages once did not, and a teacher in light mode in the editor
# got every assignment page in dark.
import glob as _glob
_tpl_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")
_missing = [os.path.basename(t) for t in sorted(_glob.glob(os.path.join(_tpl_dir, "*.html")))
            if "filename='style.css'" in open(t).read()
            and 'localStorage.getItem("pyide-theme")' not in open(t).read()]
check("every page with the app's stylesheet follows the editor's theme",
      not _missing, ", ".join(_missing))

done()
