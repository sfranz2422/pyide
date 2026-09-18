"""Bring a sprite atlas into PyIDE and check the regions actually hold sprites.

    python3 tools/vendor_atlas.py --file "path/to/dungeon.png"

A sprite atlas is one image holding many sprites, each cut out by pixel
coordinates. `loadSpriteAtlas` is how Kaplay reads one, and it is the lesson
that teaches where sprites come from — the dungeon pack in `dungeon/` is the
same artwork already cut up, which is convenient but hides the idea.

The atlas goes in at `static/assets/dungeon.png`, not in a subfolder, so that
`loadSpriteAtlas("dungeon.png", ...)` — the path in Kaplay's own example and in
the course site — works exactly as written.

WHY THE COORDINATES ARE CHECKED AND NOT TRUSTED

Kaplay's published example names five regions of this atlas. Two of them are
wrong for this copy of the file: `ogre` is 16 pixels too high, so it shows the
top half of an ogre and a strip of floor, and `chest` points at empty space, so
it loads a sprite with nothing in it. Neither mistake raises an error — Kaplay
happily cuts a rectangle of nothing — and a student who typed the example
faithfully would be left staring at an invisible chest.

So every region here is checked three ways before it is written into the
manifest: inside the image, divides evenly into its frames, and contains
actual pixels. The corrected values are below, and a comment says what moved.
"""

