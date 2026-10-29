/* PyIDE — the block world's model: what is where, and the Raspberry Pi's
 * Minecraft protocol for asking and changing it.
 *
 * A program that imports mcpi (the Raspberry Pi's Minecraft API) drives this
 * world. On a real Pi, mcpi sends lines of text such as
 * "world.setBlock(1,2,3,4)" down a socket to Minecraft Pi Edition and reads
 * back lines such as "0.5,1,0.5". Here there is no socket and no Minecraft:
 * our own mcpi package (static/py/mcpi) hands the same lines to command()
 * below, synchronously, and gets the same answers. Speaking the Pi's protocol
 * rather than inventing an API is deliberate: floats come back as floats and
 * tile positions as ints exactly where a Pi gives them, code that talks to
 * mc.conn directly still works, and node can test this file with no Python.
 *
 * Pure: no DOM, no three.js. world.js draws it and moves the player; the
 * tests (tools/test_world_model.py) run it in node.
 *
 * The terrain is GENERATED, from a seed, and a saved world is only the cells
 * that differ from it (world.mcpi, encode()). So the generator must give the
 * same terrain on every machine for ever, or a world saved on one Chromebook
 * opens on another with its buildings floating over shifted hills. Hence
 * integers only — Math.imul, shifts, and division by powers of two, which
 * are exact — and never Math.sin/pow/exp/random, whose last bits are allowed
 * to differ between browsers. A golden checksum in the tests pins it. To
 * change the terrain, add a GEN_VERSION 2 beside 1; never edit 1.
 */
