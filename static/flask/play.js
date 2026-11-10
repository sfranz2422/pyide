/* FlaskIDE — the student's app in a tab of its own (/play).
 *
 * The editor's New tab button puts the project in this browser's storage
 * and opens this page (runInNewTab in app.js). This reads it back, boots
 * Python and Flask, runs the app, and shows "/" in the same preview the
 * editor uses. See play.html for why the app runs here and not in the
 * editor's tab.
 *
 * One named tab: pressing New tab again after an edit reloads this page,
 * which reads the latest files. Reload here starts the app over from the
 * files last sent, without going back to the editor.
 *
 * Copied from FlaskIDE when it moved into PyIDE (Nov 2026), unchanged but
 * for this note and the two changes it names. Its global keeps FlaskIDE's name; a Flask,
 * SQL or PHP project's editor page loads it (runners/flask.js).
 * Changed: the theme is PyIDE's (pyide-theme), and a hide-code link
 * (/d/<slug>) is played too, from its source — FlaskIDE sent that
 * link to a page it didn't have.
 */
(function () {
  "use strict";

  var PLAY_KEY = "flaskide-play";
  var runtime = window.FlaskIDERuntime;

  /* A PHP site runs on PHP instead: index.php and no app.py, the rule
     app.js and app.py's kind_of use. */
  function isPhp(files) { return "index.php" in files && !("app.py" in files) && !("query.sql" in files); }
  var $ = function (id) { return document.getElementById(id); };
  var outputEl = $("output");
  var reloadBtn = $("reload");
  var reloadLabel = $("reload-label");

  function say(text, cls) {
    var span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function clearOutput() { outputEl.textContent = ""; }
  $("clear").addEventListener("click", clearOutput);

  /* A hide-code link (/d/<slug>) sends its files from the server, as the
     Python and web demo pages do; the editor's New tab hands them over in
     this browser's storage. */
  var SOURCE = window.FLASK_PLAY && window.FLASK_PLAY.sourceUrl;

  async function fromSource() {
    var res = await fetch(SOURCE, { cache: "no-store" });
    var data = res.ok ? await res.json() : null;
    return data && data.files ? { files: data.files, title: window.FLASK_PLAY.title || "" } : null;
  }

  function handedOver() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(PLAY_KEY) || "null"); }
    catch (e) { /* blocked, or not ours */ }
    if (!data || !data.files || typeof data.files !== "object") return null;
    return data;
  }

  var preview = new window.FlaskIDEPreview({
    frame: $("preview"),
    bar: $("preview-path"),
    onStatus: function (code, path) {
      var el = $("preview-status");
      el.textContent = code ? String(code) : "";
      el.className = "status-code" +
        (code >= 500 ? " bad" : code >= 400 ? " warn" : code ? " ok" : "");
      el.title = path;
    },
    onNote: function (text) { say("\n" + text + "\n", "dim"); },
  });
  $("preview-back").addEventListener("click", function () { preview.back(); });
  runtime.setOutput(function (text) { say(text); });
  if (window.PhpRuntime) window.PhpRuntime.setOutput(function (text) { if (text) say(text); });

  var running = false;

  async function start() {
    if (running) return;
    var project = SOURCE ? await fromSource().catch(function () { return null; }) : handedOver();
    if (!project) {
      clearOutput();
      say("Nothing to show here. Press ↗ New tab in the editor.\n", "dim");
      return;
    }
    if (project.title) {
      document.title = project.title + " — Online IDE";
      $("play-title").textContent = project.title;
    }
    running = true;
    reloadBtn.disabled = true;
    clearOutput();
    if (isPhp(project.files)) {
      runtime = window.PhpRuntime;
      window.FlaskIDEPreview.useRuntime(runtime);
    }
    try {
      var res = await runtime.run(project.files, function (note) {
        if (note) say(note + "\n", "dim");
      });
      if (!res.ok) { say("\n" + res.error + "\n", "err"); return; }
      if (res.routes && !res.routes.length) {
        say("Your app has no routes yet, so there is no page to show.\n", "dim");
        return;
      }
      await preview.go("/");
    } catch (err) {
      say("\n" + (err && err.message ? err.message : String(err)) + "\n", "err");
    } finally {
      running = false;
      reloadBtn.disabled = false;
      reloadLabel.textContent = "Reload";
    }
  }

  reloadBtn.addEventListener("click", start);
  start();
})();
