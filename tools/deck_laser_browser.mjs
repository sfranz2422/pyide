// The teacher's laser pointer over the slides they show on the class's
// screens (deck_show.js, deck_view.js). Run by tools/test_deck_laser.py,
// which starts the app and uploads the deck; not meant to be run on its own.
//
//   node tools/deck_laser_browser.mjs <base url> <setup.json> <chrome> <profile dir>
//
// The teacher's window is 1400 wide and the student's 900, and the deck's
// text is sized by the window, so the word lands somewhere else on each.
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
  // The middle of letter `nth` of `word`, in the page or (frame) in its slide frame.
  const letter = (p, word, nth, inFrame) => ev(p, `(() => {
    const f = ${inFrame} ? document.querySelector("#deck-view iframe") : null;
    const doc = f ? f.contentDocument : document;
    if (!doc || !doc.body) return null;
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const i = n.data.indexOf(${JSON.stringify(word)});
      if (i < 0) continue;
      const r = doc.createRange();
      r.setStart(n, i + ${nth}); r.setEnd(n, i + ${nth} + 1);
      const b = r.getBoundingClientRect();
      if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2, h: b.height };
    }
    return null; })()`);
  const near = (d, want) => !!(d && d.on && want && Math.abs(d.x - want.x) <= 6 && Math.abs(d.y - want.y) <= 6);
  const until = async (p, expr, ms) => { for (let t = 0; t < ms; t += 200) { if (await ev(p, expr)) return true; await sleep(200); } return false; };

  // The teacher shows the deck; a student on the lesson's page, a smaller screen.
  const T = await open("/teacher/" + setup.slug + "/slides?show=1", 1400, 900, true);
  say(await until(T, `/On students/.test((document.getElementById("deck-show-pill") || {}).textContent || "")`, 15000),
      "the teacher's deck is on the students' screens");
  const code = await ev(T, "window.DECK_SHOW.code");
  const S = await open("/live/" + code, 900, 650, false);
  say(await until(S, `!!(document.querySelector("#deck-view iframe") && document.querySelector("#deck-view iframe").contentDocument
        && /THIS/.test(document.querySelector("#deck-view iframe").contentDocument.body.textContent))`, 15000),
      "the student sees the slide");
  await sleep(500);

  // Slide 1: THIS sits after a script and a teacher's hint the class isn't sent.
  let at = await letter(T, "THIS", 1, false);
  await move(T, at, true);
  await sleep(2500);
  let want = await letter(S, "THIS", 1, true);
  say(near(await dot(S), want), "pointing at a word on the deck puts the student's dot on the same word",
      { got: await dot(S), want });
  say(await ev(T, `!!document.querySelector(".laser-here.on")`), "  and the teacher sees their own dot");
  say(await ev(S, `(() => { const d = [...document.querySelectorAll(".laser-dot")].find((d) => !/trail|here/.test(d.className));
        const c = document.getElementById("deck-view");
        return !!(d && c && +getComputedStyle(d).zIndex > +getComputedStyle(c).zIndex); })()`),
      "  and the student's dot is above the slide, not under it");
  // Let go.
  await move(T, { x: at.x + 5, y: at.y }, false);
  await sleep(2000);
  say(!(await dot(S)).on, "letting go of Alt puts the student's dot out");

  // Pointing at the deck's own controls (the Show pill), which the class
  // isn't sent: the dot goes to the nearest letter they DO have.
  const pillAt = await ev(T, `(() => { const b = document.querySelector("#deck-show-pill span").getBoundingClientRect();
    return { x: b.left + 8, y: b.top + b.height / 2 }; })()`);
  await move(T, pillAt, true);
  await sleep(2500);
  const sentP = await ev(S, `fetch("/api/live/" + location.pathname.split("/").pop() + "/deck?d=0&p=0").then(r => r.json()).then(d => d.pointer)`);
  const leadsTo = await ev(S, `(() => {
    const m = /^s:\\d+:([\\d.]*):t/.exec(${JSON.stringify(sentP || "")});
    if (!m) return "no text place";
    let n = document.querySelector("#deck-view iframe").contentDocument.body;
    for (const i of m[1].split(".")) { n = n && n.childNodes[+i]; }
    return n ? (n.nodeType === 3 ? "text: " + n.data.trim().slice(0, 20) : "node type " + n.nodeType) : "nothing"; })()`);
  say((await dot(S)).on && /^text: /.test(leadsTo),
      "pointing at the teacher's own controls aims at text the class has", { sentP, leadsTo });
  await move(T, pillAt, false);
  await sleep(1500);

  // A place that leads into something the class wasn't sent (an older page,
  // or the slide changing as it was sent) still puts the dot somewhere.
  const into = await ev(T, `(() => {
    const n = [...document.querySelectorAll(".hint")][0].firstChild;
    const r = document.createRange(); r.setStart(n, 3); r.setEnd(n, 4); const b = r.getBoundingClientRect();
    const no = window.PyIDEDeckShow.hash(window.PyIDEDeckShow.snapshot(document, window).body);
    const vp = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight });
    const p = window.LiveLaser.pointAtSlide(document.body, no, b.left + 2, b.top + b.height / 2, { bounds: vp });
    const seq = Date.now();
    return fetch("/api/live/" + window.DECK_SHOW.code + "/deck/point", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seq: seq, pointer: p, path: (seq % 1e9) + "@" + p }) }).then(() => p); })()`);
  await sleep(2000);
  say((await dot(S)).on, "a place into something the class wasn't sent still lights the dot", { into, dot: await dot(S) });
  await ev(T, `fetch("/api/live/" + window.DECK_SHOW.code + "/deck/point", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seq: Date.now(), pointer: "" }) })`);
  await sleep(1500);

  // Slide 2, after a comment in the deck.
  await ev(T, `document.getElementById("next").click()`);
  say(await until(S, `/range/.test(document.querySelector("#deck-view iframe").contentDocument.body.textContent)`, 8000),
      "the next slide reaches the student");
  await sleep(500);
  at = await letter(T, "range", 2, false);
  await move(T, at, true);
  await sleep(2500);
  want = await letter(S, "range", 2, true);
  say(near(await dot(S), want), "on the next slide too, the dot is on the word pointed at",
      { got: await dot(S), want });
  await move(T, { x: at.x, y: at.y }, false);

  // Stopping the show takes the slide and the dot away.
  await move(T, at, true);
  await sleep(1500);
  await ev(T, `document.querySelector("#deck-show-pill button").click()`);
  await sleep(3000);
  say(!(await ev(S, `!!document.querySelector("#deck-view")`)) && !(await dot(S)).on,
      "stopping the show takes the slide and the dot away");
} catch (e) {
  say(false, "the browser run itself", String(e && e.message || e));
} finally {
  if (ws) ws.close();
  chrome.kill();
}
