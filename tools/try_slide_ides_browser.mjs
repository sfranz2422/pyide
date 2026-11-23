// Driven by tools/test_try_slide_ides_browser.py: a Try It box on the slide
// in a web, Flask, SQL and PHP lesson, checked by each one's real runner.
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

const port = 9900 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "try-ides-"));
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
  async function open(cookie, page) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Network.enable", {}, S);
    if (cookie) await send("Network.setCookie", { name: "session", value: cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev("!!document.querySelector('.try-step')")) break; }
    ev.shot = async (name) => {
      if (!process.env.TRYIDE_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.TRYIDE_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  const until = async (ev, expr, ms) => { for (let k = 0; k < (ms || 6000) / 100; k++) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const type = (text) => `(function(){ var a=document.querySelector('.try-step .try-code'); a.focus(); a.value=${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); return true; })()`;
  const press = "(function(){ var b=document.querySelector('.try-step .tests-run'); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()";
  const marks = "[...document.querySelectorAll('.try-step .tests-mark')].map(m => m.textContent).join('')";
  const done = `/^[✓✗]+$/.test(${marks})`;
  const close = "(function(){ var b=document.querySelector('.hint-panel:not([hidden]) .hint-close'); if(b) b.click(); return true; })()";
  const SHOWN = "(function(){ var o=document.querySelector('.try-step .try-out'); if (!o) return ''; var f=o.querySelector('iframe'); return o.textContent + (f ? f.srcdoc : ''); })()";
  for (const [name, k] of Object.entries(cfg.kinds)) {
    const o = out[name] = {};
    try {
      const ev = await open(cfg.student, k.page);
      o.box = await ev("!!document.querySelector('.try-step .try-code') && !!document.querySelector('.try-step .tests-run')");
      await ev(type(k.wrong));
      await until(ev, press, 30000);
      await ev(press);
      await until(ev, done, 180000);
      o.wrongMarks = await ev(marks);
      await ev(close);
      await ev(type(k.right));
      await ev(`document.querySelector('.try-step .try-out').textContent = ''; true`);
      await until(ev, press, 30000);
      await ev(press);
      await until(ev, `/^✓+$/.test(${marks})`, 120000);
      o.rightMarks = await ev(marks);
      await until(ev, `(${SHOWN}).indexOf(${JSON.stringify(k.shows)}) >= 0`, 60000);
      o.shown = await ev(SHOWN);
      await ev(close);
      await ev.shot(name);
      if (k.live) {
        const L = await open(cfg.student, k.live);
        const lo = o.live = {};
        await until(L, "!!document.querySelector('.try-step .try-code')", 30000);
        await L(type(k.right));
        await until(L, press, 60000);
        await L(press);
        await until(L, `/^✓+$/.test(${marks})`, 180000);
        lo.rightMarks = await L(marks);
        await until(L, `(${SHOWN}).indexOf(${JSON.stringify(k.shows)}) >= 0`, 60000);
        lo.shown = await L(SHOWN);
        await L.shot(name + "-live");
      }
    } catch (e) { o.error = String(e && e.stack || e); }
  }
  // The JavaScript unit: a box that starts with the lesson's page.
  {
    const j = out.jsStart = {};
    const ev = await open(cfg.student, cfg.jsStart);
    j.startShown = await ev("[...document.querySelectorAll('.notes-body pre, .notes-body code')].some(e => /Arcade Night/.test(e.textContent))");
    await ev("document.querySelector('.try-step .try-code').focus(); true");
    j.value = await ev("document.querySelector('.try-step .try-code').value");
    j.caretLine = await ev("(function(){ var a=document.querySelector('.try-step .try-code'); var v=a.value, p=a.selectionStart; var s=v.lastIndexOf('\\n', p-1)+1, e=v.indexOf('\\n', p); return v.slice(s, e < 0 ? v.length : e); })()");
    await ev("(function(){ var a=document.querySelector('.try-step .try-code'); a.setRangeText('document.querySelector(\".game\").textContent = \"Pac-Man\"; console.log(\"changed it\");', a.selectionStart, a.selectionEnd, 'end'); a.dispatchEvent(new Event('input')); return 1; })()");
    j.typed = await ev("document.querySelector('.try-step .try-code').value");
    await until(ev, press, 30000);
    await ev(press);
    await until(ev, done, 60000);
    j.marks = await ev(marks);
    await until(ev, "!!document.querySelector('.try-step .try-console:not([hidden])')", 8000);
    j.styled = await ev("(function(){ var f=document.querySelector('.try-step .try-out iframe'); return !!f && f.srcdoc.indexOf('STYLE-MARK') >= 0; })()");
    j.console = await ev("(document.querySelector('.try-step .try-console-lines')||{}).textContent || ''");
    await ev(close);
    await ev("(function(){ var b=[...document.querySelectorAll('.slide-nav .slide-btn')].find(b=>b.textContent.trim()==='▶'); b.click(); return 1; })()");
    await sleep(800);
    await ev("document.querySelector('.try-step .try-code').focus(); true");
    j.next = await ev("document.querySelector('.try-step .try-code').value");
  }
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* still closing */ }
}
console.log(JSON.stringify(out));
process.exit(0);
