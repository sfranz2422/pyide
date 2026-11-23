// Driven by tools/test_try_slide_browser.py: a Try It step typed on the
// slide (```tests try, checks_in_notes.js tryStep) in a student's own
// editor, in Chrome, with the real Python — the page's for the check, the
// snippet worker for the output under the box.
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

const port = 9300 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "try-slide-"));
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
    for (let k = 0; k < 150; k++) { await sleep(100); if (await ev("!!document.querySelector('.try-step') && !!window.IDEHints")) break; }
    ev.shot = async (name) => {
      if (!process.env.TRY_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.TRY_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  const until = async (ev, expr, ms) => { for (let k = 0; k < (ms || 6000) / 100; k++) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const PANEL = "(function(){ var p=document.querySelector('.hint-panel'); if(!p||p.hidden) return null; return { title: (p.querySelector('.hint-title')||{}).textContent, hints: [...p.querySelectorAll('.hint-text')].map(e=>e.textContent), code: (p.querySelector('.hint-code')||{}).textContent || '', button: (p.querySelector('.hint-go')||{}).textContent || '', pass: p.classList.contains('is-pass'), select: getComputedStyle(p.querySelector('.hint-title')).userSelect }; })()";
  const STEP = (n) => `document.querySelectorAll('.try-step')[${n}]`;
  const type = (n, text) => `(function(){ var a=${STEP(n)}.querySelector('.try-code'); a.focus(); a.value=${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); return true; })()`;
  const checkStep = (n) => `${STEP(n)}.querySelector('.tests-run').click(); true`;
  const marks = (n) => `[...${STEP(n)}.querySelectorAll('.test-line')].map(li => li.querySelector('.tests-mark').textContent)`;
  const closeCard = "(function(){ var b=document.querySelector('.hint-panel:not([hidden]) .hint-close'); if(b) b.click(); return true; })()";

  const s = await open(cfg.student, cfg.page);
  out.boxes = await s("document.querySelectorAll('.try-step .try-code').length");
  out.cards = await s("document.querySelectorAll('.try-step .tests-card[data-try] .tests-run').length");
  out.noBubble = await s("!document.querySelector('.editor-tip')");
  out.expectBig = await s("(function(){ var p=[...document.querySelectorAll('.pop-box p')].find(p=>/should print/.test(p.textContent)); return !!p && p.classList.contains('says-expect') && parseFloat(getComputedStyle(p).fontSize) > parseFloat(getComputedStyle(p.parentNode).fontSize); })()");
  // Python has to be up in the page before a check can run.
  await until(s, "(function(){ var c=document.querySelector('.try-step .tests-run'); return c && !c.hidden; })()", 20000);

  // Paste is refused: typing it is the exercise.
  out.pasteRefused = await s(`(function(){ var a=${STEP(0)}.querySelector('.try-code'); var e=new Event('paste',{bubbles:true,cancelable:true}); a.dispatchEvent(e); return e.defaultPrevented; })()`);

  // Wrong (glued without +): the step's own card fails, and the hint card comes up.
  await s(type(0, 'print("hay" "ride")'));
  for (let k = 0; k < 90; k++) {           // the first check waits for Python to load
    await s(checkStep(0));
    if (await until(s, `${marks(0)}.some(m => m === '✗' || m === '✓')`, 3000)) break;
  }
  out.wrongMarks = await s(marks(0));
  await until(s, "!!document.querySelector('.hint-panel:not([hidden])')");
  out.wrongCard = await s(PANEL);
  out.wrongOutput = await until(s, `/hayride/.test(${STEP(0)}.querySelector('.try-out').textContent)`, 60000)
    && await s(`${STEP(0)}.querySelector('.try-out').textContent`);
  await s.shot("1-wrong");
  await s("document.querySelector('.hint-panel .hint-go').click(); true");
  await until(s, "document.querySelectorAll('.hint-panel .hint-text').length === 1");
  out.hint1 = await s(PANEL);
  out.copyRefused = await s("(function(){ var e=new Event('copy',{bubbles:true,cancelable:true}); document.querySelector('.hint-panel .hint-text').dispatchEvent(e); return e.defaultPrevented; })()");
  await s(closeCard);
  // The plain card on the next slide is another test called "Uses +": untouched.
  out.mainCardUntouched = await s("[...document.querySelectorAll('.tests-card:not([data-try]) .tests-mark')].every(m => m.textContent === '○')");

  // Right: passes, the Great Job card, and its output under the box.
  await s(type(0, 'print("hay" + "ride")'));
  await s(`${STEP(0)}.querySelector('.try-out').textContent = ''; true`);
  await s(checkStep(0));
  await until(s, `${marks(0)}.every(m => m === '✓')`, 20000);
  out.rightMarks = await s(marks(0));
  out.passed = await s(`${STEP(0)}.querySelector('.tests-card').hasAttribute('data-passed')`);
  await until(s, "!!document.querySelector('.hint-panel.is-pass:not([hidden])')");
  out.rightCard = await s(PANEL);
  await until(s, `/hayride/.test(${STEP(0)}.querySelector('.try-out').textContent)`, 30000);
  out.rightOutput = await s(`${STEP(0)}.querySelector('.try-out').textContent`);
  await s.shot("2-right");
  await s(closeCard);

  // The next box starts with the code so far, to type under.
  await s(`${STEP(1)}.querySelector('.try-code').focus(); true`);
  out.prefill = await s(`${STEP(1)}.querySelector('.try-code').value`);
  await s(type(1, 'print("hay" + "ride")\ncrop = "pump" + "kin"\nprint(crop)'));
  await s(checkStep(1));
  await until(s, `${marks(1)}.every(m => m === '✓')`, 20000);
  out.secondMarks = await s(marks(1));
  await until(s, `/pumpkin/.test(${STEP(1)}.querySelector('.try-out').textContent)`, 30000);
  out.secondOutput = await s(`${STEP(1)}.querySelector('.try-out').textContent`);
  out.mainStillUntouched = await s("[...document.querySelectorAll('.tests-card:not([data-try]) .tests-mark')].every(m => m.textContent === '○')");

  // A reload keeps what was typed.
  const r = await open(cfg.student, cfg.page);
  out.kept = await r(`${STEP(1)}.querySelector('.try-code').value`);
  // A Try It split over slides: the first box on the next slide starts from
  // the box last typed in. (The steps before are taken off the page, as an
  // earlier slide's are.)
  await r(`${STEP(0)}.remove(); ${STEP(0)}.remove(); ${STEP(0)}.querySelector('.try-code').focus(); true`);
  out.nextSlide = await r(`${STEP(0)}.querySelector('.try-code').value`);
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* still closing */ }
}
console.log(JSON.stringify(out));
process.exit(0);
