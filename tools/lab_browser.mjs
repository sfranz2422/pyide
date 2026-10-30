// The A+ lab in a real Chrome: the bench (bench.js) and the computer's
// screen (desktop.js, apps.js) on /lab/sandbox. Run by
// tools/test_lab_browser.py, which starts the app; not meant to be run alone.
//
//   node tools/lab_browser.mjs <base url> <chrome> <profile dir>
//
// WHY A REAL BROWSER. machine.js is tested in node, but the bench and the
// desktop are pointer events, SVG, windows dragged by their title bars and
// dialogs over them — and a button that calls the right machine function
// but never redraws, or a dialog that refuses and closes anyway, looks fine
// to every node test. Here each step taps what a student taps. Each check
// prints "ok"/"FAIL", a label and a tab of detail; the .py turns them into
// its checks.
import WebSocket from "ws";
import { spawn } from "node:child_process";

const [base, chromePath, profile] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 500);

function say(ok, label, detail) {
  console.log((ok ? "ok   " : "FAIL ") + label + "\t" + JSON.stringify(detail === undefined ? "" : detail));
}

/* Run in the page before each part: small helpers that tap the way a
   student does. A shelf part is picked with a pointerdown on it and a
   pointerup on the document (bench.js tells a tap from a drag that way). */
