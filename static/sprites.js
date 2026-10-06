/* PyIDE — the Python a Sprites-panel click drops into the editor.
 *
 * This is its own file for one reason: it is the only part of the panel that
 * can be wrong in a way a student feels. A misaligned thumbnail is a blemish;
 * a wrong `sliceX` is a game where the hero is half a hero. Out here it can be
 * run against the real bridge and the real engine — see tools/test_dungeon.mjs,
 * which types every one of these snippets into Kaplay and checks it loads.
 *
 * WHAT A CLICK WRITES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * The load line only. A sprite has to be loaded before it can be drawn, and a
 * missing load is the commonest way one silently fails to appear — nothing
 * errors, nothing shows — so that is the line worth handing over.
 *
 * It used to write the `add([...])` as well, which put a bean on the screen
 * at pos(100, 100) the moment you clicked. That reads as helpful and is not:
 * deciding what to make and where to put it is the exercise, and a student
 * who clicks four sprites ends up with four objects stacked on the same spot
 * and a program they did not write. Loading is plumbing; adding is the
 * lesson.
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
      return 'loadSprite("' + entry.name + '", "' + path + '")';
    }

    /* An animated entry is a strip: every frame of every animation of one
       character, laid out left to right in a single file. `sliceX` says how
       many frames to cut it into; `anims` names the runs of frames — written
       out in full so the speeds and loops are numbers a student can see and
       change, rather than something that happened to them. */
    return 'loadSprite("' + entry.name + '", "' + path + '",\n' +
           "            sliceX=" + entry.frames +
           ", anims=" + animsLiteral(entry.anims) + ")";
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

    /* The load alone, for the same reason as a single sprite above: every
       region in the atlas is now a name that can be drawn, and which of them
       to put on screen is the student's decision, not the panel's. */
    return 'loadSpriteAtlas("' + atlas.file + '", {\n' + body + "\n})";
  }

  /* ------------------------------------------------------------- the panel --
     The grid of thumbnails, its search box and its open/close, for any page
     with the panel's markup in it (the editor, and a student's live lesson).
     It was written inside app.js once, and the live page simply had no
     Sprites button: a kaypy lesson left the class guessing file names while
     the teacher clicked them in. One copy here, so the two cannot drift.

     `opts.insert(text)` puts a line in the page's own editor — each page
     knows which editor and which file that is. `opts.relayout()` is called
     after the panel opens or closes, since it resizes the editor beside it.
     Nothing here runs until attachPanel is called, so the tests can load
     this file in node with no document at all. */
  function attachPanel(opts) {
    var $ = function (id) { return document.getElementById(id); };
    var toggle = $("sprites-toggle");
    var panel = $("sprites");
    var spriteGrid = $("sprite-grid");
    var dungeonGrid = $("dungeon-grid");
    var atlasList = $("atlas-list");
    var soundList = $("sound-list");
    var relayout = opts.relayout || function () {};
    var insertAtCursor = opts.insert;
    var spritesFetched = false;
    if (!toggle || !panel) return null;

    /* How tall a thumbnail may be, and how wide before it is shrunk to fit a
       third of a 268px panel. */
    var THUMB_H = 44, THUMB_W = 60;

    /* A cell showing one sprite. `frames` is how many frames sit side by side
       in the file, so the cell can show just the first one. */
    function spriteCell(name, dir, w, h, frames, note) {
      var cell = document.createElement("button");
      cell.className = "sprite";
      cell.type = "button";
      cell.dataset.name = name;
      cell.title = name + " — " + w + "×" + h +
        (note ? " — " + note : "") + " — click to insert";

      var scale = Math.min(THUMB_H / h, THUMB_W / w, 3);
      var box = document.createElement("span");
      box.className = "sprite-img";

      var window_ = document.createElement("span");
      window_.className = "sprite-frame";
      window_.style.width = Math.round(w * scale) + "px";
      window_.style.height = Math.round(h * scale) + "px";

      var img = document.createElement("img");
      img.src = "/static/assets/" + dir + "/" + name + ".png";
      img.alt = "";
      img.loading = "lazy";
      img.style.width = Math.round(w * scale) * frames + "px";

      window_.appendChild(img);
      box.appendChild(window_);
      cell.appendChild(box);

      if (frames > 1) {
        var mark = document.createElement("span");
        mark.className = "sprite-anim";
        mark.textContent = "▶";
        cell.appendChild(mark);
      }

      var label = document.createElement("span");
      label.className = "sprite-name";
      label.textContent = name;
      cell.appendChild(label);
      return cell;
    }

    async function fill() {
      if (spritesFetched) return;
      spritesFetched = true;
      var manifest;
      try {
        manifest = await fetch("/static/assets/manifest.json").then(function (r) { return r.json(); });
      } catch (e) {
        spriteGrid.textContent = "Could not load the sprite list.";
        return;
      }

      /* Both packs are drawn the same way. The only difference is the folder
         the pictures live in, and that the dungeon pack has animated entries. */
      function addPack(entries, dir, grid) {
        entries.forEach(function (entry) {
          var frames = entry.frames || 1;
          var names = entry.anims ? Object.keys(entry.anims) : [];
          var cell = spriteCell(entry.name, dir, entry.w, entry.h, frames,
                                names.join(", "));
          cell.addEventListener("click", function () {
            insertAtCursor(insertFor(entry, dir));
          });
          grid.appendChild(cell);
        });
      }

      spriteGrid.textContent = "";
      addPack(manifest.images || [], "images", spriteGrid);
      addPack(manifest.dungeon || [], "dungeon", dungeonGrid);
      $("dungeon-section").hidden = !dungeonGrid.children.length;

      /* The atlas: one image holding many sprites, cut out by coordinates.
         The dungeon pack above is this same artwork already cut up — quicker
         to use, but it hides where sprites come from, which is the thing the
         atlas lesson is for. So both are here. */
      (manifest.atlases || []).forEach(function (atlas) {
        var card = document.createElement("button");
        card.className = "atlas-card";
        card.type = "button";
        card.dataset.name = atlas.name + " atlas spritesheet";
        var regions = Object.keys(atlas.regions);
        card.title = atlas.file + " — " + atlas.w + "×" + atlas.h + " — " +
                     regions.join(", ") + " — click to insert";
        card.innerHTML =
          '<img src="/static/assets/' + atlas.file + '" alt="" loading="lazy">' +
          '<span class="sprite-name">' + atlas.file + "</span>" +
          '<p class="atlas-note">' + regions.length +
          " regions cut out by coordinates: " + regions.join(", ") + "</p>";
        card.addEventListener("click", function () {
          insertAtCursor(insertAtlas(atlas));
        });
        atlasList.appendChild(card);
      });
      $("atlas-section").hidden = !atlasList.children.length;

      var sounds = manifest.sounds || [];
      if (!sounds.length) {
        $("sound-section").hidden = true;
      } else {
        soundList.textContent = "";
        sounds.forEach(function (file) {
          var name = file.replace(/\.[^.]+$/, "");
          var b = document.createElement("button");
          b.className = "chip";
          b.type = "button";
          b.textContent = name;
          b.title = 'Insert loadSound("' + name + '", ...) and play("' + name + '")';
          b.addEventListener("click", function () {
            insertAtCursor(
              'loadSound("' + name + '", "sounds/' + file + '")\n' +
              'play("' + name + '")');
          });
          soundList.appendChild(b);
        });
      }
    }

    function close() {
      panel.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", "false");
      relayout();
    }

    function open() {
      panel.removeAttribute("hidden");
      toggle.setAttribute("aria-expanded", "true");
      fill();
      relayout();
    }

    toggle.addEventListener("click", function () {
      if (panel.hasAttribute("hidden")) open();
      else close();
    });

    $("sprite-search").addEventListener("input", function (e) {
      var q = e.target.value.trim().toLowerCase();
      var total = 0;

      /* Each pack is filtered on its own so an empty one can take its heading
         with it: searching "elf" should not leave a "Kaplay pack" label
         sitting above nothing. */
      [[spriteGrid, "images-section"], [dungeonGrid, "dungeon-section"],
       [atlasList, "atlas-section"]]
        .forEach(function (pair) {
          var shown = 0;
          Array.prototype.forEach.call(pair[0].children, function (cell) {
            if (!cell.dataset.name) return;      // the "Loading…" placeholder
            var hit = !q || cell.dataset.name.indexOf(q) >= 0;
            cell.hidden = !hit;
            if (hit) shown++;
          });
          $(pair[1]).hidden = pair[0].children.length > 0 && shown === 0;
          total += shown;
        });

      $("sprite-empty").hidden = total > 0;
    });

    $("sprites-close").addEventListener("click", close);

    /* Sprites are only meaningful to a game, so the button shows with one
       and the panel shuts when the code stops being one. */
    function showFor(isGame) {
      toggle.hidden = !isGame;
      if (!isGame && !panel.hasAttribute("hidden")) close();
    }

    return { open: open, close: close, showFor: showFor };
  }

  return {
    animsLiteral: animsLiteral,
    insertFor: insertFor,
    insertAtlas: insertAtlas,
    attachPanel: attachPanel
  };
})();