import argparse
import json
import os
import shutil
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("This needs Pillow:  pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "static", "assets")
MANIFEST = os.path.join(ASSETS, "manifest.json")

#: The five regions Kaplay's example names, corrected against the file itself.
#: Order matters: it is the order they appear in the inserted code, and reading
#: from a plain wall up to an animated chest is the order that teaches.
REGIONS = [
    ("wall", {"x": 16, "y": 16, "width": 16, "height": 16}),
    ("floor", {"x": 16, "y": 64, "width": 48, "height": 48,
               "sliceX": 3, "sliceY": 3}),
    ("hero", {"x": 128, "y": 196, "width": 144, "height": 28, "sliceX": 9,
              "anims": {
                  "idle": {"from": 0, "to": 3, "speed": 3, "loop": True},
                  "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
                  "hit": 8,
              }}),
    # Kaplay's example says y=320, which lands on the floor tiles above the
    # ogres and cuts them in half.
    ("ogre", {"x": 16, "y": 336, "width": 256, "height": 32, "sliceX": 8,
              "anims": {
                  "idle": {"from": 0, "to": 3, "speed": 3, "loop": True},
                  "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
              }}),
    # Kaplay's example says y=304, which is empty space. The chests are at 400.
    ("chest", {"x": 304, "y": 400, "width": 48, "height": 16, "sliceX": 3,
               "anims": {
                   "open": {"from": 0, "to": 2, "speed": 20, "loop": False},
                   "close": {"from": 2, "to": 0, "speed": 20, "loop": False},
               }}),
]


def verify(image, name, r):
    """Three ways a region can be wrong, none of which Kaplay reports."""
    problems = []
    x, y, w, h = r["x"], r["y"], r["width"], r["height"]
    sx, sy = r.get("sliceX", 1), r.get("sliceY", 1)

    if x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        problems.append("runs outside the %dx%d image"
                        % (image.width, image.height))
    if w % sx or h % sy:
        problems.append("%dx%d does not divide into %dx%d frames"
                        % (w, h, sx, sy))

    if not problems:
        box = image.crop((x, y, x + w, y + h)).split()[3].getbbox()
        if box is None:
            problems.append("is entirely transparent — there is no sprite here")
        else:
            # Every frame should hold something. One empty frame in the middle
            # of a walk cycle is a stutter nobody can explain.
            fw, fh = w // sx, h // sy
            empty = [i for i in range(sx * sy)
                     if image.crop((x + (i % sx) * fw, y + (i // sx) * fh,
                                    x + (i % sx) * fw + fw,
                                    y + (i // sx) * fh + fh)
                                   ).split()[3].getbbox() is None]
            if empty:
                problems.append("frames %s are empty"
                                % ", ".join(str(i) for i in empty))

    for a, spec in (r.get("anims") or {}).items():
        last = sx * sy - 1
        ends = [spec, spec] if isinstance(spec, int) else [spec["from"], spec["to"]]
        if min(ends) < 0 or max(ends) > last:
            problems.append("%s runs to frame %d of %d" % (a, max(ends), last))

    return problems


def proof_sheet(image, regions, path, scale=3):
    """Draw every region, cut out and labelled, so a person can look at it.

    There is one kind of wrong these checks cannot catch: a region that is in
    bounds, divides evenly and has pixels in every frame — but shows the wrong
    16 pixels. That is exactly what Kaplay's published `ogre` does. It is off by
    half a sprite, so each frame holds an ogre's head and a strip of the floor
    above it. No arithmetic notices; an eye notices immediately.

    Heuristics for this are worse than useless, because the pack stacks tiles
    and chests directly against each other, so "the artwork continues past the
    edge" cries wolf on everything that is fine. So: no heuristic. A picture,
    and somebody looks at it once when the coordinates change.
    """
    cuts = []
    for name, r in regions:
        w, h = r["width"], r["height"]
        s = max(1, min(scale, 640 // w))
        cuts.append((name,
                     image.crop((r["x"], r["y"], r["x"] + w, r["y"] + h))
                          .resize((w * s, h * s), Image.NEAREST)))

    pad, label = 10, 14
    sheet = Image.new("RGBA",
                      (max(c.width for _, c in cuts) + 2 * pad,
                       sum(c.height + pad + label for _, c in cuts) + pad),
                      (18, 20, 28, 255))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for name, cut in cuts:
        r = dict(regions)[name]
        draw.text((pad, y), "%s  (%d, %d)  %dx%d"
                  % (name, r["x"], r["y"], r["width"], r["height"]),
                  fill=(150, 156, 175, 255))
        y += label
        sheet.alpha_composite(cut, (pad, y))
        y += cut.height + pad
    sheet.save(path)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True, help="the atlas image")
    ap.add_argument("--name", default="dungeon", help="what to call it")
    ap.add_argument("--proof", metavar="PNG",
                    help="write a picture of every region, cut out and "
                         "labelled, and look at it")
    args = ap.parse_args()

    if not os.path.isfile(args.file):
        sys.exit("No such file: " + args.file)

    image = Image.open(args.file).convert("RGBA")
    regions = dict(REGIONS)

    bad = False
    for name, r in REGIONS:
        problems = verify(image, name, r)
        frames = r.get("sliceX", 1) * r.get("sliceY", 1)
        if problems:
            bad = True
            print("  %-6s FAIL  %s" % (name, "; ".join(problems)))
        else:
            print("  %-6s ok    %d frame%s at (%d, %d)"
                  % (name, frames, "" if frames == 1 else "s", r["x"], r["y"]))
    if bad:
        sys.exit("\nFix the regions above before shipping the atlas.")

    out = os.path.join(ASSETS, args.name + ".png")
    # copyfile, not copy2: copy2 carries the source file's permissions across,
    # and a read-only original makes an asset the web server cannot replace.
    shutil.copyfile(args.file, out)

    with open(MANIFEST) as f:
        manifest = json.load(f)
    manifest["atlases"] = [{
        "name": args.name,
        "file": args.name + ".png",
        "w": image.width,
        "h": image.height,
        "regions": regions,
    }]
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")

    print("\n%s.png (%dx%d, %d KB) -> static/assets/, %d regions in the manifest"
          % (args.name, image.width, image.height,
             round(os.path.getsize(out) / 1024), len(regions)))

    if args.proof:
        print("proof sheet: " + proof_sheet(image, REGIONS, args.proof))


if __name__ == "__main__":
    main()
