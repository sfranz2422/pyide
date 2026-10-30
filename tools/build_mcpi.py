#!/usr/bin/env python3
"""Bundles PyIDE's mcpi package (static/py/mcpi/) for the browser.

    python3 tools/build_mcpi.py

Writes static/py/mcpi_bundle.json — {path inside the package: its text}, the
same shape as kaypy's bundle — which world.js writes into Pyodide's files
(/lib/mcpi) before a world program runs: one fetch rather than one per file.

Also writes static/py/mcpi_sigs.json, the editor's hints for what goes in
an mcpi call's brackets (sighint.js), from SIGS below. Written by hand, in
the words of the Pi's lessons, rather than read from the code: most of the
API is *args underneath, and "setBlock(*args)" tells a student nothing.
test_sighint.py holds every name here to the package, so a hint can never
offer a call that doesn't exist.

Run it after changing anything in static/py/mcpi/. The bundle is what the
browser and the tests load, not the .py files, so a change that isn't
bundled doesn't exist there — tools/test_world_python.py fails when the two
differ.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACKAGE = os.path.join(ROOT, "static", "py", "mcpi")
BUNDLE = os.path.join(ROOT, "static", "py", "mcpi_bundle.json")
SIGS_OUT = os.path.join(ROOT, "static", "py", "mcpi_sigs.json")

XYZ = ["x", "y", "z"]
SIGS = {
    "functions": {
        "Minecraft.create": {"doc": "Connects to the world: mc = Minecraft.create()", "forms": [[]]},
        "Vec3": {"doc": "A place in the world, or a direction", "forms": [XYZ]},
        "Block": {"doc": "A block id, and its data", "forms": [["id"], ["id", "data"]]},
    },
    "methods": {
        "getBlock": {"doc": "The id of the block there", "forms": [XYZ]},
        "getBlockWithData": {"doc": "The block there, with its data", "forms": [XYZ]},
        "setBlock": {"doc": "", "forms": [XYZ + ["id"], XYZ + ["id", "data"]]},
        "setBlocks": {"doc": "Fills the box between two corners",
                      "forms": [["x1", "y1", "z1", "x2", "y2", "z2", "id"],
                                ["x1", "y1", "z1", "x2", "y2", "z2", "id", "data"]]},
        "getHeight": {"doc": "The y of the highest block that isn't air", "forms": [["x", "z"]]},
        "getPlayerEntityIds": {"doc": "", "forms": [[]]},
        "saveCheckpoint": {"doc": "Remembers the world as it is now", "forms": [[]]},
        "restoreCheckpoint": {"doc": "Puts the world back as it was at saveCheckpoint()", "forms": [[]]},
        "postToChat": {"doc": "", "forms": [["message"]]},
        "setting": {"doc": "", "forms": [["name", "on"]]},
        "getPos": {"doc": "Where the player is, in fractions of a block", "forms": [[]]},
        "setPos": {"doc": "", "forms": [XYZ]},
        "getTilePos": {"doc": "The block the player is standing in", "forms": [[]]},
        "setTilePos": {"doc": "", "forms": [XYZ]},
        "getDirection": {"doc": "Which way the player is looking", "forms": [[]]},
        "getRotation": {"doc": "Which way the player faces, in degrees", "forms": [[]]},
        "getPitch": {"doc": "How far up or down the player looks, in degrees", "forms": [[]]},
        "setNormal": {"doc": "The camera back in the player's eyes", "forms": [[]]},
        "setFollow": {"doc": "The camera behind the player", "forms": [[]]},
        "setFixed": {"doc": "The camera stays where camera.setPos put it", "forms": [[]]},
        "pollBlockHits": {"doc": "Blocks hit with the sword since you last asked", "forms": [[]]},
        "pollChatPosts": {"doc": "Chat typed since you last asked", "forms": [[]]},
        "clearAll": {"doc": "Forgets hits and chat not yet polled", "forms": [[]]},
        "withData": {"doc": "The same block with other data: WOOL.withData(14) is red wool", "forms": [["data"]]},
    },
}


def bundle():
    """The package as {relative path: text}, sorted, so the file only changes when the code does."""
    out = {}
    for name in sorted(os.listdir(PACKAGE)):
        if name.endswith(".py"):
            with open(os.path.join(PACKAGE, name), encoding="utf-8") as f:
                out[name] = f.read()
    return out


def main():
    with open(SIGS_OUT, "w", encoding="utf-8") as f:
        json.dump(SIGS, f, indent=1, sort_keys=True)
        f.write("\n")
    files = bundle()
    with open(BUNDLE, "w", encoding="utf-8") as f:
        json.dump(files, f, sort_keys=True)
        f.write("\n")
    print("mcpi: %d files -> static/py/mcpi_bundle.json (%.0f KB)"
          % (len(files), os.path.getsize(BUNDLE) / 1024))


if __name__ == "__main__":
    main()
