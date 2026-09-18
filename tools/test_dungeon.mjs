/* Check the sprite packs the way the Sprites panel uses them.
 *
 *     node tools/test_dungeon.mjs
 *
 * Three things can go wrong between a folder of pictures and a student's
 * screen, and none of them announces itself:
 *
 *   1. The manifest names a file that isn't there. Kaplay's loader fails
 *      quietly and the character simply never appears.
 *   2. `sliceX` disagrees with the picture. The strip is cut on the wrong
 *      boundaries, so every frame is half one pose and half the next — which
 *      looks like an animation bug, not a data bug.
 *   3. An `anims` range runs past the end of the strip. The animation plays
 *      into empty space.
 *
 * So this reads the PNG headers directly, checks the numbers agree, and then
 * runs the actual line the panel inserts — for all 202 sprites, both packs —
 * through the real bridge against a stand-in engine that re-checks the
 * arithmetic from the inside.
 */
import { loadPyodide } from "pyodide";
import { readFileSync, existsSync, statSync } from "fs";
import { fileURLToPath } from "url";

const root = new URL("../", import.meta.url);
const assets = new URL("static/assets/", root);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", assets), "utf8"));

let fail = 0, checks = 0;
function check(ok, label) {
  checks++;
  if (!ok) { fail++; console.log("  FAIL  " + label); }
}

/* A PNG's width and height are the first two 32-bit numbers of the IHDR
   chunk, which is always the first chunk: 8 bytes of signature, 8 of chunk
   header, then the size. No decoder needed. */
