/* PyIDE — export a game as one playable HTML file.
 *
 * Downloading main.py alone is honest but useless: the file needs an engine,
 * a canvas and a Python interpreter, none of which a student has at home. So a
 * game downloads as a single .html file that already contains all of it.
 * Double-click it and the game plays. Nothing to install, no server to start,
 * no Python on the machine.
 *
 * WHAT GOES INSIDE
 *
 *   - the student's own program, byte for byte
 *   - the kaypy engine, out of the same bundle the editor uses
 *   - every sprite and sound the program actually loads, base64'd
 *   - the shared Python bootstrap from runtime.js
 *   - a loader for Pyodide, from a CDN
 *
 * Only the assets the program mentions are carried. The two packs and the
 * sounds come to about 5 MB together, so shipping the lot would turn a small
 * game into a large download for no reason.
 *
 * THE STUDENT'S PROGRAM IS NOT REWRITTEN
 *
 * This is the one real difference from the old JavaScript exporter, and it is
 * worth stating plainly. That one had to find every asset path in the source
 * and replace it with a `data:` URI, because Kaplay fetched assets over HTTP
 * and a file:// page cannot fetch anything. So the program inside a downloaded
 * game was not quite the program the student wrote — a detail that does not
 * matter until someone opens the file to see their own code.
 *
 * kaypy opens assets as ordinary files: `pygame.image.load("images/bean.png")`.
 * So the fix is to put the file where the program says it is. The assets are
 * decoded into Pyodide's filesystem under the game's working directory before
 * the program runs, at exactly the paths it names, and `loadSprite("bean",
 * "images/bean.png")` means the same thing in an exported game as it does in
 * the editor, on a desktop, and in the guide. Nothing is rewritten.
 *
 * WHY ONE FILE AND NOT A FOLDER
 *
 * A folder of files opened from disk is a `file://` page, and browsers refuse
 * to fetch anything next to it. A zip would therefore need a local web server
 * to be any use, which is exactly the obstacle this is meant to remove.
 * Everything inlined into one document has nothing left to fetch, so `file://`
 * stops mattering.
 *
 * WHAT IT STILL NEEDS
 *
 * Pyodide and pygame-ce come from a CDN on first load, so the first run of an
 * exported game wants an internet connection and takes several seconds while
 * Python starts. The browser caches both afterwards. Embedding them would make
 * every exported game tens of megabytes, which is fine for one showcase and
 * absurd for a class set.
 *
 * pygame-ce in particular cannot be embedded another way even in principle: it
 * is a compiled C extension, so it has to be Pyodide's own build of it.
 */

