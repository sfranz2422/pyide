#!/usr/bin/env python3
"""The block world in the editor: the wiring, read from the source.

    python3 tools/test_world_editor.py

The world itself is tested in node (test_world_model.py) and in Pyodide
(test_world_python.py). What's left is how the editor hands programs to it,
and each piece of that fails without a sign when it's missing:

  * the mode rule not knowing mcpi, so a world program runs as console code
    and stops with "No module named mcpi"
  * Run or Stop with no world branch, so Stop does nothing to a world program
  * Escape stopping the program when the student only meant to let go of
    the mouse
  * world.mcpi showing as a tab (a student "tidies" it away, and their world
    with it), or written into Python's files on every run
  * the rescue keeping a big world and, its one storage slot full, the
    student's code with it
  * a block that can be placed but has no look (invisible), or a look for a
    block that doesn't exist
  * the world's styles swallowed by a broken comment, which put the hotbar
    and chat at the bottom of the whole page — it happened while this was
    being built
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-70s %s" % ("ok" if ok else "FAIL", label, "" if ok else detail))


def body(source, name):
    """The text of `function name(` … up to the next top-level-ish function."""
    m = re.search(r"(?:async )?function %s\(.*?\n  \}\n" % re.escape(name), source, re.S)
    return m.group(0) if m else ""


app = (ROOT / "static" / "app.js").read_text()
template = (ROOT / "templates" / "index.html").read_text()
world_js = (ROOT / "static" / "world.js").read_text()
model_js = (ROOT / "static" / "world_model.js").read_text()
block_py = (ROOT / "static" / "py" / "mcpi" / "block.py").read_text()
css = (ROOT / "static" / "style.css").read_text()

print("which programs are world programs")
mode = re.search(r"function currentMode\(source\)\s*\{(.*?)\}", app, re.S)
mode = mode.group(1) if mode else ""
check("the mode rule knows mcpi", "looksLikeWorld" in mode, mode)
check("…after kaypy, so a game stays a game", mode.find("looksLikeGame") < mode.find("looksLikeWorld"), mode)
check("…and only in a project with a world file (a teacher's block-world assignment)",
      "looksLikeWorld(source) && hasWorld()" in mode, mode)
run_body = body(app, "run")
check("mcpi anywhere else says the block world comes with a teacher's assignment",
      'looksLikeWorld(source)' in run_body and "comes with block-world assignments" in run_body)
newfile = app[app.find('var newFileBtn = $("new-file");'):app.find("addFile(name, \"\");")]
check("a student can't make the world file by hand", "name.toLowerCase() === WORLD_FILE" in newfile)
check("…and says so on the chip", '"World"' in body(app, "paintMode"))

print("Run and Stop")
run = body(app, "run")
check("Run sends a world program to runWorld", 'mode === "world" ? runWorld(source)' in run, run[-300:])
rw = body(app, "runWorld")
check("runWorld runs it through _pyide_run_world, the source in a global",
      "_pyide_run_world(_pyide_source" in rw and 'globals.set("_pyide_source", source)' in rw)
check("…loads the mcpi package and the world first", "loadPackage(pyodide)" in rw and "showWorld()" in rw)
check("…and keeps the world as the run ends", "await saveWorld()" in rw and "endRun()" in rw)
stop = body(app, "stopRun")
world_stop = stop[stop.find('runMode === "world"'):stop.find('runMode === "game"')]
check("Stop asks a world program to stop", "requestStop()" in world_stop, world_stop[:200])
check("…and puts the toolbar back if it never answers", "setTimeout" in world_stop and "runToken += 1" in world_stop)
check("the Stop button shows for a world program", 'runMode === "world"' in body(app, "paintStop"))
esc = re.search(r'if \(e\.key === "Escape" && running[^\n]*\n', app)
check("Escape while the world holds the mouse doesn't stop the program",
      esc is not None and "holdsEscape()" in esc.group(0), esc and esc.group(0))

print("the world file")
# hidden() is the world file and the Pi's circuit.pi: the files that are no tab.
hidden_fn = re.search(r"function hidden\(name\) \{(.*?)\}", app)
hides_world = bool(hidden_fn) and "name === WORLD_FILE" in hidden_fn.group(1)
check("world.mcpi is no tab", "!hidden(n)" in body(app, "fileNames") and hides_world)
check("…never written into Python's files", "delete files[WORLD_FILE]" in body(app, "pushFilesToPython"))
check("…nor read back as a new file", "hidden(name)" in body(app, "pullFilesFromPython") and hides_world)
rescue = app[app.find("readAll: function"):app.find("writeAll: function")]
check("the rescue leaves a big world out, so the code is always kept — keeping its name, which makes it a world project",
      'all[WORLD_FILE] = ""' in rescue and "delete all[WORLD_FILE]" not in rescue)
tab = body(app, "runInNewTab")
check("the new tab gets the program even when the world won't fit", "delete files[WORLD_FILE]" in tab)
check("saving says so when the world isn't the open document", "account.noteEdit()" in body(app, "setWorldFile"))

print("the page")
scripts = re.findall(r"filename='([\w.]+\.js)'", template)
check("the editor loads world_model.js, then world.js, after game.js",
      "world_model.js" in scripts and "world.js" in scripts
      and scripts.index("game.js") < scripts.index("world_model.js") < scripts.index("world.js"), scripts)
check("…with a place for the world, a stage label and New world",
      'id="world-view"' in template and 'id="stage-label"' in template and 'id="new-world"' in template)
no_comments = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
rules = {m.group(1).strip() for m in re.finditer(r"(?:^|\})\s*([^{}]+?)\s*\{", no_comments)}
missing = [sel for sel in (".world-root", ".world-bar", ".world-chat", ".world-view", "body.is-world #canvas")
           if sel not in rules]
check("the world's styles are rules the browser reads (no comment swallowing them)", not missing, missing)

print("the new tab and a hide-my-code link (demo.js)")
demo = (ROOT / "static" / "demo.js").read_text()
demo_html = (ROOT / "templates" / "demo.html").read_text()
drun = body(demo, "run")
check("they know a world program", "looksLikeWorld(loaded.code)" in drun and "runWorld(loaded)" in drun, drun[-400:])
check("…only one with a world file, as in the editor", "hasWorldFile && window.PyIDEWorldModel.looksLikeWorld" in drun)
dw = body(demo, "runWorld")
check("…run it without showing its code (quote_source False), through a global",
      '"_pyide_run_world(_pyide_source, " + id + ", False)"' in dw and 'globals.set("_pyide_source", loaded.code)' in dw)
check("…on the project's own world", "loaded.files[WORLD_FILE]" in dw and "loadPackage(pyodide)" in dw)
check("…and never hand the world file to Python", "n !== WORLD_FILE" in dw)
dstop = body(demo, "stopRun")
check("Stop asks there too, and puts the buttons back if it's never answered",
      "requestStop()" in dstop and "runToken += 1" in dstop)
desc = re.search(r'if \(e\.key === "Escape" && running[^\n]*\n', demo)
check("…and Escape that lets go of the mouse isn't a Stop", desc is not None and "holdsEscape()" in desc.group(0))
dscripts = re.findall(r"filename='([\w.]+\.js)'", demo_html)
check("the page loads world_model.js, then world.js, and has a place for the world",
      "world_model.js" in dscripts and "world.js" in dscripts
      and dscripts.index("world_model.js") < dscripts.index("world.js") < dscripts.index("demo.js")
      and 'id="world-view"' in demo_html, dscripts)
check("…and no New world: nothing built there is kept", 'id="new-world"' not in demo_html)

print("a teacher starts one from the class page")
class_html = (ROOT / "templates" / "class_teacher.html").read_text()
check("Add to class offers a block world", '<option value="world">' in class_html)

print("every block has a look, and every look a block")
looks = world_js[world_js.find("var LOOKS = {"):world_js.find("var CLEAR")]
look_ids = {int(n) for n in re.findall(r"\b(\d+):", looks)}
blocks = model_js[model_js.find("var BLOCKS = {"):model_js.find("function kind(")]
model_ids = {int(n) for n in re.findall(r"\b(\d+): \[", blocks)} - {0}
py_ids = {int(n) for n in re.findall(r"^\w+ = Block\((\d+)\)", block_py, re.M)} - {0}
check("world.js draws every block the world knows", model_ids <= look_ids, sorted(model_ids - look_ids))
check("…and nothing the world doesn't", look_ids <= model_ids, sorted(look_ids - model_ids))
check("mcpi's block list is the world's", py_ids == model_ids,
      "only in block.py: %s; only in the world: %s" % (sorted(py_ids - model_ids), sorted(model_ids - py_ids)))

print("the help page (/help/world)")
import os                                                     # noqa: E402
import tempfile                                               # noqa: E402
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "w.db")
os.environ["SECRET_KEY"] = "k" * 32
sys.path.insert(0, str(ROOT))
import app as P                                               # noqa: E402
page = P.app.test_client().get("/help/world")
html = page.get_data(as_text=True)
names = re.findall(r"^(\w+) = Block\(", block_py, re.M)
check("it's there for anyone, signed in or not", page.status_code == 200, page.status_code)
check("…listing every block in mcpi.block, by name", all("<code>%s</code>" % n in html for n in names),
      [n for n in names if "<code>%s</code>" % n not in html])
check("…drawn by world.js, the world's own pictures",
      "filename='world.js'" not in html and "world.js" in html and "PyIDEWorld.swatch(" in html)
check("…with all sixteen wool colours", html.count('data-id="35" data-data=') == 16)
tid_ = P.SessionLocal()
_t = P.accounts.User(google_sub="tw", email="teacher-w@example.org", name="T")
tid_.add(_t); tid_.commit(); _tid = _t.id; tid_.close()
os.environ["TEACHER_EMAILS"] = "teacher-w@example.org"
_tc = P.app.test_client()
with _tc.session_transaction() as _s:
    _s["uid"] = _tid
_cls = _tc.post("/api/class", json={"name": "P1"}).get_json()["id"]
_made = _tc.post("/api/class/%d/new" % _cls, json={"title": "Castle", "kind": "world"}).get_json()
_code = _made and P.SessionLocal().query(P.accounts.Assignment).filter_by(slug=_made["slug"]).one()
check("a block world made there has the world file and a Pi starter",
      _code is not None and "world.mcpi" in _code.file_map() and "from mcpi.minecraft import Minecraft" in _code.code
      and _made["url"].endswith("/edit"), _made)
_plain = _tc.post("/api/class/%d/new" % _cls, json={"title": "Loops"}).get_json()
check("…and a plain Code one hasn't", "world.mcpi" not in P.SessionLocal().query(P.accounts.Assignment)
      .filter_by(slug=_plain["slug"]).one().file_map())
check("the editor's Docs button for it shows in World mode only",
      'id="world-docs"' in template and "url_for('help_world')" in template
      and 'worldDocs.hidden = mode !== "world"' in body(app, "paintMode"))

bad = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
sys.exit(1 if bad else 0)
