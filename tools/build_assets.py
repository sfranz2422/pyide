"""
Rebuild the bundled asset pack.

Copies sprite and sound files into static/assets/ and writes the manifest the
editor reads to fill the sprite panel and the in-browser filesystem.

    # both at once
    python tools/build_assets.py --sprites ~/Desktop/sprites --sounds ~/Desktop/sounds

    # just the sounds — sprites already built are left alone
    python tools/build_assets.py --sounds ~/Desktop/sounds

    # just the sprites
    python tools/build_assets.py --sprites ~/Desktop/sprites

Folders can live anywhere on your computer; they do not have to be inside the
project. Whichever category you don't name is carried over from the existing
manifest, so updating sounds never disturbs the sprites.

Pygame Zero accepts png/gif/jpg/jpeg/bmp for images and wav/ogg/oga for sounds.
Anything else is reported and skipped. Names must be valid Python identifiers,
because student code reaches them as `sounds.jump.play()`.

Spritesheets listed in SHEETS are sliced into numbered frames
(dino -> dino_0 ... dino_8) so each frame works as its own Actor image.
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys

# name -> number of horizontal frames
SHEETS = {"dino": 9}

IMAGE_EXTS = (".png", ".gif", ".jpg", ".jpeg", ".bmp")
SOUND_EXTS = (".wav", ".ogg", ".oga")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(HERE, "static", "assets")
IMG_OUT = os.path.join(ASSETS, "images")
SND_OUT = os.path.join(ASSETS, "sounds")
MANIFEST = os.path.join(ASSETS, "manifest.json")

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def png_size(path):
    """Width and height of a PNG, or None for other formats."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(24)
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return struct.unpack(">II", head[16:24])
    except Exception:
        return None


def slice_sheet(src, name, frames, out_dir):
    """Split a horizontal strip into numbered frames. Needs Pillow."""
    from PIL import Image

    sheet = Image.open(src).convert("RGBA")
    fw = sheet.width // frames
    written = []
    for i in range(frames):
        frame = sheet.crop((i * fw, 0, (i + 1) * fw, sheet.height))
        frame.save(os.path.join(out_dir, "%s_%d.png" % (name, i)))
        written.append(("%s_%d" % (name, i), fw, sheet.height))
    # frame 0 also stands in for the bare name, so Actor('dino') works
    sheet.crop((0, 0, fw, sheet.height)).save(os.path.join(out_dir, name + ".png"))
    written.append((name, fw, sheet.height))
    return written


def check_name(name, kind, skipped):
    if not IDENT.match(name):
        skipped.append(
            "%-42s not a usable %s name — rename it to letters, digits and\n"
            "%s underscores only, starting with a letter (e.g. jump, coin_2)"
            % (name, kind, " " * 44)
        )
        return False
    return True


def build_images(src_dir):
    os.makedirs(IMG_OUT, exist_ok=True)
    images, skipped = [], []
    for fname in sorted(os.listdir(src_dir)):
        path = os.path.join(src_dir, fname)
        if os.path.isdir(path) or fname.startswith("."):
            continue
        name, ext = os.path.splitext(fname)
        if ext.lower() not in IMAGE_EXTS:
            skipped.append("%-42s %s is not an image Pygame Zero can load"
                           % (fname, ext or "(no extension)"))
            continue
        if not check_name(name, "image", skipped):
            continue
        if name in SHEETS:
            images.extend(slice_sheet(path, name, SHEETS[name], IMG_OUT))
            continue
        shutil.copy2(path, os.path.join(IMG_OUT, fname))
        size = png_size(path) or (0, 0)
        images.append((name, size[0], size[1]))
    images.sort()
    return [{"name": n, "w": w, "h": h} for n, w, h in images], skipped


def build_sounds(src_dir):
    os.makedirs(SND_OUT, exist_ok=True)
    sounds, skipped = [], []
    for fname in sorted(os.listdir(src_dir)):
        path = os.path.join(src_dir, fname)
        if os.path.isdir(path) or fname.startswith("."):
            continue
        name, ext = os.path.splitext(fname)
        if ext.lower() not in SOUND_EXTS:
            hint = ""
            if ext.lower() in (".mp3", ".m4a", ".aac", ".flac"):
                hint = ("\n%s convert it first:  ffmpeg -i \"%s\" \"%s.ogg\""
                        % (" " * 44, fname, name))
            skipped.append("%-42s Pygame Zero reads wav/ogg/oga, not %s%s"
                           % (fname, ext or "(no extension)", hint))
            continue
        if not check_name(name, "sound", skipped):
            continue
        shutil.copy2(path, os.path.join(SND_OUT, fname))
        sounds.append(fname)
    sounds.sort()
    return sounds, skipped


def load_manifest():
    try:
        with open(MANIFEST) as fh:
            data = json.load(fh)
        return data.get("images", []), data.get("sounds", [])
    except Exception:
        return [], []


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Rebuild the bundled sprite and sound pack.",
        epilog="Name one or both. Whichever you leave out is kept as it is.",
    )
    ap.add_argument("--sprites", metavar="FOLDER", help="folder of image files")
    ap.add_argument("--sounds", metavar="FOLDER", help="folder of wav/ogg files")
    args = ap.parse_args(argv)

    if not args.sprites and not args.sounds:
        ap.print_help()
        return 1

    for label, path in (("--sprites", args.sprites), ("--sounds", args.sounds)):
        if path and not os.path.isdir(path):
            print("%s: no folder at %s" % (label, path), file=sys.stderr)
            return 1

    images, sounds = load_manifest()
    skipped = []

    if args.sprites:
        images, s = build_images(args.sprites)
        skipped += s
    if args.sounds:
        sounds, s = build_sounds(args.sounds)
        skipped += s

    os.makedirs(ASSETS, exist_ok=True)
    with open(MANIFEST, "w") as fh:
        json.dump({"images": images, "sounds": sounds}, fh, indent=1)

    print("sprites: %d%s" % (len(images), "" if args.sprites else "  (unchanged)"))
    print("sounds:  %d%s" % (len(sounds), "" if args.sounds else "  (unchanged)"))

    if skipped:
        print("\nSkipped %d file(s):" % len(skipped))
        for line in skipped:
            print("  " + line)

    if args.sounds and not sounds:
        print("\nNo sounds were added, so the Sounds section stays hidden in the"
              "\neditor. Fix the files listed above and run this again.")

    print("\nmanifest: " + MANIFEST)
    return 0


if __name__ == "__main__":
    sys.exit(main())
