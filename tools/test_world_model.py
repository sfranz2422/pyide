#!/usr/bin/env python3
"""The block world's model (static/world_model.js), in node.

    python3 tools/test_world_model.py

world_model.js is what a program that imports mcpi talks to: the blocks, the
terrain, the Raspberry Pi's text protocol, the events, and the world.mcpi
file a world is saved in. It is pure JavaScript, so node runs the real file
here — no browser, no Python.

The ways it can break quietly, which these checks are for:

  * the terrain coming out differently on another machine or after an edit —
    a saved world is only its changes from the terrain, so every building in
    every saved world would shift (the golden checksum, and no floating-point
    maths in the generator)
  * setBlocks with its corners the "wrong" way round doing nothing
  * a checkpoint that is the live world under another name, so restore
    restores nothing
  * the saved bytes depending on the order things were built in, which would
    make an unchanged world look changed and turn work in again for nothing
  * a world too big to save being written anyway, which the server refuses
    together with the student's code
  * Stop not reaching a program waiting to sleep
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(ROOT, "static", "world_model.js")

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-66s %s" % ("ok" if ok else "FAIL", label, detail))



HARNESS = r"""
import fs from "fs";
const window = {};
new Function("window", fs.readFileSync(process.argv[1], "utf8"))(window);
const M = window.PyIDEWorldModel;
const out = {};

function fnv(arrays) {
  let h = 0x811c9dc5;
  for (const a of arrays) for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193) >>> 0;
  return h;
}
function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// A repeatable "random" for the tests, so a failure is the same failure every time.
// xorshift32: a plain multiply-and-add repeats in its low bits, and once
// made 600,000 "scattered" blocks land on the same few thousand cells.
let r = 12345;
function rnd(n) { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r % n; }

const g1 = M.generate(1), g1b = M.generate(1), g2 = M.generate(2);
out.checksum = fnv([g1.ids, g1.data]);
out.repeatable = same(g1.ids, g1b.ids);
out.seedsDiffer = !same(g1.ids, g2.ids);

const w = M.create({ seed: 1 });
out.spawn = { y: w.player.y, ground: w.height(0, 0), atFeet: w.get(0, Math.floor(w.player.y), 0) };
out.cmd = {
  set: w.command("world.setBlock(1,10,2,35,14)"),
  get: w.command("world.getBlock(1,10,2)"),
  withData: w.command("world.getBlockWithData(1,10,2)"),
  floatCoords: w.command("world.getBlock(1.7,10.2,2.9)"),
  outside: w.command("world.getBlock(500,0,0)"),
  setOutside: w.command("world.setBlock(500,0,0,1)"),
  badArgs: w.command("world.getBlock(1,two,3)"),
  unknown: w.command("world.explode(1,2,3)"),
  ids: w.command("world.getPlayerIds()"),
};
// setBlocks: corners either way round, and clipped to the world, as on a Pi.
w.command("world.setBlocks(5,20,5,3,22,3,4)");
let filled = 0;
for (let x = 3; x <= 5; x++) for (let y = 20; y <= 22; y++) for (let z = 3; z <= 5; z++) if (w.get(x, y, z) === 4) filled++;
out.reversed = filled;
w.command("world.setBlocks(120,30,0,140,30,0,41)");
let clipped = 0;
for (let x = 100; x < 128; x++) if (w.get(x, 30, 0) === 41) clipped++;
out.clipped = clipped;
// getHeight: the highest block that isn't air.
w.command("world.setBlocks(10,0,10,10,40,10,1)");
out.height = w.command("world.getHeight(10,10)");
// The player.
w.command("player.setPos(3.25,12,-4.5)");
out.player = {
  pos: w.command("player.getPos()"), tile: w.command("player.getTile()"),
  entity: w.command("entity.getPos(1)"), otherEntity: w.command("entity.getPos(2)"),
  facing: w.command("player.getDirection()"),
};
w.command("player.setTile(2,5,7)");
out.player.afterSetTile = w.command("player.getPos()");
// Checkpoints are a copy of the world, not the world under another name.
w.command("world.setBlock(0,50,0,57)");
w.command("world.checkpoint.save()");
w.command("world.setBlock(0,50,0,46)");
w.command("world.checkpoint.restore()");
out.restored = w.get(0, 50, 0);
w.command("world.setBlock(0,50,0,46)");
w.command("world.checkpoint.restore()");
out.restoredTwice = w.get(0, 50, 0);
// Block hits and chat: queued until polled, and capped.
for (let i = 0; i < 300; i++) w.hitBlock(i, 1, 2, 1);
const hits = w.command("events.block.hits()");
out.hits = { count: hits.split("|").length, first: hits.split("|")[0], again: w.command("events.block.hits()") };
const told = [];
w.onChange((what, text) => { if (what === "chat") told.push(text); });
w.chatPost("hello, world");
w.command("chat.post(Built it, at last)");
out.chat = { posts: w.command("events.chat.posts()"), told: told };
w.hitBlock(1, 2, 3, 0);
w.command("events.clear()");
out.cleared = w.command("events.block.hits()");

