// Driven by tools/test_editor_tips_browser.py: opens an assignment as the
// student, and as its teacher, and reads the editor's guide bubble
// (`:::pop editor`, notes.js editorTip, app.js) as the steps are done.
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "tips-browser-"));
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
    await send("Network.setCookie", { name: "session", value: cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev("!!document.querySelector('.tests-card')")) break; }
    await sleep(500);
    return ev;
  }
  const TIP = "document.querySelector('.CodeMirror .editor-tip')";
  const tipText = `(${TIP} ? ${TIP}.textContent.trim() : '')`;

  // ---- the student
  const ev = await open(cfg.student, cfg.page);
  out.first = await ev(tipText);
  out.plainPopInEditor = await ev(`${tipText}.indexOf('Only on the slide') >= 0`);
  out.clicksThrough = await ev(`${TIP} ? getComputedStyle(${TIP}).pointerEvents : ''`);
  const cm = "document.querySelector('.CodeMirror').CodeMirror";
  // Under the last line with something on it.
  await ev(`${cm}.setValue('# My code\\ntitle = "Mohawk"\\n\\n')`);
  await sleep(200);
  out.underLast = await ev(`(() => { const c = ${cm}; const t = ${TIP}; if (!t) return null;
    const line = c.charCoords({ line: 1, ch: 0 }, 'page'); const r = t.getBoundingClientRect();
    return r.top + window.scrollY >= line.bottom - 1 && r.top + window.scrollY < line.bottom + 40; })()`);
  // Check my work: the first step passes, so the bubble moves on to the second.
  // Check my work, then wait for that card's verdict (the first run loads
  // Pyodide, which can take a while): passed, or a line marked wrong.
  const press = async (card) => {
    await ev("document.querySelector('.tests-card .tests-run').click()");
    const card_ = `document.querySelectorAll('.tests-card')[${card}]`;
    for (let k = 0; k < 600; k++) {
      await sleep(150);
      if (await ev(`${card_}.hasAttribute('data-passed') || /✗/.test(${card_}.textContent)`)) break;
    }
    await sleep(400);
  };
  await press(0);
  out.firstPassed = await ev("!!document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed')");
  out.second = await ev(tipText);
  await ev(`${cm}.setValue('title = "Mohawk"\\nprint(title[2:6])\\n')`);
  await press(1);
  out.allPassed = await ev("[...document.querySelectorAll('.tests-card')].every(c => c.hasAttribute('data-passed'))");
  out.done = await ev(tipText);
  await sleep(2000);
  out.goneAfter = await ev(`!${TIP}`);

  // ---- the teacher writing it: no bubble
  const tv = await open(cfg.teacher, cfg.teacherPage);
  // While authoring the editor opens on the code and the notes are drawn
  // only once their tab is opened: open it, or there's nothing to show.
  await tv("[...document.querySelectorAll('#file-tabs *')].find(t => /notes\\.md/.test(t.textContent) && t.children.length === 0)?.click()");
  for (let k = 0; k < 100; k++) { await sleep(100); if (await tv("!!document.querySelector('.tests-card')")) break; }
  await sleep(800);
  out.teacherCard = await tv("!!document.querySelector('.tests-card')");
  out.teacherTip = await tv(`!!${TIP}`);
  out.teacherHasEditor = await tv("!!document.querySelector('.CodeMirror')");

  // ---- live: the student on the lesson's live page, their own editor ("mine")
  const lv = await open(cfg.student, cfg.live);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await lv("!!document.querySelector('.CodeMirror .editor-tip')")) break; }
  out.liveFirst = await lv(tipText);
  out.liveInMine = await lv("!!(document.querySelector('.CodeMirror .editor-tip') && document.getElementById('mine').nextElementSibling.contains(document.querySelector('.CodeMirror .editor-tip')))");
  out.liveInMirror = await lv("!!document.getElementById('mirror').nextElementSibling.querySelector('.editor-tip')");
  await lv("document.getElementById('mine').nextElementSibling.CodeMirror.setValue('title = \"Mohawk\"\\n')");
  await lv("document.querySelector('.tests-card .tests-run').click()");
  for (let k = 0; k < 600; k++) {
    await sleep(150);
    if (await lv("document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed') || /✗/.test(document.querySelectorAll('.tests-card')[0].textContent)")) break;
  }
  await sleep(500);
  out.livePassed = await lv("document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed')");
  out.liveSecond = await lv(tipText);
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
