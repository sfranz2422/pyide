#!/usr/bin/env python3
"""The A+ lab's scenarios and how they're marked: lab_checks.js (the
browser's instant check mark) against lab_checks.py (the grade).

    python3 tools/test_lab_checks.py

  * every built-in scenario starts without an error, and its start passes
    none of its tasks — switched off as saved, and switched on
  * every scenario's solution, played through machine.js the way a student
    would (and a second way where the exam has two), passes every task
  * the browser and the server mark every task the same, on both
  * the facts a check reads (boots, online, dual channel, volumes, …) are
    the same in both on 300 machines made at random, powered or not, with
    faults and network settings at random — so lab_checks.py's port of
    machine.js's power button and network can't drift from machine.js
  * a hand-edited save fails: a part put where it can't go, a uid used
    twice, a part that doesn't exist, a dead stick claimed to be fine
  * the check language: each op, on the same cases, in both

If the two disagree, a student sees ✓ and gets no points, or the other way
round, and neither says why: that is what this is for.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAB = os.path.join(ROOT, "static", "lab")
sys.path.insert(0, ROOT)
import lab_checks as LC                                       # noqa: E402
import quiz                                                   # noqa: E402
import re                                                     # noqa: E402

HARNESS = r"""
import fs from "fs";
const window = {};
for (const f of ["machine.js", "cmd.js", "lab_checks.js"]) new Function("window", fs.readFileSync(process.argv[1] + "/" + f, "utf8"))(window);
const L = window.PyIDELab, C = window.PyIDELabCmd, K = window.PyIDELabChecks;
const CAT = JSON.parse(fs.readFileSync(process.argv[1] + "/parts.json", "utf8"));
const ids = JSON.parse(process.argv[2]);
const SC = {};
ids.forEach((id) => { SC[id] = JSON.parse(fs.readFileSync(process.argv[1] + "/scenarios/" + id + ".json", "utf8")); });
const copy = (x) => JSON.parse(JSON.stringify(x));
const on = (s) => { L.powerOn(CAT, s); return s; };
const cmd = (s, line, admin) => { const sess = C.session({ admin }); return line.split("\n").map((l) => C.run(CAT, s, sess, l).out).join("\n"); };

// How a student fixes each one. A second way, where there is one, under "id/2".
const SOLVE = {
  "office-build": (s) => {
    [["case", "case"], ["board", "mb-a"], ["cpu", "cpu-g"], ["cooler", "cool"], ["ram", "r1", 0], ["ram", "r2", 1], ["psu", "psu"], ["sata", "os", 0]]
      .forEach(([p, u, i]) => L.install(CAT, s, p, u, i));
    L.connect(CAT, s, "atx24", true); L.connect(CAT, s, "cpu8", true); L.connect(CAT, s, "sata", true, 0); L.setMonitor(s, "board"); on(s);
  },
  "ram-upgrade": (s) => { L.remove(CAT, s, "ram", 0); L.install(CAT, s, "ram", "r1", 1); L.install(CAT, s, "ram", "r2", 3); on(s); },
  "new-drive": (s) => { on(s); L.initializeDisk(s, "hdd", "GPT"); L.newVolume(CAT, s, "hdd", { letter: "E", label: "Backup" }); },
  "new-drive/2": (s) => { on(s); cmd(s, "diskpart\nselect disk 1\nconvert gpt\ncreate partition primary\nformat fs=ntfs label=Backup quick\nassign letter=E\nexit", true); },
  "beeps": (s) => { L.remove(CAT, s, "ram", 1); L.install(CAT, s, "ram", "spare", 1); on(s); },
  "overheat": (s) => { L.reseatCooler(s); on(s); },
  "no-display": (s) => { L.connect(CAT, s, "gpu8", true); L.setMonitor(s, "gpu"); on(s); },
  "drivers": (s) => { on(s); L.updateDriver(CAT, s, "net", "browse"); L.setDeviceEnabled(s, "audio", true); },
  "slow-start": (s) => { on(s); L.endTask(s, "updater.exe"); L.setStartup(s, "Game launcher", false); L.setStartup(s, "Chat app", false); },
  "slow-start/2": (s) => { on(s); cmd(s, "taskkill /im updater.exe /f"); L.setStartup(s, "Game launcher", false); L.setStartup(s, "Chat app", false); },
  "apipa": (s) => { on(s); cmd(s, "ipconfig /release\nipconfig /renew"); },
  "wrong-settings": (s) => { on(s); L.setIp(s, { dhcp: true }); },
  "wrong-settings/2": (s) => { on(s); L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["8.8.8.8"] }); },
  "repair": (s) => { on(s); cmd(s, "sfc /scannow", true); const a = C.session({ admin: true }); C.run(CAT, s, a, "chkdsk C: /f"); C.run(CAT, s, a, "y"); L.restart(CAT, s); },
};

