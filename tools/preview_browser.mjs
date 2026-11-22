// Driven by tools/test_preview_browser.py: a teacher's Student preview in
// Chrome — the bar, a student's page from the start, nothing kept.
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

const port = 9700 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "preview-browser-"));
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
  await send("Network.setCookie", { name: "session", value: cfg.teacher, url: cfg.base }, S);
  await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
  await send("Page.enable", {}, S);
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
  const go = async (u, ready) => {
    await send("Page.navigate", { url: cfg.base + u }, S);
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev(`!!document.querySelector(${JSON.stringify(ready)})`)) break; }
    await sleep(1200);
  };
  const shot = async (name) => {
    if (!process.env.PREVIEW_SHOT) return;
    const r = await send("Page.captureScreenshot", { format: "png" }, S);
    fs.writeFileSync(path.join(process.env.PREVIEW_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
  };

  // The assignment's page: the button.
  await go(cfg.details, "#student-preview");
  out.button = await ev("(document.querySelector('#student-preview')||{}).getAttribute && document.querySelector('#student-preview').getAttribute('href')");
  // The teacher's real storage, which the preview must not see or touch.
  await ev("localStorage.setItem('pyide-mine', 'kept'); true");

  await go(cfg.preview, ".preview-bar");
  out.bar = await ev("document.querySelector('.preview-bar').innerText");
  out.exit = await ev("document.querySelector('#preview-exit').getAttribute('href')");
  out.seesReal = await ev("localStorage.getItem('pyide-mine')");
  out.authoring = await ev("window.PYIDE.authoring");
  out.teacherUi = await ev("!!document.querySelector('#go-live, .js-go-live, #publish')");
  out.slide = await ev("(document.querySelector('.slide-count, .slides-count, .slide-of')||{}).textContent || ''");
  out.code = await ev("document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror.getValue()");
  out.fitsWindow = await ev("document.documentElement.scrollHeight <= window.innerHeight + 2");
  await shot("1-preview");
  // Do things a student would: storage written, a slide opened.
  await ev("localStorage.setItem('pyide-unlocked:x', '1'); document.querySelector('.CodeMirror').CodeMirror.setValue('print(1)'); true");
  // Start over: everything as a first visit again.
  await go(cfg.preview, ".preview-bar");
  out.fresh = { stored: await ev("localStorage.getItem('pyide-unlocked:x')"),
                code: await ev("document.querySelector('.CodeMirror').CodeMirror.getValue()") };
  // Levels: Master's boxes when Master is picked.
  await go(cfg.preview + "?level=master", ".preview-bar");
  await sleep(800);
  out.master = { picked: await ev("document.querySelector('#preview-level') && document.querySelector('#preview-level').value"),
                 shown: await ev("[...document.querySelectorAll('.level-part')].filter(b => !b.hidden && b.getAttribute('data-level')).map(b => b.getAttribute('data-level'))") };
  // Back out: the real storage is just as it was.
  await go(cfg.details, "#student-preview");
  out.realAfter = await ev("localStorage.getItem('pyide-mine') + '|' + localStorage.getItem('pyide-unlocked:x')");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
}
console.log(JSON.stringify(out));
process.exit(0);
