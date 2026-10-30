/* PyIDE — the A+ lab's bench: the PC drawn, its parts on a shelf, and the
 * power button.
 *
 * machine.js is the computer; this only draws it and calls it. A part goes
 * in by dragging it from the shelf onto the board (or tapping it, then
 * tapping the glowing place it can go — a Chromebook's touchscreen and a
 * mouse alike); a part in the computer comes out by tapping it and pressing
 * Take out. What's refused is refused by machine.js, in its words, so the
 * reason a student reads here is the reason the server grades on.
 *
 * Drawn here, our own: no photographs, no brands. The board is laid out like
 * a real one (socket, memory slots beside it, M.2 under it, the x16 slot
 * below, SATA ports and the 24-pin on the edge) because recognising where
 * things go is part of what A+ asks.
 *
 *   PyIDELabBench.mount(element, {catalog, state, onChange, readOnly, onBoot})
 *
 * onChange(state) after every change (to save it); onBoot(state) when
 * Windows starts (the desktop, desktop.js, takes over the screen then).
 */
window.PyIDELabBench = (function () {
  "use strict";

  var L = window.PyIDELab;
  var SVG = "http://www.w3.org/2000/svg";
  // Lab time: a minute of the machine's in a few seconds of the class's, so
  // an overheating CPU turns the PC off while the student is still watching.
  var LAB_SECONDS_PER_TICK = 10;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null) return;      // disabled: null means not disabled
      if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, text) {
    var e = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  var ICON = { case: "🗄", board: "🟩", cpu: "🔲", cooler: "🌀", ram: "▤", psu: "🔌", gpu: "🎴", drive: "💾" };
  var TYPE_NAME = { case: "Case", board: "Motherboard", cpu: "CPU", cooler: "CPU cooler", ram: "Memory", psu: "Power supply", gpu: "Graphics card", drive: "Drive" };

  // What a spec card says about a part: the facts that decide where it goes.
  function specs(p) {
    var rows = [];
    if (p.socket) rows.push(["Socket", p.socket]);
    if (p.ram) rows.push([p.type === "board" ? "Memory" : "Type", p.ram]);
    if (p.form) rows.push(["Form factor", p.form]);
    if (p.fits) rows.push(["Takes boards", p.fits.join(", ")]);
    if (p.dimms) rows.push(["Memory slots", p.dimms === 2 ? "2 (A1, B1)" : "4 (A1, A2, B1, B2)"]);
    if (p.m2 != null && p.type === "board") rows.push(["M.2 slots", p.m2]);
    if (p.sata != null && p.type === "board") rows.push(["SATA ports", p.sata]);
    if (p.type === "board") rows.push(["Beep codes", "1 short: OK · 3 short: memory · 1 long 3 short: video"]);
    if (p.type === "cpu") rows.push(["Power (TDP)", p.watts + " W"], ["Graphics", p.graphics ? "Yes" : "No — needs a graphics card"]);
    if (p.type === "cooler") rows.push(["Cools up to", p.watts + " W"]);
    if (p.type === "psu") rows.push(["Output", p.watts + " W"], ["PCIe power cable", p.pcie ? "Yes (8-pin)" : "No"]);
    if (p.type === "gpu") rows.push(["Power", p.watts + " W"], ["Power cable", p.power ? "8-pin PCIe" : "None: the slot powers it"]);
    if (p.gb) rows.push(["Size", p.gb >= 1000 ? p.gb / 1000 + " TB" : p.gb + " GB"]);
    if (p.iface) rows.push(["Connects by", p.iface === "M.2" ? "M.2 slot (NVMe)" : "SATA data + SATA power cables"]);
    if (p.media) rows.push(["Kind", p.media]);
    return rows;
  }

  /* A piece's name on the shelf and its card: the part's, and whether
     Windows is on it — two of the same drive look alike otherwise, and only
     one of them starts a computer. */
  function nameOf(cat, state, uid) {
    var p = L.partOf(cat, state, uid);
    return p.name + (state.items[uid].windows ? " — Windows installed" : "");
  }

  function mount(root, opts) {
    var cat = opts.catalog, state = opts.state, parts = L.catalogOf(cat);
    var readOnly = !!opts.readOnly;
    var selected = null;          // {from: "shelf", uid} or {from: place, index}
    var message = "";
    var ticker = null;

    root.classList.add("lab-bench");
    var shelf = el("div", { class: "lab-shelf", "aria-label": "Parts" });
    var stage = el("div", { class: "lab-stage" });
    var side = el("div", { class: "lab-side" });
    root.appendChild(shelf);
    root.appendChild(stage);
    root.appendChild(side);

    function changed() {
      draw();
      if (opts.onChange) opts.onChange(state);
    }
    function say(text) { message = text || ""; }
    function part(uid) { return L.partOf(cat, state, uid); }

    /* ---------------------------------------------------------- the shelf */
    function drawShelf() {
      shelf.textContent = "";
      shelf.appendChild(el("div", { class: "lab-head", text: "Parts" }));
      if (!state.shelf.length) shelf.appendChild(el("p", { class: "dim small", text: "Everything's in the computer." }));
      var order = ["case", "board", "cpu", "cooler", "ram", "psu", "gpu", "drive"];
      state.shelf.slice().sort(function (a, b) {
        return order.indexOf(part(a).type) - order.indexOf(part(b).type) || part(a).name.localeCompare(part(b).name);
      }).forEach(function (uid) {
        var p = part(uid), on = selected && selected.from === "shelf" && selected.uid === uid;
        var card = el("button", { type: "button", class: "lab-part" + (on ? " on" : ""), "data-uid": uid,
                                  title: nameOf(cat, state, uid), "aria-pressed": String(!!on) }, [
          el("span", { class: "lab-part-icon", text: ICON[p.type] || "▫" }),
          el("span", { class: "lab-part-name", text: nameOf(cat, state, uid) })
        ]);
        if (!readOnly) dragOrTap(card, uid);
        shelf.appendChild(card);
      });
    }

    /* Drag a part onto a place, or tap it then tap the place: both, since
       a touchscreen drag is easy to fumble and a tap never is. */
    function dragOrTap(card, uid) {
      card.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        var start = { x: e.clientX, y: e.clientY }, ghost = null;
        function move(ev) {
          if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) {
            selected = { from: "shelf", uid: uid };
            drawBoard();
            ghost = el("div", { class: "lab-ghost", text: (ICON[part(uid).type] || "") + " " + part(uid).name });
            document.body.appendChild(ghost);
          }
          if (ghost) { ghost.style.left = ev.clientX + 12 + "px"; ghost.style.top = ev.clientY + 12 + "px"; }
        }
        function up(ev) {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          if (!ghost) {             // a tap: select it, or let go of it
            selected = selected && selected.uid === uid ? null : { from: "shelf", uid: uid };
            say("");
            draw();
            return;
          }
          ghost.remove();
          var target = document.elementFromPoint(ev.clientX, ev.clientY);
          var spot = target && target.closest && target.closest("[data-place]");
          if (spot) place(spot.getAttribute("data-place"));
          else { selected = null; draw(); }
        }
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });
    }

    // Put the selected shelf part where `spot` says ("ram:2", "cpu", …).
    function place(spot) {
      if (!selected || selected.from !== "shelf") return;
      var bits = spot.split(":"), r = L.install(cat, state, bits[0], selected.uid, bits[1] == null ? undefined : Number(bits[1]));
      say(r.ok ? "" : r.why);
      if (r.ok) selected = null;
      changed();
    }

    /* ---------------------------------------------------------- the drawing */
    function drawBoard() {
      stage.textContent = "";
      var svg = sv("svg", { viewBox: "0 0 800 560", class: "lab-svg", role: "img", "aria-label": "The computer" });
      stage.appendChild(svg);
      var holding = selected && selected.from === "shelf" ? part(selected.uid) : null;
      // A place a part can go: glows when the part in hand could go there.
      function spot(placeName, x, y, w, h, label, accepts, filledBy) {
        var g = sv("g", { "data-place": placeName, class: "lab-spot" + (filledBy ? " filled" : "") +
                          (holding && !filledBy && accepts(holding) ? " can" : "") });
        g.appendChild(sv("rect", { x: x, y: y, width: w, height: h, rx: 3, class: "lab-spot-box" }));
        if (filledBy) {
          var p = part(filledBy);
          g.appendChild(sv("rect", { x: x + 2, y: y + 2, width: w - 4, height: h - 4, rx: 2, class: "lab-fill lab-fill-" + p.type }));
          g.setAttribute("data-uid", filledBy);
          g.addEventListener("click", function (e) {
            e.stopPropagation();
            var bits = placeName.split(":");
            selected = { from: bits[0], index: bits[1] == null ? undefined : Number(bits[1]), uid: filledBy };
            say("");
            draw();
          });
          if (selected && selected.uid === filledBy) g.classList.add("picked");
        } else {
          g.addEventListener("click", function () { if (holding) place(placeName); });
        }
        if (label) g.appendChild(sv("text", { x: x + w / 2, y: y + h / 2 + 4, class: "lab-label" }, label));
        svg.appendChild(g);
        return g;
      }
      var is = function (t) { return function (p) { return p.type === t; }; };

      if (!state.case) {
        spot("case", 60, 40, 680, 480, "Put a case here", is("case"), null);
        return;
      }
      var box = part(state.case);
      svg.appendChild(sv("rect", { x: 20, y: 10, width: 760, height: 540, rx: 10, class: "lab-case" }));
      svg.appendChild(sv("text", { x: 34, y: 32, class: "lab-case-name" }, box.name));
      var caseSpot = sv("g", { "data-place": "case", "data-uid": state.case, class: "lab-spot filled lab-case-hit" });
      caseSpot.appendChild(sv("rect", { x: 560, y: 16, width: 210, height: 22, rx: 3, class: "lab-spot-box" }));
      caseSpot.appendChild(sv("text", { x: 665, y: 31, class: "lab-label small" }, "the case (tap to take out)"));
      caseSpot.addEventListener("click", function () { selected = { from: "case", uid: state.case }; say(""); draw(); });
      svg.appendChild(caseSpot);

      // The power supply: bottom left, in its bay.
      spot("psu", 40, 440, 230, 92, state.psu ? "" : "Power supply bay", is("psu"), state.psu);
      if (state.psu) svg.appendChild(sv("text", { x: 155, y: 492, class: "lab-label" }, part(state.psu).watts + " W PSU"));

      // Drive bays: right side, for the SATA drives.
      var b = part(state.board);
      if (!state.board) {
        spot("board", 110, 50, 450, 370, "Motherboard", is("board"), null);
        return;
      }
      var w = b.form === "ATX" ? 450 : b.form === "mATX" ? 380 : 300, h = b.form === "ATX" ? 370 : b.form === "mATX" ? 330 : 270;
      var bx = 110, by = 50;
      var boardSpot = spot("board", bx, by, w, h, "", is("board"), state.board);
      boardSpot.classList.add("lab-board");
      svg.appendChild(sv("text", { x: bx + 10, y: by + h - 10, class: "lab-board-name" }, b.form + " · socket " + b.socket + " · " + b.ram));

      // CPU and its cooler.
      var cx = bx + 60, cy = by + 50;
      spot("cpu", cx, cy, 90, 90, state.cpu ? "" : "CPU socket " + b.socket, is("cpu"), state.cpu);
      if (state.cpu) svg.appendChild(sv("text", { x: cx + 45, y: cy + 50, class: "lab-label small" }, "CPU"));
      if (state.cpu) {
        var cool = spot("cooler", cx - 10, cy - 10, 110, 110, state.cooler ? "" : "", is("cooler"), state.cooler);
        if (!state.cooler) cool.classList.add("lab-cooler-empty");
        if (state.cooler) {
          svg.appendChild(sv("circle", { cx: cx + 45, cy: cy + 45, r: 40, class: "lab-fan" + (state.coolerSeated ? "" : " crooked") }));
          svg.appendChild(sv("text", { x: cx + 45, y: cy + 49, class: "lab-label small" }, state.coolerSeated ? "cooler" : "cooler (loose)"));
        }
      }
      // CPU 8-pin power, top left of the board.
      svg.appendChild(sv("rect", { x: bx + 12, y: by + 12, width: 34, height: 16, rx: 2, class: "lab-conn" + (state.cables.cpu8 ? " on" : "") }));
      svg.appendChild(sv("text", { x: bx + 29, y: by + 44, class: "lab-label tiny" }, "8-pin"));

      // Memory slots, right of the socket.
      var slots = L.ramSlots(cat, state);
      slots.forEach(function (name, i) {
        var x = cx + 130 + i * 26;
        spot("ram:" + i, x, cy - 20, 18, 160, "", is("ram"), state.ram[i]);
        svg.appendChild(sv("text", { x: x + 9, y: cy + 156, class: "lab-label tiny" }, name));
      });
      // 24-pin, right edge.
      svg.appendChild(sv("rect", { x: bx + w - 26, y: cy, width: 16, height: 70, rx: 2, class: "lab-conn" + (state.cables.atx24 ? " on" : "") }));
      svg.appendChild(sv("text", { x: bx + w - 18, y: cy + 86, class: "lab-label tiny" }, "24-pin"));
      // M.2 under the socket.
      for (var m = 0; m < b.m2; m++) {
        spot("m2:" + m, cx - 10, cy + 130 + m * 30, 150, 20, state.m2[m] ? "" : "M.2 slot " + (m + 1), function (p) { return p.type === "drive" && p.iface === "M.2"; }, state.m2[m]);
      }
      // PCIe x16 below.
      var py = by + h - 80;
      spot("gpu", bx + 30, py, w - 110, 26, state.gpu ? "" : "PCIe x16 slot", is("gpu"), state.gpu);
      if (state.gpu) svg.appendChild(sv("text", { x: bx + 30 + (w - 110) / 2, y: py + 18, class: "lab-label small" },
                                         part(state.gpu).watts + " W graphics card" + (part(state.gpu).power ? (state.cables.gpu8 ? " · 8-pin in" : " · 8-pin OUT") : "")));
      // SATA ports, right edge low; their drives in the bays.
      for (var s = 0; s < b.sata; s++) {
        var sy = by + h - 130 + s * 22;
        spot("sata:" + s, bx + w - 40, sy, 30, 16, "", function (p) { return p.type === "drive" && p.iface === "SATA"; }, state.sata[s]);
        svg.appendChild(sv("text", { x: bx + w - 52, y: sy + 12, class: "lab-label tiny end" }, "SATA" + s));
        if (state.sata[s]) {
          var d = part(state.sata[s]);
          svg.appendChild(sv("rect", { x: 600, y: 80 + s * 70, width: 160, height: 56, rx: 4, class: "lab-drive" + (state.cables.sata[s] ? " powered" : "") }));
          svg.appendChild(sv("text", { x: 680, y: 104 + s * 70, class: "lab-label small" }, d.gb >= 1000 ? d.gb / 1000 + " TB " + d.media : d.gb + " GB " + d.media));
          svg.appendChild(sv("text", { x: 680, y: 122 + s * 70, class: "lab-label tiny" }, state.cables.sata[s] ? "data + power" : "data only — no power"));
        }
      }
      // The coin battery.
      svg.appendChild(sv("circle", { cx: bx + w - 70, cy: by + 40, r: 14, class: "lab-cmos" + (state.cmos ? "" : " flat") }));
      svg.appendChild(sv("text", { x: bx + w - 70, y: by + 70, class: "lab-label tiny" }, "CMOS"));
    }

    /* ---------------------------------------------------------- the side panel */
    function drawSide() {
      side.textContent = "";
      var p = selected ? part(selected.uid) : null;
      if (message) side.appendChild(el("p", { class: "lab-msg", role: "alert", text: message }));
      if (p) {
        var card = el("div", { class: "lab-card" }, [
          el("div", { class: "lab-head", text: (TYPE_NAME[p.type] || p.type) }),
          el("p", { class: "lab-card-name", text: nameOf(cat, state, selected.uid) })
        ]);
        var table = el("table", { class: "lab-specs" });
        specs(p).forEach(function (r) { table.appendChild(el("tr", {}, [el("th", { text: r[0] }), el("td", { text: String(r[1]) })])); });
        card.appendChild(table);
        if (state.items[selected.uid].faulty && opts.revealFaults) card.appendChild(el("p", { class: "lab-msg", text: "This part is faulty." }));
        if (!readOnly && selected.from !== "shelf") {
          card.appendChild(el("button", { type: "button", class: "btn", text: "Take out", onclick: function () {
            var r = L.remove(cat, state, selected.from, selected.index);
            say(r.ok ? "" : r.why);
            if (r.ok) selected = null;
            changed();
          } }));
          if (selected.from === "cooler") card.appendChild(el("button", { type: "button", class: "btn", text: "Reseat (new paste, all screws)", onclick: function () {
            var r = L.reseatCooler(state); say(r.ok ? "Reseated: new thermal paste, all four screws tight." : r.why); changed();
          } }));
        } else if (!readOnly) {
          card.appendChild(el("p", { class: "dim small", text: "Drag it to the computer, or tap where it goes (it glows)." }));
        }
        side.appendChild(card);
      }

      // Cables: what's plugged in, and plugging it.
      var cables = el("div", { class: "lab-card" }, [el("div", { class: "lab-head", text: "Cables" })]);
      function cable(label, key, index, present) {
        if (!present) return;
        var on = key === "sata" ? state.cables.sata[index] : state.cables[key];
        var box = el("input", { type: "checkbox" });
        box.checked = !!on;
        box.disabled = readOnly;
        box.addEventListener("change", function () {
          var r = L.connect(cat, state, key, box.checked, index);
          say(r.ok ? "" : r.why);
          changed();
        });
        cables.appendChild(el("label", { class: "lab-cable" }, [box, " " + label]));
      }
      cable("24-pin motherboard power", "atx24", null, !!state.board);
      cable("8-pin CPU power", "cpu8", null, !!state.board);
      cable("8-pin PCIe power to the graphics card", "gpu8", null, !!state.gpu && part(state.gpu).power);
      state.sata.forEach(function (uid, i) { cable("SATA power to the drive on SATA" + i, "sata", i, !!uid); });
      var mon = el("select", { class: "field", "aria-label": "Monitor cable" }, [
        el("option", { value: "", text: "Monitor: not plugged in" }),
        el("option", { value: "board", text: "Monitor: into the motherboard's video port" }),
        el("option", { value: "gpu", text: "Monitor: into the graphics card" })
      ]);
      mon.value = state.monitor || "";
      mon.disabled = readOnly;
      mon.addEventListener("change", function () { L.setMonitor(state, mon.value); changed(); });
      cables.appendChild(mon);
      if (!state.cmos) cables.appendChild(el("button", { type: "button", class: "btn", text: "Replace the CMOS battery", disabled: readOnly ? "" : null,
        onclick: function () { var r = L.replaceCmosBattery(state); say(r.ok ? "New CMOS battery in." : r.why); changed(); } }));
      side.appendChild(cables);

      // Power: the button, the lights, the beeps, the screen.
      var post = state.post, on = state.power.on;
      var power = el("div", { class: "lab-card lab-power" }, [el("div", { class: "lab-head", text: "Power" })]);
      power.appendChild(el("button", { type: "button", class: "btn " + (on ? "" : "btn-primary"), text: on ? "Turn off" : "⏻ Power on",
        disabled: readOnly ? "" : null, onclick: function () {
          if (state.power.on) { L.powerOff(state); stopTicking(); }
          else {
            var r = L.powerOn(cat, state);
            beep(r.beeps);
            if (state.power.on) startTicking();
            if (r.stage === "windows" && !r.dark && opts.onBoot) opts.onBoot(state);
          }
          say("");
          changed();
        } }));
      var leds = el("div", { class: "lab-leds", "aria-label": "Debug lights" });
      ["CPU", "DRAM", "VGA", "BOOT"].forEach(function (name) {
        leds.appendChild(el("span", { class: "lab-led" + (post && post.led === name && (on || post.stage === "nopost") ? " lit" : ""), text: name }));
      });
      power.appendChild(leds);
      if (post) {
        var what = { nopower: "Nothing happens: no fans, no lights.", shutoff: "It came on for a second, then switched off.",
                     nopost: "The fans spin, but nothing else happens.", ram: "It beeps.", video: "It beeps, and the screen stays black.",
                     noboot: "", windows: post.dark ? "The fans spin and it beeped once, but the screen is black." : "" }[post.stage];
        if (what) power.appendChild(el("p", { text: what }));
        if (post.beeps) power.appendChild(el("p", { class: "small", text: "🔊 Beeps: " + post.beeps }));
        post.notes.forEach(function (n) { if (/CMOS/.test(n)) power.appendChild(el("p", { class: "lab-bios", text: n })); });
        var screen = el("div", { class: "lab-screen" + (on && !post.dark && post.screen ? " lit" : "") },
                        [on && !post.dark ? (post.stage === "windows" ? "Windows is running." : post.screen) : ""]);
        power.appendChild(screen);
        if (on) power.appendChild(el("p", { class: "small dim", text: "CPU temperature (BIOS): " + L.cpuTemp(state) + " °C" }));
      }
      side.appendChild(power);
    }

    function draw() { drawShelf(); drawBoard(); drawSide(); }

    /* ---------------------------------------------------------- time and sound */
    function startTicking() {
      stopTicking();
      ticker = setInterval(function () {
        var what = L.tick(cat, state, LAB_SECONDS_PER_TICK);
        if (what === "overheated") { stopTicking(); say("It switched itself off."); changed(); }
        else drawSide();
      }, 1000);
    }
    function stopTicking() { if (ticker) clearInterval(ticker); ticker = null; }

    // The beeps, as the speaker on the board makes them: "1 long, 3 short".
    var audio = null;
    function beep(code) {
      if (!code || !window.AudioContext) return;
      try {
        audio = audio || new AudioContext();
        var t = audio.currentTime + 0.05;
        code.split(",").forEach(function (part) {
          var m = /(\d+)\s+(long|short)/.exec(part.trim());
          if (!m) return;
          for (var i = 0; i < Number(m[1]); i++) {
            var len = m[2] === "long" ? 0.7 : 0.18, o = audio.createOscillator(), g = audio.createGain();
            o.frequency.value = 880; g.gain.value = 0.08;
            o.connect(g); g.connect(audio.destination);
            o.start(t); o.stop(t + len);
            t += len + 0.15;
          }
          t += 0.3;
        });
      } catch (e) { /* no sound: the words say it */ }
    }

    stage.addEventListener("click", function (e) {
      if (e.target === stage || e.target.tagName === "svg") { selected = null; say(""); draw(); }
    });
    draw();
    if (state.power.on) startTicking();
    return {
      redraw: draw,
      setState: function (s) { state = s; selected = null; say(""); stopTicking(); if (state.power.on) startTicking(); draw(); },
      state: function () { return state; }
    };
  }

  return { mount: mount, specs: specs };
})();
