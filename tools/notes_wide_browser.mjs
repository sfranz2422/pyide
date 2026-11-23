// Driven by tools/test_notes_wide_browser.py: reading slides fill the
// screen until the first slide with work in main.py (notes.js `wide`).
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

const port = 9600 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "notes-wide-"));
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
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev("!!document.querySelector('.slide-nav .slide-btn')")) break; }
    ev.shot = async (name) => {
      if (!process.env.WIDE_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.WIDE_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  const STATE = `(function(){ var vis = function(sel){ var e=document.querySelector(sel); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; };
    var nb = document.querySelector('#notes-view .notes-body');
    return { wide: document.body.classList.contains('notes-wide'), editor: vis('.pane-editor'), output: vis('.pane-right'),
             notesW: Math.round(document.getElementById('notes-view').getBoundingClientRect().width),
             font: parseFloat(getComputedStyle(nb).fontSize), hide: vis('#notes-close'),
             lines: document.querySelectorAll('.pane-editor .CodeMirror-line').length,
             slide: (document.querySelector('.slide-pos')||{}).textContent }; })()`;
  const NEXT = "(function(){ var b=[...document.querySelectorAll('.slide-nav .slide-btn')].find(b=>b.textContent.trim()==='▶'); b.click(); return true; })()";
  const PREV = "(function(){ var b=[...document.querySelectorAll('.slide-nav .slide-btn')].find(b=>b.textContent.trim()==='◀'); b.click(); return true; })()";
  const s = await open(cfg.student, cfg.page);
  await sleep(800);
  out.s1 = await s(STATE); await s.shot("1-reading");
  await s(NEXT); await sleep(600); out.s2 = await s(STATE);
  // Code changed while the editor is hidden (a draft, a rescue): it must be drawn when it's back.
  await s("document.querySelector('.pane-editor .CodeMirror').CodeMirror.setValue(Array.from({length: 12}, (_, i) => 'print(' + i + ')').join('\\n')); true");
  await s(NEXT); await sleep(800); out.s3 = await s(STATE); await s.shot("3-warmup");
  await s(NEXT); await sleep(600); out.s4 = await s(STATE);
  for (let k = 0; k < 3; k++) { await s(PREV); await sleep(400); }
  out.back = await s(STATE);
  // The class's live page, pinned to the teacher's slide.
  const LSTATE = `(function(){ var vis = function(sel){ var e=document.querySelector(sel); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; };
    return { wide: document.body.classList.contains('notes-wide'), mine: vis('#mine + .CodeMirror, .live-left .editor-wrap'),
             mirror: vis('.live-mirror'), notesW: Math.round(document.getElementById('live-notes-view').getBoundingClientRect().width),
             lines: document.getElementById('mine').nextElementSibling.querySelectorAll('.CodeMirror-line').length }; })()`;
  const move = (slide, v, code) => fs.appendFileSync(cfg.moves, (code || "wide01") + ":" + slide + "@" + v + "\n");
  const L = await open(cfg.student, cfg.live);
  for (let k = 0; k < 60 && !(await L("!!document.querySelector('#live-notes .slide-nav, .slide-nav')")); k++) await sleep(200);
  await sleep(1500);
  out.live1 = await L(LSTATE); await L.shot("4-live-reading");
  await L("document.getElementById('mine').nextElementSibling.CodeMirror.setValue(Array.from({length: 20}, (_, i) => 'x = ' + i).join('\\n')); true");
  move("3/4", 2);
  for (let k = 0; k < 40 && (await L("document.body.classList.contains('notes-wide')")); k++) await sleep(250);
  await sleep(800);
  out.live3 = await L(LSTATE); await L.shot("5-live-warmup");
  move("1/4", 3);
  for (let k = 0; k < 40 && !(await L("document.body.classList.contains('notes-wide')")); k++) await sleep(250);
  out.live1again = await L(LSTATE);
  for (const kind of ["web", "flask"]) {
    const code = cfg.lives[kind], W = await open(cfg.student, "/live/" + code), o = out["live_" + kind] = {};
    for (let k = 0; k < 60 && !(await W("!!document.querySelector('.slide-nav')")); k++) await sleep(200);
    await sleep(1500);
    o.one = await W(LSTATE);
    await W("document.getElementById('mine').nextElementSibling.CodeMirror.setValue(Array.from({length: 20}, (_, i) => 'x' + i).join('\\n')); true");
    move("3/4", 2, code);
    for (let k = 0; k < 40 && (await W("document.body.classList.contains('notes-wide')")); k++) await sleep(250);
    await sleep(800);
    o.three = await W(LSTATE);
  }
  const p = await open(cfg.student, cfg.plain);
  await sleep(800);
  out.plain = await p(STATE);
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* still closing */ }
}
console.log(JSON.stringify(out));
process.exit(0);