const out = { scenarios: {}, solutions: {}, random: [], forged: [], missing: [], edges: [] };
ids.forEach((id) => {
  const sc = SC[id];
  let start;
  try { start = K.start(CAT, sc); } catch (e) { out.scenarios[id] = { error: String(e) }; return; }
  const started = on(copy(start));
  out.scenarios[id] = { start, started, jsStart: K.grade(CAT, sc, start), jsStarted: K.grade(CAT, sc, started) };
  if (!SOLVE[id]) out.missing.push(id);
});
Object.keys(SOLVE).forEach((key) => {
  const id = key.split("/")[0], sc = SC[id];
  if (!sc) return;
  const s = K.start(CAT, sc);
  SOLVE[key](s);
  out.solutions[key] = { id, state: s, js: K.grade(CAT, sc, s) };
});

// ---------------------------------------------- machines made at random
// mulberry32: the same machines every run. (A plain LCG's low bits repeat
// with a short period, and rnd(10) then never comes up 0: the CPU was never
// installed, every machine was dead, and the comparison proved nothing.)
let seed = 12345;
const rnd = (n) => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) % n);
};
const pick = (a) => a[rnd(a.length)];
const parts = CAT.parts;
// Mostly whole PCs (a board and what goes with it), with a wrong part, a
// missing one, a dead stick or a loose cable often enough that every fact
// comes out both ways.
const OF = (t) => parts.filter((p) => p.type === t).map((p) => p.id);
const FOR = { "mb-am4-matx": { cpu: ["cpu-am4-6g", "cpu-am4-8"], ram: "ram-ddr4-8" }, "mb-1700-atx": { cpu: ["cpu-1700-12f"], ram: "ram-ddr5-16" } };
for (let n = 0; n < 300; n++) {
  const board = pick(Object.keys(FOR)), m = FOR[board], wild = () => !rnd(8);
  const items = [{ uid: "case", part: wild() ? pick(OF("case")) : "case-atx" }, { uid: "mb", part: board },
    { uid: "cpu", part: wild() ? pick(OF("cpu")) : pick(m.cpu) }, { uid: "cool", part: pick(OF("cooler")) },
    { uid: "psu", part: pick(OF("psu")) }, { uid: "win", part: pick(["ssd-256", "nvme-2tb"]), windows: true }, { uid: "hdd", part: "hdd-500" }];
  const sticks = 1 + rnd(4);
  for (let k = 0; k < sticks; k++) items.push({ uid: "r" + k, part: wild() ? pick(OF("ram")) : m.ram, faulty: !rnd(12) ? "dead" : undefined });
  if (rnd(2)) items.push({ uid: "gpu", part: pick(OF("gpu")) });
  const s = L.create(CAT, items.map((it) => (it.faulty ? it : { uid: it.uid, part: it.part, windows: it.windows })));
  const put = (place, uid, i) => { if (rnd(10)) L.install(CAT, s, place, uid, i); };
  ["case", "board:mb", "cpu", "cooler:cool", "psu", "gpu"].forEach((x) => { const [p, u] = x.split(":"); if (s.items[u || p]) put(p, u || p); });
  const slots = pick([[0, 1, 2, 3], [1, 3], [0, 1], [0, 2], [3, 1, 0, 2]]);
  for (let k = 0; k < sticks; k++) put("ram", "r" + k, slots[k % slots.length]);
  const winAt = CAT.parts.find((p) => p.id === s.items.win.part).iface === "M.2" ? ["m2", 0] : ["sata", rnd(2)];
  put(winAt[0], "win", winAt[1]);
  if (rnd(2)) put("sata", "hdd", 2 + rnd(2));
  ["atx24", "cpu8", "gpu8"].forEach((c) => { if (rnd(8)) L.connect(CAT, s, c, true); });
  s.sata.forEach((u, i) => { if (u && rnd(4)) L.connect(CAT, s, "sata", true, i); });
  L.setMonitor(s, rnd(5) ? (s.gpu ? "gpu" : "board") : pick(["gpu", "board", null]));
  if (!rnd(4)) s.coolerSeated = false;
  const r = L.powerOn(CAT, s);
  if (s.os && r.stage === "windows") {
    if (!rnd(4)) s.os.net.lease = "stale";
    if (!rnd(5)) s.os.drivers.net = "missing";
    if (!rnd(6)) L.setDeviceEnabled(s, "net", false);
    if (!rnd(4)) L.setIp(s, { ip: pick(["192.168.1.80", "10.0.0.5", "192.168.1.1"]), mask: pick(["255.255.255.0", "255.255.0.0"]),
                              gateway: pick(["192.168.1.1", "192.168.1.254"]), dns: [pick(["192.168.1.1", "8.8.8.8", "10.9.9.9"])] });
    if (!rnd(5)) s.os.lan.internet = false;
    if (!rnd(3)) L.powerOff(s), L.powerOn(CAT, s);
    L.disks(CAT, s).forEach((d) => {
      if (d.disk.style) return;
      L.initializeDisk(s, d.uid, pick(["GPT", "MBR"]));
      if (rnd(2)) L.newVolume(CAT, s, d.uid, { gb: 1 + rnd(200), fs: pick(["NTFS", "exFAT"]), label: pick(["", "Data"]) });
    });
  }
  if (rnd(3)) L.powerOff(s);
  out.random.push({ state: s, js: K.facts(CAT, s) });
}
// And the edges chance rarely lands on: the power supply just too small,
// then big enough, for the same PC (150 W base + 125 W CPU + 180 W card).
["psu-450", "psu-650"].forEach((psu) => {
  const s = L.create(CAT, [{ uid: "case", part: "case-atx" }, { uid: "mb", part: "mb-1700-atx" }, { uid: "cpu", part: "cpu-1700-12f" },
    { uid: "cool", part: "cooler-tower" }, { uid: "r", part: "ram-ddr5-16" }, { uid: "gpu", part: "gpu-180" }, { uid: "psu", part: psu },
    { uid: "os", part: "nvme-2tb", windows: true }]);
  [["case", "case"], ["board", "mb"], ["cpu", "cpu"], ["cooler", "cool"], ["ram", "r", 1], ["gpu", "gpu"], ["psu", "psu"], ["m2", "os", 0]]
    .forEach(([p, u, i]) => L.install(CAT, s, p, u, i));
  ["atx24", "cpu8", "gpu8"].forEach((c) => L.connect(CAT, s, c, true));
  s.cables.gpu8 = true;     // a 450 W supply has no PCIe cable; plugged anyway, to test the watts alone
  L.setMonitor(s, "gpu");
  const r = L.powerOn(CAT, copy(s));
  out.edges.push({ psu, state: s, stage: r.stage });
});

