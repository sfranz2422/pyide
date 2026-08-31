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

Images can be png/gif/jpg/jpeg/bmp. Sounds must be .wav — the browser build of
SDL_mixer has no Vorbis decoder, so .ogg files load but refuse to play.
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
# Pyodide's SDL_mixer 2.8.0 is built without Vorbis: .ogg raises
# "Unrecognized audio format" at runtime. WAV is the only format that plays.
SOUND_EXTS = (".wav",)

# Every bundled asset is downloaded by each student's browser on the first game
# run, so anything past this gets called out rather than quietly shipped.
BIG_ASSET_BYTES = 1_000_000

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


def copy_into(src, dst_dir):
    """Copy, unless the source folder already is the destination."""
    dst = os.path.join(dst_dir, os.path.basename(src))
    if os.path.abspath(src) == os.path.abspath(dst):
        return  # pointed at the built folder itself; just re-index it
    shutil.copy2(src, dst)


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
        copy_into(path, IMG_OUT)
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
            if ext.lower() in (".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga"):
                hint = ("\n%s convert it first:  ffmpeg -i \"%s\" \"%s.wav\""
                        % (" " * 44, fname, name))
            skipped.append("%-42s only .wav plays in the browser, not %s%s"
                           % (fname, ext or "(no extension)", hint))
            continue
        if not check_name(name, "sound", skipped):
            continue
        copy_into(path, SND_OUT)
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
    ap.add_argument("--sounds", metavar="FOLDER", help="folder of .wav files")
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

    big = []
    for folder, names in ((IMG_OUT, [i["name"] for i in images]), (SND_OUT, sounds)):
        for n in names:
            path = os.path.join(folder, n if "." in n else n + ".png")
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size > BIG_ASSET_BYTES:
                big.append((os.path.basename(path), size))

    total = 0
    for folder in (IMG_OUT, SND_OUT):
        for n in os.listdir(folder):
            fp = os.path.join(folder, n)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    print("bundle:  %.1f MB downloaded by each browser on the first game run"
          % (total / 1_000_000))

    if big:
        print("\nLarge file(s) — every student downloads these:")
        for n, size in sorted(big, key=lambda x: -x[1]):
            print("  %-34s %6.1f MB" % (n, size / 1_000_000))
        print("  .ogg won't play in the browser, so shrink the .wav instead:")
        print("    ffmpeg -i big.wav -ar 22050 -ac 1 -sample_fmt s16 smaller.wav")

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
