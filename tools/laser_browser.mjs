// The laser pointer in a real Chrome, teacher and student side by side.
// Run by tools/test_laser.py, which starts the app and makes the lesson;
// not meant to be run on its own.
//
//   node tools/laser_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// WHY A REAL BROWSER. Everything the laser does is about where things are on
// a screen: which letter is under the teacher's mouse, where that letter is
// on a student's narrower one. Without layout none of it can be checked at
// all, and the first version of pointAtCode was a letter out — found only
// here. Each check prints "ok"/"FAIL" and a label; the .py turns them into
// its checks. The teacher's window is 1400 wide and the students' 1000 and
// 900, so a check that passes is not passing because the screens match.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";

const [base, setupPath, chromePath, profile] = process.argv.slice(2);
const setup = JSON.parse(fs.readFileSync(setupPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 500);

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
  async function attach(targetId, w, h) {
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    return { sessionId, targetId };
  }
  // Each page in a context of its own: teacher signed in, students not.
  async function open(path, w, h, signedIn, preload) {
    const { browserContextId } = await send("Target.createBrowserContext");
    if (signedIn) {
      await send("Storage.setCookies", { browserContextId,
        cookies: [{ name: "session", value: setup.cookie, domain: "127.0.0.1", path: "/" }] });
    }
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const p = await attach(targetId, w, h);
    if (preload) await send("Page.addScriptToEvaluateOnNewDocument", { source: preload }, p.sessionId);
    await send("Page.navigate", { url: base + path }, p.sessionId);
    return p;
  }
  const ev = async (p, expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true,
                                               awaitPromise: true, userGesture: true }, p.sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const move = (p, at, alt) => send("Input.dispatchMouseEvent",
    { type: "mouseMoved", x: at.x, y: at.y, modifiers: alt ? 1 : 0 }, p.sessionId);
  // The student's dot: lit or not, and where its centre is.
  const dot = (p) => ev(p, `(() => {
    const d = [...document.querySelectorAll(".laser-dot")].find((d) => !/trail|here/.test(d.className));
    if (!d) return { on: false };
    const m = /translate\\((-?\\d+)px, (-?\\d+)px\\)/.exec(d.style.transform);
    return { on: d.classList.contains("on"), x: m && +m[1], y: m && +m[2] }; })()`);
  // The middle of letter `nth` of `word`, in the first text under `sel` that has it.
  const letter = (p, sel, word, nth) => ev(p, `(() => {
    const root = document.querySelector(${JSON.stringify(sel)});
    if (!root) return null;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const i = n.data.indexOf(${JSON.stringify(word)});
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + ${nth}); r.setEnd(n, i + ${nth} + 1);
      const b = r.getBoundingClientRect();
      if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null; })()`);
  // The middle of a character in a page's CodeMirror (the mirror, on a student's).
  const codeChar = (p, line, ch, mirror) => ev(p, `(() => {
    const cms = [...document.querySelectorAll(".CodeMirror")].map((e) => e.CodeMirror);
    const cm = ${mirror} ? cms.find((c) => c.getOption("readOnly") === "nocursor") : cms[0];
    const c = cm.charCoords({ line: ${line}, ch: ${ch} }, "window");
    return { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 }; })()`);
  const near = (got, want) => !!(got && got.on && want
    && Math.abs(got.x - want.x) <= 4 && Math.abs(got.y - want.y) <= 4);
  const nudge = (at, dx) => ({ x: at.x + dx, y: at.y });

  // ------------------------------------------------ a coding lesson
  const T = await open("/p/" + setup.draft, 1400, 900, true,
    `sessionStorage.setItem("pyide-live-host", JSON.stringify({ code: ${JSON.stringify(setup.code)},
       path: location.pathname, slug: "" }))`);
  const St = await open("/live/" + setup.code, 1000, 800, false);
  await sleep(5000);
  say(await ev(T, `document.getElementById("go-live").textContent.trim() === "End lesson"`),
      "(the teacher's editor is live)");

  // The right half of the "i" in print: the half where the nearest gap is
  // AFTER the letter, which is where the dot used to land one letter on.
  let at = await codeChar(T, 1, 6, false);
  await move(T, nudge(at, 2), true);
  await sleep(2000);
  let want = await codeChar(St, 1, 6, true);
  say(near(await dot(St), want), "code: the dot is on the letter pointed at, not the one after",
      { got: await dot(St), want });
  say(await ev(T, `!!document.querySelector(".laser-here.on")`),
      "  and the teacher sees their own dot, for the projector");

  at = await letter(T, "#class-notes", "loop", 0);
  await move(T, at, true);
  await sleep(2000);
  want = await letter(St, "#live-notes", "loop", 0);
  say(near(await dot(St), want), "slide: the same letter on a narrower screen",
      { got: await dot(St), want });

  // Held still past FADE_MS (4 s): the beat keeps it lit.
  await sleep(5000);
  say((await dot(St)).on, "held still for five seconds, it stays lit");

  const arrows = `document.querySelector("#live-notes").nextSibling.querySelectorAll("button")`;
  await ev(St, arrows + "[1].click()");
  await sleep(500);
  say(!(await dot(St)).on, "a student who has read ahead sees no dot");
  await ev(St, arrows + "[0].click()");
  await sleep(500);
  say((await dot(St)).on, "  and sees it again on coming back");

  await move(T, nudge(at, 40), false);
  await sleep(1500);
  say(!(await dot(St)).on, "letting go of Alt puts it out for the class");

  // ------------------------------------------------ the pop-out
  await ev(T, `document.querySelector(".js-popout").click()`);
  await sleep(2500);
  const pop = (await send("Target.getTargets")).targetInfos.find((t) => t.url.includes("/notes/present"));
  const P = await attach(pop.targetId, 1280, 720);
  await sleep(1500);
  at = await letter(P, "#present-body", "loop", 0);
  await move(P, at, true);
  await sleep(2000);
  want = await letter(St, "#live-notes", "loop", 0);
  say(near(await dot(St), want), "pop-out: pointing at the projected slide", { got: await dot(St), want });
  await move(P, at, false);
  await sleep(1500);
  say(!(await dot(St)).on, "  and letting go there");

  // The teacher's laptop goes away mid-point: no Alt let go ever arrives.
  // Its network is cut first — a tab closed politely still sends its "let
  // go" as it hides, and then this would pass with no fade at all (it did).
  await move(T, await letter(T, "#class-notes", "loop", 0), true);
  await sleep(2000);
  const lit = (await dot(St)).on;
  await send("Network.enable", {}, T.sessionId);
  await send("Network.setBlockedURLs", { urls: ["*/point*"] }, T.sessionId);
  await send("Target.closeTarget", { targetId: P.targetId });
  await send("Target.closeTarget", { targetId: T.targetId });
  await sleep(6000);
  say(lit && !(await dot(St)).on, "a teacher's tab closed while pointing: the dot goes out by itself");

  // ------------------------------------------------ a lesson, presented
  const LT = await open(setup.lesson, 1400, 900, true);
  await sleep(3000);
  await ev(LT, `document.querySelector("[data-mode=present]").click(); document.getElementById("go-live").click()`);
  await sleep(2500);
  const live = await ev(LT, `document.getElementById("live-code").textContent.trim()`);
  const LS = await open("/live/" + live, 900, 700, false);
  await sleep(3500);
  await move(LT, await letter(LT, "#lesson-present-body", "sunlight", 3), true);
  await sleep(2000);
  want = await letter(LS, "#lesson-body", "sunlight", 3);
  say(near(await dot(LS), want), "lesson: pointing while presenting lands on the student's slide",
      { got: await dot(LS), want });
} catch (e) {
  say(false, "the browser run itself", String(e && e.message || e));
} finally {
  if (ws) ws.close();
  chrome.kill();
}
