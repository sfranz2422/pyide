/* PyIDE — the Flask runner: what Run means for a Flask app, a SQL project
 * or a PHP site.
 *
 * FlaskIDE's run code, moved here when FlaskIDE moved into PyIDE (Nov 2026;
 * see runners/python.js for why the editor has runners). The functions below
 * are FlaskIDE's app.js — run, runPhpProject, runSqlProject, paintSql,
 * sqlTable, applyKind — with the same words, reaching the shell through
 * `ctx`. FlaskIDE kept every file in one map and one CodeMirror document;
 * here the shell keeps a document per file, so `readProject()` is the
 * shell's files, and the notes are the shell's own column rather than
 * taking turns with the preview.
 *
 * THREE KINDS, READ OFF THE FILES (flask_kind in app.py, the same rule): a
 * query.sql makes a SQL project, an index.php with no app.py a PHP site,
 * anything else a Flask app. Not stored anywhere — adding query.sql is how a
 * project becomes a SQL one, which is why the shell tells this runner when
 * files come and go (onFiles).
 *
 * FlaskIDE's runtime files came with it, under static/flask/, keeping their
 * globals: flask.js (FlaskIDERuntime: Pyodide, Flask's test client, SQL),
 * php.js (PhpRuntime, in a worker), preview.js (FlaskIDEPreview, the little
 * browser with an address bar), syntax.js, complete.js, autograde.js, and
 * pack.js, which encodes every save past Render's firewall.
 */
