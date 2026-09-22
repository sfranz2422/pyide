/* Build an exported game the way the browser would, and inspect the result.
 *
 *     node tools/test_export.mjs
 *
 * export.js runs in a page and uses fetch(), so this supplies a fetch that
 * reads from static/ instead. Everything else is the real module, filling in
 * the real page template out of the real engine bundle.
 *
 * WHAT THIS CHECKS
 *
 * That the file is one self-contained document, that it carries the engine,
 * the program and exactly the assets the program names, that nothing inside a
 * <script> block can end the block early, and that what it writes into
 * Pyodide's filesystem lines up with what the program will look for.
 *
 * And that the page is kaypy's rather than this repo's — because the moment
 * PyIDE starts writing its own HTML again, a game downloaded from school and
 * a game built at home with `kaypy web` stop being the same thing, and the
 * difference shows up as "it works in class but not on my laptop".
 *
 * WHAT IT CANNOT
 *
 * Whether the exported page plays. That needs a browser, Pyodide and
 * pygame-ce from a CDN, and a pair of eyes. tools/test_export_runs.py takes
 * the page apart and runs what is inside it, which is as close as this gets.
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
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    };
  } catch {
    return { ok: false, text: async () => "", json: async () => ({}),
             arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.window = {};
globalThis.document = { createElement: () => ({ style: {} }) };

new Function("window", "document", "fetch", "btoa",
             readFileSync(join(ROOT, "static", "export.js"), "utf8"))
  (globalThis.window, globalThis.document, globalThis.fetch, globalThis.btoa);

const X = globalThis.window.PyIDEExport;
check("export.js loaded", !!X && typeof X.buildGamePage === "function");

const bundle = JSON.parse(
  readFileSync(join(ROOT, "static", "py", "kaypy_bundle.json"), "utf8"));
check("the vendored engine carries kaypy's page template",
      typeof bundle["web_page.html"] === "string",
      "run tools/vendor_kaypy.py if this fails");
check("and the runner the page calls", typeof bundle["webrun.py"] === "string");

const GAME = `from kaypy import *

kaypy(width=640, height=480, background=[24, 24, 40])
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
            sliceX=9, anims={"idle": {"from": 0, "to": 3}})`;
check("it finds dungeon sprites too",
      JSON.stringify(X.referencedAssets(DUNGEON)) === '["dungeon/dwarf_f.png"]',
      X.referencedAssets(DUNGEON).join(" "));

/* A sprite atlas is loaded by bare filename, with no folder in front of it —
   the one asset path in the whole editor that looks like nothing in
   particular. Missed by the exporter, a downloaded game would look for a file
   that was never carried. */
const ATLAS = `loadSpriteAtlas("dungeon.png", {"wall": {"x": 16, "y": 16}})`;
check("it finds a sprite atlas loaded by bare filename",
      JSON.stringify(X.referencedAssets(ATLAS)) === '["dungeon.png"]',
      X.referencedAssets(ATLAS).join(" "));

/* The editor and the exporter must agree about what an asset path looks like.
   If they drift, a game works on Run and not after Download — found by the
   student, at home, with nobody to ask. */
const patternIn = (file) =>
  /var ASSET_RE =\s*(\/[\s\S]+?\/g);/.exec(
    readFileSync(join(ROOT, "static", file), "utf8"))[1];
check("the editor and the exporter look for the same paths",
      patternIn("game.js") === patternIn("export.js"),
      patternIn("game.js") === patternIn("export.js") ? "" : "they have drifted");

// --------------------------------------------------------- the canvas size
check("it reads the size out of kaypy()",
      JSON.stringify(X.canvasSize(GAME)) === '{"width":640,"height":480}',
      JSON.stringify(X.canvasSize(GAME)));
check("and falls back to kaypy's own default when it cannot",
      JSON.stringify(X.canvasSize("from kaypy import *\nkaypy()\n")) ===
      '{"width":800,"height":600}');

// ------------------------------------------------------------ the document
const html = await X.buildGamePage(GAME, "Bean Jump");
console.log("\n  exported size: %s KB\n", (html.length / 1024).toFixed(0));

/* Each `var NAME = ...;` is written on its own line, so the value is read
   back by line — a regex across the document runs straight past the end of
   the object, because the engine's own source contains "};" inside strings. */
const declared = (name) => {
  const line = html.split("\n").find((l) => l.startsWith("var " + name + " = "));
  if (!line) throw new Error("the export declares no " + name);
  if (!line.endsWith(";")) throw new Error("var " + name + " is not one line");
  try {
    return JSON.parse(line.slice(("var " + name + " = ").length, -1));
  } catch (e) {
    throw new Error("var " + name + " is not valid JSON: " + e.message);
  }
};

check("it is one HTML document",
      html.startsWith("<!doctype html>") && html.trim().endsWith("</html>"));
check("the title carries through", html.includes("<title>Bean Jump</title>"));
check("the canvas starts at the size the program asked for",
      html.includes('width="640" height="480"'));

