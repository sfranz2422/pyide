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

  return { animsLiteral: animsLiteral, insertFor: insertFor };
})();
