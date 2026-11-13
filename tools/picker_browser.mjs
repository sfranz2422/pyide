// The name picker in a real Chrome: the teacher's picker page and a
// student's class page, side by side. Run by tools/test_picker.py, which
// starts the app and signs the two in; not meant to be run on its own.
//
//   node tools/picker_browser.mjs <base url> <setup.json> <chrome> <profile dir> <shots dir>
//
// WHY A REAL BROWSER. The whole point is the trip: Pick on the teacher's
// screen, the names cycling there and landing, the server told, and the
// student's page — which only learns a picker is open from its XP news —
// switching to quick asking and flashing that very name. Each piece is
// checked on its own in node; only here do they meet. Screenshots of both
// are left in <shots dir> to look at.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";

const [base, setupPath, chromePath, profile, shots] = process.argv.slice(2);
const setup = JSON.parse(fs.readFileSync(setupPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 400);

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
  ws.on("message", (m) => {
    const d = JSON.parse(m);
    if (d.id && waiting[d.id]) { waiting[d.id](d); delete waiting[d.id]; }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++next;
    waiting[i] = (d) => (d.error ? rej(new Error(method + ": " + JSON.stringify(d.error))) : res(d.result));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  async function open(path, cookie, w, h) {
    const { browserContextId } = await send("Target.createBrowserContext");
    await send("Storage.setCookies", { browserContextId,
      cookies: [{ name: "session", value: cookie, domain: "127.0.0.1", path: "/" }] });
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    // Headless tabs count as hidden to some pages; the student's must ask.
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
    await send("Page.navigate", { url: base + path }, sessionId);
    return sessionId;
  }
  const ev = async (p, expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, p);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  async function until(p, expr, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const v = await ev(p, expr); if (v) return v; } catch (e) { /* not loaded yet */ }
      await sleep(100);
    }
    return null;
  }
  const shot = async (p, name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" }, p);
    fs.writeFileSync(shots + "/" + name + ".png", Buffer.from(data, "base64"));
  };

  const T = await open(setup.picker, setup.teacher, 1300, 850);
  const S = await open(setup.classPage, setup.student, 1000, 760);
  say(await until(T, "document.querySelectorAll('#pick-grid .picker-chip').length", 15000) === setup.count,
      "the picker lists the class's names", await ev(T, "document.querySelector('#pick-grid') && document.querySelector('#pick-grid').textContent"));
  // The student's page learns from its news that a picker is open.
  await until(S, "document.readyState === 'complete' && !!window.PyIDEXP", 15000);
  await sleep(1500);

  say(await ev(T, "document.querySelector('#pick-xp').hidden"), "no XP button before a pick");
  // Leave out who never signed in, so the name it lands on can be given XP.
  await ev(T, "(() => { const d = JSON.parse(document.getElementById('pick-data').textContent);"
    + " const no = d.names.filter(n => !n.xp).map(n => n.name);"
    + " document.querySelectorAll('#pick-grid .picker-chip').forEach(c => { if (no.includes(c.textContent.replace(/^✓ /, ''))) c.click(); }); })()");
  await ev(T, "document.querySelector('#pick-go').click()");
  const spinning = await until(T, "document.querySelector('#pick-stage').classList.contains('is-spinning')", 2000);
  const early = await ev(T, "document.querySelector('#pick-name').textContent");
  await sleep(700);
  const later = await ev(T, "document.querySelector('#pick-name').textContent");
  say(!!spinning, "Pick cycles the names on the teacher's screen", { early, later });
  const landed = await until(T, "document.querySelector('#pick-stage').classList.contains('is-landed') && document.querySelector('#pick-name').textContent", 8000);
  say(!!landed && setup.names.includes(landed), "  and lands on one of them", landed);
  say(await ev(T, "!document.querySelector('#pick-xp').hidden && !document.querySelector('#pick-xp').disabled"),
      "once landed, ⭐ Right answer is offered");
  await shot(T, "picker-teacher");

  const flash = await until(S, "(document.querySelector('.pick-flash-name') || {}).textContent", 6000);
  say(flash === landed, "the student's page flashes that name, within seconds", { flash, landed });
  const big = await ev(S, "(() => { const c = document.querySelector('.pick-flash-card'); if (!c) return null;"
    + " const r = c.getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),"
    + " size: parseFloat(getComputedStyle(document.querySelector('.pick-flash-name')).fontSize) }; })()");
  say(big && Math.abs(big.cx - 500) < 30 && Math.abs(big.cy - 380) < 40 && big.size >= 56,
      "  big, in the middle of the screen", big);
  await sleep(1200);
  await shot(S, "picker-student");
  const status = await ev(T, "document.querySelector('#pick-status').textContent");
  say(/Shown on the class's screens/.test(status), "the teacher's page says the class was shown it", status);
  await ev(T, "document.querySelector('#pick-xp').click()");
  const given = await until(T, "document.querySelector('#pick-xp.is-given') && document.querySelector('#pick-xp').textContent", 5000);
  say(!!given && given.includes(landed), "  pressed, it gives that student XP and says so", given);
  await sleep(5000);
  say(!(await ev(S, "!!document.querySelector('.pick-flash')")), "  and it goes by itself");
  // Now only who never signed in: the button is there, greyed, saying why.
  await ev(T, "document.querySelectorAll('#pick-grid .picker-chip').forEach(c => c.click())");
  await ev(T, "document.querySelector('#pick-go').click()");
  const unsigned = await until(T, "document.querySelector('#pick-stage').classList.contains('is-landed') && !document.querySelector('#pick-xp').hidden"
    + " && { disabled: document.querySelector('#pick-xp').disabled, title: document.querySelector('#pick-xp').title }", 8000);
  say(unsigned && unsigned.disabled && /signed in/.test(unsigned.title),
      "a student who never signed in can't be given XP, and the button says why", unsigned);
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 400));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
