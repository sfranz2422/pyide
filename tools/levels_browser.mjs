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
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev(`!!document.querySelector('${ready || ".level-choose"}')`)) break; }
    await sleep(800);
    ev.shot = async (name) => {
      if (!process.env.LEVELS_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.LEVELS_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  // What's on screen: the level boxes showing, by their words.
  const SHOWN = `[...document.querySelectorAll('.level-part')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim().split('\\n')[0])`;
  const BTN = (key, lv) => `document.querySelector('.level-choose[data-for="${key}"] .level-${lv}')`;
  const NOTES = `[...document.querySelectorAll('.level-choose[data-for="exercise"] .level-note')].map(n => n.textContent).join(' | ')`;

  // ---- a student, choosing (no suggestion)
  const s = await open(cfg.student, cfg.page);
  out.before = { shown: await s(SHOWN), wait: await s("[...document.querySelectorAll('.level-wait')].map(w => w.textContent).join(' | ')"),
                 needs: await s("!!document.querySelector('.level-choose[data-for=\"exercise\"][data-needs]')"),
                 notes: await s(NOTES) };
  await s.shot("1-before");
  await s(`${BTN("exercise", "medium")}.click()`);
  await sleep(1200);
  out.medium = { shown: await s(SHOWN), wait: await s("[...document.querySelectorAll('.level-wait')].map(w => w.textContent).join(' | ')"),
                 masterDisabled: await s(`${BTN("exercise", "master")}.disabled`),
                 easyDisabled: await s(`${BTN("exercise", "easy")}.disabled`),
                 needs: await s("!!document.querySelector('.level-choose[data-for=\"exercise\"][data-needs]')"),
                 notes: await s(NOTES) };
  await s.shot("2-medium");
  await s(`${BTN("challenge", "master")}.click()`);
  await sleep(1200);
  // A check that passes the exercise, not the challenge.
  await s("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Howdy\")\\n')");
  await s("[...document.querySelectorAll('.tests-card')].find(c => c.offsetParent !== null).querySelector('.tests-run').click()");
  for (let k = 0; k < 150; k++) { await sleep(200); if (await s("!!document.querySelector('.test-line.pass')")) break; }
  await sleep(500);
  out.ran = await s("Object.keys(window.IDENotesChecks.results() || {})");
  const BON = "[...document.querySelectorAll('.tests-bonus')].find(c => c.offsetParent !== null)";
  out.bonusUntried = { marks: await s(`[...${BON}.querySelectorAll('.tests-mark')].map(m => m.textContent).join('')`),
                       sum: await s(`${BON}.querySelector('.tests-sum').textContent`),
                       head: await s(`${BON}.querySelector('.tests-head').textContent`),
                       exercisePassed: await s("[...document.querySelectorAll('.tests-card:not(.tests-bonus)')].find(c => c.offsetParent !== null).hasAttribute('data-passed')") };
  await s("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Howdy\")\\nprint(\"Wow 3\")\\n')");
  await s(`${BON}.querySelector('.tests-run').click()`);
  for (let k = 0; k < 150; k++) { await sleep(200); if (await s(`!!${BON}.querySelector('.test-line.pass')`)) break; }
  await sleep(500);
  out.bonusDone = { marks: await s(`[...${BON}.querySelectorAll('.tests-mark')].map(m => m.textContent).join('')`),
                    passed: await s(`${BON}.hasAttribute('data-passed')`) };
  // A reload: the pick is the server's.
  const s2 = await open(cfg.student, cfg.page);
  out.reloaded = { shown: await s2(SHOWN) };
  // Changing level asks again and says the points go.
  await s2(`${BTN("exercise", "easy")}.click()`);
  await sleep(300);
  out.change = { button: await s2(`${BTN("exercise", "easy")}.textContent`), notes: await s2(NOTES) };
  await s2(`${BTN("exercise", "easy")}.click()`);
  await sleep(1200);
  out.dropped = { shown: await s2(SHOWN), notes: await s2(NOTES) };

  // ---- a student with a suggestion (not locked)
  const g = await open(cfg.sugg, cfg.page);
  out.sugg = { buttons: await g("[...document.querySelectorAll('.level-choose[data-for=\"exercise\"] .level-name')].map(b => b.textContent).join(' | ')"),
               notes: await g(NOTES) };
  await g(`${BTN("exercise", "easy")}.click()`);
  await sleep(300);
  out.sugg.confirm = await g(`${BTN("exercise", "easy")}.textContent`);
  out.sugg.confirmNotes = await g(NOTES);

  // ---- a locked student: only their level, no choosing
  const l = await open(cfg.locked, cfg.page);
  out.locked = { buttons: await l("[...document.querySelectorAll('.level-choose[data-for=\"exercise\"] .level-btn')].map(b => b.textContent)"),
                 shown: await l(SHOWN), notes: await l(NOTES),
                 needs: await l("!!document.querySelector('.level-choose[data-for=\"exercise\"][data-needs]')") };
  await l.shot("3-locked");

  // ---- the teacher: a switcher, every level, nothing saved
  const t = await open(cfg.teacher, cfg.teacherPage, ".CodeMirror");
  await t("[...document.querySelectorAll('#file-tabs *')].find(x => /notes\\.md/.test(x.textContent) && x.children.length === 0)?.click()");
  for (let k = 0; k < 50; k++) { await sleep(100); if (await t("!!document.querySelector('.level-choose')")) break; }
  await sleep(500);
  out.teacher = { shown: await t(SHOWN), notes: await t(NOTES) };
  await t(`${BTN("exercise", "master")}.click()`);
  await sleep(400);
  out.teacherMaster = await t(SHOWN);

  // ---- slides with `locked: yes`: the level slide holds the way on
  const h = await open(cfg.student2, cfg.slides);
  out.held = { next: await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').disabled"),
               why: await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').title") };
  await h(`${BTN("exercise", "master")}.click()`);
  await sleep(1200);
  out.unheld = await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').disabled");
  await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').click()");
  await sleep(800);
  out.nextSlide = await h(SHOWN);
  out.exerciseOpenBefore = await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').disabled");
  // Pass the exercise, then the challenge slide (only a bonus card) must not hold.
  await h("document.querySelector('.CodeMirror').CodeMirror.setValue('print(\"Hey there\")\\n')");
  await h("[...document.querySelectorAll('.tests-card')].find(c => c.offsetParent !== null).querySelector('.tests-run').click()");
  for (let k = 0; k < 150; k++) { await sleep(200); if (await h("!!document.querySelector('.tests-card[data-passed]')")) break; }
  await sleep(500);
  out.exerciseOpen = await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').disabled");
  await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').click()");
  await sleep(800);
  out.bonusHolds = await h("[...document.querySelectorAll('.slide-btn')].find(b => b.textContent === '▶').disabled");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  console.log(JSON.stringify(out));
  process.exit(0);
}
