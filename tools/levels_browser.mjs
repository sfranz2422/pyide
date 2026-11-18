// Driven by tools/test_levels_browser.py: opens a v11 lesson (```level, :::level
// boxes, ```tests exercise / bonus) in Chrome as students and as its teacher,
// and reads what each one sees (notes.js "levels", checks_in_notes.js).
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "levels-browser-"));
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
  async function open(cookie, page, ready) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Network.enable", {}, S);
    if (cookie) await send("Network.setCookie", { name: "session", value: cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev(`!!document.querySelector('${ready || ".level-part"}')`)) break; }
    await sleep(800);
    ev.shot = async (name) => {
      if (!process.env.LEVELS_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.LEVELS_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  // What's on screen: the level boxes showing, by their first line.
  const SHOWN = `[...document.querySelectorAll('.level-part')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim().split('\\n')[0])`;

  // ---- a student whose level was never set: Easy
  const s = await open(cfg.student, cfg.page, ".level-part:not([hidden])");
  out.easy = { shown: await s(SHOWN),
               chooser: await s("!!document.querySelector('.level-choose, .level-view')"),
               levelWords: await s("/Choose your level|suggest|Your level/i.test(document.querySelector('#notes-body, .notes-body, body').innerText)"),
               marker: await s("document.body.innerText.indexOf('%%LEVEL') >= 0") };
  await s.shot("1-easy");
  await s("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Hello\")\\n')");
  await s("[...document.querySelectorAll('.tests-card')].find(c => c.offsetParent !== null).querySelector('.tests-run').click()");
  for (let k = 0; k < 150; k++) { await sleep(200); if (await s("!!document.querySelector('.test-line.pass')")) break; }
  await sleep(500);
  out.ran = await s("Object.keys(window.IDENotesChecks.results() || {})");
  const BON = "[...document.querySelectorAll('.tests-bonus')].find(c => c.offsetParent !== null)";
  out.bonusUntried = { marks: await s(`[...${BON}.querySelectorAll('.tests-mark')].map(m => m.textContent).join('')`),
                       sum: await s(`${BON}.querySelector('.tests-sum').textContent`),
                       head: await s(`${BON}.querySelector('.tests-head').textContent`),
                       exercisePassed: await s("[...document.querySelectorAll('.tests-card:not(.tests-bonus)')].find(c => c.offsetParent !== null).hasAttribute('data-passed')") };
  await s("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Hello\")\\nprint(\"Wow 1\")\\n')");
  await s(`${BON}.querySelector('.tests-run').click()`);
  for (let k = 0; k < 150; k++) { await sleep(200); if (await s(`!!${BON}.querySelector('.test-line.pass')`)) break; }
  await sleep(500);
  out.bonusDone = { marks: await s(`[...${BON}.querySelectorAll('.tests-mark')].map(m => m.textContent).join('')`),
                    passed: await s(`${BON}.hasAttribute('data-passed')`) };

  // ---- a student set to Master
  const m = await open(cfg.master, cfg.page, ".level-part:not([hidden])");
  out.master = { shown: await m(SHOWN) };

  // ---- the teacher: a switcher over the boxes, nothing saved
  const t = await open(cfg.teacher, cfg.teacherPage, ".CodeMirror");
  await t("[...document.querySelectorAll('#file-tabs *')].find(x => /notes\\.md/.test(x.textContent) && x.children.length === 0)?.click()");
  for (let k = 0; k < 50; k++) { await sleep(100); if (await t("!!document.querySelector('.level-view')")) break; }
  await sleep(500);
  out.teacher = { shown: await t(SHOWN), bars: await t("document.querySelectorAll('.level-view').length") };
  await t("document.querySelector('.level-view .level-view-btn[data-level=\"master\"]').click()");
  await sleep(400);
  out.teacherMaster = await t(SHOWN);

  // ---- slides with `locked: yes`, as Master's student
  const h = await open(cfg.master, cfg.slides, ".slide-btn");
  const NEXT = "[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶')";
  await h(`${NEXT}.click()`);
  await sleep(1500);
  out.held = { shown: await h(SHOWN), next: await h(`${NEXT}.disabled`) };
  await h("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Hey there\")\\n')");
  await h("[...document.querySelectorAll('.tests-card')].find(c => c.offsetParent !== null).querySelector('.tests-run').click()");
  for (let k = 0; k < 150; k++) { await sleep(200); if (await h("!!document.querySelector('.tests-card[data-passed]')")) break; }
  await sleep(500);
  out.exerciseOpen = await h(`${NEXT}.disabled`);
  await h(`${NEXT}.click()`);
  await sleep(800);
  out.bonusHolds = await h(`${NEXT}.disabled`);
  // ---- a web lesson, as the Easy student: only Easy's tests run
  const wb = await open(cfg.student, cfg.web, ".level-part:not([hidden])");
  await wb("[...document.querySelectorAll('.tests-card')].find(c => c.offsetParent !== null).querySelector('.tests-run').click()");
  for (let k = 0; k < 100; k++) { await sleep(200); if (await wb("!!(window.IDENotesChecks.results && window.IDENotesChecks.results())")) break; }
  await sleep(500);
  out.web = { shown: await wb(SHOWN), ran: await wb("Object.keys(window.IDENotesChecks.results() || {})") };
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  console.log(JSON.stringify(out));
  process.exit(0);
}