// Saving: only the changes, the same bytes however they were made, and back again.
(async () => {
  const a = M.create({ seed: 7 }), b = M.create({ seed: 7 });
  const edits = [];
  for (let i = 0; i < 2000; i++) edits.push([rnd(256) - 128, rnd(128) - 64, rnd(256) - 128, rnd(60), rnd(16)]);
  edits.forEach(e => a.set(...e));
  // b: the same final world, built in the opposite order with detours on the way.
  const last = new Map();
  edits.forEach(e => last.set(e[0] + "," + e[1] + "," + e[2], e));
  [...last.values()].reverse().forEach(e => { b.set(e[0], e[1], e[2], 1, 0); b.set(...e); });
  const ea = await M.encode(a), eb = await M.encode(b);
  out.sameBytes = ea.raw === eb.raw;
  const back = await M.decode(ea.text);
  out.roundTrip = same(back.ids(), a.ids()) && same(back.datas(), a.datas()) && back.seed === 7;
  const fresh = await M.encode(M.create({ seed: 7 }));
  out.untouched = { blocks: fresh.blocks, length: fresh.text.length };
  // Back onto a world that already has other changes: they go.
  const onto = M.create({ seed: 7 });
  onto.set(0, 60, 0, 89, 0);
  await M.decode(fresh.text, onto);
  out.decodeClears = onto.get(0, 60, 0);
  // A whole-world wipe is one long run, and small.
  const wipe = M.create({ seed: 3 });
  wipe.setBox(-128, -64, -128, 127, 63, 127, 0, 0);
  const ew = await M.encode(wipe);
  out.wipe = { length: ew.text.length, tooBig: ew.tooBig, blocks: ew.blocks };
  // Hundreds of thousands of scattered single blocks: too big, and said so.
  const huge = M.create({ seed: 3 });
  for (let i = 0; i < 800000; i++) huge.set(rnd(256) - 128, rnd(128) - 64, rnd(256) - 128, 35, rnd(16));
  const eh = await M.encode(huge);
  out.huge = { length: eh.text.length, tooBig: eh.tooBig, max: M.WORLD_MAX };
  // A file from a newer generator is refused, not misread.
  out.newer = await M.decode(JSON.stringify({ pyide_world: 1, gen: 99, seed: 1, changes: "" })).then(() => "read", e => e.message);

  // The bridge Python talks through.
  const bw = M.create({ seed: 1 });
  const bridge = M.makeBridge(bw, cb => setTimeout(cb, 0));
  const run1 = bridge.beginRun();
  out.frame = await bridge.nextFrame(run1);
  const run2 = bridge.beginRun();
  out.stale = await bridge.nextFrame(run1);
  const t0 = Date.now();
  const sleeping = bridge.sleep(10000, run2);
  setTimeout(() => bridge.requestStop(), 50);
  out.stopWakes = { answer: await sleeping, ms: Date.now() - t0 };
  out.afterStop = await bridge.nextFrame(run2);
  const run3 = bridge.beginRun();
  out.freshRun = await bridge.nextFrame(run3);
  out.command = bridge.command("world.getBlock(0,-64,0)");

  out.looks = {
    from: M.looksLikeWorld("from mcpi.minecraft import Minecraft\n"),
    fromPkg: M.looksLikeWorld("from mcpi import block\n"),
    plain: M.looksLikeWorld("import mcpi.minecraft as minecraft\n"),
    indented: M.looksLikeWorld("try:\n    import mcpi\nexcept ImportError:\n    pass\n"),
    comment: M.looksLikeWorld("# from mcpi.minecraft import Minecraft\nprint(1)\n"),
    text: M.looksLikeWorld("print('import mcpi')\n"),
    other: M.looksLikeWorld("import mcpixel\n"),
  };
  console.log(JSON.stringify(out));
})();
"""


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    run = subprocess.run(["node", "--input-type=module", "-e", HARNESS, MODEL],
                         capture_output=True, text=True, timeout=600)
    if run.returncode != 0:
        print(run.stdout, run.stderr)
        sys.exit(1)
    out = json.loads(run.stdout.strip().splitlines()[-1])
    source = open(MODEL, encoding="utf-8").read()

    print("the terrain")
    check("generate(1) is the terrain it has always been", out["checksum"] == GOLDEN,
          "checksum %d, pinned %d" % (out["checksum"], GOLDEN))
    check("…the same every time", out["repeatable"])
    check("…and another seed is another world", out["seedsDiffer"])
    terrain = source[source.index("/* ------------------------------------------------------------ the terrain"):
                     source.index("/* ------------------------------------------------------------ a world")]
    floats = re.findall(r"Math\.(sin|cos|tan|pow|exp|log|sqrt|random|atan2?)\b", terrain)
    check("the generator uses no maths that differs between browsers", not floats, floats)
    check("the player starts standing on the ground at (0, 0), in the open",
          out["spawn"]["y"] == out["spawn"]["ground"] + 1 and out["spawn"]["atFeet"] == 0, out["spawn"])

    print("the protocol")
    c = out["cmd"]
    check("setBlock with data, then getBlock and getBlockWithData", c["set"] == "" and c["get"] == "35"
          and c["withData"] == "35,14", c)
    check("…coordinates rounded down, as a Pi does", c["floatCoords"] == "35")
    check("…outside the world is air, and setting there does nothing", c["outside"] == "0" and c["setOutside"] == "")
    check("a command it can't read answers Fail", c["badArgs"] == "Fail" and c["unknown"] == "Fail")
    check("one player, id 1", c["ids"] == "1")
    check("setBlocks fills the box with its corners either way round", out["reversed"] == 27, out["reversed"])
    check("…and only the part inside the world", out["clipped"] == 8, out["clipped"])
    check("getHeight is the highest block that isn't air", out["height"] == "40", out["height"])
    p = out["player"]
    check("getPos gives floats and getTile the block it's in",
          p["pos"] == "3.25,12,-4.5" and p["tile"] == "3,12,-5", p)
    check("…entity 1 is the player; another entity is Fail", p["entity"] == p["pos"] and p["otherEntity"] == "Fail")
    check("…facing +z (south) at the start, as in Minecraft", p["facing"] == "0,0,1", p["facing"])
    check("setTile puts the player in the middle of that block", p["afterSetTile"] == "2.5,5,7.5", p["afterSetTile"])
    check("a checkpoint restores what was saved", out["restored"] == 57, out["restored"])
    check("…and is a copy, so it can be restored again", out["restoredTwice"] == 57, out["restoredTwice"])

    print("events")
    h = out["hits"]
    check("block hits wait to be polled, the newest 256 kept", h["count"] == 256 and h["first"] == "44,1,2,1,1", h)
    check("…and polling empties them", h["again"] == "")
    check("chat typed in the world is polled as 'entity,text', commas and all",
          out["chat"]["posts"] == "1,hello, world", out["chat"]["posts"])
    check("…and shown, with what a program posts", out["chat"]["told"] == ["hello, world", "Built it, at last"],
          out["chat"]["told"])
    check("events.clear forgets them", out["cleared"] == "")

    print("saving")
    check("the same world is the same bytes, however it was built", out["sameBytes"])
    check("a saved world opens as it was saved", out["roundTrip"])
    check("an untouched world saves no changes", out["untouched"]["blocks"] == 0, out["untouched"])
    check("opening a world takes away changes it doesn't have", out["decodeClears"] == 0, out["decodeClears"])
    check("a whole-world wipe saves small", out["wipe"]["length"] < 50000 and not out["wipe"]["tooBig"], out["wipe"])
    check("a world too big to save is said to be", out["huge"]["tooBig"] and out["huge"]["length"] > out["huge"]["max"],
          out["huge"])
    check("a world from a newer generator is refused, not misread", "newer" in str(out["newer"]), out["newer"])

    print("the bridge to Python")
    check("a turn of the running program carries on", out["frame"] == 0)
    check("an older run is told to stop", out["stale"] == 1)
    check("Stop wakes a program in the middle of a long sleep",
          out["stopWakes"]["answer"] == 1 and out["stopWakes"]["ms"] < 1000, out["stopWakes"])
    check("…and it stays stopped", out["afterStop"] == 1)
    check("the next run starts afresh", out["freshRun"] == 0)
    check("commands go through to the world", out["command"] == "7")

    print("which programs drive the world")
    lk = out["looks"]
    check("from mcpi… import, import mcpi…, and inside a try",
          lk["from"] and lk["fromPkg"] and lk["plain"] and lk["indented"], lk)
    check("…but not a comment, a string, or another module", not lk["comment"] and not lk["text"] and not lk["other"], lk)

    bad = results.count(False)
    print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
    sys.exit(1 if bad else 0)


# generate(1)'s blocks, checksummed. It changes only if the terrain does, and the
# terrain must never change under saved worlds: a new terrain is a new
# GEN_VERSION beside this one, never an edit to it.
GOLDEN = 2711034462

if __name__ == "__main__":
    main()
