#!/usr/bin/env python3
"""The A+ lab's computer (static/lab/machine.js), in node.

    python3 tools/test_lab_machine.py

machine.js is the whole simulated PC: what fits where, what happens at the
power button, and the Windows-style system on it. Every scenario a student
is graded on is marked against its state, so a rule that quietly stops being
a rule — DDR4 going into a DDR5 board, a PC that boots with a dead memory
stick, a 169.254 address that reaches the internet — teaches the wrong thing
to a whole class and marks them right for it. Each rule here is played the
way a student would meet it, and the fix is played too.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MACHINE = os.path.join(ROOT, "static", "lab", "machine.js")
PARTS = os.path.join(ROOT, "static", "lab", "parts.json")

HARNESS = r"""
import fs from "fs";
const window = {};
new Function("window", fs.readFileSync(process.argv[1], "utf8"))(window);
const L = window.PyIDELab, CAT = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = [];
const check = (label, ok, detail) => out.push([label, !!ok, detail === undefined ? "" : detail]);

// A machine with these parts on the shelf; `uid`s name them in the test.
function bench(list) { return L.create(CAT, list.map(([uid, part, extra]) => Object.assign({ uid, part }, extra || {}))); }
const ins = (s, place, uid, i) => L.install(CAT, s, place, uid, i);
// A good AM5 build, ready to switch on; `tweak` changes it first.
function goodBuild(extra) {
  const s = bench([["case", "case-atx"], ["mb", "mb-am5-atx"], ["cpu", "cpu-am5-6"], ["cool", "cooler-stock"],
                   ["r1", "ram-ddr5-16"], ["r2", "ram-ddr5-16"], ["psu", "psu-650"], ["os", "nvme-1tb", { windows: true }]]
                  .concat(extra || []));
  ins(s, "case", "case"); ins(s, "board", "mb"); ins(s, "cpu", "cpu"); ins(s, "cooler", "cool");
  ins(s, "ram", "r1", 1); ins(s, "ram", "r2", 3); ins(s, "psu", "psu"); ins(s, "m2", "os", 0);
  L.connect(CAT, s, "atx24", true); L.connect(CAT, s, "cpu8", true); L.setMonitor(s, "board");
  return s;
}

// --------------------------------------------------- what fits
{
  const s = bench([["case", "case-itx"], ["atx", "mb-am5-atx"], ["itx", "mb-1700-itx"], ["cpu", "cpu-am5-6"], ["r4", "ram-ddr4-8"]]);
  check("a board needs a case to go in", !L.install(CAT, s, "board", "atx").ok);
  ins(s, "case", "case");
  const r = ins(s, "board", "atx");
  check("an ATX board doesn't fit a Mini-ITX case", !r.ok && /ATX/.test(r.why), r.why);
  check("…a Mini-ITX one does", ins(s, "board", "itx").ok);
  const c = ins(s, "cpu", "cpu");
  check("an AM5 CPU won't go in an LGA1700 socket", !c.ok && /AM5/.test(c.why) && /LGA1700/.test(c.why), c.why);
  const m = ins(s, "ram", "r4", 0);
  check("DDR4 won't go in a DDR5 board", !m.ok && /DDR4/.test(m.why), m.why);
  check("a Mini-ITX board has two memory slots", JSON.stringify(L.ramSlots(CAT, s)) === '["A1","B1"]', L.ramSlots(CAT, s));
  check("…and no third", !ins(s, "ram", "r4", 2).ok);
}
{
  const s = bench([["case", "case-atx"], ["mb", "mb-1700-matx"], ["cpu", "cpu-1700-16"], ["stock", "cooler-stock"], ["tower", "cooler-tower"],
                   ["hdd", "hdd-2tb"], ["nvme", "nvme-1tb"]]);
  ins(s, "case", "case"); ins(s, "board", "mb"); ins(s, "cpu", "cpu");
  const w = ins(s, "cooler", "stock");
  check("a 95 W cooler can't cool a 125 W CPU", !w.ok && /125/.test(w.why), w.why);
  check("…a 180 W tower cooler can", ins(s, "cooler", "tower").ok);
  check("a SATA drive doesn't go in an M.2 slot", !ins(s, "m2", "hdd", 0).ok);
  check("…an NVMe drive doesn't go on a SATA port", !ins(s, "sata", "nvme", 0).ok);
  check("the board can't come out with the CPU in it", !L.remove(CAT, s, "board").ok);
}

