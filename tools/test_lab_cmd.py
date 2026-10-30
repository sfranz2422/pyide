#!/usr/bin/env python3
"""The A+ lab's Command Prompt (static/lab/cmd.js), in node.

    python3 tools/test_lab_cmd.py

Every command a student types prints what Windows prints, from the
simulated PC (machine.js), and the differences the exam is about are the
real ones: an APIPA address is labelled "Autoconfiguration", a wrong
gateway times out where a dead adapter fails to transmit, "Non-existent
domain" is DNS answering and "timed out" is DNS not answering. A command
that prints the right shape for the wrong reason teaches the wrong thing,
so each check names the line that tells one fault from another. diskpart's
whole sequence — clean, convert, create, format, assign — is played
through and Disk Management's view of the result checked.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAB = os.path.join(ROOT, "static", "lab")

HARNESS = r"""
import fs from "fs";
const window = {};
for (const f of ["machine.js", "cmd.js"]) new Function("window", fs.readFileSync(process.argv[1] + "/" + f, "utf8"))(window);
const L = window.PyIDELab, C = window.PyIDELabCmd, CAT = JSON.parse(fs.readFileSync(process.argv[1] + "/parts.json", "utf8"));
const out = [];
const check = (label, ok, detail) => out.push([label, !!ok, detail === undefined ? "" : detail]);

// A good AM4 build, running Windows; extra drives on SATA1, SATA2, powered.
function pc(extra) {
  const items = [["case", "case-atx"], ["mb", "mb-am4-matx"], ["cpu", "cpu-am4-6g"], ["cool", "cooler-stock"], ["r1", "ram-ddr4-8"],
                 ["psu", "psu-650"], ["os", "ssd-256", { windows: true }]].concat(extra || []);
  const s = L.create(CAT, items.map(([uid, part, x]) => Object.assign({ uid, part }, x || {})));
  const i = (pl, u, n) => L.install(CAT, s, pl, u, n);
  i("case", "case"); i("board", "mb"); i("cpu", "cpu"); i("cooler", "cool"); i("ram", "r1", 0); i("psu", "psu"); i("sata", "os", 0);
  (extra || []).forEach(([uid], k) => { i("sata", uid, k + 1); L.connect(CAT, s, "sata", true, k + 1); });
  ["atx24", "cpu8"].forEach((c) => L.connect(CAT, s, c, true)); L.connect(CAT, s, "sata", true, 0); L.setMonitor(s, "board");
  L.powerOn(CAT, s);
  return s;
}
const run = (s, sess, line) => C.run(CAT, s, sess, line);
const say = (s, sess, line) => run(s, sess, line).out;

// --------------------------------------------------- ipconfig
{
  const s = pc(), u = C.session();
  const ip = say(s, u, "ipconfig");
  check("ipconfig: the address, mask and gateway, in Windows' layout",
        /IPv4 Address[ .]*: 192\.168\.1\.57/.test(ip) && /Subnet Mask[ .]*: 255\.255\.255\.0/.test(ip) && /Default Gateway[ .]*: 192\.168\.1\.1/.test(ip), ip);
  const all = say(s, u, "ipconfig /all");
  check("ipconfig /all adds the MAC, DHCP and the DNS server", /Physical Address[ .]*: 3C-7A/.test(all) && /DHCP Enabled[ .]*: Yes/.test(all)
        && /DNS Servers[ .]*: 192\.168\.1\.1/.test(all) && /Host Name/.test(all), all);
  s.os.net.lease = "stale"; L.powerOff(s); L.powerOn(CAT, s);
  const apipa = say(s, u, "ipconfig");
  check("APIPA is labelled Autoconfiguration IPv4 Address, with no gateway",
        /Autoconfiguration IPv4 Address[ .]*: 169\.254\./.test(apipa) && /Default Gateway[ .]*: *$/m.test(apipa), apipa);
  const rel = say(s, u, "ipconfig /release");
  check("/release leaves no address", !/IPv4/.test(rel) && !s.os.net.ip, rel);
  check("released, ping has no address to send from: General failure", /General failure/.test(say(s, u, "ping 192.168.1.1")));
  const ren = say(s, u, "ipconfig /renew");
  check("/renew gets a real one", /IPv4 Address[ .]*: 192\.168\.1\.57/.test(ren), ren);
  s.os.lan.dhcp = false;
  const fail = say(s, u, "ipconfig /renew");
  check("with no DHCP server, /renew says it can't contact one", /unable to contact your DHCP server/.test(fail), fail);
  s.os.lan.dhcp = true; L.renew(s);
  check("/flushdns", /Successfully flushed the DNS Resolver Cache/.test(say(s, u, "ipconfig /flushdns")));
  L.setDeviceEnabled(s, "net", false);
  const off = say(s, u, "ipconfig");
  check("a disabled adapter isn't listed at all", !/Ethernet adapter/.test(off), off);
  check("…and /renew can't work", /no adapter is in the state permissible/.test(say(s, u, "ipconfig /renew")));
}

