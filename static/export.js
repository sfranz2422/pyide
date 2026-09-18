/* PyIDE — export a game as one playable HTML file.
 *
 * Downloading main.py was honest but useless: the file needs Kaplay, the
 * Python bridge, a canvas and a Python interpreter, none of which a student
 * has at home. So a game downloads as a single .html file that already
 * contains all of that. Double-click it and the game plays. Nothing to
 * install, no server to start, no Python on the machine.
 *
 * WHAT GOES INSIDE
 *
 *   - the student's own program, unchanged except for asset paths
 *   - kaplay.js, inlined (184 KB)
 *   - the Python bridge, inlined
 *   - every sprite and sound the program actually loads, as data: URIs
 *   - a loader for Pyodide, from a CDN
 *
 * Only the assets the program mentions are carried. The bundled sounds come
 * to 4 MB all together, so shipping the lot would turn a small game into a
 * large download for no reason.
 *
 * WHY ONE FILE AND NOT A FOLDER
 *
 * A folder of files opened from disk is a `file://` page, and browsers refuse
 * to fetch anything next to it — no images, no sounds, and WebGL will not take
 * a texture from a local file even when the image does load. A zip would
 * therefore need a local web server to be any use, which is exactly the
 * obstacle this is meant to remove. Everything inlined into one document has
 * nothing left to fetch, so `file://` stops mattering.
 *
 * THE ONE THING IT STILL NEEDS
 *
 * Pyodide, about 15 MB, comes from a CDN on first load — so the first run of
 * an exported game wants an internet connection, and takes a few seconds while
 * Python starts. After that it is as fast as it is here. Embedding Pyodide too
 * would make every exported game ~20 MB, which is fine for one showcase and
 * absurd for a class set.
 */