window.PyIDEWorldModel = (function () {
  "use strict";

  // The size and place of the world, as Pi Edition's: x and z run from
  // -128 to 127 and y from -64 to 63, with the ground near y = 0.
  var SX = 256, SY = 128, SZ = 256;
  var MIN_X = -128, MIN_Y = -64, MIN_Z = -128;
  var CELLS = SX * SY * SZ;
  var GEN_VERSION = 1;
  var DEFAULT_SEED = 20261029;
  var SEA = -2;               // water fills hollows up to here
  var QUEUE_MAX = 256;        // block hits and chat posts kept until polled
  var WORLD_MAX = 1400000;    // characters: under the 1.5 MB a data file may be

  /* The blocks the Pi knows, by id, and how each behaves in the world:
     "air"; "solid" (a cube you stand on); "see" (a cube you can see through:
     glass, leaves, ice); "water" (see-through, not solid); "plant" (drawn as
     a cross, walked through). world.js draws each id; a test holds this
     table to static/py/mcpi/block.py both ways. */
  var BLOCKS = {
    0: ["air", "air"], 1: ["stone", "solid"], 2: ["grass", "solid"], 3: ["dirt", "solid"],
    4: ["cobblestone", "solid"], 5: ["wood planks", "solid"], 6: ["sapling", "plant"],
    7: ["bedrock", "solid"], 8: ["water", "water"], 9: ["water", "water"],
    10: ["lava", "water"], 11: ["lava", "water"], 12: ["sand", "solid"], 13: ["gravel", "solid"],
    14: ["gold ore", "solid"], 15: ["iron ore", "solid"], 16: ["coal ore", "solid"],
    17: ["wood", "solid"], 18: ["leaves", "see"], 20: ["glass", "see"],
    21: ["lapis lazuli ore", "solid"], 22: ["lapis lazuli block", "solid"], 24: ["sandstone", "solid"],
    26: ["bed", "solid"], 30: ["cobweb", "plant"], 31: ["tall grass", "plant"], 32: ["dead bush", "plant"],
    35: ["wool", "solid"], 37: ["yellow flower", "plant"], 38: ["cyan flower", "plant"],
    39: ["brown mushroom", "plant"], 40: ["red mushroom", "plant"], 41: ["gold block", "solid"],
    42: ["iron block", "solid"], 43: ["double stone slab", "solid"], 44: ["stone slab", "solid"],
    45: ["brick", "solid"], 46: ["TNT", "solid"], 47: ["bookshelf", "solid"], 48: ["moss stone", "solid"],
    49: ["obsidian", "solid"], 50: ["torch", "plant"], 51: ["fire", "plant"], 53: ["wooden stairs", "solid"],
    54: ["chest", "solid"], 56: ["diamond ore", "solid"], 57: ["diamond block", "solid"],
    58: ["crafting table", "solid"], 60: ["farmland", "solid"], 61: ["furnace", "solid"],
    62: ["lit furnace", "solid"], 63: ["sign", "plant"], 64: ["wooden door", "solid"], 65: ["ladder", "plant"],
    67: ["cobblestone stairs", "solid"], 68: ["wall sign", "plant"], 71: ["iron door", "solid"],
    73: ["redstone ore", "solid"], 78: ["snow", "solid"], 79: ["ice", "see"], 80: ["snow block", "solid"],
    81: ["cactus", "solid"], 82: ["clay", "solid"], 83: ["sugar cane", "plant"], 85: ["fence", "solid"],
    89: ["glowstone", "solid"], 95: ["invisible bedrock", "solid"], 98: ["stone brick", "solid"],
    102: ["glass pane", "see"], 103: ["melon", "solid"], 107: ["fence gate", "solid"],
    246: ["glowing obsidian", "solid"], 247: ["nether reactor core", "solid"]
  };
  function kind(id) { return (BLOCKS[id] || ["", "solid"])[1]; }

  /* ------------------------------------------------------------ the terrain */

  function hash(seed, x, y, z) {
    var h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 1103515245) ^ Math.imul(z, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    return (h ^ (h >>> 15)) >>> 0;
  }

  // Smooth hills from random corner heights (0..255) on a grid of `cell`
  // blocks, blended across each square. `cell` is a power of two, so every
  // division is exact and the answer is the same everywhere.
  function noise(seed, x, z, cell) {
    var gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    var fx = x - gx * cell, fz = z - gz * cell;
    var a = hash(seed, gx, 0, gz) & 255, b = hash(seed, gx + 1, 0, gz) & 255;
    var c = hash(seed, gx, 0, gz + 1) & 255, d = hash(seed, gx + 1, 0, gz + 1) & 255;
    var top = a * cell + (b - a) * fx, bottom = c * cell + (d - c) * fx;   // both × cell
    return Math.floor((top * cell + (bottom - top) * fz) / (cell * cell));
  }

  function groundAt(seed, x, z) {
    var n = noise(seed, x, z, 32) * 6 + noise(seed + 1, x, z, 16) * 3 + noise(seed + 2, x, z, 8);
    return Math.floor(n * 14 / 2550) - 6;          // -6 .. 8, mostly near 0
  }

  function at(x, y, z) {
    return ((y - MIN_Y) * SZ + (z - MIN_Z)) * SX + (x - MIN_X);
  }
  function inside(x, y, z) {
    return x >= MIN_X && x < MIN_X + SX && y >= MIN_Y && y < MIN_Y + SY && z >= MIN_Z && z < MIN_Z + SZ;
  }

  /* The world as a seed makes it: bedrock, stone with ores, dirt, then grass
     (or sand at the shore and under water), water to SEA, flowers, grass
     tufts and trees. The spawn at (0, 0) is kept clear of trees and plants. */
  function generate(seed) {
    seed = seed | 0;
    var ids = new Uint8Array(CELLS), data = new Uint8Array(CELLS);
    var x, y, z, h, r, i;
    var tops = new Int16Array(SX * SZ);
    for (z = MIN_Z; z < MIN_Z + SZ; z++) {
      for (x = MIN_X; x < MIN_X + SX; x++) {
        h = groundAt(seed, x, z);
        tops[(z - MIN_Z) * SX + (x - MIN_X)] = h;
        var shore = h <= SEA + 1;
        for (y = MIN_Y; y <= Math.max(h, SEA); y++) {
          i = at(x, y, z);
          if (y === MIN_Y) ids[i] = 7;
          else if (y > h) ids[i] = 9;
          else if (y === h) ids[i] = shore ? 12 : 2;
          else if (y >= h - 3) ids[i] = shore ? 12 : 3;
          else {
            ids[i] = 1;
            r = hash(seed + 3, x, y, z) % 1000;
            if (r < 8) ids[i] = 16;
            else if (r < 12 && y < -10) ids[i] = 15;
            else if (r < 14 && y < -30) ids[i] = 14;
            else if (r < 15 && y < -45) ids[i] = 56;
          }
        }
      }
    }
    // Plants and trees second, so a tree's leaves can reach over its neighbours.
    for (z = MIN_Z + 3; z < MIN_Z + SZ - 3; z++) {
      for (x = MIN_X + 3; x < MIN_X + SX - 3; x++) {
        h = tops[(z - MIN_Z) * SX + (x - MIN_X)];
        if (ids[at(x, h, z)] !== 2 || h + 7 >= MIN_Y + SY) continue;
        if (Math.abs(x) <= 3 && Math.abs(z) <= 3) continue;
        r = hash(seed + 5, x, 0, z);
        if (r % 97 === 0) tree(ids, x, h + 1, z, 4 + (r >>> 8) % 2);
        else if (ids[at(x, h + 1, z)] === 0) {
          r = (r >>> 4) % 40;
          if (r === 1) ids[at(x, h + 1, z)] = 31;
          else if (r === 2) ids[at(x, h + 1, z)] = 37;
          else if (r === 3) ids[at(x, h + 1, z)] = 38;
        }
      }
    }
    return { ids: ids, data: data };
  }

  function tree(ids, x, y, z, height) {
    var dx, dy, dz, i;
    for (dy = height - 2; dy <= height + 1; dy++) {
      var reach = dy > height - 1 ? 1 : 2;
      for (dz = -reach; dz <= reach; dz++) {
        for (dx = -reach; dx <= reach; dx++) {
          if (reach === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;   // round off the corners
          i = at(x + dx, y + dy, z + dz);
          if (ids[i] === 0 || kind(ids[i]) === "plant") ids[i] = 18;
        }
      }
    }
    for (dy = 0; dy < height; dy++) ids[at(x, y + dy, z)] = 17;
  }

  /* ------------------------------------------------------------ a world */

  function create(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? DEFAULT_SEED : opts.seed | 0;
    var base = generate(seed);                 // the terrain, kept to diff against
    var ids = base.ids.slice(), data = base.data.slice();
    var settings = { world_immutable: false, nametags_visible: true };
    var player = { x: 0.5, y: 0, z: 0.5, yaw: 0, pitch: 0, autojump: true };
    var camera = { mode: "normal", x: 0, y: 0, z: 0 };
    var hits = [], chats = [], said = [];
    var checkpoint = null;
    var dirty = {};                            // 16×16×16 sections the view must redraw
    var listeners = [];
    var changes = 0;

    function section(x, y, z) {
      return (((y - MIN_Y) >> 4) * (SZ >> 4) + ((z - MIN_Z) >> 4)) * (SX >> 4) + ((x - MIN_X) >> 4);
    }
    function touched(x, y, z) {
      dirty[section(x, y, z)] = true;
      // A face on a section's edge belongs to the neighbour's mesh too.
      var lx = (x - MIN_X) & 15, ly = (y - MIN_Y) & 15, lz = (z - MIN_Z) & 15;
      if (lx === 0 && x > MIN_X) dirty[section(x - 1, y, z)] = true;
      if (lx === 15 && x < MIN_X + SX - 1) dirty[section(x + 1, y, z)] = true;
      if (ly === 0 && y > MIN_Y) dirty[section(x, y - 1, z)] = true;
      if (ly === 15 && y < MIN_Y + SY - 1) dirty[section(x, y + 1, z)] = true;
      if (lz === 0 && z > MIN_Z) dirty[section(x, y, z - 1)] = true;
      if (lz === 15 && z < MIN_Z + SZ - 1) dirty[section(x, y, z + 1)] = true;
    }
    function changed() {
      changes += 1;
      listeners.forEach(function (f) { f(); });
    }

    function get(x, y, z) { return inside(x, y, z) ? ids[at(x, y, z)] : 0; }
    function getData(x, y, z) { return inside(x, y, z) ? data[at(x, y, z)] : 0; }
    // One cell, without telling anyone: set() and setBox() tell once.
    function put(x, y, z, id, d) {
      if (!inside(x, y, z)) return false;
      var i = at(x, y, z);
      if (ids[i] === id && data[i] === d) return false;
      ids[i] = id;
      data[i] = d;
      touched(x, y, z);
      return true;
    }
    function set(x, y, z, id, d) {
      if (put(x, y, z, id & 255, (d | 0) & 255)) changed();
    }
    // As a Pi does: the corners in either order, and only the part inside the world.
    function setBox(x1, y1, z1, x2, y2, z2, id, d) {
      var ax = Math.max(Math.min(x1, x2), MIN_X), bx = Math.min(Math.max(x1, x2), MIN_X + SX - 1);
      var ay = Math.max(Math.min(y1, y2), MIN_Y), by = Math.min(Math.max(y1, y2), MIN_Y + SY - 1);
      var az = Math.max(Math.min(z1, z2), MIN_Z), bz = Math.min(Math.max(z1, z2), MIN_Z + SZ - 1);
      var any = false, x, y, z;
      id &= 255;
      d = (d | 0) & 255;
      for (y = ay; y <= by; y++) for (z = az; z <= bz; z++) for (x = ax; x <= bx; x++) {
        if (put(x, y, z, id, d)) any = true;
      }
      if (any) changed();
    }
    // The y of the highest block that isn't air, as world.getHeight answers.
    function height(x, z) {
      if (!inside(x, MIN_Y, z)) return 0;
      for (var y = MIN_Y + SY - 1; y > MIN_Y; y--) if (ids[at(x, y, z)] !== 0) return y;
      return MIN_Y;
    }

    function spawn() {
      player.x = 0.5;
      player.z = 0.5;
      player.y = height(0, 0) + 1;
      player.yaw = 0;
      player.pitch = 0;
    }
    spawn();

    // Where the player looks, as a unit vector: yaw 0 faces +z (south), as in Minecraft.
    function direction() {
      var yaw = player.yaw * Math.PI / 180, pitch = player.pitch * Math.PI / 180;
      return [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    }

    /* ---------------------------------------------------------- the protocol */

    function num(s) { return Number(String(s).trim()); }
    function int(s) { return Math.floor(num(s)); }
    function show(n) {
      // A float the way the Pi sends one: no exponent, no "-0".
      return String(Object.is(n, -0) ? 0 : Math.round(n * 1e6) / 1e6);
    }
    function vec(a, b, c) { return show(a) + "," + show(b) + "," + show(c); }
    function bad(args, n) {
      for (var k = 0; k < n; k++) if (args[k] === undefined || !isFinite(num(args[k]))) return true;
      return false;
    }

    // The player's own commands, and an entity's by id: there is one entity, the player (id 1).
    function playerCommand(name, args) {
      switch (name) {
        case "getPos": return vec(player.x, player.y, player.z);
        case "setPos":
          if (bad(args, 3)) return "Fail";
          player.x = num(args[0]); player.y = num(args[1]); player.z = num(args[2]);
          moved();
          return "";
        case "getTile": return Math.floor(player.x) + "," + Math.floor(player.y) + "," + Math.floor(player.z);
        case "setTile":
          if (bad(args, 3)) return "Fail";
          player.x = int(args[0]) + 0.5; player.y = int(args[1]); player.z = int(args[2]) + 0.5;
          moved();
          return "";
        case "getDirection": var v = direction(); return vec(v[0], v[1], v[2]);
        case "getRotation": return show(((player.yaw % 360) + 360) % 360);
        case "getPitch": return show(player.pitch);
        case "setting":
          if (String(args[0]).trim() === "autojump") player.autojump = num(args[1]) !== 0;
          return "";
      }
      return "Fail";
    }
    function moved() { listeners.forEach(function (f) { f("player"); }); }

    function command(line) {
      line = String(line);
      var open = line.indexOf("(");
      var name = (open < 0 ? line : line.slice(0, open)).trim();
      var inner = open < 0 ? "" : line.slice(open + 1, line.lastIndexOf(")") > open ? line.lastIndexOf(")") : line.length);
      var args = inner === "" ? [] : inner.split(",");
      var x, y, z;
      switch (name) {
        case "world.getBlock":
          if (bad(args, 3)) return "Fail";
          return String(get(int(args[0]), int(args[1]), int(args[2])));
        case "world.getBlockWithData":
          if (bad(args, 3)) return "Fail";
          x = int(args[0]); y = int(args[1]); z = int(args[2]);
          return get(x, y, z) + "," + getData(x, y, z);
        case "world.setBlock":
          if (bad(args, 4)) return "Fail";
          set(int(args[0]), int(args[1]), int(args[2]), int(args[3]), args.length > 4 ? int(args[4]) : 0);
          return "";
        case "world.setBlocks":
          if (bad(args, 7)) return "Fail";
          setBox(int(args[0]), int(args[1]), int(args[2]), int(args[3]), int(args[4]), int(args[5]),
                 int(args[6]), args.length > 7 ? int(args[7]) : 0);
          return "";
        case "world.getHeight":
          if (bad(args, 2)) return "Fail";
          return String(height(int(args[0]), int(args[1])));
        case "world.getPlayerIds": return "1";
        case "world.checkpoint.save":
          checkpoint = { ids: ids.slice(), data: data.slice() };
          return "";
        case "world.checkpoint.restore":
          if (checkpoint) restore(checkpoint.ids, checkpoint.data);
          return "";
        case "world.setting":
          var key = String(args[0] || "").trim();
          if (key in settings) settings[key] = num(args[1]) !== 0;
          return "";
        case "chat.post":
          post(inner);
          return "";
        case "events.block.hits":
          return hits.splice(0).map(function (h) { return h.join(","); }).join("|");
        case "events.chat.posts":
          return chats.splice(0).map(function (c) { return c[0] + "," + c[1]; }).join("|");
        case "events.clear":
          hits.length = 0;
          chats.length = 0;
          return "";
        case "camera.mode.setNormal": camera.mode = "normal"; moved(); return "";
        case "camera.mode.setFollow": camera.mode = "follow"; moved(); return "";
        case "camera.mode.setFixed": camera.mode = "fixed"; moved(); return "";
        case "camera.setPos":
          if (bad(args, 3)) return "Fail";
          camera.x = num(args[0]); camera.y = num(args[1]); camera.z = num(args[2]);
          moved();
          return "";
      }
      if (name.indexOf("player.") === 0) return playerCommand(name.slice(7), args);
      if (name.indexOf("entity.") === 0) {
        if (int(args[0]) !== 1) return "Fail";
        return playerCommand(name.slice(7), args.slice(1));
      }
      return "Fail";
    }

    function post(text) {
      said.push(String(text));
      if (said.length > 100) said.shift();
      listeners.forEach(function (f) { f("chat", String(text)); });
    }
    function restore(fromIds, fromData) {
      for (var i = 0; i < CELLS; i++) {
        if (ids[i] !== fromIds[i] || data[i] !== fromData[i]) {
          ids[i] = fromIds[i];
          data[i] = fromData[i];
          var x = i % SX, rest = (i - x) / SX, z = rest % SZ, y = (rest - z) / SZ;
          touched(x + MIN_X, y + MIN_Y, z + MIN_Z);
        }
      }
      changed();
    }

    /* ---------------------------------------------------------- hand and keyboard */

    // A block struck in the world (with the sword): what events.block.hits answers.
    function hitBlock(x, y, z, face) {
      if (hits.length >= QUEUE_MAX) hits.shift();
      hits.push([x, y, z, face, 1]);
    }
    // A line typed into the world's chat: what events.chat.posts answers.
    function chatPost(text) {
      if (chats.length >= QUEUE_MAX) chats.shift();
      chats.push([1, String(text)]);
      post(text);
    }

    /* ---------------------------------------------------------- saving */

    /* The cells that differ from the terrain, as runs along the world's one
       long row of cells: (gap since the last run, length - 1, id, data), each
       a varint. Canonical — the same world gives the same bytes however it
       was built — so world.js can tell "nothing changed" by comparing bytes
       and never save, or turn in, a world that didn't change. */
    function encodeRuns() {
      var out = [], last = 0, i = 0, count = 0;
      function varint(n) {
        while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); }
        out.push(n);
      }
      while (i < CELLS) {
        if (ids[i] === base.ids[i] && data[i] === base.data[i]) { i++; continue; }
        var id = ids[i], d = data[i], start = i;
        while (i < CELLS && ids[i] === id && data[i] === d && (ids[i] !== base.ids[i] || data[i] !== base.data[i])) i++;
        varint(start - last);
        varint(i - start - 1);
        out.push(id, d);
        count += i - start;
        last = i;
      }
      return { bytes: new Uint8Array(out), blocks: count };
    }

    function decodeRuns(bytes) {
      var p = 0, pos = 0;
      function varint() {
        var n = 0, mul = 1, b;
        do {
          if (p >= bytes.length) throw new Error("The world file is cut short.");
          b = bytes[p++];
          n += (b & 127) * mul;
          mul *= 128;
        } while (b & 128);
        return n;
      }
      var nextIds = base.ids.slice(), nextData = base.data.slice();
      while (p < bytes.length) {
        pos += varint();
        var len = varint() + 1;
        if (p + 2 > bytes.length || pos + len > CELLS) throw new Error("The world file is damaged.");
        var id = bytes[p++], d = bytes[p++];
        nextIds.fill(id, pos, pos + len);
        nextData.fill(d, pos, pos + len);
        pos += len;
      }
      ids = nextIds;
      data = nextData;
      for (var s = 0; s < (SX >> 4) * (SY >> 4) * (SZ >> 4); s++) dirty[s] = true;
      changed();
    }

    return {
      seed: seed,
      get: get, getData: getData, set: set, setBox: setBox, height: height,
      command: command, hitBlock: hitBlock, chatPost: chatPost,
      player: player, camera: camera, settings: settings, spawn: spawn, direction: direction,
      said: said,
      encodeRuns: encodeRuns, decodeRuns: decodeRuns,
      // Sections to redraw since the last call, as [sx, sy, sz] (each 0-based, in 16s).
      takeDirty: function () {
        var out = Object.keys(dirty).map(function (k) {
          k = Number(k);
          var sx = k % (SX >> 4), rest = (k - sx) / (SX >> 4), sz = rest % (SZ >> 4);
          return [sx, (rest - sz) / (SZ >> 4), sz];
        });
        dirty = {};
        return out;
      },
      allDirty: function () { for (var s = 0; s < (SX >> 4) * (SY >> 4) * (SZ >> 4); s++) dirty[s] = true; },
      // f() when a block changes; f("player") when the player or camera is moved by a
      // program; f("chat", text) for chat.
      onChange: function (f) { listeners.push(f); },
      changes: function () { return changes; },
      ids: function () { return ids; },
      datas: function () { return data; }
    };
  }

  /* ------------------------------------------------------------ the world file */

  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(text) {
    var s = atob(text), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function squeeze(bytes, how) {
    var stream = new Blob([bytes]).stream().pipeThrough(how === "in" ? new CompressionStream("deflate-raw")
                                                                     : new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* A world as the text of world.mcpi: {"pyide_world":1, "gen", "seed",
     "blocks" (cells changed), "changes" (the runs, deflated, in base64)}.
     `raw` is the runs before compression, which is what to compare: two
     browsers may deflate the same bytes differently. `tooBig` when the
     text is over WORLD_MAX — the caller must not write it, because the
     server refuses a whole save over one oversized file, code and all. */
  async function encode(world) {
    var runs = world.encodeRuns();
    var text = JSON.stringify({
      pyide_world: 1, gen: GEN_VERSION, seed: world.seed, blocks: runs.blocks,
      changes: toBase64(await squeeze(runs.bytes, "in"))
    });
    return { text: text, raw: toBase64(runs.bytes), blocks: runs.blocks, tooBig: text.length > WORLD_MAX };
  }

  // A world from world.mcpi's text: a new world when the seed differs (or
  // there's no text), the changes laid on its terrain either way.
  async function decode(text, world) {
    var file = text ? JSON.parse(text) : null;
    if (file && (file.pyide_world !== 1 || file.gen !== GEN_VERSION)) {
      throw new Error("This world was saved by a newer PyIDE.");
    }
    var seed = file ? file.seed | 0 : DEFAULT_SEED;
    if (!world || world.seed !== seed) world = create({ seed: seed });
    world.decodeRuns(file && file.changes ? await squeeze(fromBase64(file.changes), "out") : new Uint8Array(0));
    world.spawn();
    return world;
  }

  /* ------------------------------------------------------------ Python's side */

  /* What the mcpi package calls (static/py/mcpi/_pyide.py), through
     window.PyIDEWorld. command() answers at once. nextFrame() and sleep()
     are the program's turns to let the page draw and the player move: the
     Python is suspended (run_sync) until they resolve, and they resolve to 1
     when the program should stop — Stop pressed, or a newer run started. A
     stale run's id always answers 1, so a run left suspended by an earlier
     Stop can never act on the next one. `schedule(cb)` runs cb soon: the
     next animation frame in a browser, setTimeout in the tests. */
  function makeBridge(world, schedule) {
    var run = 0, stopping = false, waiters = [];
    function wait(id, start) {
      return new Promise(function (resolve) {
        if (stopping || id !== run) return resolve(1);
        var done = false;
        var w = function () {
          if (done) return;
          done = true;
          resolve(stopping || id !== run ? 1 : 0);
        };
        waiters.push(w);
        start(w);
      });
    }
    return {
      world: function () { return world; },
      setWorld: function (w) { world = w; },
      command: function (line) { return world.command(String(line)); },
      beginRun: function () { run += 1; stopping = false; waiters = []; return run; },
      endRun: function () { stopping = true; waiters.splice(0).forEach(function (w) { w(); }); },
      requestStop: function () { stopping = true; waiters.splice(0).forEach(function (w) { w(); }); },
      isStopping: function () { return stopping; },
      nextFrame: function (id) { return wait(Number(id), schedule); },
      sleep: function (ms, id) { return wait(Number(id), function (w) { setTimeout(w, Math.max(0, Number(ms))); }); }
    };
  }

  // The mode rule, as looksLikeGame is kaypy's: a program that imports mcpi drives the world.
  function looksLikeWorld(source) {
    return /^[ \t]*(?:from[ \t]+mcpi(?:\.[A-Za-z_]\w*)*[ \t]+import|import[ \t]+mcpi)\b/m.test(source);
  }

  return {
    SIZE: [SX, SY, SZ], MIN: [MIN_X, MIN_Y, MIN_Z], GEN_VERSION: GEN_VERSION, DEFAULT_SEED: DEFAULT_SEED,
    WORLD_MAX: WORLD_MAX, BLOCKS: BLOCKS, kind: kind,
    generate: generate, create: create, encode: encode, decode: decode,
    makeBridge: makeBridge, looksLikeWorld: looksLikeWorld
  };
})();
