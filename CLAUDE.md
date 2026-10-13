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

**`node` is required**, by thirteen of these: `test_charts.py`, `test_dungeon.py`,
`test_export_runs.py`, `test_game_runtime.py`, `test_packages.py`, `test_pictures.py`,
`test_quiz.py`, `test_requests.py`, `test_rescue.py`,
`test_same_as_kaypy.py`, `test_sighint.py`, `test_syntax.py` and
`test_tabstops.py`. They run
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

## Style

Comments explain *why*, especially where the reason is a bug that has already
happened once. Prefer a paragraph that saves the next person an afternoon
over a line that restates the code. When something fails silently, say so in
the comment — silent failure is the recurring theme of this codebase and
naming it is most of the defence.