// --------------------------------------------------- ping
{
  const s = pc(), u = C.session();
  const ok = say(s, u, "ping example.com");
  check("ping by name: 4 replies, the address in brackets, statistics",
        /Pinging example\.com \[93\.184\.215\.14\]/.test(ok) && (ok.match(/^Reply from 93\.184\.215\.14: bytes=32/mg) || []).length === 4
        && /Received = 4, Lost = 0 \(0% loss\)/.test(ok) && /Average = \d+ms/.test(ok), ok);
  check("ping -n 2 sends two", (say(s, u, "ping -n 2 192.168.1.1").match(/^Reply/mg) || []).length === 2);
  check("the router answers fast: time<1ms TTL=64", /time[<=]1?<?1?ms TTL=64/.test(say(s, u, "ping 192.168.1.1")));
  check("a name that doesn't exist", /could not find host nosuch\.example/.test(say(s, u, "ping nosuch.example")));
  L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["192.168.1.1"] });
  const gw = say(s, u, "ping 93.184.215.14");
  check("wrong gateway: the internet times out…", (gw.match(/^Request timed out\./mg) || []).length === 4 && /Lost = 4 \(100% loss\)/.test(gw), gw);
  check("…while the router still answers", /Reply from 192\.168\.1\.1/.test(say(s, u, "ping 192.168.1.1")));
  L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["10.9.9.9"] });
  check("bad DNS: by address it works…", /Received = 4/.test(say(s, u, "ping 93.184.215.14")));
  check("…by name it can't find the host", /could not find host example\.com/.test(say(s, u, "ping example.com")));
  L.setIp(s, { dhcp: true }); s.os.net.lease = "stale"; L.powerOff(s); L.powerOn(CAT, s);
  const un = say(s, u, "ping 192.168.1.1");
  check("from APIPA: Destination host unreachable, from its own address", /Reply from 169\.254\.83\.17: Destination host unreachable\./.test(un), un);
  L.setDeviceEnabled(s, "net", false);
  check("a disabled adapter: General failure", /General failure/.test(say(s, u, "ping 8.8.8.8")));
  check("ping 127.0.0.1 always answers", /Reply from 127\.0\.0\.1/.test(say(s, u, "ping 127.0.0.1")));
}

// --------------------------------------------------- tracert, nslookup, netstat
{
  const s = pc(), u = C.session();
  const tr = say(s, u, "tracert example.com");
  check("tracert: the router first, then out to the address", /^ +1 .*192\.168\.1\.1$/m.test(tr) && /^ +4 .*93\.184\.215\.14$/m.test(tr) && /Trace complete/.test(tr), tr);
  L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["192.168.1.1"] });
  const bad = say(s, u, "tracert 93.184.215.14");
  check("wrong gateway: the first hop already times out", /^ +1 +\* +\* +\* +Request timed out\./m.test(bad), bad);
  L.setIp(s, { dhcp: true });
  const ns = say(s, u, "nslookup example.com");
  check("nslookup: the server, then a non-authoritative answer", /Server: +router\.home/.test(ns) && /Non-authoritative answer:/.test(ns) && /Address: +93\.184\.215\.14/.test(ns), ns);
  const nx = say(s, u, "nslookup nosuch.example");
  check("…a name that isn't there: Non-existent domain (DNS answered)", /can't find nosuch\.example: Non-existent domain/.test(nx), nx);
  const other = say(s, u, "nslookup example.com 8.8.8.8");
  check("…asking another server by name", /Server: +dns\.google/.test(other) && /93\.184\.215\.14/.test(other), other);
  L.setIp(s, { ip: "192.168.1.80", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["10.9.9.9"] });
  const to = say(s, u, "nslookup example.com");
  check("a DNS server that isn't there: timed out (DNS didn't answer)", /DNS request timed out/.test(to) && !/Non-existent/.test(to), to);
  L.setIp(s, { dhcp: true });
  check("netstat lists the open connections", /93\.184\.215\.14:443 +ESTABLISHED/.test(say(s, u, "netstat")));
  check("netstat -a adds the listening ports", /0\.0\.0\.0:445 .*LISTENING/.test(say(s, u, "netstat -a")));
}

