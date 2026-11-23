/* Try It steps checked in the library's editor (PresMaker's preview) — the
 * teacher, Nov 2026: "Is all this functionality baked into online
 * presmaker?" A ```tests try block is drawn there as the box students type
 * into (checks_in_notes.js tryStep), and this gives it a check, so the
 * teacher can try a step while writing it: its tests, on the box's code,
 * in a Python of this page's own.
 *
 * Python is loaded the first time a box is checked, not when the page
 * opens: most of the time the library's editor is for writing, and Pyodide
 * is several MB. runtime.js's BOOTSTRAP first, because the tests' harness
 * (autograde.js) uses what it defines.
 *
 * Python tutorials only: the page loads this file only for them
 * (tools/sync_presmaker.py), since a web or Flask tutorial's tests don't
 * know `try`. Nothing is posted anywhere; it's the teacher's own preview.
 */
(function () {
  "use strict";
  var PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
  var started = null;

  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("couldn't load " + src)); };
      document.head.appendChild(s);
    });
  }

  function python() {
    if (!started) {
      started = (typeof window.loadPyodide === "function" ? Promise.resolve() : script(PYODIDE + "pyodide.js"))
        .then(function () { return window.loadPyodide({ indexURL: PYODIDE }); })
        .then(function (py) {
          py.runPython(window.PyIDERuntime.BOOTSTRAP);
          return py;
        });
      started.catch(function () { started = null; });   // a failed load can be tried again
    }
    return started;
  }

  function attach() {
    var C = window.IDENotesChecks, T = window.PyIDETests;
    if (!C || !C.setTryRunner || !T || !T.run || !window.PyIDERuntime) return;
    C.setTryRunner(function (code, tests) {
      return python().then(function (py) { return T.run(py, { "main.py": code }, tests); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
