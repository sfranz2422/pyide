// Driven by tools/test_gradebook_browser.py: the teacher's gradebook in
// Chrome — Check all on a column (the assignment page opened in a small
// window that runs its Check all and tells the gradebook), and a grade typed
// into a cell.
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

const port = 9500 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "gradebook-browser-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + prof, "--no-first-run", "--disable-popup-blocking"], { stdio: "ignore" });
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
  await send("Network.setCookie", { name: "session", value: cfg.teacher, url: cfg.base }, S);
  await send("Page.enable", {}, S);
  await send("Page.navigate", { url: cfg.base + cfg.gradebook }, S);
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
  for (let k = 0; k < 100; k++) { await sleep(100); if (await ev("!!document.querySelector('.gradebook')")) break; }
  const CELL = `document.querySelector('.js-score[data-slug="${cfg.slug}"]')`;
  out.before = { value: await ev(`${CELL}.value`), mark: await ev("!!document.querySelector('.gb-unchecked')") };
  // Check all from the column: a window opens, checks, tells us, closes; we reload.
  await ev(`window.__marker = 1; document.querySelector('.js-checkall[data-slug="${cfg.slug}"]').click()`);
  for (let k = 0; k < 600; k++) {          // Python loads from the CDN in that window: up to two minutes
    await sleep(200);
    const v = await ev("window.__marker === undefined && !!document.querySelector('.gradebook')");
    if (v) break;
  }
  await sleep(500);
  out.after = { value: await ev(`${CELL}.value`), mark: await ev("!!document.querySelector('.gb-unchecked')") };
  // A grade typed into the cell, Enter: saved, and the page shows it.
  await ev(`(() => { const c = ${CELL}; c.focus(); c.value = '3'; c.dispatchEvent(new Event('change')); })()`);
  for (let k = 0; k < 50; k++) { await sleep(200); if ((await ev(`${CELL} && ${CELL}.value`)) === "3" && (await ev("document.readyState")) === "complete" && (await ev("!window.__typed"))) break; }
  await sleep(1500);
  out.typed = await ev(`${CELL}.value`);
  // Hide the column, then open the closed pane at the bottom: its assignments show.
  await ev(`document.querySelector('th.gb-col .js-hide').click()`);
  for (let k = 0; k < 50; k++) { await sleep(200); if (await ev("!!document.querySelector('details.gb-hidden')")) break; }
  await sleep(500);
  out.hiddenClosed = await ev("(() => { const li = document.querySelector('.gb-hidden-list li'); return li ? !li.checkVisibility() : null; })()");
  await ev("document.querySelector('details.gb-hidden').open = true");
  await sleep(300);
  out.hiddenOpen = await ev("(() => { const li = document.querySelector('.gb-hidden-list li'); if (!li) return null; const r = li.getBoundingClientRect(); return { shown: li.checkVisibility() && r.height > 0, text: li.textContent.trim() }; })()");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  console.log(JSON.stringify(out));
  process.exit(0);
}