(function () {
  "use strict";

  var FLASK_ENTRY = "app.py";
  var SQL_ENTRY = "query.sql";
  var PHP_ENTRY = "index.php";

  // `files` is a name list or a {name: text} map: either way, which kind.
  function has(files, name) {
    return Array.isArray(files) ? files.indexOf(name) >= 0 : name in files;
  }
  function kindOf(files) {
    if (has(files, SQL_ENTRY)) return "sql";
    if (has(files, PHP_ENTRY) && !has(files, FLASK_ENTRY)) return "php";
    return "flask";
  }
  function entry(files) {
    return { sql: SQL_ENTRY, php: PHP_ENTRY }[kindOf(files)] || FLASK_ENTRY;
  }

  function modeFor(name) {
    if (/\.php$/.test(name)) return "application/x-httpd-php";
    if (/\.sql$/.test(name)) return "text/x-sql";
    if (/\.py$/.test(name)) return "python";
    if (/\.css$/.test(name)) return "css";
    if (/\.(html|htm|jinja2?)$/.test(name)) return "htmlmixed";
    if (/\.m?js$/.test(name)) return "javascript";
    return "text/plain";
  }

  /* Tabs, in an order that matches how Flask thinks: top level, then
     templates/ or includes/ (the pieces pages are made of), then static/.
     Alphabetical put a template called about.html before app.py. The shell
     puts the entry first itself. */
  function tabOrder(rest) {
    var rank = function (n) {
      return n.indexOf("/") < 0 ? 0 : (/^(templates|includes)\//.test(n) ? 1 : 2);
    };
    return rest.slice().sort(function (a, b) { return rank(a) - rank(b) || a.localeCompare(b); });
  }

  // The same rule the server enforces (FOLDER_FILE_NAME), said before the
  // work is done rather than when they press Share and lose the file.
  var NAME_OK = /^(?:(?:templates|static|includes)\/)?[A-Za-z0-9][A-Za-z0-9 _-]{0,50}\.[A-Za-z0-9]{1,8}$/;

  function newFile(names) {
    return kindOf(names) === "php"
      ? { question: "New file.\n\n" +
            "A page goes at the top level (about.php opens at /about.php), a " +
            "piece every page includes in includes/, and a stylesheet in static/.\n\n" +
            "For example: about.php", example: ".php" }
      : { question: "New file.\n\n" +
            "A template goes in templates/ and a stylesheet in static/ — that is " +
            "where Flask looks for them.\n\n" +
            "For example: templates/about.html", example: "templates/" };
  }

  function starterFor(name, names) {
    var php = kindOf(names) === "php";
    return /\.php$/.test(name) && php && name.indexOf("/") < 0
      // A new page, already wearing the site's header and footer.
      ? "<?php\n$title = '" + name.replace(/\.php$/, "") + "';\ninclude 'includes/header.php';\n?>\n\n\n\n<?php include 'includes/footer.php'; ?>\n"
      : /\.html?$/.test(name) && !php
      ? "{% extends \"base.html\" %}\n\n{% block body %}\n\n{% endblock %}\n"
      : "";
  }

  window.IDERunners = window.IDERunners || {};
  window.IDERunners.flaskide = {
    entry: entry,
    editorOptions: { mode: "python", indentUnit: 4, tabSize: 4 },
    modeFor: modeFor,
    hidden: function () { return false; },
    tabOrder: tabOrder,
    newFile: newFile,
    nameOk: function (name) { return NAME_OK.test(name); },
    nameExample: ".py, .html or .css, at the top level or in templates/, static/ or includes/",
    refuseName: function () { return ""; },
    starterFor: starterFor,
    attach: attach
  };

  function attach(ctx) {
    var $ = ctx.$;
    var editor = ctx.editor;
    var say = ctx.write;
    var clearOutput = ctx.clearOutput;
    var cfg = window.PYIDE;
    var running = false;
    var preview = null;

    function allFiles() {
      var out = ctx.dataFiles();
      out[ctx.MAIN] = ctx.mainSource();
      return out;
    }
    function readProject() { return { files: allFiles() }; }
    function isSql() { return kindOf(allFiles()) === "sql"; }
    function isPhp() { return kindOf(allFiles()) === "php"; }
    /* What runs the project: Pyodide's Flask, or PHP in its worker. They
       answer the same calls (flask.js, php.js), so this is the one place
       that has to know which. */
    function runtime() { return isPhp() ? window.PhpRuntime : window.FlaskIDERuntime; }

    /* The syntax card, covering the preview and console — where Run's result
       would have gone. `reveal` opens the file the error is in, so an error
       in models.py is shown in models.py. */
    var syntaxCard = window.FlaskIDESyntax.attach({
      host: $("output-view"),
      editor: editor,
      reveal: function (file) {
        if (!ctx.docs[file]) return null;
        if (file !== ctx.editingFile()) ctx.switchTo(file);
        return ctx.docs[file];
      }
    });

    /* What goes in the brackets, above the line while a call is typed
       (sighint.js): Python's own, Flask's, sqlite3's, and their own defs
       from every .py file. */
    window.PyIDESigHint.attach(editor, {
      flask: true,
      sources: function () {
        var files = allFiles();
        return Object.keys(files).filter(function (n) { return /\.py$/i.test(n); })
          .map(function (n) { return files[n]; });
      },
      isPython: function () { return /\.py$/i.test(ctx.editingFile()); }
    });

    /* Completion of the student's own names, in .py files only. Every .py in
       the project counts, so a name defined in models.py is offered in app.py. */
    window.FlaskIDEComplete.attach(editor, function () {
      return !cfg.readonly && window.FlaskIDEComplete.isPy(ctx.editingFile());
    }, function () {
      var files = allFiles();
      return Object.keys(files).filter(window.FlaskIDEComplete.isPy)
        .map(function (name) { return files[name]; });
    });

    preview = new window.FlaskIDEPreview({
      frame: $("preview"),
      bar: $("preview-path"),
      onStatus: function (code, path) {
        var el = $("preview-status");
        if (!el) return;
        el.textContent = code ? String(code) : "";
        el.className = "status-code" +
          (code >= 500 ? " bad" : code >= 400 ? " warn" : code ? " ok" : "");
        el.title = path;
      },
      onNote: function (text) { say("\n" + text + "\n", "dim"); },
    });
    window.FlaskIDERuntime.setOutput(function (text) { say(text); });
    if (window.PhpRuntime) window.PhpRuntime.setOutput(function (text) { say(text); });

    var hasRun = false;
    var XP_CODE = /\.(py|php|html?|css|js|sql)$/i;
    function reportRun(files) {
      if (!cfg.signedIn || cfg.viewOnly || cfg.readonly || cfg.isTeacher || !window.PyIDEXP) return;
      window.PyIDEXP.ran(files, XP_CODE);
    }

    function testsHere() {
      return window.PyIDETests ? window.PyIDETests.fromFiles(allFiles()).tests : [];
    }

    /* Check my work: every test in the notes, on the project as it is now
       (autograde.js). The shell keeps the result for the teacher. */
    async function runChecks() {
      if (running) return null;
      var files = allFiles(), tests = testsHere();
      if (!tests.length) return null;
      running = true;
      var btn = $("run");
      if (btn) btn.disabled = true;
      try {
        await runtime().boot(function () {});
        return await window.PyIDETests.run(runtime(), files, tests);
      } finally {
        running = false;
        if (btn) btn.disabled = false;
      }
    }

    async function run() {
      if (running) return;
      // The preview, in case the right pane was put away.
      ctx.showOutput();
      running = true;
      hasRun = true;
      var btn = $("run");
      if (btn) btn.disabled = true;
      clearOutput();

      var project = readProject();
      if (isSql() || isPhp()) {
        try {
          await (isSql() ? runSqlProject(project) : runPhpProject(project));
        } finally {
          running = false;
          if (btn) btn.disabled = false;
        }
        return;
      }
      try {
        /* Can Python read it at all? Asked before the app is loaded, so a
           missing bracket gets a plain-words card over the editor (syntax.js)
           instead of a traceback from inside Flask. Python's own message
           still goes in the console. */
        syntaxCard.clear();
        var bad = await runtime().check(project.files, function (note) {
          if (note) say(note + "\n", "dim");
        });
        if (bad) {
          say("SyntaxError in " + bad.file + " on line " + bad.line + ": " + bad.msg + "\n"
              + (bad.text.trim() ? "    " + bad.text.trim() + "\n" : ""), "err");
          syntaxCard.show(bad);
          return;
        }
        var res = await runtime().run(project.files, function (note) {
          if (note) say(note + "\n", "dim");
        });

        if (!res.ok) {
          say("\n" + res.error + "\n", "err");
          return;
        }
        reportRun(project.files);

        if (!res.routes.length) {
          say("Your app has no routes yet.\n\n", "dim");
          say("A route is a path plus the function that answers it:\n\n" +
              '    @app.route("/")\n' +
              "    def home():\n" +
              '        return "Hello!"\n', "dim");
        } else {
          say("Running. Routes:\n", "dim");
          res.routes.forEach(function (r) {
            say("  " + r.methods.join(",") + "  " + r.path + "\n");
          });
        }
        await preview.go("/");
      } catch (err) {
        say("\n" + (err && err.message ? err.message : String(err)) + "\n", "err");
      } finally {
        running = false;
        if (btn) btn.disabled = false;
      }
    }

    /* ----------------------------------------------------------------- PHP */

    /* A PHP site: the same steps as a Flask app's Run, with PHP's words. Can
       PHP read every .php file (the syntax card if not), put the files in
       place and build data.db, list the pages, and show /. */
    async function runPhpProject(project) {
      var php = window.PhpRuntime;
      try {
        syntaxCard.clear();
        var bad = await php.check(project.files, function (note) {
          if (note) say(note + "\n", "dim");
        });
        if (bad) {
          say("PHP can't read " + bad.file + ", line " + bad.line + ": " + bad.msg + "\n"
              + (bad.text.trim() ? "    " + bad.text.trim() + "\n" : ""), "err");
          syntaxCard.show(bad);
          return;
        }
        var res = await php.run(project.files, function (note) {
          if (note) say(note + "\n", "dim");
        });
        if (!res.ok) {
          say("\n" + res.error + "\n", "err");
          if (res.statement) {
            say("\nin this statement:\n", "dim");
            say(res.statement + "\n");
          }
          return;
        }
        reportRun(project.files);
        say("Running. Pages:\n", "dim");
        res.pages.forEach(function (p) { say("  " + p + "\n"); });
        if (res.tables && res.tables.length) {
          say("Database (data.db, from schema.sql): " + res.tables.map(function (t) {
            return t.name + " (" + t.rows + (t.rows === 1 ? " row)" : " rows)");
          }).join(", ") + "\n", "dim");
        }
        await preview.go("/");
      } catch (err) {
        say("\n" + (err && err.message ? err.message : String(err)) + "\n", "err");
      }
    }

    /* ----------------------------------------------------------------- SQL */

    async function runSqlProject(project) {
      var pane = $("sql-results");
      try {
        var res = await window.FlaskIDERuntime.runSql(project.files, function (note) {
          if (note) say(note + "\n", "dim");
        });

        if (!res.ok) {
          if (pane) pane.innerHTML = "";
          say("\n" + res.error + "\n", "err");
          /* The statement it came from. A query file holds several, and
             "near FORM: syntax error" does not say which one -- so the one
             that failed is printed under the message rather than left for the
             student to find by reading all of them. */
          if (res.statement) {
            say("\nin this statement:\n", "dim");
            say(res.statement + "\n");
          }
          /* Whatever DID run still goes on screen. A file of six queries with
             a typo in the fifth should still show you the first four. */
          if (res.results && res.results.length) {
            paintSql(res.results, res.tables || []);
            say("\n" + res.results.length + " statement(s) ran before it.\n",
                "dim");
          }
          return;
        }

        paintSql(res.results, res.tables);
        reportRun(project.files);
        var n = res.results.length;
        say(n === 1 ? "1 statement.\n" : n + " statements.\n", "dim");
        if (!n) {
          say("\nquery.sql has no statements in it yet -- only comments.\n",
              "dim");
        }
      } catch (err) {
        say("\n" + (err && err.message ? err.message : String(err)) + "\n",
            "err");
      }
    }

    function paintSql(results, tables) {
      var pane = $("sql-results");
      if (!pane) return;
      pane.innerHTML = "";

      (results || []).forEach(function (r) {
        var block = document.createElement("div");
        block.className = "sql-result";

        var head = document.createElement("div");
        head.className = "sql-result-head";
        var stmt = document.createElement("pre");
        stmt.className = "sql-stmt";
        stmt.textContent = r.statement;
        head.appendChild(stmt);

        var count = document.createElement("span");
        count.className = "sql-count";
        if (r.columns) {
          count.textContent = r.rows.length === 1 ? "1 row"
                                                  : r.rows.length + " rows";
        } else {
          /* SQLite reports -1 for a statement whose row count it does not
             track. Saying "-1 rows changed" is worse than saying nothing. */
          count.textContent = r.changed >= 0 ? r.changed + " changed" : "done";
        }
        head.appendChild(count);
        block.appendChild(head);

        if (r.columns) block.appendChild(sqlTable(r));
        pane.appendChild(block);
      });

      /* What the tables are called, under the results. Half of learning SQL is
         remembering the names, and the schema is otherwise a file away. */
      if (tables && tables.length) {
        var foot = document.createElement("div");
        foot.className = "sql-schema";
        foot.appendChild(document.createTextNode("In the database: "));
        tables.forEach(function (tbl, i) {
          if (i) foot.appendChild(document.createTextNode(", "));
          var code = document.createElement("code");
          code.textContent = tbl.name;
          foot.appendChild(code);
          foot.appendChild(document.createTextNode(" (" + tbl.rows + ")"));
        });
        pane.appendChild(foot);
      }
    }

    function sqlTable(r) {
      var wrap = document.createElement("div");
      wrap.className = "sql-table-wrap";

      if (!r.rows.length) {
        var none = document.createElement("div");
        none.className = "sql-empty";
        none.textContent = "No rows. (" + r.columns.join(", ") + ")";
        wrap.appendChild(none);
        return wrap;
      }

      var table = document.createElement("table");
      table.className = "sql-table";
      var thead = document.createElement("thead");
      var hrow = document.createElement("tr");
      r.columns.forEach(function (name) {
        var th = document.createElement("th");
        th.textContent = name;
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);

      var body = document.createElement("tbody");
      r.rows.forEach(function (row) {
        var tr = document.createElement("tr");
        row.forEach(function (value) {
          var td = document.createElement("td");
          /* NULL IS NOT THE EMPTY STRING. Rendering both as a blank cell is
             wrong on the exact day LEFT JOIN is taught, because the whole
             lesson is the row that has nothing on one side. */
          if (value === null) {
            td.className = "sql-null";
            td.textContent = "NULL";
          } else {
            /* textContent, never innerHTML: a row could hold anything, and
               this grid must not run it. */
            td.textContent = String(value);
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);

      if (r.clipped) {
        var note = document.createElement("div");
        note.className = "sql-clipped";
        note.textContent = "Showing the first " + r.rows.length +
          " rows. Add a LIMIT, or a WHERE, to see fewer.";
        wrap.appendChild(note);
      }
      return wrap;
    }

    /* What the chrome says about the project: called whenever the files
       change, because adding or deleting query.sql is what changes the kind. */
    function applyKind() {
      var sql = isSql(), php = isPhp();
      document.body.classList.toggle("is-sql", sql);
      if (window.FlaskIDEPreview) window.FlaskIDEPreview.useRuntime(runtime());

      var chip = $("mode");
      if (chip) {
        chip.textContent = sql ? "SQL" : php ? "PHP" : "Flask";
        chip.title = sql
          ? "A SQL project: query.sql runs against the database schema.sql builds."
          : php ? "A PHP site: index.php opens at / and the preview shows its pages."
          : "A Flask app: app.py runs and the preview shows its pages.";
      }

      var title = $("right-title");
      if (title) title.textContent = sql ? "Results" : "Preview";

      var runTab = $("run-tab");
      if (runTab) runTab.hidden = sql;      // a SQL project has no pages
    }

    /* ------------------------------------------- the app in a new tab
     *
     * The files go to /play through this browser's storage, not the server:
     * nothing is saved or shared by it, and a signed-out student can use it
     * as freely as Run. /play boots its own Python and runs its own copy of
     * the app (play_flask.html). One named tab, reused. */
    function runInNewTab() {
      try {
        localStorage.setItem("flaskide-play", JSON.stringify({
          files: allFiles(), title: ($("title") && $("title").value) || "App" }));
      } catch (e) {
        window.alert("This browser is blocking site storage, so the app "
                     + "cannot be handed to a new tab. Use the preview here instead.");
        return;
      }
      window.open("/play?ide=flaskide", "flaskide-play");
    }

    function download() {
      var safe = (($("title") && $("title").value) || "project").replace(/[^A-Za-z0-9 _-]/g, "").trim();
      var files = allFiles();
      var entries = Object.keys(files).map(function (name) {
        return { name: name, data: files[name] };
      });
      // The zip keeps the folders, because a project that unzips flat is a
      // project Flask cannot run.
      window.PyIDEZip.download((safe || "project") + ".zip", entries);
    }

    if ($("run")) $("run").addEventListener("click", run);
    if ($("run-tab")) $("run-tab").addEventListener("click", runInNewTab);
    if ($("preview-back")) $("preview-back").addEventListener("click", function () {
      preview.back();
    });
    applyKind();

    return {
      run: run,
      stop: function () {},       // nothing to stop: a run ends, PHP has its own limit
      escape: function () {},
      isRunning: function () { return running; },
      hasRun: function () { return hasRun; },
      checks: runChecks,
      payload: function () { return { ide: "flaskide", code: "", files: allFiles() }; },
      forRescue: function (all) { return all; },
      forget: function () {},     // every run writes the files afresh
      warnName: function () { return ""; },
      download: download,
      onResize: function () {},
      onFiles: applyKind
    };
  }
})();
