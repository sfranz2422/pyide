/* PyIDE — the A+ lab's computer screen: a Windows-style desktop on the
 * simulated PC (machine.js), with the tools the A+ exam asks about as apps
 * (apps.js registers them here).
 *
 * FAKED, NOT EMULATED, and OUR OWN LOOK: no Microsoft logos, sounds,
 * wallpapers or fonts. It's laid out like Windows (Start at the bottom left,
 * a taskbar, windows with a title bar, the clock and the network icon at
 * the bottom right) because finding your way around Windows is the skill.
 *
 * Every app reads the machine's state and changes it only through
 * machine.js, so what a student does here is what the server grades. After
 * every change the whole screen redraws from the state — no app keeps its
 * own copy of anything the machine knows — and opts.onChange saves it.
 *
 *   PyIDELabDesktop.mount(element, {catalog, state, onChange, onOff})
 *
 * onOff() when Windows stops running (Shut down, a restart that doesn't come
 * back, or the bench's overheating turning it off): the page goes back to
 * the bench. Apps: PyIDELabDesktop.register(id, {title, icon, w, h, render}).
 */
window.PyIDELabDesktop = (function () {
  "use strict";

  var L = window.PyIDELab;
  var APPS = {}, ORDER = [];

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;      // null/false: leave it off (disabled, checked…)
      if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c != null && c !== false) e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return e;
  }

  function register(id, app) {
    APPS[id] = app;
    if (ORDER.indexOf(id) < 0) ORDER.push(id);
  }

  function mount(root, opts) {
    var cat = opts.catalog, state = opts.state;
    var wins = [], top = 10, menuOpen = false, gone = false;

    root.textContent = "";
    root.classList.add("ld");
    var screen = el("div", { class: "ld-screen" });
    var icons = el("div", { class: "ld-icons" });
    var bar = el("div", { class: "ld-taskbar" });
    var menu = el("div", { class: "ld-start", hidden: true });
    screen.appendChild(icons);
    root.appendChild(screen);
    root.appendChild(menu);
    root.appendChild(bar);

    /* What every app is handed: the machine, and the ways to change things
       and talk to the student. */
    var ctx = {
      cat: cat, L: L, el: el,
      state: function () { return state; },
      changed: changed,
      open: open,
      dialog: dialog,
      // A device's or a volume's name the way the apps print sizes.
      size: function (gb) { return gb >= 1000 ? (gb / 1000).toFixed(gb % 1000 ? 2 : 0) + " TB" : gb + " GB"; }
    };

    function changed() {
      if (gone) return;
      if (opts.onChange) opts.onChange(state);
      if (!L.running(state)) { off(); return; }
      draw();
    }
    function off() {
      if (gone) return;
      gone = true;
      if (opts.onOff) opts.onOff();
    }

    /* ---------------------------------------------------------- windows */
    function open(id, data) {
      var app = APPS[id];
      if (!app) return null;
      var w = wins.find(function (x) { return x.id === id; });
      if (w) {
        if (data) w.data = Object.assign(w.data, data);
        focus(w);
        render(w);
        closeMenu();
        return w;
      }
      var n = wins.length, area = screen.getBoundingClientRect();
      var ww = Math.min(app.w || 640, Math.max(320, area.width - 20)), hh = Math.min(app.h || 420, Math.max(240, area.height - 20));
      w = { id: id, app: app, data: data || {}, max: false,
            x: Math.max(0, Math.min(40 + n * 28, area.width - ww)), y: Math.max(0, Math.min(24 + n * 24, area.height - hh)), w: ww, h: hh };
      w.node = el("section", { class: "ld-win", role: "dialog", "aria-label": app.title });
      w.head = el("header", { class: "ld-win-head" }, [
        el("span", { class: "ld-win-icon", text: app.icon || "" }),
        el("span", { class: "ld-win-title", text: app.title }),
        el("button", { type: "button", class: "ld-win-btn", title: "Maximize", "aria-label": "Maximize", text: "□", onclick: function () {
          w.max = !w.max; place(w);
        } }),
        el("button", { type: "button", class: "ld-win-btn ld-close", title: "Close", "aria-label": "Close", text: "✕", onclick: function () { close(w); } })
      ]);
      w.body = el("div", { class: "ld-win-body" });
      w.node.appendChild(w.head);
      w.node.appendChild(w.body);
      w.node.addEventListener("pointerdown", function () { focus(w); }, true);
      drag(w);
      wins.push(w);
      screen.appendChild(w.node);
      place(w);
      focus(w);
      render(w);
      closeMenu();
      drawBar();
      return w;
    }
    function close(w) {
      wins.splice(wins.indexOf(w), 1);
      w.node.remove();
      drawBar();
    }
    function focus(w) {
      w.node.style.zIndex = ++top;
      wins.forEach(function (x) { x.node.classList.toggle("ld-front", x === w); });
      drawBar();
    }
    function place(w) {
      var s = w.node.style;
      if (w.max) { s.left = "0px"; s.top = "0px"; s.width = "100%"; s.height = "100%"; }
      else { s.left = w.x + "px"; s.top = w.y + "px"; s.width = w.w + "px"; s.height = w.h + "px"; }
    }
    // By the title bar, mouse or finger; kept inside the screen.
    function drag(w) {
      w.head.addEventListener("pointerdown", function (e) {
        if (e.target.closest("button") || w.max) return;
        var sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y, area = screen.getBoundingClientRect();
        w.head.setPointerCapture(e.pointerId);
        function move(ev) {
          w.x = Math.max(-w.w + 80, Math.min(area.width - 80, ox + ev.clientX - sx));
          w.y = Math.max(0, Math.min(area.height - 30, oy + ev.clientY - sy));
          place(w);
        }
        function up() { w.head.removeEventListener("pointermove", move); w.head.removeEventListener("pointerup", up); }
        w.head.addEventListener("pointermove", move);
        w.head.addEventListener("pointerup", up);
      });
    }
    function render(w) {
      var scroll = w.body.scrollTop;
      w.body.textContent = "";
      w.app.render(w.body, ctx, w);
      w.body.scrollTop = scroll;
    }

    /* A dialog over one window (or over the desktop): a title, what to say
       or ask, and its buttons. A button's onclick returning false keeps it
       open — for an answer that was refused, shown in the dialog itself. */
    function dialog(w, title, content, buttons) {
      var host = w ? w.node : screen;
      var shade = el("div", { class: "ld-shade" });
      var msg = el("p", { class: "ld-dialog-msg", role: "alert", hidden: true });
      var box = el("div", { class: "ld-dialog", role: "dialog", "aria-label": title }, [
        el("div", { class: "ld-dialog-title", text: title }), content, msg
      ]);
      var row = el("div", { class: "ld-dialog-btns" });
      function shut() { shade.remove(); }
      (buttons || [{ text: "OK" }]).forEach(function (b) {
        row.appendChild(el("button", { type: "button", class: "ld-btn" + (b.primary ? " ld-primary" : ""), text: b.text, onclick: function () {
          var r = b.onclick ? b.onclick() : true;
          if (r && r.ok === false) { msg.textContent = r.why; msg.hidden = false; return; }
          if (r === false) return;
          shut();
          changed();
          if (r && r.then) r.then(changed);
        } }));
      });
      box.appendChild(row);
      shade.appendChild(box);
      host.appendChild(shade);
      var first = box.querySelector("input, select");
      if (first) first.focus();
      return { close: shut, say: function (t) { msg.textContent = t; msg.hidden = !t; } };
    }

    /* ---------------------------------------------------------- the desktop */
    function drawIcons() {
      icons.textContent = "";
      var os = state.os;
      var list = [["explorer", "🖥", "This PC", { path: "pc" }]];
      if (os.driverFolder) list.push(["explorer", "📁", "Drivers", { path: "drivers" }]);
      list.push(["explorer", "🗑", "Recycle Bin", { path: "bin" }]);
      list.forEach(function (it) {
        icons.appendChild(el("button", { type: "button", class: "ld-icon", onclick: function () { open(it[0], Object.assign({}, it[3])); } }, [
          el("span", { class: "ld-icon-pic", text: it[1] }), el("span", { class: "ld-icon-name", text: it[2] })
        ]));
      });
    }

    // The network icon: what Windows says about the connection at a glance.
    function netState() {
      var os = state.os, n = os.net;
      if (!n.ip || os.disabled.net || os.drivers.net !== "ok") return { icon: "⛔", text: "Not connected" };
      if (!L.online(state) || !L.dnsWorks(state)) return { icon: "⚠", text: "No internet" };
      return { icon: "🌐", text: "Connected, internet access" };
    }

    function clock() {
      // A flat CMOS battery resets the clock: the date is wrong until it's set.
      // That's how a student notices one from inside Windows.
      if (!state.cmos) return { time: "12:00 AM", date: "1/1/2000" };
      var d = new Date();
      return { time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), date: d.toLocaleDateString() };
    }

    function drawBar() {
      bar.textContent = "";
      bar.appendChild(el("button", { type: "button", class: "ld-startbtn" + (menuOpen ? " on" : ""), "aria-label": "Start", "aria-expanded": String(menuOpen),
                                     onclick: function () { menuOpen ? closeMenu() : openMenu(); } }, [el("span", { class: "ld-logo" }), "Start"]));
      var tasks = el("div", { class: "ld-tasks" });
      wins.forEach(function (w) {
        tasks.appendChild(el("button", { type: "button", class: "ld-task" + (w.node.classList.contains("ld-front") ? " on" : ""),
                                         title: w.app.title, onclick: function () { focus(w); } }, [w.app.icon + " " + w.app.title]));
      });
      bar.appendChild(tasks);
      var ns = netState(), c = clock();
      bar.appendChild(el("button", { type: "button", class: "ld-tray", title: ns.text, "aria-label": "Network: " + ns.text,
                                     onclick: function () { open("settings", { page: "network" }); } }, [ns.icon]));
      bar.appendChild(el("div", { class: "ld-clock" + (state.cmos ? "" : " wrong") }, [el("div", { text: c.time }), el("div", { text: c.date })]));
    }

    function openMenu() {
      menuOpen = true;
      menu.textContent = "";
      menu.appendChild(el("div", { class: "ld-start-head", text: "Apps" }));
      ORDER.forEach(function (id) {
        if (APPS[id].hidden) return;
        menu.appendChild(el("button", { type: "button", class: "ld-start-app", onclick: function () { open(id); } },
                            [el("span", { class: "ld-start-icon", text: APPS[id].icon }), APPS[id].title]));
      });
      menu.appendChild(el("div", { class: "ld-start-power" }, [
        el("button", { type: "button", class: "ld-btn", text: "⟳ Restart", onclick: function () {
          closeMenu();
          wins.slice().forEach(close);
          L.restart(cat, state);
          changed();
        } }),
        el("button", { type: "button", class: "ld-btn", text: "⏻ Shut down", onclick: function () {
          closeMenu();
          L.powerOff(state);
          changed();
        } })
      ]));
      menu.hidden = false;
      drawBar();
    }
    function closeMenu() {
      if (!menuOpen) return;
      menuOpen = false;
      menu.hidden = true;
      drawBar();
    }
    screen.addEventListener("pointerdown", function (e) { if (e.target === screen || e.target === icons) closeMenu(); });

    function draw() {
      drawIcons();
      wins.forEach(render);
      drawBar();
    }

    // The clock moves; nothing else does on its own (the bench keeps the
    // machine's time, and tells the page when it turns itself off).
    var clockTimer = setInterval(function () { if (!gone && root.isConnected) drawBar(); else clearInterval(clockTimer); }, 30000);

    draw();
    return {
      redraw: function () { if (!L.running(state)) off(); else draw(); },
      open: open,
      destroy: function () { gone = true; clearInterval(clockTimer); root.textContent = ""; root.classList.remove("ld"); }
    };
  }

  return { mount: mount, register: register, el: el, apps: APPS };
})();
