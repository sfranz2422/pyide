// A web lesson and a Flask lesson taught live, from a student's seat, in a
// real Chrome: the teacher's code in the mirror, the teacher's page, their
// own Run, and Save into their draft. Run by tools/test_live_ides_browser.py,
// which starts the app and the two lessons; not meant to be run on its own.
//
//   node tools/live_ides_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// WHY A REAL BROWSER. These are WebIDE's and FlaskIDE's own live pages,
// moved in (static/web/live.js, static/flask/live.js) and running on
// PyIDE's shared modules under PyIDE's names — a name missed in that move
// is an error only a browser shows.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";

const [base, setupPath, chromePath, profile] = process.argv.slice(2);
const setup = JSON.parse(fs.readFileSync(setupPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 500);

function say(ok, label, detail) {
  console.log((ok ? "ok   " : "FAIL ") + label + "\t" + JSON.stringify(detail === undefined ? "" : detail));
}

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });
let ws;
try {
  let url;
  for (let i = 0; i < 75 && !url; i++) {
    await sleep(200);
    try { url = (await (await fetch("http://127.0.0.1:" + port + "/json/version")).json()).webSocketDebuggerUrl; } catch (e) {}
  }
  if (!url) throw new Error("Chrome did not start");
  ws = new WebSocket(url);
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  let next = 0;
  const waiting = {};
  // Errors thrown by the EDITOR's own scripts. The student's page throws on
  // purpose below (nope()), in its own frame, so only what came from this
  // app's /static/ files counts.
  const errors = [];
  ws.on("message", (m) => {
    const d = JSON.parse(m);
    if (d.id && waiting[d.id]) { waiting[d.id](d); delete waiting[d.id]; }
    if (d.method === "Runtime.exceptionThrown") {
      const x = d.params.exceptionDetails;
      const where = (x.url || "") + " " + ((x.exception && x.exception.description) || x.text || "");
      if (where.includes("/static/")) errors.push(where.slice(0, 300));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++next;
    waiting[i] = (d) => (d.error ? rej(new Error(method + ": " + JSON.stringify(d.error))) : res(d.result));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const targets = {};
  // Before a page closes: it must not have said anything in an alert, which
  // is how the editor reports a refusal (a start or a save the server turned
  // down). Recorded, not shown — see the preload in open().
  const alerts = [];
  const close = async (p) => {
    try {
      const got = await ev(p, "window.__alerts || []");
      got.forEach((m) => alerts.push(m));
    } catch (e) { /* a page already gone */ }
    return send("Target.closeTarget", { targetId: targets[p] }).catch(() => {});
  };
  async function open(path, cookie) {
    const { browserContextId } = await send("Target.createBrowserContext");
    if (cookie) {
      await send("Storage.setCookies", { browserContextId,
        cookies: [{ name: "session", value: cookie, domain: "127.0.0.1", path: "/" }] });
    }
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    targets[sessionId] = targetId;
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.bringToFront", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false }, sessionId);
    // No dialogs in a headless run: New file's prompt answers from here.
    await send("Page.addScriptToEvaluateOnNewDocument", { source:
      "window.prompt = function () { return window.__answer || null; };" +
      "window.confirm = function () { return true; };" +
      // An alert would block the page, and every later step with it, until
      // the run timed out with nothing said: kept here instead, to be read.
      "window.__alerts = []; window.alert = function (m) { window.__alerts.push(String(m)); };" }, sessionId);
    await send("Page.navigate", { url: base + path }, sessionId);
    return sessionId;
  }
  const ev = async (p, expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true,
                                               awaitPromise: true, userGesture: true }, p);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  async function until(p, expr, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await ev(p, expr)) return true; } catch (e) { /* not loaded yet */ }
      await sleep(150);
    }
    return false;
  }
  const output = (p) => ev(p, "(document.querySelector('#output') || {}).textContent || ''");
  const shown = (p) => ev(p, "document.querySelector('#preview').getAttribute('srcdoc') || ''");
  const setCode = (p, text) => ev(p, "document.querySelector('.CodeMirror').CodeMirror.setValue(" + JSON.stringify(text) + ")");
  const tab = (p, name) => ev(p, "[...document.querySelectorAll('#file-tabs .tab')].find(t => t.firstChild.textContent === " + JSON.stringify(name) + ").click()");
  const run = (p) => ev(p, "document.querySelector('#run').click()");
  const mode = (p) => ev(p, "JSON.stringify(document.querySelector('.CodeMirror').CodeMirror.getOption('mode'))");


  const mirror = (p) => ev(p, "document.querySelector('#mirror').nextElementSibling.CodeMirror.getValue()");
  const mineCM = "document.querySelector('#mine').nextElementSibling.CodeMirror";

  // --------------------------------------------------------- a web lesson
  let W = await open(setup.web, setup.studentCookie);
  say(await until(W, "(document.querySelector('#mirror') || {}).nextElementSibling && document.querySelector('#mirror').nextElementSibling.CodeMirror && document.querySelector('#mirror').nextElementSibling.CodeMirror.getValue().includes('TEACHER CODE')", 30000),
      "a web lesson's mirror shows the teacher's code", await mirror(W).catch((e) => String(e)));
  say(await until(W, "(document.querySelector('#teacher-preview').getAttribute('srcdoc') || '').includes('THE TEACHER PAGE')", 15000),
      "  and the teacher's page");
  say((await ev(W, mineCM + ".getValue()")).includes("mine</p>"), "the student's editor starts on their own draft",
      (await ev(W, mineCM + ".getValue()")).slice(0, 120));
  await ev(W, mineCM + ".setValue('<!doctype html><h1>STUDENT PAGE</h1>')");
  await ev(W, "document.querySelector('#run').click()");
  say(await until(W, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('STUDENT PAGE')", 10000),
      "their Run shows their own page");
  await ev(W, "(document.querySelector('#live-save') || document.querySelector('#live-turn-in')).click()");
  await sleep(3000);
  await close(W);

  // ------------------------------------------------------- a Flask lesson
  let F = await open(setup.flask, setup.studentCookie);
  say(await until(F, "(document.querySelector('#mirror') || {}).nextElementSibling && document.querySelector('#mirror').nextElementSibling.CodeMirror && document.querySelector('#mirror').nextElementSibling.CodeMirror.getValue().includes('TEACHER APP')", 30000),
      "a Flask lesson's mirror shows the teacher's code", await mirror(F).catch((e) => String(e)));
  say(await until(F, "(document.querySelector('#teacher-page').getAttribute('srcdoc') || '').includes('THE TEACHER APP PAGE')", 15000),
      "  and the teacher's page");
  say((await ev(F, mineCM + ".getValue()")).includes("from flask import"), "the student's editor starts on app.py",
      (await ev(F, mineCM + ".getValue()")).slice(0, 80));
  await ev(F, "document.querySelector('#run').click()");
  say(await until(F, "document.querySelector('#preview-status').textContent === '200'", 240000),
      "their Run starts their app and shows /", await ev(F, "document.querySelector('#output').textContent.slice(-300)"));
  await ev(F, mineCM + ".setValue(" + mineCM + ".getValue() + '\\n# saved from the lesson\\n')");
  await ev(F, "(document.querySelector('#live-save') || document.querySelector('#live-turn-in')).click()");
  await sleep(3000);
  await close(F);
  // ------------------------------------------------- the teacher's side
  // A teacher with no assignments of these kinds, so Go live goes straight on
  // the air (no chooser). The page their Run made must reach the class.
  const liveCode = async (p) => (await until(p, "!document.querySelector('#live-code').hidden && document.querySelector('#live-code').textContent.trim().length > 3", 15000))
    ? (await ev(p, "document.querySelector('#live-code').textContent.trim()")) : "";
  const polled = async (code) => code ? (await (await fetch(base + "/api/live/" + code + "?v=-1")).json()) : {};

  let T = await open("/new?ide=webide", setup.teacherCookie);
  await until(T, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('Hello!')", 30000);
  await ev(T, "document.querySelector('.CodeMirror').CodeMirror.setValue('<!doctype html><h1>TAUGHT LIVE</h1>')");
  await ev(T, "document.querySelector('#run').click()");
  await sleep(1000);
  await ev(T, "document.querySelector('#go-live').click()");
  let code = await liveCode(T);
  await sleep(2500);           // the next push, after the start
  let got = await polled(code);
  say(code && (got.page || "").includes("TAUGHT LIVE") && (got.body || "").includes("TAUGHT LIVE"),
      "a teacher's Go live from a web project sends their code and the page their Run made",
      { code, body: (got.body || "").slice(0, 60), page: (got.page || "").slice(-80) });
  await close(T);

  T = await open("/new?ide=flaskide&kind=sql", setup.teacherCookie);
  // The editor up, not just #mode: the server writes "SQL" there itself, so
  // the label is in before the scripts are, and Run clicked then does nothing
  // (the same race tools/flask_browser.mjs had; see editorUp there).
  await until(T, "document.readyState === 'complete' && !!window.PYIDE && !!document.querySelector('.CodeMirror')"
    + " && (document.querySelector('#mode') || {}).textContent === 'SQL'", 60000);
  await ev(T, "document.querySelector('#run').click()");
  await until(T, "document.querySelectorAll('#sql-results table.sql-table').length > 0", 180000);
  await ev(T, "document.querySelector('#go-live').click()");
  code = await liveCode(T);
  await sleep(2500);
  got = await polled(code);
  say(code && (got.page || "").includes('"sql":true') && (got.page || "").includes("<table"),
      "and from a SQL project, its results grid", { code, page: (got.page || "").slice(0, 80) });
  await close(T);

  // Go live on the web assignment: the chooser (prompt, answered "1") and
  // the starter offer (confirm, yes) load the assignment into the editor —
  // its index.html from among its files, and no second index.html tab.
  T = await open("/new?ide=webide", setup.webTeacherCookie);
  await until(T, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('Hello!')", 30000);
  await ev(T, "window.__answer = '1'; document.querySelector('#go-live').click()");
  code = await liveCode(T);
  const loaded = await ev(T, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  const tabNames = await ev(T, "[...document.querySelectorAll('#file-tabs .tab')].map(t => t.firstChild.textContent).join(',')");
  say(code && loaded === "<!doctype html><h1>start</h1>" && tabNames === "index.html,script.js,style.css",
      "Go live on a web assignment loads its starter: index.html from its files, once", { code, loaded, tabNames });
  // And it is the document that goes out: typed into after loading, the
  // class is sent the typing (a second index.html document would be sent
  // the starter instead, with nothing on screen to say so).
  await ev(T, "document.querySelector('.CodeMirror').CodeMirror.setValue('<h1>EDITED AFTER LOAD</h1>')");
  await sleep(2500);
  got = await polled(code);
  say((got.body || "").includes("EDITED AFTER LOAD"), "  and what is typed after it reaches the class",
      (got.body || "").slice(0, 80));
  await close(T);

  say(alerts.length === 0, "no alerts: nothing the server refused", alerts.slice(0, 3));
  say(errors.length === 0, "no errors from the pages' own scripts", errors.slice(0, 4));
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 300));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
