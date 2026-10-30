/* PyIDE — the A+ lab's scenarios: how one starts, and how its tasks are
 * marked. lab_checks.py is the same thing on the server, and the server's
 * is the grade; this one is the instant ✓ beside each task.
 * tools/test_lab_checks.py holds the two together, task by task, on every
 * scenario's start and solution and on a few hundred machines made at random.
 *
 * A TASK'S CHECK IS DATA, never code, so both languages read it the same:
 *
 *   {"path": "os.drivers.net", "op": "==", "value": "ok"}
 *   {"path": "os.startup", "op": "has", "where": {"name": "Chat app", "enabled": false}}
 *   {"all": [...]}  {"any": [...]}  {"not": {...}}
 *
 * ops: == != >= <= startsWith notStartsWith has lacks. A path reads the
 * saved machine, or one of the FACTS below worked out from it: boots,
 * coolerOk, memoryGb, dualChannel, online, dnsWorks, volumes.<letter>.<key>.
 * A missing path is null. Every fact means "with this exact hardware", and
 * a machine that breaks a compatibility rule (something put where it can't
 * go, which only a hand-edited save can do) boots nothing and passes
 * nothing that depends on hardware.
 *
 * WHAT A STUDENT SENDS IS NOT TRUSTED FOR WHAT THE PARTS ARE: sanitize()
 * puts back the scenario's own items — which stick is dead, which drive has
 * Windows — so a save can't mend a part by saying it's fine.
 */
