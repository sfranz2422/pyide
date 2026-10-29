/* PyIDE — the block world on screen: drawing it, walking about in it, and
 * the hand that hits, breaks and places blocks.
 *
 * world_model.js is the world itself (what is where, the Raspberry Pi's
 * protocol). This file shows it with three.js and lets the student move:
 *
 *   click the world      take the mouse (Esc gives it back)
 *   W A S D, mouse       walk and look
 *   Space                jump; twice quickly (or F) to fly; then Space up, Shift down
 *   1–9, wheel           the hotbar. Slot 1 is the sword: hitting a block with
 *                        it changes nothing and is what mc.events.pollBlockHits()
 *                        reports, as on a Pi. The others: left breaks, right places.
 *   T                    say something in chat (mc.events.pollChatPosts())
 *
 * window.PyIDEWorld is also what the mcpi package talks to (mcpi/_pyide.py):
 * command(), nextFrame(), sleep() — the bridge from world_model.js.
 *
 * The look is our own, painted here on a canvas at start-up; nothing of
 * Minecraft's is used. three.js is fetched the first time a world is shown,
 * so pages that never show one never download it.
 *
 * ONE WebGL renderer for the life of the page, on a canvas of its own: the
 * browser allows only a few WebGL contexts and quietly drops the oldest, and
 * the game canvas (#canvas) belongs to SDL. The world is drawn only when
 * something changed, so an idle world costs nothing while the student types.
 */
