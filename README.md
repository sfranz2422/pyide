# PyIDE

A browser-based Python editor for an intro programming class, with shareable
project links.

Student code runs **entirely in the student's browser** using Pyodide (CPython
3.14 compiled to WebAssembly). The server never executes student code, so there
is nothing to sandbox, no CPU cost per run, and a class of thirty can all hit
Run at once on Render's free tier without trouble.

---

## Accounts, saved work and turning in

Signing in is **optional and additive**. With no Google credentials set, the
site is exactly what it was: anonymous students open a link, write code, press
Run, share a snapshot. No sign-in button renders, `/login` isn't even a route,
and every link handed out before today still works. Verified as its own test,
because "the new feature quietly broke the old one" is the failure that matters
most here.

Signing in adds three things and takes nothing away.

**Work saves itself.** A signed-in student's project autosaves about a second
and a half after they stop typing, and again on the way out if they close the
tab. The state sits in the toolbar — `Saved 9:42 AM` — and goes red if a save
fails, because a student whose work isn't reaching the server needs to know
before they shut the lid, not after.

Autosave lives in the editor rather than on a home page on purpose: students
arrive from a link their teacher gave them and never see a front page, so a
"recent projects" list there would never be read. Their work is reachable from
the account menu in the bar they're already looking at.

**Assignments.** Open a project, get it how you want the class to find it, and
press **Publish**. You name it and get a link to hand out — the same workflow
as sharing, one button along. A student who opens it gets *their own copy*,
saved under their name. Opening it again a week later returns them to their own
work rather than starting them over, which is the whole point: losing the link
stops mattering.

A student who isn't signed in can still open an assignment link and do the
work. They just can't save it or turn it in, and a banner says so. Nobody is
locked out by a login that won't cooperate five minutes before the bell.

**You clicking your own handout link** opens the assignment to edit, not a copy
of it. That was not true at first, and the failure is a good example of the kind
worth hunting: the author got a student's draft of their own assignment, which
appeared in their project list looking like a duplicate, counted them among the
students who had started but not turned in, and accepted edits that reached
nobody — because students read the assignment, not somebody's draft of it.
Nothing errored. The URL changed from `/a/` to `/p/` and the page looked
exactly right. Add `?preview=1` to the link to get the student's view on
purpose; `tools/test_assignment_flow.py` checks all three cases, and checks
what each one left in the database rather than only where it redirected.

**Assignments stay editable.** Press **Edit** on the dashboard and it opens in
the editor with your notes unlocked, exactly as when you wrote them. Saving
changes what students get **when they open the link from now on** — anyone
already working keeps their own copy untouched, and the message tells you how
many that is so you know who needs telling.

An edit to the starter must never reach into work in progress, so it doesn't.
The trade is that a student who started before you fixed a typo still has the
typo; that is the right way round, but it is a thing to know.

**Turning in** freezes the work as an ordinary share snapshot and records it
against the assignment. Turning in again replaces it and says so. What you're
marking can't change under you while a student keeps tinkering — tested
explicitly: edit after submitting, and the submitted copy is unmoved.

The dashboard at `/teacher` lists your assignments with counts, and each one
shows who turned in, when, how many attempts, and a link to exactly what they
submitted — plus who has *started* but not turned in, which is the list you
actually want ten minutes before the end of a lesson.

### Setting up Google sign-in

Four environment variables, all in `render.yaml`:

| | |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from a Google Cloud OAuth client |
| `ALLOWED_EMAIL_DOMAINS` | who may sign in. **Leave it out entirely to allow any Google account** — that is the sane default. Set it only to restrict, e.g. `mohawk.k12.pa.us`, and note that doing so also shuts out personal Gmail. |
| `TEACHER_EMAILS` | full addresses that get Publish and the dashboard |

**Do not paste an example domain into `ALLOWED_EMAIL_DOMAINS`.** A placeholder
left in there refuses every real address, including yours, and the only symptom
is a refusal at sign-in. If you are not deliberately restricting, the variable
should not exist. The app prints what it is enforcing on every boot:

```
[pyide] Google sign-in: ON — any Google account (ALLOWED_EMAIL_DOMAINS is empty)
[pyide] teachers: sfranz@mohawk.k12.pa.us
```

Check that line in your Render logs after a deploy — it is faster than finding
out by failing a login.

In Google Cloud, create an OAuth 2.0 Web application client and set the
authorised redirect URI to `https://your-app.onrender.com/auth/callback`.

**Your district admin has to allowlist the app.** Google Workspace for
Education blocks under-18 accounts from third-party apps by default, and the
student just sees a "request access" message. Ask them to mark the OAuth client
trusted *including the sign-in scope*, or none of this works for students no
matter how correct the code is.

Two deliberate choices worth knowing:

- **Teachers come from an environment variable, not a database column.** There
  is no code path anywhere that can make someone a teacher. Changing who
  teaches is a deploy setting.
- **Identity hangs off Google's `sub`, not the email address.** A school can
  rename a mailbox; `sub` never changes and is never reused, so a renamed
  student keeps their work.

### The tables

`snippets` is untouched. Four new ones, named so they can't collide with
WebIDE's in the shared database:

| table | what it holds |
|---|---|
| `users` | one row per person who has ever signed in |
| `assignments` | a starter project you handed out, and its link |
| `drafts` | a student's living copy — this is what autosaves |
| `submissions` | what was turned in, pointing at a frozen snapshot |

A draft is found by *who you are plus which assignment*, not by a link, which
is what makes a lost link harmless. There is exactly one per student per
assignment, enforced by a unique constraint rather than by hoping.

## Deploying to Render

1. Push this folder to a GitHub repo.
2. In Render, choose **New → Blueprint** and point it at the repo. The included
   `render.yaml` creates the web service and a Postgres database, and wires
   `DATABASE_URL` between them.
3. Wait for the first deploy, then open the service URL.

If you'd rather set it up by hand instead of using the blueprint:

