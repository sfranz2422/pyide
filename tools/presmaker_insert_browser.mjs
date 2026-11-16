// Driven by tools/test_presmaker_insert.py: opens a tutorial in the library's
// editor (PresMaker) as its teacher and uses Insert ▾ → Editor pop-up, with
// nothing selected and with a selection.
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
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Network.enable", {}, S);
  await send("Network.setCookie", { name: "session", value: cfg.cookie, url: cfg.base }, S);
  await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
  await send("Page.enable", {}, S);
  await send("Page.navigate", { url: cfg.base + cfg.page }, S);
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
  for (let k = 0; k < 100; k++) { await sleep(100); if (await ev("!!document.querySelector('.CodeMirror') && !!document.querySelector('[data-cmd=\"editor-pop\"]')")) break; }
  await sleep(500);
  const cm = "document.querySelector('.CodeMirror').CodeMirror";
  out.menuItem = await ev("(document.querySelector('[data-cmd=\"editor-pop\"]') || {}).textContent || ''");
  // Nothing selected: a whole step, at the end.
  await ev(`${cm}.setValue('# Notes\\n\\nSome words.'); ${cm}.setCursor({line: 2, ch: 11})`);
  await ev("document.getElementById('b-insert').click()");
  await ev("document.querySelector('[data-cmd=\"editor-pop\"]').click()");
  await sleep(200);
  out.inserted = await ev(`${cm}.getValue()`);
  out.selected = await ev(`${cm}.getSelection()`);
  // A selection: wrapped.
  await ev(`${cm}.setValue('# Notes\\n\\nType x = 1 now.\\n'); ${cm}.setSelection({line: 2, ch: 0}, {line: 2, ch: 15})`);
  await ev("document.getElementById('b-insert').click()");
  await ev("document.querySelector('[data-cmd=\"editor-pop\"]').click()");
  await sleep(200);
  out.wrapped = await ev(`${cm}.getValue()`);
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
