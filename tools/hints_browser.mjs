// Driven by tools/test_hints_browser.py: the hint panel (hints.js) in a
// student's own editor in Chrome. The page's runner is swapped for one that
// answers set results, so no Python has to load: what's under test is the
// panel, the server's hints and their cost, not the checking.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "hints-browser-"));
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
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev("!!document.querySelector('.tests-card .tests-run') && !!window.IDEHints")) break; }
    await sleep(800);
    ev.shot = async (name) => {
      if (!process.env.HINTS_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.HINTS_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  const until = async (ev, expr, ms) => { for (let k = 0; k < (ms || 6000) / 100; k++) { if (await ev(expr)) return true; await sleep(100); } return false; };
  // The page's checks answer these instead of running Python.
  const answer = (rs) => `window.IDENotesChecks.setRunner(function () { return Promise.resolve({ results: ${JSON.stringify(rs)} }); }); true`;
  const press = "document.querySelector('.tests-card .tests-run').click(); true";
  const PANEL = "(function(){ var p=document.querySelector('.hint-panel'); if(!p||p.hidden) return null; return { title: (p.querySelector('.hint-title')||{}).textContent, why: (p.querySelector('.hint-why')||{}).textContent || '', hints: [...p.querySelectorAll('.hint-text')].map(e=>e.textContent), code: (p.querySelector('.hint-code')||{}).textContent || '', button: (p.querySelector('.hint-go')||{}).textContent || '', centered: (function(){ var r=p.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && Math.abs((r.left+r.right)/2 - innerWidth/2) < 4 && r.width >= 600; })(), dimmed: !!document.querySelector('.hint-backdrop:not([hidden])'), end: (p.querySelector('.hint-end')||{}).textContent || '', pass: p.classList.contains('is-pass') }; })()";
  const go = "document.querySelector('.hint-panel .hint-go').click(); true";

  const s = await open(cfg.student, cfg.page);
  out.before = await s("!document.querySelector('.hint-panel') || document.querySelector('.hint-panel').hidden");
  await s(answer([{ label: "Prints Hello", ok: false, detail: "It printed: Hi" }, { label: "Uses a for loop", ok: true, detail: "" }]));
  await s(press);
  await until(s, "!!document.querySelector('.hint-panel:not([hidden])')");
  out.failed = await s(PANEL);
  await s.shot("1-failed");
  await s(go);
  await until(s, "document.querySelectorAll('.hint-panel .hint-text').length === 1");
  out.hint1 = await s(PANEL);
  await s(go);                                           // the paid one: one press opens it
  await until(s, "[...document.querySelectorAll('.hint-panel .hint-text')].some(e => /one line/.test(e.textContent))");
  out.hint2 = await s(PANEL);
  out.hint2Recorded = await s(`fetch('/api/hints/${cfg.slug}').then(r=>r.json()).then(d=>d.taken['Prints Hello']||[])`);
  await s.shot("2-hint2");
  await s(go);
  await until(s, "!!document.querySelector('.hint-panel .hint-code')");
  out.code = await s(PANEL);
  await s.shot("3-code");
  out.words = await s(`[ window.IDEHints._why("NameError: name 'hay' is not defined"),
                         window.IDEHints._why("main.py can't be read: line 1: invalid syntax"),
                         window.IDEHints._why('It printed: (nothing)'),
                         window.IDEHints._goal('With input apple, sun, flower, prints hayride'),
                         window.IDEHints._goal('crop is made with +') ]`);
  // The bubble in the editor no longer lists why (the card says it).
  out.bubbleWhy = await s("document.querySelectorAll('.editor-tip-why').length");
  // Closed, then the next check brings it back.
  await s("document.querySelector('.hint-close').click(); true");
  out.closed = await s("document.querySelector('.hint-panel').hidden");
  await s(press);
  await until(s, "!document.querySelector('.hint-panel').hidden");
  out.back = await s(PANEL);
  // Fixed: it says so.
  await s(answer([{ label: "Prints Hello", ok: true, detail: "" }, { label: "Uses a for loop", ok: true, detail: "" }]));
  await s(press);
  await until(s, "document.querySelector('.hint-panel').classList.contains('is-pass')");
  out.passed = await s(PANEL);

  // A program that asks for input() runs after the check (app.js): the card
  // waits until it's finished, so the console can be typed in first.
  await s("document.querySelector('.hint-close').click(); window.__done = null; window.IDEHints.wait(new Promise(function (r) { window.__done = r; })); true");
  await s(answer([{ label: "Prints Hello", ok: false, detail: "It printed: Hi" }, { label: "Uses a for loop", ok: true, detail: "" }]));
  await s(press);
  await sleep(600);
  out.heldWhileRunning = await s("document.querySelector('.hint-panel').hidden");
  await s("window.__done(); true");
  await until(s, "!document.querySelector('.hint-panel').hidden");
  out.afterRun = await s(PANEL);
  // A PASS doesn't wait: the program may sit waiting for input in the console
  // for good, and the Great Job card never came (the teacher, Nov 2026).
  await s("document.querySelector('.hint-close').click(); window.IDEHints.wait(new Promise(function () {})); true");
  await s(answer([{ label: "Prints Hello", ok: true, detail: "" }, { label: "Uses a for loop", ok: true, detail: "" }]));
  await s(press);
  await sleep(600);
  out.passWhileRunning = await s(PANEL);

  // A Try It page: free hints, and only the card pressed is talked about.
  const t = await open(cfg.student, cfg.tryit);
  await t(answer([{ label: "Prints Hey", ok: true, detail: "" }, { label: "Prints Pumpkin", ok: false, detail: "It printed: (nothing)" }]));
  await t("document.querySelectorAll('.tests-card .tests-run')[0].click(); true");
  await until(t, "!!document.querySelector('.hint-panel:not([hidden])')");
  out.firstStep = await t(PANEL);
  await t("document.querySelector('.hint-close').click(); true");
  await t("document.querySelectorAll('.tests-card .tests-run')[1].click(); true");
  await until(t, "!!document.querySelector('.hint-panel:not([hidden]) .hint-go')");
  await t(go);
  await until(t, "document.querySelectorAll('.hint-panel .hint-text').length === 1");
  out.tryHint1 = await t(PANEL);
  await t(go);
  await until(t, "[...document.querySelectorAll('.hint-panel .hint-text')].some(e => /brackets/.test(e.textContent))");
  out.tryHint2 = await t(PANEL);
  await t.shot("4-tryit");

  // A reload: what was paid for is shown again, free, on the next failed check.
  const r = await open(cfg.student, cfg.page);
  await r(answer([{ label: "Prints Hello", ok: false, detail: "It printed: Hi" }]));
  await r(press);
  await until(r, "!!document.querySelector('.hint-panel .hint-code')");
  out.reloaded = await r(PANEL);

  // A prediction's card shows only the newest hint, as a test's does.
  await r("window.IDEHints.predictCard({ title: 'Not yet', hints: ['first nudge', 'second nudge'] }); true");
  out.predictHints = await r(PANEL);

  // A quiz: nothing at all.
  const q = await open(cfg.student, cfg.quiz);
  await q(answer([{ label: "Prints Hello", ok: false, detail: "It printed: Hi" }]));
  await q(press);
  await sleep(1200);
  out.quiz = await q("!document.querySelector('.hint-panel') || document.querySelector('.hint-panel').hidden");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
}
console.log(JSON.stringify(out));
process.exit(0);
