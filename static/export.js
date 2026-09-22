/* PyIDE — export a game as one playable HTML file.
 *
 * Downloading main.py alone is honest but useless: the file needs an engine, a
 * canvas and a Python interpreter, none of which a student has at home. So a
 * game downloads as a single .html file that already contains all of it.
 * Double-click it and the game plays. Nothing to install, no server to start,
 * no Python on the machine.
 *
 * THE PAGE IS kaypy's, NOT THIS FILE'S
 *
 * This module does not write HTML. It fills in kaypy's own page template —
 * `web_page.html`, carried in the engine bundle — with this game's engine,
 * assets and program. That is the same template, byte for byte, that
 * `kaypy web game.py` fills in on a desktop.
 *
 * Which is the point. A student can write a game here, download it, and later
 * `pip install kaypy` and build the same game at home, and get the same page:
 * same boot sequence, same error reporting, same everything. Two exporters
 * that merely agreed today would drift apart by Christmas — one would gain a
 * fix the other never heard about, and the difference would surface as "it
 * works in school but not on my laptop", which is the worst bug report a
 * fourteen-year-old can be asked to write.
 *
 * So the only thing here that is PyIDE's own is where the pieces come from:
 * the engine out of the vendored bundle, the assets off this server, the
 * program out of the editor. The page is kaypy's.
 *
 * WHAT GOES INSIDE
 *
 *   - the student's own program, byte for byte
 *   - the kaypy engine, out of the same bundle the editor runs
 *   - every sprite and sound the program actually loads, base64'd
 *   - a loader for Pyodide, from a CDN
 *
 * Only the assets the program mentions are carried. The two packs and the
 * sounds come to about 5 MB together, so shipping the lot would turn a small
 * game into a large download for no reason.
 */

