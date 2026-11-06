// A FlaskIDE project in PyIDE's editor, in a real Chrome: a Flask app's
// routes and pages, a SQL project's results, a PHP site, the new tab,
// sharing, and a student's Flask assignment checked and saved. Run by
// tools/test_flask_browser.py, which starts the app and makes the
// assignment; not meant to be run on its own.
//
//   node tools/flask_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// WHY A REAL BROWSER. The app runs in Pyodide (Flask's test client) or in
// PHP compiled to WebAssembly in a worker, and its pages come back into a
// sandboxed frame under an address bar (runners/flask.js, static/flask/) —
// none of which node has. Pyodide, Flask and PHP come from the internet the
// first time, as they do for a class. Each check prints "ok"/"FAIL", a
// label and a tab of detail; the .py turns them into its checks.
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


  const preview = (p) => ev(p, "Array.from(document.querySelectorAll('#preview, .preview-frame iframe')).map(f => f.getAttribute('srcdoc') || '').join('\\n')");
  const status = (p) => ev(p, "document.querySelector('#preview-status').textContent");
  const tabs = (p) => ev(p, "[...document.querySelectorAll('#file-tabs .tab')].map(t => t.firstChild.textContent).join(',')");

  // ------------------------------------------------------ a Flask app
  let P = await open("/new?ide=flaskide");
  // The first page of a fresh profile fetches CodeMirror's modes and Pyodide's loader.
  const ready = await until(P, "(document.querySelector('#mode') || {}).textContent === 'Flask'", 60000);
  say(ready && await ev(P, "window.PYIDE.ide") === "flaskide", "a new Flask app says Flask",
      await ev(P, "(document.querySelector('#mode') || {}).textContent || document.readyState"));
  const order = await tabs(P);
  say(order === "app.py,templates/base.html,templates/index.html,templates/pet.html,static/style.css",
      "its tabs: app.py, the templates, then static/", order);
  say(await ev(P, "!!document.querySelector('#file-tabs .tab .tab-dir')"), "  each folder in grey before the name");
  say(await mode(P) === '"python"', "app.py is Python", await mode(P));

  await run(P);
  const routes = await until(P, "document.querySelector('#output').textContent.includes('Routes:')", 180000);
  say(routes, "Run starts the app and lists its routes", (await output(P)).slice(-300));
  const served = await until(P, "document.querySelector('#preview-status').textContent === '200'", 30000);
  say(served, "and shows / with a 200", { status: await status(P), out: (await output(P)).slice(-200) });

  await ev(P, "var f = document.querySelector('#preview-path'); f.value = '/pet/hamster'; f.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))");
  // The status is still / 's 200 at first: wait for the page itself.
  const went = await until(P, "Array.from(document.querySelectorAll('.preview-frame iframe')).some(f => (f.getAttribute('srcdoc') || '').includes('hamster'))", 15000);
  say(went && await status(P) === "200", "typing a path in the address bar asks the app for it", { status: await status(P) });
  await ev(P, "var f = document.querySelector('#preview-path'); f.value = '/nope'; f.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))");
  say(await until(P, "document.querySelector('#preview-status').textContent === '404'", 15000), "  and a route that isn't there is a 404");

  const good = await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  await setCode(P, good.replace("def home():", "def home(:"));
  await run(P);
  const bad = await until(P, "/SyntaxError in app\\.py/.test(document.querySelector('#output').textContent)", 30000);
  say(bad && await ev(P, "!!document.querySelector('#output-view [class*=syntax]')"),
      "a syntax error is a card, and Python's message names app.py", (await output(P)).slice(-200));
  await setCode(P, good);

  await ev(P, "window.__answer = 'templates/about.html'; document.querySelector('#new-file').click()");
  const made = await until(P, "[...document.querySelectorAll('#file-tabs .tab')].some(t => t.firstChild.textContent === 'templates/about.html')", 3000);
  say(made && (await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getValue()")).includes('{% extends "base.html" %}')
      && await mode(P) === '"htmlmixed"', "a new template starts from base.html, as HTML", await mode(P));
  await ev(P, "window.__answer = 'pages/about.html'; document.querySelector('#new-file').click()");
  say((await output(P)).includes("won't work as a file name"), "a folder Flask doesn't look in is refused", (await output(P)).slice(-160));
  await tab(P, "app.py");

  await ev(P, "document.querySelector('#run-tab').click()");
  await sleep(1500);
  let { targetInfos } = await send("Target.getTargets");
  let played = targetInfos.find((t) => t.url.endsWith("/play?ide=flaskide"));
  say(!!played, "New tab opens the app's own player", targetInfos.map((t) => t.url));
  if (played) {
    const { sessionId: Q } = await send("Target.attachToTarget", { targetId: played.targetId, flatten: true });
    say(await until(Q, "document.querySelector('#preview-status').textContent === '200'", 180000), "  which runs the app and shows /");
    await send("Target.closeTarget", { targetId: played.targetId }).catch(() => {});
  }

  // A share of a Flask app goes encoded (pack.js), past Render's firewall.
  const packed = await ev(P, "!!(window.fetch && window.fetch.packed)");
  await ev(P, "document.querySelector('#author').value = 'Smoke'; document.querySelector('#share').click()");
  const link = (await until(P, "document.querySelector('#share-url').value.includes('/s/')", 10000))
    ? await ev(P, "document.querySelector('#share-url').value") : "";
  const page = link ? await (await fetch(link)).text() : "";
  say(packed && page.includes('class="ide-flaskide') && page.includes("render_template"),
      "Share sends it encoded, and makes a Flask project's link", { packed, link });
  await close(P);

  // ------------------------------------------------ a hide-code link
  const D = await open(setup.demo);
  say(await until(D, "(document.querySelector('#preview-status') || {}).textContent === '200'", 180000)
      && !(await ev(D, "document.documentElement.innerHTML")).includes("render_template"),
      "a hide-code link runs the app and shows /, with no source on the page");
  await close(D);

  // ----------------------------------------------------- a SQL project
  P = await open("/new?ide=flaskide&kind=sql");
  await until(P, "document.querySelector('#mode').textContent === 'SQL'", 20000);
  say(await tabs(P) === "query.sql,schema.sql" && await mode(P) === '"text/x-sql"'
      && await ev(P, "document.querySelector('#run-tab').hidden"), "a SQL project opens on query.sql, with no New tab", await tabs(P));
  await run(P);
  const rows = await until(P, "document.querySelectorAll('#sql-results table.sql-table').length > 0", 180000);
  say(rows, "Run shows each query's rows as a table", (await output(P)).slice(-300));
  await close(P);

  // --------------------------------------------------------- a PHP site
  P = await open("/new?ide=flaskide&kind=php");
  await until(P, "document.querySelector('#mode').textContent === 'PHP'", 20000);
  say(await ev(P, "[...document.querySelectorAll('#file-tabs .tab')][0].textContent") === "index.php", "a PHP site opens on index.php", await tabs(P));
  await run(P);
  const pages = await until(P, "document.querySelector('#output').textContent.includes('Pages:') && document.querySelector('#preview-status').textContent === '200'", 240000);
  say(pages, "Run starts the site, lists its pages and shows /", (await output(P)).slice(-300));
  await close(P);

  // ------------------------------------------ a student's Flask assignment
  let S = await open(setup.assignment, setup.studentCookie);
  const card = await until(S, "document.querySelector('.tests-card .tests-run') && !document.querySelector('.tests-card .tests-run').hidden", 20000);
  say(card, "a Flask assignment's notes show their tests as a card");
  if (card) {
    await ev(S, "document.querySelector('.tests-card .tests-run').click()");
    const checked = await until(S, "document.querySelector('.tests-card .tests-sum').textContent.includes('passing')", 180000);
    say(checked && await ev(S, "document.querySelector('.tests-card .tests-sum').textContent") === "1 of 2 passing",
        "Check my work asks the app: one test passing, one not",
        await ev(S, "[...document.querySelectorAll('.tests-card .test-line')].map(l => l.textContent).join(' | ')"));
  }
  await ev(S, "[...document.querySelectorAll('.notes-btn')].forEach(b => b.getAttribute('aria-pressed') === 'true' && b.click())");
  const mine = await ev(S, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  await setCode(S, mine + "\n# typed by the student\n");
  await sleep(5000);
  say(alerts.length === 0, "no alerts: nothing the server refused", alerts.slice(0, 3));
  say(errors.length === 0, "no errors from the editor's own scripts", errors.slice(0, 4));
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 300));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