// --------------------------------------------------- repair, and running as administrator
{
  const s = pc(), u = C.session(), a = C.session({ admin: true });
  s.os.sysfiles = "corrupt";
  check("sfc needs an administrator", /must be an administrator/.test(say(s, u, "sfc /scannow")) && s.os.sysfiles === "corrupt");
  check("…as one, it repairs the corrupt files", /found corrupt files and successfully repaired/.test(say(s, a, "sfc /scannow")) && s.os.sysfiles === "ok");
  check("…and the second time finds none", /did not find any integrity violations/.test(say(s, a, "sfc /scannow")));
  check("chkdsk needs an administrator too", /Access Denied/.test(say(s, u, "chkdsk")));
  s.os.fsDirty = true;
  check("chkdsk (read-only) finds problems and says to use /F", /found problems\.\nRun CHKDSK with the \/F/.test(say(s, a, "chkdsk")));
  say(s, a, "chkdsk C: /f");
  check("chkdsk /f, answered N, schedules nothing", /will not check this volume/.test(say(s, a, "n")) && !s.os.chkdskAtBoot);
  const f = say(s, a, "chkdsk C: /f");
  check("chkdsk /f on C: can't run now, and asks to schedule it", /in use by another/.test(f) && /\(Y\/N\)/.test(C.prompt(a)), f);
  check("…Y schedules it", /checked the next time the system restarts/.test(say(s, a, "y")) && s.os.chkdskAtBoot && C.prompt(a).endsWith(">"));
  const r = run(s, a, "shutdown /r");
  check("shutdown /r asks the window to restart", r.action === "restart");
  L.restart(CAT, s);
  check("…and the restart fixes it", !s.os.fsDirty && /found no problems/.test(say(s, a, "chkdsk")));
  check("diskpart needs an administrator", /needs an administrator/.test(say(s, u, "diskpart")) && u.mode === "cmd");
  check("a Command Prompt as administrator starts in system32", C.prompt(a) === "C:\\Windows\\system32>" && C.prompt(u) === "C:\\Users\\student>");
}

