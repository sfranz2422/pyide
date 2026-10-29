# PyIDE

A browser-based Python IDE for intro programming classes. Student code runs
entirely in the browser via Pyodide, so the server never executes anything a
student wrote — it stores and serves code, and nothing more.

Two kinds of program run here: ordinary console Python, and kaypy games
(`from kaypy import *`). Which one is decided by the code itself, not by a
setting — `game.js`'s `looksLikeGame()` is the whole rule.

## Running it

```
pip install -r requirements.txt
python3 app.py                 # http://localhost:5000
```

Google sign-in is off unless `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
are set, and the app is fully usable without it — anonymous students open a
link, write code, press Run and share a snapshot. **Signing in only ever adds
abilities.** Never make it required for anything a student already had.

`TEACHER_EMAILS` (comma separated) decides who gets the dashboard. It is an
environment variable and not a column on purpose: nobody can promote
themselves by finding a hole in the app.

## Tests

Every suite is a plain script under `tools/`. There is no pytest.

```
for t in tools/test_*.py; do
  printf "%-26s " "$(basename "$t")"
  python3 "$t" >/tmp/out.$$ 2>&1 && tail -1 /tmp/out.$$ \
    || { echo "FAILED"; tail -20 /tmp/out.$$; }
done
```

Each suite prints `ok`/`FAIL` per check and exits non-zero on failure. The
loop above keeps the last line of a passing run and shows the tail of a
failing one, so a red suite cannot scroll past unnoticed — a bare
`for ... do python3 "$t"; done` will let it.

**`node` is required**, by eighteen of these: `test_attendance.py`, `test_calendar.py`, `test_charts.py`, `test_dungeon.py`,
`test_export_runs.py`, `test_game_runtime.py`, `test_packages.py`, `test_pictures.py`,
`test_quiz.py`, `test_requests.py`, `test_rescue.py`,
`test_same_as_kaypy.py`, `test_sighint.py`, `test_syntax.py`,
`test_tabstops.py`, `test_themes.py`, `test_xp.py`, `test_keep_place.py` and `test_autograde.py`. They run
this repo's own JavaScript — the sprite panel's inserts, the rescue's
branches, the export — rather than describing it, which is the only way
those get checked at all. `brew install node` if it is missing.

A `.mjs` test is never picked up by the loop above on its own: it needs a
`test_*.py` to run it. `tools/test_run_stop_cycle.mjs` (Run/Stop and the
keyboard) went unrun until `test_game_runtime.py` took it on.

`test_same_as_kaypy.py` compares the vendored engine against `~/kaypy`, and
**skips only when that folder is absent**. If you have the kaypy repo checked
out — and on this machine you do — it runs, and then it needs node like the
rest.

**The house rule for tests: every check must have been watched to fail.**
Break the thing it guards, confirm it fails, put it back. A check written and
never falsified is how a whole feature quietly stops being tested — it has
happened repeatedly here, most often because the same line appears in several
branches and the sabotage hit the wrong copy.

## Things that are invisible from the code

**`accounts.py` is one file living in three repos** — PyIDE, WebIDE and
FlaskIDE — and it is byte-identical in all three. Change it here and copy it
to the other two, or the shared tables drift. The five tables (`users`,
`assignments`, `drafts`, `submissions`, `live_sessions`) are shared across
all three apps, which is why rows carry an `app` column.

**`gunicorn --workers 2`.** Two processes, no shared memory, nothing routing
a person to a given one. Any per-session state in a module-level dict is
visible to one worker and invisible to the other, and which one a request
reaches changes every time. This is why live sessions are a table and not a
dict, and why there are no WebSockets: a socket lives in one worker, so
broadcasting across both would need a broker, which is another paid service.

**`render.yaml` says `plan: free` but the dashboard is on paid plans.** The
dashboard wins. Do not "fix" the file into force without asking.

**New columns need a `LATER_COLUMNS` entry in `accounts.py`.**
`create_all()` makes missing tables but never missing columns, so a database
from an earlier deploy needs the explicit `ALTER TABLE`. Every default has to
leave existing rows *correct*, not merely valid.

## Features worth knowing about

**Teaching live** (`/live`, `static/live.js`, the `live_*` routes). A teacher
presses Go live in the ordinary editor and keeps working; the class watches
whatever file is open and types their own copy underneath. Students poll a
row once a second and are answered `304` almost every time. Pushes carry a
clock stamp and the server refuses a lower one, because two pushes overtaking
each other would otherwise leave older text on screen with a newer version.

The student's own editor is never written to from the network — `live.js`
calls `setValue` on the mirror only, and there is deliberately **no** button
that copies the teacher's code down. Typing it is the exercise, and the
teacher's pane is `user-select: none` for the same reason. That is a speed
bump, not a lock: the page is sent the file in order to show it.

**Play it here** (`playTeacherGame` in `live.js`) is the teacher's game on
the student's own canvas. A game can't come down a once-a-second poll, but
its code already does, so the button runs the mirror's `main.py` in the
student's Python. It never pulls files into their project: whatever it
writes into `/project` is deleted when it stops (`forgetTeacherFiles`), or
a `scores.txt` from the teacher's game turns up as a tab in theirs.

**The class's page has handles between its panes** (`static/split.js`).
Each one sizes the pane before it, and the notes are always what's left.
Sizes are kept per student in localStorage. Nothing in the right-hand
column may depend on `body.is-game`: that class comes off when a game
stops while its last frame stays on screen, and that is how a stopped game
once pushed the output over the notes.

**A lesson for an assignment starts the student's editor** where
`/a/<slug>` would: their own draft of it if they have one, else its
starter. It is rendered into the page (`starter`), never sent on the poll,
and anything already typed in that browser for the lesson wins. The draft
matters more than it looks — saving from the live page overwrites that
draft, so starting from the bare starter would erase earlier work on the
first Save.

**The project's notes** (its first `.md` file, the one the assignment link
opens first) go out with every push whichever file is open, and show in a
pane under the output on the student's page. A push that sends no `notes`
key leaves them alone, so an old editor tab cannot wipe them.

**Sending a snippet** is the one exception, and it is narrow on purpose.
The teacher highlights code in their editor, right-clicks, and picks *Send
to students* (`/api/live/<code>/send`). Students get a card above their
editor with an Insert button for that code only; it goes in at their cursor,
on their click, and `insertSnippet` is the only function in `live.js` that
writes into their editor from the network. Sending "" takes it back, which
removes the card. A send moves `version` like a push does, so a push and a
send can overtake each other — the loser is answered `stale` and `app.js`
retries it. `test_live.py` pins all of this.

**Turning work in from a live lesson** only works because the lesson carries
an `assignment_id` and `/api/live/<code>/keep` writes into *that assignment's
own draft* — the same row `/a/<slug>` would have made. Saving through
`/api/draft` instead makes a draft with no assignment, which can never be
turned in, and the button simply cannot appear.

**Work is turned in for the student** (`_auto_turn_in`), because students
answered questions and typed all lesson without pressing Turn in. Answering
a question turns in at once; the editor and the live page send
`turn_in: true` on an autosave every 2 minutes while the work changes, and
as the page closes. It never counts an attempt (`times_submitted` starts at
0 on a row it makes), never snapshots unchanged work, and never moves
`submitted_at` when nothing changed — a moved time shows "turned in again
since your feedback" about nothing. Turn in is still there, and still an
attempt. Its snapshot is rewritten in place by the next automatic one
(`Submission.auto_snap`) instead of a new copy every time — data files are
copied into every snapshot, and a project with books in it made a few MB per
student per period. A copy made by pressing Turn in is never rewritten.

**Data files** may be 1.5 MB each and 5 MB together in PyIDE (a teacher's
project reads three novels). WebIDE and FlaskIDE keep 200 KB / 600 KB on
purpose: there the same constants cap what a live lesson sends, and WebIDE
inlines every file into the page each student polls.

**The rescue** (`static/rescue.js`, identical in all three apps). A signed-out
student's work is kept in their browser and put back after they sign in.
Silently when the server draft is still the untouched starter; with a prompt
when they already had real work saved, which is the only case where restoring
could destroy something. `draftFresh`, sent by the server, is what decides.

**Slides, and links made ahead.** Notes with `---` are always shown as
slides (`notes.js`, `slideView`), in the editor and on the class's page. A
live push sends the whole notes file and the teacher's slide (`"3/5"`);
each student moves through the slides freely and is jumped to the teacher's
slide only when the teacher *moves* — typing on the same slide must not drag
back a student who has read ahead. The assignment page makes the lesson's
link ahead of time (`_lesson_for`) so it can be posted in Classroom the day
before: an ended lesson with `version` 0 is "not started yet" (`_waiting`),
which is why a lesson started normally begins at `version` 1.

**What goes in the brackets** (`static/sighint.js`). While the cursor is inside
a call it knows, a small hint above the line shows the slots, the one being
typed in bold. It inserts nothing and takes no clicks. Sources, in the order
they win: the student's own `def`s (a scanner, held to `ast` by
`test_sighint.py`), kaypy's (`static/py/kaypy_sigs.json`, rebuilt from the bundled engine by `tools/kaypy_signatures.py` on every `vendor_kaypy.py`; only in a program that imports kaypy), then a hand-written table of Python's built-ins and
methods in beginner words. `test_sighint.py` checks every table entry
against Python itself, so a hint can never show a call Python would refuse.

**Charts** (`_pyide_charts` in `runtime.js`'s bootstrap). `plt.show()` puts
each open figure in the output pane as a PNG, between the lines printed
before and after it, on all three pages (`attachConsole` owns the pane).
`MPLBACKEND` points matplotlib at a backend made in memory, because Pyodide's
own draws into a box at the bottom of the page, outside the pane. Drawing is
not counted against the time limit, figures are closed by `show()` and at the
start of every run, and a program that draws without `show()` is told to add
it — desktop Python says nothing there, which a student cannot act on.
`test_charts.py` runs it all in the real Pyodide with real matplotlib, so the
first run fetches about 15 MB of wheels into `node_modules/pyodide/`.

**The syntax card** (`static/syntax.js`). Before Run does anything, the page
asks Python to *compile* every `.py` file (`_pyide_check` in `runtime.js`); if one can't be read, a card
covering the output pane says what is wrong in plain words, with Python's own message
under it, and nothing runs. **Syntax only, by construction**: it compiles and
never runs, so a program that reads fine never gets a card, however wrong it
is. Keep every sentence about how a line is *written*; a hint about logic
would be answering the exercise. The words are a table keyed on Python's
message, and `test_syntax.py` runs each one against the real Pyodide, so a
Python upgrade that rewords a message fails there.

**Lessons** (`kind = "lesson"` on an assignment; `lesson.html`, `lesson.js`,
`lesson_teacher.html`, `lesson_teacher.js`; "Lessons" in `app.py`). Notes
with questions and no code, for non-programming classes, made with Create
lesson on the dashboard. The notes are `lesson.md` in the assignment's
`files`, so answer keys, marking, Classroom and the live link work unchanged.
Students get the slides full screen: at their own pace from the assignment
link, following the teacher's slide from the live link — the only
difference. No draft; Turn in makes a Submission with an empty
`snippet_slug`, and the results page lists answers where code would have an
Open link. Anything that builds a `view_shared` link from a submission must
allow for that empty slug.

**Questions in the notes** (`quiz.py`, `notes.js`'s `parseQuiz`/`buildQuiz`,
`/api/quiz/*`). A ```` ```quiz ```` block in an assignment's notes is a
question: `- [x]` choices, or `answer:` lines for short answer, `points:`
(default 1). One try, marked at once; the points are added to the teacher's
score and Sync sends the total. **The notes go to students whole, so the key
is taken out at every exit** — `quiz.redact_files` wherever an assignment's
files reach a student, `quiz.redact` on every live push — and kept in
`quiz_questions`. A new route that hands out an assignment's files must
redact too, and needs a line in `test_quiz.py`'s leak section: a missed exit
leaks the answers with no visible sign.

`type: long` in a quiz block makes a **long response**: a box with a small
formatting toolbar, no key, marked by hand on the assignment's page
(`/api/quiz/grade`, stored in `QuizAnswer.score`). It is the one place a
student's text is drawn as markup on the teacher's screen, so it goes through
`quiz.clean_html` (a few tags, no attributes) when saved **and** whenever it
is shown. Unmarked ones from students who turned in are the "to grade" tags
on the dashboard, class page and assignment page (`_ungraded`).

`type: blank` (`[[answer|other]]` blanks, code included) and `type: match`
(`- left -> right` pairs, `option:` distractors) give **partial credit**
(`quiz.fraction`). Their responses are JSON lists, one string per blank or
left. Redaction empties the blanks and splits the pairs into `match:` lefts
and sorted `option:` rights; the qid is taken with the answers removed, so
fixing a key regrades rather than making a new question. All formats are
shown at `/help/questions`, whose examples `test_quiz.py` parses.

**Pictures in a teacher's markdown** (`static/pictures.js`). Class
descriptions, a lesson's notes and an assignment's notes in the editor all
upload through `/api/image` (teachers only) and write `![name](/img/...)`
where the cursor was — Add picture, paste, or drop. The markdown holds an
address, never the picture, because notes go out whole on every live push.
In the editor paste/drop act only while the `.md` source is open; the same
CodeMirror holds `main.py`.

**The sprite panel writes the load line only** — no `add([...])`. Deciding
what to make and where to put it is the exercise. Pinned by a check in
`test_dungeon.py`, because it is the kind of convenience that creeps back.
(The kaypy-site playground keeps a diverging copy of `sprites.js` that still
writes the `add`. That is deliberate.)

**XP** (`xp.py`; "XP" in `app.py`; `static/xp.js`, `static/avatar.js`).
Students earn XP for questions the notes mark themselves (`XP_PER_POINT` a
point, part for part right), for answering every question in the notes, for
full marks on an assignment with an `xp_bonus`, from the teacher by hand
(`/teacher/class/<id>/xp`, negative takes it back), and for a program that
ran without an error. It makes levels, badges and tokens (one per `TOKEN_EVERY`, 1000 XP),
all worked out from the total and never stored; `users.tokens_used` is the
only token state, lowered by Use with a conditional UPDATE. **Nothing here
touches a grade** — the teacher trades tokens for points by hand.

One total per *person*, across every class and all four apps, so **`xp.py`
and `avatar.js` are shared like `accounts.py`**: change them here and copy
them to WebIDE and FlaskIDE — and `xp.py` to GameIDE's `backend/` too
(GameIDE is React, so it has its own avatar component, not avatar.js). XP is rows in `xp_awards`, never updated, and
the unique `(user_id, source)` is what stops anything paying twice — a
double click, two workers, a page sent twice. `xp.award` commits on its own
and is called *after* the thing it pays for is committed.

**The server cannot see a run.** The page posts a hash of its `.py` files
(never the code), and the server pays `RUN_XP` only after
`RUN_EVERY_SECONDS` of *working* time since the last paid run, never twice in
that much clock time, and only when the hash changed. Working time is
`session["busy"]`, counted in `_sign_out_idle_student` as `act` moves — one
`BUSY_STEP_SECONDS` at most per gap, and never for a GET to `/api/`, or an
open tab would earn by polling. A faked claim earns what a real one would,
which is the whole defence. A game reports when its setup has run, before
`_pyide_drive_game()`, because that await can stay pending after Stop.

A class's leaderboard (`_board`) shows its roster's signed-in students by
their whole XP, **first name and last initial only** (`xp.board_name`),
never an email, and not on the view-only link. Students can hide and still
earn. Their home page (`/classes`) shows all of it. An avatar is one
picture from `xp.AVATARS` — `static/avatars/<id>.webp`, painted portraits
the teacher made with Gemini, cropped square and shrunk to 400px — never an
upload or text, checked by `xp.clean_avatar` against the level that unlocks
it. Adding one is a file and a line in `AVATARS`, in all three repos;
`test_xp.py` fails on a picture without its file or a file without its
line. (A parts builder drawn in SVG came first and was replaced: it could
not reach the look the teacher wanted.)

**Rewards, penalties and random events** (`xp.BEHAVIORS`, `xp.EVENTS`; the
XP & tokens page). The teacher ticks students and picks a programming-themed
reason, or types one; a random event (Classcraft's, renamed for code) is
applied the moment it is drawn and shown big for the projector. **XP never
goes below 0** (`xp.penalty_for`): a penalty takes only what a student has.
An event's XP is `XpAward` rows sourced `event:<ClassEvent id>:<user id>`,
which is how Undo removes exactly those — the one place award rows are
deleted. The class page shows the last event for a day, a hidden student as
"A classmate"; `/me/xp` is a student's every award and its reason. Events
move XP only, never tokens, because tokens become real points.

**Every student in the class sees an event**, in the green popup on whatever
page they're on (`_event_news`, in `/api/me/xp/news` when the page sends
`events_after`; `eventText` in xp.js): "⭐ Glowing code review · Ana +10 XP",
"You" for themselves. It once reached only the students it gave XP to, so
for the rest an event set off in front of them never appeared. Students see
first names only (`xp.first_name`), there and on the class page; the
teacher's XP page keeps the initial, to tell two Anas apart. An event pops
up for `EVENT_NEWS_MINUTES` (30) — later than that, the class page has it.

**Quests** are assignments with an `xp_bonus` ("Quest reward" on the
assignment page), paid once on full marks. "Complete" is not stored: it is
that student having the `bonus:<assignment id>` award (`_quests_done`). The
class page marks quests, and a student's home page lists their open ones
(`_open_quests`: not hidden, archived or closed).

**Leaderboards** come in two sizes: a class's own, and — when its teacher
has more than one class here — all of that teacher's classes together
(`_all_classes_board`), so Programming 1 sees both Intro periods. A
student's home page shows the top five of each, plus their own row.

**Students' own photos need the teacher's approval first**
(`accounts.StudentPhoto`, `/photo/<slug>`). A waiting photo is served only
to its student and the teachers of their classes, never cached, and is on
no board; approving makes it their avatar (`"photo:<slug>"`), rejecting
deletes it. They are not `images`, because `/img/<slug>` serves anyone with
the address. The page crops and shrinks a photo to 400px before sending.
**An approved photo is served by every editor**, whichever one it was sent
in: an avatar is one per person across all four, and serving only this
app's photos made a photo approved elsewhere a broken picture on this app's
class pages. A waiting one, only by the app it was sent in.

**Tests: Check my work and Check all** (`autograde.py`,
`static/autograde.js`, "Tests" in `app.py`, `/help/questions#tests`). A
```` ```tests ```` block in an assignment's notes is checked against the
student's code, one test per line: output (`input 3, 4 -> prints 12`), a
function call (`area(3, 4) == 12`), or the code's shape (`uses for`,
`avoids sum`, `defines area`). **They run in a browser, never on the
server.** A student's Check my work runs in theirs — feedback, which could
be faked, so it is kept (`TestResult`, kind "self") for the teacher to see
and counts toward no grade. Each test it finds passing for the first time pays `SELF_TEST_XP` (2), once per test ever (`_self_tests_xp`, source `selftest:<assignment>:<label hash>`), and only for a label the notes really have, so a faked check takes at most that times the tests there are. The teacher's Check all runs every turned-in
snapshot in the TEACHER's browser and posts kind "verified", which is added
to the grade through `_earned` — every total goes through it, so Classroom,
Skyward, My work, the class page and quests all include it. Points are
summed from the lines posted, never a total a page claims. A verified result
older than the last turn-in is shown stale (⟳). autograde.js reads a block
exactly as autograde.py; `test_autograde.py` holds them together and runs
the tests in the real Pyodide. Each test the teacher's check finds passing also pays
`XP_PER_POINT` XP a point, once per test (`_tests_xp`, source
`test:<assignment>:<label hash>`), so checking again never pays twice and
fixed code is paid only for what now passes. That is on top of the small
amount a student's own check pays.

**Check my work happens in the notes** (`static/checks_in_notes.js`, the
same file in all three). A ```` ```tests ```` block is a card: each test a
line, ✓ or ✗ with why, and its own ✔ Check my work wherever the page has
registered a runner (`IDENotesChecks.setRunner` — the editor and the live
page; a lesson or class page has none, so its card is the plain list). The
card's button is the only Check my work: the one at the top of the editor
and the live page was taken out (Oct 2026) so students check beside the
step, and `test_checks_in_notes.py` fails if a page grows one back. Every
test runs
each time, never one card's, so the result kept for the teacher stays the
whole check. With **`locked: yes`** as a header line of the notes (beside
`theme:`/`animate:`, notes.js `takeHeader`), a slide with a card holds the
next slide until every check on it passes — in the student's own editor
only (slideView's `locked` option), never the teacher's preview or live. A
slide once passed stays open in that browser (`pyide-unlocked:<key>`).
`test_checks_in_notes.py` (the same in all three) runs the card and the
lock in node on a small fake DOM.

**The token shop** ("The token shop" in `app.py`; `accounts.ShopItem`,
`ShopRequest`; `/teacher/shop`). What tokens buy: one shop per teacher,
shared by their classes and all three editors (tokens are), stocked from
`xp.SHOP_STARTER` the first time it's opened — only then, so a teacher who
empties the shelf isn't restocked; items are taken off the shelf, never
deleted. A student asks from their home page; the request HOLDS its tokens
(`_tokens_free` = earned − used − held), so they can't ask for more than
they have. The teacher answers on the class's XP & tokens page: Approve
spends the tokens in one UPDATE conditional on them still being there,
Decline spends nothing. `test_shop.py` is the same file in all three.

**Editor themes** (`xp.EDITOR_THEMES`; the end of `style.css`). Looks
beyond light/dark: some free from a level (high contrast from level 1, for
whoever needs it), the rest sold in the teacher's shop as items with a
`theme` — bought at once, no request, since they only change the buyer's
own screen; owned for good (`users.themes_owned`). The chosen one
(`users.editor_theme`) is checked by `_user_theme` on every page and put on
`<html>` by each page's head script before the first paint, so a theme that
stops being theirs stops showing. Each theme is a `[data-theme]` block, a
`.cm-s-pyide-<id>` CodeMirror theme and a shop swatch, generated from one
palette; `test_editor_themes.py` (the same in all three) fails on a theme
missing any of them, since a missing block sells a theme that does nothing.

**The tutorial library is the ONLY place notes are edited** (`library.py`,
`templates/library.html`, `library_edit.html`, `static/library.js`,
`library.css` — the same files in all three; `library.py` and `accounts.py`
in GameIDE too). A tutorial (`accounts.LibraryItem`, table `library_items`)
is kept once and linked to any number of assignments
(`Assignment.tutorial_id`), so Period 2's and Period 5's copies can't drift
apart. **Write-through, not read-through:** saving a tutorial writes its text
into every linked assignment's notes file (`_write_notes`: `_notes_name`,
then `_store_quiz_keys`), so every exit to a student still reads
`Assignment.files` and redacts as it always did. Nothing else writes notes,
by the teacher's choice, to avoid collisions: the assignment page has a
read-only Tutorial box (Edit in library / Use another / Unlink), the lesson
page's notes are read only (`LESSON_T.readOnly`; `save_lesson` saves the
title only), and `update_assignment` keeps the stored notes whatever the
editor sends. `tutorial_id` NULL means the import (`library.import_existing`,
run when the library or an assignment page opens) hasn't taken it yet —
identical notes become ONE tutorial linked to all of them; 0 means unlinked
on purpose, its notes its own copy. New lessons and published projects get
their own tutorial at once (`library.adopt`), or every untouched lesson
starter would merge into one. Copies (`copy_assignment`, `duplicate_class`)
keep `tutorial_id` and `deck_id`. Bulk upload replaces a tutorial of the same
title (links kept, so the change reaches every assignment), base64 in JSON
for Render's firewall. `test_library.py` is the same in all three. The library's editor is PresMaker,
made web-based (`templates/presmaker.html` and `static/presmaker/`, both MADE
by `tools/sync_presmaker.py` from `~/presMaker/web` — change PresMaker, then
sync all three; never edit them here). It draws with this editor's own
notes.js, style.css and autograde.js. Teacher decks are library items too
(`Assignment.deck_id`): the old `teacher_decks` rows are taken in by the
import (`old_decks` hook) and only read after that; Upload / Replace teacher
lesson writes to the library (`library.set_deck`).

**The teacher's own slides** (`TeacherDeck` in `app.py`, table
`teacher_decks`; `teacher_deck`, `upload_teacher_deck`). One HTML file per
assignment that the teacher made elsewhere and presents from: Upload / Replace
teacher lesson at the top of the assignment's page, and a link that opens it
in a new tab at `/teacher/<slug>/slides`, and Download beside it for the
file as it is now (`?download=1`, under the name it was uploaded with). PyIDE's own table, not
`accounts.py`'s, so nothing has to be copied to the other repos. It is served
as uploaded, scripts and all, with the viewer's sign-in, so **only the teacher
who set the assignment can open it**. It is not sandboxed like `/img`,
because the decks keep their class list in localStorage and a sandboxed page
has none. The page sends it base64 in JSON, because Render's firewall blocks a
body full of `<script>` before the app sees it. `test_teacher_deck.py`.

**An assignment's notes follow the teacher's edits** (`_current_notes`,
`_keep_notes` in `app.py`). A draft copies the assignment's files, notes
included, but every page that shows a student their draft swaps in the
assignment's notes as they are now. Saving never writes notes into a draft:
the automatic turn-in compares the draft with what was handed in, so new notes
there would turn everyone's work in again over a typo. Every `.md` counts as
notes. `test_notes_follow.py` pins it.

**Signed out after two idle hours** (`_sign_out_idle_student` in `app.py`,
`templates/_idle.html`). Students only: signing a teacher out would end their
live lesson. Polls (any GET to `/api/`) must never count as activity, or an
open tab keeps itself signed in forever, which is the bug this exists for.
The page sends a beat to `/api/alive` at most every 5 minutes while it is
used, and gives up 2 minutes before the server does, so it always notices
first. A new page a student works on needs `{% include "_idle.html" %}`.
Time up, it goes straight to Google's sign-in and back to the page — no card.
Chrome reopens yesterday's tabs from its cache without asking the server, so
signed-in pages are `no-store`, the page GETs `/api/alive` (not activity) as
it opens and on focus, and an idle student opening a page is redirected to
`/login?next=` rather than shown it signed out.

**Attendance** (`accounts.Visit`, table `class_visits`;
`/teacher/class/<id>/attendance`). One row per sitting: made when a
signed-in student opens the class's page, one of its assignments or its live
lesson (`_attend`), kept open by the beat, and split by a 20-minute gap.
Times are UTC, and the page groups them into days in the teacher's browser.

**Slide themes** (`notes.js` `takeTheme`, `.slide-theme-*` in `style.css`).
`theme: <name>` as the notes' first line. Only a name from `THEMES`
becomes a class; style is never read from notes. The line is taken out
inside `slides()`, so no slide count can differ between teacher and student.

**The class pages look like GameIDE's** (`static/site_look.css`, the same
in all three). The teacher's and students' pages — dashboard, class,
assignment, XP & tokens, shop, attendance, material, a student's classes,
My work, their XP and avatar — load it after `style.css`; the editors never
do. It sets colours only for the default looks (no `data-theme`, or
`dark`/`light`), so **a student's bought theme still wins** there: a colour
written outright anywhere else in it would quietly paint over every theme
sold. `test_site_look.py` (the same in all three) fails on that, on a page
that stops loading it, and on an editor that starts.

**The week's calendar** (`static/calendar.js`, the same file in all three;
`Course.calendar`; `/api/class/<id>/calendar`). The teacher pastes one block
of text — `Monday:`, its to-do, `Tuesday:`, … — under Edit calendar on the
class page, and it shows as day cards under the banner on the students'
page. The text is stored as typed and parsed in the browser, so the format
can grow without touching a row. A line is a day only when the day's name
is followed by a colon, a spaced dash or nothing ("Friday quiz" is a to-do);
lines above the first day are the title. A dated day is "Today" only on its
date, so last week's calendar left up points at nothing. *Also post to*
saves the same week to the teacher's other classes in this editor, and one
that isn't theirs refuses the whole save. The calendar is not copied by
Duplicate class: a week is out of date by next semester. `test_calendar.py`
(the same in all three) runs calendar.js in node.

## Style

Comments explain *why*, especially where the reason is a bug that has already
happened once. Prefer a paragraph that saves the next person an afternoon
over a line that restates the code. When something fails silently, say so in
the comment — silent failure is the recurring theme of this codebase and
naming it is most of the defence.
