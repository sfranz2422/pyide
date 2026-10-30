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
 * The parts are real photographs (static/lab/img/, free-licence pictures
 * from Wikimedia Commons, each credited on its spec card and at /lab/credits)
 * and the board is its own photo, every slot where it really is (LAYOUT),
 * because recognising where things go on a real board is what A+ asks. A
 * part's card says what its photo shows: its label can be read.
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
  /* Where things are in each photo, in its own pixels ([x, y, w, h]; the
     CMOS battery [cx, cy, r]). Read off the pictures with a grid over them:
     a photo replaced is a layout to measure again, or parts land beside
     their slots. Memory slots are listed A1, A2, B1, B2 (A1, B1 on a two-slot
     board), nearest the CPU first, as the boards print them. */
  var IMG_SIZE = { "board-atx": [972, 1200], "board-matx": [1081, 1200], "case-atx": [480, 407], "case-itx": [480, 381] };
  var LAYOUT = {
    "board-atx": {
      cpu: [455, 240, 185, 260], cpu8: [218, 62, 140, 42], atx24: [896, 256, 44, 200], gpu: [222, 694, 420, 32],
      ram: [[720, 100, 32, 535], [755, 100, 32, 535], [790, 100, 32, 535], [825, 100, 32, 535]],
      m2: [[80, 612, 620, 58], [320, 888, 480, 74], [170, 972, 380, 60], [560, 972, 380, 60]],
      sata: [[880, 712, 92, 30], [880, 744, 92, 30], [880, 776, 92, 30], [880, 808, 92, 30], [880, 840, 92, 30], [880, 872, 92, 30]],
      cmos: [235, 798, 34]
    },
    "board-matx": {
      cpu: [500, 335, 255, 240], cpu8: [208, 96, 66, 70], atx24: [990, 280, 56, 276], gpu: [275, 916, 450, 52],
      ram: [[856, 85, 44, 725], [906, 85, 44, 725]],
      m2: [[432, 800, 400, 92]],
      sata: [[966, 910, 100, 42], [966, 954, 100, 42], [966, 998, 100, 42], [966, 1042, 100, 42]],
      cmos: [297, 665, 52]
    },
    "case-atx": { board: [42, 42, 222, 255] },
    "case-itx": { board: [70, 270, 270, 100] }
  };
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
    if (p.type === "board") rows.push(["CPU power", p.cpu_power || "8-pin"]);
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
    var imgBase = opts.imgBase || "/static/lab/img/", credits = opts.credits || {};
    function imgUrl(name) { return imgBase + name + ".jpg"; }
    /* A part in the computer is shown cut out of its photo (img/<name>-cut.webp,
       transparent around it), or each would sit on the board in a white box of
       its own background. The cases, boards and power supply are only ever
       shown whole, so they have none; test_lab_machine.py holds the rest to it. */
    var CUT = { cpu: 1, cooler: 1, ram: 1, gpu: 1, drive: 1 };
    function placedUrl(p) { return CUT[p.type] ? imgBase + p.photo + "-cut.webp" : imgUrl(p.photo); }
    // Every redraw makes the pictures anew, so fetch them all now: otherwise
    // the first time a part goes in, its place is empty until it loads.
    (cat.parts || cat).forEach(function (p) {
      if (!p.photo) return;
      new Image().src = imgUrl(p.photo);
      if (CUT[p.type]) new Image().src = placedUrl(p);
    });
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
          p.photo ? el("img", { class: "lab-part-img", src: imgUrl(p.photo), alt: "", draggable: "false" })
                  : el("span", { class: "lab-part-icon", text: ICON[p.type] || "▫" }),
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
            ghost = el("div", { class: "lab-ghost" }, [
              part(uid).photo ? el("img", { src: imgUrl(part(uid).photo), alt: "" }) : null, part(uid).name]);
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
    /* The computer is the board's own photo, and each place a part goes is
       where that thing really is in the picture (LAYOUT, in the photo's
       pixels). The right-hand column holds what isn't on the board: the case,
       the power supply's bay and the drives in their bays. */
    var VIEW_W = 1500, VIEW_H = 1240, LEFT = { x: 20, y: 20, w: 1080, h: 1200 }, COL = { x: 1130, w: 350 };
    function drawBoard() {
      stage.textContent = "";
      var svg = sv("svg", { viewBox: "0 0 " + VIEW_W + " " + VIEW_H, class: "lab-svg", role: "img", "aria-label": "The computer" });
      stage.appendChild(svg);
      var holding = selected && selected.from === "shelf" ? part(selected.uid) : null;
      var layer = svg;
      // A place a part can go: glows when the part in hand could go there; a
      // filled one shows the part's photo and is tapped to pick it.
      function spot(placeName, x, y, w, h, label, accepts, filledBy, how) {
        how = how || {};
        var g = sv("g", { "data-place": placeName, class: "lab-spot" + (filledBy ? " filled" : "") +
                          (holding && !filledBy && accepts(holding) ? " can" : "") + (how.cls ? " " + how.cls : "") });
        if (filledBy) {
          var p = part(filledBy), fx = how.fill || [x, y, w, h];
          if (p.photo && !how.noPhoto) g.appendChild(photo(p, fx[0], fx[1], fx[2], fx[3], how.turn));
          else g.appendChild(sv("rect", { x: x + 2, y: y + 2, width: w - 4, height: h - 4, rx: 2, class: "lab-fill lab-fill-" + p.type }));
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
          g.addEventListener("click", function (e) { e.stopPropagation(); if (holding) place(placeName); });
        }
        g.appendChild(sv("rect", { x: x, y: y, width: w, height: h, rx: 4, class: "lab-spot-box" }));
        if (label) g.appendChild(sv("text", { x: x + w / 2, y: y + h / 2 + 8, class: "lab-label" + (how.small ? " small" : "") }, label));
        layer.appendChild(g);
        return g;
      }
      // A part's photo, fitted into a box; `turn` stands it on end (memory in a slot).
      function photo(p, x, y, w, h, turn) {
        var img = sv("image", { href: placedUrl(p), preserveAspectRatio: "xMidYMid meet" });
        if (turn) {
          img.setAttribute("x", x + w / 2 - h / 2); img.setAttribute("y", y + h / 2 - w / 2);
          img.setAttribute("width", h); img.setAttribute("height", w);
          img.setAttribute("transform", "rotate(90 " + (x + w / 2) + " " + (y + h / 2) + ")");
        } else {
          img.setAttribute("x", x); img.setAttribute("y", y); img.setAttribute("width", w); img.setAttribute("height", h);
        }
        return img;
      }
      var is = function (t) { return function (p) { return p.type === t; }; };
      var drive = function (iface) { return function (p) { return p.type === "drive" && p.iface === iface; }; };

      if (!state.case) {
        spot("case", LEFT.x + 140, LEFT.y + 200, LEFT.w - 280, LEFT.h - 400, "Put a case here", is("case"), null, { cls: "lab-onpage" });
        return;
      }
      var box = part(state.case), b = part(state.board);

      // The right-hand column: the case, the PSU bay, the drive bays.
      spot("case", COL.x, 20, COL.w, 290, "", is("case"), state.case, { cls: "lab-case-hit lab-onpage" });
      svg.appendChild(sv("text", { x: COL.x + COL.w / 2, y: 336, class: "lab-label dark small" }, box.name));
      spot("psu", COL.x, 360, COL.w, 230, state.psu ? "" : "Power supply bay", is("psu"), state.psu, { cls: "lab-onpage" });
      if (state.psu) svg.appendChild(sv("text", { x: COL.x + COL.w / 2, y: 618, class: "lab-label dark" }, part(state.psu).watts + " W power supply"));
      var row = 0;
      state.sata.forEach(function (uid, i) {
        if (!uid) return;
        var d = part(uid), y = 650 + row++ * 120;
        svg.appendChild(photo(d, COL.x, y, 130, 100));
        svg.appendChild(sv("text", { x: COL.x + 145, y: y + 40, class: "lab-label dark small start" },
                           "SATA" + i + " · " + (d.gb >= 1000 ? d.gb / 1000 + " TB " : d.gb + " GB ") + d.media));
        svg.appendChild(sv("text", { x: COL.x + 145, y: y + 72, class: "lab-label small start " + (state.cables.sata[i] ? "ok" : "bad") },
                           state.cables.sata[i] ? "data + power" : "data only: no power"));
      });

      if (!state.board) {
        // The case open on its side, the board's place glowing in it.
        var cl = LAYOUT[box.photo] || {}, im = IMG_SIZE[box.photo] || [480, 400];
        var k = Math.min(LEFT.w / im[0], LEFT.h / im[1]);
        layer = sv("g", { transform: "translate(" + LEFT.x + " " + LEFT.y + ") scale(" + k + ")" });
        svg.appendChild(layer);
        if (box.photo) layer.appendChild(photo(box, 0, 0, im[0], im[1]));
        var t = cl.board || [im[0] * 0.15, im[1] * 0.15, im[0] * 0.5, im[1] * 0.6];
        spot("board", t[0], t[1], t[2], t[3], "Motherboard", is("board"), null, { small: true, cls: "lab-thin" });
        return;
      }

      // The board, its photo filling the left; everything on it in its pixels.
      var L2 = LAYOUT[b.photo], sz = IMG_SIZE[b.photo];
      var s2 = Math.min(LEFT.w / sz[0], LEFT.h / sz[1]);
      layer = sv("g", { transform: "translate(" + LEFT.x + " " + LEFT.y + ") scale(" + s2 + ")" });
      svg.appendChild(layer);
      spot("board", 0, 0, sz[0], sz[1], "", is("board"), state.board, { cls: "lab-board" });

      // CPU in its socket; the cooler over it (only offered when one's in hand,
      // so the CPU under an empty cooler place can still be tapped).
      var c = L2.cpu;
      spot("cpu", c[0], c[1], c[2], c[3], state.cpu ? "" : "CPU socket " + b.socket, is("cpu"), state.cpu);
      var grow = c[2] * 0.22, cf = [c[0] - grow, c[1] - grow, c[2] + 2 * grow, c[3] + 2 * grow];
      if (state.cooler) spot("cooler", cf[0], cf[1], cf[2], cf[3], "", is("cooler"), state.cooler,
                             { cls: state.coolerSeated ? "" : "lab-loose" });
      else if (state.cpu && holding && holding.type === "cooler") spot("cooler", cf[0], cf[1], cf[2], cf[3], "Cooler", is("cooler"), null);
      if (state.cooler && !state.coolerSeated) layer.appendChild(sv("text", { x: c[0] + c[2] / 2, y: cf[1] - 12, class: "lab-label bad" }, "loose"));

      // Memory slots, labelled as the board prints them.
      L.ramSlots(cat, state).forEach(function (name, i) {
        var r = L2.ram[i];
        spot("ram:" + i, r[0], r[1], r[2], r[3], "", is("ram"), state.ram[i], { turn: true });
        layer.appendChild(sv("text", { x: r[0] + r[2] / 2, y: r[1] - 10, class: "lab-label small" }, name));
      });
      // The x16 slot; a card in it shows over the board below the slot.
      var g = L2.gpu;
      spot("gpu", g[0], g[1], g[2], g[3], state.gpu ? "" : "PCIe x16 slot", is("gpu"), state.gpu,
           { small: true, fill: [g[0], g[1] - 10, g[2], g[2] * 0.62] });
      if (state.gpu && part(state.gpu).power) {
        layer.appendChild(sv("text", { x: g[0] + g[2] / 2, y: g[1] + g[2] * 0.31, class: "lab-label " + (state.cables.gpu8 ? "ok" : "bad") },
                             state.cables.gpu8 ? "8-pin power in" : "8-pin power NOT plugged in"));
      }
      // After the card, as a real one hides the M.2 slot under it: drawn
      // first, a drive there could be neither seen nor tapped.
      L2.m2.forEach(function (r, i) {
        if (i >= b.m2) return;
        spot("m2:" + i, r[0], r[1], r[2], r[3], state.m2[i] ? "" : "M.2 slot " + (i + 1), drive("M.2"), state.m2[i], { small: true });
      });
      L2.sata.forEach(function (r, i) {
        if (i >= b.sata) return;
        spot("sata:" + i, r[0], r[1], r[2], r[3], "SATA" + i, drive("SATA"), state.sata[i], { small: true, noPhoto: true, cls: "lab-port" });
      });
      // The power connectors: tap one to plug its cable in or pull it out.
      [["cpu8", L2.cpu8, (b.cpu_power || "8-pin") + " CPU power"], ["atx24", L2.atx24, "24-pin"]].forEach(function (cn) {
        var r = cn[1], on = state.cables[cn[0]];
        var hit = sv("g", { class: "lab-conn" + (on ? " on" : ""), role: "button", "aria-label": cn[2] + (on ? " plugged in" : " not plugged in") }, null);
        hit.appendChild(sv("rect", { x: r[0], y: r[1], width: r[2], height: r[3], rx: 4 }));
        hit.appendChild(sv("text", { x: r[0] + r[2] / 2, y: r[1] + r[3] + 26, class: "lab-label small " + (on ? "ok" : "bad") }, cn[2]));
        if (!readOnly) hit.addEventListener("click", function (e) {
          e.stopPropagation();
          var res = L.connect(cat, state, cn[0], !state.cables[cn[0]]);
          say(res.ok ? "" : res.why);
          changed();
        });
        layer.appendChild(hit);
      });
      layer.appendChild(sv("circle", { cx: L2.cmos[0], cy: L2.cmos[1], r: L2.cmos[2], class: "lab-cmos" + (state.cmos ? "" : " flat") }));
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
        if (p.photo) {
          card.appendChild(el("img", { class: "lab-card-img", src: imgUrl(p.photo), alt: p.name }));
          var cr = credits[p.photo];
          // CC BY and BY-SA ask for the author and licence beside the picture.
          if (cr) card.appendChild(el("p", { class: "lab-credit" }, [
            "Photo: ", el("a", { href: cr.page, target: "_blank", rel: "noopener", text: cr.author || "Wikimedia Commons" }),
            ", ", cr.license_url ? el("a", { href: cr.license_url, target: "_blank", rel: "noopener", text: cr.license }) : cr.license]));
        }
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
      cable((state.board && part(state.board).cpu_power || "8-pin") + " CPU power", "cpu8", null, !!state.board);
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
