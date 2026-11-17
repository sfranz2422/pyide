// Driven by tools/test_live_class_browser.py: two students and their teacher
// on one live lesson, in headless Chrome (static/live_class.js).
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "liveclass-browser-"));
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
  // Each person their own browser context: their own cookie, their own storage.
  async function open(cookie, page, ready) {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Network.enable", {}, S);
    await send("Network.setCookie", { name: "session", value: cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e, gesture) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: !!gesture }, S)).result?.value;
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev(ready)) break; }
    await sleep(500);
    ev.context = browserContextId;
    return ev;
  }
  const until = async (ev, cond, ms = 15000) => {
    for (let t = 0; t < ms; t += 150) { if (await ev(cond)) return true; await sleep(150); }
    return false;
  };

  // ---- the teacher first: their editor, live on the lesson
  const tv = await open(cfg.teacher, cfg.teach, "!!document.querySelector('.live-timer-btn') && !document.getElementById('live-code').hidden");
  // ---- the students
  const READY = "!!document.querySelector('.snippet-predict') && !!document.querySelector('.tests-card')";
  const a = await open(cfg.s1, cfg.live, READY);
  const b = await open(cfg.s2, cfg.live, READY);
  // The celebration's note is up for a few seconds only: kept when it comes.
  const keepParty = `window._party = ''; new MutationObserver(() => { const n = document.querySelector('.live-party-note');
    if (n) window._party = n.textContent; }).observe(document.body, { childList: true });`;
  await a(keepParty);
  await b(keepParty);
  out.handButtons = await a("document.querySelectorAll('.live-hands .live-hand').length");
  out.timerBefore = await a("document.querySelector('.live-timer').hidden");

  // Predictions: the first student gets it right, the second doesn't.
  const guess = (g) => `(() => { const t = document.querySelector('.snippet-guess'); t.value = ${JSON.stringify(g)};
    t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.snippet-predict .snippet-run').click(); })()`;
  await a(guess("MAPLE"));
  await b(guess("maple"));
  // A hand up.
  await a("[...document.querySelectorAll('.live-hand')].find(x => /stuck/.test(x.textContent)).click()");

  // The step: each types it and presses the card's Check my work.
  const pass = `(() => { document.getElementById('mine').nextElementSibling.CodeMirror.setValue('crop = "corn"\\n');
    document.querySelector('.tests-card .tests-run').click(); })()`;
  const toastOf = "[...document.querySelectorAll('.xp-toast, .live-toast, [class*=toast]')].map(t => t.textContent).join(' | ')";
  await a(pass);
  await until(a, "document.querySelector('.tests-card').hasAttribute('data-passed')", 60000);
  await until(a, `/finish/.test(${toastOf})`, 8000);
  out.toast1 = await a(toastOf);
  await b(pass);
  await until(b, "document.querySelector('.tests-card').hasAttribute('data-passed')", 60000);
  await until(b, `/finish/.test(${toastOf})`, 8000);
  out.toast2 = await b(toastOf);

  // The teacher's side, at its next ask (every 3 s).
  await until(tv, "/2 \\/ 2/.test((document.querySelector('.live-count') || {}).textContent || '')", 12000);
  out.teacherCount = await tv("(document.querySelector('#class-notes .live-count') || document.querySelector('.live-count') || {}).textContent || ''");
  await until(tv, "/2 of 2/.test((document.querySelector('.live-guesses') || {}).textContent || '')", 8000);
  out.teacherGuesses = await tv("(document.querySelector('.live-guesses') || {}).textContent || ''");
  out.teacherHands = await tv("(document.querySelector('.live-hands-count') || {}).textContent || ''");
  out.namesOnTeacher = await tv("/Ana|Ben|Ruiz|Ode/.test(document.body.innerText)");

  // The celebration, on both students' screens.
  await until(a, "!!window._party", 15000);
  out.party1 = await a("window._party");
  await until(b, "!!window._party", 5000);
  out.party2 = await b("window._party");

  // The countdown: the teacher's ⏱ menu, 1 min.
  await tv("document.querySelector('.live-timer-btn').click()");
  await sleep(200);
  await tv("[...document.querySelectorAll('.live-timer-menu button')].find(x => x.textContent === '1 min').click()");
  await until(a, "!document.querySelector('.live-timer').hidden", 10000);
  out.studentTimer = await a("document.querySelector('.live-timer').textContent");
  out.teacherTimer = await tv("document.querySelector('.live-timer-btn').textContent");

  // The pop-out: opened from the teacher's tab, found by its address.
  await tv("document.querySelector('.js-popout').click()", true);
  let popTarget = null;
  for (let k = 0; k < 50 && !popTarget; k++) {
    await sleep(200);
    const { targetInfos } = await send("Target.getTargets");
    popTarget = targetInfos.find((t) => /\/notes\/present/.test(t.url));
  }
  if (popTarget) {
    const { sessionId: P } = await send("Target.attachToTarget", { targetId: popTarget.targetId, flatten: true });
    const pv = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, P)).result?.value;
    for (let k = 0; k < 60; k++) { await sleep(200); if (await pv("!!document.querySelector('.live-guesses') && !document.querySelector('.live-timer').hidden")) break; }
    out.popCount = await pv("(document.querySelector('.live-count') || {}).textContent || ''");
    out.popGuesses = await pv("(document.querySelector('.live-guesses') || {}).textContent || ''");
    out.popTimer = await pv("document.querySelector('.live-timer').textContent");
    out.popHands = await pv("(document.querySelector('.live-hands-count') || {}).textContent || ''");
  }
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
