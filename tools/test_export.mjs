/* Build an exported game the way the browser would, and inspect the result.
 *
 *     node tools/test_export.mjs
 *
 * export.js runs in a page and uses fetch(), so this supplies a fetch that
 * reads from static/ instead. Everything else is the real module, including
 * the real engine bundle and the real Python bootstrap out of runtime.js.
 *
 * WHAT THIS CAN CHECK
 *
 * That the file is one self-contained document, that it carries the engine,
 * the program and exactly the assets the program names, that nothing inside a
 * <script> block can end the block early, and that what it writes into
 * Pyodide's filesystem lines up with what the program will look for.
 *
 * That last one is the point of most of this file. An exported game is the one
 * thing here that nobody watches fail: it is downloaded, taken home, and
 * opened on a machine with no console open and nobody to ask. A path written
 * to /project/images/bean.png while the program looks for a file in some other
 * directory is a blank screen with no error at all.
 *
 * WHAT IT CANNOT
 *
 * Whether the exported page actually plays. That needs a browser, Pyodide and
 * pygame-ce from a CDN, and a pair of eyes.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const results = [];
const check = (label, cond, extra = "") => {
  results.push(!!cond);
  console.log("  %s %s%s", cond ? "ok  " : "FAIL", label.padEnd(54), extra);
};

// a fetch that serves the real files off disk
globalThis.fetch = async (url) => {
  const path = join(ROOT, url.replace(/^\//, ""));
  try {
    const buf = readFileSync(path);
    return {
      ok: true,
      text: async () => buf.toString("utf8"),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    };
  } catch {
    return { ok: false, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {} }) };

// runtime.js first: the export carries its Python bootstrap inside it.
new Function("window", "document", "fetch",
             readFileSync(join(ROOT, "static", "runtime.js"), "utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch);
new Function("window", "document", "fetch", "btoa",
             readFileSync(join(ROOT, "static", "export.js"), "utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch, globalThis.btoa);

const X = globalThis.window.PyIDEExport;
check("export.js loaded", !!X && typeof X.buildGamePage === "function");
check("and found runtime.js's bootstrap to carry",
      !!(globalThis.window.PyIDERuntime || {}).BOOTSTRAP);

const GAME = `from kaplay import *

kaplay(width=800, height=600, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")
loadSprite("ghosty", "images/ghosty.png")
loadSound("ding", "sounds/ding.wav")
setGravity(1600)

player = add([sprite("bean"), pos(100, 200), area(), body(jumpForce=800), "player"])


@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(800)
        play("ding")


onUpdate("enemy", lambda e: e.move(-120, 0))
`;

// ------------------------------------------------- which assets get carried
check("it finds only the assets the program names",
      JSON.stringify(X.referencedAssets(GAME).sort()) ===
      '["images/bean.png","images/ghosty.png","sounds/ding.wav"]',
      X.referencedAssets(GAME).join(" "));

const DUNGEON = `loadSprite("dwarf_f", "dungeon/dwarf_f.png",
            sliceX=9, anims={"idle": {"from": 0, "to": 3}})
add([sprite("dwarf_f", anim="idle"), pos(100, 100)])`;
check("it finds dungeon sprites too",
      JSON.stringify(X.referencedAssets(DUNGEON)) === '["dungeon/dwarf_f.png"]',
      X.referencedAssets(DUNGEON).join(" "));

/* A sprite atlas is loaded by bare filename, with no folder in front of it —
   the one asset path in the whole editor that looks like nothing in
   particular. Missed by the exporter, a downloaded game would look for a file
   that was never carried. */
const ATLAS = `loadSpriteAtlas("dungeon.png", {
    "wall": {"x": 16, "y": 16, "width": 16, "height": 16},
})`;
check("it finds a sprite atlas loaded by bare filename",
      JSON.stringify(X.referencedAssets(ATLAS)) === '["dungeon.png"]',
      X.referencedAssets(ATLAS).join(" "));

