"""
Rebuild the bundled asset pack.

Copies sprite PNGs and sound files into static/assets/ and writes a manifest
the editor reads to populate the sprite panel and the in-browser filesystem.

Usage:
    python tools/build_assets.py path/to/sprites [path/to/sounds]

Re-run this whenever you add or remove artwork. Spritesheets listed in SHEETS
are sliced into numbered frames (dino -> dino_0 ... dino_8) so each frame can
be used as its own Actor image.
"""

import json
import os
import shutil
import struct
import sys

# name -> number of horizontal frames
SHEETS = {"dino": 9}

SOUND_EXTS = (".wav", ".ogg")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_OUT = os.path.join(HERE, "static", "assets", "images")
SND_OUT = os.path.join(HERE, "static", "assets", "sounds")
MANIFEST = os.path.join(HERE, "static", "assets", "manifest.json")


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(24)
    return struct.unpack(">II", head[16:24])


def slice_sheet(src, name, frames, out_dir):
    """Split a horizontal strip into numbered frames. Needs Pillow."""
    from PIL import Image

    sheet = Image.open(src).convert("RGBA")
    fw = sheet.width // frames
    written = []
    for i in range(frames):
        frame = sheet.crop((i * fw, 0, (i + 1) * fw, sheet.height))
        out = os.path.join(out_dir, "%s_%d.png" % (name, i))
        frame.save(out)
        written.append(("%s_%d" % (name, i), fw, sheet.height))
    # frame 0 also stands in for the bare name, so Actor('dino') works
    sheet.crop((0, 0, fw, sheet.height)).save(os.path.join(out_dir, name + ".png"))
    written.append((name, fw, sheet.height))
    return written


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    sprite_dir = sys.argv[1]
    sound_dir = sys.argv[2] if len(sys.argv) > 2 else None

    for d in (IMG_OUT, SND_OUT):
        os.makedirs(d, exist_ok=True)

    images = []
    for fname in sorted(os.listdir(sprite_dir)):
        if not fname.lower().endswith(".png"):
            continue
        name = fname[:-4]
        src = os.path.join(sprite_dir, fname)
        if name in SHEETS:
            images.extend(slice_sheet(src, name, SHEETS[name], IMG_OUT))
            continue
        shutil.copy2(src, os.path.join(IMG_OUT, fname))
        w, h = png_size(src)
        images.append((name, w, h))

    sounds = []
    if sound_dir and os.path.isdir(sound_dir):
        for fname in sorted(os.listdir(sound_dir)):
            if fname.lower().endswith(SOUND_EXTS):
                shutil.copy2(os.path.join(sound_dir, fname),
                             os.path.join(SND_OUT, fname))
                sounds.append(fname)

    images.sort()
    manifest = {
        "images": [{"name": n, "w": w, "h": h} for n, w, h in images],
        "sounds": sounds,
    }
    with open(MANIFEST, "w") as fh:
        json.dump(manifest, fh, indent=1)

    print("images: %d  sounds: %d" % (len(images), len(sounds)))
    print("manifest: " + MANIFEST)
    return 0


if __name__ == "__main__":
    sys.exit(main())
