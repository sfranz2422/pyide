#!/usr/bin/env python3
"""The block world in a real Chrome (tools/world_browser.mjs).

    python3 tools/test_world_browser.py

The world is WebGL, pointer lock, keys on its own canvas, and a Python
program taking turns with the page through WebAssembly stack switching. Node
has none of those, so the other world tests can't see the parts where they
meet. Here the app runs, and Chrome (headless, WebGL drawn in software):

  * plays a world program in the new tab (/play), by itself — the blocks it
    sets are there, the world is drawn, the page keeps drawing while the
    program loops, W walks the player, and Stop ends the program within two
    seconds, reaching it as a KeyboardInterrupt
  * plays one from a hide-my-code link, without showing the code
  * runs one on a student's assignment, and the draft saved with its world
    in it — and the same run again saves nothing, because nothing changed

Needs Chrome and node; says "skip" without Chrome rather than failing.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)

TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "world.db")
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402
import accounts                                              # noqa: E402

results = []


def check(label, condition, detail=""):
    results.append(bool(condition))
    print("  %-4s %-66s %s" % ("ok" if condition else "FAIL", label, detail))


def add_user(sub, email, name):
    db = P.SessionLocal()
    try:
        user = accounts.User(google_sub=sub, email=email, name=name)
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def client(uid=None):
    c = P.app.test_client()
    if uid is not None:
        with c.session_transaction() as s:
            s["uid"] = uid
    return c


def find_chrome():
    for path in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                 "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    return None


# Builds a diamond tower, then waits for hits until Stop, and tidies up.
PROGRAM = """from mcpi.minecraft import Minecraft
from mcpi import block
import time
mc = Minecraft.create()
mc.setBlocks(20, 10, 20, 20, 14, 20, block.DIAMOND_BLOCK.id)
print("tower up")
try:
    while True:
        mc.events.pollBlockHits()
        time.sleep(0.1)
except KeyboardInterrupt:
    print("tidied up")
"""
# Builds and ends: a student's assignment.
BUILD = """from mcpi.minecraft import Minecraft
mc = Minecraft.create()
mc.setBlocks(-10, 20, -10, -6, 24, -6, 41)
print("gold built")
"""

print("In a real browser")
chrome = find_chrome()
if chrome is None or shutil.which("node") is None:
    print("  skip  no Chrome (or no node) here — the world in a browser is not checked")
else:
    import logging
    from werkzeug.serving import make_server

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    tid = add_user("t", "teacher@example.org", "Teach")
    sid = add_user("s", "kid@example.org", "Kid")
    teacher = client(tid)
    cls = teacher.post("/api/class", json={"name": "P4"}).get_json()["id"]
    db = P.SessionLocal()
    db.add(accounts.Enrollment(class_id=cls, email="kid@example.org", name="Kid"))
    db.commit()
    db.close()
    slug = teacher.post("/api/class/%d/new" % cls, json={"title": "Gold"}).get_json()["slug"]
    teacher.post("/api/assignment/%s" % slug, json={"code": BUILD, "title": "Gold"})
    demo = client().post("/api/share", json={"code": PROGRAM, "author": "Kid", "hidden": True,
                                             "title": "Tower"}).get_json()["url"]

    server = make_server("127.0.0.1", 0, P.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    setup = os.path.join(TMP, "setup.json")
    with open(setup, "w") as f:
        json.dump({"program": PROGRAM, "demo": demo[demo.index("/", 8):],
                   "assignment": "/a/" + slug,
                   "studentCookie": P.app.session_interface.get_signing_serializer(P.app).dumps({"uid": sid})}, f)
    out = subprocess.run(["node", os.path.join(HERE, "world_browser.mjs"), base, setup, chrome,
                          os.path.join(TMP, "chrome")],
                         cwd=PYIDE, capture_output=True, text=True, timeout=600)
    lines = [ln for ln in out.stdout.splitlines() if ln[:5] in ("ok   ", "FAIL ")]
    for ln in lines:
        label, _, detail = ln[5:].partition("\t")
        check(label, ln.startswith("ok"), "" if ln.startswith("ok") else detail[:200])
    check("the browser run reported every check", len(lines) == 12, (len(lines), out.stderr.strip()[-300:]))

    # What the student's run left in their draft.
    db = P.SessionLocal()
    try:
        draft = db.query(accounts.Draft).filter_by(owner_id=sid).first()
        files = json.loads(draft.files or "{}") if draft else {}
    finally:
        db.close()
    world = json.loads(files.get("world.mcpi") or "null")
    check("the draft keeps the world the program built, as world.mcpi",
          world is not None and world.get("blocks") == 125, world and {k: world[k] for k in ("seed", "blocks")})
    server.shutdown()

failed = results.count(False)
print("\n%d checks, %s" % (len(results), "%d FAILED" % failed if failed else "all ok"))
sys.exit(1 if failed else 0)
