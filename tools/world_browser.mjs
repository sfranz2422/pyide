// The block world in a real Chrome: the new tab, a hide-my-code link, and a
// student's draft. Run by tools/test_world_browser.py, which starts the app
// and makes the assignment; not meant to be run on its own.
//
//   node tools/world_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// WHY A REAL BROWSER. The world is WebGL, pointer lock, key events on its own
// canvas and a Python program taking turns with the page through WebAssembly
// stack switching — none of which node has. Each check prints "ok"/"FAIL", a
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

// SwiftShader: WebGL without a GPU, as on a headless machine.
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + port,
  "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
  "--enable-unsafe-swiftshader", "--use-angle=swiftshader"], { stdio: "ignore" });
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
  const targets = {};
  // Each part's page closed when it's done, so the next is the only page
  // there is: a page in the background gets no animation frames, and the
  // editor waits for one before a run starts.
  const close = (p) => send("Target.closeTarget", { targetId: targets[p] }).catch(() => {});
  async function open(path, cookie, preload) {
    const { browserContextId } = await send("Target.createBrowserContext");
    if (cookie) {
      await send("Storage.setCookies", { browserContextId,
        cookies: [{ name: "session", value: cookie, domain: "127.0.0.1", path: "/" }] });
    }
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    targets[sessionId] = targetId;
    await send("Page.enable", {}, sessionId);
    // In front: a background tab gets no animation frames, and the editor
    // waits for one before a run starts (repaint) — as no student's tab can
    // be, since they've just pressed Run in it.
    await send("Page.bringToFront", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (preload) await send("Page.addScriptToEvaluateOnNewDocument", { source: preload }, sessionId);
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
      await sleep(200);
    }
    return false;
  }
  const output = (p) => ev(p, "(document.querySelector('#output') || {}).textContent || ''");
  const key = (p, type, code, keyName, vk) => send("Input.dispatchKeyEvent",
    { type, code, key: keyName, windowsVirtualKeyCode: vk }, p);

  // ----------------------------------------------------- the new tab (/play)
  const PROGRAM = setup.program;
  let P = await open("/help/world");
  await until(P, "document.readyState === 'complete'", 20000);
  // With its world file: the new tab of a block-world assignment's project.
  await ev(P, `localStorage.setItem("pyide-play", ${JSON.stringify(JSON.stringify({ code: PROGRAM, files: { "world.mcpi": "" }, title: "Tower" }))})`);
  await send("Page.navigate", { url: base + "/play" }, P);
  const played = await until(P, "(document.querySelector('#output')||{}).textContent.includes('tower up')", 120000);
  say(played, "a world program plays in the new tab, by itself", played ? "" : await output(P).catch(() => ""));
  if (played) {
    await sleep(1500);
    const built = await ev(P, "[PyIDEWorld.world().get(20, 10, 20), PyIDEWorld.world().get(20, 14, 20)]");
    say(built[0] === 57 && built[1] === 57, "it builds what the program says", built);
    const stats = await ev(P, "PyIDEWorld.stats()");
    say(stats.ready && stats.meshes > 20 && stats.frames > 0, "the world is drawn", stats);
    const frames = await ev(P, `new Promise((r) => { let n = 0; const t = performance.now();
      (function f() { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else r(n); })(); })`);
    say(frames >= 20, "the page keeps drawing while the program loops", frames);
    await ev(P, "(() => { const q = PyIDEWorld.world().player; q.yaw = 0; q.pitch = 0; document.querySelector('.world-canvas').focus(); })()");
    const before = await ev(P, "PyIDEWorld.world().player.z");
    await key(P, "keyDown", "KeyW", "w", 87);
    await sleep(700);
    await key(P, "keyUp", "KeyW", "w", 87);
    const after = await ev(P, "PyIDEWorld.world().player.z");
    say(after - before > 1, "W walks the player forward", { before, after });
    const t0 = Date.now();
    await ev(P, "document.querySelector('#stop').click()");
    const stopped = await until(P, "!document.querySelector('#run').disabled && document.querySelector('#output').textContent.includes('— stopped —')", 3000);
    // Under a second: the program hears Stop at its next turn. The 1.5 s
    // backstop (stopRun) would also put the buttons back, so a Stop that never
    // reached the program would pass a looser limit.
    say(stopped && Date.now() - t0 < 1000, "Stop ends it, the buttons back within a second", { ms: Date.now() - t0 });
    const ending = await output(P);
    say(ending.includes("tidied up"), "…reaching the program as a KeyboardInterrupt", ending.slice(-120));
  }

  // ----------------------------------------------------- a hide-my-code link
  const D = await open(setup.demo);
  await until(D, "!document.querySelector('#run').disabled", 120000);
  await ev(D, "document.querySelector('#run').click()");
  const demoRan = await until(D, "(document.querySelector('#output')||{}).textContent.includes('tower up')", 120000);
  say(demoRan, "a hide-my-code link plays a world program too", demoRan ? "" : await output(D).catch(() => ""));
  if (demoRan) {
    const shown = await ev(D, "document.body.innerText.includes('setBlocks')");
    say(!shown, "…without showing its code", shown);
    await ev(D, "document.querySelector('#stop').click()");
  }
  await close(P);
  await close(D);

  // ----------------------------------------------------- a student's draft
  // Counts the saves the editor sends, to show a repeat run sends none.
  const COUNT = `window.__saves = 0; (function () { const f = window.fetch; window.fetch = function (u, o) {
    if (String(u).indexOf("/api/draft/") >= 0 && o && o.method === "POST") window.__saves++;
    return f.apply(this, arguments); }; })();`;
  const S = await open(setup.assignment, setup.studentCookie, COUNT);
  const ready = await until(S, "(document.querySelector('#output')||{}).textContent.includes('ready') && !document.querySelector('#run').disabled", 120000);
  say(ready, "a student's assignment opens in the editor", ready ? "" : await output(S).catch(() => ""));
  const ticking = await ev(S, `new Promise((r) => { let n = 0; requestAnimationFrame(function f() { if (++n < 5) requestAnimationFrame(f); else r(true); }); setTimeout(() => r(false), 3000); })`);
  if (!ticking) say(false, "the student's page gets animation frames", await ev(S, "document.visibilityState"));
  if (ready) {
    await ev(S, "document.querySelector('#run').click()");
    const finished = await until(S, "document.querySelector('#output').textContent.includes('— finished —')", 120000);
    const saved = await until(S, "window.__saves > 0 && !/Saving/.test((document.querySelector('.savestate')||{}).textContent || '')", 20000);
    say(finished && saved, "running it saves the draft, world and all",
        { finished, saves: await ev(S, "window.__saves"), output: (await output(S)).slice(-300),
          code: await ev(S, "document.querySelector('.CodeMirror').CodeMirror.getValue().slice(0, 80)") });
    const savesAfterFirst = await ev(S, "window.__saves");
    await ev(S, "document.querySelector('#run').click()");
    await until(S, "document.querySelector('#run').disabled", 5000);
    await until(S, "!document.querySelector('#run').disabled", 120000);
    await sleep(4000);
    const savesAfterSecond = await ev(S, "window.__saves");
    say(savesAfterSecond === savesAfterFirst, "the same run again saves nothing (nothing changed)",
        { savesAfterFirst, savesAfterSecond });
  }
} catch (e) {
  say(false, "the browser run itself", String(e && e.stack || e).slice(0, 300));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
