// Driven by tools/test_teacher_nav.py: the teacher's nav in Chrome — each page
// still reaches its bottom under the taller header, and the Teacher slides
// menu opens and closes. NAV_SHOTS=<dir> saves a screenshot of each page.
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

const port = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "teacher-nav-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + prof, "--no-first-run", "--window-size=1280,800"], { stdio: "ignore" });
const out = { pages: {} };
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, S);
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
  const go = async (u) => {
    await send("Page.navigate", { url: cfg.base + u }, S);
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev("document.readyState === 'complete' && !!document.querySelector('.sheet')")) break; }
    await sleep(300);
  };
  const shot = async (name) => {
    if (!cfg.shots) return;
    const { data } = await send("Page.captureScreenshot", { format: "png" }, S);
    fs.writeFileSync(path.join(cfg.shots, name + ".png"), Buffer.from(data, "base64"));
  };
  for (const [name, u] of Object.entries(cfg.pages)) {
    await go(u);
    await shot(name);
    // The sheet must end inside the window (not pushed under its bottom by
    // the taller header), and scrolling it must reach its last element.
    out.pages[name] = await ev(`(() => {
      const s = document.querySelector('.sheet'), r = s.getBoundingClientRect();
      const fits = r.bottom <= innerHeight + 1;
      s.scrollTop = s.scrollHeight;
      const last = s.lastElementChild && s.lastElementChild.getBoundingClientRect();
      return { fits, bottom: Math.round(r.bottom), win: innerHeight, scrolls: s.scrollHeight > s.clientHeight,
               reached: !last || last.bottom <= innerHeight + 1 };
    })()`);
  }
  await go(cfg.pages.assignment);
  await ev("document.querySelector('#deck-menu > summary').click()");
  await sleep(100);
  out.menu = { opened: await ev("document.getElementById('deck-menu').open === true") };
  await shot("assignment-menu");
  await ev("document.querySelector('.sheet').click()");
  await sleep(100);
  out.menu.closed = await ev("document.getElementById('deck-menu').open === false");
  await ev("document.querySelector('#deck-menu > summary').click()");
  await sleep(100);
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(100);
  out.menu.escaped = await ev("document.getElementById('deck-menu').open === false");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  console.log(JSON.stringify(out));
  process.exit(0);
}
