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

done()