window.PyIDELabChecks = (function () {
  "use strict";

  var L = window.PyIDELab;

  function copy(x) { return JSON.parse(JSON.stringify(x)); }

  /* ------------------------------------------------------------ a scenario's start */
  /* Its parts; what's built (["board", "mb"], ["ram", "r1", 0]); the cables
     and monitor; `set` on the machine before it starts (a loose cooler);
     `os` on Windows after a first start (a missing driver), then a restart
     so the change takes (a stale lease becomes APIPA). Left switched off:
     the page switches on a scenario that starts in Windows. */
  function start(cat, sc) {
    var s = L.create(cat, sc.items.map(function (it) { return Object.assign({}, it); }));
    (sc.build || []).forEach(function (b) {
      var r = L.install(cat, s, b[0], b[1], b[2]);
      if (!r.ok) throw new Error(sc.id + ": " + b.join(" ") + ": " + r.why);
    });
    (sc.cables || []).forEach(function (c) {
      var r = Array.isArray(c) ? L.connect(cat, s, c[0], true, c[1]) : L.connect(cat, s, c, true);
      if (!r.ok) throw new Error(sc.id + ": cable " + c + ": " + r.why);
    });
    if (sc.monitor) L.setMonitor(s, sc.monitor);
    Object.keys(sc.set || {}).forEach(function (k) { put(s, k, sc.set[k]); });
    if (sc.os) {
      var r = L.powerOn(cat, s);
      if (r.stage !== "windows") throw new Error(sc.id + ": the start doesn't boot (" + r.stage + ")");
      Object.keys(sc.os).forEach(function (k) {
        // "procs+" / "startup+": add to a list rather than replace it.
        if (/\+$/.test(k)) get(s.os, k.slice(0, -1)).push.apply(get(s.os, k.slice(0, -1)), copy(sc.os[k]));
        else put(s.os, k, copy(sc.os[k]));
      });
      L.powerOff(s);
      L.powerOn(cat, s);
      L.powerOff(s);
    }
    s.scenario = sc.id;
    return s;
  }
  function get(obj, path) {
    return String(path).split(".").reduce(function (o, k) { return o == null ? null : o[k]; }, obj);
  }
  function put(obj, path, value) {
    var keys = String(path).split("."), last = keys.pop();
    keys.forEach(function (k) { obj = obj[k]; });
    obj[last] = value;
  }

  /* The scenario's own items, whatever the save says they are; the shelf
     is whatever isn't placed. */
  function sanitize(sc, posted) {
    var s = copy(posted || {}), items = {};
    sc.items.forEach(function (it) {
      items[it.uid] = { part: it.part };
      if (it.faulty) items[it.uid].faulty = it.faulty;
      if (it.windows) items[it.uid].windows = true;
    });
    s.items = items;
    var placed = placedUids(s);
    s.shelf = Object.keys(items).filter(function (u) { return placed.indexOf(u) < 0; });
    return s;
  }
  function placedUids(s) {
    var out = [];
    ["case", "board", "cpu", "cooler", "psu", "gpu"].forEach(function (k) { if (s[k]) out.push(s[k]); });
    ["ram", "m2", "sata"].forEach(function (k) { (s[k] || []).forEach(function (u) { if (u) out.push(u); }); });
    return out;
  }

  /* ------------------------------------------------------------ is it a real build? */
  /* The rules install() and connect() enforce, checked on a finished
     machine: what a hand-edited save could get past. Line for line with
     lab_checks.py's valid(). */
  function valid(cat, s) {
    var by = L.catalogOf(cat), items = s.items || {};
    var part = function (u) { return u && items[u] ? by[items[u].part] || null : null; };
    var placed = placedUids(s), seen = {};
    for (var i = 0; i < placed.length; i++) {
      if (seen[placed[i]] || !part(placed[i])) return false;
      seen[placed[i]] = true;
    }
    var box = part(s.case), board = part(s.board), cpu = part(s.cpu), cooler = part(s.cooler), psu = part(s.psu), gpu = part(s.gpu);
    if (s.case && box.type !== "case") return false;
    if (s.board && (board.type !== "board" || !box || box.fits.indexOf(board.form) < 0)) return false;
    if (s.cpu && (cpu.type !== "cpu" || !board || cpu.socket !== board.socket)) return false;
    if (s.cooler && (cooler.type !== "cooler" || !cpu || cooler.watts < cpu.watts)) return false;
    if (s.psu && (psu.type !== "psu" || !box)) return false;
    if (s.gpu && (gpu.type !== "gpu" || !board)) return false;
    var slots = { ram: board ? (board.dimms === 2 ? 2 : 4) : 0, m2: board ? board.m2 : 0, sata: board ? board.sata : 0 };
    var bad = ["ram", "m2", "sata"].some(function (k) {
      return (s[k] || []).some(function (u, n) {
        if (!u) return false;
        var p = part(u);
        if (n >= slots[k]) return true;
        if (k === "ram") return p.type !== "ram" || p.ram !== board.ram;
        return p.type !== "drive" || p.iface !== (k === "m2" ? "M.2" : "SATA");
      });
    });
    if (bad) return false;
    var c = s.cables || {};
    if ((c.atx24 || c.cpu8) && !(psu && board)) return false;
    if (c.gpu8 && !(psu && psu.pcie && gpu && gpu.power)) return false;
    if ((c.sata || []).some(function (on, n) { return on && !(psu && (s.sata || [])[n]); })) return false;
    if (s.monitor != null && s.monitor !== "gpu" && s.monitor !== "board") return false;
    return true;
  }

  /* ------------------------------------------------------------ the facts */
  function facts(cat, s) {
    var ok = valid(cat, s), f = { valid: ok, boots: false, coolerOk: false, memoryGb: 0, dualChannel: false,
                                  online: false, dnsWorks: false, volumes: {} };
    if (!ok) return f;
    var by = L.catalogOf(cat), part = function (u) { return u ? by[s.items[u].part] : null; };
    // Would it start Windows, with a picture? machine.js's own power button,
    // pressed on a copy.
    var probe = copy(s);
    if (probe.os) probe.os.uncleanShutdown = false;
    var r = L.powerOn(cat, probe);
    f.boots = r.stage === "windows" && !r.dark;
    var cpu = part(s.cpu), cooler = part(s.cooler);
    f.coolerOk = !!(cpu && cooler && s.coolerSeated === true && cooler.watts >= cpu.watts);
    f.memoryGb = L.memoryGb(cat, s);
    f.dualChannel = dual(cat, s);
    if (s.os) {
      f.online = L.online(s);
      f.dnsWorks = L.dnsWorks(s);
      L.disks(cat, s).forEach(function (d) {
        d.disk.parts.forEach(function (v) {
          if (v.letter) f.volumes[v.letter] = { disk: d.uid, fs: v.fs, label: v.label || "", gb: v.gb, style: d.disk.style };
        });
      });
    }
    return f;
  }
  /* Sticks on both channels, in the slots the board's manual says: A2 and
     B2 on a four-slot board (A1 and B1 would work, but isn't what the
     manual asks), A1 and B1 on a two-slot one; or every slot filled.
     (Whether the sticks match isn't asked: each board takes one kind, and
     the catalog has one stick of each kind.) */
  function dual(cat, s) {
    var board = s.board ? L.catalogOf(cat)[s.items[s.board].part] : null;
    if (!board) return false;
    var ram = s.ram || [], four = board.dimms !== 2;
    var at = [0, 1, 2, 3].filter(function (n) { return ram[n]; });
    var key = at.join(",");
    return four ? key === "1,3" || key === "0,1,2,3" : key === "0,1";
  }

  /* ------------------------------------------------------------ a check */
  function read(view, path) {
    var v = String(path).split(".").reduce(function (o, k) { return o == null ? null : o[k]; }, view);
    return v === undefined ? null : v;
  }
  function matches(item, where) {
    return !!item && typeof item === "object" && Object.keys(where).every(function (k) { return item[k] === where[k]; });
  }
  function test(c, view) {
    if (c.all) return c.all.every(function (x) { return test(x, view); });
    if (c.any) return c.any.some(function (x) { return test(x, view); });
    if (c.not) return !test(c.not, view);
    var v = read(view, c.path), want = c.value === undefined ? null : c.value;
    switch (c.op || "==") {
      case "==": return v === want;
      case "!=": return v !== want;
      case ">=": return typeof v === "number" && v >= want;
      case "<=": return typeof v === "number" && v <= want;
      case "startsWith": return typeof v === "string" && v.indexOf(want) === 0;
      case "notStartsWith": return typeof v === "string" && v.indexOf(want) !== 0;
      case "has": return Array.isArray(v) && v.some(function (x) { return matches(x, c.where || {}); });
      case "lacks": return Array.isArray(v) && !v.some(function (x) { return matches(x, c.where || {}); });
    }
    return false;
  }
  // The machine, with the facts beside it: what a check's path reads.
  function view(cat, s) { return Object.assign(copy(s), facts(cat, s)); }

  /* Each task: passed or not, and its points. The machine is sanitized
     against the scenario first, as the server does. */
  function grade(cat, sc, posted) {
    var s = sanitize(sc, posted), v = view(cat, s);
    return sc.tasks.map(function (t) { return { id: t.id, points: t.points, ok: test(t.check, v) }; });
  }

  return { start: start, sanitize: sanitize, valid: valid, facts: facts, test: test, view: view, grade: grade };
})();
