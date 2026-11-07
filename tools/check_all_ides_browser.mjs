// The teacher's Check all on a web assignment, a Flask one and a PHP one,
// in a real Chrome: each turned-in project run against the notes' tests in
// the teacher's browser, with WebIDE's or FlaskIDE's checker (the
// assignment page picks it by the assignment's IDE). Run by
// tools/test_check_all_ides_browser.py; not meant to be run on its own.
//
//   node tools/check_all_ides_browser.mjs <base url> <setup.json> <chrome> <profile dir>
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



  for (const a of setup.assignments) {
    const T = await open("/teacher/" + a.slug, setup.teacherCookie);
    const ready = await until(T, "!!document.querySelector('#tests-check-all')", 20000);
    if (!ready) { say(false, a.label + ": Check all is on its page", ""); await close(T); continue; }
    await ev(T, "document.querySelector('#tests-check-all').click()");
    const done = await until(T, "/Checked 1 project|Stopped/.test(document.querySelector('#tests-state').textContent)", 300000);
    const said = await ev(T, "document.querySelector('#tests-state').textContent");
    say(done && /Checked 1 project/.test(said), a.label + ": Check all checks the turned-in work", said);
    const tests = await ev(T, "(document.querySelector('.fb-tests') || {}).textContent || ''");
    say(tests.indexOf(a.expect) >= 0, "  and shows " + a.expect, tests);
    await close(T);
  }
  say(alerts.length === 0, "no alerts: nothing the server refused", alerts.slice(0, 3));
  say(errors.length === 0, "no errors from the page's own scripts", errors.slice(0, 4));
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 300));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