window.PyIDEExport = (function () {
  "use strict";

  /* Overridable for the same reason as in game.js, and they must agree with
     it: the two read the same bundle and the same sprite packs. */
  var PATHS = window.PyIDEPaths || {};
  var BUNDLE = PATHS.bundle || "/static/py/kaypy_bundle.json";
  var ASSET_ROOT = PATHS.assets || "/static/assets/";

  var TEMPLATE = "web_page.html";      // kaypy's page, inside the bundle

  /* Asset paths as they appear in a student's program: the shapes the Sprites
     panel inserts, quoted either way round. `dungeon/` is the 0x72 pack, whose
     animated entries are strips — one file per character, so a character with
     three animations still costs one inlined image.

     The last alternative is a bare filename, which is how a sprite atlas is
     loaded: `loadSpriteAtlas("dungeon.png", {...})`. It is the loosest of the
     four and will happily match a quoted string that is not an asset at all —
     harmlessly, because a path that fetches nothing is simply not carried, and
     the program then fails in the exported game exactly as it would here.

     Kept identical to the one in game.js on purpose: an export that carried a
     different set of files from the one the editor loads would be a game that
     works on Run and not after Download, which is the worst way to find out. */
  var ASSET_RE =
    /["']((?:images|dungeon)\/[A-Za-z0-9_\-]+\.png|sounds\/[A-Za-z0-9_\-]+\.wav|[A-Za-z0-9_\-]+\.png)["']/g;

  function referencedAssets(source) {
    var found = {}, m;
    ASSET_RE.lastIndex = 0;
    while ((m = ASSET_RE.exec(source)) !== null) found[m[1]] = true;
    return Object.keys(found);
  }

  /* Bytes as base64, folded in in chunks: btoa over one huge string blows the
     argument limit on a long sound. */
  function toBase64(bytes) {
    var binary = "", CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  async function assetBase64(path) {
    var res = await fetch(ASSET_ROOT + path);
    if (!res.ok) throw new Error("Could not read " + path);
    return toBase64(new Uint8Array(await res.arrayBuffer()));
  }

  /* A JavaScript literal that cannot end the <script> block it sits in.
     The HTML parser stops a script block at the first "</script", wherever it
     appears — inside a string literal, inside a comment, anywhere. It does not
     know it is reading JavaScript. "<\/" is identical to "</" in JavaScript
     and invisible to the parser, so escaping costs nothing and removes a whole
     class of failure: a game whose engine silently spills onto the page as
     visible text. kaypy's builder does exactly this, in _js(). */
  function js(value) {
    return JSON.stringify(value).replace(/<\//g, "<\\/");
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* The size the program asks kaypy() for, so the canvas starts right rather
     than resizing visibly on the first frame. kaypy reads this off the syntax
     tree; there is no Python parser here, so it is a pattern — and anything it
     cannot read falls back to kaypy's own default, which is what the engine
     would have used anyway.

     Miss the name and nothing breaks loudly: the size falls back to 800x600
     and the export still reports success, so the wrong canvas only shows up
     on itch.io. This mirrors webbuild.INIT_NAMES in the engine, and
     tools/test_same_as_kaypy.py checks the two against each other rather than
     trusting them to be kept in step. */
  var INIT_CALL = /\b(?:kaypy)\s*\(([^)]*)\)/;

  function canvasSize(source) {
    var size = { width: 800, height: 600 };
    var call = INIT_CALL.exec(source);
    if (!call) return size;
    ["width", "height"].forEach(function (name) {
      var m = new RegExp(name + "\\s*=\\s*(\\d+)").exec(call[1]);
      if (m) size[name] = parseInt(m[1], 10);
    });
    return size;
  }

  async function buildGamePage(source, title, onProgress) {
    var say = onProgress || function () {};

    say("Collecting sprites and sounds…");
    var paths = referencedAssets(source);
    var assets = {};
    for (var i = 0; i < paths.length; i++) {
      try {
        assets[paths[i]] = await assetBase64(paths[i]);
      } catch (e) {
        /* A path the program mentions but the pack does not have. Left out, so
           the exported game fails the same way this one does — kaypy raises a
           FileNotFoundError naming the path — rather than differently. */
      }
    }

    say("Packing the game engine…");
    var res = await fetch(BUNDLE);
    if (!res.ok) throw new Error("Could not load the game engine.");
    var bundle = await res.json();

    var template = bundle[TEMPLATE];
    if (!template) {
      throw new Error("The engine bundle has no " + TEMPLATE + " — it was "
                      + "vendored from a kaypy too old to carry its own page. "
                      + "Run tools/vendor_kaypy.py again.");
    }

    /* The engine the page carries is the Python, and only the Python.
       kaypy's own builder takes *.py; matching that keeps the two exports
       identical, and there is no sense shipping the page template inside a
       page that was built from it. */
    var engine = {};
    Object.keys(bundle).forEach(function (name) {
      if (/\.py$/.test(name)) engine[name] = bundle[name];
    });

    var size = canvasSize(source);
    var slots = {
      "__TITLE__": escapeHtml(title || "Game"),
      "__WIDTH__": String(size.width),
      "__HEIGHT__": String(size.height),
      "__PYODIDE__": "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/",
      "__ENGINE__": js(engine),
      "__ASSETS__": js(assets),
      "__PROGRAM__": js(source)
    };

    var missing = Object.keys(slots).filter(function (name) {
      return template.indexOf(name) === -1;
    });
    if (missing.length) {
      throw new Error("kaypy's page template has no " + missing.join(", ")
                      + " slot. The vendored engine and this file disagree.");
    }

    /* ONE pass, not one replace() per slot.
     *
     * The engine carries kaypy's own webbuild.py, whose source contains the
     * literal text "__ASSETS__" — it is the module that defines these slots.
     * Filling them one at a time puts the engine in first and then goes
     * looking for "__ASSETS__" again, finds the mention inside webbuild.py's
     * source, and replaces it with this game's assets, halfway through a
     * Python string inside a JSON string. The page still looks plausible and
     * the JSON no longer parses. It happened; that is how it was found.
     *
     * A single pass cannot do it: what goes in is never looked at again. */
    return template.replace(
      /__(?:TITLE|WIDTH|HEIGHT|PYODIDE|ENGINE|ASSETS|PROGRAM)__/g,
      function (name) { return slots[name]; });
  }

  function downloadGamePage(filename, html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    buildGamePage: buildGamePage,
    downloadGamePage: downloadGamePage,
    referencedAssets: referencedAssets,
    canvasSize: canvasSize,
    js: js
  };
})();