// ------------------------------------------- it is kaypy's page, not ours
const template = bundle["web_page.html"];
check("the page is kaypy's template, filled in",
      html.includes("A kaypy game, as one file."),
      "the comment at the top of web_page.html");
check("export.js writes no HTML of its own",
      !/["'`]<!doctype/i.test(readFileSync(join(ROOT, "static", "export.js"), "utf8")),
      "no doctype anywhere in the module");
/* The strongest form of it: everything outside the four filled slots should
   be the template unchanged. */
const stripped = html.split("\n")
  .filter((l) => !/^var (ENGINE|ASSETS|PROGRAM) = /.test(l)).join("\n");
const templateStripped = template.split("\n")
  .filter((l) => !/^var (ENGINE|ASSETS|PROGRAM) = /.test(l)).join("\n")
  .replace("__TITLE__", "Bean Jump")
  .replace("__WIDTH__", "640").replace("__HEIGHT__", "480")
  .replace(/__PYODIDE__/g, "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/");
check("and changes nothing else about it", stripped === templateStripped,
      stripped === templateStripped ? "" : "the page has drifted from the template");

// ------------------------------------------------------------- the pieces
const engine = declared("ENGINE");
const assets = declared("ASSETS");
const program = declared("PROGRAM");

check("the engine is the whole package", Object.keys(engine).length > 20,
      Object.keys(engine).length + " files");
check("including the runner the page calls", "webrun.py" in engine);
check("and only Python, like kaypy's own build",
      Object.keys(engine).every((n) => n.endsWith(".py")),
      Object.keys(engine).filter((n) => !n.endsWith(".py")).join(", ") || "");

/* kaypy opens assets as files, so the program goes in untouched — which means
   the file a student opens contains the code they wrote. */
check("the student's program is carried unchanged", program === GAME);
check("so it still names its sprites by path, not by data URI",
      program.includes('"images/bean.png"') && !program.includes("data:image"));

check("exactly the named assets are carried",
      JSON.stringify(Object.keys(assets).sort()) ===
      '["images/bean.png","images/ghosty.png","sounds/ding.wav"]',
      Object.keys(assets).join(" "));
check("unused assets were NOT carried", !html.includes("images/watermelon.png"));
check("a PNG decodes to a PNG",
      Buffer.from(assets["images/bean.png"], "base64").slice(1, 4).toString() === "PNG");
check("a WAV decodes to a WAV",
      Buffer.from(assets["sounds/ding.wav"], "base64").slice(0, 4).toString() === "RIFF");

// -------------------------------- the self-referential replacement bug
/* The engine carries kaypy's webbuild.py, whose source contains the literal
   "__ASSETS__" — it is the module that defines the slots. Filling them one at
   a time replaced that mention too, corrupting a Python string inside a JSON
   string: the page looked plausible and the JSON no longer parsed. */
check("the engine's own source survived being embedded",
      (engine["webbuild.py"] || "").includes("__ASSETS__"),
      "the slot names in webbuild.py are still the slot names");
const elsewhere = html.split("\n")
  .filter((l) => !l.startsWith("var ENGINE = ")).join("\n");
check("and no slot was left unfilled",
      !/__(TITLE|WIDTH|HEIGHT|PYODIDE|ENGINE|ASSETS|PROGRAM)__/.test(elsewhere));

// --------------------------------------------------- nothing left to fetch
const externalSrc = [...html.matchAll(/src="(https?:[^"]+)"/g)].map((m) => m[1]);
check("the only external reference is Pyodide",
      externalSrc.length === 1 && externalSrc[0].includes("pyodide"),
      externalSrc.join(", ") || "none");
check("every external script is HTTPS",
      externalSrc.every((u) => u.startsWith("https://")));
check("no asset is left as a relative URL to fetch",
      !/src="(?!https?:)[^"]*\.(png|wav)"/.test(html));

const closers = (html.match(/<\/script>/g) || []).length;
check("exactly two script blocks are closed", closers === 2, closers + " closers");
/* The property, not a hand-escaped literal of it — counting backslashes in a
   test that exists because of backslashes is how you get a passing test of
   the wrong thing. What matters is only this: what comes out can never
   contain the sequence that ends a script block. */
const escaped = X.js("var s = '<\/script>'; // <\/SCRIPT");
check("nothing inlined can end a block early",
      !/<\/script/i.test(escaped) && escaped.includes("<\\/script"),
      escaped);
const inlineStart = html.indexOf("<script>") + "<script>".length;
check("and the real inlined content does not contain one",
      !html.slice(inlineStart, html.indexOf("<\/script>", inlineStart)).includes("<\/script"));

// ------------------------------------------------- nothing from the old one
for (const dead of ["kaplay.js", "__pyideCanvas", "__pyideAssetRoot",
                    "var BRIDGE", "var BOOTSTRAP"]) {
  check("no trace of the old exporter: " + dead, !html.includes(dead));
}

console.log();
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} FAILED`
                   : `ALL PASSED (${results.length} checks)`);
process.exit(failed ? 1 : 0);