- **New → Web Service**, connect the repo
- Runtime: Python 3
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app --workers 2 --threads 4 --timeout 60`
- **New → Postgres**, then copy its Internal Connection String into an
  environment variable named `DATABASE_URL` on the web service

### Why Postgres and not SQLite

Render's free disk is wiped on every deploy and restart, so a SQLite file would
silently lose every share link. Postgres keeps them. Locally, with no
`DATABASE_URL` set, the app falls back to a SQLite file automatically — no
setup needed.

### Don't run this on the free tier

Two reasons, and the second is the serious one:

- Free web services sleep after 15 minutes idle and take ~30 seconds to wake,
  so the first student each period waits.
- **Free Postgres expires 30 days after creation**, with a 14-day grace period,
  after which Render deletes the database and everything in it. Free databases
  also get no backups. On the free tier every share link your students had
  submitted would stop working about six weeks into term, all at once, with no
  way to recover them.

Nothing in the app expires links — slugs are permanent and never reused. The
database is the only thing that can take them away, so keep it on a paid plan
if students are submitting work through it.

Two other things break existing links: renaming the Render service (a link
embeds the hostname it was shared from) and pointing the app at a different
database.

---

## Running it locally

```bash
pip install -r requirements.txt
python app.py
# open http://localhost:5000
```

---

## How students use it

**Write and run.** Type in the left pane, press **Run** or `Ctrl+Enter`. Output
appears on the right.

**`input()` is typed in the output pane**, on the line where the question was
asked, the way a terminal works:

```
--- Welcome to the Dungeon Realm ---
What is your character's name? Fred
A new hero approaches...
Fred
```

Students write plain `name = input("...")` — no `await`, nothing that differs
from the textbook. **Enter** answers, **Escape** or **Stop** cancels and ends
the program. Time spent thinking doesn't count against the fifteen-second
limit, so a student can take a minute to answer and still have the full limit
for the rest of the program.

<details>
<summary>Why this used to be a dialog box, and what changed</summary>

`input()` is synchronous and reading a keystroke is not, which for years left
`window.prompt()` as the only way to get a string from a student without making
them write `await`. WebAssembly stack switching removes the constraint:
`run_sync()` suspends the Python frame, the browser delivers the keystrokes,
and the frame resumes with the answer. Verified in Chrome 148 with Python
3.14.2 — plain synchronous Python, suspended two calls deep and resumed with
the typed value.

It needs a browser that supports stack switching and a program started through
`runPythonAsync` — a plain `runPython` call has no suspender on the stack to
switch to. Both are checked at the moment of the call rather than assumed, and
where either is missing it falls back to the old dialog. An older browser gets
a working IDE, not a hung one.

This is worth more than tidiness. Chrome offers "prevent this page from
creating additional dialogs" after a few prompts in a row, so a student with a
loop that asks four questions could tick it and watch their program silently
stop working. There's no such failure here.

**The catch, found by measuring rather than reasoning.** Python's output goes
to the pane through `write` rather than the more obvious `batched`, because a
batched stream only hands text over when it sees a newline — and
`sys.stdout.flush()` does not move it. So this:

```python
print("Your name? ", end="")
name = input()
```

stopped and waited for an answer while the question was still in the buffer,
and the student typed above a prompt that hadn't appeared. Taking the bytes raw
puts the timing back under Python's control.

</details>

**Share.** Fill in the project name and their own name, press **Share**, and
they get a link like `https://your-app.onrender.com/s/k3m9pqr`. The link is a
snapshot of the code at that moment — opening it is read-only, so nobody can
alter a submitted project. Anyone viewing it can still press Run, and can press
**Edit a copy** to fork it into their own editable version.

**A name is required to share.** Sharing without one turns the name box red and
stops — enforced on the server too, so it can't be skipped. The project name
stays optional and falls back to "Untitled". Forking clears the name, so a
student who opens your starter has to enter their own rather than submitting
under yours.

**Download** saves the file to disk if they want a local copy — one `.py` for a
one-file project, a zip when there's more than that, so a program and the
module it imports never get separated.

## More than one .py file

**+ File** and a name ending in `.py` adds a module, and `main.py` can import
it:

```python
# helper.py
def greet(name):
    return "Hello, " + name

# main.py
import helper
print(helper.greet("Fred"))
```

The project folder goes on `sys.path`, which is what makes this work —
`os.chdir` alone wouldn't, because Python searches `sys.path` and not the
working directory.

**Editing a module and pressing Run gets the new version.** That sounds
obvious and isn't: Python caches modules in `sys.modules` and will hand back
the one it imported ten minutes ago. Measured, both ways:

```
edit helper.py, run again, without clearing the cache -> "version ONE"
                                    after clearing it -> "version TWO"
```

A student changing a function and seeing no effect, with nothing in the output
to explain it, is about the worst debugging experience the IDE could offer. So
project modules are dropped from `sys.modules` before every run, in game mode
too. `__pycache__` is switched off for the same reason — a stale `.pyc`
outliving an edit is no better.

**Tracebacks name the file the error is actually in:**

```
Traceback (most recent call last):
  File "main.py", line 2, in <module>
    print(helper.divide(1, 0))
  File "helper.py", line 4, in divide
    return a / b
ZeroDivisionError: division by zero
```

Library frames are still filtered out; frames from the student's own files, in
any of them, are kept. A syntax error inside an imported module says which file
and which line rather than the raw `/project/` path. Demo links keep their
promise here too — line numbers, no source, in any file.

**A file named after a library gets a warning, not a ban.** `random.py` sits
ahead of the real `random` on `sys.path`, so `import random` quietly finds the
student's empty file and everything after it fails in a way that looks nothing
like the cause. Creating one says so; the name still works if that's genuinely
what they meant.

## Demo links — showing the output without showing the code

Tick **Hide code** before pressing Share and you get a link like
`/d/k3m9pqr` instead of `/s/k3m9pqr`. It opens a page with a Run button, the
output, and nothing else: no editor, no tabs, no notes, no fork, no download.
For a game project the canvas runs it exactly as it does in
the editor. Leave the box unticked and sharing behaves exactly as it always
has, so students hand work in the same way.

The dialog says which kind of link it just made, because an accidental tick is
otherwise invisible until someone opens it.

**Read this part before relying on it.** Pyodide runs Python *in the viewer's
browser*, so the program has to reach that browser to run at all. This is not
encryption and it cannot be. What it removes is every ordinary way of reading
the code:

| | Normal share | Demo link |
|---|---|---|
| Code in the page markup | yes, in the editor | no — the page never contains it |
| `Ctrl+U` / View Source | shows everything | shows nothing |
| `/raw` endpoint | plain text | 404 |
| Fork, Download | yes | absent |
| `/s/<slug>` for the same id | the project | 404 |
| Network panel, deliberately | — | one request, when Run is pressed |

