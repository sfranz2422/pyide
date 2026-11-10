// Driven by tools/test_quiz_browser.py: opens an assignment as the student,
// clicks a find-the-bug line with a real mouse while the server is still
// holding back their earlier answers, then waits for those to arrive.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-browser-"));
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
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
  // Time how long the answers take to come back, from the page itself.
  await send("Page.enable", {}, S);
  await send("Page.addScriptToEvaluateOnNewDocument", { source:
    "(function(){var f=window.fetch;window.__mine=null;window.fetch=function(u){var t=Date.now();var p=f.apply(this,arguments);" +
    "if(String(u).indexOf('/mine')>=0)p.then(function(){window.__mine=(Date.now()-t)/1000;});return p;};})();" }, S);
  await send("Page.navigate", { url: cfg.base + cfg.page }, S);
  const lines = (q) => `[...document.querySelectorAll('.quiz')][${q}].querySelectorAll('.quiz-bug-line')`;
  for (let k = 0; k < 80; k++) { await sleep(100); if (await ev(`${lines(0)}.length > 0`)) break; }
  out.disabledEarly = await ev(`[...${lines(0)}].filter(b => b.disabled).length`);
  // A real click, on the code of line 3, before the answers are back.
  const at = JSON.parse(await ev(`(() => { const b = ${lines(0)}[2]; b.scrollIntoView({block: 'center'});
    const r = b.getBoundingClientRect(); return JSON.stringify({x: r.left + 40, y: r.top + r.height / 2}); })()`));
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 }, S);
  }
  out.answersBackWhenClicked = await ev("window.__mine !== null");
  out.pickedEarly = await ev(`[...${lines(0)}].findIndex(b => b.classList.contains('is-picked')) + 1`);
  for (let k = 0; k < 60; k++) { await sleep(100); if (await ev("window.__mine !== null")) break; }
  await sleep(300);
  out.waited = await ev("window.__mine");
  out.pickedLater = await ev(`[...${lines(0)}].findIndex(b => b.classList.contains('is-picked')) + 1`);
  out.secondLocked = await ev(`[...${lines(1)}].every(b => b.disabled)`);
  out.secondResult = await ev(`/Correct|Not quite/.test([...document.querySelectorAll('.quiz')][1].textContent)`);
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
