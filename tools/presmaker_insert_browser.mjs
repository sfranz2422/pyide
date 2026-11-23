// Driven by tools/test_presmaker_insert.py: opens a tutorial in the library's
// editor (PresMaker) as its teacher and uses Insert ▾ → Try It step, with
// nothing selected and with a selection — a Python tutorial and a web one —
// and checks a Try It box in the preview with the real Python.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const chromePath = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pm-insert-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + prof, "--no-first-run"], { stdio: "ignore" });
const out = {};
try {
  let url;
  for (let k = 0; k < 75 && !url; k++) {
    await sleep(200);
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) { /* not up yet */ }
  }
  const ws = new WebSocket(url);
  await new Promise((r) => ws.on("open", r));
  let id = 0; const waiting = {};
  ws.on("message", (m) => { const d = JSON.parse(m); if (d.id && waiting[d.id]) { waiting[d.id](d); delete waiting[d.id]; } });
  const send = (method, params = {}, sessionId) => new Promise((r) => {
    const i = ++id; waiting[i] = (d) => r(d.result || {}); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  async function open(page) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Network.enable", {}, S);
    await send("Network.setCookie", { name: "session", value: cfg.cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev("!!document.querySelector('.CodeMirror') && !!document.querySelector('[data-cmd=\"editor-pop\"]')")) break; }
    await sleep(500);
    return ev;
  }
  const cm = "document.querySelector('.CodeMirror').CodeMirror";
  async function inserts(ev) {
    const r = {};
    r.menuItem = await ev("(document.querySelector('[data-cmd=\"editor-pop\"]') || {}).textContent || ''");
    // Nothing selected: a whole step, at the end.
    await ev(`${cm}.setValue('# Notes\\n\\nSome words.'); ${cm}.setCursor({line: 2, ch: 11})`);
    await ev("document.getElementById('b-insert').click()");
    await ev("document.querySelector('[data-cmd=\"editor-pop\"]').click()");
    await sleep(200);
    r.inserted = await ev(`${cm}.getValue()`);
    r.selected = await ev(`${cm}.getSelection()`);
    // A selection: wrapped.
    await ev(`${cm}.setValue('# Notes\\n\\nType x = 1 now.\\n'); ${cm}.setSelection({line: 2, ch: 0}, {line: 2, ch: 15})`);
    await ev("document.getElementById('b-insert').click()");
    await ev("document.querySelector('[data-cmd=\"editor-pop\"]').click()");
    await sleep(200);
    r.wrapped = await ev(`${cm}.getValue()`);
    return r;
  }
  const ev = await open(cfg.page);
  Object.assign(out, await inserts(ev));
  // The preview: a Try It box there is checked with a Python of the page's own.
  await ev(`${cm}.setValue('# Notes\\n\\n:::pop\\nType it.\\n:::\\n\\n\x60\x60\x60tests try\\nprints hello\\nuses print\\n\x60\x60\x60\\n')`);
  // The preview is drawn again a moment after an edit (PresMaker's redraw): wait for that.
  for (let k = 0; k < 50 && !(await ev("!!document.querySelector('#stage .try-step .tests-run')")); k++) await sleep(200);
  await sleep(1500);
  out.previewButton = await ev("(function(){ var b=document.querySelector('#stage .try-step .tests-run'); return !!b && !b.hidden; })()");
  await ev("document.querySelector('#stage .try-step').setAttribute('data-mark', '1'); true");
  await ev("(function(){ var a=document.querySelector('#stage .try-step .try-code'); a.value='print(\"hello\")'; a.dispatchEvent(new Event('input')); document.querySelector('#stage .try-step .tests-run').click(); return 1; })()");
  for (let k = 0; k < 300; k++) { await sleep(300); if (await ev("[...document.querySelectorAll('#stage .try-step .tests-mark')].every(m => m.textContent === '✓' || m.textContent === '✗')")) break; }
  out.previewMarks = await ev("[...document.querySelectorAll('#stage .try-step .tests-mark')].map(m => m.textContent).join('')");
  for (let k = 0; k < 100 && !(await ev("/hello/.test((document.querySelector('#stage .try-step .try-out')||{}).textContent||'')")); k++) await sleep(300);
  out.previewOut = await ev("(document.querySelector('#stage .try-step .try-out')||{}).textContent || ''");
  // A web tutorial: its tests don't know `try`, so the v12 editor pop-up.
  const web = await open(cfg.web);
  out.web = await inserts(web);
  out.webPreview = await web("!!document.querySelector('script[src*=\"try_preview.js\"]')");
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