// --------------------------------------------------- the power button
{
  const s = goodBuild([["card", "gpu-75"]]);
  const r = L.powerOn(CAT, s);
  check("a good build starts Windows, with one short beep", r.stage === "windows" && r.beeps === "1 short" && L.running(s), r);
  const on = L.install(CAT, s, "gpu", "card");
  check("…and nothing can be installed while it's on", !on.ok && /off/.test(on.why), on.why);
}
{
  const s = goodBuild(); L.connect(CAT, s, "atx24", false);
  check("no 24-pin: nothing happens at all", L.powerOn(CAT, s).stage === "nopower");
}
{
  const s = goodBuild(); L.connect(CAT, s, "cpu8", false);
  const r = L.powerOn(CAT, s);
  check("no 8-pin CPU power: fans spin, the CPU light is on", r.stage === "nopost" && r.led === "CPU", r);
}
{
  const s = goodBuild(); L.remove(CAT, s, "ram", 1); L.remove(CAT, s, "ram", 3);
  const r = L.powerOn(CAT, s);
  check("no memory: 3 short beeps and the DRAM light", r.stage === "ram" && r.beeps === "3 short" && r.led === "DRAM", r);
}
{
  const s = goodBuild([["spare", "ram-ddr5-16"]]);
  s.items.r2.faulty = "dead";
  check("one dead stick: the same beeps", L.powerOn(CAT, s).stage === "ram");
  L.powerOff(s); L.remove(CAT, s, "ram", 3); ins(s, "ram", "spare", 3);
  check("…swapped for a good one, it starts", L.powerOn(CAT, s).stage === "windows");
}
{
  const s = goodBuild([["psu450", "psu-450"], ["big", "cpu-1700-16"]]);
  // A 16-core CPU and a 200 W card on a 450 W supply: too much.
  const t = bench([["case", "case-atx"], ["mb", "mb-1700-matx"], ["cpu", "cpu-1700-16"], ["cool", "cooler-tower"], ["r", "ram-ddr4-8"],
                   ["gpu", "gpu-200"], ["psu", "psu-450"], ["os", "nvme-1tb", { windows: true }]]);
  ["case", "board:mb", "cpu", "cooler:cool", "ram:r:0", "gpu", "psu", "m2:os:0"].forEach((x) => {
    const [place, uid, i] = x.split(":"); ins(t, place, uid || place, i === undefined ? undefined : Number(i));
  });
  L.connect(CAT, t, "atx24", true); L.connect(CAT, t, "cpu8", true); t.monitor = "gpu";
  const g = L.connect(CAT, t, "gpu8", true);
  check("a 450 W supply has no PCIe cable for the card", !g.ok, g.why);
  const r = L.powerOn(CAT, t);
  check("…and can't run a 16-core CPU and a 200 W card: on, then straight off", r.stage === "shutoff" && !t.power.on, r);
}
{
  const s = goodBuild([["gpu", "gpu-200"]]);
  ins(s, "gpu", "gpu");
  let r = L.powerOn(CAT, s);
  check("a card without its 8-pin: 1 long 3 short, the VGA light", r.stage === "video" && r.led === "VGA", r);
  L.powerOff(s); L.connect(CAT, s, "gpu8", true);
  r = L.powerOn(CAT, s);
  check("…plugged in, it starts — but the monitor's on the board's port: no picture", r.stage === "windows" && r.dark === true, r);
  L.powerOff(s); L.setMonitor(s, "gpu");
  r = L.powerOn(CAT, s);
  check("…moved to the card, there's a picture", r.stage === "windows" && !r.dark, r);
}
{
  const s = bench([["case", "case-atx"], ["mb", "mb-1700-matx"], ["cpu", "cpu-1700-6f"], ["cool", "cooler-stock"], ["r", "ram-ddr4-8"],
                   ["psu", "psu-650"], ["os", "nvme-1tb", { windows: true }]]);
  ins(s, "case", "case"); ins(s, "board", "mb"); ins(s, "cpu", "cpu"); ins(s, "cooler", "cool"); ins(s, "ram", "r", 0);
  ins(s, "psu", "psu"); ins(s, "m2", "os", 0); L.connect(CAT, s, "atx24", true); L.connect(CAT, s, "cpu8", true); s.monitor = "board";
  check("an F-model CPU (no graphics) and no card: no video", L.powerOn(CAT, s).stage === "video");
}
{
  const s = goodBuild(); L.remove(CAT, s, "m2", 0);
  check("no drive with Windows: No bootable device", L.powerOn(CAT, s).stage === "noboot");
  const d = goodBuild(); d.items.os.faulty = "dead";
  check("…nor with a dead one", L.powerOn(CAT, d).stage === "noboot");
}
{
  const s = goodBuild(); s.cmos = false;
  const r = L.powerOn(CAT, s);
  check("a flat CMOS battery: it starts, and says the settings were reset", r.stage === "windows" && r.notes.some((n) => /CMOS/.test(n)), r.notes);
}
{
  const s = goodBuild(); s.coolerSeated = false;
  L.powerOn(CAT, s);
  check("a cooler not seated: it starts", L.running(s));
  L.tick(CAT, s, 60);
  check("…the CPU gets hot", L.cpuTemp(s) >= 70, L.cpuTemp(s));
  const t = L.tick(CAT, s, 70);
  check("…and it turns itself off", t === "overheated" && !s.power.on, t);
  L.powerOn(CAT, s);
  check("next start, the event log has Kernel-Power 41", s.os.events.some((e) => e.id === 41 && e.source === "Kernel-Power"), s.os.events);
  L.powerOff(s); L.reseatCooler(s); L.powerOn(CAT, s);
  check("…reseated, it stays on and cool", L.tick(CAT, s, 600) === null && L.cpuTemp(s) < 60, L.cpuTemp(s));
}