Recovering the program means opening developer tools and going looking. That is
a different student from the one who presses `Ctrl+U` out of curiosity, and it
is the line a classroom actually needs — but it is a cupboard, not a safe.
Don't put anything in a demo link that would matter if a determined student
found it.

Two smaller details that follow from the same goal:

- **The source is fetched only when Run is pressed**, and kept after that, so
  running twice adds nothing further to the network log. Nothing is fetched at
  all if the viewer never presses Run.
- **Errors name the line but never quote it.** Normally a traceback prints the
  offending source line, which is most of what makes it useful to a beginner.
  On a demo link that would leak the code one line per crash, so it prints
  `File "main.py", line 12` and stops. Same for `SyntaxError`.

Changing `/d/abc123` to `/s/abc123` returns a 404. The refusal lives in the
route, not the template — the code never leaves the database for a hidden
snapshot, whatever the URL asks for.

**A hidden snapshot is hidden from you too.** There's no way back to the source
through the link, so keep your own copy. If you want both kinds of link for the
same project, share it twice.

### Code text size

The **− 14 +** stepper scales the editor and the output pane together, and
nothing else. Browser zoom (Cmd +) enlarges the toolbar and inputs along with
the code; this leaves the chrome alone, so a projected editor can run at 22 or
24 while the interface stays a normal size.

Steps are 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32. The size is remembered per
browser, so your projection machine keeps its setting without affecting anyone
else. It applies on shared projects too, so a student opening a link on a small
screen can size it to suit.

### Light and dark

The ☀/☾ button in the toolbar switches themes, and the choice sticks in that
browser. With no choice made the editor follows the computer's own light/dark
setting, so a machine set to light opens light.

Light mode is tuned for projecting: the blues, greens and reds are darker than
a typical light theme, and comment colour is overridden, because a projector
flattens contrast badly. Every text colour in both themes clears 5:1 against
its background — CodeMirror's stock themes don't (its dark comments sit at
2.1:1, near invisible on a screen at the back of a room).

### Name completion

After two characters, the editor suggests names **the student defined
themselves** — variables, loop targets, unpacked tuples, `with ... as` targets,
functions and their parameters, classes and imports. Tab or a click accepts;
Esc dismisses; Enter always makes a new line and never inserts a suggestion.

There are deliberately **no builtins and no signature help**. The point is to
kill `NameError` typos, not to write the program. A student still has to know
that `print` exists and what it takes.

The list comes from Python's own `ast` module parsing their code — nothing is
executed to produce it, and it works before the program has ever run. Because
`ast` needs valid syntax and half-typed code isn't, the last successful parse
is kept, so suggestions don't vanish mid-keystroke.

Completion is offered on `main.py` only: a `.txt` data file and a `.md` notes
file aren't Python.

### Editor keys

| Key | What it does |
|---|---|
| `Ctrl+Enter` / `Cmd+Enter` | Run |
| `Tab` | Indent four spaces, or indent the whole selection |
| `Shift+Tab` | Outdent the line or selection |
| `Ctrl+/` / `Cmd+/` | Comment or uncomment the selected lines |
| `Tab` (suggestions open) | Accept the highlighted name |
| `Esc` | Dismiss suggestions |

Commenting keeps the `#` at the code's own indentation rather than pushing it
to column 0, so an indented block still reads as Python. Pressing it again
restores the lines exactly. In a `.txt` data file it does nothing, since there
is no comment syntax to apply.

### For grading

Have students paste their share link into your LMS. Add `/raw` to any share URL
to get the plain source, which is handy for diffing or feeding to a checker:

```
https://your-app.onrender.com/s/k3m9pqr/raw
```

---

## File handling

Tabs above the editor hold the project's files. `main.py` is the program;
every other tab is a data file it can `open()`.

**+ File** adds one. Name it with an extension (`scores.txt`, `names.csv`) and
type the contents straight into the editor. Before each run the files are
written into Python's filesystem, so this works with no setup:

```python
with open("scores.txt") as f:
    for line in f:
        name, score = line.strip().split(",")
        print(name, "scored", score)
```

**Files the program writes appear as new tabs.** After a run the editor checks
the folder again, so `open("report.txt", "w")` produces a `report.txt` tab the
student can open and read. That's the part that makes writing files feel real
rather than theoretical — the output pane even says which files appeared.

Files travel with the share link, so a starter project can ship its data. Make
the project, attach the file, press Share, and hand out the link: students fork
it and the data is already there. `examples/04_read_a_file/` is a worked
version — paste `main.py` in, add a `scores.txt` tab with that content, and
share it.

Some details worth knowing:

- Files live in the browser only and vanish on reload unless the project was
  shared. Tell students to share before they close the tab.
- `.py` files other than `main.py` aren't allowed — there is exactly one thing
  that runs, which avoids a lot of confusion about imports.
- A file the program writes as binary (an image, say) is skipped rather than
  shown as garbled text.
- Games can read and write files too; sprites and data files coexist.
- Twelve files per project, 100 KB each.

## Class notes in a share link

A `.md` file in a project is class notes. It doesn't open as text — it renders
in the right pane, so a share link carries the assignment instructions along
with the starter code and its data.

**Students never see the markdown source.** The tab shows the rendered notes,
there's no editor for it and no way to delete it. Only the authoring view (a
new project at `/`) gets an **Edit source** button, with live preview as you
type. To revise notes, author a new project and share a new link — the same way
you already update a starter.

**A shared link opens on the notes tab**, not on `main.py`, so the instructions
are the first thing a student sees.

`examples/05_assignment_with_notes/` is a worked example: notes, starter code
with TODOs, and the data file.

### Students can't copy out of the notes

Code in an assignment can't be selected, so it can't be pasted into the editor.
Typing it out is most of the exercise. Verified in Chrome — a select-all picks
up the rest of the page and skips the notes entirely, and a copy carries
nothing from them:

```
Ctrl+A captured:        "OTHER_PAGE_TEXT"
includes the notes:     false
a copy would carry it:  false
```

Done by preventing selection rather than by policing paste. A paste filter
would have to guess where text came from, and would block a student who typed
your starter code correctly and then copied their own line — which is the
worst possible false positive, since it punishes the one doing the work. This
approach has no such failure.

Two deliberate exceptions:

- **Links stay selectable**, so a URL in an assignment can still be copied out.
- **Not while authoring.** At `/` the notes are yours and fully selectable.
  Every view a student sees — a share, a fork — is covered.