const HELPERS = `
  window.T = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    q: (sel, root) => (root || document).querySelector(sel),
    all: (sel, root) => Array.from((root || document).querySelectorAll(sel)),
    has: (sel, text, root) => T.all(sel, root).find((e) => e.textContent.includes(text)),
    click: (e) => { if (!e) throw new Error("nothing to click"); e.dispatchEvent(new MouseEvent("click", { bubbles: true })); },
    tapPart: (name) => {
      const card = T.has(".lab-part", name);
      if (!card) throw new Error("no part " + name);
      card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    },
    spot: (place) => T.q('[data-place="' + place + '"]'),
    put: (name, place) => { T.tapPart(name); T.click(T.spot(place)); return (T.q(".lab-msg") || {}).textContent || ""; },
    unpick: () => T.click(T.q(".lab-stage svg")),
    start: (app) => { T.click(T.q(".ld-startbtn")); T.click(T.has(".ld-start-app", app)); },
    win: (title) => T.all(".ld-win").find((w) => T.q(".ld-win-title", w).textContent === title),
    btn: (text, root) => T.all("button", root).find((b) => b.textContent.trim().startsWith(text)),
    dialog: () => T.q(".ld-dialog"),
    dmsg: () => { const m = T.q(".ld-dialog-msg"); return m && !m.hidden ? m.textContent : ""; },
    saved: () => JSON.parse(localStorage.getItem("pyide-lab-sandbox") || "null"),
    // Type a line into a Command Prompt window and press Enter; what it printed after.
    type: (w, line) => {
      const out = T.q(".ld-term-out", w), before = out.textContent.length, input = T.q(".ld-term-in", w);
      input.value = line;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return out.textContent.slice(before);
    },
  };
`;

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
  const waiting = {}, errors = [];
  ws.on("message", (m) => {
    const d = JSON.parse(m);
    if (d.id && waiting[d.id]) { waiting[d.id](d); delete waiting[d.id]; }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++next;
    waiting[i] = (d) => (d.error ? rej(new Error(method + ": " + JSON.stringify(d.error))) : res(d.result));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: P } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, P);
  await send("Runtime.enable", {}, P);
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, P);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS }, P);
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, P);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  async function until(expr, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await ev(expr)) return true; } catch (e) { /* not loaded yet */ }
      await sleep(150);
    }
    return false;
  }
  const go = async (path) => { await send("Page.navigate", { url: base + path }, P); await until("document.readyState === 'complete' && !!document.querySelector('.lab-part, .lab-shelf')", 20000); };

  // ------------------------------------------------------------ the bench
  await go("/lab/sandbox");
  await ev("localStorage.clear()");
  await go("/lab/sandbox");
  const bench = await ev(`(async () => {
    const out = [];
    out.push(["a part dropped in its place goes in: the case", T.put("Mid-tower case", "case") === "" && !!T.q('[data-place="case"].filled')]);
    out.push(["…and the board, drawn as its photo", T.put("Micro-ATX motherboard", "board") === "" && !!T.q('.lab-board image[href*="board-matx"]')]);
    const wrong = T.put("socket AM5", "cpu"); T.unpick();
    out.push(["a CPU for another socket is refused, in machine.js's words", /AM5.*AM4/.test(wrong), wrong]);
    T.put("6-core CPU, socket AM4", "cpu");
    const before = !!T.spot("cooler");
    T.tapPart("Stock CPU cooler");
    out.push(["the cooler's place is offered only with a cooler in hand (so the CPU can be tapped)", !before && !!T.spot("cooler")]);
    T.click(T.spot("cooler"));
    out.push(["a part in the computer shows its cut-out photo", !!T.q('[data-place="cpu"] image[href$="-cut.webp"]') && !!T.q('[data-place="cooler"] image[href$="-cut.webp"]')]);
    T.click(T.spot("cooler"));
    const card = T.q(".lab-card");
    out.push(["tapping it shows its spec card, photo and credit", !!(card && T.q(".lab-card-img", card) && /CC BY/.test(T.q(".lab-credit", card).textContent))]);
    T.put("8 GB DDR4", "ram:0"); T.put("8 GB DDR4", "ram:1"); T.put("650 W", "psu"); T.put("Windows installed", "sata:0");
    T.click(T.has(".lab-conn", "24-pin")); T.click(T.has(".lab-conn", "CPU power"));
    out.push(["tapping a power connector on the board plugs its cable in", T.saved().cables.atx24 && T.saved().cables.cpu8 && T.all(".lab-conn.on").length === 2]);
    T.all(".lab-cable input").forEach((b) => { if (/SATA/.test(b.parentNode.textContent) && !b.checked) b.click(); });
    const mon = T.q("select[aria-label='Monitor cable']"); mon.value = "board"; mon.dispatchEvent(new Event("change", { bubbles: true }));
    T.click(T.btn("⏻ Power on"));
    await T.sleep(100);
    out.push(["a good build starts Windows, and the screen comes up", !T.q("#lab-monitor").hidden && !!T.q(".ld-taskbar")]);
    return out;
  })()`);
  bench.forEach(([label, ok, detail]) => say(ok, label, detail));

  // ------------------------------------------------------------ the computer
  // A PC with faults to fix, put where the page keeps its build: a blank
  // second SSD, no network driver, and a runaway process.
  await ev(`(async () => {
    const cat = await (await fetch("/static/lab/parts.json")).json(), L = window.PyIDELab;
    const s = L.create(cat, [{ uid: "case", part: "case-atx" }, { uid: "mb", part: "mb-am4-matx" }, { uid: "cpu", part: "cpu-am4-6g" },
      { uid: "cool", part: "cooler-stock" }, { uid: "r1", part: "ram-ddr4-8" }, { uid: "psu", part: "psu-650" },
      { uid: "os", part: "ssd-256", windows: true }, { uid: "new", part: "ssd-256" }]);
    const i = (pl, u, n) => L.install(cat, s, pl, u, n);
    i("case", "case"); i("board", "mb"); i("cpu", "cpu"); i("cooler", "cool"); i("ram", "r1", 0); i("psu", "psu"); i("sata", "os", 0); i("sata", "new", 1);
    ["atx24", "cpu8"].forEach((c) => L.connect(cat, s, c, true)); L.connect(cat, s, "sata", true, 0); L.connect(cat, s, "sata", true, 1);
    L.setMonitor(s, "board");
    L.powerOn(cat, s); s.os.drivers.net = "missing"; s.os.procs.push({ name: "updater.exe", cpu: 91, mem: 300 }); L.powerOff(s);
    localStorage.setItem("pyide-lab-sandbox", JSON.stringify(s));
  })()`);
  await go("/lab/sandbox");
  const desk = await ev(`(async () => {
    const out = [];
    try {
    T.click(T.btn("⏻ Power on"));
    await T.sleep(100);
    out.push(["no network driver: the taskbar says Not connected", T.q(".ld-tray").title === "Not connected", T.q(".ld-tray").title]);
    T.start("Disk Management");
    await T.sleep(50);
    out.push(["Disk Management asks to initialize the new disk as it opens", /Initialize Disk/.test((T.dialog() || {}).textContent || "")]);
    T.click(T.btn("OK", T.dialog()));
    out.push(["…and it's GPT", T.saved().os.disks.new.style === "GPT"]);
    T.click(T.q(".ld-unalloc"));
    T.click(T.btn("New Simple Volume"));
    const sel = T.all("select", T.dialog());
    sel[1].value = "FAT32";
    T.click(T.btn("Finish", T.dialog()));
    out.push(["FAT32 over 32 GB is refused, and the wizard stays open to fix it", /32 GB/.test(T.dmsg()) && !!T.dialog(), T.dmsg()]);
    sel[1].value = "NTFS"; T.all("input", T.dialog())[0].value = "100"; T.all("input", T.dialog())[1].value = "Games";
    T.click(T.btn("Finish", T.dialog()));
    out.push(["an NTFS volume is made, and listed as Games (D:)", !T.dialog() && !!T.has(".ld-table td", "Games (D:)") && T.saved().os.disks.new.parts[0].letter === "D"]);
    T.start("Device Manager");
    T.click(T.has(".ld-dev", "Ethernet Controller"));
    out.push(["Device Manager: Code 28 on the network adapter", /Code 28/.test(T.q(".ld-status").textContent)]);
    T.click(T.btn("Update driver", T.win("Device Manager")));
    T.click(T.has(".ld-choice", "Search automatically"));
    out.push(["searching online can't work without the network driver", /internet/.test(T.dmsg()), T.dmsg()]);
    T.click(T.has(".ld-choice", "Browse my computer"));
    out.push(["browsing to the maker's folder installs it", /successfully updated/.test((T.dialog() || {}).textContent || "") && T.saved().os.drivers.net === "ok"]);
    T.click(T.btn("Close", T.dialog()));
    out.push(["…and the taskbar says Connected", /^Connected/.test(T.q(".ld-tray").title), T.q(".ld-tray").title]);
    T.click(T.q(".ld-tray"));
    T.click(T.btn("Edit IP settings"));
    const d = T.dialog(), f = T.all("input", d);
    T.q("select", d).value = "manual";
    f[0].value = "192.168.1.80"; f[1].value = "255.255.255.0"; f[2].value = "192.168.1.254"; f[3].value = "192.168.1.1";
    T.click(T.btn("Save", d));
    out.push(["a static address with the wrong gateway: Settings says No internet", /No internet/.test(T.q(".ld-netcard").textContent) && T.saved().os.net.gateway === "192.168.1.254"]);
    T.click(T.btn("Edit IP settings")); T.all("input", T.dialog())[0].value = "192.168.1.300"; T.click(T.btn("Save", T.dialog()));
    out.push(["a bad address is refused in the dialog", /valid ip/.test(T.dmsg()), T.dmsg()]);
    T.click(T.btn("Cancel", T.dialog()));
    T.start("Task Manager");
    const tm = T.win("Task Manager");
    T.click(T.has("tr", "updater.exe", tm)); T.click(T.btn("End task", tm));
    out.push(["Task Manager ends the runaway process", !T.has("tr", "updater.exe", tm) && !T.saved().os.procs.some((p) => p.name === "updater.exe")]);
    T.click(T.btn("Startup apps", tm)); T.click(T.has("tr", "Cloud backup", tm)); T.click(T.btn("Disable", tm));
    out.push(["…and turns off a start-up app", T.saved().os.startup.find((x) => x.name === "Cloud backup").enabled === false]);
    T.start("Event Viewer");
    out.push(["Event Viewer lists this start's 6005", !!T.has(".ld-win td", "6005")]);
    T.start("File Explorer");
    out.push(["File Explorer shows the new drive", !!T.has(".ld-drive", "Games (D:)")]);
    const w = T.win("File Explorer"), head = T.q(".ld-win-head", w), x0 = w.offsetLeft;
    head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 300, clientY: 200 }));
    head.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 420, clientY: 240 }));
    head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 420, clientY: 240 }));
    out.push(["a window is dragged by its title bar", w.offsetLeft - x0 === 120, w.offsetLeft - x0]);
    T.click(T.q("#lab-to-bench"));
    out.push(["Back to the bench leaves it running, with a way back", T.q("#lab-monitor").hidden && !!T.btn("🖥 Show the screen")]);
    T.click(T.btn("🖥 Show the screen"));
    out.push(["…and the windows are still open", !T.q("#lab-monitor").hidden && T.all(".ld-win").length === 6, T.all(".ld-win").length]);
    T.start("Command Prompt");
    const c = T.win("Command Prompt");
    out.push(["Command Prompt: ipconfig prints the static address", T.type(c, "ipconfig").includes(": 192.168.1.80")]);
    out.push(["…sfc refuses without an administrator", /must be an administrator/.test(T.type(c, "sfc /scannow"))]);
    T.q(".ld-term-in", c).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    out.push(["…↑ brings back the last command", T.q(".ld-term-in", c).value === "sfc /scannow", T.q(".ld-term-in", c).value]);
    T.q(".ld-term-in", c).value = "";
    T.click(T.q(".ld-startbtn")); T.click(T.q(".ld-start-admin"));
    out.push(["Run as administrator asks first (User Account Control)", /allow this app to make changes/.test((T.dialog() || {}).textContent || "")]);
    T.click(T.btn("Yes", T.dialog()));
    await T.sleep(20);
    const a = T.win("Administrator: Command Prompt");
    out.push(["…and opens an administrator's Command Prompt in system32", !!a && T.q(".ld-term-prompt", a).textContent.endsWith("system32>")]);
    T.type(a, "diskpart"); T.type(a, "select disk 1"); T.type(a, "create partition primary size=51200");
    const lp = T.type(a, "list partition");
    out.push(["diskpart makes a 50 GB partition on the new disk", lp.includes("* Partition 2") && lp.includes("50 GB"), lp]);
    T.type(a, "exit");
    T.start("Disk Management");
    const dm = T.win("Disk Management");
    T.click(T.has(".ld-part", "partition 2", dm));
    out.push(["Disk Management shows it RAW, with no letter, and offers Add Drive Letter", !!T.has(".ld-table td", "RAW", dm) && !!T.btn("Add Drive Letter", dm)]);
    T.click(T.btn("Format", dm)); T.click(T.btn("OK", T.dialog()));
    T.click(T.btn("Add Drive Letter", dm)); T.click(T.btn("OK", T.dialog()));
    const made = T.saved().os.disks.new.parts[1];
    out.push(["…formats it and gives it a letter", made.fs === "NTFS" && made.letter === "E", made]);
    T.type(a, "exit");
    out.push(["exit closes the Command Prompt", !T.win("Administrator: Command Prompt")]);
    T.click(T.q(".ld-startbtn")); T.click(T.btn("⏻ Shut down"));
    out.push(["Shut down turns it off and goes back to the bench", T.q("#lab-monitor").hidden && !T.saved().power.on && !!T.btn("⏻ Power on")]);
    } catch (e) {
      // Where it stopped: the check after the last one reported.
      out.push(["the computer's steps ran to the end", false, "stopped after " + (out.length ? out[out.length - 1][0] : "the start") + ": " + e.message]);
    }
    return out;
  })()`);
  desk.forEach(([label, ok, detail]) => say(ok, label, detail));
  say(!errors.length, "no errors in the page", errors.slice(0, 3));
} catch (e) {
  say(false, "the browser run finished", String(e).slice(0, 400));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
}
