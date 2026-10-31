/* PyIDE — the simulated Raspberry Pi's Camera Module (chapter 8 of the
 * Beginner's Guide): what picamera (static/py/pi/picamera) sees, takes and
 * records, and the panel that shows it.
 *
 * The camera is the computer's own webcam, asked for only when a program
 * starts the preview or takes a picture — never on opening the page. With
 * no webcam, or "Block", it is a drawn test scene that moves with the clock,
 * so a stop-motion program still gets frames that differ.
 *
 *   PyIDEPiCamera.preview(on, settingsJSON)   start_preview / stop_preview
 *   PyIDEPiCamera.ready()                     → 1 when the webcam has answered (yes or no)
 *   PyIDEPiCamera.capture(settingsJSON, w, h, format) → base64 of the JPEG/PNG
 *   PyIDEPiCamera.record(on, name, settingsJSON) / recorded() → base64 or "" (not done yet)
 *   PyIDEPiCamera.reset()                      after a run: preview off, webcam let go
 *   PyIDEPiCamera.mount(el)                    the panel: preview, photos, flipbook
 *
 * Settings are picamera's: rotation, hflip, vflip, brightness, contrast,
 * saturation, image_effect, annotate_text, annotate_text_size,
 * annotate_foreground, annotate_background.
 *
 * Photos are not project files — a project holds text — so the panel keeps
 * them for the session, each with a Download, and the program's own copy is
 * in Python's files for the run (it can open what it took).
 */
