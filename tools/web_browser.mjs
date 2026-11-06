// A web project in PyIDE's editor, in a real Chrome: the page, its console,
// a second page, Stop, auto refresh, the new tab, sharing, and a student's
// web assignment checked from its notes and saved. Run by
// tools/test_web_browser.py, which starts the app and makes the assignment;
// not meant to be run on its own.
//
//   node tools/web_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// WHY A REAL BROWSER. A web project runs in a sandboxed iframe that talks to
// the editor only by postMessage (runners/web.js, web/runner.js) — none of
// which node has, and all of which is where the move from WebIDE could
// break without a server test noticing. Each check prints "ok"/"FAIL", a
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

  // -------------------------------------------------- a new web project
  let P = await open("/new?ide=webide");
  const drawn = await until(P, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('Hello!')", 20000);
  say(drawn, "a new web project draws its page before Run", drawn ? "" : await output(P));
  say(await ev(P, "window.PYIDE.ide") === "webide" && await mode(P) === '"htmlmixed"'
      && await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getOption('indentUnit')") === 2,
      "its editor is HTML, two spaces", { mode: await mode(P) });
  // Tags close as they're typed, on their own line (the runner's
  // autoCloseTags, which the shell passes on to the editor).
  await ev(P, "var cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue('<h1'); cm.setCursor(0, 3);"
    + " cm.focus(); true");
  // a real key, so the addon's '>' binding hears it
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: ">", code: "Period", text: ">", unmodifiedText: ">" }, P);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: ">", code: "Period" }, P);
  const closed = await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  say(closed === "<h1></h1>", "typing a tag closes it, on the same line", closed);
  say(await ev(P, "[...document.querySelectorAll('#file-tabs .tab')].map(t => t.firstChild.textContent).join(',')")
      === "index.html,script.js,style.css", "its tabs are WebIDE's three files, index.html first",
      await ev(P, "[...document.querySelectorAll('#file-tabs .tab')].map(t => t.firstChild.textContent).join(',')"));

  await tab(P, "style.css");
  say(await mode(P) === '"css"', "a stylesheet's tab is CSS", await mode(P));
  await tab(P, "index.html");

  await setCode(P, "<!doctype html><h1>Logs</h1><script>console.log('hi from page')</script>");
  await run(P);
  const logged = await until(P, "document.querySelector('#output').textContent.includes('hi from page')", 10000);
  say(logged, "Run shows the page, and console.log reaches the console", await output(P));

  // In script.js: the console maps a line of a .js file back to that file
  // (web/runner.js, locate), as WebIDE always has.
  await tab(P, "script.js");
  const starterJs = await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  await setCode(P, "\n\nnope();\n");
  await tab(P, "index.html");
  await setCode(P, "<!doctype html>\n<h1>Oops</h1>\n<script src=\"script.js\"></script>");
  await run(P);
  const erred = await until(P, "/nope/.test(document.querySelector('#output').textContent) && /script\\.js/.test(document.querySelector('#output').textContent)", 10000);
  say(erred, "an error in script.js says what, and that it's in script.js", await output(P));
  await tab(P, "script.js");
  await setCode(P, starterJs);
  await tab(P, "index.html");

  await ev(P, "window.__answer = 'about.html'; document.querySelector('#new-file').click()");
  const made = await until(P, "[...document.querySelectorAll('#file-tabs .tab')].some(t => t.firstChild.textContent === 'about.html')", 3000);
  const aboutText = await ev(P, "document.querySelector('.CodeMirror').CodeMirror.getValue()");
  say(made && aboutText.includes("Back to home") && aboutText.includes('href="style.css"'),
      "a new page starts as a page, linked to the stylesheet", aboutText.slice(0, 200));
  await tab(P, "index.html");

  await setCode(P, "<!doctype html><a href=\"about.html\">About</a>"
    + "<script>setTimeout(function () { document.querySelector('a').click(); }, 100)</script>");
  await run(P);
  const moved = await until(P, "!document.querySelector('#preview-trail').hidden && document.querySelector('#preview-page').textContent === 'about.html'", 10000);
  say(moved, "a link to another page goes there, and the trail says where", await ev(P, "document.querySelector('#preview-page').textContent"));
  await ev(P, "document.querySelector('#preview-back').click()");
  say(await until(P, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('About</a>')", 5000),
      "Back goes back to it");

  // Home again with a page that stays put: the one above clicks its link
  // every time it loads, and Auto redraws whichever page is showing.
  await setCode(P, "<!doctype html><p>start</p>");
  await run(P);
  await until(P, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('start')", 5000);
  await setCode(P, "<!doctype html><p>auto one</p>");
  const auto = await until(P, "(document.querySelector('#preview').getAttribute('srcdoc') || '').includes('auto one')", 5000);
  say(auto, "the preview follows the typing (Auto)", (await shown(P)).slice(-120));

  await setCode(P, "<!doctype html><script>while (true) {}</script>");
  await run(P);
  const busy = await until(P, "!document.querySelector('#stop').hidden", 5000);
  await ev(P, "document.querySelector('#stop').click()");
  const stopped = await until(P, "document.querySelector('#stop').hidden && document.querySelector('#output').textContent.includes('— stopped —')", 5000);
  say(busy && stopped, "Stop ends a page that never finishes", { busy, stopped, out: (await output(P)).slice(-100) });
  await setCode(P, "<!doctype html><p>after stop</p>");
  await sleep(1500);
  say(!(await shown(P)).includes("after stop"), "and the typing doesn't start it again until Run");

  await setCode(P, "<!doctype html><p>in a tab of its own</p>");
  await ev(P, "document.querySelector('#run-tab').click()");
  await sleep(1500);
  const { targetInfos } = await send("Target.getTargets");
  const played = targetInfos.find((t) => t.url.endsWith("/play?ide=webide"));
  say(!!played, "New tab opens WebIDE's player", targetInfos.map((t) => t.url));
  if (played) {
    const { sessionId: Q } = await send("Target.attachToTarget", { targetId: played.targetId, flatten: true });
    const there = await until(Q, "(document.querySelector('#preview') && document.querySelector('#preview').getAttribute('srcdoc') || '').includes('in a tab of its own')", 10000);
    say(there, "  showing the page as it is now");
    await send("Target.closeTarget", { targetId: played.targetId }).catch(() => {});
  }

  await ev(P, "document.querySelector('#author').value = 'Smoke'; document.querySelector('#share').click()");
  const link = (await until(P, "document.querySelector('#share-url').value.includes('/s/')", 10000))
    ? await ev(P, "document.querySelector('#share-url').value") : "";
  const sharedPage = link ? await (await fetch(link)).text() : "";
  say(sharedPage.includes('class="ide-webide') && sharedPage.includes("in a tab of its own"),
      "Share makes a web project's link, with its page in it", link);
  await close(P);

  // ------------------------------------------- a student's web assignment
  let S = await open(setup.assignment, setup.studentCookie);
  const card = await until(S, "document.querySelector('.tests-card .tests-run') && !document.querySelector('.tests-card .tests-run').hidden", 20000);
  say(card, "a web assignment's notes show their tests as a card, with Check my work",
      await ev(S, "(document.querySelector('#notes-body') || {}).innerHTML || ''").then((h) => h.slice(0, 200)));
  if (card) {
    await ev(S, "document.querySelector('.tests-card .tests-run').click()");
    const checked = await until(S, "document.querySelector('.tests-card .tests-sum').textContent.includes('passing')", 20000);
    say(checked, "Check my work checks the page",
        await ev(S, "[...document.querySelectorAll('.tests-card .test-line')].map(l => l.textContent).join(' | ')"));
    say(await ev(S, "document.querySelector('.tests-card .tests-sum').textContent") === "1 of 2 passing",
        "  passing what the starter does, failing what it doesn't",
        await ev(S, "[...document.querySelectorAll('.tests-card .test-line')].map(l => l.textContent).join(' | ')"));
  }
  await ev(S, "[...document.querySelectorAll('.notes-btn')].forEach(b => b.getAttribute('aria-pressed') === 'true' && b.click())");
  // Their own page, typed in: the .py reads the draft afterwards to see it
  // was saved as a web project's files. Autosave waits for a pause.
  await setCode(S, setup.studentPage);
  await sleep(5000);
  say(alerts.length === 0, "no alerts: nothing the server refused", alerts.slice(0, 3));
  say(errors.length === 0, "no errors from the editor's own scripts", errors.slice(0, 4));
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 300));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