// --------------------------------------------------- Windows: devices
{
  const s = goodBuild();
  L.powerOn(CAT, s);
  s.os.drivers.net = "missing"; L.renew(s);
  const dev = L.devices(CAT, s).find((d) => d.key === "net");
  check("no network driver: ⚠ under Other devices, with a vague name", dev.status === "missing" && dev.category === "Other devices" && dev.name === "Ethernet Controller", dev);
  check("…and no address", !s.os.net.ip || /^169\.254/.test(s.os.net.ip), s.os.net.ip);
  check("Update driver from the maker's folder fixes it, and it gets an address",
        L.updateDriver(CAT, s, "net").ok && L.devices(CAT, s).find((d) => d.key === "net").status === "ok" && s.os.net.ip === "192.168.1.57", s.os.net);
  // No maker's folder, and no internet (the network's own driver is the one missing): nowhere to get one.
  const t = goodBuild(); L.powerOn(CAT, t); t.os.drivers.net = "missing"; t.os.driverFolder = false; L.renew(t);
  const nowhere = L.updateDriver(CAT, t, "net");
  check("without the driver folder or the internet, Windows can't find a driver", !nowhere.ok && /couldn't find/.test(nowhere.why), nowhere.why);
  L.setDeviceEnabled(s, "net", false);
  check("a disabled adapter shows as disabled, and reaches nothing",
        L.devices(CAT, s).find((d) => d.key === "net").status === "disabled" && !L.reach(s, "192.168.1.1").ok);
  L.setDeviceEnabled(s, "net", true);
  check("…enabled again, it reaches the router", L.reach(s, "192.168.1.1").ok);
}

// --------------------------------------------------- Windows: disks
{
  const s = goodBuild([["ssd", "ssd-500"]]);
  ins(s, "sata", "ssd", 0);
  L.powerOn(CAT, s);
  check("a SATA drive without its power cable isn't seen", !s.os.disks.ssd);
  L.powerOff(s); L.connect(CAT, s, "sata", true, 0); L.powerOn(CAT, s);
  check("…with it, it's a new disk, not initialized", s.os.disks.ssd && s.os.disks.ssd.style === null, s.os.disks.ssd);
  check("a volume can't be made on it yet", !L.newVolume(CAT, s, "ssd", {}).ok);
  check("initialize it GPT", L.initializeDisk(s, "ssd", "GPT").ok && s.os.disks.ssd.style === "GPT");
  const f = L.newVolume(CAT, s, "ssd", { gb: 100, fs: "FAT32" });
  check("FAT32 is refused over 32 GB", !f.ok && /32 GB/.test(f.why), f.why);
  check("…the letter C: is taken", !L.newVolume(CAT, s, "ssd", { letter: "C" }).ok);
  check("a new NTFS volume takes the next letter, D:", L.newVolume(CAT, s, "ssd", { gb: 200 }).ok && L.findVolume(s.os, "D").part.fs === "NTFS");
  check("…the rest as exFAT on E:", L.newVolume(CAT, s, "ssd", { fs: "exfat", letter: "E" }).ok && L.findVolume(s.os, "E").part.gb === 300, L.findVolume(s.os, "E"));
  check("change D: to F:", L.changeLetter(s, "D", "F").ok && L.findVolume(s.os, "F") && !L.findVolume(s.os, "D"));
  check("format F: as FAT32 is refused (200 GB)", !L.formatVolume(s, "F", "FAT32").ok);
  check("C: can't be formatted or deleted", !L.formatVolume(s, "C", "NTFS").ok && !L.deleteVolume(s, "C").ok);
  check("delete E:", L.deleteVolume(s, "E").ok && !L.findVolume(s.os, "E"));
  const m = goodBuild([["hdd", "hdd-2tb"]]); ins(m, "sata", "hdd", 1); L.connect(CAT, m, "sata", true, 1); L.powerOn(CAT, m);
  L.initializeDisk(m, "hdd", "MBR");
  [1, 2, 3, 4].forEach(() => L.newVolume(CAT, m, "hdd", { gb: 100 }));
  const fifth = L.newVolume(CAT, m, "hdd", { gb: 100 });
  check("an MBR disk holds four primary partitions, not five", !fifth.ok && /four/.test(fifth.why), fifth.why);
}

// --------------------------------------------------- Windows: the network
{
  const s = goodBuild(); L.powerOn(CAT, s);
  check("on DHCP it gets 192.168.1.57, the router as gateway and DNS",
        s.os.net.ip === "192.168.1.57" && s.os.net.gateway === "192.168.1.1" && s.os.net.dns[0] === "192.168.1.1", s.os.net);
  check("…reaches the internet by name", L.reach(s, "example.com").ok);
  s.os.net.lease = "stale"; L.powerOff(s); L.powerOn(CAT, s);
  check("a lease that didn't come: APIPA, 169.254.x.x", /^169\.254\./.test(s.os.net.ip), s.os.net.ip);
  check("…which can't even reach the router", !L.reach(s, "192.168.1.1").ok);
  check("ipconfig /release then /renew gets a real address", L.release(s).ok && L.renew(s).ok && s.os.net.ip === "192.168.1.57", s.os.net);
  check("a static address with the wrong gateway: the router answers, the internet doesn't",
        L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["192.168.1.1"] }).ok
        && L.reach(s, "192.168.1.1").ok && !L.reach(s, "93.184.215.14").ok);
  check("…the right gateway: it does", L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["192.168.1.1"] }).ok
        && L.reach(s, "93.184.215.14").ok);
  L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["10.9.9.9"] });
  check("a DNS server that isn't there: addresses work, names don't",
        L.reach(s, "93.184.215.14").ok && !L.reach(s, "example.com").ok && L.reach(s, "example.com").why === "no name");
  check("…a public DNS server fixes names", L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["8.8.8.8"] }).ok
        && L.reach(s, "example.com").ok);
  check("a bad address is refused", !L.setIp(s, { ip: "192.168.1.300", mask: "255.255.255.0", gateway: "192.168.1.1" }).ok);
  check("back to automatic (DHCP)", L.setIp(s, { dhcp: true }).ok && s.os.net.ip === "192.168.1.57");
}

