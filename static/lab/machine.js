/* PyIDE — the A+ lab's computer: one simulated PC, from the parts in its
 * case to the Windows-style system running on it.
 *
 * Pure: no DOM. The bench (bench.js) and the desktop (desktop.js) draw it and
 * call these functions; tools/test_lab_machine.py runs it in node.
 *
 * THE STATE IS PLAIN JSON — no classes, no functions inside — because it is
 * what gets saved to the server, and the server marks a scenario's tasks by
 * reading it (lab_checks.py). Every function here takes the state and changes
 * it in place, returning {ok, why} where a student's action can be refused.
 * The parts themselves (static/lab/parts.json) are not in the state, only their
 * ids, so the catalog can be read by the server too and a saved machine never
 * carries a copy of what a part is.
 *
 * Nothing is emulated: Windows here is a model of the things the A+ exam
 * covers (devices and drivers, disks and volumes, the network adapter,
 * processes, start-up apps, the event log, system files), and power-on is a
 * set of rules — the order a real PC checks things in, and what it shows
 * when one fails.
 */
window.PyIDELab = (function () {
  "use strict";

  var RAM_SLOTS_4 = ["A1", "A2", "B1", "B2"], RAM_SLOTS_2 = ["A1", "B1"];
  var BASE_WATTS = 150;          // board, fans, memory and the rest, with headroom
  var OVERHEAT_SECONDS = 120;    // a cooler that isn't seated: this long, then off

  // The board's beep codes and its debug lights, as its manual (the bench's
  // spec card) lists them. Real codes differ by maker; that is itself an A+ point.
  var CODES = {
    ok: { beeps: "1 short", led: "" },
    cpu: { beeps: "", led: "CPU" },
    ram: { beeps: "3 short", led: "DRAM" },
    video: { beeps: "1 long, 3 short", led: "VGA" },
    boot: { beeps: "1 short", led: "BOOT" }
  };

  /* ------------------------------------------------------------ the parts */

  function catalogOf(cat) {
    var byId = {};
    (cat.parts || cat).forEach(function (p) { byId[p.id] = p; });
    return byId;
  }

  /* A machine: `parts` is the catalog (parts.json, or its .parts). `items`
     are the actual pieces on the bench — two sticks of the same RAM are two
     items, and one can be faulty. Nothing is installed: put them in. */
  function create(cat, items) {
    var state = {
      v: 1,
      items: {},
      shelf: [],
      case: null, board: null, cpu: null, cooler: null, psu: null, gpu: null,
      // As many places as the biggest board has (4 DIMMs, 4 M.2, 6 SATA); a
      // smaller board's own counts (parts.json) say which of them exist.
      ram: [null, null, null, null], m2: [null, null, null, null], sata: [null, null, null, null, null, null],
      cables: { atx24: false, cpu8: false, gpu8: false, sata: [false, false, false, false, false, false] },
      coolerSeated: true,
      monitor: null,           // the display cable: "gpu", "board" or null
      cmos: true,              // the coin battery: false = flat
      power: { on: false, uptime: 0 },
      post: null,
      os: null
    };
    var n = 0;
    (items || []).forEach(function (it) {
      var uid = it.uid || (it.part + "#" + (++n));
      state.items[uid] = { part: it.part };
      if (it.faulty) state.items[uid].faulty = it.faulty;
      if (it.windows) state.items[uid].windows = true;
      state.shelf.push(uid);
    });
    return state;
  }

  /* The sandbox: one of everything (two of each memory stick, so a pair can
     go in), and a drive with Windows on it. Nothing faulty. */
  function sandbox(cat) {
    var items = [];
    (cat.parts || cat).forEach(function (p) {
      items.push({ part: p.id });
      if (p.type === "ram") items.push({ part: p.id });
    });
    items.push({ part: "ssd-256", uid: "windows-drive", windows: true });
    return create(cat, items);
  }

  function partOf(cat, state, uid) {
    var it = uid && state.items[uid];
    return it ? catalogOf(cat)[it.part] : null;
  }

  function ramSlots(cat, state) {
    var b = partOf(cat, state, state.board);
    return b && b.dimms === 2 ? RAM_SLOTS_2 : RAM_SLOTS_4;
  }

  function no(why) { return { ok: false, why: why }; }
  var YES = { ok: true, why: "" };

  // Off the shelf (or out of wherever it was) — the one place an item moves from.
  function take(state, uid) {
    var i = state.shelf.indexOf(uid);
    if (i < 0) return false;
    state.shelf.splice(i, 1);
    return true;
  }

  /* Put an item in a place: "case", "board", "cpu", "cooler", "psu", "gpu",
     "ram" (with the slot's index), "m2" (index) or "sata" (index). Refused,
     with the reason a technician would give, when it doesn't fit. */
  function install(cat, state, place, uid, index) {
    var p = partOf(cat, state, uid);
    if (!p) return no("That part isn't on the bench.");
    if (state.shelf.indexOf(uid) < 0) return no("That part is already in the computer.");
    if (state.power.on) return no("Turn the computer off and unplug it before working inside it.");
    var board = partOf(cat, state, state.board), box = partOf(cat, state, state.case);
    var single = { case: "case", board: "board", cpu: "cpu", cooler: "cooler", psu: "psu", gpu: "gpu" };
    if (single[place]) {
      if (p.type !== place) return no("A " + p.type + " doesn't go there.");
      if (state[place]) return no("There's already one in. Take it out first.");
      if (place === "board") {
        if (!box) return no("Put the case on the bench first: the motherboard mounts in it.");
        if (box.fits.indexOf(p.form) < 0) return no("A " + p.form + " motherboard doesn't fit this case. It takes " + box.fits.join(", ") + ".");
      }
      if (place === "psu" && !box) return no("The power supply mounts in the case. Put the case on the bench first.");
      if (place === "cpu") {
        if (!board) return no("Put the motherboard in first: the CPU goes in its socket.");
        if (p.socket !== board.socket) return no("This CPU is socket " + p.socket + "; the motherboard is socket " + board.socket + ". It won't go in.");
      }
      if (place === "cooler") {
        if (!state.cpu) return no("Put the CPU in first: the cooler sits on top of it.");
        var cpu = partOf(cat, state, state.cpu);
        if (p.watts < cpu.watts) return no("This cooler handles " + p.watts + " W; the CPU makes " + cpu.watts + " W of heat.");
        state.coolerSeated = true;
      }
      if (place === "gpu" && !board) return no("Put the motherboard in first: the card goes in its PCIe x16 slot.");
      take(state, uid);
      state[place] = uid;
      return YES;
    }
    if (place === "ram" || place === "m2" || place === "sata") {
      if (!board) return no("Put the motherboard in first.");
      var count = place === "ram" ? ramSlots(cat, state).length : board[place];
      if (!(index >= 0 && index < count)) return no("This motherboard has no such slot.");
      if (state[place][index]) return no("That slot is taken.");
      if (place === "ram") {
        if (p.type !== "ram") return no("Only memory goes in a DIMM slot.");
        if (p.ram !== board.ram) return no("This is " + p.ram + " memory; the motherboard takes " + board.ram + ". The notch is in a different place, so it won't go in.");
      } else if (place === "m2") {
        if (p.type !== "drive" || p.iface !== "M.2") return no("Only an M.2 drive goes in an M.2 slot.");
      } else {
        if (p.type !== "drive" || p.iface !== "SATA") return no("Only a SATA drive connects to a SATA port.");
      }
      take(state, uid);
      state[place][index] = uid;
      return YES;
    }
    return no("There's nowhere called that.");
  }

  // Out, back onto the shelf. What sits on top of it comes out first.
  function remove(cat, state, place, index) {
    if (state.power.on) return no("Turn the computer off first.");
    var deps = { case: ["board", "psu"], board: ["cpu", "gpu"], cpu: ["cooler"] };
    var list = place === "ram" || place === "m2" || place === "sata";
    var uid = list ? state[place][index] : state[place];
    if (!uid) return no("There's nothing there.");
    if (deps[place]) {
      for (var i = 0; i < deps[place].length; i++) if (state[deps[place][i]]) return no("Take out the " + deps[place][i] + " first.");
      if (place === "board" && (state.ram.some(Boolean) || state.m2.some(Boolean) || state.sata.some(Boolean))) {
        return no("Take out the memory and drives first.");
      }
    }
    if (list) {
      state[place][index] = null;
      if (place === "sata") state.cables.sata[index] = false;
    } else {
      state[place] = null;
    }
    if (place === "board") { state.cables.atx24 = false; state.cables.cpu8 = false; }
    if (place === "gpu") state.cables.gpu8 = false;
    state.shelf.push(uid);
    return YES;
  }

  /* A power cable from the PSU: "atx24", "cpu8", "gpu8", or "sata" with the
     port's index (the drive's power). Only one the PSU has, to something there. */
  function connect(cat, state, cable, on, index) {
    if (state.power.on) return no("Turn the computer off first.");
    var psu = partOf(cat, state, state.psu);
    if (on && !psu) return no("There's no power supply to plug it into.");
    if (cable === "atx24" || cable === "cpu8") {
      if (on && !state.board) return no("There's no motherboard to plug it into.");
      state.cables[cable] = !!on;
      return YES;
    }
    if (cable === "gpu8") {
      if (on && !state.gpu) return no("There's no graphics card to plug it into.");
      if (on && !partOf(cat, state, state.gpu).power) return no("This card has no power socket: the slot powers it.");
      if (on && !psu.pcie) return no("This power supply has no PCIe power cable.");
      state.cables.gpu8 = !!on;
      return YES;
    }
    if (cable === "sata") {
      if (on && !state.sata[index]) return no("There's no drive on that port.");
      state.cables.sata[index] = !!on;
      return YES;
    }
    return no("There's no cable called that.");
  }

  function setMonitor(state, where) {
    state.monitor = where === "gpu" || where === "board" ? where : null;
    return YES;
  }

  // Lift the cooler and put it back properly: new paste, all four screws.
  function reseatCooler(state) {
    if (state.power.on) return no("Turn the computer off first.");
    if (!state.cooler) return no("There's no cooler to reseat.");
    state.coolerSeated = true;
    return YES;
  }

  function replaceCmosBattery(state) {
    if (state.power.on) return no("Turn the computer off first.");
    state.cmos = true;
    return YES;
  }

  /* ------------------------------------------------------------ power and POST */

  // What the parts draw, at full load.
  function watts(cat, state) {
    var w = BASE_WATTS;
    ["cpu", "gpu"].forEach(function (k) { var p = partOf(cat, state, state[k]); if (p) w += p.watts; });
    w += 5 * (state.m2.filter(Boolean).length + state.sata.filter(Boolean).length);
    return w;
  }

  function drivesConnected(cat, state) {
    var out = [];
    state.m2.forEach(function (uid) { if (uid) out.push(uid); });
    state.sata.forEach(function (uid, i) { if (uid && state.cables.sata[i]) out.push(uid); });
    return out;
  }

  /* Pressing the power button. The checks go in the order a PC makes them,
     and the first that fails is what the student sees and hears:

       nopower   nothing at all: no PSU, or the 24-pin isn't connected
       shutoff   on for a second, then off: the PSU is too small, or no cooler
       nopost    fans spin, nothing else: no CPU or its 8-pin (CPU light)
       ram       3 short beeps, DRAM light: no memory, or a stick is bad
       video     1 long 3 short, VGA light, or a dark screen: see below
       noboot    "No bootable device": no drive with Windows, or it's dead
       windows   it starts

     A flat CMOS battery doesn't stop it: the clock is reset and the board
     says so. A cooler that isn't seated doesn't either — the PC runs, gets
     hot, and turns itself off later (tick()). */
  function powerOn(cat, state) {
    state.power = { on: true, uptime: 0 };
    var psu = partOf(cat, state, state.psu), cpu = partOf(cat, state, state.cpu);
    var r = { stage: "", beeps: "", led: "", screen: "", notes: [] };
    function done(stage, code, screen) {
      r.stage = stage;
      r.beeps = code ? CODES[code].beeps : "";
      r.led = code ? CODES[code].led : "";
      r.screen = screen || "";
      if (stage === "nopower" || stage === "shutoff") state.power.on = false;
      state.post = r;
      if (stage === "windows") boot(cat, state); else if (state.os) state.os.running = false;
      return r;
    }
    if (!psu || !state.cables.atx24 || !state.board) return done("nopower", "", "");
    if (watts(cat, state) > psu.watts) {
      r.notes.push("It needs about " + watts(cat, state) + " W; the power supply gives " + psu.watts + " W.");
      return done("shutoff", "", "");
    }
    if (!cpu || !state.cables.cpu8) return done("nopost", "cpu", "");
    if (!state.cooler) {
      r.notes.push("The CPU has no cooler: it overheated at once.");
      return done("shutoff", "", "");
    }
    var sticks = state.ram.filter(Boolean);
    if (!sticks.length || sticks.some(function (uid) { return state.items[uid].faulty; })) {
      return done("ram", "ram", "");
    }
    var gpu = partOf(cat, state, state.gpu);
    if (gpu && gpu.power && !state.cables.gpu8) return done("video", "video", "");
    if (!gpu && !cpu.graphics) return done("video", "video", "");
    // The picture comes from the card if there is one (the board's own ports
    // are switched off then), else from the board, if the CPU has graphics.
    var source = gpu ? "gpu" : "board";
    if (state.monitor !== source) {
      r.notes.push(state.monitor ? "The monitor is plugged into the " + (state.monitor === "gpu" ? "graphics card" : "motherboard") +
                   ", but the picture comes from the " + (source === "gpu" ? "graphics card" : "motherboard") + "." : "No monitor is plugged in.");
      // It started — the beep says so — but nothing shows.
      r.dark = true;
    }
    if (!state.cmos) r.notes.push("CMOS checksum error: settings and the clock were reset. Press F1 to continue.");
    var windows = drivesConnected(cat, state).filter(function (uid) { return state.items[uid].windows; });
    var good = windows.filter(function (uid) { return state.items[uid].faulty !== "dead"; });
    if (!good.length) return done("noboot", "boot", "No bootable device found. Insert boot media and press any key.");
    return done("windows", "ok", r.dark ? "" : "Windows");
  }

  function powerOff(state) {
    state.power = { on: false, uptime: 0 };
    if (state.os) state.os.running = false;
    return YES;
  }

  /* Time passing while it's on. A cooler that isn't seated turns the PC off
     after OVERHEAT_SECONDS, and Windows logs it at the next start (Kernel-Power
     41: the system rebooted without shutting down cleanly). */
  function tick(cat, state, seconds) {
    if (!state.power.on) return null;
    state.power.uptime += seconds;
    if (state.cooler && !state.coolerSeated && state.power.uptime >= OVERHEAT_SECONDS) {
      powerOff(state);
      if (state.os) state.os.uncleanShutdown = true;
      return "overheated";
    }
    return null;
  }

  // The CPU's temperature as the BIOS would show it: how the cooler is doing.
  function cpuTemp(state) {
    if (!state.power.on) return 0;
    if (!state.cooler) return 105;
    if (!state.coolerSeated) return Math.min(100, 45 + Math.floor(state.power.uptime / 2));
    return 42;
  }

  /* ------------------------------------------------------------ Windows */

  /* Windows, as it is on its drive. Made the first time that drive boots,
     unless a scenario put one there with its faults already in it. */
  function freshOs(state) {
    return {
      hostname: "PC-" + String(Object.keys(state.items).length).padStart(2, "0"),
      running: false,
      drivers: { net: "ok", gpu: "ok", audio: "ok", chipset: "ok" },
      disabled: {},
      driverFolder: true,        // a folder of drivers on the desktop, from the maker
      disks: {},                 // drive uid -> {style, parts: [{gb, fs, letter, label}]}
      net: { enabled: true, dhcp: true, ip: "", mask: "", gateway: "", dns: [], lease: "ok" },
      lan: { subnet: "192.168.1", gateway: "192.168.1.1", dns: "192.168.1.1", dhcp: true, internet: true },
      procs: [
        { name: "System", cpu: 1, mem: 4 }, { name: "explorer.exe", cpu: 1, mem: 90 },
        { name: "Search", cpu: 0, mem: 60 }, { name: "Antivirus", cpu: 2, mem: 120 }
      ],
      startup: [
        { name: "Antivirus", impact: "Medium", enabled: true },
        { name: "Cloud backup", impact: "Low", enabled: true }
      ],
      events: [],
      sysfiles: "ok",
      fsDirty: false,
      uncleanShutdown: false,
      bootCount: 0
    };
  }

  function boot(cat, state) {
    if (!state.os) state.os = freshOs(state);
    var os = state.os;
    os.running = true;
    os.bootCount += 1;
    if (os.uncleanShutdown) {
      logEvent(os, "Critical", "Kernel-Power", 41,
               "The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly.");
      logEvent(os, "Error", "EventLog", 6008, "The previous system shutdown was unexpected.");
      os.uncleanShutdown = false;
    }
    // Every start leaves its ordinary line, so a crash stands out among them
    // in Event Viewer the way it does on a real PC.
    logEvent(os, "Information", "EventLog", 6005, "The Event log service was started.");
    // Every drive it can see is a disk; one it hasn't seen before is new and empty.
    drivesConnected(cat, state).forEach(function (uid) {
      if (!os.disks[uid]) {
        var p = partOf(cat, state, uid);
        os.disks[uid] = state.items[uid].windows
          ? { style: "GPT", parts: [{ gb: p.gb, fs: "NTFS", letter: "C", label: "Windows" }] }
          : { style: null, parts: [] };
      }
    });
    if (os.net.dhcp) lease(os);
  }

  var MAX_EVENTS = 200;     // the state is saved on every change: keep the log short
  function logEvent(os, level, source, id, msg) {
    var n = os.events.length ? os.events[os.events.length - 1].n + 1 : 1;
    os.events.push({ n: n, boot: os.bootCount, level: level, source: source, id: id, msg: msg });
    if (os.events.length > MAX_EVENTS) os.events.splice(0, os.events.length - MAX_EVENTS);
  }

  /* The disks Windows sees now, numbered as Disk Management and diskpart
     number them: M.2 slots first, then SATA ports, in order. A drive that's
     been taken out keeps its entry in os.disks (put back, it has its volumes
     again) but isn't listed. */
  function disks(cat, state) {
    if (!state.os) return [];
    return drivesConnected(cat, state).filter(function (uid) { return state.os.disks[uid]; }).map(function (uid, n) {
      return { n: n, uid: uid, part: partOf(cat, state, uid), disk: state.os.disks[uid], free: freeGb(state, uid, cat) };
    });
  }

  // Installed memory, as System Information and Task Manager show it.
  function memoryGb(cat, state) {
    var gb = 0;
    state.ram.forEach(function (uid) { var p = uid && partOf(cat, state, uid); if (p) gb += p.gb; });
    return gb;
  }

  function running(state) {
    return !!(state.power.on && state.os && state.os.running);
  }

  /* The devices Device Manager lists, from the hardware that's in and how
     Windows feels about each: status "ok", "missing" (no driver: ⚠, under
     Other devices with a vague name) or "disabled" (↓). */
  function devices(cat, state) {
    var os = state.os, out = [];
    if (!os) return out;
    function add(key, category, name, generic) {
      var status = os.disabled[key] ? "disabled" : os.drivers[key] === "missing" ? "missing" : "ok";
      out.push({ key: key, category: status === "missing" ? "Other devices" : category,
                 name: status === "missing" ? generic : name, status: status });
    }
    var cpu = partOf(cat, state, state.cpu), gpu = partOf(cat, state, state.gpu);
    if (cpu) out.push({ key: "cpu", category: "Processors", name: cpu.name, status: "ok" });
    add("chipset", "System devices", "Motherboard chipset", "PCI Device");
    add("net", "Network adapters", "Ethernet adapter", "Ethernet Controller");
    add("audio", "Sound, video and game controllers", "High Definition Audio", "Multimedia Audio Controller");
    if (gpu || (cpu && cpu.graphics)) {
      // A missing display driver still gives a picture: Windows' basic one.
      var s = os.disabled.gpu ? "disabled" : "ok";
      out.push({ key: "gpu", category: "Display adapters",
                 name: os.drivers.gpu === "missing" ? "Basic Display Adapter" : gpu ? gpu.name : "Integrated graphics", status: s,
                 basic: os.drivers.gpu === "missing" });
    }
    drivesConnected(cat, state).forEach(function (uid) {
      out.push({ key: "disk:" + uid, category: "Disk drives", name: partOf(cat, state, uid).name, status: "ok" });
    });
    return out;
  }

  /* Update driver, the two ways Windows offers: "auto" searches online
     (Windows Update: it needs the internet), "browse" looks in the maker's
     folder on the desktop. A missing NETWORK driver can only come from the
     folder, since without it there's no internet: a real A+ point. With no
     `how`, either will do. */
  function updateDriver(cat, state, key, how) {
    if (!running(state)) return no("Windows isn't running.");
    var os = state.os;
    if (!(key in os.drivers)) return no("That device's driver is up to date.");
    if (os.drivers[key] === "ok") return no("The best driver for this device is already installed.");
    if (how === "auto" && !online(state)) return no("Windows couldn't search online for a driver: this computer can't reach the internet. If you have the maker's driver, browse your computer for it.");
    if (how === "browse" && !os.driverFolder) return no("There's no driver for this device on this computer.");
    if (!how && !os.driverFolder && !online(state)) return no("Windows couldn't find a driver. There's no driver on this computer, and it can't reach the internet.");
    os.drivers[key] = "ok";
    if (key === "net" && os.net.dhcp) lease(os);
    return YES;
  }

  function setDeviceEnabled(state, key, on) {
    if (!running(state)) return no("Windows isn't running.");
    if (on) delete state.os.disabled[key]; else state.os.disabled[key] = true;
    if (key === "net" && on && state.os.net.dhcp) lease(state.os);
    return YES;
  }

  /* --------------------------------------------- disks (Disk Management, diskpart) */

  function freeGb(state, uid, cat) {
    var d = state.os.disks[uid], used = 0;
    d.parts.forEach(function (p) { used += p.gb; });
    return partOf(cat, state, uid).gb - used;
  }

  function lettersInUse(os) {
    var used = { A: true, B: true };
    Object.keys(os.disks).forEach(function (k) { os.disks[k].parts.forEach(function (p) { if (p.letter) used[p.letter] = true; }); });
    return used;
  }

  function nextLetter(os) {
    var used = lettersInUse(os);
    for (var c = 67; c <= 90; c++) if (!used[String.fromCharCode(c)]) return String.fromCharCode(c);
    return null;
  }

  // A new disk has to be initialized (GPT or MBR) before it can hold a volume.
  function initializeDisk(state, uid, style) {
    if (!running(state)) return no("Windows isn't running.");
    var d = state.os.disks[uid];
    if (!d) return no("There's no such disk.");
    if (d.style) return no("The disk is already initialized.");
    if (style !== "GPT" && style !== "MBR") return no("Choose GPT or MBR.");
    d.style = style;
    return YES;
  }

  /* New Simple Volume: a size (GB, or all that's free), a file system and a
     letter (or the next free one). */
  function newVolume(cat, state, uid, opts) {
    if (!running(state)) return no("Windows isn't running.");
    opts = opts || {};
    var os = state.os, d = os.disks[uid];
    if (!d) return no("There's no such disk.");
    if (!d.style) return no("The disk must be initialized before a volume can be made on it.");
    if (d.style === "MBR" && d.parts.length >= 4) return no("An MBR disk holds at most four primary partitions.");
    var free = freeGb(state, uid, cat), gb = opts.gb ? Math.min(opts.gb, free) : free;
    if (gb <= 0) return no("There's no unallocated space on this disk.");
    var fs = (opts.fs || "NTFS").toUpperCase();
    if (["NTFS", "FAT32", "EXFAT"].indexOf(fs) < 0) return no("Choose NTFS, FAT32 or exFAT.");
    if (fs === "FAT32" && gb > 32) return no("Windows formats FAT32 volumes up to 32 GB. Use NTFS or exFAT.");
    var letter = (opts.letter || nextLetter(os) || "").toUpperCase();
    if (letter && lettersInUse(os)[letter]) return no("The drive letter " + letter + ": is already in use.");
    d.parts.push({ gb: gb, fs: fs === "EXFAT" ? "exFAT" : fs, letter: letter || "", label: opts.label || "New Volume" });
    return YES;
  }

  function findVolume(os, letter) {
    letter = String(letter || "").toUpperCase().replace(":", "");
    var hit = null;
    Object.keys(os.disks).forEach(function (k) {
      os.disks[k].parts.forEach(function (p, i) { if (p.letter === letter) hit = { disk: k, index: i, part: p }; });
    });
    return hit;
  }

  /* By partition (a disk and its index) — what diskpart works with, and
     Disk Management for a partition that has no letter to name it by. The
     by-letter functions below are these, found by letter. */
  function partAt(state, uid, i) {
    var d = state.os && state.os.disks[uid];
    return d && d.parts[i] ? d.parts[i] : null;
  }
  function checkFs(fs, gb) {
    fs = String(fs || "NTFS").toUpperCase();
    if (["NTFS", "FAT32", "EXFAT"].indexOf(fs) < 0) return no("Choose NTFS, FAT32 or exFAT.");
    if (fs === "FAT32" && gb > 32) return no("Windows formats FAT32 volumes up to 32 GB. Use NTFS or exFAT.");
    return { ok: true, fs: fs === "EXFAT" ? "exFAT" : fs };
  }
  function formatPartition(state, uid, i, fs, label) {
    if (!running(state)) return no("Windows isn't running.");
    var v = partAt(state, uid, i);
    if (!v) return no("There's no such partition.");
    if (v.letter === "C") return no("Windows can't format the drive it's running from.");
    var f = checkFs(fs, v.gb);
    if (!f.ok) return f;
    v.fs = f.fs;
    v.dirty = false;
    if (label != null) v.label = label;
    return YES;
  }
  // A letter for a partition: the one asked for, or the next free one.
  function assignLetter(state, uid, i, letter) {
    if (!running(state)) return no("Windows isn't running.");
    var v = partAt(state, uid, i);
    if (!v) return no("There's no such partition.");
    if (v.letter === "C") return no("The system drive's letter can't be changed.");
    var to = letter ? String(letter).toUpperCase().replace(":", "") : nextLetter(state.os);
    if (!to || !/^[D-Z]$/.test(to)) return no("Choose a letter from D to Z.");
    if (to === v.letter) return YES;
    if (lettersInUse(state.os)[to]) return no("The drive letter " + to + ": is already in use.");
    v.letter = to;
    return YES;
  }
  function removeLetter(state, uid, i) {
    if (!running(state)) return no("Windows isn't running.");
    var v = partAt(state, uid, i);
    if (!v) return no("There's no such partition.");
    if (v.letter === "C") return no("Windows can't remove the letter of the drive it's running from.");
    v.letter = "";
    return YES;
  }
  function deletePartition(state, uid, i) {
    if (!running(state)) return no("Windows isn't running.");
    var v = partAt(state, uid, i);
    if (!v) return no("There's no such partition.");
    if (v.letter === "C") return no("Windows can't delete the volume it's running from.");
    state.os.disks[uid].parts.splice(i, 1);
    return YES;
  }
  /* diskpart's create partition primary: space set aside, with no file
     system (RAW) and no letter until it's formatted and assigned. On a disk
     that isn't initialized, diskpart makes it MBR first, as the real one
     does — a thing worth knowing when a 3 TB disk comes out MBR. */
  function createPartition(cat, state, uid, gb) {
    if (!running(state)) return no("Windows isn't running.");
    var d = state.os.disks[uid];
    if (!d) return no("There's no such disk.");
    if (!d.style) d.style = "MBR";
    if (d.style === "MBR" && d.parts.length >= 4) return no("An MBR disk holds at most four primary partitions.");
    var free = freeGb(state, uid, cat), size = gb ? Math.min(gb, free) : free;
    if (size <= 0) return no("There is not enough usable free space on specified disk(s) to create the partition.");
    d.parts.push({ gb: size, fs: "RAW", letter: "", label: "" });
    return { ok: true, why: "", index: d.parts.length - 1 };
  }
  // diskpart clean: every partition gone, and the disk back to not initialized.
  function cleanDisk(state, uid) {
    if (!running(state)) return no("Windows isn't running.");
    var d = state.os.disks[uid];
    if (!d) return no("There's no such disk.");
    if (d.parts.some(function (v) { return v.letter === "C"; })) {
      return no("Clean is not allowed on the disk containing the current boot, system, pagefile, crashdump or hibernation volume.");
    }
    d.parts = [];
    d.style = null;
    return YES;
  }
  // convert gpt / convert mbr: only on an empty disk.
  function convertDisk(state, uid, style) {
    if (!running(state)) return no("Windows isn't running.");
    var d = state.os.disks[uid];
    if (!d) return no("There's no such disk.");
    style = String(style || "").toUpperCase();
    if (style !== "GPT" && style !== "MBR") return no("Choose GPT or MBR.");
    if (d.parts.length) return no("The specified disk is not convertible. Only empty disks can be converted (clean it first).");
    d.style = style;
    return YES;
  }

  function byLetter(state, letter, fn) {
    if (!running(state)) return no("Windows isn't running.");
    var v = findVolume(state.os, letter);
    if (!v) return no("There's no drive " + letter + ":.");
    return fn(v.disk, v.index);
  }
  function formatVolume(state, letter, fs, label) {
    return byLetter(state, letter, function (uid, i) { return formatPartition(state, uid, i, fs, label); });
  }
  function changeLetter(state, from, to) {
    return byLetter(state, from, function (uid, i) {
      if (!to || !/^[D-Z]$/i.test(String(to).replace(":", ""))) return partAt(state, uid, i).letter === "C" ? no("The system drive's letter can't be changed.") : no("Choose a letter from D to Z.");
      return assignLetter(state, uid, i, to);
    });
  }
  function deleteVolume(state, letter) {
    return byLetter(state, letter, function (uid, i) { return deletePartition(state, uid, i); });
  }

  /* What a name looks up to (nslookup, and ping or tracert by name): from the
     DNS server asked for, or the adapter's first. Why not, when not:
     "noserver" (no DNS server set), "timeout" (it doesn't answer), or
     "nxdomain" (it answered: there's no such name). */
  function lookup(state, name, server) {
    var os = state.os;
    if (!running(state)) return { ok: false, why: "off" };
    var srv = server || (os.net.dns || [])[0];
    if (!srv) return { ok: false, why: "noserver" };
    var answers = onLan(os) && (srv === os.lan.dns || (online(state) && PUBLIC_DNS[srv]));
    if (!answers) return { ok: false, why: "timeout", server: srv };
    var ip = NAMES[String(name || "").toLowerCase()];
    return ip ? { ok: true, ip: ip, server: srv } : { ok: false, why: "nxdomain", server: srv };
  }

  /* --------------------------------------------- the network */

  /* Getting an address from the router (DHCP). A stale lease, a router with
     DHCP off, or no working adapter gives APIPA — 169.254.x.x — the address
     Windows gives itself when no DHCP server answers. */
  function lease(os) {
    var n = os.net;
    if (!n.dhcp) return;
    var adapterUp = n.enabled && !os.disabled.net && os.drivers.net === "ok";
    if (!adapterUp) { n.ip = ""; n.mask = ""; n.gateway = ""; n.dns = []; return; }
    if (n.lease === "stale" || !os.lan.dhcp) {
      n.ip = "169.254.83.17"; n.mask = "255.255.0.0"; n.gateway = ""; n.dns = [];
      return;
    }
    n.ip = os.lan.subnet + ".57"; n.mask = "255.255.255.0"; n.gateway = os.lan.gateway; n.dns = [os.lan.dns];
  }

  // ipconfig /release then /renew: a fresh lease, if a DHCP server answers.
  function release(state) {
    if (!running(state)) return no("Windows isn't running.");
    var n = state.os.net;
    if (!n.dhcp) return no("The adapter has a static address: there's no lease to release.");
    n.ip = ""; n.mask = ""; n.gateway = ""; n.dns = [];
    n.released = true;
    return YES;
  }
  function renew(state) {
    if (!running(state)) return no("Windows isn't running.");
    var os = state.os, n = os.net;
    if (!n.dhcp) return no("The adapter has a static address: there's no lease to renew.");
    if (n.lease === "stale") n.lease = "ok";       // what a fresh request fixes
    n.released = false;
    lease(os);
    return n.ip && n.ip.indexOf("169.254.") !== 0 ? YES : no("An error occurred while renewing: unable to contact your DHCP server.");
  }

  /* The adapter's IPv4 settings (Settings → Network → Edit): automatic, or a
     static address, mask, gateway and DNS server. */
  function setIp(state, opts) {
    if (!running(state)) return no("Windows isn't running.");
    var n = state.os.net;
    if (opts.dhcp) {
      n.dhcp = true;
      lease(state.os);
      return YES;
    }
    var ip4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    var bad = ["ip", "mask", "gateway"].filter(function (k) {
      var m = ip4.exec(opts[k] || "");
      return !m || m.slice(1).some(function (x) { return Number(x) > 255; });
    });
    if (bad.length) return no("That isn't a valid " + bad[0] + " address.");
    n.dhcp = false;
    n.ip = opts.ip; n.mask = opts.mask; n.gateway = opts.gateway;
    n.dns = (opts.dns || []).filter(function (d) { return ip4.test(d); });
    return YES;
  }

  function onLan(os) {
    var n = os.net;
    return !!(n.ip && n.enabled && !os.disabled.net && os.drivers.net === "ok" &&
              n.ip.indexOf(os.lan.subnet + ".") === 0 && n.mask === "255.255.255.0" &&
              n.ip !== os.lan.gateway);
  }

  function online(state) {
    var os = state.os;
    return !!(os && onLan(os) && os.net.gateway === os.lan.gateway && os.lan.internet);
  }

  // DNS works when its server is reachable and real: the router, or a public one.
  function dnsWorks(state) {
    var os = state.os;
    if (!os || !onLan(os)) return false;
    return os.net.dns.some(function (d) { return d === os.lan.dns || (online(state) && PUBLIC_DNS[d]); });
  }
  var PUBLIC_DNS = { "8.8.8.8": true, "1.1.1.1": true, "9.9.9.9": true };
  var NAMES = { "example.com": "93.184.215.14", "www.example.com": "93.184.215.14", "comptia.org": "104.18.7.29" };

  /* Can this computer reach `target` — an address or a name — now? With the
     reason when it can't, which is what ping and tracert show. */
  function reach(state, target) {
    var os = state.os;
    if (!running(state)) return { ok: false, why: "off" };
    target = String(target || "").trim().toLowerCase();
    if (target === "127.0.0.1" || target === "localhost") return { ok: true, ip: "127.0.0.1" };
    var n = os.net;
    if (!n.ip || !n.enabled || os.disabled.net || os.drivers.net !== "ok") return { ok: false, why: "general failure" };
    var ip = target;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(target)) {
      if (!dnsWorks(state)) return { ok: false, why: "no name" };
      ip = NAMES[target];
      if (!ip) return { ok: false, why: "no name" };
    }
    if (ip === n.ip) return { ok: true, ip: ip };
    if (!onLan(os)) return { ok: false, why: "unreachable" };
    if (ip.indexOf(os.lan.subnet + ".") === 0) return ip === os.lan.gateway ? { ok: true, ip: ip } : { ok: false, why: "timed out", ip: ip };
    if (!online(state)) return { ok: false, why: n.gateway ? "timed out" : "unreachable", ip: ip };
    return { ok: true, ip: ip };
  }

  /* --------------------------------------------- processes, start-up, repair */

  function endTask(state, name) {
    if (!running(state)) return no("Windows isn't running.");
    var procs = state.os.procs, i = procs.findIndex(function (p) { return p.name === name; });
    if (i < 0) return no("There's no process called " + name + ".");
    if (name === "System") return no("Windows won't end a critical system process.");
    procs.splice(i, 1);
    return YES;
  }

  function setStartup(state, name, on) {
    if (!running(state)) return no("Windows isn't running.");
    var s = state.os.startup.find(function (x) { return x.name === name; });
    if (!s) return no("There's no start-up app called " + name + ".");
    s.enabled = !!on;
    return YES;
  }

  // sfc /scannow: finds the system files that are corrupt and puts them back.
  function sfc(state) {
    if (!running(state)) return no("Windows isn't running.");
    var found = state.os.sysfiles === "corrupt";
    state.os.sysfiles = "ok";
    return { ok: true, why: "", found: found };
  }

  /* chkdsk: reads the file system. With /f it fixes what it finds — on C:,
     at the next restart, since Windows is using it. */
  function chkdsk(state, letter, fix) {
    if (!running(state)) return no("Windows isn't running.");
    var os = state.os, v = findVolume(os, letter || "C");
    if (!v) return no("The drive " + (letter || "C") + ": doesn't exist.");
    var dirty = v.part.letter === "C" ? os.fsDirty : !!v.part.dirty;
    if (!fix) return { ok: true, why: "", found: dirty, scheduled: false };
    if (v.part.letter === "C") {
      os.chkdskAtBoot = dirty || os.chkdskAtBoot;
      return { ok: true, why: "", found: dirty, scheduled: true };
    }
    v.part.dirty = false;
    return { ok: true, why: "", found: dirty, scheduled: false };
  }

  // Restart: off and on, and a scheduled chkdsk runs on the way back.
  function restart(cat, state) {
    if (!running(state)) return no("Windows isn't running.");
    var os = state.os;
    powerOff(state);
    if (os.chkdskAtBoot) { os.fsDirty = false; os.chkdskAtBoot = false; }
    powerOn(cat, state);
    return YES;
  }

  return {
    CODES: CODES, OVERHEAT_SECONDS: OVERHEAT_SECONDS,
    catalogOf: catalogOf, create: create, sandbox: sandbox, partOf: partOf, ramSlots: ramSlots,
    install: install, remove: remove, connect: connect, setMonitor: setMonitor,
    reseatCooler: reseatCooler, replaceCmosBattery: replaceCmosBattery,
    watts: watts, powerOn: powerOn, powerOff: powerOff, tick: tick, cpuTemp: cpuTemp,
    running: running, devices: devices, updateDriver: updateDriver, setDeviceEnabled: setDeviceEnabled,
    initializeDisk: initializeDisk, newVolume: newVolume, formatVolume: formatVolume,
    changeLetter: changeLetter, deleteVolume: deleteVolume, findVolume: findVolume,
    release: release, renew: renew, setIp: setIp, reach: reach, online: online, dnsWorks: dnsWorks,
    endTask: endTask, setStartup: setStartup, sfc: sfc, chkdsk: chkdsk, restart: restart,
    logEvent: logEvent, disks: disks, memoryGb: memoryGb, lookup: lookup, NAMES: NAMES, PUBLIC_DNS: PUBLIC_DNS,
    partAt: partAt, formatPartition: formatPartition, assignLetter: assignLetter, removeLetter: removeLetter,
    deletePartition: deletePartition, createPartition: createPartition, cleanDisk: cleanDisk, convertDisk: convertDisk
  };
})();