/* The editor and the exporter must agree about what an asset path looks like.
   If they drift, a game works on Run and not after Download — found by the
   student, at home, with nobody to ask. */
const patternIn = (file) => {
  const src = readFileSync(join(ROOT, "static", file), "utf8");
  return /var ASSET_RE =\s*(\/[\s\S]+?\/g);/.exec(src)[1];
};
check("the editor and the exporter look for the same paths",
      patternIn("game.js") === patternIn("export.js"),
      patternIn("game.js") === patternIn("export.js") ? "" : "they have drifted");

// ------------------------------------------------------------ the document
const html = await X.buildGamePage(GAME, "Bean Jump");
console.log("\n  exported size: %s KB\n", (html.length / 1024).toFixed(0));

/* Each `var NAME = ...;` the page declares is written on its own line, so the
   value is read back by line rather than by a regex across the document — a
   pattern like /var ENGINE = (\{[\s\S]*?\});/ runs straight past the end of
   the object, because the engine's own source contains "};" inside strings. */
const declared = (name) => {
  const line = html.split("\n").find((l) => l.startsWith("var " + name + " = "));
  if (!line) throw new Error("the export declares no " + name);
  if (!line.endsWith(";")) {
    // The value ran onto the next line, which is how the engine bundle's
    // trailing newline first showed up here.
    throw new Error("var " + name + " is not one line ending in ';'");
  }
  const text = line.slice(("var " + name + " = ").length, -1);
  try {
    return JSON.parse(text);
  } catch (e) {
    // Without this the whole 120 KB bundle lands in the terminal.
    throw new Error("var " + name + " is not valid JSON: " + e.message);
  }
};

check("it is one HTML document",
      html.startsWith("<!doctype html>") && html.trim().endsWith("</html>"));
check("the title carries through", html.includes("<title>Bean Jump</title>"));

