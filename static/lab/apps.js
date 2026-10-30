/* PyIDE — the A+ lab's Windows tools, as apps on the desktop (desktop.js).
 *
 * Each app is a render(body, ctx, win) that draws from the machine's state
 * and acts through machine.js only, then calls ctx.changed() — the desktop
 * redraws every window from the state, so two apps can never disagree (end
 * a task in Task Manager and it's gone from anywhere else that lists it).
 * win.data is the app's own place to remember what's selected or which tab
 * is open; never anything about the machine.
 *
 * The words are Windows' own where the exam expects a student to recognise
 * them — "Code 28", "Not Initialized", "Unallocated", "APIPA", "Kernel-Power
 * 41" — because reading what Windows says is the skill.
 */
(function () {
  "use strict";

  var D = window.PyIDELabDesktop, L = window.PyIDELab, el = D.el;

  // A table: headings, rows of cells, and which row is selected.
  function table(heads, rows, opts) {
    opts = opts || {};
    var t = el("table", { class: "ld-table" });
    t.appendChild(el("thead", {}, [el("tr", {}, heads.map(function (h) { return el("th", { text: h }); }))]));
    var body = el("tbody");
    rows.forEach(function (r) {
      var pickable = opts.onPick && r.key != null;
      var tr = el("tr", { class: (r.key != null && r.key === opts.selected ? "sel " : "") + (r.cls || ""), tabindex: pickable ? "0" : null },
                  r.cells.map(function (c) { return el("td", {}, [c]); }));
      if (opts.onPick && r.key != null) {
        tr.addEventListener("click", function () { opts.onPick(r.key); });
        tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onPick(r.key); } });
      }
      body.appendChild(tr);
    });
    t.appendChild(body);
    if (!rows.length && opts.empty) body.appendChild(el("tr", {}, [el("td", { colspan: String(heads.length), class: "ld-dim", text: opts.empty })]));
    return t;
  }
  function toolbar(buttons) {
    return el("div", { class: "ld-toolbar" }, buttons.map(function (b) {
      return b && el("button", { type: "button", class: "ld-btn", text: b[0], disabled: b[2] ? true : null, onclick: b[1] });
    }));
  }
  function field(label, input) { return el("label", { class: "ld-field" }, [el("span", { text: label }), input]); }
  function select(options, value) {
    var s = el("select", { class: "ld-input" }, options.map(function (o) {
      return el("option", { value: Array.isArray(o) ? o[0] : o, text: Array.isArray(o) ? o[1] : o });
    }));
    if (value != null) s.value = value;
    return s;
  }
  function input(value, attrs) { return el("input", Object.assign({ class: "ld-input", value: value == null ? "" : String(value) }, attrs || {})); }
  function p(text, cls) { return el("p", { class: cls || "", text: text }); }

  function lettersFree(os) {
    var used = {};
    Object.keys(os.disks).forEach(function (k) { os.disks[k].parts.forEach(function (v) { if (v.letter) used[v.letter] = true; }); });
    var out = [];
    for (var c = 68; c <= 90; c++) { var l = String.fromCharCode(c); if (!used[l]) out.push(l); }
    return out;
  }
  // Space used on a volume: Windows itself on C:, nothing yet on a new one.
  function usedGb(v) { return v.letter === "C" ? 38 : 0; }

  /* ===================================================== Device Manager */
  var STATUS_TEXT = {
    ok: "This device is working properly.",
    missing: "The drivers for this device are not installed. (Code 28)",
    disabled: "This device is disabled. (Code 22)"
  };
  D.register("devmgmt", {
    title: "Device Manager", icon: "🧰", w: 620, h: 440,
    render: function (body, ctx, win) {
      var s = ctx.state(), list = L.devices(ctx.cat, s), sel = list.find(function (d) { return d.key === win.data.sel; });
      body.appendChild(toolbar([
        ["Update driver", function () { updateDriver(ctx, win, sel); }, !sel],
        sel && sel.status === "disabled" ? ["Enable device", function () { L.setDeviceEnabled(s, sel.key, true); ctx.changed(); }]
                                         : ["Disable device", function () {
                                             ctx.dialog(win, sel.name, p("Disabling this device will cause it to stop functioning. Do you really want to disable it?"), [
                                               { text: "Yes", primary: true, onclick: function () { return L.setDeviceEnabled(s, sel.key, false); } }, { text: "No" }]);
                                           }, !sel || /^(cpu|disk:)/.test(sel.key)]
      ]));
      var tree = el("ul", { class: "ld-tree", role: "tree" });
      var root = el("li", {}, [el("div", { class: "ld-tree-root", text: "🖥 " + s.os.hostname })]);
      var cats = {};
      list.forEach(function (d) { (cats[d.category] = cats[d.category] || []).push(d); });
      var sub = el("ul");
      Object.keys(cats).sort().forEach(function (c) {
        var items = el("ul");
        cats[c].forEach(function (d) {
          var badge = d.status === "missing" ? el("span", { class: "ld-warn", title: "Problem", text: "⚠" })
                    : d.status === "disabled" ? el("span", { class: "ld-down", title: "Disabled", text: "↓" }) : null;
          items.appendChild(el("li", { role: "treeitem", class: "ld-dev" + (d.key === win.data.sel ? " sel" : ""), tabindex: "0",
                                       onclick: function () { win.data.sel = d.key; ctx.changed(); } }, [badge, " " + d.name]));
        });
        sub.appendChild(el("li", {}, [el("div", { class: "ld-tree-cat", text: "▾ " + c }), items]));
      });
      root.appendChild(sub);
      tree.appendChild(root);
      body.appendChild(tree);
      if (sel) {
        body.appendChild(el("div", { class: "ld-status" }, [
          el("strong", { text: sel.name }),
          p("Device status: " + (sel.basic ? "Working, but on Windows' basic display driver: install the maker's driver for full resolution and speed." : STATUS_TEXT[sel.status]))
        ]));
      }
    }
  });
  function updateDriver(ctx, win, dev) {
    var s = ctx.state(), d;
    function tryWay(how) {
      var r = L.updateDriver(ctx.cat, s, dev.key, how);
      if (r.ok) { d.close(); ctx.dialog(win, "Update Drivers", p("Windows has successfully updated your drivers: " + dev.name + "."), [{ text: "Close", primary: true }]); }
      else d.say(r.why);
      ctx.changed();
    }
    var ways = el("div", { class: "ld-choices" }, [
      el("button", { type: "button", class: "ld-choice", onclick: function () { tryWay("auto"); } },
         [el("strong", { text: "→ Search automatically for drivers" }), el("span", { text: "Windows will search online for the best driver." })]),
      el("button", { type: "button", class: "ld-choice", onclick: function () { tryWay("browse"); } },
         [el("strong", { text: "→ Browse my computer for drivers" }), el("span", { text: "Use the driver from the maker's folder (Desktop › Drivers)." })])
    ]);
    d = ctx.dialog(win, "Update Drivers – " + dev.name, el("div", {}, [p("How do you want to search for drivers?"), ways]), [{ text: "Cancel" }]);
  }

  /* ===================================================== Disk Management */
  D.register("diskmgmt", {
    title: "Disk Management", icon: "💽", w: 760, h: 500,
    render: function (body, ctx, win) {
      var s = ctx.state(), os = s.os, disks = L.disks(ctx.cat, s), sel = win.data.sel || null;
      // Windows asks to initialize a new disk as soon as Disk Management opens.
      var fresh = disks.find(function (d) { return !d.disk.style; });
      if (fresh && !win.data.asked) { win.data.asked = true; setTimeout(function () { initialize(ctx, win, fresh); }, 0); }

      var pick = function (v) { win.data.sel = v; ctx.changed(); };
      var vols = [];
      disks.forEach(function (d) {
        d.disk.parts.forEach(function (v) {
          vols.push({ key: "vol:" + v.letter + ":" + d.uid, cells: [
            (v.label || "") + (v.letter ? " (" + v.letter + ":)" : ""), "Simple", "Basic", v.fs,
            v.letter === "C" ? "Healthy (Boot, Page File, Primary Partition)" : "Healthy (Primary Partition)",
            ctx.size(v.gb), ctx.size(v.gb - usedGb(v))] });
        });
      });
      body.appendChild(table(["Volume", "Layout", "Type", "File System", "Status", "Capacity", "Free Space"], vols,
                             { selected: sel, onPick: pick, empty: "No volumes." }));

      // The disks, drawn as Windows draws them: a label, then each partition across.
      var map = el("div", { class: "ld-disks" });
      disks.forEach(function (d) {
        var row = el("div", { class: "ld-disk" });
        row.appendChild(el("div", { class: "ld-disk-label" + (sel === "disk:" + d.uid ? " sel" : ""), tabindex: "0", onclick: function () { pick("disk:" + d.uid); } }, [
          el("strong", { text: "Disk " + d.n }),
          el("div", { text: d.disk.style ? "Basic" : "Unknown" }),
          el("div", { text: ctx.size(d.part.gb) }),
          el("div", { text: d.disk.style ? "Online" : "Not Initialized" })
        ]));
        var strip = el("div", { class: "ld-disk-strip" });
        d.disk.parts.forEach(function (v) {
          var key = "vol:" + v.letter + ":" + d.uid;
          strip.appendChild(el("div", { class: "ld-part" + (sel === key ? " sel" : ""), style: "flex:" + v.gb, tabindex: "0", onclick: function () { pick(key); } }, [
            el("strong", { text: (v.label || "") + (v.letter ? " (" + v.letter + ":)" : "") }),
            el("div", { text: ctx.size(v.gb) + " " + v.fs }), el("div", { text: "Healthy" })
          ]));
        });
        if (d.free > 0 || !d.disk.style) {
          var key = "free:" + d.uid;
          strip.appendChild(el("div", { class: "ld-part ld-unalloc" + (sel === key ? " sel" : ""), style: "flex:" + Math.max(d.free, d.part.gb * 0.08), tabindex: "0",
                                        onclick: function () { pick(key); } }, [el("strong", { text: ctx.size(d.free) }), el("div", { text: "Unallocated" })]));
        }
        row.appendChild(strip);
        map.appendChild(row);
      });
      if (!disks.length) map.appendChild(p("No disks.", "ld-dim"));

      // What can be done to what's selected — a menu a right-click would give, as buttons.
      var bits = (sel || "").split(":"), disk = disks.find(function (d) { return d.uid === bits[bits.length - 1] || d.uid === bits[1]; });
      var acts = [];
      if (bits[0] === "disk" && disk && !disk.disk.style) acts.push(["Initialize Disk…", function () { initialize(ctx, win, disk); }]);
      if (bits[0] === "free" && disk) acts.push(["New Simple Volume…", function () { newVolume(ctx, win, disk); }, !disk.disk.style]);
      if (bits[0] === "vol") {
        var letter = bits[1];
        acts.push(["Change Drive Letter…", function () { changeLetter(ctx, win, letter); }]);
        acts.push(["Format…", function () { format(ctx, win, letter); }]);
        acts.push(["Delete Volume…", function () {
          ctx.dialog(win, "Delete simple volume", p("Deleting this volume will erase all data on it. Back up any data you want to keep before deleting. Do you want to continue?"), [
            { text: "Yes", primary: true, onclick: function () { var r = L.deleteVolume(s, letter); if (r.ok) win.data.sel = null; return r; } }, { text: "No" }]);
        }]);
      }
      body.appendChild(toolbar(acts.length ? acts : [["Select a disk, a volume or unallocated space", null, true]]));
      body.appendChild(map);
    }
  });
  function initialize(ctx, win, d) {
    var s = ctx.state();
    if (d.disk.style) return;
    var style = select([["GPT", "GPT (GUID Partition Table)"], ["MBR", "MBR (Master Boot Record)"]], "GPT");
    ctx.dialog(win, "Initialize Disk", el("div", {}, [
      p("You must initialize a disk before Logical Disk Manager can access it."),
      p("Disk " + d.n + " · " + ctx.size(d.part.gb)),
      field("Use this partition style:", style),
      p("GPT is what modern PCs (UEFI) use, and any disk over 2 TB needs it. MBR is the old style: four primary partitions at most.", "ld-dim small")
    ]), [{ text: "OK", primary: true, onclick: function () { return L.initializeDisk(s, d.uid, style.value); } }, { text: "Cancel" }]);
  }
  function newVolume(ctx, win, d) {
    var s = ctx.state();
    var gb = input(d.free, { type: "number", min: "1", max: String(d.free) });
    var letter = select(lettersFree(s.os));
    var fs = select(["NTFS", "exFAT", "FAT32"], "NTFS");
    var label = input("New Volume");
    ctx.dialog(win, "New Simple Volume Wizard", el("div", {}, [
      p("Disk " + d.n + ": " + ctx.size(d.free) + " unallocated."),
      field("Simple volume size (GB):", gb), field("Assign the following drive letter:", letter),
      field("File system:", fs), field("Volume label:", label)
    ]), [{ text: "Finish", primary: true, onclick: function () {
      var r = L.newVolume(ctx.cat, s, d.uid, { gb: Number(gb.value) || 0, fs: fs.value, letter: letter.value, label: label.value.slice(0, 32) });
      if (r.ok) win.data.sel = null;      // the space it was made from may be gone
      return r;
    } }, { text: "Cancel" }]);
  }
  function changeLetter(ctx, win, from) {
    var s = ctx.state(), to = select(lettersFree(s.os));
    ctx.dialog(win, "Change Drive Letter and Paths for " + from + ":", field("Assign the following drive letter:", to), [
      { text: "OK", primary: true, onclick: function () { var r = L.changeLetter(s, from, to.value); if (r.ok) win.data.sel = null; return r; } }, { text: "Cancel" }]);
  }
  function format(ctx, win, letter) {
    var s = ctx.state(), v = L.findVolume(s.os, letter).part;
    var fs = select(["NTFS", "exFAT", "FAT32"], v.fs), label = input(v.label);
    ctx.dialog(win, "Format " + letter + ":", el("div", {}, [
      field("Volume label:", label), field("File system:", fs),
      p("Formatting this volume will erase all data on it.", "ld-dim small")
    ]), [{ text: "OK", primary: true, onclick: function () { return L.formatVolume(s, letter, fs.value, label.value.slice(0, 32)); } }, { text: "Cancel" }]);
  }

  /* ===================================================== Task Manager */
  D.register("taskmgr", {
    title: "Task Manager", icon: "📊", w: 600, h: 440,
    render: function (body, ctx, win) {
      var s = ctx.state(), os = s.os, tab = win.data.tab || "procs";
      body.appendChild(el("div", { class: "ld-tabs", role: "tablist" }, [["procs", "Processes"], ["perf", "Performance"], ["startup", "Startup apps"]].map(function (t) {
        return el("button", { type: "button", role: "tab", class: "ld-tab" + (tab === t[0] ? " on" : ""), "aria-selected": String(tab === t[0]), text: t[1],
                              onclick: function () { win.data.tab = t[0]; win.data.sel = null; ctx.changed(); } });
      })));
      var cpu = os.procs.reduce(function (a, x) { return a + x.cpu; }, 0), memMb = os.procs.reduce(function (a, x) { return a + x.mem; }, 0);
      var memGb = L.memoryGb(ctx.cat, s);
      if (tab === "procs") {
        body.appendChild(toolbar([["End task", function () {
          var r = L.endTask(s, win.data.sel);
          if (!r.ok) ctx.dialog(win, "Task Manager", p(r.why)); else win.data.sel = null;
          ctx.changed();
        }, !win.data.sel]]));
        body.appendChild(table(["Name", "CPU", "Memory"], os.procs.slice().sort(function (a, b) { return b.cpu - a.cpu; }).map(function (x) {
          return { key: x.name, cls: x.cpu >= 50 ? "hot" : "", cells: [x.name, x.cpu + "%", x.mem + " MB"] };
        }), { selected: win.data.sel, onPick: function (k) { win.data.sel = k; ctx.changed(); } }));
        body.appendChild(p("Total: CPU " + Math.min(100, cpu) + "% · Memory " + (memMb / 1024).toFixed(1) + " GB in use", "ld-dim small"));
      } else if (tab === "perf") {
        var gauge = function (name, pct, text) {
          return el("div", { class: "ld-gauge" }, [el("div", { class: "ld-gauge-name", text: name }),
            el("div", { class: "ld-gauge-bar" }, [el("div", { class: "ld-gauge-fill" + (pct >= 80 ? " hot" : ""), style: "width:" + Math.min(100, pct) + "%" })]),
            el("div", { class: "ld-dim small", text: text })]);
        };
        var cpuPart = L.partOf(ctx.cat, s, s.cpu);
        body.appendChild(gauge("CPU", cpu, Math.min(100, cpu) + "% · " + (cpuPart ? cpuPart.name : "")));
        body.appendChild(gauge("Memory", memGb ? memMb / (memGb * 1024) * 100 : 0, (memMb / 1024).toFixed(1) + " GB of " + memGb + " GB in use"));
        var ns = L.online(s) ? "Connected" : os.net.ip ? "Connected, no internet" : "Not connected";
        body.appendChild(gauge("Ethernet", os.net.ip ? 3 : 0, ns + (os.net.ip ? " · IPv4 " + os.net.ip : "")));
        body.appendChild(p("CPU temperature isn't something Windows shows here: the BIOS shows it (on the bench).", "ld-dim small"));
      } else {
        var sel = os.startup.find(function (x) { return x.name === win.data.sel; });
        body.appendChild(toolbar([[sel && !sel.enabled ? "Enable" : "Disable", function () { L.setStartup(s, sel.name, !sel.enabled); ctx.changed(); }, !sel]]));
        body.appendChild(table(["Name", "Status", "Startup impact"], os.startup.map(function (x) {
          return { key: x.name, cells: [x.name, x.enabled ? "Enabled" : "Disabled", x.enabled ? x.impact : "None"] };
        }), { selected: win.data.sel, onPick: function (k) { win.data.sel = k; ctx.changed(); }, empty: "No start-up apps." }));
      }
    }
  });

  /* ===================================================== Event Viewer */
  // When each start happened, for the Date and Time column: a few minutes
  // apart, ending now. The machine counts starts, not clock time.
  function startTime(boot, last) {
    var d = new Date(Date.now() - (last - boot) * 7 * 60000);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }
  var LEVEL_ICON = { Information: "ⓘ", Warning: "⚠", Error: "⛔", Critical: "⛔" };
  D.register("eventvwr", {
    title: "Event Viewer", icon: "📋", w: 720, h: 470,
    render: function (body, ctx, win) {
      var os = ctx.state().os, events = os.events.slice().reverse();
      var sel = events.find(function (e) { return e.n === win.data.sel; });
      body.appendChild(el("div", { class: "ld-crumb", text: "Event Viewer (Local) › Windows Logs › System · " + events.length + " events" }));
      body.appendChild(table(["Level", "Date and Time", "Source", "Event ID"], events.map(function (e) {
        return { key: e.n, cls: "lvl-" + e.level.toLowerCase(), cells: [LEVEL_ICON[e.level] + " " + e.level, startTime(e.boot, os.bootCount), e.source, String(e.id)] };
      }), { selected: win.data.sel, onPick: function (k) { win.data.sel = k; ctx.changed(); }, empty: "No events." }));
      if (sel) {
        body.appendChild(el("div", { class: "ld-status" }, [
          el("strong", { text: "Event " + sel.id + ", " + sel.source }),
          p(sel.msg),
          el("div", { class: "ld-dim small", text: "Log Name: System · Level: " + sel.level + " · Logged: " + startTime(sel.boot, os.bootCount) })
        ]));
      }
    }
  });

  /* ===================================================== System Information */
  D.register("msinfo32", {
    title: "System Information", icon: "ℹ️", w: 600, h: 430,
    render: function (body, ctx) {
      var s = ctx.state(), part = function (k) { return L.partOf(ctx.cat, s, s[k]); };
      var cpu = part("cpu"), board = part("board"), gpu = part("gpu");
      var sticks = s.ram.filter(Boolean).length;
      var rows = [
        ["OS Name", "Windows (lab edition)"], ["System Name", s.os.hostname], ["System Manufacturer", "Built by you"],
        ["System Type", "x64-based PC"], ["Processor", cpu ? cpu.name : ""],
        ["BIOS Mode", "UEFI"], ["BaseBoard Product", board ? board.name : ""],
        ["Installed Physical Memory (RAM)", L.memoryGb(ctx.cat, s).toFixed(1) + " GB (" + sticks + (sticks === 1 ? " stick)" : " sticks)")],
        ["Display", gpu ? gpu.name : cpu && cpu.graphics ? "The CPU's own graphics" : ""],
        ["Disks", L.disks(ctx.cat, s).map(function (d) { return "Disk " + d.n + ": " + d.part.name; }).join("; ")]
      ];
      body.appendChild(table(["Item", "Value"], rows.map(function (r) { return { cells: r }; })));
    }
  });

  /* ===================================================== Settings */
  D.register("settings", {
    title: "Settings", icon: "⚙️", w: 680, h: 480,
    render: function (body, ctx, win) {
      var s = ctx.state(), os = s.os, page = win.data.page || "network";
      var side = el("nav", { class: "ld-side" }, [["network", "🌐 Network & internet"], ["about", "💻 System › About"]].map(function (x) {
        return el("button", { type: "button", class: "ld-side-btn" + (page === x[0] ? " on" : ""), text: x[1], onclick: function () { win.data.page = x[0]; ctx.changed(); } });
      }));
      var main = el("div", { class: "ld-main" });
      body.appendChild(el("div", { class: "ld-split" }, [side, main]));
      if (page === "about") {
        var cpu = L.partOf(ctx.cat, s, s.cpu);
        main.appendChild(el("h3", { text: "About" }));
        main.appendChild(table(["", ""], [["Device name", os.hostname], ["Processor", cpu ? cpu.name : ""],
          ["Installed RAM", L.memoryGb(ctx.cat, s) + " GB"], ["System type", "64-bit operating system, x64-based processor"]].map(function (r) { return { cells: r }; })));
        return;
      }
      var n = os.net, up = n.enabled && !os.disabled.net && os.drivers.net === "ok";
      var status = !up ? ["⛔", "Not connected", os.drivers.net !== "ok" ? "The network adapter has no driver (see Device Manager)." : "The Ethernet adapter is disabled."]
        : !n.ip ? ["⛔", "Not connected", "No IP address."]
        : /^169\.254\./.test(n.ip) ? ["⚠", "Unidentified network · No internet", "The address starts 169.254: Windows gave it to itself (APIPA) because no DHCP server answered."]
        : !L.online(s) ? ["⚠", "No internet", "Connected to the local network, but it can't reach the internet."]
        : !L.dnsWorks(s) ? ["⚠", "No internet", "Connected, but names can't be looked up (DNS)."]
        : ["🌐", "Connected", "You're connected to the internet."];
      main.appendChild(el("h3", { text: "Network & internet" }));
      main.appendChild(el("div", { class: "ld-netcard" }, [el("span", { class: "ld-netcard-icon", text: status[0] }),
        el("div", {}, [el("strong", { text: "Ethernet · " + status[1] }), p(status[2], "ld-dim small")])]));
      main.appendChild(toolbar([
        ["Edit IP settings…", function () { editIp(ctx, win); }, !up],
        [up ? "Disable adapter" : "Enable adapter", function () { L.setDeviceEnabled(s, "net", !up); ctx.changed(); }, os.drivers.net !== "ok"]
      ]));
      main.appendChild(table(["Ethernet properties", ""], [
        ["IP assignment", n.dhcp ? "Automatic (DHCP)" : "Manual"],
        ["IPv4 address", n.ip || "—"], ["IPv4 mask", n.mask || "—"], ["Default gateway", n.gateway || "—"],
        ["IPv4 DNS servers", n.dns.length ? n.dns.join(", ") : "—"],
        ["Physical address (MAC)", "3C-7A-41-2E-90-1B"]
      ].map(function (r) { return { cells: r }; })));
    }
  });
  function editIp(ctx, win) {
    var s = ctx.state(), n = s.os.net;
    var mode = select([["dhcp", "Automatic (DHCP)"], ["manual", "Manual"]], n.dhcp ? "dhcp" : "manual");
    var ip = input(n.dhcp ? "" : n.ip, { placeholder: "192.168.1.80" }), mask = input(n.dhcp ? "255.255.255.0" : n.mask);
    var gw = input(n.dhcp ? "" : n.gateway, { placeholder: "192.168.1.1" });
    var dns1 = input(n.dhcp ? "" : n.dns[0] || ""), dns2 = input(n.dhcp ? "" : n.dns[1] || "");
    var manual = el("div", {}, [field("IP address", ip), field("Subnet mask", mask), field("Gateway", gw),
                                field("Preferred DNS", dns1), field("Alternate DNS", dns2)]);
    function show() { manual.hidden = mode.value !== "manual"; }
    mode.addEventListener("change", show);
    show();
    ctx.dialog(win, "Edit IP settings", el("div", {}, [field("", mode), manual]), [
      { text: "Save", primary: true, onclick: function () {
        if (mode.value === "dhcp") return L.setIp(s, { dhcp: true });
        return L.setIp(s, { ip: ip.value.trim(), mask: mask.value.trim(), gateway: gw.value.trim(),
                            dns: [dns1.value.trim(), dns2.value.trim()].filter(Boolean) });
      } }, { text: "Cancel" }]);
  }

  /* ===================================================== File Explorer */
  var DRIVER_FILES = ["Chipset", "Ethernet (network)", "Audio", "Graphics"];
  D.register("explorer", {
    title: "File Explorer", icon: "📁", w: 640, h: 420,
    render: function (body, ctx, win) {
      var s = ctx.state(), os = s.os, path = win.data.path || "pc";
      var nav = [["pc", "🖥 This PC"]];
      if (os.driverFolder) nav.push(["drivers", "📁 Drivers"]);
      nav.push(["bin", "🗑 Recycle Bin"]);
      var side = el("nav", { class: "ld-side" }, nav.map(function (x) {
        return el("button", { type: "button", class: "ld-side-btn" + (path === x[0] ? " on" : ""), text: x[1], onclick: function () { win.data.path = x[0]; ctx.changed(); } });
      }));
      var main = el("div", { class: "ld-main" });
      body.appendChild(el("div", { class: "ld-split" }, [side, main]));
      var go = function (to) { win.data.path = to; ctx.changed(); };
      if (path === "pc") {
        main.appendChild(el("div", { class: "ld-crumb", text: "This PC › Devices and drives" }));
        var tiles = el("div", { class: "ld-drives" });
        L.disks(ctx.cat, s).forEach(function (d) {
          d.disk.parts.forEach(function (v) {
            if (!v.letter) return;
            var used = usedGb(v);
            tiles.appendChild(el("button", { type: "button", class: "ld-drive", onclick: function () { go("vol:" + v.letter); } }, [
              el("span", { class: "ld-drive-pic", text: v.letter === "C" ? "💻" : "💽" }),
              el("div", {}, [el("strong", { text: (v.label || "Local Disk") + " (" + v.letter + ":)" }),
                el("div", { class: "ld-gauge-bar" }, [el("div", { class: "ld-gauge-fill", style: "width:" + Math.max(2, used / v.gb * 100) + "%" })]),
                el("div", { class: "ld-dim small", text: ctx.size(v.gb - used) + " free of " + ctx.size(v.gb) })])
            ]));
          });
        });
        main.appendChild(tiles);
        main.appendChild(p("A new drive shows here only once it has a volume with a letter (Disk Management).", "ld-dim small"));
      } else if (path === "drivers") {
        main.appendChild(el("div", { class: "ld-crumb", text: "Desktop › Drivers" }));
        main.appendChild(p("The maker's drivers for this computer. In Device Manager, Update driver › Browse my computer finds them here.", "ld-dim small"));
        main.appendChild(table(["Name", "Type"], DRIVER_FILES.map(function (f) { return { cells: ["📄 " + f, "Setup Information"] }; })));
      } else if (path === "bin") {
        main.appendChild(el("div", { class: "ld-crumb", text: "Recycle Bin" }));
        main.appendChild(p("The Recycle Bin is empty.", "ld-dim"));
      } else {
        var letter = path.split(":")[1], v = L.findVolume(os, letter);
        main.appendChild(el("div", { class: "ld-crumb" }, [el("button", { type: "button", class: "ld-link", text: "This PC", onclick: function () { go("pc"); } }),
          " › " + (v ? (v.part.label || "Local Disk") + " (" + letter + ":)" : letter + ":")]));
        if (!v) main.appendChild(p("That drive isn't there any more.", "ld-dim"));
        else if (letter === "C") main.appendChild(table(["Name", "Type"], ["PerfLogs", "Program Files", "Program Files (x86)", "Users", "Windows"].map(function (f) {
          return { cells: ["📁 " + f, "File folder"] };
        })));
        else main.appendChild(p("This folder is empty.", "ld-dim"));
      }
    }
  });
})();
