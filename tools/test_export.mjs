/* Build an exported game the way the browser would, and inspect the result.
 *
 *     node tools/test_export.mjs
 *
 * export.js runs in a page and uses fetch(), so this supplies a fetch that
 * reads from static/ instead. Everything else is the real module.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const results = [];
const check = (label, cond, extra = "") => {
  results.push(cond);
  console.log("  %s %s%s", cond ? "ok  " : "FAIL", label.padEnd(52), extra);
};

// a fetch that serves the real files off disk
globalThis.fetch = async (url) => {
  const path = join(ROOT, url.replace(/^\//, ""));
  try {
    const buf = readFileSync(path);
    return {
      ok: true,
      text: async () => buf.toString("utf8"),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    };
  } catch {
    return { ok: false, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
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

const GAME = `from kaplay import *

kaplay(width=800, height=600, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")
loadSprite("ghosty", "images/ghosty.png")
loadSound("ding", "sounds/ding.wav")
setGravity(1600)

player = add([sprite("bean"), pos(100, 200), area(), body(jumpForce=800), "player"])

def jump():
    if player.isGrounded():
        player.jump(800)
        play("ding")

onKeyPress("space", jump)
onUpdate("enemy", lambda e: e.move(-120, 0))
`;

check("it finds only the assets the program names",
      JSON.stringify(X.referencedAssets(GAME).sort()) ===
      '["images/bean.png","images/ghosty.png","sounds/ding.wav"]',
      X.referencedAssets(GAME).join(" "));

const html = await X.buildGamePage(GAME, "Bean Jump");
console.log("\n  exported size: %s KB\n", (html.length / 1024).toFixed(0));

check("it is one HTML document", html.startsWith("<!doctype html>") && html.trim().endsWith("</html>"));
check("the title carries through", html.includes("<title>Bean Jump</title>"));
check("kaplay.js is inlined, not linked",
      html.includes("kaplay") && !/src="[^"]*kaplay\.js"/.test(html));
check("the Python bridge is inlined", html.includes("var BRIDGE = "));
check("the program is inlined", html.includes("var PROGRAM = "));

// every asset path must have become a data: URI
check("sprite paths became data URIs",
      !html.includes('"images/bean.png"') && html.includes("data:image/png;base64,"));
check("sound paths became data URIs",
      !html.includes('"sounds/ding.wav"') && html.includes("data:audio/wav;base64,"));
/* kaplay.js carries three data URIs of its own, so count only the ones in the
   student's program rather than in the whole document. */
const programLine = html.split("\n").find((l) => l.startsWith("var PROGRAM = "));
check("unused assets were NOT carried",
      !html.includes("images/watermelon.png") &&
      (programLine.match(/data:image\/png;base64,/g) || []).length === 2,
      (programLine.match(/data:image\/png;base64,/g) || []).length + " images in the program");

// the only thing it may fetch at run time is Pyodide
const externalSrc = [...html.matchAll(/src="(https?:[^"]+)"/g)].map((m) => m[1]);
check("the only external reference is Pyodide",
      externalSrc.length === 1 && externalSrc[0].includes("pyodide"),
      externalSrc.join(", ") || "none");

/* What actually matters is that nothing inside a block can END the block: the
   HTML parser stops at the first "</script", string literal or not. Counting
   "<script" is meaningless here because the inlined engine contains one. */
const closers = (html.match(/<\/script>/g) || []).length;
check("exactly three script blocks are closed", closers === 3, closers + " closers");
check("nothing inside a block can end it early",
      X.safeInline("var s = '<\/script>';") === "var s = '<\\/script>';");
check("the inlined engine cannot break out",
      !html.slice(html.indexOf("<script>") + 8,
                  html.indexOf("<\/script>")).includes("<\/script"));

// the page has somewhere to draw and somewhere to complain
check("it has a canvas", /<canvas[^>]+id="game"/.test(html));
check("it shows errors rather than failing silently", html.includes('id="error"'));
check("it hands the canvas to the bridge", html.includes("window.__pyideCanvas = canvas"));
check("a later error still reaches the screen",
      html.includes("py.setStderr") && /setStderr[\s\S]{0,120}fail\(/.test(html));
check("it declares nothing it doesn't use", !html.includes("var errors ="));

/* itch.io hosts a single .html upload directly, and its one rule for anything
   loaded from another domain is that the domain must be HTTPS. Its other
   warning is about absolute paths, which would leave the project's directory
   on their CDN and 403. */
const fetched = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
check("every external script is HTTPS", fetched.every((u) => u.startsWith("https://")),
      fetched.join(", "));
check("the exported game asks for no asset directory",
      html.includes("window.__pyideAssetRoot = ''"));

console.log();
const passed = results.every(Boolean);
console.log(passed ? `ALL PASSED (${results.length} checks)`
                   : `${results.filter((r) => !r).length} of ${results.length} FAILED`);
process.exit(passed ? 0 : 1);