// --------------------------------------------------- Windows: processes, start-up, repair
{
  const s = goodBuild(); L.powerOn(CAT, s);
  s.os.procs.push({ name: "updater.exe", cpu: 96, mem: 40 });
  check("End task on a runaway process", L.endTask(s, "updater.exe").ok && !s.os.procs.some((p) => p.name === "updater.exe"));
  check("…not on System", !L.endTask(s, "System").ok);
  check("a start-up app can be disabled", L.setStartup(s, "Cloud backup", false).ok && !s.os.startup.find((x) => x.name === "Cloud backup").enabled);
  s.os.sysfiles = "corrupt";
  const f = L.sfc(s);
  check("sfc /scannow finds corrupt files and repairs them", f.found && s.os.sysfiles === "ok");
  check("…and says nothing was found the second time", !L.sfc(s).found);
  s.os.fsDirty = true;
  const c = L.chkdsk(s, "C", true);
  check("chkdsk /f on C: is scheduled for the next restart", c.found && c.scheduled && s.os.fsDirty, c);
  L.restart(CAT, s);
  check("…and the restart fixes it", !s.os.fsDirty && L.running(s));
}

// --------------------------------------------------- the state is JSON
{
  const s = goodBuild(); L.powerOn(CAT, s);
  const copy = JSON.parse(JSON.stringify(s));
  check("the whole machine is plain JSON (it's what is saved and graded)", JSON.stringify(copy) === JSON.stringify(s) && L.running(copy));
}
{
  const s = L.sandbox(CAT);
  check("the sandbox has every part, two of each memory stick, and a Windows drive",
        CAT.parts.every((p) => Object.values(s.items).some((i) => i.part === p.id))
        && Object.values(s.items).filter((i) => i.part === "ram-ddr5-16").length === 2 && s.items["windows-drive"].windows);
}
console.log(JSON.stringify(out));
"""


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    run = subprocess.run(["node", "--input-type=module", "-e", HARNESS, MACHINE, PARTS],
                         capture_output=True, text=True, timeout=120)
    try:
        results = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(run.stdout[-1500:], run.stderr[-2000:])
        sys.exit(1)
    bad = 0
    for label, ok, detail in results:
        bad += not ok
        print("  %-4s %-74s %s" % ("ok" if ok else "FAIL", label, "" if ok else json.dumps(detail)[:200]))
    print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
