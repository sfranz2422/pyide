/* What a Try It box's code makes, under the box (checks_in_notes.js tryStep),
 * for an IDE whose box isn't a Python program — the teacher, Nov 2026:
 * "I'd rather have everything in the slides" for the HTML, Flask and PHP
 * tutorials too. Each runner (runners/web.js, runners/flask.js) and live page
 * (web/live.js, flask/live.js) works out the page or the rows; this draws
 * them, the same way everywhere.
 *
 * A page goes in a frame sandboxed allow-scripts without allow-same-origin,
 * as WebIDE's own preview and snippets.js's html run do: the student's
 * script runs, with a null origin, and can't touch this page.
 */
window.IDETryShow = (function () {
  "use strict";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function head(out, words) {
    out.appendChild(el("div", "try-out-head", words));
  }

  function page(out, html, words) {
    head(out, words || "Your page:");
    var f = el("iframe", "try-frame");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("title", "What this step's code makes");
    f.srcdoc = String(html || "");
    out.appendChild(f);
  }

  function error(out, message) {
    out.appendChild(el("pre", "try-out-err", String(message || "It didn't run.")));
  }

  /* SQL: each statement's rows, as Run's results pane shows them (runSql). */
  function rows(out, results) {
    head(out, "What it gives back:");
    if (!results || !results.length) { out.appendChild(el("div", "dim", "(No statements yet.)")); return; }
    results.forEach(function (r) {
      if (!r.columns) {
        out.appendChild(el("div", "dim", r.changed >= 0 ? r.changed + " changed" : "done"));
        return;
      }
      var t = el("table"), tr = el("tr");
      r.columns.forEach(function (c) { tr.appendChild(el("th", "", c)); });
      t.appendChild(tr);
      r.rows.slice(0, 50).forEach(function (row) {
        var x = el("tr");
        row.forEach(function (v) { x.appendChild(el("td", "", v === null ? "NULL" : String(v))); });
        t.appendChild(x);
      });
      out.appendChild(t);
      out.appendChild(el("div", "dim", r.rows.length === 1 ? "1 row" : r.rows.length + " rows"));
    });
  }

  /* A Flask app's or a PHP site's: its files run, then its / page shown.
     `runtime` is FlaskIDERuntime or PhpRuntime (the same calls). This runs
     the step's code in the page's runtime, in place of whatever the student
     last ran there: their own Run puts their project back. */
  function served(out, runtime, files, kind) {
    out.textContent = "Running…";
    return Promise.resolve()
      .then(function () { return runtime.boot(function () {}); })
      .then(function () {
        if (kind === "sql") return runtime.runSql(files, function () {});
        return runtime.run(files, function () {});
      })
      .then(function (res) {
        out.textContent = "";
        if (!res || res.ok === false) { error(out, res && res.error); if (kind === "sql" && res && res.results) rows(out, res.results); return; }
        if (kind === "sql") { rows(out, res.results); return; }
        return runtime.request("GET", "/").then(function (r) {
          page(out, r && r.isText !== false ? r.body : "", "Your page at /:");
        });
      }, function (e) { out.textContent = ""; error(out, e && e.message || e); });
  }

  return { page: page, rows: rows, served: served, error: error };
})();
