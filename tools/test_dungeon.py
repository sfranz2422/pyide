"""Check the sprite packs the way the Sprites panel uses them.

    python3 tools/test_dungeon.py

Three things can go wrong between a folder of pictures and a student's screen,
and none of them announces itself:

  1. The manifest names a file that isn't there, so a character never appears.
  2. `sliceX` disagrees with the picture. The strip is cut on the wrong
     boundaries, so every frame is half one pose and half the next — which
     looks like an animation bug, not a data bug.
  3. An `anims` range runs past the end of the strip, and the animation plays
     into empty space.

So this reads the PNG headers directly, checks the numbers agree, and then
runs the actual line the panel inserts — for all 202 sprites, both packs, and
the atlas — on the real engine, against the real files.

WHAT CHANGED, AND WHY IT IS A BETTER TEST

This replaces tools/test_dungeon.mjs, which booted Pyodide and ran the inserts
through the JavaScript bridge against a stand-in engine that recorded its
arguments. What that could check was that the right numbers *arrived*: that
`sliceX=9` reached a function call as 9.

kaypy cuts the strip for real, so what is checked now is the result rather than
the argument. `sliceX=9` against a 9-frame strip produces nine surfaces of
equal width; against a picture that is not divisible by nine it does not, and
no amount of checking that the number arrived would have noticed. An animation
range is checked against the frames that actually exist. And the whole class of
bug in (1) can no longer be silent here, because loading a missing file raises.

The line the panel types still comes from static/sprites.js itself, run in
node, because that file is the panel's own code and copying it into this test
would mean testing a copy.
"""
import json
import os
import pathlib
import struct
import subprocess
import sys
import tempfile

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

HERE = pathlib.Path(__file__).resolve().parent
PYIDE = HERE.parent
STATIC = PYIDE / "static"
ASSETS = STATIC / "assets"

checks = [0, 0]          # total, failed


def check(ok, label):
    checks[0] += 1
    if not ok:
        checks[1] += 1
        print("  FAIL  " + label)


def png_size(path):
    """Width and height out of the IHDR chunk. No decoder needed."""
    b = path.read_bytes()
    if len(b) < 24 or b[:4] != b"\x89PNG":
        return None
    return struct.unpack(">II", b[16:24])


manifest = json.loads((ASSETS / "manifest.json").read_text())

# ------------------------------------------------------------------ the files
packs = [("images", manifest.get("images") or []),
         ("dungeon", manifest.get("dungeon") or [])]

total_bytes = 0
for folder, entries in packs:
    for e in entries:
        path = ASSETS / folder / (e["name"] + ".png")
        if not path.is_file():
            check(False, "%s/%s.png missing" % (folder, e["name"]))
            continue
        total_bytes += path.stat().st_size

        size = png_size(path)
        frames = e.get("frames") or 1
        check(size is not None, e["name"] + " is a PNG")
        if size is None:
            continue
        check(size[1] == e["h"],
              "%s: manifest says %s tall, file is %s" % (e["name"], e["h"], size[1]))
        check(size[0] == e["w"] * frames,
              "%s: %d frames of %s should be %s wide, file is %s"
              % (e["name"], frames, e["w"], e["w"] * frames, size[0]))

        for name, a in (e.get("anims") or {}).items():
            check(a["from"] >= 0 and a["to"] < frames and a["from"] <= a["to"],
                  "%s.%s: frames %s–%s outside a %d-frame strip"
                  % (e["name"], name, a["from"], a["to"], frames))
            check(a["speed"] > 0, "%s.%s: speed %s" % (e["name"], name, a["speed"]))

# One sprite per name, so a name in both packs is a trap: load both and only
# the second survives, as the wrong picture with no error. vendor_dungeon.py
# renames around it; this makes sure it did.
seen = {e["name"] for e in manifest.get("images") or []}
clash = [e["name"] for e in (manifest.get("dungeon") or []) if e["name"] in seen]
check(not clash, "names used by both packs: " + ", ".join(clash))