function pngSize(path) {
  const b = readFileSync(path);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------------------------------------------------------------- the files
const packs = [["images", manifest.images || []],
               ["dungeon", manifest.dungeon || []]];

let bytes = 0;
for (const [dir, entries] of packs) {
  for (const e of entries) {
    const path = fileURLToPath(new URL(dir + "/" + e.name + ".png", assets));
    if (!existsSync(path)) { check(false, dir + "/" + e.name + ".png missing"); continue; }
    bytes += statSync(path).size;

    const size = pngSize(path);
    const frames = e.frames || 1;
    check(size !== null, e.name + " is a PNG");
    check(size.h === e.h,
          e.name + ": manifest says " + e.h + " tall, file is " + size.h);
    check(size.w === e.w * frames,
          e.name + ": " + frames + " frames of " + e.w + " should be " +
          (e.w * frames) + " wide, file is " + size.w);

    for (const [name, a] of Object.entries(e.anims || {})) {
      check(a.from >= 0 && a.to < frames && a.from <= a.to,
            e.name + "." + name + ": frames " + a.from + "–" + a.to +
            " outside a " + frames + "-frame strip");
      check(a.speed > 0, e.name + "." + name + ": speed " + a.speed);
    }
  }
}

/* Kaplay keeps one sprite per name, so a name in both packs is a trap: load
   both and only the second survives, as the wrong picture with no error.
   vendor_dungeon.py renames around it; this makes sure it did. */
const seen = new Set(manifest.images.map(e => e.name));
const clash = (manifest.dungeon || []).filter(e => seen.has(e.name))
                                      .map(e => e.name);
check(clash.length === 0, "names used by both packs: " + clash.join(", "));

// -------------------------------------------------- the line the panel types
/* sprites.js is the panel's own code, loaded here rather than copied, so this
   tests what students actually get. */
const win = {};
new Function("window", readFileSync(new URL("static/sprites.js", root), "utf8"))(win);

/* ------------------------------------------------------------- the atlas --
   An atlas region is four numbers, and all four can be wrong without anything
   saying so. Kaplay's own published example gets two of them wrong for this
   file: `ogre` is 16 pixels high and `chest` points at empty space. So the
   region rectangles are checked against the picture's real size here, and the
   frame arithmetic is checked the same way as a strip's. Whether a region
   holds the RIGHT sprite is a question for eyes, and tools/vendor_atlas.py
   writes a proof sheet for that. */
for (const atlas of manifest.atlases || []) {
  const path = fileURLToPath(new URL(atlas.file, assets));
  if (!existsSync(path)) { check(false, atlas.file + " missing"); continue; }
  bytes += statSync(path).size;

  const size = pngSize(path);
  check(size && size.w === atlas.w && size.h === atlas.h,
        atlas.file + ": manifest says " + atlas.w + "×" + atlas.h +
        ", file is " + (size && size.w + "×" + size.h));

  for (const [name, r] of Object.entries(atlas.regions)) {
    const sx = r.sliceX || 1, sy = r.sliceY || 1;
    check(r.x >= 0 && r.y >= 0 &&
          r.x + r.width <= atlas.w && r.y + r.height <= atlas.h,
          name + ": (" + r.x + "," + r.y + ") " + r.width + "×" + r.height +
          " runs outside the atlas");
    check(r.width % sx === 0 && r.height % sy === 0,
          name + ": " + r.width + "×" + r.height + " does not divide into " +
          sx + "×" + sy + " frames");
    for (const [a, spec] of Object.entries(r.anims || {})) {
      const ends = typeof spec === "number" ? [spec, spec] : [spec.from, spec.to];
      check(Math.min(...ends) >= 0 && Math.max(...ends) < sx * sy,
            name + "." + a + ": frames " + ends.join("–") + " outside " +
            (sx * sy));
    }
  }
}

const loads = new Map();
const atlasLoads = new Map();
function comp(k) { return (...a) => ({ __comp: k, a }); }
globalThis.kaplay = () => {
  const ctx = {
    loadRoot() {}, loadSound() {},
    loadSpriteAtlas(src, map) {
      /* What Kaplay is really handed after the bridge has converted a nested
         Python dict — three levels deep here, and every level is somewhere a
         value could arrive as an opaque proxy instead of a number. */
      const plain = {};
      for (const [name, r] of Object.entries(map)) {
        const region = Object.fromEntries(Object.entries(r));
        if (region.anims) {
          region.anims = Object.fromEntries(
            Object.entries(region.anims).map(([k, v]) =>
              [k, typeof v === "number" ? v : Object.fromEntries(Object.entries(v))]));
        }
        plain[name] = region;
      }
      atlasLoads.set(src, plain);
    },
    loadSprite(name, src, opt) {
      /* The check the panel can't do for itself: what Kaplay is actually
         handed. A kwarg that doesn't survive the bridge arrives as undefined
         here, which is exactly how it would arrive in a real game. */
      loads.set(src, { name, opt: opt ? Object.fromEntries(Object.entries(opt)) : null });
    },
    add: (cs) => ({ comps: Array.from(cs), use() {}, add() {}, play() {} }),
    width: () => 800, height: () => 600, quit() {},
    debug: { inspect: false },
  };
  for (const c of ["sprite", "pos", "area", "body", "anchor", "scale"]) ctx[c] = comp(c);
  return ctx;
};

const py = await loadPyodide();
let err = "";
py.setStderr({ batched: s => { err += s + "\n"; } });
py.setStdout({ batched: () => {} });
py.FS.mkdirTree("/lib");
py.FS.writeFile("/lib/kaplay.py",
  readFileSync(new URL("static/py/kaplay.py", root), "utf8"));
py.runPython("import sys; sys.path.insert(0, '/lib')");

const runtimeSrc = readFileSync(new URL("static/runtime.js", root), "utf8");
const sh = { window: {} };
new Function("window", "document", "fetch", runtimeSrc)(sh.window, {}, () => {});
py.runPython(sh.window.PyIDERuntime.BOOTSTRAP);

let all = ["from kaplay import *", "kaplay()"];
const expected = [];
for (const [dir, entries] of packs) {
  for (const e of entries) {
    all.push(win.PyIDESprites.insertFor(e, dir));
    expected.push([dir, e]);
  }
}

for (const atlas of manifest.atlases || []) {
  all.push(win.PyIDESprites.insertAtlas(atlas));
}

const status = py.runPython(`_pyide_run_game(${JSON.stringify(all.join("\n"))})`);
check(status === "ok" && !err.trim(),
      "every insert runs: " + (err.split("\n")[0] || status));

for (const [dir, e] of expected) {
  const got = loads.get(dir + "/" + e.name + ".png");
  if (!got) { check(false, e.name + " never reached loadSprite"); continue; }
  check(got.name === e.name, e.name + ": loaded as " + got.name);

  if (!e.anims) {
    check(got.opt === null, e.name + " is a still and needs no options");
    continue;
  }
  check(got.opt && got.opt.sliceX === e.frames,
        e.name + ": sliceX arrived as " + (got.opt && got.opt.sliceX));
  const anims = got.opt && got.opt.anims ? Object.entries(got.opt.anims) : [];
  check(anims.length === Object.keys(e.anims).length,
        e.name + ": " + anims.length + " animations arrived, expected " +
        Object.keys(e.anims).length);
  for (const [name, a] of anims) {
    const want = e.anims[name];
    check(want && a.from === want.from && a.to === want.to &&
          a.speed === want.speed && a.loop === want.loop,
          e.name + "." + name + ": arrived as " + JSON.stringify(a));
  }
}

/* The atlas insert, after a round trip through Python and the bridge. Every
   number the panel wrote should arrive as the same number. */
for (const atlas of manifest.atlases || []) {
  const got = atlasLoads.get(atlas.file);
  if (!got) { check(false, atlas.file + " never reached loadSpriteAtlas"); continue; }
  for (const [name, want] of Object.entries(atlas.regions)) {
    const r = got[name];
    if (!r) { check(false, name + " missing from the inserted atlas"); continue; }
    check(["x", "y", "width", "height", "sliceX", "sliceY"]
            .every(k => want[k] === undefined ? r[k] === undefined : r[k] === want[k]),
          name + ": arrived as " + JSON.stringify(r).slice(0, 90));
    for (const [a, spec] of Object.entries(want.anims || {})) {
      const arrived = (r.anims || {})[a];
      check(JSON.stringify(arrived) === JSON.stringify(spec),
            name + "." + a + ": arrived as " + JSON.stringify(arrived));
    }
  }
}

console.log("\n%d sprites (%d KB), %d checks, %d failed",
            expected.length, Math.round(bytes / 1024), checks, fail);
process.exit(fail ? 1 : 0);
