/* A discussion assignment's page ("Discussions" in app.py, discussion.html).
 *
 * The board is read by polling — every POLL_MS while the page is in view,
 * and at once after a post — for the reason live lessons poll: two workers
 * and no sockets. It is drawn again only when what came back differs, so a
 * reply half-typed under a post isn't wiped by the next poll.
 *
 * The writing box is the long response's (notes.js buildLong): five tools,
 * paste as plain text, and the HTML cut down to a few tags with no
 * attributes before it is sent — and again on the server (quiz.clean_html),
 * since a request need not come from this page. What's typed is kept in
 * this browser until it is posted: a paragraph lost to a closed tab is the
 * failure worth guarding against here.
 *
 * measure() is _post_measure in app.py, the same rule (test_discussion.py
 * runs both on the same posts): the green/yellow mark, and what's missing,
 * show while typing, and the server's mark is the one kept. */
window.PyIDEDiscussion = (function () {
  "use strict";

  var POLL_MS = 5000;
  var TOOLS = [
    ["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"],
    ["insertUnorderedList", "• List", "Bulleted list"],
    ["insertOrderedList", "1. List", "Numbered list"]
  ];

  function words(text) {
    return String(text || "").split(/\s+/).filter(Boolean).length;
  }

  /* _post_measure in app.py, line for line: which of longer / variety /
     reason / sentences a post is missing ([] is green). `stop` is the
     server's own list (DISCUSSION_STOPWORDS, handed over by the page), so
     the two can't differ; test_discussion.py runs both on the same posts. */
  var REASON = /\b(because|since|so that|therefore|however|although|for example|for instance|such as|i think|i believe|i agree|i disagree|in my opinion|this means|which means|that means|the reason|but|if|should|would|could)\b|, so\b/;
  function mtldPass(tokens, threshold) {
    var factors = 0, types = {}, n = 0, count = 0, ttr = 1;
    tokens.forEach(function (t) {
      count += 1;
      if (!types[t]) { types[t] = true; n += 1; }
      ttr = n / count;
      if (ttr <= threshold) { factors += 1; types = {}; n = 0; count = 0; }
    });
    if (count > 0) factors += (1 - ttr) / (1 - threshold);
    return factors > 0 ? tokens.length / factors : tokens.length;
  }
  function mtld(tokens) {
    return tokens.length ? (mtldPass(tokens, 0.72) + mtldPass(tokens.slice().reverse(), 0.72)) / 2 : 0;
  }
  function measure(text, minWords, stop) {
    text = String(text || "");
    var low = text.toLowerCase(), tokens = low.match(/[a-z0-9']+/g) || [];
    var skip = {}, seen = {}, unique = 0, missing = [];
    (stop || []).forEach(function (w) { skip[w] = true; });
    tokens.forEach(function (t) { if (!skip[t] && !seen[t]) { seen[t] = true; unique += 1; } });
    var n = words(text);
    if (n < 40 || 2 * n < 3 * minWords) missing.push("longer");
    if (unique < 15 || mtld(tokens) < 30) missing.push("variety");
    if (!(REASON.test(low) || text.indexOf("?") >= 0)) missing.push("reason");
    if ((text.trim().match(/[.!?]+(?=\s|$)/g) || []).length < 2) missing.push("sentences");
    return missing;
  }
  function substantial(text, minWords, stop) { return !measure(text, minWords, stop).length; }
  // What to do about each, said to the student under their box.
  var TIPS = { longer: "say more", variety: "use more of your own words",
               reason: "give a reason (because…, for example…) or ask a question",
               sentences: "write it in more than one sentence" };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clean(html) {
    return window.PyIDENotes && window.DOMPurify ? window.PyIDENotes.cleanLong(html) : "";
  }

  var opts, state = { sig: "", data: null }, timer = null;

  function draftKey(parent) { return "pyide-disc:" + opts.url + ":" + (parent || "top"); }
  function loadDraft(parent) { try { return localStorage.getItem(draftKey(parent)) || ""; } catch (e) { return ""; } }
  function saveDraft(parent, html) {
    try {
      if (html) localStorage.setItem(draftKey(parent), html);
      else localStorage.removeItem(draftKey(parent));
    } catch (e) { /* private window: the box itself still holds it */ }
  }

  /* A writing box: tools, the box, and a foot with the live word count and
     mark, and Post. `parent` null is a post to the question. */
  function composer(host, parent, onCancel) {
    host.innerHTML = "";
    var bar = el("div", "quiz-long-bar");
    var box = el("div", "quiz-long-box disc-box");
    box.contentEditable = "true";
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-multiline", "true");
    box.setAttribute("aria-label", parent ? "Your reply" : "Your post");
    box.dataset.placeholder = parent ? "Write your reply here." : "Write your post here.";
    TOOLS.forEach(function (t) {
      var b = el("button", "quiz-tool quiz-tool-" + t[0], t[1]);
      b.type = "button";
      b.title = t[2];
      b.addEventListener("mousedown", function (e) {
        e.preventDefault();
        box.focus();
        document.execCommand(t[0], false, null);
        changed();
      });
      bar.appendChild(b);
    });
    var foot = el("div", "disc-foot");
    var meter = el("span", "disc-meter");
    var send = el("button", "btn btn-primary", parent ? "Post reply" : "Post");
    send.type = "button";
    var said = el("span", "small disc-said");
    said.setAttribute("role", "status");
    foot.appendChild(meter);
    foot.appendChild(send);
    if (onCancel) {
      var cancel = el("button", "btn", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", onCancel);
      foot.appendChild(cancel);
    }
    foot.appendChild(said);
    host.appendChild(bar);
    host.appendChild(box);
    host.appendChild(foot);

    var saved = loadDraft(parent);
    if (saved) box.innerHTML = clean(saved) || "";

    function text() { return (box.innerText || box.textContent || "").trim(); }
    function changed() {
      var t = text(), n = words(t), min = opts.minWords;
      saveDraft(parent, t ? clean(box.innerHTML) : "");
      meter.className = "disc-meter";
      if (!n) { meter.textContent = min && !opts.teacher ? "At least " + min + " words" : ""; return; }
      if (n < min && !opts.teacher) {
        meter.classList.add("is-short");
        meter.textContent = n + " / " + min + " words";
      } else {
        var miss = measure(t, min, opts.stop);
        if (!miss.length) {
          meter.classList.add("is-green");
          meter.textContent = "● Substantial · " + n + " words";
        } else {
          meter.classList.add("is-yellow");
          meter.textContent = "● Meets the minimum · " + n + " words. To make it substantial: " +
            miss.map(function (k) { return TIPS[k]; }).join("; ") + ".";
        }
      }
    }
    box.addEventListener("input", changed);
    box.addEventListener("paste", function (e) {
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      e.preventDefault();
      document.execCommand("insertText", false, t);
    });
    box.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && /^[biu]$/i.test(e.key)) {
        e.preventDefault();
        document.execCommand({ b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()]);
        changed();
      }
    });
    send.addEventListener("click", function () {
      if (!text()) { said.textContent = "Write something first."; return; }
      send.disabled = true;
      said.textContent = "Posting…";
      fetch(opts.url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: clean(box.innerHTML), parent: parent || null })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          send.disabled = false;
          if (!x.ok) { said.textContent = x.d.error || "Not posted."; return; }
          saveDraft(parent, "");
          box.innerHTML = "";
          changed();
          said.textContent = "Posted.";
          if (onCancel) onCancel();
          poll();
        })
        .catch(function () { send.disabled = false; said.textContent = "Not posted: no connection."; });
    });
    changed();
    return box;
  }

  function when(iso) {
    try {
      return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function drawPost(p, kids, depth, canReply) {
    var art = el("article", "disc-post" + (p.teacher ? " is-teacher" : "") + (p.mine ? " is-mine" : ""));
    art.id = "post-" + p.id;
    var head = el("div", "disc-post-head");
    head.appendChild(el("strong", "", p.name));
    if (p.teacher) head.appendChild(el("span", "disc-badge", "Teacher"));
    if (p.mine && !p.teacher) head.appendChild(el("span", "disc-badge disc-you", "You"));
    head.appendChild(el("span", "small dim", when(p.at)));
    if (p.mark) {
      head.appendChild(el("span", "disc-mark is-" + p.mark,
                          p.mark === "green" ? "● Substantial" : "● Meets the minimum"));
    }
    art.appendChild(head);
    var body = el("div", "disc-post-body");
    body.innerHTML = clean(p.html);                 // cleaned on the server too
    art.appendChild(body);
    if (canReply) {
      var rb = el("button", "linkbtn disc-reply", "Reply");
      rb.type = "button";
      var spot = el("div", "disc-editor disc-reply-box");
      rb.addEventListener("click", function () {
        rb.hidden = true;
        composer(spot, p.id, function () { spot.innerHTML = ""; rb.hidden = false; }).focus();
      });
      art.appendChild(rb);
      art.appendChild(spot);
      // A reply half-written before a reload is still there: open its box.
      if (loadDraft(p.id)) { rb.hidden = true; composer(spot, p.id, function () { spot.innerHTML = ""; rb.hidden = false; }); }
    }
    var list = kids[p.id] || [];
    if (list.length) {
      var wrap = el("div", "disc-replies" + (depth >= 3 ? " is-flat" : ""));
      list.forEach(function (k) { wrap.appendChild(drawPost(k, kids, depth + 1, canReply)); });
      art.appendChild(wrap);
    }
    return art;
  }

  function draw(d) {
    var host = document.getElementById("disc-posts");
    var locked = document.getElementById("disc-locked");
    if (locked) locked.hidden = d.see_all;
    if (!host) return;
    host.innerHTML = "";
    if (!d.see_all) {
      if (d.hidden) host.appendChild(el("p", "dim small",
        d.hidden + " post" + (d.hidden === 1 ? "" : "s") + " so far."));
    } else {
      var kids = {}, top = [];
      d.posts.forEach(function (p) {
        if (p.parent == null) top.push(p);
        else (kids[p.parent] = kids[p.parent] || []).push(p);
      });
      if (!top.length) host.appendChild(el("p", "dim", "No posts yet."));
      var canReply = opts.canPost;
      top.slice().reverse().forEach(function (p) { host.appendChild(drawPost(p, kids, 0, canReply)); });
    }
    var title = document.getElementById("disc-compose-title");
    if (title && opts.teacher) title.textContent = "Post to the class";
    else if (title && d.posted) title.textContent = "Add another post";
    if (opts.teacher) drawCounts(d);
    else drawMine(d);
  }

  function drawMine(d) {
    var needs = document.getElementById("disc-needs");
    if (!needs || !d.mine) return;
    var r = d.rules, m = d.mine;
    var done = m.posts >= r.posts && m.replies >= r.replies;
    needs.className = "disc-needs" + (done ? " is-done" : "");
    needs.textContent = (done ? "✓ Done: " : "To finish: ") +
      Math.min(m.posts, r.posts) + " of " + r.posts + " post" + (r.posts === 1 ? "" : "s") + ", " +
      Math.min(m.replies, r.replies) + " of " + r.replies + " repl" + (r.replies === 1 ? "y" : "ies") +
      " to classmates (at least " + r.min_words + " words each).";
  }

  function drawCounts(d) {
    var t = document.getElementById("disc-counts");
    if (!t || !d.students) return;
    var body = t.querySelector("tbody");
    body.innerHTML = "";
    d.students.forEach(function (s) {
      var tr = el("tr");
      var done = s.posts >= d.rules.posts && s.replies >= d.rules.replies;
      tr.appendChild(el("td", "", s.name));
      tr.appendChild(el("td", s.posts >= d.rules.posts ? "is-met" : "", s.posts + " / " + d.rules.posts));
      tr.appendChild(el("td", s.replies >= d.rules.replies ? "is-met" : "", s.replies + " / " + d.rules.replies));
      tr.appendChild(el("td", done ? "is-met" : "", s.earned ? s.earned + " / " + (d.out_of || 0) : "—"));
      body.appendChild(tr);
    });
    t.hidden = !d.students.length;
  }

  function poll() {
    if (timer) { clearTimeout(timer); timer = null; }
    return fetch(opts.url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d) {
          var sig = JSON.stringify(d);
          if (sig !== state.sig) {
            state.sig = sig;
            state.data = d;
            if (d.rules) opts.minWords = d.rules.min_words;
            draw(d);
          }
        }
      })
      .catch(function () { /* the next poll tries again */ })
      .then(function () { timer = setTimeout(tick, POLL_MS); });
  }
  function tick() {
    if (document.hidden) { timer = setTimeout(tick, POLL_MS); return; }
    poll();
  }

  function rulesForm() {
    var form = document.getElementById("disc-rules");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var said = document.getElementById("disc-rules-said");
      var body = {};
      ["posts", "replies", "min_words", "out_of"].forEach(function (k) { body[k] = form.elements[k].value; });
      said.textContent = "Saving…";
      fetch(opts.rulesUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          said.textContent = x.ok ? "Saved. Everyone is graded again." : (x.d.error || "Not saved.");
          if (x.ok) poll();
        })
        .catch(function () { said.textContent = "Not saved: no connection."; });
    });
  }

  function start(o) {
    opts = o;
    var top = document.querySelector("#disc-compose .disc-editor");
    // DOMPurify comes with notes.js's render; the prompt's render asked for
    // it, so wait for it before building a box whose drafts it cleans.
    var ready = window.PyIDENotes && window.PyIDENotes.render
      ? window.PyIDENotes.render(document.createElement("div"), "") : Promise.resolve();
    Promise.resolve(ready).then(function () {
      if (top && opts.canPost) composer(top, null, null);
      rulesForm();
      poll();
    });
  }

  return { start: start, substantial: substantial, measure: measure, words: words,
           _mtld: function (text) { return mtld(String(text || "").toLowerCase().match(/[a-z0-9']+/g) || []); } };
})();