# The atlas is the third source of sprite names, and it lands in the same
# namespace as the other two. A region sharing a name with a pack sprite is
# the same trap: load the pack sprite, load the atlas, and the second one
# silently replaces the first — same name, different picture, different number
# of frames, so a `play("run")` that worked stops working with no error at the
# line that broke it. Lesson 12 of the guide loads this atlas by name, which is
# exactly when it would happen.
pack_names = seen | {e["name"] for e in manifest.get("dungeon") or []}
for atlas in manifest.get("atlases") or []:
    overlap = sorted(set(atlas["regions"]) & pack_names)
    check(not overlap,
          "%s names regions that are also pack sprites: %s — whichever loads "
          "second wins, silently" % (atlas["file"], ", ".join(overlap)))

# ------------------------------------------------------------------ the atlas
# An atlas region is four numbers, and all four can be wrong without anything
# saying so. Kaplay's own published example gets two of them wrong for this
# file: `ogre` is 16 pixels high and `chest` points at empty space. So the
# rectangles are checked against the picture's real size. Whether a region
# holds the RIGHT sprite is a question for eyes, and tools/vendor_atlas.py
# writes a proof sheet for that.
for atlas in manifest.get("atlases") or []:
    path = ASSETS / atlas["file"]
    if not path.is_file():
        check(False, atlas["file"] + " missing")
        continue
    total_bytes += path.stat().st_size

    size = png_size(path)
    check(size == (atlas["w"], atlas["h"]),
          "%s: manifest says %s×%s, file is %s"
          % (atlas["file"], atlas["w"], atlas["h"], size))

    for name, r in atlas["regions"].items():
        sx, sy = r.get("sliceX") or 1, r.get("sliceY") or 1
        check(r["x"] >= 0 and r["y"] >= 0
              and r["x"] + r["width"] <= atlas["w"]
              and r["y"] + r["height"] <= atlas["h"],
              "%s: (%s,%s) %s×%s runs outside the atlas"
              % (name, r["x"], r["y"], r["width"], r["height"]))
        check(r["width"] % sx == 0 and r["height"] % sy == 0,
              "%s: %s×%s does not divide into %s×%s frames"
              % (name, r["width"], r["height"], sx, sy))
        for a, spec in (r.get("anims") or {}).items():
            ends = [spec, spec] if isinstance(spec, int) else [spec["from"], spec["to"]]
            check(min(ends) >= 0 and max(ends) < sx * sy,
                  "%s.%s: frames %s outside %d" % (name, a, ends, sx * sy))

# ---------------------------------------------- the line the panel would type
# From static/sprites.js itself — the panel's own code, not a copy of it.
script = """
import { readFileSync } from "fs";
const win = {};
new Function("window", readFileSync(process.argv[2], "utf8"))(win);
const manifest = JSON.parse(readFileSync(process.argv[3], "utf8"));
const out = { sprites: [], atlases: [] };
for (const dir of ["images", "dungeon"]) {
  for (const e of manifest[dir] || []) {
    out.sprites.push({ dir, name: e.name,
                       insert: win.PyIDESprites.insertFor(e, dir) });
  }
}
for (const a of manifest.atlases || []) {
  out.atlases.push({ file: a.file, insert: win.PyIDESprites.insertAtlas(a) });
}
console.log(JSON.stringify(out));
"""
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / "inserts.mjs").write_text(script)
got = subprocess.run(["node", str(tmp / "inserts.mjs"),
                      str(STATIC / "sprites.js"), str(ASSETS / "manifest.json")],
                     capture_output=True, text=True)
if got.returncode != 0:
    print("  FAIL  could not read the panel's inserts out of sprites.js")
    print(got.stderr.strip()[-400:])
    sys.exit(1)
inserts = json.loads(got.stdout)
check(len(inserts["sprites"]) == sum(len(e) for _, e in packs),
      "the panel offers an insert for every sprite in the manifest")

# --------------------------------------------------------- run them for real
sys.path.insert(0, str(STATIC / "py"))
os.chdir(ASSETS)

