/* PyIDE — the A+ lab's Command Prompt: what each command prints, from the
 * simulated PC (machine.js).
 *
 * Pure, like machine.js: no DOM. A line goes in, Windows' words come out,
 * and tools/test_lab_cmd.py runs every command in node. The Command Prompt
 * window (apps.js) only shows what this returns.
 *
 *   var s = PyIDELabCmd.session({admin: true});
 *   PyIDELabCmd.prompt(s)                     -> "C:\Windows\system32>"
 *   PyIDELabCmd.run(catalog, state, s, line)  -> {out: "...", action}
 *
 * action is "cls", "exit", "off" or "restart" when the window has something
 * to do besides print. The session is the window's own (the folder it's
 * in, diskpart's selected disk, a Y/N question waiting for its answer);
 * it is never saved — what's saved is the machine, which every command
 * changes only through machine.js, as the apps do.
 *
 * THE OUTPUT IS WINDOWS' OWN, in its layout, because reading it is the A+
 * skill: "Autoconfiguration IPv4 Address" means APIPA, "Request timed out"
 * isn't "Destination host unreachable", and "Non-existent domain" is DNS
 * answering, not DNS failing. Where a student must notice a difference,
 * the difference is the real one.
 */
window.PyIDELabCmd = (function () {
  "use strict";

  var L = window.PyIDELab;
  var MAC = "3C-7A-41-2E-90-1B";
  // The route out to the internet, for tracert: the router, the ISP, a hop
  // beyond, then the place itself.
  var ISP_HOPS = ["10.20.0.1", "72.14.210.6"];

  function session(opts) {
    opts = opts || {};
    return { admin: !!opts.admin, mode: "cmd", cwd: opts.admin ? "C:\\Windows\\system32" : "C:\\Users\\student",
             disk: null, part: null, pending: null };
  }
  function prompt(s) {
    if (s.pending) return s.pending.ask;
    return s.mode === "diskpart" ? "DISKPART> " : s.cwd + ">";
  }

  function pad(text, n) { text = String(text); return text.length >= n ? text : text + new Array(n - text.length + 1).join(" "); }
  function lpad(text, n) { text = String(text); return text.length >= n ? text : new Array(n - text.length + 1).join(" ") + text; }
  function gb(n) { return n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + " TB" : n + " GB"; }
  // Windows' "key . . . . : value" lines: the dots run to the same column.
  function kv(key, value) {
    var line = "   " + key;
    while (line.length < 38) line += line.length % 2 ? " " : ".";
    return line.replace(/ $/, "") + " : " + value;
  }

  function args(line) {
    var out = [], re = /"([^"]*)"|(\S+)/g, m;
    while ((m = re.exec(line))) out.push(m[1] != null ? m[1] : m[2]);
    return out;
  }
  function flag(list, f) { return list.some(function (a) { return a.toLowerCase() === f; }); }
  function notAdmin(name) {
    return "Access denied: " + name + " needs an administrator.\nOpen Command Prompt with \"Run as administrator\" (Start menu) and try again.";
  }

  var IS_IP = /^\d{1,3}(\.\d{1,3}){3}$/;
  function adapterUp(os) { return os.net.enabled && !os.disabled.net && os.drivers.net === "ok"; }
  function serverName(state, ip) {
    var os = state.os;
    if (ip === os.lan.dns) return "router.home";
    return { "8.8.8.8": "dns.google", "1.1.1.1": "one.one.one.one", "9.9.9.9": "dns9.quad9.net" }[ip] || "UnKnown";
  }

  /* ------------------------------------------------------------ ipconfig */
  function ipconfig(cat, state, a) {
    var os = state.os, n = os.net, all = flag(a, "/all"), out = ["", "Windows IP Configuration", ""];
    if (flag(a, "/release")) {
      if (!adapterUp(os)) return "The operation failed as no adapter is in the state permissible for this operation.";
      var r = L.release(state);
      if (!r.ok) return "The operation failed as no adapter is in the state permissible for this operation.";
      return ipconfig(cat, state, []);
    }
    if (flag(a, "/renew")) {
      if (!adapterUp(os)) return "The operation failed as no adapter is in the state permissible for this operation.";
      var w = L.renew(state);
      if (!w.ok) return ["", "Windows IP Configuration", "",
        n.dhcp ? "An error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out."
               : "The operation failed as no adapter is in the state permissible for this operation."].join("\n");
      return ipconfig(cat, state, []);
    }
    if (flag(a, "/flushdns")) return "\nWindows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.";
    if (a.length && !all) return "Error: unrecognized or incomplete command line.\n\nUSAGE:\n    ipconfig [/all | /release | /renew | /flushdns]";
    if (all) {
      out.push(kv("Host Name", os.hostname), kv("Primary Dns Suffix", ""), kv("Node Type", "Hybrid"), kv("IP Routing Enabled", "No"), "");
    }
    // A disabled adapter, or one with no driver, isn't listed at all: the
    // first thing to notice when ipconfig shows nothing.
    if (!adapterUp(os)) return out.join("\n");
    out.push("Ethernet adapter Ethernet:", "");
    var apipa = /^169\.254\./.test(n.ip);
    // Released: the adapter is listed with no IPv4 lines at all, as Windows does.
    if (!n.ip && !n.released) out.push(kv("Media State", "Media disconnected"));
    out.push(kv("Connection-specific DNS Suffix", n.dhcp && n.ip && !apipa ? "home" : ""));
    if (all) {
      out.push(kv("Description", "Ethernet adapter"), kv("Physical Address", MAC),
               kv("DHCP Enabled", n.dhcp ? "Yes" : "No"), kv("Autoconfiguration Enabled", "Yes"));
    }
    if (n.ip) {
      out.push(kv("Link-local IPv6 Address", "fe80::8c2e:41ff:fe2e:901b%7"));
      out.push(kv(apipa ? "Autoconfiguration IPv4 Address" : "IPv4 Address", n.ip + (all ? "(Preferred)" : "")));
      out.push(kv("Subnet Mask", n.mask));
      if (all && n.dhcp && !apipa) {
        out.push(kv("Lease Obtained", "Today"), kv("Lease Expires", "Tomorrow"));
      }
      out.push(kv("Default Gateway", n.gateway));
      if (all) {
        if (n.dhcp && !apipa) out.push(kv("DHCP Server", os.lan.gateway));
        out.push(kv("DNS Servers", n.dns[0] || "fec0:0:0:ffff::1%1"));
        n.dns.slice(1).forEach(function (d) { out.push(pad("", 41) + d); });
      }
    } else if (n.released) {
      out.push(kv("Link-local IPv6 Address", "fe80::8c2e:41ff:fe2e:901b%7"), kv("Default Gateway", ""));
    }
    return out.join("\n");
  }

  /* ------------------------------------------------------------ ping, tracert, nslookup */
  // A name to an address, the way ping and tracert do it (through DNS).
  function resolve(state, target) {
    if (IS_IP.test(target) || target === "localhost") return { ok: true, ip: target === "localhost" ? "127.0.0.1" : target };
    return L.lookup(state, target);
  }
  function rtt(ip, state, i) {
    if (ip === "127.0.0.1" || ip === state.os.net.ip) return 0;
    if (ip.indexOf(state.os.lan.subnet + ".") === 0) return 1;
    return [14, 15, 13, 14][i % 4];
  }
  function ttl(ip, state) {
    if (ip === "127.0.0.1" || ip === state.os.net.ip) return 128;
    return ip.indexOf(state.os.lan.subnet + ".") === 0 ? 64 : 56;
  }
  function ping(cat, state, a) {
    var target = a.filter(function (x) { return x[0] !== "-" && x[0] !== "/"; })[0];
    var ni = a.findIndex(function (x) { return x.toLowerCase() === "-n"; });
    var count = ni >= 0 ? Math.max(1, Math.min(10, Number(a[ni + 1]) || 4)) : 4;
    if (ni >= 0) target = a.filter(function (x, i) { return x[0] !== "-" && i !== ni + 1; })[0];
    if (!target) return "\nUsage: ping [-n count] target_name";
    var os = state.os;
    if (!adapterUp(os) && target !== "127.0.0.1" && target !== "localhost") {
      return IS_IP.test(target) ? "\nPinging " + target + " with 32 bytes of data:\n" + Array(count + 1).join("PING: transmit failed. General failure. \n") +
             "\nPing statistics for " + target + ":\n    Packets: Sent = " + count + ", Received = 0, Lost = " + count + " (100% loss),"
             : "Ping request could not find host " + target + ". Please check the name and try again.";
    }
    var res = resolve(state, target);
    if (!res.ok) return "Ping request could not find host " + target + ". Please check the name and try again.";
    var ip = res.ip, r = L.reach(state, ip), lines = [], got = 0, times = [];
    lines.push("", "Pinging " + (ip === target ? ip : target + " [" + ip + "]") + " with 32 bytes of data:");
    for (var i = 0; i < count; i++) {
      if (r.ok) {
        var t = rtt(ip, state, i);
        times.push(t); got++;
        lines.push("Reply from " + ip + ": bytes=32 time" + (t ? "=" + t : "<1") + "ms TTL=" + ttl(ip, state));
      } else if (r.why === "unreachable") {
        lines.push("Reply from " + os.net.ip + ": Destination host unreachable.");
      } else if (r.why === "general failure") {
        lines.push("PING: transmit failed. General failure. ");
      } else {
        lines.push("Request timed out.");
      }
    }
    // "Destination host unreachable" is a reply: Windows counts it received.
    var received = r.why === "unreachable" ? count : got;
    lines.push("", "Ping statistics for " + ip + ":",
               "    Packets: Sent = " + count + ", Received = " + received + ", Lost = " + (count - received) +
               " (" + Math.round((count - received) / count * 100) + "% loss),");
    if (times.length) {
      var min = Math.min.apply(null, times), max = Math.max.apply(null, times);
      var avg = Math.round(times.reduce(function (x, y) { return x + y; }, 0) / times.length);
      lines.push("Approximate round trip times in milli-seconds:", "    Minimum = " + min + "ms, Maximum = " + max + "ms, Average = " + avg + "ms");
    }
    return lines.join("\n");
  }

  function tracert(cat, state, a) {
    var target = a[0];
    if (!target) return "\nUsage: tracert target_name";
    var os = state.os;
    var res = adapterUp(os) ? resolve(state, target) : (IS_IP.test(target) ? { ok: true, ip: target } : { ok: false });
    if (!res.ok) return "Unable to resolve target system name " + target + ".";
    var ip = res.ip, out = ["", "Tracing route to " + (ip === target ? ip : target + " [" + ip + "]"), "over a maximum of 30 hops:", ""];
    function hop(n, ms, addr) {
      var t = ms === null ? "    *   " : ms === 0 ? "   <1 ms" : lpad(ms + " ms", 8);
      out.push(lpad(n, 3) + "  " + t + " " + t + " " + t + "  " + addr);
    }
    if (!adapterUp(os) || !os.net.ip) { out.push("Transmit error: code 1231.", "", "Trace complete."); return out.join("\n"); }
    var r = L.reach(state, ip);
    if (ip === os.net.ip || ip === "127.0.0.1") { hop(1, 0, ip); out.push("", "Trace complete."); return out.join("\n"); }
    if (r.why === "unreachable") {
      out.push("  1  " + os.net.ip + "  reports: Destination host unreachable.", "", "Trace complete.");
      return out.join("\n");
    }
    var lanIp = ip.indexOf(os.lan.subnet + ".") === 0;
    if (lanIp) {
      if (r.ok) hop(1, 0, ip); else for (var k = 1; k <= 4; k++) hop(k, null, "Request timed out.");
    } else {
      // The first hop is the default gateway: wrong one, and nothing answers.
      var gwOk = os.net.gateway === os.lan.gateway;
      if (!gwOk) { for (var j = 1; j <= 4; j++) hop(j, null, "Request timed out."); out.push("  …  (every further hop times out: the trace never leaves this computer)"); }
      else {
        hop(1, 0, os.lan.gateway);
        if (!os.lan.internet) { for (var m = 2; m <= 4; m++) hop(m, null, "Request timed out."); }
        else { hop(2, 8, ISP_HOPS[0]); hop(3, 12, ISP_HOPS[1]); hop(4, 14, ip); }
      }
    }
    out.push("", "Trace complete.");
    return out.join("\n");
  }

  function nslookup(cat, state, a) {
    var name = a[0], os = state.os, server = a[1] || (os.net.dns || [])[0];
    if (!name) return "Usage: nslookup name [server]";
    if (!adapterUp(os) || !server) {
      return "*** Default servers are not available\nServer:  UnKnown\nAddress:  127.0.0.1\n\n*** UnKnown can't find " + name + ": No response from server";
    }
    var r = L.lookup(state, name, server);
    if (r.why === "timeout") {
      return "DNS request timed out.\n    timeout was 2 seconds.\nServer:  UnKnown\nAddress:  " + server + "\n\n" +
             "DNS request timed out.\n    timeout was 2 seconds.\n*** Request to UnKnown timed-out";
    }
    var head = "Server:  " + serverName(state, server) + "\nAddress:  " + server + "\n\n";
    if (!r.ok) return head + "*** " + serverName(state, server) + " can't find " + name + ": Non-existent domain";
    return head + "Non-authoritative answer:\nName:    " + name.toLowerCase() + "\nAddress:  " + r.ip;
  }

  function netstat(cat, state, a) {
    var os = state.os, out = ["", "Active Connections", "", "  " + pad("Proto", 7) + pad("Local Address", 23) + pad("Foreign Address", 23) + "State"];
    function row(local, remote, st) { out.push("  " + pad("TCP", 7) + pad(local, 23) + pad(remote, 23) + st); }
    if (flag(a, "-a") || flag(a, "-an") || flag(a, "-na")) { row("0.0.0.0:135", "0.0.0.0:0", "LISTENING"); row("0.0.0.0:445", "0.0.0.0:0", "LISTENING"); }
    if (L.online(state) && L.dnsWorks(state)) {
      row(os.net.ip + ":49712", "93.184.215.14:443", "ESTABLISHED");
      row(os.net.ip + ":49715", "104.18.7.29:443", "ESTABLISHED");
    }
    return out.join("\n");
  }

  /* ------------------------------------------------------------ repair */
  function chkdsk(cat, state, s, a) {
    var letter = (a.find(function (x) { return /^[a-z]:?$/i.test(x); }) || "C").replace(":", "").toUpperCase();
    var fix = flag(a, "/f") || flag(a, "/r");
    if (!s.admin) return "Access Denied as you do not have sufficient privileges or\nthe disk may be locked by another process.\n\nYou have to invoke this utility running in elevated mode\nand make sure the disk is unlocked.";
    var v = L.findVolume(state.os, letter);
    if (!v) return "Cannot open volume for direct access.";
    if (v.part.fs === "RAW") return "The type of the file system is RAW.\nCHKDSK is not available for RAW drives.";
    var head = "The type of the file system is " + v.part.fs + ".\nVolume label is " + (v.part.label || "") + ".\n\n";
    if (fix && letter === "C") {
      s.pending = { ask: "Would you like to schedule this volume to be\nchecked the next time the system restarts? (Y/N) ", run: function (yes) {
        if (!yes) return "\nChkdsk will not check this volume.";
        L.chkdsk(state, "C", true);
        return "\nThis volume will be checked the next time the system restarts.";
      } };
      return head + "Chkdsk cannot run because the volume is in use by another\nprocess.";
    }
    var r = L.chkdsk(state, letter, fix);
    var stages = "Stage 1: Examining basic file system structure ...\nStage 2: Examining file name linkage ...\nStage 3: Examining security descriptors ...\n\n";
    if (!fix) {
      return head + "WARNING!  /F parameter not specified.\nRunning CHKDSK in read-only mode.\n\n" + stages +
             (r.found ? "Windows has scanned the file system and found problems.\nRun CHKDSK with the /F (fix) option to correct these."
                      : "Windows has scanned the file system and found no problems.\nNo further action is required.");
    }
    return head + stages + (r.found ? "Windows has made corrections to the file system.\nNo further action is required."
                                    : "Windows has scanned the file system and found no problems.\nNo further action is required.");
  }

  function sfc(cat, state, s, a) {
    if (!flag(a, "/scannow")) return "\nUsage:\nSFC [/SCANNOW] [/VERIFYONLY]\n\n/SCANNOW  Scans integrity of all protected system files and repairs files with\n          problems when possible.";
    if (!s.admin) return "You must be an administrator running a console session in order to\nuse the sfc utility.";
    var r = L.sfc(state);
    return "\nBeginning system scan.  This process will take some time.\n\nBeginning verification phase of system scan.\nVerification 100% complete.\n\n" +
           (r.found ? "Windows Resource Protection found corrupt files and successfully repaired\nthem. For online repairs, details are included in the CBS log file located at\nwindir\\Logs\\CBS\\CBS.log."
                    : "Windows Resource Protection did not find any integrity violations.");
  }

  /* ------------------------------------------------------------ diskpart */
  function dpDisks(cat, state) { return L.disks(cat, state); }
  // Volumes, numbered across the disks as diskpart numbers them.
  function dpVolumes(cat, state) {
    var out = [];
    dpDisks(cat, state).forEach(function (d) {
      d.disk.parts.forEach(function (v, i) { out.push({ n: out.length, uid: d.uid, i: i, v: v }); });
    });
    return out;
  }
  var DP_HELP = ["", "  CLEAN       - Clear the configuration information, or all information, off the disk.",
    "  CONVERT     - Convert between different disk formats (CONVERT GPT, CONVERT MBR).",
    "  CREATE      - Create a partition (CREATE PARTITION PRIMARY [SIZE=n]; n in MB).",
    "  DELETE      - Delete the selected partition (DELETE PARTITION).",
    "  EXIT        - Exit DiskPart.",
    "  FORMAT      - Format the volume or partition (FORMAT FS=NTFS [LABEL=\"name\"] [QUICK]).",
    "  ASSIGN      - Assign a drive letter (ASSIGN [LETTER=E]).",
    "  REMOVE      - Remove a drive letter (REMOVE [LETTER=E]).",
    "  LIST        - Display a list of objects (LIST DISK, LIST PARTITION, LIST VOLUME).",
    "  SELECT      - Shift the focus to an object (SELECT DISK n, SELECT PARTITION n, SELECT VOLUME n).",
    "  HELP        - Display a list of commands."].join("\n");
  function diskpart(cat, state, s, line) {
    var a = args(line), w = a.map(function (x) { return x.toLowerCase(); }), os = state.os;
    var opt = function (k) { var m = a.find(function (x) { return x.toLowerCase().indexOf(k + "=") === 0; }); return m ? m.slice(k.length + 1).replace(/^"|"$/g, "") : null; };
    var disks = dpDisks(cat, state), disk = disks.find(function (d) { return d.uid === s.disk; });
    var NODISK = "\nThere is no disk selected.\nPlease select a disk and try again.";
    var NOPART = "\nThere is no partition selected.\nPlease select a partition and try again.";
    if (!w.length) return "";
    if (w[0] === "exit") { s.mode = "cmd"; s.disk = null; s.part = null; return "\nLeaving DiskPart..."; }
    if (w[0] === "help" || w[0] === "?") return DP_HELP;
    if (w[0] === "list" && w[1] === "disk") {
      var rows = ["", "  Disk ###  Status         Size     Free     Dyn  Gpt", "  --------  -------------  -------  -------  ---  ---"];
      disks.forEach(function (d) {
        rows.push((d.uid === s.disk ? "* " : "  ") + pad("Disk " + d.n, 10) + pad("Online", 15) + lpad(gb(d.part.gb), 7) + "  " +
                  lpad(d.free ? gb(d.free) : "0 B", 7) + "        " + (d.disk.style === "GPT" ? "*" : ""));
      });
      return rows.join("\n");
    }
    if (w[0] === "list" && w[1] === "volume") {
      var vr = ["", "  Volume ###  Ltr  Label        Fs     Type        Size     Status     Info",
                    "  ----------  ---  -----------  -----  ----------  -------  ---------  --------"];
      dpVolumes(cat, state).forEach(function (x) {
        var sel = x.uid === s.disk && x.i === s.part;
        vr.push((sel ? "* " : "  ") + pad("Volume " + x.n, 12) + pad(" " + (x.v.letter || ""), 5) + pad((x.v.label || "").slice(0, 11), 13) +
                pad(x.v.fs, 7) + pad("Partition", 12) + lpad(gb(x.v.gb), 7) + "  " + pad("Healthy", 11) + (x.v.letter === "C" ? "Boot" : ""));
      });
      return vr.join("\n");
    }
    if (w[0] === "list" && w[1] === "partition") {
      if (!disk) return NODISK;
      if (!disk.disk.parts.length) return "\nThere are no partitions on this disk to show.";
      var pr = ["", "  Partition ###  Type              Size     Offset", "  -------------  ----------------  -------  -------"];
      disk.disk.parts.forEach(function (v, i) {
        pr.push((i === s.part ? "* " : "  ") + pad("Partition " + (i + 1), 15) + pad("Primary", 18) + lpad(gb(v.gb), 7) + "  " + lpad("1024 KB", 7));
      });
      return pr.join("\n");
    }
    if (w[0] === "select" && w[1] === "disk") {
      var d = disks.find(function (x) { return String(x.n) === a[2]; });
      if (!d) return "\nThe disk you specified is not valid.\n\nThere is no disk selected.";
      s.disk = d.uid; s.part = null;
      return "\nDisk " + d.n + " is now the selected disk.";
    }
    if (w[0] === "select" && w[1] === "volume") {
      var vol = dpVolumes(cat, state).find(function (x) { return String(x.n) === a[2]; });
      if (!vol) return "\nThe volume you specified is not valid.\n\nThere is no volume selected.";
      s.disk = vol.uid; s.part = vol.i;
      return "\nVolume " + vol.n + " is the selected volume.";
    }
    if (w[0] === "select" && w[1] === "partition") {
      if (!disk) return NODISK;
      var pi = Number(a[2]) - 1;
      if (!(pi >= 0 && pi < disk.disk.parts.length)) return "\nThe partition you specified is not valid.\nPlease select a valid partition.\n\nThere is no partition selected.";
      s.part = pi;
      return "\nPartition " + (pi + 1) + " is now the selected partition.";
    }
    if (w[0] === "clean") {
      if (!disk) return NODISK;
      var c = L.cleanDisk(state, disk.uid);
      if (!c.ok) return "\nVirtual Disk Service error:\n" + c.why;
      s.part = null;
      return "\nDiskPart succeeded in cleaning the disk.";
    }
    if (w[0] === "convert") {
      if (!disk) return NODISK;
      var cv = L.convertDisk(state, disk.uid, w[1]);
      return cv.ok ? "\nDiskPart successfully converted the selected disk to " + w[1].toUpperCase() + " format." : "\nVirtual Disk Service error:\n" + cv.why;
    }
    if (w[0] === "create" && w[1] === "partition" && w[2] === "primary") {
      if (!disk) return NODISK;
      var size = opt("size"), want = size ? Math.max(1, Math.round(Number(size) / 1024)) : 0;
      if (size && !(Number(size) > 0)) return "\nThe arguments specified for this command are not valid.";
      var cr = L.createPartition(cat, state, disk.uid, want);
      if (!cr.ok) return "\nVirtual Disk Service error:\n" + cr.why;
      s.part = cr.index;
      return "\nDiskPart succeeded in creating the specified partition.";
    }
    if (w[0] === "create") return "\nThe arguments specified for this command are not valid.\nIn the lab: CREATE PARTITION PRIMARY [SIZE=n].";
    if (w[0] === "format") {
      if (!disk) return NODISK;
      if (s.part == null) return "\nThere is no volume selected.\nPlease select a volume and try again.";
      var fs = opt("fs") || "NTFS", label = opt("label");
      var f = L.formatPartition(state, disk.uid, s.part, fs, label == null ? undefined : label);
      if (!f.ok) return "\nVirtual Disk Service error:\n" + (/32 GB/.test(f.why) ? "The volume size is too big." : f.why);
      return "\n  100 percent completed\n\nDiskPart successfully formatted the volume.";
    }
    if (w[0] === "assign") {
      if (!disk) return NODISK;
      if (s.part == null) return NOPART;
      var as = L.assignLetter(state, disk.uid, s.part, opt("letter"));
      return as.ok ? "\nDiskPart successfully assigned the drive letter or mount point." : "\nDiskPart has encountered an error: " + as.why;
    }
    if (w[0] === "remove") {
      if (!disk) return NODISK;
      if (s.part == null) return NOPART;
      var rm = L.removeLetter(state, disk.uid, s.part);
      return rm.ok ? "\nDiskPart successfully removed the drive letter or mount point." : "\nDiskPart has encountered an error: " + rm.why;
    }
    if (w[0] === "delete" && (w[1] === "partition" || w[1] === "volume")) {
      if (!disk) return NODISK;
      if (s.part == null) return NOPART;
      var dl = L.deletePartition(state, disk.uid, s.part);
      if (!dl.ok) return "\nVirtual Disk Service error:\n" + dl.why;
      s.part = null;
      return "\nDiskPart successfully deleted the selected partition.";
    }
    return "\nDiskPart doesn't know \"" + a[0] + "\". Type HELP for a list of commands.";
  }

  /* ------------------------------------------------------------ the rest */
  var HELP = ["For more information on a specific command, type the command name followed by /?.", "",
    "CD         Displays the name of or changes the current directory.",
    "CHKDSK     Checks a disk and displays a status report (/F fixes it).",
    "CLS        Clears the screen.",
    "DIR        Displays a list of files and subdirectories in a directory.",
    "DISKPART   Manages disks, partitions and volumes.",
    "EXIT       Quits the command prompt.",
    "HOSTNAME   Prints the name of this computer.",
    "IPCONFIG   Shows the network settings (/ALL /RELEASE /RENEW /FLUSHDNS).",
    "NETSTAT    Shows network connections (-A for listening ports too).",
    "NSLOOKUP   Looks up a name in DNS (NSLOOKUP name [server]).",
    "PING       Checks whether another computer answers (PING target [-N count]).",
    "SFC        Scans and repairs protected system files (SFC /SCANNOW).",
    "SHUTDOWN   Turns the computer off (/S) or restarts it (/R).",
    "SYSTEMINFO Shows this computer's configuration.",
    "TASKKILL   Ends a process (TASKKILL /IM name.exe).",
    "TASKLIST   Lists the running processes.",
    "TRACERT    Shows the route to another computer, hop by hop.",
    "VER        Shows the Windows version.",
    "WHOAMI     Shows who you're signed in as."].join("\n");

  function folders(path) {
    var p = path.toLowerCase();
    if (p === "c:\\") return ["PerfLogs", "Program Files", "Program Files (x86)", "Users", "Windows"];
    if (p === "c:\\users") return ["Public", "student"];
    if (p === "c:\\users\\student") return ["Desktop", "Documents", "Downloads", "Pictures"];
    if (p === "c:\\windows") return ["System32", "Logs", "Temp"];
    if (p === "c:\\users\\student\\desktop") return state0 && state0.os && state0.os.driverFolder ? ["Drivers"] : [];
    return p.indexOf("c:\\") === 0 ? [] : null;
  }
  var state0 = null;   // the machine during one run(), for folders()

  function cd(s, a) {
    if (!a.length) return s.cwd;
    var to = a.join(" ");
    if (to === "\\") { s.cwd = "C:\\"; return ""; }
    if (to === "..") { s.cwd = s.cwd.replace(/\\[^\\]+$/, "") || "C:\\"; if (/^C:$/i.test(s.cwd)) s.cwd = "C:\\"; return ""; }
    var path = /^[a-z]:\\/i.test(to) ? to : (s.cwd.replace(/\\$/, "") + "\\" + to);
    var parent = path.replace(/\\[^\\]+$/, "") || "C:\\", name = path.slice(parent.length + 1);
    if (/^C:$/i.test(parent)) parent = "C:\\";
    var list = folders(parent) || [], hit = list.find(function (f) { return f.toLowerCase() === name.toLowerCase(); });
    if (!hit) return "The system cannot find the path specified.";
    s.cwd = (parent === "C:\\" ? "C:\\" : parent + "\\") + hit;
    return "";
  }
  function dir(s) {
    var list = folders(s.cwd) || [], out = ["", " Volume in drive C is Windows", "", " Directory of " + s.cwd, ""];
    list.forEach(function (f) { out.push("10/30/2026  08:00 AM    <DIR>          " + f); });
    out.push(lpad(list.length, 16) + " Dir(s)");
    return out.join("\n");
  }

  function run(cat, state, s, line) {
    line = String(line || "");
    state0 = state;
    try {
      if (!L.running(state)) return { out: "" };
      if (s.pending) {
        var p = s.pending, yes = /^\s*y/i.test(line);
        s.pending = null;
        return { out: p.run(yes) };
      }
      if (s.mode === "diskpart") return { out: diskpart(cat, state, s, line) };
      var a = args(line);
      if (!a.length) return { out: "" };
      var cmd = a[0].toLowerCase().replace(/\.exe$/, ""), rest = a.slice(1);
      if (rest.length === 1 && rest[0] === "/?" && cmd !== "cd") return { out: HELP.split("\n").filter(function (l) { return l.toLowerCase().indexOf(cmd) === 0; })[0] || "No help for " + cmd + "." };
      switch (cmd) {
        case "help": return { out: HELP };
        case "cls": return { out: "", action: "cls" };
        case "exit": return { out: "", action: "exit" };
        case "hostname": return { out: state.os.hostname };
        case "whoami": return { out: state.os.hostname.toLowerCase() + "\\student" };
        case "ver": return { out: "\nWindows (lab edition) [Version 10.0.26100]" };
        case "echo": return { out: rest.join(" ") || "ECHO is on." };
        case "cd": case "chdir": return { out: cd(s, rest) };
        case "dir": return { out: dir(s) };
        case "ipconfig": return { out: ipconfig(cat, state, rest) };
        case "ping": return { out: ping(cat, state, rest) };
        case "tracert": return { out: tracert(cat, state, rest) };
        case "nslookup": return { out: nslookup(cat, state, rest) };
        case "netstat": return { out: netstat(cat, state, rest) };
        case "chkdsk": return { out: chkdsk(cat, state, s, rest) };
        case "sfc": return { out: sfc(cat, state, s, rest) };
        case "diskpart":
          if (!s.admin) return { out: notAdmin("DiskPart") };
          s.mode = "diskpart"; s.disk = null; s.part = null;
          return { out: "\nDiskPart, the lab's copy\n\nOn computer: " + state.os.hostname };
        case "tasklist": {
          var tl = ["", pad("Image Name", 26) + lpad("PID", 8) + lpad("Mem Usage", 14), "========================= ======== =============="];
          state.os.procs.forEach(function (x, i) { tl.push(pad(x.name, 26) + lpad(4 + i * 412, 8) + lpad(x.mem * 1024 + " K", 14)); });
          return { out: tl.join("\n") };
        }
        case "taskkill": {
          var ii = rest.findIndex(function (x) { return x.toLowerCase() === "/im"; }), name = ii >= 0 ? rest[ii + 1] : null;
          if (!name) return { out: "ERROR: Invalid syntax. Use TASKKILL /IM name.exe [/F]" };
          var hit = state.os.procs.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
          if (!hit) return { out: "ERROR: The process \"" + name + "\" not found." };
          var k = L.endTask(state, hit.name);
          return { out: k.ok ? "SUCCESS: The process \"" + hit.name + "\" has been terminated." : "ERROR: The process \"" + hit.name + "\" could not be terminated.\nReason: " + k.why };
        }
        case "systeminfo": {
          var part = function (k) { return L.partOf(cat, state, state[k]); }, cpu = part("cpu");
          return { out: ["", "Host Name:                 " + state.os.hostname, "OS Name:                   Windows (lab edition)",
                         "System Type:               x64-based PC",
                         "Processor(s):              " + (cpu ? cpu.name : ""),
                         "BIOS Version:              UEFI",
                         "Total Physical Memory:     " + (L.memoryGb(cat, state) * 1024).toLocaleString("en-US") + " MB",
                         "Network Card(s):           Ethernet adapter" + (adapterUp(state.os) ? "\n                           IP address(es): " + (state.os.net.ip || "none") : " (not working)")].join("\n") };
        }
        case "shutdown":
          if (flag(rest, "/r")) return { out: "", action: "restart" };
          if (flag(rest, "/s")) return { out: "", action: "off" };
          return { out: "Usage: shutdown /s (shut down) or shutdown /r (restart)" };
        default:
          return { out: "'" + a[0] + "' is not recognized as an internal or external command,\noperable program or batch file." };
      }
    } finally {
      state0 = null;
    }
  }

  return { session: session, prompt: prompt, run: run };
})();