check("the kaypy engine is inlined", /var ENGINE = \{/.test(html));
check("and it is the whole package, not a file or two",
      Object.keys(declared("ENGINE")).length > 20,
      Object.keys(declared("ENGINE")).length + " files");
check("runtime.js's Python bootstrap is inlined", html.includes("var BOOTSTRAP = "));
check("the program is inlined", html.includes("var PROGRAM = "));

/* The old exporter had to rewrite every asset path into a data: URI, because
   Kaplay fetched assets over HTTP. kaypy opens them as files, so the program
   goes in untouched — which means the file a student opens contains the code
   they wrote. */
const program = declared("PROGRAM");
check("the student's program is carried unchanged", program === GAME);
check("so it still names its sprites by path, not by data URI",
      program.includes('"images/bean.png"') && !program.includes("data:image"));

// ------------------------------------------- the assets, and where they land
const assets = declared("ASSETS");
check("exactly the named assets are carried",
      JSON.stringify(Object.keys(assets).sort()) ===
      '["images/bean.png","images/ghosty.png","sounds/ding.wav"]',
      Object.keys(assets).join(" "));
check("unused assets were NOT carried", !html.includes("images/watermelon.png"));
check("they are carried as bytes, not as paths",
      Object.values(assets).every((v) => /^[A-Za-z0-9+/=]+$/.test(v) && v.length > 100));
check("a PNG decodes to a PNG",
      Buffer.from(assets["images/bean.png"], "base64").slice(1, 4).toString() === "PNG");
check("a WAV decodes to a WAV",
      Buffer.from(assets["sounds/ding.wav"], "base64").slice(0, 4).toString() === "RIFF");

/* The one that matters. The program says "images/bean.png"; the page must put
   a file exactly there, relative to the directory the program is run from. */
check("assets are written under the program's working directory",
      html.includes("writeFile(py, '/project/' + path"),
      "/project is what _pyide_run_game chdirs into");
const bootstrapSrc = globalThis.window.PyIDERuntime.BOOTSTRAP;
check("and that directory is the one the bootstrap actually uses",
      bootstrapSrc.includes("PROJECT_DIR = '/project'"));
check("the engine goes where the import will look for it",
      html.includes("'/lib/kaplay/' + rel") && html.includes("sys.path.insert(0, '/lib')"));

// ------------------------------------------------------------ running it
/* Against the CALL, not the name: the inlined bootstrap mentions
   _pyide_run_game in its own source, hundreds of lines before the boot code,
   so looking for the name alone answers a different question than it appears
   to and answers it wrongly. */
check("pygame-ce is loaded before anything needs it",
      html.indexOf("loadPackage('pygame-ce')")
      < html.indexOf("_pyide_run_game(_pyide_source)"));
check("the canvas has the id SDL insists on", /<canvas[^>]+id="canvas"/.test(html));
check("and is handed over with setCanvas2D", html.includes("py.canvas.setCanvas2D(canvas)"));
check("the unwind guard is set, or SDL's loop is fatal",
      html.includes("_skip_unwind_fatal_error"));
check("the setup and the frame loop are run separately",
      html.includes("_pyide_run_game(_pyide_source)") &&
      html.includes("await _pyide_drive_game()"));
check("the loop is awaited, not fired and forgotten",
      /await py\.runPythonAsync\('await _pyide_drive_game\(\)'\)/.test(html));
check("the frame loop only runs if the setup succeeded",
      /status === 'ok'[\s\S]{0,120}_pyide_drive_game/.test(html));

// -------------------------------------------------------- showing failures
check("it shows errors rather than failing silently", html.includes('id="error"'));
check("a later error still reaches the screen",
      html.includes("py.setStderr") && /setStderr[\s\S]{0,120}fail\(/.test(html));
check("errors accumulate rather than replacing each other",
      html.includes("errorEl.textContent += message"));
check("print() from a game has somewhere to go",
      html.includes("py.setStdout") && html.includes('id="log"'));
/* The bootstrap's input() asks the page for an inline input line. There is no
   editor in an exported game, and reading a property that was never defined
   would raise inside Python rather than fall back to prompt(). */
check("input() falls back to prompt rather than raising",
      html.includes("window.__pyide_inline = false"));

// ------------------------------------------------- nothing left to fetch
const externalSrc = [...html.matchAll(/src="(https?:[^"]+)"/g)].map((m) => m[1]);
check("the only external reference is Pyodide",
      externalSrc.length === 1 && externalSrc[0].includes("pyodide"),
      externalSrc.join(", ") || "none");
check("every external script is HTTPS",
      externalSrc.every((u) => u.startsWith("https://")), externalSrc.join(", "));
check("no asset is left as a relative URL to fetch",
      !/src="(?!https?:)[^"]*\.(png|wav)"/.test(html));

/* What matters is that nothing inside a block can END the block: the HTML
   parser stops at the first "</script", string literal or not. Counting
   "<script" is meaningless because the inlined content may contain one. */
const closers = (html.match(/<\/script>/g) || []).length;
check("exactly two script blocks are closed", closers === 2, closers + " closers");
check("nothing inlined can end a block early",
      X.safeInline("var s = '<\/script>';") === "var s = '<\\/script>';");
const inlineStart = html.indexOf("<script>") + "<script>".length;
check("and the real inlined content does not contain one",
      !html.slice(inlineStart, html.indexOf("<\/script>", inlineStart)).includes("<\/script"));

// ------------------------------------------------- nothing from the old one
/* The JavaScript engine and its Python bridge are still on disk, because this
   exporter was the last thing using them. Nothing may reach for them again. */
for (const dead of ["kaplay.js", "__pyideCanvas", "__pyideAssetRoot", "var BRIDGE"]) {
  check("no trace of the old exporter: " + dead, !html.includes(dead));
}

console.log();
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} FAILED`
                   : `ALL PASSED (${results.length} checks)`);
process.exit(failed ? 1 : 0);