import kaplay as K                                              # noqa: E402
import kaplay.engine as ke                                      # noqa: E402

def run_inserts(label, lines):
    """Run some inserts in an engine of their own, and hand back the sprites.

    An engine of their own, and not one shared with the atlas, because a name
    in both would otherwise overwrite the other here and turn one problem —
    the clash, reported above — into a second, stranger one about frame sizes
    that is really the same thing. No student's program loads all 202 sprites
    and the atlas at once anyway.
    """
    ke._engine = None
    eng = K.kaplay(width=64, height=64)
    eng._started = True       # never let atexit start a frame loop
    eng._running = False
    scope = {n: getattr(K, n) for n in dir(K) if not n.startswith("_")}
    try:
        exec(compile("\n".join(lines), "<panel inserts>", "exec"), scope)
    except Exception as exc:
        check(False, "%s: %s: %s" % (label, type(exc).__name__, str(exc)[:120]))
        return {}
    return dict(eng.assets.sprites)


loaded = run_inserts("the sprite packs",
                     [s["insert"] for s in inserts["sprites"]])
atlas_loaded = run_inserts("the atlas",
                           [a["insert"] for a in inserts["atlases"]])
check(bool(loaded) and bool(atlas_loaded),
      "every insert the panel writes runs")

# ------------------------------------- what actually came out of each picture
for s in inserts["sprites"]:
    entry = next(e for _, entries in packs for e in entries if e["name"] == s["name"])
    asset = loaded.get(s["name"])
    if asset is None:
        check(False, s["name"] + " never reached the engine")
        continue

    want_frames = entry.get("frames") or 1
    check(len(asset.frames) == want_frames,
          "%s: cut into %d frames, expected %d"
          % (s["name"], len(asset.frames), want_frames))

    # The frames were cut from the real picture, so their size is the proof
    # that sliceX agreed with it — the failure that looks like an animation
    # bug and is a data bug.
    widths = {f.get_width() for f in asset.frames}
    heights = {f.get_height() for f in asset.frames}
    check(widths == {entry["w"]} and heights == {entry["h"]},
          "%s: frames are %s×%s, manifest says %s×%s"
          % (s["name"], widths, heights, entry["w"], entry["h"]))

    want_anims = entry.get("anims") or {}
    check(set(asset.anims) == set(want_anims),
          "%s: animations %s arrived, expected %s"
          % (s["name"], sorted(asset.anims), sorted(want_anims)))
    for name, want in want_anims.items():
        a = asset.anims.get(name)
        if a is None:
            continue
        check(a["from"] == want["from"] and a["to"] == want["to"]
              and a["speed"] == want["speed"] and a["loop"] == want["loop"],
              "%s.%s: arrived as %s" % (s["name"], name, a))
        check(a["to"] < len(asset.frames),
              "%s.%s: plays to frame %s of %d that exist"
              % (s["name"], name, a["to"], len(asset.frames)))

# ------------------------------------------------- and out of the atlas
for atlas in manifest.get("atlases") or []:
    for name, want in atlas["regions"].items():
        asset = atlas_loaded.get(name)
        if asset is None:
            check(False, name + " missing from the loaded atlas")
            continue
        sx, sy = want.get("sliceX") or 1, want.get("sliceY") or 1
        check(len(asset.frames) == sx * sy,
              "%s: %d frames out of the atlas, expected %d"
              % (name, len(asset.frames), sx * sy))
        check(all(f.get_width() == want["width"] // sx
                  and f.get_height() == want["height"] // sy
                  for f in asset.frames),
              "%s: atlas frames are the wrong size" % name)
        for a, spec in (want.get("anims") or {}).items():
            check(a in asset.anims, "%s.%s missing after loading" % (name, a))

ke._engine = None

print("  %d sprites (%.0f KB), %d checks, %d failed"
      % (len(inserts["sprites"]), total_bytes / 1024, checks[0], checks[1]))
sys.exit(1 if checks[1] else 0)