It's a speed bump, not a lock: developer tools will still show the text. Same
bargain as a demo link, and it closes the path a student would actually take.
Copy and paste inside the editor is untouched, and WebIDE is unchanged.

### What's allowed in notes

Ordinary markdown — headings, lists, tables, code blocks, blockquotes, links —
plus images by URL:

```markdown
![the loop diagram](https://your-site.example/loop.png)
```

Images must be `https://` (a browser blocks `http://` on an https page as mixed
content), and hosts that don't allow hotlinking — Google Drive, Dropbox share
pages — won't serve them. Links open in a new tab so nobody loses their work.

### Why it's sanitized

Notes are the only place stored content becomes HTML rather than text, so it's
the only place script injection is possible — and students can write `.md`
files too, then share them on to each other. Everything is run through
DOMPurify before it reaches the page, which strips `<script>`, event handlers
like `onerror`, `javascript:` links, and `<iframe>`.

Two extras are blocked on top of DOMPurify's defaults, both verified against
real payloads: **forms** (a convincing fake "school login" posting elsewhere)
and the **`style` attribute** (`position:fixed` can cover the whole editor).
Neither has any use in class notes. Dropping `FORBID_ATTR` in `static/notes.js`
brings inline CSS back if you ever want it.

## Games, in Python, on kaypy