window.PyIDEPiCamera = (function () {
  "use strict";

  // A 32×24 grey JPEG: what a capture gives where there is no canvas (the
  // tests, and Check my work), so a program that writes a picture still
  // writes a real one.
  var GREY_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooooAKKKKACiiigAooooA//Z";

  var hasDom = typeof document !== "undefined" && typeof document.createElement === "function";
  var video = null, stream = null, asked = false, answered = false;
  var previewOn = false, settings = {};
  var photos = [];                 // {name, url, at}
  var panel = null;
  var recorder = null, chunks = [], recordedB64 = null, recordName = "";

  function parse(json) {
    try { return JSON.parse(String(json || "{}")) || {}; } catch (e) { return {}; }
  }

  /* -------------------------------------------------------- the webcam */
  function askWebcam() {
    if (asked) return;
    asked = true;
    var md = hasDom && typeof navigator !== "undefined" && navigator.mediaDevices;
    if (!md || !md.getUserMedia) { answered = true; return; }
    md.getUserMedia({ video: true, audio: false }).then(function (s) {
      stream = s;
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      var p = video.play();
      if (p && p.then) p.then(function () { answered = true; paint(); }, function () { answered = true; });
      else answered = true;
      paint();
    }, function () {
      answered = true;            // no webcam, or "Block": the test scene
      paint();
    });
  }
  function letGo() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    video = null;
    asked = false;
    answered = false;
  }
  function live() { return !!(video && video.videoWidth); }

  /* ---------------------------------------------------- the test scene */
  function drawScene(ctx, w, h, t) {
    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#7cc4ff");
    sky.addColorStop(1, "#d8efff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.2, h * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    // A Raspberry Pi coloured ball rolling across, so frames taken a second
    // apart differ, as the real camera's would.
    var x = ((t / 2000) % 1) * (w + h * 0.2) - h * 0.1;
    var y = h * 0.72 - h * 0.1 - Math.abs(Math.sin(t / 300)) * h * 0.25;
    ctx.fillStyle = "#c51a4a";
    ctx.beginPath();
    ctx.arc(x, y, h * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = Math.round(h * 0.05) + "px system-ui, sans-serif";
    ctx.fillText("Test scene (no webcam)", w * 0.03, h * 0.95);
  }

  /* ---------------------------------------------------- one frame, drawn */
  var EFFECT_FILTERS = {
    negative: "invert(1)", sketch: "grayscale(1) contrast(1.8) brightness(1.15)",
    blur: "blur(3px)", saturation: "saturate(2)", washedout: "saturate(0.35) brightness(1.2) contrast(0.8)",
    pastel: "saturate(0.6) brightness(1.15)", watercolor: "blur(1.5px) saturate(1.4)",
    oilpaint: "blur(1px) saturate(1.6) contrast(1.2)", film: "sepia(0.35) contrast(1.1)",
    gpen: "grayscale(1) contrast(2.5)", hatch: "grayscale(1) contrast(2)", denoise: "blur(0.6px)",
    cartoon: "saturate(1.8) contrast(1.4)", colorpoint: "saturate(0.3)", colorbalance: "sepia(0.2) saturate(1.3)"
  };
  function filterFor(s) {
    var f = [];
    var b = s.brightness === undefined ? 50 : Number(s.brightness);
    var c = s.contrast === undefined ? 0 : Number(s.contrast);
    var sat = s.saturation === undefined ? 0 : Number(s.saturation);
    if (b !== 50) f.push("brightness(" + Math.max(0, b / 50) + ")");
    if (c) f.push("contrast(" + Math.max(0, 1 + c / 100) + ")");
    if (sat) f.push("saturate(" + Math.max(0, 1 + sat / 100) + ")");
    if (EFFECT_FILTERS[s.image_effect]) f.push(EFFECT_FILTERS[s.image_effect]);
    // (128, 128) is picamera's black and white; any other pair, a tint.
    if (s.color_effects) f.push(s.color_effects[0] === 128 && s.color_effects[1] === 128 ? "grayscale(1)" : "sepia(0.6)");
    return f.join(" ") || "none";
  }
  // The effects a CSS filter can't do, pixel by pixel.
  function pixelEffect(ctx, w, h, effect) {
    if (["solarize", "posterise", "colorswap", "emboss", "cartoon"].indexOf(effect) < 0) return;
    var img = ctx.getImageData(0, 0, w, h), d = img.data, i;
    if (effect === "emboss") {
      var src = new Uint8ClampedArray(d);
      for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
        i = (y * w + x) * 4;
        var j = ((y - 1) * w + (x - 1)) * 4;
        var v = 128 + (src[i] + src[i + 1] + src[i + 2] - src[j] - src[j + 1] - src[j + 2]) / 1.5;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    } else {
      for (i = 0; i < d.length; i += 4) {
        if (effect === "solarize") { for (var k = 0; k < 3; k++) if (d[i + k] > 128) d[i + k] = 255 - d[i + k]; }
        else if (effect === "posterise" || effect === "cartoon") { for (k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / 64) * 64; }
        else if (effect === "colorswap") { var r = d[i]; d[i] = d[i + 2]; d[i + 2] = r; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function colour(c, fallback) {
    return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
  }

  /* The current picture, at w×h, with the settings: what capture saves and
     what the preview shows. */
  function frame(canvas, s, w, h) {
    var rot = ((Number(s.rotation) || 0) % 360 + 360) % 360;
    var turned = rot === 90 || rot === 270;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(s.hflip ? -1 : 1, s.vflip ? -1 : 1);
    ctx.filter = filterFor(s);
    var dw = turned ? h : w, dh = turned ? w : h;
    if (live()) {
      // Cover the frame, as the camera's sensor crop does.
      var vw = video.videoWidth, vh = video.videoHeight, k = Math.max(dw / vw, dh / vh);
      ctx.drawImage(video, -vw * k / 2, -vh * k / 2, vw * k, vh * k);
    } else {
      ctx.translate(-dw / 2, -dh / 2);
      drawScene(ctx, dw, dh, Date.now());
    }
    ctx.restore();
    ctx.filter = "none";
    pixelEffect(ctx, w, h, s.image_effect);
    if (s.annotate_text) {
      var size = Math.max(6, Math.min(160, Number(s.annotate_text_size) || 32)) * h / 720;
      ctx.font = "bold " + Math.round(size) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      var text = String(s.annotate_text), tw = ctx.measureText(text).width;
      if (s.annotate_background) {
        ctx.fillStyle = colour(s.annotate_background, "#000000");
        ctx.fillRect(w / 2 - tw / 2 - size * 0.3, size * 0.2, tw + size * 0.6, size * 1.25);
      }
      ctx.fillStyle = colour(s.annotate_foreground, "#ffffff");
      ctx.fillText(text, w / 2, size * 0.3);
    }
  }

  /* ------------------------------------------------ what Python calls */
  function preview(on, json) {
    previewOn = !!Number(on);
    settings = parse(json);
    if (previewOn) askWebcam();
    paint();
  }
  function setSettings(json) { settings = parse(json); }
  function ready() { return answered || !hasDom ? 1 : 0; }

  function capture(json, w, h, format) {
    var s = parse(json);
    askWebcam();
    w = Math.max(16, Math.min(3280, Math.round(Number(w) || 1280)));
    h = Math.max(16, Math.min(2464, Math.round(Number(h) || 720)));
    var png = String(format) === "png";
    if (!hasDom) return GREY_JPEG;
    var canvas = document.createElement("canvas");
    var url;
    try {
      frame(canvas, s, w, h);
      url = canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.88);
    } catch (e) {
      return GREY_JPEG;
    }
    return url.slice(url.indexOf(",") + 1);
  }
  function addPhoto(name, b64, format) {
    var type = format === "png" ? "image/png" : "image/jpeg";
    photos.push({ name: String(name), url: "data:" + type + ";base64," + b64, at: Date.now() });
    if (photos.length > 120) photos.shift();
    paintPhotos();
  }

  function record(on, name, json) {
    settings = parse(json);
    if (Number(on)) {
      recordedB64 = null;
      recordName = String(name);
      askWebcam();
      if (!hasDom || typeof MediaRecorder === "undefined" || !panel) { recorder = null; return 0; }
      var stream2 = panel.canvas.captureStream ? panel.canvas.captureStream(25) : null;
      if (!stream2) return 0;
      chunks = [];
      try { recorder = new MediaRecorder(stream2, { mimeType: "video/webm" }); }
      catch (e) { try { recorder = new MediaRecorder(stream2); } catch (e2) { recorder = null; return 0; } }
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: "video/webm" });
        var url = URL.createObjectURL(blob);
        addClip(recordName, url);
        var reader = new FileReader();
        reader.onload = function () { var r = String(reader.result); recordedB64 = r.slice(r.indexOf(",") + 1); };
        reader.onerror = function () { recordedB64 = ""; };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      paint();
      return 1;
    }
    if (recorder && recorder.state !== "inactive") { recorder.stop(); recorder = null; return 1; }
    recordedB64 = "";
    return 0;
  }
  // null while the clip is still being put together, "" when there is none.
  function recorded() { return recordedB64 === null ? null : recordedB64; }

  function reset() {
    previewOn = false;
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (e) { /* gone */ } }
    recorder = null;
    letGo();
    paint();
  }

  /* --------------------------------------------------------- the panel */
  var clips = [];
  function addClip(name, url) {
    clips.push({ name: name, url: url });
    paintPhotos();
  }

  function mount(host) {
    host.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.className = "pi-camera-preview";
    canvas.width = 480;
    canvas.height = 270;
    var status = document.createElement("div");
    status.className = "pi-camera-status";
    var strip = document.createElement("div");
    strip.className = "pi-camera-strip";
    var big = document.createElement("img");
    big.className = "pi-camera-big";
    big.hidden = true;
    big.alt = "";
    var flip = document.createElement("button");
    flip.type = "button";
    flip.className = "pi-tool pi-camera-flip";
    flip.textContent = "▶ Play the photos as a flipbook";
    flip.hidden = true;
    var title = document.createElement("div");
    title.className = "pi-camera-title";
    title.textContent = "Camera Module";
    var root = document.createElement("div");
    root.className = "pi-camera";
    [title, canvas, status, big, flip, strip].forEach(function (e) { root.appendChild(e); });
    host.appendChild(root);
    panel = { canvas: canvas, status: status, strip: strip, big: big, flip: flip, timer: null, playing: null };
    big.addEventListener("click", function () { big.hidden = true; });
    flip.addEventListener("click", playFlipbook);
    paint();
    paintPhotos();
  }

  function paint() {
    if (!panel) return;
    var on = previewOn || !!recorder;
    if (on && !panel.timer) {
      panel.timer = setInterval(function () {
        frame(panel.canvas, settings, 480, 270);
      }, 1000 / 25);
    } else if (!on && panel.timer) {
      clearInterval(panel.timer);
      panel.timer = null;
    }
    if (!on) {
      var ctx = panel.canvas.getContext("2d");
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, 480, 270);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("The preview shows here after camera.start_preview()", 240, 140);
      ctx.textAlign = "start";
    }
    panel.status.textContent = recorder ? "● Recording" :
      !on ? "" : live() ? "Preview: your webcam" :
      asked && !answered ? "Asking to use the webcam…" : "Preview: the test scene (no webcam allowed or found)";
  }

  function paintPhotos() {
    if (!panel) return;
    panel.strip.innerHTML = "";
    photos.concat(clips).forEach(function (p) {
      var item = document.createElement("figure");
      item.className = "pi-camera-photo";
      var media;
      if (/^blob:/.test(p.url)) {
        media = document.createElement("video");
        media.src = p.url;
        media.controls = true;
      } else {
        media = document.createElement("img");
        media.src = p.url;
        media.alt = p.name;
        media.addEventListener("click", function () { panel.big.src = p.url; panel.big.hidden = false; });
      }
      var cap = document.createElement("figcaption");
      var a = document.createElement("a");
      a.href = p.url;
      a.download = p.name.split("/").pop().replace(/\.h264$/i, ".webm");
      a.textContent = "⬇ " + a.download;
      cap.appendChild(a);
      item.appendChild(media);
      item.appendChild(cap);
      panel.strip.appendChild(item);
    });
    panel.flip.hidden = photos.length < 2;
  }

  // The book makes its stop-motion film with avconv; here the photos play
  // in order, as a flipbook, in the preview.
  function playFlipbook() {
    if (!panel || photos.length < 2) return;
    var i = 0, ctx = panel.canvas.getContext("2d");
    var imgs = photos.map(function (p) { var im = new Image(); im.src = p.url; return im; });
    clearInterval(panel.playing);
    panel.playing = setInterval(function () {
      if (i >= imgs.length) { clearInterval(panel.playing); panel.playing = null; paint(); return; }
      var im = imgs[i++];
      ctx.drawImage(im, 0, 0, 480, 270);
    }, 1000 / 10);
  }

  return {
    preview: preview, settings: setSettings, ready: ready, capture: capture, addPhoto: addPhoto,
    record: record, recorded: recorded, reset: reset, mount: mount, GREY_JPEG: GREY_JPEG,
    photos: function () { return photos.map(function (p) { return p.name; }); }
  };
})();
