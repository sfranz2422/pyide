/* PyIDE — the Python a Sprites-panel click drops into the editor.
 *
 * This is its own file for one reason: it is the only part of the panel that
 * can be wrong in a way a student feels. A misaligned thumbnail is a blemish;
 * a wrong `sliceX` is a game where the hero is half a hero. Out here it can be
 * run against the real bridge and the real engine — see tools/test_dungeon.mjs,
 * which types every one of these snippets into Kaplay and checks it loads.
 *
 * Both shapes are two lines, and deliberately so. Kaplay needs a sprite loaded
 * before it can be drawn, and a missing load is the commonest way a sprite
 * silently fails to appear: nothing errors, nothing shows.
 */
window.PyIDESprites = (function () {
  "use strict";

  /* Kaplay's animation spec, written as Python a student can read and edit —
     one line per animation, so changing a speed or turning off a loop is
     obviously a thing you are allowed to do. */
  function animsLiteral(anims) {
    var lines = Object.keys(anims).map(function (key) {
      var a = anims[key];
      return '    "' + key + '": {"from": ' + a.from + ', "to": ' + a.to +
             ', "speed": ' + a.speed +
             ', "loop": ' + (a.loop ? "True" : "False") + "},";
    });
    return "{\n" + lines.join("\n") + "\n}";
  }

  /* `entry` is a manifest entry; `dir` is the pack folder it lives in. */
  function insertFor(entry, dir) {
    var path = dir + "/" + entry.name + ".png";

    if (!entry.anims) {
      return 'loadSprite("' + entry.name + '", "' + path + '")\n' +
             'add([sprite("' + entry.name + '"), pos(100, 100)])';
    }

    /* An animated entry is a strip: every frame of every animation of one
       character, laid out left to right in a single file. `sliceX` says how
       many frames to cut it into; `anims` names the runs of frames. The first
       animation is started straight away, because a character standing on a
       single frozen frame looks like a bug. */
    var first = Object.keys(entry.anims)[0];
    return 'loadSprite("' + entry.name + '", "' + path + '",\n' +
           "            sliceX=" + entry.frames +
           ", anims=" + animsLiteral(entry.anims) + ")\n" +
           'add([sprite("' + entry.name + '", anim="' + first + '"), ' +
           "pos(100, 100)])";
  }

  /* ------------------------------------------------------------ atlases --
     An atlas is one image holding many sprites, each cut out by pixel
     coordinates. `loadSpriteAtlas` takes the whole map in one call, so this
     writes out every region the manifest knows about — which is also every
     region that has been checked against the picture. A student edits the
     numbers from there.

     The keys are written in a fixed order rather than whatever order the
     manifest happens to be in, because `x, y, width, height` reads like a
     rectangle and any other order reads like a puzzle. */
  var KEYS = ["x", "y", "width", "height", "sliceX", "sliceY"];

  function pairs(region) {
    return KEYS.filter(function (k) { return region[k] !== undefined; })
               .map(function (k) { return '"' + k + '": ' + region[k]; })
               .join(", ");
  }

  /* One animation: either a frame number on its own, or a from/to spec. */
  function animLiteral(spec) {
    if (typeof spec === "number") return String(spec);
    var parts = ['"from": ' + spec.from, '"to": ' + spec.to];
    if (spec.speed !== undefined) parts.push('"speed": ' + spec.speed);
    if (spec.loop !== undefined) parts.push('"loop": ' + (spec.loop ? "True" : "False"));
    return "{" + parts.join(", ") + "}";
  }

  function regionLiteral(name, region) {
    if (!region.anims) {
      return '    "' + name + '": {' + pairs(region) + "},";
    }
    var anims = Object.keys(region.anims).map(function (key) {
      return '            "' + key + '": ' + animLiteral(region.anims[key]) + ",";
    });
    return '    "' + name + '": {\n' +
           "        " + pairs(region) + ",\n" +
           '        "anims": {\n' + anims.join("\n") + "\n" +
           "        },\n" +
           "    },";
  }

  /* `atlas` is a manifest entry: {name, file, w, h, regions}. */
  function insertAtlas(atlas) {
    var names = Object.keys(atlas.regions);
    var body = names.map(function (n) {
      return regionLiteral(n, atlas.regions[n]);
    }).join("\n");

    /* Whichever region animates comes out on screen, so the insert does
       something visible rather than loading an atlas and stopping. */
    var shown = names.filter(function (n) { return atlas.regions[n].anims; })[0]
                || names[0];
    var anim = atlas.regions[shown].anims
             ? ', anim="' + Object.keys(atlas.regions[shown].anims)[0] + '"'
             : "";

    return 'loadSpriteAtlas("' + atlas.file + '", {\n' + body + "\n})\n" +
           'add([sprite("' + shown + '"' + anim + '), pos(100, 100), scale(3)])';
  }

  return {
    animsLiteral: animsLiteral,
    insertFor: insertFor,
    insertAtlas: insertAtlas
  };
})();