window.PyIDEExport = (function () {
  "use strict";

  var PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
  var BUNDLE = "/static/py/kaplay_bundle.json";
  var ASSET_ROOT = "/static/assets/";

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

  /* Inlining JavaScript into a <script> block is safe only while that code
     contains no "</script" — the HTML parser ends the block at the first one,
     wherever it appears, including inside a string. Inside real JavaScript
     "</script" can only occur in a string or a regex, where the backslash is
     harmless. Nothing inlined today contains one; relying on that staying true
     is relying on luck, and the failure would be a game that silently spills
     its engine onto the page as text. */
  function safeInline(code) {
    return code.replace(/<\/(script)/gi, "<\\/$1");
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* The Python bootstrap, straight out of runtime.js.
   *
   * The same code the editor runs, so an exported game reports an error the
   * way the editor reports it: the student's own frames, their own line
   * numbers, `main.py` rather than `<exec>`. Writing a second, simpler version
   * here would mean a game that downloads and then misreports the one thing a
   * student most needs to read. It also hands over the two halves of a run —
   * _pyide_run_game for the top level, _pyide_drive_game for the frame loop —
   * already written. */
  function bootstrap() {
    if (!window.PyIDERuntime || !window.PyIDERuntime.BOOTSTRAP) {
      throw new Error("runtime.js has not loaded; cannot build an export.");
    }
    return window.PyIDERuntime.BOOTSTRAP;
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
    // Already JSON, so it is embedded as text rather than parsed and
    // re-serialised. trim() because the file ends with a newline, which would
    // otherwise put the closing `;` on a line of its own — harmless to run and
    // a nuisance to read back.
    var engine = (await text(BUNDLE)).trim();
    JSON.parse(engine);                     // fail here, not in the download

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
      "  #error, #log { white-space: pre-wrap; text-align: left;",
      "           font: 13px/1.5 ui-monospace, monospace;",
      "           padding: 16px; border-radius: 6px;",
      "           max-width: 90vw; max-height: 40vh; overflow: auto; }",
      "  #error { display: none; color: #ffb4b4; background: #1c1420; }",
      "  #log { display: none; color: #cfe3ff; background: #141a22; }",
      "</style>",
      "</head>",
      "<body>",
      '<div id="wrap">',
      '  <div id="status">Starting Python… (a few seconds the first time)</div>',
      // The id must be exactly "canvas": Pyodide's SDL support looks the
      // element up by that name, and pygame.display.set_mode() inside
      // kaplay() fails without it.
      '  <canvas id="canvas" width="800" height="600" hidden></canvas>',
      '  <pre id="error"></pre>',
      '  <pre id="log"></pre>',
      "</div>",
      "",
      '<script src="' + PYODIDE + 'pyodide.js"><\/script>',
      "<script>",
      "var ENGINE = " + safeInline(engine) + ";",
      "var ASSETS = " + js(assets) + ";",
      "var PROGRAM = " + js(source) + ";",
      "var BOOTSTRAP = " + js(bootstrap()) + ";",
      "",
      "var statusEl = document.getElementById('status');",
      "var errorEl = document.getElementById('error');",
      "var logEl = document.getElementById('log');",
      "var canvas = document.getElementById('canvas');",
      "",
      "function fail(message) {",
      "  statusEl.hidden = true;",
      "  errorEl.style.display = 'block';",
      "  errorEl.textContent += message;",
      "}",
      "",
      "function note(message) {",
      "  logEl.style.display = 'block';",
      "  logEl.textContent += message;",
      "}",
      "",
      "// The bootstrap's input() asks the page whether there is an inline",
      "// input line to read from. There is no editor here, so there is not,",
      "// and it falls back to the browser's own prompt().",
      "window.__pyide_inline = false;",
      "",
      "function writeFile(py, path, bytes) {",
      "  var dir = path.slice(0, path.lastIndexOf('/'));",
      "  py.FS.mkdirTree(dir);",
      "  py.FS.writeFile(path, bytes);",
      "}",
      "",
      "function decode(b64) {",
      "  var binary = atob(b64);",
      "  var out = new Uint8Array(binary.length);",
      "  for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);",
      "  return out;",
      "}",
      "",
      "(async function () {",
      "  try {",
      "    var py = await loadPyodide({ indexURL: " + js(PYODIDE) + " });",
      "",
      "    // Errors inside a callback happen long after the program has",
      "    // finished running, so this shows whatever arrives whenever it",
      "    // arrives rather than checking once and never looking again.",
      "    py.setStderr({ batched: function (s) { fail(s + '\\n'); } });",
      "    py.setStdout({ batched: function (s) { note(s + '\\n'); } });",
      "",
      "    statusEl.textContent = 'Loading the game engine…';",
      "    await py.loadPackage('pygame-ce');",
      "",
      "    statusEl.textContent = 'Unpacking…';",
      "    Object.keys(ENGINE).forEach(function (rel) {",
      "      writeFile(py, '/lib/kaplay/' + rel, ENGINE[rel]);",
      "    });",
      "    py.runPython(BOOTSTRAP);",
      "    py.runPython(\"import sys\\nif '/lib' not in sys.path:\\n\" +",
      "                 \"    sys.path.insert(0, '/lib')\");",
      "",
      "    // The assets go in at the paths the program names, under the same",
      "    // working directory _pyide_run_game chdirs into. Nothing in the",
      "    // program is rewritten.",
      "    Object.keys(ASSETS).forEach(function (path) {",
      "      writeFile(py, '/project/' + path, decode(ASSETS[path]));",
      "    });",
      "",
      "    // Pyodide's own opt-in for SDL: without it, a main loop that hands",
      "    // control back to the browser is treated as a fatal unwind.",
      "    try { py._api._skip_unwind_fatal_error = true; } catch (e) {}",
      "    if (py.canvas && py.canvas.setCanvas2D) py.canvas.setCanvas2D(canvas);",
      "",
      "    canvas.hidden = false;",
      "    statusEl.hidden = true;",
      "",
      "    // Two steps, the same two the editor runs. An error in the setup is",
      "    // then reported as an error in the setup, rather than arriving",
      "    // tangled up in whatever the frame loop was doing.",
      "    py.globals.set('_pyide_source', PROGRAM);",
      "    var status = py.runPython('_pyide_run_game(_pyide_source)');",
      "    if (status === 'ok') {",
      "      await py.runPythonAsync('await _pyide_drive_game()');",
      "    }",
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
    referencedAssets: referencedAssets
  };
})();
