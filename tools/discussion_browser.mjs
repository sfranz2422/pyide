// Driven by tools/test_discussion_browser.py: a discussion in Chrome, as two
// students and their teacher (discussion.html, discussion.js).
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
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "disc-browser-"));
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
  async function open(cookie, page, ready, width) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Network.enable", {}, S);
    if (cookie) await send("Network.setCookie", { name: "session", value: cookie, url: cfg.base }, S);
    await send("Emulation.setDeviceMetricsOverride", { width: width || 1200, height: 1000, deviceScaleFactor: 1, mobile: false }, S);
    await send("Page.enable", {}, S);
    await send("Page.navigate", { url: cfg.base + page }, S);
    const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.value;
    for (let k = 0; k < 100; k++) { await sleep(100); if (await ev(`!!document.querySelector('${ready}')`)) break; }
    await sleep(600);
    ev.shot = async (name) => {
      if (!process.env.DISC_SHOT) return;
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, S);
      fs.writeFileSync(path.join(process.env.DISC_SHOT, name + ".png"), Buffer.from(r.data, "base64"));
    };
    return ev;
  }
  // Type into a writing box the way a student does (execCommand, so the
  // input event fires as it would from the keyboard).
  const type = (sel, text) => `(function(){ var b=document.querySelector(${JSON.stringify(sel)}); b.focus();
    document.execCommand("insertText", false, ${JSON.stringify(text)}); return true; })()`;
  const until = async (ev, expr, ms) => { for (let k = 0; k < (ms || 8000) / 100; k++) { if (await ev(expr)) return true; await sleep(100); } return false; };

  // ---- Ana, before posting: the board is locked
  const a = await open(cfg.ana, cfg.page, "#disc-compose .disc-box");
  await until(a, "document.getElementById('disc-locked') && !document.getElementById('disc-locked').hidden");
  out.before = {
    prompt: await a("document.getElementById('disc-prompt').innerText.trim()"),
    locked: await a("!document.getElementById('disc-locked').hidden"),
    posts: await a("document.querySelectorAll('.disc-post').length"),
    count: await a("document.getElementById('disc-posts').innerText.trim()"),
    needs: await a("document.getElementById('disc-needs').innerText.trim()")
  };
  await a.shot("1-ana-before");
  await a(type("#disc-compose .disc-box", cfg.short));
  out.short = await a("document.querySelector('#disc-compose .disc-meter').className + '|' + document.querySelector('#disc-compose .disc-meter').textContent");
  await a(type("#disc-compose .disc-box", " " + cfg.more));
  out.yellow = await a("document.querySelector('#disc-compose .disc-meter').className");
  await a(type("#disc-compose .disc-box", " " + cfg.long));
  out.green = await a("document.querySelector('#disc-compose .disc-meter').className");
  await a("document.querySelector('#disc-compose .disc-foot .btn-primary').click()");
  await until(a, "document.querySelectorAll('.disc-post').length >= 2");
  out.after = {
    locked: await a("!document.getElementById('disc-locked').hidden"),
    names: await a("[...document.querySelectorAll('.disc-post-head strong')].map(e => e.textContent).sort()"),
    myMark: await a("(document.querySelector('.disc-post.is-mine .disc-mark')||{}).textContent || ''"),
    otherMark: await a("!!document.querySelector('.disc-post:not(.is-mine) .disc-mark')"),
    boxEmpty: await a("document.querySelector('#disc-compose .disc-box').innerText.trim() === ''"),
    title: await a("document.getElementById('disc-compose-title').textContent")
  };
  // Reply to Ben
  await a("[...document.querySelectorAll('.disc-post')].find(p => p.querySelector('strong').textContent === 'Ben R.').querySelector('.disc-reply').click()");
  await a(type(".disc-reply-box .disc-box", cfg.more + " " + cfg.short));
  await a.shot("2-ana-replying");
  await a("document.querySelector('.disc-reply-box .disc-foot .btn-primary').click()");
  await until(a, "document.querySelectorAll('.disc-replies .disc-post').length >= 1");
  out.reply = {
    nested: await a("[...document.querySelectorAll('.disc-post')].find(p => p.querySelector('strong').textContent === 'Ben R.').querySelectorAll('.disc-replies .disc-post').length"),
    boxGone: await a("!document.querySelector('.disc-reply-box .disc-box')"),
    needs: await a("document.getElementById('disc-needs').innerText.trim()")
  };
  await a.shot("3-ana-after");

  // ---- the teacher
  const t = await open(cfg.teacher, cfg.page, "#disc-counts");
  await until(t, "!document.getElementById('disc-counts').hidden");
  out.teacher = {
    rows: await t("[...document.querySelectorAll('#disc-counts tbody tr')].map(r => [...r.children].map(c => c.textContent))"),
    marks: await t("document.querySelectorAll('.disc-mark').length"),
    posts: await t("document.querySelectorAll('.disc-post').length")
  };
  await t("document.querySelector('#disc-rules [name=replies]').value = '2'; document.querySelector('#disc-rules button').click(); true");
  await until(t, "/graded again/.test(document.getElementById('disc-rules-said').textContent)");
  await sleep(400);
  out.regraded = await t("[...document.querySelectorAll('#disc-counts tbody tr')].map(r => [...r.children].map(c => c.textContent))");
  await t.shot("4-teacher");

  // ---- Ana's page on a phone: the board picked up nothing broken
  const p = await open(cfg.ana, cfg.page, ".disc-post", 390);
  out.phone = await p("document.documentElement.scrollWidth <= window.innerWidth + 1");
  await p.shot("5-phone");
} catch (e) {
  out.error = String(e && e.stack || e);
} finally {
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
}
console.log(JSON.stringify(out));
process.exit(0);
