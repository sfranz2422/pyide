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
    // A picture of the page, for a person to look at (EDITOR_TIPS_SHOT=folder).
    ev.shot = async (name) => {
      if (!process.env.EDITOR_TIPS_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png" }, S);
      fs.writeFileSync(path.join(process.env.EDITOR_TIPS_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  const TIP = "document.querySelector('.CodeMirror .editor-tip')";
  const tipText = `(${TIP} ? ${TIP}.textContent.trim() : '')`;

  // ---- the student
  const ev = await open(cfg.student, cfg.page);
  out.first = await ev(tipText);
  out.plainPopInEditor = await ev(`${tipText}.indexOf('Only on the slide') >= 0`);
  out.clicksThrough = await ev(`${TIP} ? getComputedStyle(${TIP}).pointerEvents : ''`);
  const VIS = (sel) => `[...document.querySelectorAll('${sel}')].some(e => e.offsetParent !== null)`;
  out.stepOnSlide = await ev(VIS('.pop-box.to-editor'));
  out.explainOnSlide = await ev(`[...document.querySelectorAll('p')].some(p => p.offsetParent !== null && /text in quotes/.test(p.textContent) && !p.closest('.editor-tip'))`);
  // The code to type is a little read-only editor, coloured like theirs, one line.
  out.codeBlock = await ev(`(() => { const b = ${TIP} && ${TIP}.querySelector('.editor-tip-code .CodeMirror'); if (!b) return null;
    return { lines: b.querySelectorAll('.CodeMirror-line').length, text: b.CodeMirror.getValue(),
             coloured: !!b.querySelector('.cm-string') && !!b.querySelector('.cm-variable, .cm-def, .cm-builtin'),
             theme: [...b.classList].filter(c => c.startsWith('cm-s-')).join(' '),
             same: [...b.classList].some(c => c.startsWith('cm-s-') && document.querySelector('.CodeMirror:not(.editor-tip-code .CodeMirror)').classList.contains(c)),
             height: b.getBoundingClientRect().height }; })()`);
  out.bubbleButton = await ev(`!!(${TIP} && ${TIP}.querySelector('.editor-tip-check'))`);
  out.buttonClicks = await ev(`${TIP} && ${TIP}.querySelector('.editor-tip-check') ? getComputedStyle(${TIP}.querySelector('.editor-tip-check')).pointerEvents : ''`);
  const cm = "document.querySelector('.CodeMirror').CodeMirror";
  // Under the last line with something on it.
  await ev(`${cm}.setValue('# My code\\ntitle = "Mohawk"\\n\\n')`);
  await sleep(200);
  out.underLast = await ev(`(() => { const c = ${cm}; const t = ${TIP}; if (!t) return null;
    const line = c.charCoords({ line: 1, ch: 0 }, 'page'); const r = t.getBoundingClientRect();
    return r.top + window.scrollY >= line.bottom - 1 && r.top + window.scrollY < line.bottom + 40; })()`);
  await ev.shot("1-first-step");
  out.lineHeight = await ev(`${cm}.defaultTextHeight()`);
  out.gap = await ev(`(() => { const c = ${cm}; const t = ${TIP}; if (!t) return null;
    const line = c.charCoords({ line: 1, ch: 0 }, 'page'); return t.getBoundingClientRect().top + window.scrollY - line.bottom; })()`);
  // A wrong first step, checked from the bubble: it says Not yet.
  await ev(`${cm}.setValue('title = "Mohak"\\n')`);
  await sleep(200);
  await ev(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 600; k++) { await sleep(150); if (await ev(`!!(${TIP} && ${TIP}.querySelector('.editor-tip-nope'))`)) break; }
  out.nope = await ev(`${TIP} && ${TIP}.querySelector('.editor-tip-nope') ? ${TIP}.querySelector('.editor-tip-nope').textContent : ''`);
  out.cardsOnSlide = await ev(VIS('.tests-card'));
  out.cardsInPage = await ev("document.querySelectorAll('.tests-card').length");
  out.holdWhy = await ev("[...document.querySelectorAll('.reveal-hint, .slide-btn, .reveal-play')].map(e => (e.textContent || '') + ' ' + (e.title || '')).join(' | ')");
  // A long program, scrolled to its top: the next step's bubble is under the
  // last line, out of sight, and below the end of the document.
  await ev(`${cm}.setValue('# My code\\ntitle = "Mohawk"\\n' + Array.from({ length: 60 }, (_, i) => '# note ' + i).join('\\n') + '\\n')`);
  await ev(`${cm}.scrollTo(0, 0)`);
  await sleep(200);
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
  await ev(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 600; k++) { await sleep(150); if (await ev("document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed')")) break; }
  await sleep(400);
  out.firstPassed = await ev("!!document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed')");
  out.second = await ev(tipText);
  await sleep(300);
  // The new step's bubble is scrolled into sight, all of it, in the editor
  // and the window (kids never saw one below the end of their code).
  out.secondInView = await ev(`(() => { const t = ${TIP}; if (!t) return null; const r = t.getBoundingClientRect();
    const v = ${cm}.getScrollerElement().getBoundingClientRect();
    return { top: r.top >= v.top - 1 && r.top >= -1, bottom: r.bottom <= v.bottom + 1 && r.bottom <= window.innerHeight + 1 }; })()`);
  await ev(`${cm}.setValue('title = "Mohawk"\\nprint(title[2:6])\\n')`);
  await ev(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 600; k++) { await sleep(150); if (await ev("[...document.querySelectorAll('.tests-card')].every(c => c.hasAttribute('data-passed'))")) break; }
  await sleep(300);
  out.allPassed = await ev("[...document.querySelectorAll('.tests-card')].every(c => c.hasAttribute('data-passed'))");
  // Check my work runs the program too, so its output is on screen.
  for (let k = 0; k < 60; k++) { await sleep(150); if (await ev("/hawk/.test(document.getElementById('output').textContent)")) break; }
  out.outputAfterCheck = await ev("document.getElementById('output').textContent");
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
  out.teacherStepOnSlide = await tv(VIS('.pop-box.to-editor'));
  out.teacherCardOnSlide = await tv(VIS('.tests-card'));
  out.teacherHasEditor = await tv("!!document.querySelector('.CodeMirror')");

  // ---- live: the student on the lesson's live page, their own editor ("mine")
  const lv = await open(cfg.student, cfg.live);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await lv("!!document.querySelector('.CodeMirror .editor-tip')")) break; }
  out.liveFirst = await lv(tipText);
  out.liveInMine = await lv("!!(document.querySelector('.CodeMirror .editor-tip') && document.getElementById('mine').nextElementSibling.contains(document.querySelector('.CodeMirror .editor-tip')))");
  out.liveInMirror = await lv("!!document.getElementById('mirror').nextElementSibling.querySelector('.editor-tip')");
  out.liveStepOnSlide = await lv(VIS('.pop-box.to-editor'));
  await lv("document.getElementById('mine').nextElementSibling.CodeMirror.setValue('title = \"Mohawk\"\\nprint(title)\\n')");
  await lv("document.querySelector('.CodeMirror .editor-tip .editor-tip-check').click()");
  for (let k = 0; k < 600; k++) {
    await sleep(150);
    if (await lv("document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed') || /✗/.test(document.querySelectorAll('.tests-card')[0].textContent)")) break;
  }
  await sleep(500);
  out.livePassed = await lv("document.querySelectorAll('.tests-card')[0].hasAttribute('data-passed')");
  out.liveSecond = await lv(tipText);
  for (let k = 0; k < 60; k++) { await sleep(150); if (await lv("/Mohawk/.test(document.getElementById('output').textContent)")) break; }
  out.liveOutput = await lv("document.getElementById('output').textContent");

  // ---- an exercise: directions grouped under one card, then a challenge
  const ex = await open(cfg.student, cfg.page2);
  out.groupTip = await ex(tipText);
  await ex.shot("2-exercise");
  await ex(`${cm}.setValue('fruit = "pear"\\ncount = 3\\n')`);
  await ex(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 600; k++) { await sleep(150); if (await ex(`/Challenge/.test(${tipText})`)) break; }
  await sleep(300);
  out.challengeTip = await ex(tipText);
  out.challengeButton = await ex(`!!(${TIP} && ${TIP}.querySelector('.editor-tip-check'))`);

  // ---- a quiz (`quiz: yes`): nothing says how a check or an answer went
  const qz = await open(cfg.student, cfg.quiz);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await qz(`!!${TIP}`)) break; }
  await qz(`${cm}.setValue('size = 5\\n')`);
  await qz(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 600; k++) { await sleep(150); if (await qz("document.querySelector('.tests-card').hasAttribute('data-checked') && !/Checking/.test(document.querySelector('.tests-card .tests-run').textContent)")) break; }
  await sleep(300);
  const qcard = "document.querySelector('.tests-card')";
  out.quizStudent = { tip: await qz(tipText),
    marks: await qz(`[...${qcard}.querySelectorAll('.tests-mark')].map(m => m.textContent).join('')`),
    sum: await qz(`${qcard}.querySelector('.tests-sum').textContent`) };
  await qz("[...document.querySelectorAll('.quiz input')].find(i => i.value === '2').click()");
  await qz("document.querySelector('.quiz-send').click()");
  for (let k = 0; k < 60; k++) { await sleep(150); if (await qz("/saved|Correct|Not quite/.test(document.querySelector('.quiz-result').textContent)")) break; }
  out.quizStudent.answer = await qz("document.querySelector('.quiz-result').textContent");
  await qz.shot("4-quiz");
  // The teacher writing it: the card's own Check my work, marks shown.
  const qt = await open(cfg.teacher, cfg.quizTeacher);
  await qt("[...document.querySelectorAll('#file-tabs *')].find(t => /notes\\.md/.test(t.textContent) && t.children.length === 0)?.click()");
  for (let k = 0; k < 100; k++) { await sleep(100); if (await qt("!!document.querySelector('.tests-card .tests-run')")) break; }
  await sleep(500);
  await qt("document.querySelector('.tests-card .tests-run').click()");
  for (let k = 0; k < 600; k++) { await sleep(150); if (await qt("/[✓✗]/.test(document.querySelector('.tests-card').textContent)")) break; }
  out.quizTeacher = { marks: await qt("[...document.querySelectorAll('.tests-card .tests-mark')].map(m => m.textContent).join('')") };

  // ---- a web page: the bubble goes inside <body>, under the comment
  // Another student: this one has the web lesson's live page open below, and
  // two tabs saving the same draft rightly stops one with an alert.
  const wb = await open(cfg.student2, cfg.web);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await wb(`!!${TIP}`)) break; }
  out.webFirst = await wb(tipText);
  // Which line is it under? The comment's (line 8), not </html>'s.
  const wcm = "document.querySelector('.CodeMirror').CodeMirror";
  const under = (n) => `(() => { const c = ${wcm}; const t = ${TIP}; if (!t) return null;
    const line = c.charCoords({ line: ${n}, ch: 0 }, 'page'); const top = t.getBoundingClientRect().top + window.scrollY;
    return top >= line.bottom - 1 && top < line.bottom + 2 * c.defaultTextHeight() + 20; })()`;
  out.webUnder = (await wb(under(8))) ? "comment" : (await wb(under(11))) ? "html" : "elsewhere";
  await wb.shot("3-web");
  await wb(`(() => { const c = ${wcm}; c.replaceRange('    <h2>Harvest</h2>\\n', { line: 9, ch: 0 }); })()`);
  await sleep(300);
  out.webKept = await wb(`/Harvest/.test(${wcm}.getValue())`);
  out.webUnderTyped = await wb(under(9));
  await wb("document.getElementById('preview') && document.getElementById('preview').removeAttribute('srcdoc')");
  await wb(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 300; k++) { await sleep(150); if (await wb("document.querySelector('.tests-card').hasAttribute('data-passed') || /✗/.test(document.querySelector('.tests-card').textContent)")) break; }
  out.webPassed = await wb("document.querySelector('.tests-card').hasAttribute('data-passed')");
  for (let k = 0; k < 40; k++) { await sleep(150); if (await wb("/Harvest/.test(document.getElementById('preview').srcdoc || '')")) break; }
  out.webRan = await wb("/Harvest/.test(document.getElementById('preview').srcdoc || '')");

  // ---- the web lesson live: their own editor ("mine")
  const wl = await open(cfg.student, cfg.webLive);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await wl(`!!${TIP}`)) break; }
  out.webLiveFirst = await wl(tipText);
  out.webLiveInMine = await wl(`!!(${TIP} && document.getElementById('mine').nextElementSibling.contains(${TIP}))`);
  out.webLiveInMirror = await wl("!!document.getElementById('mirror').nextElementSibling.querySelector('.editor-tip')");
  out.webLiveStepOnSlide = await wl(VIS('.pop-box.to-editor'));
  await wl("(() => { const c = document.getElementById('mine').nextElementSibling.CodeMirror; c.setValue(c.getValue().replace('<!-- Build your page here -->', '<h2>Harvest</h2>')); })()");
  await sleep(300);
  await wl(`${TIP}.querySelector('.editor-tip-check').click()`);
  for (let k = 0; k < 300; k++) { await sleep(150); if (await wl("document.querySelector('.tests-card').hasAttribute('data-passed') || /✗/.test(document.querySelector('.tests-card').textContent)")) break; }
  out.webLivePassed = await wl("document.querySelector('.tests-card').hasAttribute('data-passed')");
  for (let k = 0; k < 40; k++) { await sleep(150); if (await wl("/Harvest/.test(document.getElementById('preview').srcdoc || '')")) break; }
  out.webLiveRan = await wl("/Harvest/.test(document.getElementById('preview').srcdoc || '')");

  // ---- Copy to editor, under the Easy box's code with blanks
  const cpg = await open(cfg.student3, cfg.copy);
  const c3 = "document.querySelector('.CodeMirror').CodeMirror";
  for (let k = 0; k < 100; k++) { await sleep(100); if (await cpg("!!document.querySelector('.copy-to-editor-btn')")) break; }
  await sleep(300);
  const copy = {};
  copy.easyButtons = await cpg("document.querySelectorAll('.level-part[data-level=\"easy\"] .copy-to-editor-btn').length");
  copy.mediumButtons = await cpg("document.querySelectorAll('.level-part[data-level=medium] .copy-to-editor-btn').length");
  copy.masterButtons = await cpg("document.querySelectorAll('.level-part[data-level=master] .copy-to-editor-btn').length");
  const activeTab = "(document.querySelector('#file-tabs .active, #file-tabs [aria-selected=\"true\"]') || {}).textContent || ''";
  await cpg(`${c3}.getDoc() && document.querySelectorAll('.copy-to-editor-btn')[0].click()`);
  await sleep(300);
  copy.htmlFile = (await cpg(activeTab)).replace(/[^\w.]/g, "");
  copy.htmlInBody = await cpg(`(() => { const v = ${c3}.getValue(); const i = v.indexOf('    <h2>_____</h2>' + String.fromCharCode(10) + '    <p class="_____">'); return i > 0 && i < v.indexOf('</body>'); })()`);
  copy.selected = await cpg(`${c3}.getSelection()`);
  await cpg("document.querySelectorAll('.copy-to-editor-btn')[0].click()");
  await sleep(300);
  copy.twice = await cpg(`${c3}.getValue().split('<h2>_____</h2>').length - 1`);
  await cpg("document.querySelectorAll('.copy-to-editor-btn')[1].click()");
  await sleep(300);
  copy.cssFile = (await cpg(activeTab)).replace(/[^\w.]/g, "");
  copy.cssText = await cpg(`${c3}.getValue()`);
  copy.cssIn = /h2 \{ color: _____; \}/.test(copy.cssText) && /margin: 0/.test(copy.cssText);
  await cpg.shot("5-copy");
  const ct = await open(cfg.webTeacher, cfg.copyTeacher);
  await ct("[...document.querySelectorAll('#file-tabs *')].find(t => /notes\\.md/.test(t.textContent) && t.children.length === 0)?.click()");
  await sleep(1500);
  copy.teacherButtons = await ct("document.querySelectorAll('.copy-to-editor-btn').length");
  const lc = await open(cfg.student3, cfg.copyLive);
  for (let k = 0; k < 100; k++) { await sleep(100); if (await lc("!!document.querySelector('.copy-to-editor-btn')")) break; }
  await lc("document.querySelector('.copy-to-editor-btn') && document.querySelector('.copy-to-editor-btn').click()");
  await sleep(400);
  copy.liveMine = await lc("document.getElementById('mine').nextElementSibling.CodeMirror.getValue().indexOf('snack = \"_____\"') >= 0");
  copy.liveMirror = await lc("document.getElementById('mirror').nextElementSibling.CodeMirror.getValue().indexOf('snack =') >= 0");
  out.copy = copy;
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
