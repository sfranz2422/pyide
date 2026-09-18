"""Bring 0x72's DungeonTileset II into PyIDE as usable sprites.

    python3 tools/vendor_dungeon.py --frames "path/to/0x72_DungeonTilesetII_v1.7/frames"

The pack ships 370 separate PNGs: every animation is a run of files ending
`_f0`, `_f1`, `_f2`, `_f3`. Putting 370 tiles in the Sprites panel would bury
the 60 that were already there, and a student clicking "elf_m_run_anim_f2"
gets one frame of a walk cycle, which is not a thing anyone wants.

So this groups them the way a person thinks about them:

  * A CHARACTER is one sprite. `elf_m_idle_anim_f0..3` and `elf_m_run_anim_f0..3`
    become a single `elf_m.png` strip eight frames wide, with an `idle`
    animation over frames 0-3 and a `run` animation over 4-7. Some characters
    also have a one-frame `hit`.
  * A SINGLE ANIMATION — a coin, a flame, a chest opening — becomes one strip
    with one animation.
  * A STILL — a wall, a crate, a flask — is copied across as it is.

370 files become 142, and the panel lists 142 things a student would actually
reach for.

WHY STRIPS RATHER THAN LISTS OF FILES

Kaplay can load an animation from a list of paths, and the bridge makes that
work. But the line a student would have to read is eight quoted paths long:

    loadSprite("elf_m", ["dungeon/elf_m_idle_anim_f0.png", ... x8 ], anims={...})

A strip collapses that to the form Kaplay's own documentation uses, and the
one the Sprite Atlas lesson teaches:

    loadSprite("elf_m", "dungeon/elf_m.png", sliceX=8, anims={...})

It is also fewer files to serve, and an exported game inlines one image per
character instead of eight.

LICENCE

DungeonTileset II by 0x72 (Robert) is CC0 1.0 Universal — public domain.
Attribution is not required; the author asks only to be shown what people
build. We credit anyway, in static/assets/CREDITS.md.
"""

import argparse
import json
import os
import re
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This needs Pillow:  pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "static", "assets")
OUT = os.path.join(ASSETS, "dungeon")
MANIFEST = os.path.join(ASSETS, "manifest.json")

FRAME = re.compile(r"^(.*)_f(\d+)$")
#: a group base like "elf_m_run_anim" splits into the character and what it does
ACTION = re.compile(r"^(.*?)_(idle|run|hit)(?:_anim)?$")

#: frames per second, by what the animation is. Idle should breathe; a run
#: should look like running; a hit is usually a single frame and never loops.
SPEED = {"idle": 8, "run": 10, "hit": 1, "open": 12}
ORDER = {"idle": 0, "run": 1, "hit": 2}


def collect(frames_dir):
    """Split the pack into animation groups and stills."""
    names = sorted(n[:-4] for n in os.listdir(frames_dir) if n.endswith(".png"))
    groups, stills = {}, []
    for name in names:
        m = FRAME.match(name)
        if m:
            groups.setdefault(m.group(1), []).append((int(m.group(2)), name))
        else:
            stills.append(name)
    for base in groups:
        groups[base].sort()
    return groups, stills


def assemble(groups):
    """Gather animation groups into one entry per character or object."""
    subjects = {}
    for base, frames in groups.items():
        m = ACTION.match(base)
        if m:
            subject, action = m.group(1), m.group(2)
        else:
            subject = base[:-5] if base.endswith("_anim") else base
            # a chest's frames are it opening, and an opening chest should not
            # loop forever; everything else with one animation reads as idle
            action = "open" if "open" in subject else "idle"
        subjects.setdefault(subject, {})[action] = frames
    return subjects


def build_strip(frames_dir, out_path, frames):
    """Lay frames out left to right in one image."""
    images = [Image.open(os.path.join(frames_dir, n + ".png")).convert("RGBA")
              for _, n in frames]
    w, h = images[0].size
    strip = Image.new("RGBA", (w * len(images), h), (0, 0, 0, 0))
    for i, im in enumerate(images):
        strip.paste(im, (i * w, 0))
    strip.save(out_path)
    return w, h


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", required=True,
                    help="the pack's frames/ directory")
    args = ap.parse_args()

    if not os.path.isdir(args.frames):
        sys.exit("No such directory: " + args.frames)

    groups, stills = collect(args.frames)
    subjects = assemble(groups)

    with open(MANIFEST) as f:
        manifest = json.load(f)

    # Two names exist in both packs: `coin` and `bomb`. Kaplay keeps one sprite
    # per name, so a student who reached for the Kaplay coin and the dungeon
    # coin in the same game would silently get whichever loaded second, and
    # would see a sprite that is simply the wrong picture with no error to
    # explain it. Renaming here, once, is cheaper than a lesson about it.
    taken = {e["name"] for e in manifest.get("images", [])}

    def unique(name):
        return "dungeon_" + name if name in taken else name

    os.makedirs(OUT, exist_ok=True)
    entries = []

    # ---- animated: one strip per subject, animations laid end to end -------
    for subject in sorted(subjects):
        actions = subjects[subject]
        ordered = sorted(actions, key=lambda a: (ORDER.get(a, 9), a))

        sequence, anims, at = [], {}, 0
        for action in ordered:
            frames = actions[action]
            anims[action] = {
                "from": at,
                "to": at + len(frames) - 1,
                "speed": SPEED.get(action, 8),
                # a chest opens once; a hit is a single frame and is over
                "loop": action not in ("open", "hit"),
            }
            sequence.extend(frames)
            at += len(frames)

        name = unique(subject)
        w, h = build_strip(args.frames, os.path.join(OUT, name + ".png"),
                           sequence)
        entries.append({
            "name": name,
            "w": w, "h": h,
            "frames": len(sequence),
            "anims": anims,
        })

    # ---- stills: copied straight across -----------------------------------
    for still in stills:
        src = os.path.join(args.frames, still + ".png")
        name = unique(still)
        shutil.copy2(src, os.path.join(OUT, name + ".png"))
        w, h = Image.open(src).size
        entries.append({"name": name, "w": w, "h": h})

    entries.sort(key=lambda e: e["name"])

    manifest["dungeon"] = entries
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")

    animated = sum(1 for e in entries if "anims" in e)
    print("%d source frames -> %d sprites" %
          (sum(len(v) for v in groups.values()) + len(stills), len(entries)))
    print("   %d animated (%d animations in total)"
          % (animated, sum(len(e["anims"]) for e in entries if "anims" in e)))
    print("   %d stills" % (len(entries) - animated))
    print("   written to static/assets/dungeon/ and listed in manifest.json")


if __name__ == "__main__":
    main()