// ---------------------------------------------- hand-edited saves
/* Each starts from a scenario's SOLVED machine — one that passes — and
   writes in what install() or connect() would have refused. The part a
   save says something is never believed (sanitize), so a forgery has to
   be about where things are, with the parts the scenario really has. */
const solved = {};
const forge = (id, label, edit) => {
  if (!solved[id]) { solved[id] = K.start(CAT, SC[id]); SOLVE[id](solved[id]); }
  const s = copy(solved[id]);
  edit(s);
  out.forged.push({ id, label, state: s, js: K.facts(CAT, K.sanitize(SC[id], s)) });
};
forge("ram-upgrade", "the DDR4 stick written into the DDR5 board", (s) => { s.ram[1] = "r4"; });
// Each breaks ONE rule, in a machine that would otherwise start, so that
// rule alone is what stops it.
forge("no-display", "the AM5 CPU written into the LGA1700 socket", (s) => { s.cpu = "cpu-x"; });
forge("ram-upgrade", "the 95 W cooler written onto the 125 W CPU", (s) => { s.cooler = "cool-s"; });
forge("beeps", "one stick in two slots", (s) => { s.ram[1] = "r1"; });
forge("beeps", "a part that isn't in the scenario", (s) => { s.ram[1] = "nothing"; s.items.nothing = { part: "ram-ddr4-8" }; });
forge("ram-upgrade", "memory in a slot the board doesn't have", (s) => { s.ram[5] = s.ram[3]; s.ram[3] = null; });
forge("no-display", "the 8-pin to a card that isn't there", (s) => { s.gpu = null; s.monitor = "board"; });
forge("beeps", "the dead stick said to be fine, and put back", (s) => { s.ram[1] = "r2"; s.items.r2 = { part: "ram-ddr4-8" }; });
forge("beeps", "the dead stick said to be another part", (s) => { s.ram[1] = "r2"; s.items.r2 = { part: "ram-ddr4-8", windows: true }; });