Students write games in Python, and the engine underneath is Python too.
**kaypy** ([PyPI](https://pypi.org/project/kaypy/),
[source](https://github.com/sfranz2422/kaypy)) is a Kaplay-shaped game engine
built on pygame-ce. There is no JavaScript in a game any more and nothing
crosses a language boundary.

```python
from kaplay import *

kaypy(width=800, height=600, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")
setGravity(1600)

player = add([sprite("bean"), pos(100, 200), area(), body(jumpForce=800), "player"])


@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(800)


onUpdate("enemy", lambda e: e.move(-120, 0))
```

**The names are Kaplay's own, camelCase and all.** That is deliberate, and it
is the whole point: every Kaplay tutorial, example and forum answer on the
internet applies to what a student writes here, with the punctuation changed.
A snake_case wrapper would look more like Python and leave the class with no
documentation in the world. `kaypy({ width: 800 })` becomes
`kaypy(width=800)`; everything else is the same call in the same order.

**+ Game** in the toolbar starts a project with the import already there.

**The same file runs off the website.** `pip install kaypy`, and the game a
student wrote in this editor runs with `python game.py` on their own machine —
same engine, same version, no export step. `kaypy web game.py` builds it into a
standalone web page. That is the thing the JavaScript version could never do,
and it is worth more than everything below.

### How it works

Pyodide loads **pygame-ce** from its own package set (a compiled C extension,
so it cannot come from PyPI), and `static/game.js` writes the vendored kaypy
package into Pyodide's filesystem as real files. Then `import kaplay` is an
ordinary import, and a traceback through the engine names `kaplay/engine.py`
and a line number that exists.

kaypy's frame loop is already an `async` coroutine that yields with
`await asyncio.sleep(0)`, and it already takes its `sys.platform ==
"emscripten"` branch here, because that is what Pyodide reports. The browser
was a target it already knew about — it is the same platform pygbag builds for.

**The engine is vendored, not installed at runtime.** `tools/vendor_kaypy.py`
copies it out of a working copy and writes `static/py/kaplay_bundle.json`: one
file, ~120 KB, cached like any other static asset. The reasons are in that
script's docstring, and the short version is that a class starts all at once —
twenty students running `micropip.install("kaypy")` at 8:05 would pull about
27 MB from PyPI, most of it a sound file the browser never opens. Checking for
a new release happens on the server instead, once a day, and shows up on the
teacher dashboard.

Vendoring from a working copy rather than from PyPI is also deliberate: fix
something in `~/kaypy`, run the script, press Run — before publishing anything.

**Mode is detected by the import.** `from kaplay import *` or `import kaplay`
at the top level means this is a game; anything else is a console program.
That is a firmer signal than Pygame Zero's, which was recognised by defining
`draw()` or `update()` — something an ordinary program could trip over.

### The JavaScript bridge, and why it is gone

Before this, games ran on Kaplay, the JavaScript library, and about 480 lines
of `static/py/kaplay.py` marshalled every call across the boundary. It worked.
It is also where the four worst bugs this project has had came from, and they
share a shape worth remembering:

| what went wrong at the seam | how it showed up |
|---|---|
| a callback arrived as a borrowed proxy, freed too early | `This borrowed proxy was automatically destroyed…`, one frame later |
| a tile factory returned a Python list | `'list' object has no attribute 'parent'`, naming neither the tile nor the level |
| a lambda's arity did not match what Kaplay passed it | `TypeError` on the first keypress, in a callback nobody was watching |
| `tween()` came back as a Promise | `.cancel()` cancelled nothing, silently, for ever |

Every one of them is silent or misattributed, and every one of them is
impossible now, because there is no boundary to arrive across. The bridge is
deleted.

Two other bridge-era problems went with it. Kaplay's sprite loader prepended
the load root only to a string, so `loadSprite("dino", [...])` fetched every
frame relative to the page — a 404 and a blank canvas, from code that worked
with a single path. And `anchor()` fell through to `default: return t`, so
`anchor(center())` drew a sprite five thousand pixels off screen with no error
at all. kaypy has neither behaviour.

What has *not* changed is the one genuinely good idea in that bridge: a
callback is called with as many arguments as it will accept, and the rest are
dropped, exactly as JavaScript does. `lambda: player.move(-300, 0)` works when
Kaplay would hand it a key. That lives in kaypy's `callutil.call_flexible` now,
and it is why Kaplay's documentation still translates line for line.

### What came back with SDL: the keyboard

pygame draws through SDL, and under Emscripten SDL takes the keyboard by
putting `keydown`, `keyup` and `keypress` listeners on `document` — and never
takes them off. After Stop they are still there, still swallowing keystrokes
meant for the editor. A student presses Stop and cannot type.

This is not a new problem; PyIDE hit it under Pygame Zero and needed a
workaround then. Kaplay never had it, because a JavaScript library listens on
the element it was given. Coming back to SDL brings it back.

`game.js` wraps `document.addEventListener` **before pygame-ce is ever
loaded** — one that is never seen going on cannot be taken off — and lifts
SDL's listeners off while no game is running, putting them back on the next
Run. Two details that are easy to get wrong and are held down by tests:

- **The capture is bounded to the game window.** PyIDE listens on `document`
  too: Ctrl+Enter runs, Escape stops, Escape closes the account menu. Those go
  on at page load, before any game, so they happen not to be caught — but "it
  happens not to" is not a property worth relying on, and the day someone adds
  a shortcut from a click handler, Stop would take Ctrl+Enter with it.
- **Putting them back does not go through the wrapper.** Re-registering
  through it re-tracks them, so the list grows by three on every Run. A
  browser hides that completely, since the DOM ignores a listener added twice
  with the same type and function.

It did not reproduce in every browser — five Run/Stop cycles in one Chromium
build typed fine — which is the worst kind of bug to leave alone: it works on
the machine you test on and not on the one in the classroom.

### Checking it still works

```bash
python3 tools/test_game_runtime.py        # the engine, the bundle, the starter
python3 tools/test_guide.py               # every lesson in the guide, played
node    tools/test_run_stop_cycle.mjs     # Run -> Stop -> Run, and the keyboard
```

The first two run the real kaypy, imported out of the bundle the browser
actually downloads, with SDL on its dummy driver. `test_guide.py` does not
merely execute each lesson: it plays it — holding down every key the lesson
registered a handler for, clicking, building every scene, and running the
timers out — because calling a handler by hand proves its body works and
proves nothing about whether it is reachable.

What none of them can do is tell you the game looks right. SDL drawing to a
canvas needs a browser; that is confirmed by hand with kaypy's own
`tools/smoke_pyodide.html`.

### Sprites

Two packs are bundled, 202 sprites in all, available by name with no setup. The
**Sprites** button opens a searchable panel — the search covers both packs at
once — and clicking a sprite drops the two lines Kaplay needs:

```python
loadSprite("bean", "images/bean.png")
add([sprite("bean"), pos(100, 100)])
```

Two lines rather than one because Kaplay has to load a sprite before it can be
used, and forgetting the load is the commonest way a sprite silently fails to
appear. The sound chips insert `loadSound(...)` and `play(...)` for the same
reason.

**How a path becomes a file.** kaypy opens assets the way any Python program
does — `pygame.image.load("images/bean.png")` — so the file has to exist before
the program runs. `game.js` reads the source, picks out every asset path it
names, fetches just those from `/static/assets/` and writes them into Pyodide's
filesystem under the game's working directory. Only the ones actually
mentioned: the two packs and the sounds come to about 5 MB together and nobody's
game uses all of them.

A path that is mentioned but missing is deliberately left alone, so the game
fails the way it would anywhere else — kaypy raises a `FileNotFoundError`
naming the path, which is a better error than anything invented here.

**Kaplay pack** — 60 sprites from the KAPLAY game library, `images/`.

**Dungeon pack** — 142 sprites from 0x72's DungeonTileset II, `dungeon/`, public
domain. 42 of them animate: knights, elves, orcs, zombies, a wizard, chests,
torches, coins. Each animated entry is a single horizontal strip carrying all of
that character's animations end to end, so clicking one inserts the sliceX/anims
form instead:

```python
loadSprite("elf_m", "dungeon/elf_m.png",
            sliceX=8, anims={
    "idle": {"from": 0, "to": 3, "speed": 8, "loop": True},
    "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
})
add([sprite("elf_m", anim="idle"), pos(100, 100)])
```

That is the form Kaplay's own documentation uses, and it is legible: a student
can change a speed, turn off a loop, or call `.play("run")` from a key handler
without being told how. The alternative — `loadSprite` with a list of eight
paths — works, but is a line nobody can read, and exports to eight inlined
images instead of one.

Cells in the panel show the first frame only, through a window the width of one
frame, so an eight-frame strip looks like a character rather than a filmstrip.
A ▶ in the corner marks the ones that animate; the tooltip names the animations.

Two names exist in both packs, so the dungeon versions are `dungeon_coin` and
`dungeon_bomb` — one sprite per name, and a student who loaded both would
otherwise get whichever came second, with no error to explain it.

**The atlas is a third source of names in that same namespace**, which took a
while to notice: its `ogre` region collided with the pack's `ogre`, so loading
`dungeon/ogre.png` (eight frames, `idle` and `run`) and then the atlas — which
is exactly what Lesson 12 does — replaced it with the atlas's four-frame ogre,
and `play("run")` stopped working with nothing pointing at the line that broke
it. The pack's is now `dungeon_ogre`; the atlas keeps its names because they
are the ones Kaplay's published example uses and the guide teaches.
`tools/vendor_dungeon.py` now takes the atlas's region names into account when
it renames, and `tools/test_dungeon.py` checks all three sources against each
other so no new clash creeps in.

**The atlas** — `dungeon.png`, the same dungeon artwork as one uncut 512×512
image, at the root of `assets/` so that `loadSpriteAtlas("dungeon.png", ...)`
works with the path Kaplay's example and the course site both use. Clicking it
inserts all five named regions.

It is kept alongside the cut-up pack deliberately. The pack is quicker and
cannot be got wrong; the atlas is the lesson — where sprites come from, and how
four numbers turn part of an image into a named sprite. Two of the five
coordinates Kaplay publishes are wrong for this file (`ogre` is 16 pixels high,
`chest` points at empty space) and neither raises an error, which is a better
argument for teaching it than anything in the lesson text.
`tools/vendor_atlas.py` holds the corrected values and checks them.

The button only appears in game mode, so it stays out of the way during console
work. A student who wants to browse sprites before writing any game code can
click the mode chip to lock the editor into Game mode.

`dino` is a nine-frame walk cycle in the original artwork, so the build script
slices it into `dino_0` through `dino_8`. Flipping between those frames is how
`examples/03_dino_run.py` animates. See `static/assets/CREDITS.md` for the
license.

### Adding sprites or sounds

Point the build script at any folder on your computer — it doesn't have to be
inside the project:

```bash
# both at once
python tools/build_assets.py --sprites ~/Desktop/sprites --sounds ~/Desktop/sounds

# just the sounds; the sprites already built are left alone
python tools/build_assets.py --sounds ~/Desktop/sounds
```

Whichever category you leave out is carried over unchanged, so updating sounds
never disturbs the sprites — and neither ever disturbs the dungeon pack, which
`tools/vendor_dungeon.py` writes under its own key in the same manifest.

Pointing it at `static/assets/sounds` itself is fine — it re-indexes in place
rather than trying to copy files onto themselves.

Two rules the script enforces, reporting anything it skips:

- **Format.** Images are png/gif/jpg/jpeg/bmp. **Sounds must be `.wav`.** The
  browser build of SDL_mixer (2.8.0) has no Vorbis decoder, so an `.ogg` is
  found but fails with "Unrecognized audio format" the moment it plays. To
  convert: `ffmpeg -i jump.mp3 jump.wav`
- **Name.** Filenames must be valid Python names — letters, digits and
  underscores, starting with a letter — because student code reaches them as
  `sounds.jump.play()`. `laser-2.wav` and `3beep.wav` won't work; `laser_2.wav`
  and `beep3.wav` will.

### Keeping the bundle small

Every bundled asset is downloaded by each student's browser on the first game
run, so the build script prints the running total and flags anything over 1 MB.

WAV is uncompressed and long music tracks get very large — a 108-second track at
44.1 kHz is 9.3 MB on its own. Since `.ogg` isn't an option, shrink the WAV:

```bash
# halves it, and at classroom volume the difference is hard to hear
ffmpeg -i background.wav -ar 22050 -ac 1 -c:a pcm_s16le background_small.wav

# eighth the size, fine for background music, audibly rougher for effects
ffmpeg -i background.wav -ar 11025 -ac 1 -c:a pcm_u8 background_small.wav
```

Short effects are already small — all 22 of ours together come to well under
1 MB.

Sounds appear in the editor's Sprites panel and play with
`sounds.<name>.play()`. Browsers block audio until the student has interacted
with the page — since they must click the canvas anyway, this rarely bites, but
it explains any silent first run.

To slice a new spritesheet into frames, add it to the `SHEETS` dictionary at the
top of `tools/build_assets.py` with its frame count.

## Classroom behavior worth knowing

- **Runaway loops stop themselves.** A line-tracing guard raises after 15
  seconds and prints "Is there a loop that never ends?" instead of freezing the
  tab. Change `TIME_LIMIT_SECONDS` at the top of `static/app.js` to adjust.
- **Errors are beginner-readable.** Tracebacks are trimmed to the student's own
  code and quote the offending line, so `main.py`, line 4 points at their line 4.
  Syntax errors print a single plain sentence rather than a traceback.
- **Each run starts clean.** Variables from the previous run don't carry over,
  which avoids the classic "it works until you reload" confusion.
- **First load takes a few seconds.** Pyodide is about 10 MB and is cached by
  the browser afterward. Warn students on day one so nobody thinks it's broken.
- **Packages.** The standard library is all there. `numpy`, `pandas`, and
  `matplotlib` load automatically if imported. Arbitrary `pip` packages are not
  available.
- **No autosave.** Closing the tab loses unshared work. Tell students to Share
  or Save .py before they close. If you want autosave later, it's a few lines
  of `localStorage` in `static/app.js`.

---

## Files

```
app.py                  Flask app: pages, share API, database
render.yaml             Render blueprint (web service + Postgres)
requirements.txt        Python dependencies
templates/
  index.html            The editor page, editable and read-only modes
  demo.html             A "hide my code" link: Run and the output, nothing else
  404.html              Bad share link
static/
  app.js                Editor, sprite panel, sharing
  runtime.js            Python bootstrap, output piping and the input line —
                        shared by the editor and demo pages
  zip.js                Dependency-free ZIP writer (multi-file downloads)
  demo.js               The demo page: fetch on Run, run, show the output
  game.js               kaypy: loads pygame-ce, unpacks the engine, the canvas,
                        the assets, and the keyboard
  export.js             Exports a game as one self-contained playable .html
  py/kaplay/            The vendored kaypy engine (generated), including
                        web_page.html — the page Download fills in
  py/kaplay_bundle.json The same thing as one file, which is what the browser
                        downloads (generated)
  py/kaypy.json         Which kaypy version is vendored, and from where
  sprites.js            The Python a Sprites-panel click inserts
  notes.js              Markdown notes: render, sanitize
  complete.js           Name completion from Python's ast
  style.css             All styling
  assets/
    manifest.json       Generated — what the sprite panel reads
    images/             60 sprite PNGs (KAPLAY, MIT)
    dungeon/            142 sprite PNGs (0x72 DungeonTileset II, CC0)
    dungeon.png         The same artwork uncut, for loadSpriteAtlas
    sounds/             23 sound effects (.wav only)
    CREDITS.md          Sprite licensing
tools/
  build_assets.py       Regenerates static/assets from source folders
  vendor_dungeon.py     Composites the dungeon pack's 370 frames into strips
  vendor_atlas.py       Brings in a sprite atlas and checks its regions
  vendor_kaypy.py       Copies the kaypy engine in and bundles it for the browser
  test_assignment_flow.py  Who gets what from /a/<slug>, in both editors
docs/                   The student walkthroughs — see docs/README.md.
                        Two of the four are Pygame-Zero-era and no longer run.
examples/               file-handling and notes starters
```

`runtime.js` exists because two pages need the same Python: the `input()` shim,
the runaway-loop guard, and the traceback filtering. Keeping one copy is what
stops the editor and a demo link from slowly disagreeing about how a program
behaves. The output piping lives there too, because the raw-`write` decision
and the `flush()` in `input()` are two halves of one fix and would be a puzzle
apart.

## Still to do

### End-of-year cleanup

Archiving hides an assignment and keeps everything, which is right during the
year and wrong by about August. There should be a way to delete archived
assignments outright and take their contents with them.

Deleting one archived assignment should remove, in this order:

1. every `submissions` row for it
2. the `snippets` rows those submissions point at — the frozen copies of
   handed-in work, which exist only because someone pressed Turn in
3. every `drafts` row for it — students' working copies
4. the assignment itself

That is the opposite of what `DELETE /api/assignment/<slug>` does today, which
deliberately *detaches* student drafts rather than deleting them and refuses
outright if anyone has turned work in. Both behaviours are wanted; they are
just for different times of year. Keep them as separate routes rather than
adding a flag, so a stray click can never reach the destructive one.

Worth building alongside it:

- **Say what will be destroyed before doing it.** "12 submissions from 12
  students, 18 saved projects." A count is the difference between a decision
  and a reflex.
- **Only archived assignments.** Archiving first is the deliberate pause.
- **Offer a zip of everything first.** A teacher clearing a year probably
  wants one download containing every submission before it goes.
- **Warn students in advance.** They can already download a project, but only
  one at a time from the account menu, and only if they know it is coming. A
  "these projects will be removed after <date>" banner and a download-all
  button would make "you had all summer" a fair thing to say.

Deleting student work at the end of a year is also good practice rather than
merely tidy: it keeps the amount of student data on the server proportional to
the reason for holding it.

## Download: a game comes back playable

A game downloads as **one `.html` file**. Double-click it and it plays — no
Python installed, no server started, nothing unzipped. Inside are the student's
program, the kaypy engine, and every sprite and sound the program actually
loads; only Pyodide and pygame-ce come from a CDN.

**The page is kaypy's, not this repo's.** `export.js` writes no HTML at all: it
fills in `web_page.html`, carried in the vendored engine bundle — the same
template, byte for byte, that `kaypy web game.py` fills in on a desktop. So a
student can write a game here, download it, and later `pip install kaypy` and
build the same game at home, and get the same page: same boot sequence, same
error reporting, same everything.

That is worth the indirection because two exporters that merely agreed today
would drift apart by Christmas — one would gain a fix the other never heard
about, and the difference would surface as "it works in school but not on my
laptop", which is the worst bug report a fourteen-year-old can be asked to
write. `tools/test_same_as_kaypy.py` builds one game both ways and compares
the results line by line.

**The program goes in unchanged**, and that is the one real difference from the
JavaScript exporter this replaced. That one had to find every asset path in the
source and swap it for a `data:` URI, because Kaplay fetched assets over HTTP
and a `file://` page can fetch nothing — so the program inside a downloaded
game was not quite the program the student wrote. kaypy opens assets as
ordinary files, so the fix is to put the file where the program says it is: the
assets are decoded into Pyodide's filesystem at exactly the paths the program
names, before it runs. `loadSprite("bean", "images/bean.png")` means the same
thing in a downloaded game as in the editor, on a desktop, and in the guide.

The caveat: **the first run of an exported game needs the internet**, and takes
several seconds while Python and pygame-ce load. The browser caches both
afterwards. Embedding them would make every export tens of megabytes, which is
fine for one showcase game and absurd for a class set — and pygame-ce could not
be embedded another way in any case, being a compiled C extension that has to
be Pyodide's own build. A two-sprite, one-sound game exports at about 420 KB.

**Why one file and not a folder.** A folder opened from disk is a `file://`
page, and browsers refuse to fetch anything next to it — no images, no sounds,
and WebGL will not build a texture from a local file even when the image does
load. A zip would therefore need a local web server to be any use, which is
exactly the obstacle this removes. With everything inlined there is nothing
left to fetch, so `file://` stops mattering.

Console programs are unchanged: one file downloads as `.py`, a project with
imports or data files as a `.zip`.

### Putting a game on itch.io

The exported file meets itch.io's requirements as it stands, and needs no zip:
*"For simple projects that are self contained in a single `.html` file, you
directly upload the file without zipping it."* Set **Kind of project** to
*HTML*, upload the `.html`, tick *This file will be played in the browser*.

Their two relevant rules, both already satisfied:

- **Anything loaded from another domain must be HTTPS.** The only external
  domain is `https://cdn.jsdelivr.net`, which serves Pyodide and — fetched by
  Pyodide itself at run time, so it appears in no `src` attribute — pygame-ce.
  External resources are allowed; insecure ones are not.
- **No absolute paths**, which would leave the project's directory on their CDN
  and return 403. The exported page fetches no asset at all: every sprite and
  sound is carried as base64 inside the document and decoded into Pyodide's own
  filesystem before the game runs, so the only URL in the whole file is
  Pyodide's. The paths the student's program uses — `images/bean.png` — are
  paths inside that filesystem and never reach the network.

Size is a non-issue — itch allows 200 MB for a single file and a small game
exports at about half a megabyte.

```bash
node tools/test_export.mjs
```

Two files, and neither covers the other.

`test_export.mjs` builds an export with a stub `fetch` reading from `static/`
and then reads it: one document, the engine and the bootstrap inlined, the
program carried unchanged, exactly the named assets carried and the unused ones
left behind, Pyodide the only external reference, the setup and the frame loop
run as two steps with the loop awaited, and nothing inside a `<script>` block
able to end it early. Forty-four checks.

`test_export_runs.py` takes the same built page apart and **runs what is inside
it**: the engine it carries is unpacked and imported, the assets it carries are
written where the page says it writes them, and the program is run by the same
two calls — kaypy's own `webrun.run()` and `webrun.drive()`, out of the engine
the page carried rather than out of this repo, on real pygame-ce against real
sprite and sound files. It ends by checking that a sprite which was *not*
carried fails loudly and by name, rather than leaving a blank screen.

`test_same_as_kaypy.py` builds the same game with both exporters and compares
them. Everything except the three values that are the game itself — the
engine, the assets and the program — must match exactly, and does: the pages
come out byte-identical. It skips rather than fails when there is no kaypy
checkout to compare against.

The split is deliberate and each half has a hole the other fills. Move the
assets one directory away and both fail. Delete the `await` in front of the
frame loop and only the static one notices, because the replay makes the two
calls itself. Neither can tell you the game is visible; that needs a browser.

An exported game is the one thing here that nobody watches fail — it is
downloaded, taken home, and opened on a machine with no console open and nobody
to ask — which is why it gets two tests rather than one.

### Run, Stop, Run

```bash
node tools/test_run_stop_cycle.mjs
```

The cycle a student repeats all lesson, and the one that has now hidden three
separate bugs — each of which let the first game run perfectly and broke the
second, which is the worst possible shape for a bug in a classroom.

**The keyboard.** SDL's `document` listeners outlive the game, so Stop leaves
the editor unable to type. The mechanism and the two subtleties in the fix are
described under *What came back with SDL*, above; this file is what holds them
down. Three cycles, and after each one the test asks whether the editor can
type — plus a Stop pressed twice, a Run pressed while already running, and a
keyboard shortcut registered after a Run, which must survive the next Stop.

**A canvas is never reused.** This carries over from the Kaplay days, where
`quit()` called `WEBGL_lose_context.loseContext()` and a canvas whose context
had been deliberately lost could never hand out a working one again — the
second game ran, drew to nothing, and looked like it had not started. SDL has
no context to lose, so that exact failure is gone, but SDL does keep state
about the surface it was given, and a second game on a used canvas is the kind
of thing that works in one browser and not another. A fresh element costs
nothing. The id must be exactly `"canvas"` and it must be handed over with
`pyodide.canvas.setCanvas2D`, or the `pygame.display.set_mode()` inside
`kaypy()` fails.

**Stopping does not tear anything down.** kaypy's loop checks `_running` once
a frame, so clearing it lets `run_async()` return normally and the `await` in
`app.js` resolves. Nothing is killed mid-frame — and because there is no WebGL
context to lose, the last frame stays on screen instead of the picture going
white, which is what used to happen.

### Tweens

Tweens are kaypy's now, and so are their tests:

```bash
cd ~/kaypy && python3 tests/test_tween.py
```

They are worth a note here anyway, because the bug they were written for was a
bridge bug and is a good example of what that seam did. Kaplay's tween
controller carries a `then` method so JavaScript can write
`tween(...).then(...)`. **Pyodide converts any object with a `then` into a
`PyodideFuture`**, so what arrived in Python was a Future and the controller
was gone:

```python
slide = tween(0, 400, 1.0, move_it)
slide.cancel()          # cancelled a Future. The tween carried on regardless.
```

Nothing raised. The tween ran to the end while the code that cancelled it
believed otherwise — invisible to any test that only asks whether an error was
thrown. It needed a JavaScript trampoline that rebuilt the result without
`then`, and a `Controller` class to put `.then()` back on the Python side.

All of that is deleted. `tween()` returns a `Tween`, which is an ordinary
Python object, and `.cancel()` cancels it.

### Checking the sprite packs

```bash
python3 tools/test_dungeon.py
```

1,315 checks over both packs and the atlas. Three things can go wrong between a
folder of pictures and a student's screen, and not one of them announces itself:

- the manifest names a file that isn't there — the loader fails quietly and the
  character never appears;
- `sliceX` disagrees with the picture — the strip is cut on the wrong
  boundaries, so every frame is half one pose and half the next, which looks
  like an animation bug rather than a data bug;
- an `anims` range runs past the end of the strip.

So it reads each PNG's IHDR header directly, checks the dimensions agree with
the manifest, and then runs the exact line the panel inserts — all 202 of them
plus the atlas, in one program — through the real bridge against a stand-in
engine that re-checks the arithmetic from the inside. It imports
`static/sprites.js` rather than restating what the panel does, which is why that
file exists on its own.

The atlas gets the same treatment, one level deeper: every region rectangle
checked against the image's real size, every `anims` range against its frame
count, and the whole nested dict compared after its round trip through Python.
What it cannot check is whether a region holds the *right* sprite —
`tools/vendor_atlas.py --proof` writes a picture of all five for a human.

The strips themselves were checked once, differently: 270 frames compared
pixel-for-pixel against the original download. All matched. (The pack numbers
one zombie's frames `f1, f2, f3, f10`, which sorts correctly by number and
looked wrong only to a checker that assumed they started at zero.)

### Checking a guide's code actually runs

```bash
python3 tools/test_guide.py                    # ../learn_pykaplay.md
python3 tools/test_guide.py ../some_other.md   # or any markdown file
```

Every fenced ```python block that imports *and* calls `kaplay` is a whole
lesson. Each one is executed the way pressing Run executes it — and then
**played**: every key the lesson registered a handler for is held down and
released, the mouse is clicked, every scene is built, and the timers are run
out. A lesson passes only if nothing raised.

The playing is the point. Calling `fn()` directly proves a function's body
works; it does not prove the function is reachable. A handler registered for a
key name the engine does not know, or attached to an object destroyed on the
first frame, is silently never called in the classroom — and calling it by
hand hides exactly that. The same goes for time: a `wait(1, ...)` body would
never run in a test whose frames take no measurable time, so the clock is run
out by hand at the end. And a "you win" scene is not reachable by mashing
keys, so every scene is built directly, with zeros for its arguments.

This replaced a version that booted Pyodide and ran each lesson against four
hundred lines of hand-written JavaScript pretending to be Kaplay. That
stand-in was the test's weakest point: it answered every call, so a lesson
could only fail by raising, and anything the stand-in got wrong was a bug the
test could never see because the test *was* the bug. There is no stand-in now.
`import kaplay` imports kaypy, out of the same bundle the browser downloads,
so a lesson that runs here is a lesson that runs in front of a class.

A failure names the line in the markdown, not a line in a file that does not
exist. A failure whose traceback never passes through the lesson or the engine
is reported as **this test** being broken rather than the guide — which is not
hypothetical: while it was being written, the harness read `eng.width` as a
number when it is a method, and three perfectly good lessons were marked FAIL.

### Checking who gets what from the handout link

```bash
python3 tools/test_assignment_flow.py
```

One URL, `/a/<slug>`, has to do three different things depending on who opens
it: a student gets their own copy and the same one every time, somebody signed
out gets an editable copy that saves nothing, and the author gets the assignment
itself. Twenty-six checks across both editors.

Every check looks at **what the opening left in the database**, not only where
it redirected — because "it returned a 302" was true for the whole time the
author was silently being given a student's draft of their own work.

### Checking the two editors stay apart

```bash
python3 tools/test_two_editors.py
```

Runs PyIDE and WebIDE against one SQLite database and asserts that neither can
list, open, edit, archive, delete or accept a turn-in for the other's
assignments, while both still work normally on their own. Twenty-six checks.

**Run it after touching any route that takes an assignment slug.** The two apps
share four tables and are kept apart by one `app` column plus a filter on every
query, and a missing filter is invisible from the dashboards — which is how six
of them went missing at once in September 2026, until a WebIDE assignment was
deleted from PyIDE's dashboard and took a teacher's project with it.

### Other

- **Vendor the libraries.** CodeMirror, marked, DOMPurify and Pyodide all come
  from CDNs. A school network that blocks one stops the editor loading at all.
  Kaplay is already vendored in WebIDE for exactly this reason; the same
  treatment here would leave the app depending on nothing but its own Render
  instance. Pyodide is ~10 MB, so it is the awkward one.
- **One account across both editors.** The `users` table was built to be
  shared and `assignments` already carries an `app` column. WebIDE could use
  the same sign-in, saved projects and turn-in with no schema change.
- **Notes on a fork.** A student who forks a project can create a `.md` file
  but cannot then edit or delete it, because both controls are gated on
  authoring. Blocking `.md` in "+ File" unless authoring would close it.