window.PyIDEExport = (function () {
  "use strict";

  var PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
  var LIB = "/static/game/kaplay.js";
  var SHIM = "/static/py/kaplay.py";

  /* Asset paths as they appear in a student's program: the shapes the Sprites
     panel inserts, quoted either way round. `dungeon/` is the 0x72 pack, whose
     animated entries are strips — one file per character, so a character with
     three animations still costs one inlined image. */
  var ASSET_RE =
    /["']((?:images|dungeon)\/[A-Za-z0-9_\-]+\.png|sounds\/[A-Za-z0-9_\-]+\.wav)["']/g;

  function referencedAssets(source) {
    var found = {}, m;
    ASSET_RE.lastIndex = 0;
    while ((m = ASSET_RE.exec(source)) !== null) found[m[1]] = true;
    return Object.keys(found);
  }

  function mimeFor(path) {
    return /\.png$/i.test(path) ? "image/png"
         : /\.wav$/i.test(path) ? "audio/wav"
         : "application/octet-stream";
  }

  async function dataUri(path) {
    var res = await fetch("/static/assets/" + path);
    if (!res.ok) throw new Error("Could not read " + path);
    var bytes = new Uint8Array(await res.arrayBuffer());

    // btoa over one huge string blows the argument limit on a long sound, so
    // the bytes are folded in in chunks.
    var binary = "", CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null, bytes.subarray(i, i + CHUNK));
    }
    return "data:" + mimeFor(path) + ";base64," + btoa(binary);
  }

  async function text(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error("Could not read " + url);
    return res.text();
  }

  /* A string safe to drop inside a <script> block. JSON.stringify leaves "</"
     alone, and a program containing it would otherwise close the tag early and
     spill the rest of the game into the page as markup. */
  function js(value) {
    return JSON.stringify(value).replace(/<\//g, "<\\/");
  }

  /* Inlining a JavaScript file into a <script> block is safe only while that
     file contains no "</script" — the HTML parser ends the block at the first
     one, wherever it appears, including inside a string. Today's kaplay.js has
     none, but relying on that is relying on luck, and the failure would be a
     game that silently spills its engine onto the page as text. Inside real
     JavaScript "</script" can only occur in a string or a regex, where the
     backslash is harmless. */
  function safeInline(code) {
    return code.replace(/<\/(script)/gi, "<\\/$1");
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Point every asset path at the copy carried inside this file.
     Kaplay's loaders take a data: URI exactly like any other URL, so nothing
     in the student's program has to change shape — only the string. */
  function inlineAssetPaths(source, assets) {
    return source.replace(ASSET_RE, function (whole, path) {
      return assets[path] ? JSON.stringify(assets[path]) : whole;
    });
  }

  async function buildGamePage(source, title, onProgress) {
    var say = onProgress || function () {};

    say("Collecting sprites and sounds…");
    var paths = referencedAssets(source);
    var assets = {};
    for (var i = 0; i < paths.length; i++) {
      try {
        assets[paths[i]] = await dataUri(paths[i]);
      } catch (e) {
        /* A path the program mentions but the pack doesn't have. Left alone,
           so the exported game fails the same way this one does rather than
           differently. */
      }
    }

    say("Packing the game engine…");
    var library = await text(LIB);
    var bridge = await text(SHIM);
    var program = inlineAssetPaths(source, assets);

    var safeTitle = escapeHtml(title || "Game");

    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + safeTitle + "</title>",
      "<style>",
      "  html, body { margin: 0; height: 100%; background: #12121a;",
      "               color: #e8e8f0; font: 15px/1.5 system-ui, sans-serif; }",
      "  body { display: flex; align-items: center; justify-content: center; }",
      "  #wrap { text-align: center; }",
      "  canvas { max-width: 100vw; max-height: 100vh; background: #000;",
      "           border-radius: 6px; image-rendering: pixelated; }",
      "  #status { padding: 24px; }",
      "  #error { display: none; white-space: pre-wrap; text-align: left;",
      "           font: 13px/1.5 ui-monospace, monospace; color: #ffb4b4;",
      "           background: #1c1420; padding: 16px; border-radius: 6px;",
      "           max-width: 90vw; overflow-x: auto; }",
      "  .hint { color: #9aa; font-size: 13px; margin-top: 10px; }",
      "</style>",
      "</head>",
      "<body>",
      '<div id="wrap">',
      '  <div id="status">Starting Python… (a few seconds the first time)</div>',
      '  <canvas id="game" tabindex="0" width="800" height="600" hidden></canvas>',
      '  <pre id="error"></pre>',
      '  <div class="hint" id="hint" hidden>Click the picture, then play.</div>',
      "</div>",
      "",
      "<script>",
      safeInline(library),
      "<\/script>",
      "",
      '<script src="' + PYODIDE + 'pyodide.js"><\/script>',
      "<script>",
      "var BRIDGE = " + js(bridge) + ";",
      "var PROGRAM = " + js(program) + ";",
      "",
      "var statusEl = document.getElementById('status');",
      "var errorEl = document.getElementById('error');",
      "var canvas = document.getElementById('game');",
      "var hint = document.getElementById('hint');",
      "",
      "function fail(message) {",
      "  statusEl.hidden = true;",
      "  errorEl.style.display = 'block';",
      "  errorEl.textContent = message;",
      "}",
      "",
      "",
      "(async function () {",
      "  try {",
      "    if (typeof kaplay !== 'function') {",
      "      fail('The game engine did not load.'); return;",
      "    }",
      "    var py = await loadPyodide({ indexURL: " + js(PYODIDE) + " });",
      "    statusEl.textContent = 'Loading the game…';",
      "",
      "    // Errors inside a callback happen long after the program has",
      "    // finished running, so this shows whatever arrives whenever it",
      "    // arrives rather than checking once and never looking again.",
      "    py.setStderr({ batched: function (s) { fail(errorEl.textContent + s + '\\n'); } });",
      "",
      "    py.FS.mkdirTree('/lib');",
      "    py.FS.writeFile('/lib/kaplay.py', BRIDGE);",
      "    py.runPython(\"import sys\\nsys.path.insert(0, '/lib')\");",
      "",
      "    // the bridge hands this canvas to kaplay(), same as in the editor",
      "    window.__pyideCanvas = canvas;",
      "    // every asset is inlined, so there is no asset directory to look in",
      "    window.__pyideAssetRoot = '';",
      "    canvas.hidden = false;",
      "    statusEl.hidden = true;",
      "    hint.hidden = false;",
      "",
      "    py.runPython(PROGRAM);",
      "    canvas.focus();",
      "  } catch (e) {",
      "    fail(String((e && e.message) || e));",
      "  }",
      "})();",
      "<\/script>",
      "</body>",
      "</html>",
      ""
    ].join("\n");
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
    safeInline: safeInline,
    buildGamePage: buildGamePage,
    downloadGamePage: downloadGamePage,
    referencedAssets: referencedAssets,
    inlineAssetPaths: inlineAssetPaths
  };
})();