window.PyIDEWorld = (function () {
  "use strict";

  var M = window.PyIDEWorldModel;
  var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
  var BUNDLE = (window.PyIDEPaths && window.PyIDEPaths.mcpiBundle) || "/static/py/mcpi_bundle.json";
  var SX = M.SIZE[0], SY = M.SIZE[1], SZ = M.SIZE[2];
  var MIN_X = M.MIN[0], MIN_Y = M.MIN[1], MIN_Z = M.MIN[2];

  var world = null;
  // A program's turn ends at the next frame — or within 50 ms, because a
  // background tab gets no frames at all and the program would wait for ever.
  function schedule(cb) {
    var done = false;
    function go() { if (!done) { done = true; cb(); } }
    requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  var bridge = M.makeBridge(null, schedule);
  var chatHandlers = [], editHandlers = [];

  function theWorld() {
    if (!world) attach(M.create());
    return world;
  }
  function attach(w) {
    world = w;
    bridge.setWorld(w);
    w.onChange(function (what, text) {
      if (what === "chat") {
        addChat(text);
        chatHandlers.forEach(function (f) { f(text); });
      } else {
        view.needsDraw = true;
      }
    });
    if (view.ready) {
      w.allDirty();
      view.needsDraw = true;
    }
  }

  /* ------------------------------------------------------------ the look */

  // Wool's 16 colours, by data value, as Pi lessons number them.
  var WOOL = ["#e9ecec", "#f07613", "#bd44b3", "#3aafd9", "#f8c627", "#70b919", "#ed8dac", "#3e4447",
              "#8e8e86", "#158991", "#792aac", "#35399d", "#724728", "#546d1b", "#a12722", "#141519"];

  // Each picture is 16×16, painted from a seeded random sequence so the
  // speckles are the same every time.
  var TILE = 16, COLS = 16;
  var painters = {};
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function speckle(hex, amount, seed) {
    return function (px) {
      var c = rgb(hex), r = rng(seed);
      for (var i = 0; i < 256; i++) {
        var k = (r() - 0.5) * amount;
        px(i % 16, i >> 4, c[0] + k, c[1] + k, c[2] + k, 255);
      }
    };
  }
  function over(base, extra) {
    return function (px, get) { base(px, get); extra(px, get); };
  }
  function dots(hex, seed) {
    return function (px) {
      var c = rgb(hex), r = rng(seed);
      for (var n = 0; n < 7; n++) {
        var x = 1 + Math.floor(r() * 13), y = 1 + Math.floor(r() * 13);
        px(x, y, c[0], c[1], c[2], 255); px(x + 1, y, c[0], c[1], c[2], 255);
        px(x, y + 1, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 255);
      }
    };
  }
  function lines(hex, every, vertical) {
    return function (px) {
      var c = rgb(hex);
      for (var a = 0; a < 16; a++) for (var b = 0; b < 16; b += every) {
        if (vertical) px(b, a, c[0], c[1], c[2], 255); else px(a, b, c[0], c[1], c[2], 255);
      }
    };
  }
  function bricks(face, mortar) {
    return function (px) {
      var f = rgb(face), m = rgb(mortar), r = rng(7);
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var row = y >> 2, joint = (y & 3) === 3 || ((x + (row & 1) * 4) & 7) === 7;
        var k = (r() - 0.5) * 24, c = joint ? m : f;
        px(x, y, c[0] + k, c[1] + k, c[2] + k, 255);
      }
    };
  }
  function border(hex, inside, alpha) {
    return function (px) {
      var c = rgb(hex), n = rgb(inside);
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var edge = x === 0 || y === 0 || x === 15 || y === 15;
        if (edge) px(x, y, c[0], c[1], c[2], 255);
        else px(x, y, n[0], n[1], n[2], alpha);
      }
      px(3, 3, 255, 255, 255, 200); px(4, 4, 255, 255, 255, 200); px(4, 3, 255, 255, 255, 160);
    };
  }
  // A darker rim on a solid block: only the edge pixels, the inside left as it is.
  function rim(hex) {
    return function (px) {
      var c = rgb(hex);
      for (var a = 0; a < 16; a++) { px(a, 0, c[0], c[1], c[2], 255); px(a, 15, c[0], c[1], c[2], 255); px(0, a, c[0], c[1], c[2], 255); px(15, a, c[0], c[1], c[2], 255); }
    };
  }
  // A plant: a few stalks and a head, on nothing.
  function sprite(stem, head, seed) {
    return function (px) {
      var s = rgb(stem), h = head ? rgb(head) : null, r = rng(seed);
      for (var n = 0; n < 5; n++) {
        var x = 2 + Math.floor(r() * 12), top = 3 + Math.floor(r() * 8);
        for (var y = top; y < 16; y++) px(x, y, s[0], s[1], s[2], 255);
        if (h && n === 2) for (var dy = -2; dy <= 0; dy++) for (var dx = -1; dx <= 1; dx++) px(x + dx, top + dy, h[0], h[1], h[2], 255);
      }
    };
  }
  function flat(hex) { return speckle(hex, 10, 3); }

  painters.stone = speckle("#7d7d7d", 34, 1);
  painters.grass_top = speckle("#5f9f35", 36, 2);
  painters.dirt = speckle("#866043", 34, 3);
  painters.grass_side = over(painters.dirt, function (px) {
    var g = rgb("#5f9f35"), r = rng(9);
    for (var x = 0; x < 16; x++) for (var y = 0; y < 3 + Math.floor(r() * 2); y++) px(x, y, g[0], g[1], g[2], 255);
  });
  painters.cobblestone = over(speckle("#7a7a7a", 50, 4), lines("#555555", 5, false));
  painters.planks = over(speckle("#a2824e", 20, 5), lines("#7a5f36", 4, false));
  painters.bedrock = speckle("#555555", 110, 6);
  painters.water = function (px) { var r = rng(11); for (var i = 0; i < 256; i++) { var k = r() * 20; px(i % 16, i >> 4, 47 + k, 90 + k, 230, 150); } };
  painters.lava = speckle("#d8621b", 60, 12);
  painters.sand = speckle("#dbcfa3", 20, 13);
  painters.gravel = speckle("#837f7e", 80, 14);
  painters.gold_ore = over(painters.stone, dots("#fcee4b", 15));
  painters.iron_ore = over(painters.stone, dots("#d8af93", 16));
  painters.coal_ore = over(painters.stone, dots("#2b2b2b", 17));
  painters.diamond_ore = over(painters.stone, dots("#5decf5", 18));
  painters.lapis_ore = over(painters.stone, dots("#1f4aa8", 19));
  painters.redstone_ore = over(painters.stone, dots("#d01010", 20));
  painters.log_side = over(speckle("#6b5130", 30, 21), lines("#4c3a22", 3, true));
  painters.log_top = function (px) {
    var a = rgb("#b5915a"), b = rgb("#8c6d3f");
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)), c = (Math.floor(d) & 1) ? a : b;
      if (d > 7) c = rgb("#6b5130");
      px(x, y, c[0], c[1], c[2], 255);
    }
  };
  painters.leaves = function (px) {
    var r = rng(22), g = rgb("#3f8a2a");
    for (var i = 0; i < 256; i++) {
      var k = (r() - 0.5) * 50;
      px(i % 16, i >> 4, g[0] + k, g[1] + k, g[2] + k, r() < 0.22 ? 0 : 255);
    }
  };
  painters.glass = border("#c9e6f0", "#c9e6f0", 0);
  painters.ice = border("#a6c9f7", "#9ec2f5", 170);
  painters.lapis_block = speckle("#1f4aa8", 30, 23);
  painters.sandstone = over(speckle("#d9cf9c", 16, 24), lines("#c2b685", 5, false));
  painters.gold_block = over(speckle("#f9d849", 24, 25), rim("#e7b82a"));
  painters.iron_block = over(speckle("#dcdcdc", 16, 26), rim("#b5b5b5"));
  painters.diamond_block = over(speckle("#6fe0d6", 24, 27), rim("#3fbcb1"));
  painters.slab = over(speckle("#a8a8a8", 16, 28), lines("#7b7b7b", 8, false));
  painters.brick = bricks("#97503b", "#b8a99e");
  painters.stone_brick = bricks("#7b7b7b", "#585858");
  painters.tnt_side = function (px) {
    var red = rgb("#c4402c"), white = rgb("#e8e8e8");
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = y >= 5 && y <= 10 ? white : red;
      px(x, y, c[0], c[1], c[2], 255);
    }
    var ink = [40, 40, 40];
    [2, 3, 4, 7, 8, 9, 12, 13].forEach(function (x) { px(x, 7, ink[0], ink[1], ink[2], 255); });
    [3, 8, 12].forEach(function (x) { px(x, 8, ink[0], ink[1], ink[2], 255); });
  };
  painters.tnt_top = speckle("#c4402c", 20, 29);
  painters.bookshelf = function (px) {
    painters.planks(px);
    var r = rng(30);
    for (var row = 0; row < 2; row++) for (var x = 1; x < 15; x += 2) {
      var c = rgb(["#8b2a2a", "#2a4b8b", "#2f7a3a", "#a08a2a"][Math.floor(r() * 4)]);
      for (var y = 2 + row * 7; y < 7 + row * 7; y++) { px(x, y, c[0], c[1], c[2], 255); px(x + 1, y, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 255); }
    }
  };
  painters.moss_stone = over(painters.cobblestone, dots("#4f7d3a", 31));
  painters.obsidian = speckle("#1b1428", 40, 32);
  painters.glowing_obsidian = over(speckle("#3a0d0d", 40, 33), dots("#ff5a2a", 34));
  painters.chest = over(speckle("#a0702c", 16, 35), function (px) {
    for (var x = 0; x < 16; x++) { px(x, 5, 60, 40, 15, 255); }
    for (var y = 4; y < 8; y++) { px(7, y, 200, 200, 200, 255); px(8, y, 200, 200, 200, 255); }
  });
  painters.crafting = over(painters.planks, lines("#5b4325", 5, true));
  painters.furnace = over(painters.cobblestone, function (px) {
    for (var y = 8; y < 13; y++) for (var x = 4; x < 12; x++) px(x, y, 30, 30, 30, 255);
  });
  painters.furnace_lit = over(painters.furnace, function (px) {
    for (var y = 10; y < 13; y++) for (var x = 5; x < 11; x++) px(x, y, 240, 140, 30, 255);
  });
  painters.farmland = over(speckle("#5b3b20", 30, 36), lines("#3f2814", 4, false));
  painters.door_wood = over(painters.planks, rim("#5b4325"));
  painters.door_iron = over(speckle("#c8c8c8", 16, 37), rim("#8a8a8a"));
  painters.snow = speckle("#f2fbfb", 8, 38);
  painters.cactus = over(speckle("#2f7a2a", 24, 39), dots("#d8e8b0", 40));
  painters.clay = speckle("#9fa4b0", 14, 41);
  painters.fence = over(speckle("#a2824e", 20, 42), lines("#5b4325", 5, true));
  painters.glowstone = over(speckle("#e9c56a", 60, 43), dots("#fff2b0", 44));
  painters.invisible = function (px) { for (var i = 0; i < 256; i++) px(i % 16, i >> 4, 0, 0, 0, 0); };
  painters.melon_side = over(speckle("#7ea32a", 16, 45), lines("#4d6a14", 4, true));
  painters.melon_top = speckle("#8ab030", 20, 46);
  painters.reactor = over(speckle("#2a2a3a", 30, 47), dots("#7ad0ff", 48));
  painters.bed = function (px) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = y < 5 ? [230, 230, 230] : y < 13 ? [170, 30, 30] : [120, 90, 50];
      px(x, y, c[0], c[1], c[2], 255);
    }
  };
  painters.sapling = sprite("#3f7a1a", "#4f9a2a", 50);
  painters.tall_grass = sprite("#5f9f35", null, 51);
  painters.dead_bush = sprite("#7a5a2a", null, 52);
  painters.flower_yellow = sprite("#3f7a1a", "#f2e33b", 53);
  painters.flower_cyan = sprite("#3f7a1a", "#3bd6e8", 54);
  painters.mushroom_brown = sprite("#d8d0b0", "#8a6040", 55);
  painters.mushroom_red = sprite("#d8d0b0", "#d02020", 56);
  painters.cobweb = function (px) {
    for (var i = 0; i < 16; i++) { px(i, i, 240, 240, 240, 255); px(15 - i, i, 240, 240, 240, 255); px(i, 8, 240, 240, 240, 255); px(8, i, 240, 240, 240, 255); }
  };
  painters.torch = function (px) {
    for (var y = 6; y < 16; y++) { px(7, y, 110, 80, 40, 255); px(8, y, 110, 80, 40, 255); }
    for (var y2 = 3; y2 < 6; y2++) { px(7, y2, 255, 210, 80, 255); px(8, y2, 255, 170, 40, 255); }
  };
  painters.fire = sprite("#f08020", "#ffd040", 57);
  painters.sugar_cane = sprite("#86b85a", null, 58);
  painters.ladder = function (px) {
    for (var y = 0; y < 16; y++) { px(2, y, 110, 80, 40, 255); px(13, y, 110, 80, 40, 255); }
    for (var y3 = 1; y3 < 16; y3 += 4) for (var x = 2; x < 14; x++) px(x, y3, 130, 95, 50, 255);
  };
  painters.sign = function (px) {
    for (var y = 2; y < 9; y++) for (var x = 1; x < 15; x++) px(x, y, 170, 135, 80, 255);
    for (var y4 = 9; y4 < 16; y4++) { px(7, y4, 110, 80, 40, 255); px(8, y4, 110, 80, 40, 255); }
  };
  painters.missing = function (px) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var on = (x >> 3) ^ (y >> 3);
      px(x, y, on ? 255 : 30, 0, on ? 220 : 30, 255);
    }
  };
  WOOL.forEach(function (hex, n) { painters["wool" + n] = speckle(hex, 18, 60 + n); });

  /* What each block id looks like: one picture, or {top, side, bottom}. A
     test holds this table to world_model.js's BLOCKS both ways, so a block
     can't be placeable and invisible (or drawn and unknown). Wool's data
     picks the colour. "clear" pictures go in the see-through layer. */
  var LOOKS = {
    1: "stone", 2: { top: "grass_top", side: "grass_side", bottom: "dirt" }, 3: "dirt", 4: "cobblestone",
    5: "planks", 6: "sapling", 7: "bedrock", 8: "water", 9: "water", 10: "lava", 11: "lava",
    12: "sand", 13: "gravel", 14: "gold_ore", 15: "iron_ore", 16: "coal_ore",
    17: { top: "log_top", side: "log_side", bottom: "log_top" }, 18: "leaves", 20: "glass",
    21: "lapis_ore", 22: "lapis_block", 24: "sandstone", 26: "bed", 30: "cobweb", 31: "tall_grass",
    32: "dead_bush", 35: "wool", 37: "flower_yellow", 38: "flower_cyan", 39: "mushroom_brown",
    40: "mushroom_red", 41: "gold_block", 42: "iron_block", 43: "slab", 44: "slab", 45: "brick",
    46: { top: "tnt_top", side: "tnt_side", bottom: "tnt_top" }, 47: { top: "planks", side: "bookshelf", bottom: "planks" },
    48: "moss_stone", 49: "obsidian", 50: "torch", 51: "fire", 53: "planks", 54: "chest",
    56: "diamond_ore", 57: "diamond_block", 58: { top: "crafting", side: "planks", bottom: "planks" },
    60: { top: "farmland", side: "dirt", bottom: "dirt" }, 61: { top: "stone", side: "furnace", bottom: "stone" },
    62: { top: "stone", side: "furnace_lit", bottom: "stone" }, 63: "sign", 64: "door_wood", 65: "ladder",
    67: "cobblestone", 68: "sign", 71: "door_iron", 73: "redstone_ore", 78: "snow", 79: "ice", 80: "snow",
    81: "cactus", 82: "clay", 83: "sugar_cane", 85: "fence", 89: "glowstone", 95: "invisible",
    98: "stone_brick", 102: "glass", 103: { top: "melon_top", side: "melon_side", bottom: "melon_top" },
    107: "fence", 246: "glowing_obsidian", 247: "reactor"
  };
  var CLEAR = { water: true, ice: true };

  // The atlas: every picture once, 16 to a row. tiles[name] = [col, row].
  var atlas = null, tiles = {};
  function paintAtlas() {
    var names = Object.keys(painters);
    var rows = Math.ceil(names.length / COLS);
    var canvas = document.createElement("canvas");
    canvas.width = COLS * TILE;
    canvas.height = rows * TILE;
    var ctx = canvas.getContext("2d");
    var image = ctx.createImageData(canvas.width, canvas.height);
    names.forEach(function (name, n) {
      var col = n % COLS, row = Math.floor(n / COLS);
      tiles[name] = [col, row];
      painters[name](function (x, y, r, g, b, a) {
        if (x < 0 || y < 0 || x > 15 || y > 15) return;
        var i = ((row * TILE + y) * canvas.width + col * TILE + x) * 4;
        image.data[i] = Math.max(0, Math.min(255, r));
        image.data[i + 1] = Math.max(0, Math.min(255, g));
        image.data[i + 2] = Math.max(0, Math.min(255, b));
        image.data[i + 3] = a;
      });
    });
    ctx.putImageData(image, 0, 0);
    atlas = { canvas: canvas, rows: rows };
  }

  function lookOf(id, data, face) {
    var look = LOOKS[id];
    if (look === "wool") return "wool" + (data & 15);
    if (!look) return "missing";
    if (typeof look === "string") return look;
    return face === 1 ? look.top : face === 0 ? look.bottom : look.side;
  }

  /* ------------------------------------------------------------ meshes */

  // The six faces: which way, the four corners, their picture corners, and
  // how bright (light from above: tops brightest, bottoms darkest). The
  // `face` numbers are the Pi's, as pollBlockHits gives them.
  var FACES = [
    { face: 4, dir: [-1, 0, 0], shade: 0.8, corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uv: [[0, 1], [0, 0], [1, 1], [1, 0]] },
    { face: 5, dir: [1, 0, 0], shade: 0.8, corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uv: [[0, 1], [0, 0], [1, 1], [1, 0]] },
    { face: 0, dir: [0, -1, 0], shade: 0.55, corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uv: [[1, 0], [0, 0], [1, 1], [0, 1]] },
    { face: 1, dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] },
    { face: 2, dir: [0, 0, -1], shade: 0.7, corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { face: 3, dir: [0, 0, 1], shade: 0.7, corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uv: [[0, 0], [1, 0], [0, 1], [1, 1]] }
  ];
  var CROSS = [
    [[0, 0, 0], [1, 0, 1], [0, 1, 0], [1, 1, 1]],
    [[1, 0, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]]
  ];

  // Does the block beside this face hide it?
  function hidden(kind, id, nbKind, nbId) {
    if (nbKind === "air" || nbKind === "plant") return false;
    if (kind === "water") return true;              // water shows only to air
    if (kind === "solid") return nbKind === "solid";
    return nbKind === "solid" || nbId === id;       // glass, leaves, ice
  }

  function buildSection(sx, sy, sz) {
    var ids = world.ids(), data = world.datas();
    var x0 = MIN_X + sx * 16, y0 = MIN_Y + sy * 16, z0 = MIN_Z + sz * 16;
    var layers = { solid: newLayer(), plant: newLayer(), clear: newLayer() };
    var x, y, z, i, id, kind, f, nx, ny, nz, nbId, nbKind;
    for (y = y0; y < y0 + 16; y++) for (z = z0; z < z0 + 16; z++) for (x = x0; x < x0 + 16; x++) {
      i = ((y - MIN_Y) * SZ + (z - MIN_Z)) * SX + (x - MIN_X);
      id = ids[i];
      if (id === 0) continue;
      kind = M.kind(id);
      if (kind === "air") continue;
      if (kind === "plant") {
        var name = lookOf(id, data[i], 2);
        CROSS.forEach(function (quad) { addQuad(layers.plant, x, y, z, quad, FACES[4].uv, name, 0.9); });
        continue;
      }
      for (f = 0; f < 6; f++) {
        var d = FACES[f].dir;
        nx = x + d[0]; ny = y + d[1]; nz = z + d[2];
        if (ny < MIN_Y) continue;
        if (nx < MIN_X || nx >= MIN_X + SX || nz < MIN_Z || nz >= MIN_Z + SZ || ny >= MIN_Y + SY) {
          nbId = 0;
        } else {
          nbId = ids[((ny - MIN_Y) * SZ + (nz - MIN_Z)) * SX + (nx - MIN_X)];
        }
        nbKind = M.kind(nbId);
        if (hidden(kind, id, nbKind, nbId)) continue;
        var pic = lookOf(id, data[i], FACES[f].face);
        addQuad(CLEAR[pic] ? layers.clear : layers.solid, x, y, z, FACES[f].corners, FACES[f].uv, pic, FACES[f].shade);
      }
    }
    return layers;
  }
  function newLayer() { return { pos: [], uv: [], color: [], index: [] }; }
  function addQuad(layer, x, y, z, corners, uvs, pic, shade) {
    var t = tiles[pic] || tiles.missing, n = layer.pos.length / 3;
    var inset = 0.02;               // keeps a picture's edge from borrowing its neighbour's pixels
    for (var k = 0; k < 4; k++) {
      var c = corners[k];
      layer.pos.push(x + c[0], y + c[1], z + c[2]);
      var u = uvs[k][0] * (1 - 2 * inset) + inset, v = uvs[k][1] * (1 - 2 * inset) + inset;
      layer.uv.push((t[0] + u) / COLS, 1 - (t[1] + 1 - v) / atlas.rows);
      layer.color.push(shade, shade, shade);
    }
    layer.index.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
  }

  /* ------------------------------------------------------------ the view */

  var view = { ready: false, needsDraw: true, meshes: {}, shown: false };
  var T = null;
  var keys = {}, player = { vy: 0, onGround: false, flying: false, lastSpace: 0 };
  var hotbar = [
    { name: "Sword", sword: true },
    { name: "Stone", id: 1 }, { name: "Grass", id: 2 }, { name: "Wood planks", id: 5 },
    { name: "Cobblestone", id: 4 }, { name: "Glass", id: 20 }, { name: "Red wool", id: 35, data: 14 },
    { name: "Brick", id: 45 }, { name: "Gold block", id: 41 }
  ];
  var slot = 0;
  var chatLines = [];
  var lockedAt = 0, unlockedAt = 0;

  function loadThree() {
    if (!view.threePromise) {
      // A dynamic import from a classic script: three.js is only published
      // as an ES module, and this keeps it off every page that has no world.
      view.threePromise = import(THREE_URL).then(function (mod) { T = mod; return mod; });
    }
    return view.threePromise;
  }

  /* The world drawn into `container` (a positioned element): the first
     call makes the renderer, later ones move it there. */
  function ensureView(container) {
    theWorld();
    return loadThree().then(function () {
      if (!view.ready) makeView();
      if (view.root.parentNode !== container) container.appendChild(view.root);
      show();
      return view.canvas;
    });
  }

  function makeView() {
    paintAtlas();
    var root = document.createElement("div");
    root.className = "world-root";
    var canvas = document.createElement("canvas");
    canvas.className = "world-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "The block world. Click to walk around in it.");
    root.appendChild(canvas);
    root.insertAdjacentHTML("beforeend",
      '<div class="world-cross" aria-hidden="true"></div>' +
      '<div class="world-chat" aria-live="polite"></div>' +
      '<input class="world-say" type="text" maxlength="200" hidden aria-label="Say in the world\'s chat">' +
      '<div class="world-hint">Click the world to walk about · Esc lets go of the mouse</div>' +
      '<div class="world-note" hidden></div>' +
      '<div class="world-bar" aria-label="Hotbar"></div>');
    view.root = root;
    view.canvas = canvas;
    view.chat = root.querySelector(".world-chat");
    view.say = root.querySelector(".world-say");
    view.hint = root.querySelector(".world-hint");
    view.note = root.querySelector(".world-note");
    view.bar = root.querySelector(".world-bar");
    drawHotbar();

    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new T.Scene();
    var sky = new T.Color("#9cc9f2");
    scene.background = sky;
    scene.fog = new T.Fog(sky, 60, 110);
    var camera = new T.PerspectiveCamera(70, 1, 0.05, 400);
    camera.rotation.order = "YXZ";
    var texture = new T.CanvasTexture(atlas.canvas);
    texture.magFilter = T.NearestFilter;
    texture.minFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = T.SRGBColorSpace;
    view.materials = {
      solid: new T.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 }),
      plant: new T.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: T.DoubleSide }),
      clear: new T.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false })
    };
    // The block being pointed at, outlined.
    var edges = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1.002, 1.002, 1.002)),
                                   new T.LineBasicMaterial({ color: 0x111111 }));
    edges.visible = false;
    scene.add(edges);
    // The player, seen only when the camera isn't their own eyes (setFollow, setFixed).
    var body = new T.Mesh(new T.BoxGeometry(0.6, 1.8, 0.6), new T.MeshBasicMaterial({ color: 0x3b6fd1 }));
    body.visible = false;
    scene.add(body);

    view.renderer = renderer;
    view.scene = scene;
    view.camera = camera;
    view.outline = edges;
    view.body = body;
    view.ready = true;
    world.allDirty();

    new ResizeObserver(function () { resize(); }).observe(root);
    listen(canvas);
    var last = performance.now();
    (function frame(now) {
      requestAnimationFrame(frame);
      if (!view.shown) { last = now; return; }
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (move(dt)) view.needsDraw = true;
      if (rebuild(now)) view.needsDraw = true;
      tickChat(now);
      if (view.needsDraw) draw();
    })(last);
  }

  function resize() {
    var w = view.root.clientWidth, h = view.root.clientHeight;
    if (!w || !h) return;
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    view.needsDraw = true;
  }

  // Dirty sections, nearest the player first, for at most ~6 ms a frame:
  // a big setBlocks shows up over a few frames instead of freezing one.
  function rebuild(now) {
    var dirty = world.takeDirty();
    if (view.pending) dirty = view.pending.concat(dirty);
    if (!dirty.length) return false;
    var p = world.player;
    var px = (p.x - MIN_X) / 16, py = (p.y - MIN_Y) / 16, pz = (p.z - MIN_Z) / 16;
    var seen = {};
    dirty = dirty.filter(function (s) { var k = s.join(","); if (seen[k]) return false; seen[k] = true; return true; });
    dirty.sort(function (a, b) {
      return (Math.abs(a[0] + 0.5 - px) + Math.abs(a[1] + 0.5 - py) + Math.abs(a[2] + 0.5 - pz)) -
             (Math.abs(b[0] + 0.5 - px) + Math.abs(b[1] + 0.5 - py) + Math.abs(b[2] + 0.5 - pz));
    });
    var start = performance.now(), n = 0;
    while (n < dirty.length && (n === 0 || performance.now() - start < 6)) {
      replaceMeshes(dirty[n]);
      n++;
    }
    view.pending = dirty.slice(n);
    return true;
  }

  function replaceMeshes(s) {
    var key = s.join(","), old = view.meshes[key];
    if (old) old.forEach(function (m) { view.scene.remove(m); m.geometry.dispose(); });
    var layers = buildSection(s[0], s[1], s[2]), made = [];
    Object.keys(layers).forEach(function (name) {
      var L = layers[name];
      if (!L.index.length) return;
      var g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(L.pos, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(L.uv, 2));
      g.setAttribute("color", new T.Float32BufferAttribute(L.color, 3));
      g.setIndex(L.index);
      var mesh = new T.Mesh(g, view.materials[name]);
      if (name === "clear") mesh.renderOrder = 1;
      view.scene.add(mesh);
      made.push(mesh);
    });
    view.meshes[key] = made;
  }

  function eye() {
    var p = world.player;
    return [p.x, p.y + 1.62, p.z];
  }

  function draw() {
    view.needsDraw = false;
    var p = world.player, c = world.camera, cam = view.camera, e = eye(), d = world.direction();
    view.body.visible = c.mode !== "normal";
    view.body.position.set(p.x, p.y + 0.9, p.z);
    view.body.rotation.y = -p.yaw * Math.PI / 180;
    if (c.mode === "follow") {
      cam.position.set(e[0] - d[0] * 4, e[1] + 1.5, e[2] - d[2] * 4);
      cam.lookAt(e[0], e[1], e[2]);
    } else if (c.mode === "fixed") {
      cam.position.set(c.x, c.y, c.z);
      cam.lookAt(e[0], e[1] - 0.6, e[2]);
    } else {
      cam.position.set(e[0], e[1], e[2]);
      cam.lookAt(e[0] + d[0], e[1] + d[1], e[2] + d[2]);
    }
    var target = c.mode === "normal" ? pick() : null;
    view.outline.visible = !!target;
    if (target) view.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    view.renderer.render(view.scene, cam);
  }

  /* ------------------------------------------------------------ the hand */

  // The block the player is looking at, within reach: stepping through the
  // grid along the line of sight (one cell at a time, never skipping a corner).
  // `face` is the Pi's number for the side that was struck; `before` the empty
  // cell in front of it, where a placed block goes.
  function pick() {
    var e = eye(), d = world.direction(), reach = 6;
    var x = Math.floor(e[0]), y = Math.floor(e[1]), z = Math.floor(e[2]);
    var step = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
    var tMax = [0, 0, 0], tDelta = [0, 0, 0], cell = [x, y, z], before = null, face = -1;
    for (var a = 0; a < 3; a++) {
      tDelta[a] = d[a] === 0 ? Infinity : Math.abs(1 / d[a]);
      var edge = step[a] > 0 ? cell[a] + 1 - e[a] : e[a] - cell[a];
      tMax[a] = d[a] === 0 ? Infinity : edge * tDelta[a];
    }
    var t = 0;
    while (t <= reach) {
      var id = world.get(cell[0], cell[1], cell[2]), k = M.kind(id);
      if (id !== 0 && k !== "water") return { x: cell[0], y: cell[1], z: cell[2], face: face, before: before };
      before = cell.slice();
      var axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[axis];
      cell[axis] += step[axis];
      tMax[axis] += tDelta[axis];
      // Entering along +x strikes the block's -x side (4), and so on.
      face = axis === 0 ? (step[0] > 0 ? 4 : 5) : axis === 1 ? (step[1] > 0 ? 0 : 1) : (step[2] > 0 ? 2 : 3);
    }
    return null;
  }

  function use(button) {
    var target = pick();
    if (!target) return;
    var item = hotbar[slot];
    if (item.sword) {
      world.hitBlock(target.x, target.y, target.z, target.face);
      flashNote("Hit " + target.x + ", " + target.y + ", " + target.z);
      return;
    }
    if (world.settings.world_immutable) {
      flashNote("This world can't be changed by hand (world_immutable).");
      return;
    }
    if (button === 0) {
      world.set(target.x, target.y, target.z, 0, 0);
    } else if (target.before) {
      var b = target.before;
      if (!fits(b)) return;
      world.set(b[0], b[1], b[2], item.id, item.data || 0);
    } else {
      return;
    }
    editHandlers.forEach(function (f) { f(); });
  }
  // A block can't be placed where the player is standing.
  function fits(b) {
    var p = world.player;
    return !(b[0] + 1 > p.x - 0.3 && b[0] < p.x + 0.3 && b[2] + 1 > p.z - 0.3 && b[2] < p.z + 0.3 &&
             b[1] + 1 > p.y && b[1] < p.y + 1.8);
  }

  /* ------------------------------------------------------------ walking */

  function solidAt(x, y, z) {
    var k = M.kind(world.get(Math.floor(x), Math.floor(y), Math.floor(z)));
    return k === "solid" || k === "see";
  }
  function bumps(x, y, z) {
    for (var bx = Math.floor(x - 0.3); bx <= Math.floor(x + 0.3); bx++)
      for (var by = Math.floor(y); by <= Math.floor(y + 1.79); by++)
        for (var bz = Math.floor(z - 0.3); bz <= Math.floor(z + 0.3); bz++)
          if (solidAt(bx + 0.5, by + 0.5, bz + 0.5)) return true;
    return false;
  }

  // One frame of the player's own movement. True when anything moved.
  function move(dt) {
    var p = world.player;
    // Inside blocks — a program's setPos into a hill, or blocks built where
    // the player stands: lifted to the first space they fit, as Minecraft
    // does, or they could never move again.
    if (bumps(p.x, p.y, p.z)) {
      for (var up = 0; up < SY && bumps(p.x, p.y, p.z); up++) p.y = Math.floor(p.y) + 1;
      player.vy = 0;
      return true;
    }
    // Standing still on something: nothing to do. Checked each frame rather
    // than remembered, so a program that takes the ground away drops the player.
    if (!keys.any && !player.flying && player.vy === 0 && bumps(p.x, p.y - 0.01, p.z)) return false;
    var yaw = p.yaw * Math.PI / 180;
    var fx = -Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = -Math.sin(yaw);
    var ahead = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), side = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    var speed = player.flying ? 10 : 4.3;
    var mx = (fx * ahead + rx * side) * speed * dt, mz = (fz * ahead + rz * side) * speed * dt;
    if (ahead && side) { mx *= 0.7071; mz *= 0.7071; }
    var before = p.x + "," + p.y + "," + p.z;
    if (player.flying) {
      player.vy = ((keys.space ? 1 : 0) - (keys.shift ? 1 : 0)) * 8;
    } else {
      player.vy = Math.max(player.vy - 30 * dt, -40);
    }
    // One axis at a time, in small steps, so a wall stops x without stopping z.
    var steps = Math.ceil(Math.max(Math.abs(mx), Math.abs(mz), Math.abs(player.vy * dt)) / 0.2) || 1;
    var landed = false;
    for (var s = 0; s < steps; s++) {
      if (!bumps(p.x + mx / steps, p.y, p.z)) p.x += mx / steps;
      if (!bumps(p.x, p.y, p.z + mz / steps)) p.z += mz / steps;
      var dy = player.vy * dt / steps;
      if (!bumps(p.x, p.y + dy, p.z)) p.y += dy;
      else {
        if (dy < 0) { landed = true; p.y = Math.floor(p.y + dy) + 1; }
        player.vy = 0;
      }
    }
    player.onGround = landed || (!player.flying && bumps(p.x, p.y - 0.01, p.z));
    if (player.onGround && player.flying && keys.shift) player.flying = false;
    if (p.y < MIN_Y - 20) { world.spawn(); player.vy = 0; }
    return before !== p.x + "," + p.y + "," + p.z;
  }

  function listen(canvas) {
    canvas.addEventListener("click", function () {
      if (!view.locked && canvas.requestPointerLock) canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", function () {
      var locked = document.pointerLockElement === canvas;
      if (locked) lockedAt = Date.now(); else if (view.locked) unlockedAt = Date.now();
      view.locked = locked;
      view.hint.hidden = locked;
      if (!locked) { keys = {}; editHandlers.forEach(function (f) { f("unlocked"); }); }
      if (locked) canvas.focus();
    });
    document.addEventListener("mousemove", function (e) {
      if (!view.locked) return;
      var p = world.player;
      p.yaw = (p.yaw + e.movementX * 0.15) % 360;
      p.pitch = Math.max(-90, Math.min(90, p.pitch + e.movementY * 0.15));
      view.needsDraw = true;
    });
    canvas.addEventListener("mousedown", function (e) {
      if (!view.locked) return;
      e.preventDefault();
      use(e.button === 2 ? 2 : 0);
      view.needsDraw = true;
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("wheel", function (e) {
      if (!view.locked) return;
      e.preventDefault();
      choose((slot + (e.deltaY > 0 ? 1 : hotbar.length - 1)) % hotbar.length);
    }, { passive: false });
    // Keys on the world's own canvas only: never the editor's, and never
    // the document, where the game engine (SDL) listens.
    canvas.addEventListener("keydown", function (e) {
      var k = keyName(e);
      if (!k) return;
      if (k === "t" && view.locked) {
        e.preventDefault();
        openSay();
        return;
      }
      if (/^[1-9]$/.test(k)) { choose(Number(k) - 1); e.preventDefault(); return; }
      if (k === "space") {
        if (!e.repeat) {
          var now = Date.now();
          if (now - player.lastSpace < 300) player.flying = !player.flying;
          player.lastSpace = now;
          if (!player.flying && player.onGround) player.vy = 8.5;
        }
      }
      if (k === "f" && !e.repeat) player.flying = !player.flying;
      keys[k] = true;
      keys.any = true;
      if (view.locked) e.preventDefault();
    });
    canvas.addEventListener("keyup", function (e) {
      var k = keyName(e);
      if (k) keys[k] = false;
      keys.any = keys.w || keys.a || keys.s || keys.d || keys.space || keys.shift;
    });
    canvas.addEventListener("blur", function () { keys = {}; });
    view.say.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var text = view.say.value.trim();
        closeSay();
        if (text) world.chatPost(text);
        if (canvas.requestPointerLock) canvas.requestPointerLock();
      } else if (e.key === "Escape") {
        closeSay();
      }
      e.stopPropagation();
    });
  }
  function keyName(e) {
    if (e.code === "Space") return "space";
    if (e.key === "Shift") return "shift";
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    if (/^Digit[1-9]$/.test(e.code)) return e.code.slice(5);
    return null;
  }
  function openSay() {
    if (document.exitPointerLock) document.exitPointerLock();
    view.say.hidden = false;
    view.say.value = "";
    setTimeout(function () { view.say.focus(); }, 0);
  }
  function closeSay() {
    view.say.hidden = true;
    view.canvas.focus();
  }

  function choose(n) {
    slot = n;
    drawHotbar();
  }
  function drawHotbar() {
    view.bar.textContent = "";
    hotbar.forEach(function (item, n) {
      var cell = document.createElement("div");
      cell.className = "world-slot" + (n === slot ? " on" : "");
      cell.title = (n + 1) + ": " + item.name;
      if (item.sword) {
        cell.textContent = "🗡";
      } else {
        var t = tiles[lookOf(item.id, item.data || 0, 2)] || [0, 0];
        var swatch = document.createElement("canvas");
        swatch.width = swatch.height = 16;
        swatch.getContext("2d").drawImage(atlas.canvas, t[0] * TILE, t[1] * TILE, TILE, TILE, 0, 0, 16, 16);
        cell.appendChild(swatch);
      }
      view.bar.appendChild(cell);
    });
  }

  /* ------------------------------------------------------------ chat and notes */

  function addChat(text) {
    chatLines.push({ text: String(text), at: Date.now() });
    if (chatLines.length > 8) chatLines.shift();
    view.chatChanged = true;
  }
  function tickChat(now) {
    var keep = chatLines.filter(function (l) { return Date.now() - l.at < 10000; });
    if (keep.length === chatLines.length && !view.chatChanged) return false;
    chatLines = keep;
    view.chatChanged = false;
    if (view.chat) {
      view.chat.textContent = "";
      chatLines.forEach(function (l) {
        var line = document.createElement("div");
        line.textContent = l.text;
        view.chat.appendChild(line);
      });
    }
    return false;
  }
  function flashNote(text) {
    if (!view.note) return;
    view.note.textContent = text;
    view.note.hidden = false;
    clearTimeout(view.noteTimer);
    view.noteTimer = setTimeout(function () { view.note.hidden = true; }, 2500);
  }
  // A note that stays until replaced: a world too big to save, say.
  function setNote(text) {
    if (!view.note) return;
    clearTimeout(view.noteTimer);
    view.note.textContent = text || "";
    view.note.hidden = !text;
  }

  /* ------------------------------------------------------------ showing and hiding */

  function show() {
    view.shown = true;
    view.needsDraw = true;
    resize();
  }
  function hide() {
    view.shown = false;
    if (view.locked && document.exitPointerLock) document.exitPointerLock();
  }

  /* ------------------------------------------------------------ saving */

  var loadedFrom = null, savedRaw = null;

  /* The world from world.mcpi's text — only when it isn't what this page
     already has (the file the view last read or wrote), so a world being
     built isn't thrown away and rebuilt on every repaint. No text: the
     standard world, the same for everyone. */
  function load(text) {
    text = text || "";
    if (world && text === loadedFrom) return Promise.resolve(false);
    return M.decode(text || null, world).then(function (w) {
      if (w !== world) attach(w);
      loadedFrom = text;
      savedRaw = currentRaw();
      view.needsDraw = true;
      return true;
    });
  }
  function currentRaw() {
    var runs = theWorld().encodeRuns().bytes, s = "";
    for (var i = 0; i < runs.length; i++) s += String.fromCharCode(runs[i]);
    return s;
  }

  /* The text to keep in world.mcpi, or null when the world is as it was
     last loaded or saved — the comparison is on the changes themselves,
     never the compressed text, which two browsers may write differently.
     A world too big to keep is not given back (the server would refuse the
     student's code with it): {tooBig, length} instead, and a note on screen. */
  function save() {
    var raw = currentRaw();
    if (raw === savedRaw) return Promise.resolve(null);
    return M.encode(theWorld()).then(function (enc) {
      if (enc.tooBig) {
        setNote("This world has too many changes to save (" + (enc.text.length / 1e6).toFixed(1) +
                " MB; the most is " + (M.WORLD_MAX / 1e6).toFixed(1) + " MB). What you build now won't be kept. " +
                "New world starts over.");
        return { tooBig: true, length: enc.text.length };
      }
      setNote("");
      savedRaw = raw;
      loadedFrom = enc.text;
      return { text: enc.text, blocks: enc.blocks };
    });
  }

  // A new world, from a new seed, with nothing built in it yet.
  function newWorld(seed) {
    if (seed == null) seed = Math.floor(Math.random() * 2147483647);
    attach(M.create({ seed: seed }));
    savedRaw = null;
    loadedFrom = null;
    player.vy = 0;
    player.flying = false;
    view.needsDraw = true;
    return save();
  }

  /* ------------------------------------------------------------ Python's package */

  // The mcpi package into Pyodide's files (/lib/mcpi), once per page, as
  // game.js puts kaypy there: the bundle is one fetch, not one per file.
  function loadPackage(pyodide) {
    if (!view.packagePromise) {
      view.packagePromise = fetch(BUNDLE).then(function (r) {
        if (!r.ok) throw new Error("Couldn't load the mcpi package (" + r.status + ").");
        return r.json();
      }).then(function (files) {
        pyodide.FS.mkdirTree("/lib/mcpi");
        Object.keys(files).forEach(function (rel) { pyodide.FS.writeFile("/lib/mcpi/" + rel, files[rel]); });
        pyodide.runPython("import sys\nif '/lib' not in sys.path:\n    sys.path.insert(0, '/lib')\n");
      });
      view.packagePromise.catch(function () { view.packagePromise = null; });
    }
    return view.packagePromise;
  }

  return {
    // Python's side (mcpi/_pyide.py) — the bridge in world_model.js.
    command: function (line) { theWorld(); return bridge.command(line); },
    nextFrame: bridge.nextFrame,
    sleep: bridge.sleep,
    beginRun: function () { theWorld(); return bridge.beginRun(); },
    endRun: bridge.endRun,
    requestStop: bridge.requestStop,
    isStopping: bridge.isStopping,
    // The page's side.
    ensureView: ensureView,
    show: show,
    hide: hide,
    load: load,
    save: save,
    newWorld: newWorld,
    loadPackage: loadPackage,
    setNote: setNote,
    // f(text) for every line of chat, a program's or typed in the world.
    onChat: function (f) { chatHandlers.push(f); },
    // f() after the student breaks or places a block by hand; f("unlocked")
    // when they let go of the mouse — the moments worth saving after.
    onHandEdit: function (f) { editHandlers.push(f); },
    // Escape gives back the mouse; it must not also stop the program. True
    // while the mouse is held, and for a moment after it was let go.
    holdsEscape: function () { return !!view.locked || Date.now() - unlockedAt < 400; },
    world: theWorld,
    LOOKS: LOOKS
  };
})();