// ---------------------------------------------- the check language
const V = { a: 3, s: "169.254.1.2", t: true, z: null, list: [{ n: "x", on: true }, { n: "y", on: false }], o: { p: { q: "deep" } } };
out.lang = [
  [{ path: "a", op: "==", value: 3 }, true], [{ path: "a", op: "==", value: "3" }, false], [{ path: "t", op: "==", value: 1 }, false],
  [{ path: "a", op: "!=", value: 4 }, true], [{ path: "missing", op: "==", value: null }, true], [{ path: "missing", op: "!=", value: null }, false],
  [{ path: "z", op: "==" }, true], [{ path: "a", op: ">=", value: 3 }, true], [{ path: "a", op: "<=", value: 2 }, false], [{ path: "s", op: ">=", value: 1 }, false],
  [{ path: "s", op: "startsWith", value: "169.254." }, true], [{ path: "s", op: "notStartsWith", value: "169.254." }, false],
  [{ path: "missing", op: "notStartsWith", value: "1" }, false], [{ path: "o.p.q", op: "==", value: "deep" }, true],
  [{ path: "o.p.q.r", op: "==", value: null }, true], [{ path: "list", op: "has", where: { n: "y", on: false } }, true],
  [{ path: "list", op: "has", where: { n: "y", on: true } }, false], [{ path: "list", op: "lacks", where: { n: "z" } }, true],
  [{ path: "list.0.n", op: "==", value: "x" }, true], [{ path: "a", op: "has", where: {} }, false], [{ path: "o", op: "==", value: null }, false],
  [{ all: [{ path: "a", op: "==", value: 3 }, { path: "t", op: "==", value: true }] }, true], [{ any: [{ path: "a", op: "==", value: 9 }] }, false],
  [{ not: { path: "a", op: "==", value: 9 } }, true], [{ path: "a", op: "frob", value: 3 }, false],
].map(([c, want]) => ({ c, want, js: K.test(c, V) }));
out.langView = V;
console.log(JSON.stringify(out));
"""

results = []


def check(label, ok, detail=""):
    results.append(bool(ok))
    print("  %-4s %-78s %s" % ("ok" if ok else "FAIL", label, "" if ok else json.dumps(detail)[:300]))


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    ids = LC.scenario_ids()
    run = subprocess.run(["node", "--input-type=module", "-e", HARNESS, LAB, json.dumps(ids)],
                         capture_output=True, text=True, timeout=180)
    try:
        out = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(run.stdout[-1500:], run.stderr[-2000:])
        sys.exit(1)

    print("Scenarios")
    check("there are built-in scenarios, and every one has a solution here", len(ids) >= 10 and not out["missing"], out["missing"])
    for sid in ids:
        sc, got = LC.scenario(sid), out["scenarios"].get(sid, {})
        if "error" in got:
            check("%s: starts" % sid, False, got["error"])
            continue
        tasks = [t["id"] for t in sc["tasks"]]
        check("%s: well formed (ticket, tasks with points and hints)" % sid,
              sc.get("ticket") and sc.get("start") in ("bench", "windows") and tasks and len(set(tasks)) == len(tasks)
              and all(t.get("points", 0) > 0 and t.get("hint") and t.get("text") for t in sc["tasks"]))
        for key, state in (("Start", got["start"]), ("Started", got["started"])):
            py = LC.grade(sc, state)
            js = got["js" + key]
            check("%s: its start passes no task (%s)" % (sid, "switched on" if key == "Started" else "as saved"),
                  not any(t["ok"] for t in py), [t["id"] for t in py if t["ok"]])
            check("%s: …the browser marks it the same" % sid, py == js, {"py": py, "js": js})
    for key, sol in sorted(out["solutions"].items()):
        sc = LC.scenario(sol["id"])
        py = LC.grade(sc, sol["state"])
        check("%s: the solution passes every task" % key, all(t["ok"] for t in py), [t["id"] for t in py if not t["ok"]])
        check("%s: …and the browser marks it the same" % key, py == sol["js"], {"py": py, "js": sol["js"]})

    print("Each ticket's starter notes (the tutorial a new lab gets)")
    for sid in ids:
        path = os.path.join(LAB, "scenarios", sid + ".md")
        md = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        tasks = {t["id"] for t in LC.scenario(sid)["tasks"]}
        named = [ln.strip() for block in re.findall(r"```lab\n(.*?)```", md, re.S) for ln in block.splitlines() if ln.strip()]
        keys = quiz.keys(md)
        check("%s: notes with questions that have keys, kept out of the student's copy" % sid,
              md and keys and all(k["has_key"] for k in keys) and "[x]" not in quiz.redact(md), len(keys))
        check("%s: …and step cards naming only real tasks, every task on one" % sid,
              named and set(named) == tasks, {"named": named, "tasks": sorted(tasks)})

    print("The two readers, on machines made at random")
    keys = ["valid", "boots", "coolerOk", "memoryGb", "dualChannel", "online", "dnsWorks", "volumes"]
    differ = []
    seen = {k: set() for k in keys}
    for n, r in enumerate(out["random"]):
        py = LC.facts(r["state"])
        for k in keys:
            seen[k].add(json.dumps(r["js"][k], sort_keys=True))
            if json.dumps(py[k], sort_keys=True) != json.dumps(r["js"][k], sort_keys=True):
                differ.append((n, k, py[k], r["js"][k]))
    check("300 machines: every fact the same in both", not differ, differ[:5])
    # The power-on order itself, past valid() (which would refuse the 8-pin
    # on a supply without one, before the watts are ever counted).
    edges = {e["psu"]: (e["stage"], LC.boots(e["state"])) for e in out["edges"]}
    check("…and at the edge: 460 W on a 450 W supply shuts off, on 650 W it starts, in both",
          edges == {"psu-450": ("shutoff", False), "psu-650": ("windows", True)}, edges)
    # Only worth anything if the machines differ: each fact both ways, or the
    # comparison above was 300 times the same easy case.
    for k in ("boots", "coolerOk", "dualChannel", "online", "dnsWorks"):
        check("…%s came out both true and false among them" % k, seen[k] >= {"true", "false"}, sorted(seen[k]))
    check("…some had volumes", len(seen["volumes"]) > 3)

    print("Hand-edited saves")
    for f in out["forged"]:
        sc = LC.scenario(f["id"])
        s = LC.sanitize(sc, f["state"])
        py = LC.facts(s)
        check("%s: doesn't boot, in both" % f["label"], not py["boots"] and not f["js"]["boots"], {"py": py["boots"], "js": f["js"]["boots"]})
        check("…and isn't graded as a pass", not any(t["ok"] for t in LC.grade(sc, f["state"]) if t["id"] == "boots"))

    print("The check language")
    for case in out["lang"]:
        py = LC.test(case["c"], out["langView"])
        check("%s %s: %s in both" % (case["c"].get("path", "") or list(case["c"])[0], case["c"].get("op", ""), case["want"]),
              py == case["js"] == case["want"], {"py": py, "js": case["js"], "want": case["want"], "c": case["c"]})

    print("\n%d checks, %s" % (len(results), "%d FAILED" % results.count(False) if False in results else "all ok"))
    sys.exit(1 if False in results else 0)


if __name__ == "__main__":
    main()