// --------------------------------------------------- diskpart, start to finish
{
  const s = pc([["d2", "hdd-500"]]), a = C.session({ admin: true });
  say(s, a, "diskpart");
  check("diskpart: its own prompt", C.prompt(a) === "DISKPART> " && a.mode === "diskpart");
  const ld = say(s, a, "list disk");
  check("list disk: both disks, the Windows one GPT", /Disk 0 +Online +256 GB/.test(ld) && /Disk 1 +Online +500 GB +500 GB/.test(ld) && /Disk 0 .*\*$/m.test(ld), ld);
  check("without a disk selected, clean refuses", /no disk selected/.test(say(s, a, "clean")));
  say(s, a, "select disk 0");
  check("clean on the Windows disk is refused", /not allowed on the disk containing the current boot/.test(say(s, a, "clean")) && s.os.disks.os.parts.length === 1);
  check("select disk 1", /Disk 1 is now the selected disk/.test(say(s, a, "select disk 1")) && /^\* Disk 1/m.test(say(s, a, "list disk")));
  check("convert gpt", /converted the selected disk to GPT/.test(say(s, a, "convert gpt")) && s.os.disks.d2.style === "GPT");
  check("create partition primary size=102400 (100 GB)", /succeeded in creating/.test(say(s, a, "create partition primary size=102400")) && (s.os.disks.d2.parts[0] || {}).gb === 100);
  check("…it's RAW, with no letter, until formatted", (s.os.disks.d2.parts[0] || {}).fs === "RAW" && !(s.os.disks.d2.parts[0] || {}).letter);
  check("convert on a disk with a partition is refused", /not convertible/.test(say(s, a, "convert mbr")));
  check("format fs=fat32 is refused at 100 GB", /too big/.test(say(s, a, "format fs=fat32 quick")));
  check("format fs=ntfs label=\"Backup\" quick", /successfully formatted/.test(say(s, a, 'format fs=ntfs label="Backup" quick')) && (s.os.disks.d2.parts[0] || {}).fs === "NTFS" && (s.os.disks.d2.parts[0] || {}).label === "Backup");
  check("assign letter=E", /assigned the drive letter/.test(say(s, a, "assign letter=E")) && L.findVolume(s.os, "E"));
  const lv = say(s, a, "list volume");
  check("list volume: C: and E: Backup", /Volume 0 +C +Windows +NTFS/.test(lv) && /Volume 1 +E +Backup +NTFS/.test(lv) && /^\* Volume 1/m.test(lv), lv);
  check("the rest of the disk: create partition primary takes it all", /succeeded/.test(say(s, a, "create partition primary")) && (s.os.disks.d2.parts[1] || {}).gb === 400);
  check("assign with no letter takes the next free one (D:)", /assigned/.test(say(s, a, "assign")) && (s.os.disks.d2.parts[1] || {}).letter === "D");
  check("list partition marks the selected one", /^\* Partition 2/m.test(say(s, a, "list partition")));
  check("remove takes the letter off", /removed the drive letter/.test(say(s, a, "remove")) && !(s.os.disks.d2.parts[1] || {}).letter);
  check("delete partition", /deleted the selected partition/.test(say(s, a, "delete partition")) && s.os.disks.d2.parts.length === 1);
  check("clean empties it, back to not initialized", /succeeded in cleaning/.test(say(s, a, "clean")) && !s.os.disks.d2.style && !s.os.disks.d2.parts.length);
  check("create partition on an uninitialized disk makes it MBR first", /succeeded/.test(say(s, a, "create partition primary")) && s.os.disks.d2.style === "MBR");
  check("select volume 0 is C:, and delete is refused", /Volume 0 is the selected volume/.test(say(s, a, "select volume 0")) && /delete the volume it's running from/.test(say(s, a, "delete partition")));
  check("an unknown diskpart command says so", /Type HELP/.test(say(s, a, "frobnicate")));
  check("exit goes back to the prompt", /Leaving DiskPart/.test(say(s, a, "exit")) && C.prompt(a) === "C:\\Windows\\system32>");
}

// --------------------------------------------------- the rest
{
  const s = pc(), u = C.session();
  check("an unknown command: not recognized", /'frob' is not recognized as an internal or external command/.test(say(s, u, "frob")));
  check("hostname", say(s, u, "hostname") === s.os.hostname);
  s.os.procs.push({ name: "miner.exe", cpu: 97, mem: 800 });
  check("tasklist shows it", /miner\.exe/.test(say(s, u, "tasklist")));
  check("taskkill /im miner.exe /f ends it", /SUCCESS/.test(say(s, u, "taskkill /im miner.exe /f")) && !s.os.procs.some((p) => p.name === "miner.exe"));
  check("…not System", /could not be terminated/.test(say(s, u, "taskkill /im System")));
  check("systeminfo: memory in MB", /Total Physical Memory: +8,192 MB/.test(say(s, u, "systeminfo")));
  check("cd and dir", say(s, u, "cd Desktop") === "" && /Drivers/.test(say(s, u, "dir")) && /cannot find the path/.test(say(s, u, "cd Nowhere")));
  check("cls and exit are the window's", run(s, u, "cls").action === "cls" && run(s, u, "exit").action === "exit");
  check("shutdown /s turns it off", run(s, u, "shutdown /s").action === "off");
  check("help lists ipconfig", /IPCONFIG/.test(say(s, u, "help")));
}
console.log(JSON.stringify(out));
"""


def main():
    if not shutil.which("node"):
        print("node is needed: brew install node")
        sys.exit(1)
    run = subprocess.run(["node", "--input-type=module", "-e", HARNESS, LAB], capture_output=True, text=True, timeout=120)
    try:
        results = json.loads(run.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(run.stdout[-1500:], run.stderr[-2000:])
        sys.exit(1)
    bad = 0
    for label, ok, detail in results:
        bad += not ok
        print("  %-4s %-74s %s" % ("ok" if ok else "FAIL", label, "" if ok else json.dumps(detail)[:400]))
    print("\n%d checks, %s" % (len(results), "%d FAILED" % bad if bad else "all ok"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
