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

## Games, in Python, on Kaplay

Students write games in Python. Kaplay — a JavaScript game library — runs them.
Python never draws anything: it builds game objects and answers callbacks, and
Kaplay renders on the GPU.

```python
from kaplay import *

kaplay(width=800, height=600, background=[24, 24, 40])
loadSprite("bean", "images/bean.png")
setGravity(1600)

player = add([sprite("bean"), pos(100, 200), area(), body(jumpForce=800), "player"])

def jump():
    if player.isGrounded():
        player.jump(800)

onKeyPress("space", jump)
onUpdate("enemy", lambda e: e.move(-120, 0))
```

**The names are Kaplay's own, camelCase and all.** That is deliberate, and it
is the whole point: every Kaplay tutorial, example and forum answer on the
internet applies to what a student writes here, with the punctuation changed.
A snake_case wrapper would look more like Python and leave the class with no
documentation in the world. `kaplay({ width: 800 })` becomes
`kaplay(width=800)`; everything else is the same call in the same order.

**+ Game** in the toolbar starts a project with the import already there.

### How it works

`static/py/kaplay.py` is the seam, in about 240 lines. `kaplay()` starts the
engine and keeps the context it returns; every other name resolves against that
context on demand through the module's `__getattr__`. So the file contains no
list of Kaplay's API and cannot fall behind it — a function Kaplay adds next
year is callable from Python the day it ships.

On every call the seam converts Python lists to JavaScript arrays (so
`add([...])` works), dicts and keyword arguments to JavaScript objects (so
`body(jumpForce=800)` works), and Python functions to something JavaScript can
invoke (so a plain `def` can be handed to `onKeyPress`).

**Mode is detected by the import.** `from kaplay import *` or `import kaplay`
at the top level means this is a game; anything else is a console program.
That is a firmer signal than the old one — Pygame Zero was recognised by
defining `draw()` or `update()`, which an ordinary program could trip over.

### What replacing Pygame Zero deleted

This used to run Pygame Zero. The replacement removed far more than it added:

| | Pygame Zero | Kaplay |
|---|---|---|
| downloaded on first game | ~4 MB (pygame-ce, numpy, pgzero) | 184 KB, and it is vendored |
| the frame loop | its blocking `while True`, reimplemented as an async loop that yields each frame | Kaplay's own |
| sprites | copied file by file into Pyodide's virtual filesystem | fetched over HTTP like any web page |
| the canvas | an SDL binding | a `canvas` option |
| the keyboard afterwards | SDL kept it; the display had to be shut down to get it back, which blanked the canvas, so the last frame was copied out and put back | never taken from the document |

The keyboard workaround is worth remembering as a shape of problem rather than
a problem: SDL installed a document-level `keypress` handler that called
`preventDefault` and survived the game loop ending, so typing into the editor
silently stopped working while Enter and mouse clicks still worked. It read
like a focus bug. None of that exists now.

### Extra arguments are dropped, the way JavaScript drops them

Kaplay calls a handler with whatever it has: `onKeyDown` hands over the key
that was pressed, `onCollide` hands over both objects. A JavaScript function
ignores arguments it did not ask for, which is why every Kaplay example is
written like this and works:

```javascript
onKeyDown("left", () => player.move(-300, 0))
```

The same line in Python is `lambda: player.move(-300, 0)`, and Python does not
forgive a spare argument — it raises `TypeError: <lambda>() takes 0 positional
arguments but 1 was given`, on the first keypress, in a callback nobody is
looking at. Since the whole premise here is that Kaplay's documentation applies
to what students write, the bridge matches JavaScript's behaviour: a callback
is called with as many arguments as it will accept, and the rest are dropped.
A handler that *does* want the key still gets it.

The arity is worked out once, when the callback is wrapped, because this runs
sixty times a second and `inspect.signature` is far too slow for that.

This one was found by running the starter project, not by testing — the first
thing that happened on the first keypress. There is now a test for it.

### A list of frames does not get the load root

Kaplay's sprite loader begins `e = pe(e)`, where `pe` prepends the load root —
but only to a string:

```js
function pe(t){ return typeof t != "string" || Fn(t) ? t : a.assets.urlPrefix + t }
```

An array is not a string, so `loadSprite("dino", ["images/dino_0.png", …])`
skips the root entirely and fetches each frame relative to the page. On a share
link that means `/s/<slug>/images/dino_0.png` — a 404, a sprite that never
loads, and a blank canvas. Nothing raises, nothing is logged, and the same code
with a single path works perfectly.

The bridge applies the root per element instead, so the multi-frame form
behaves like the single-frame one. Paths that are already a URL or a `data:`
URI are left alone, which is what keeps exported games working.

This cost a lesson before it was found, and it was in this repo's own guide.

### Mistakes Kaplay accepts but nobody means

`anchor()` takes a name like `"center"`, or an offset between −1 and 1.
Kaplay's lookup ends in `default: return t`, so any other Vec2 is used as-is —
which makes `anchor(center())` set the anchor to, say, (200, 150) and draw the
sprite some five thousand pixels off screen. No error, nothing on the canvas,
and the line above it, `pos(center())`, is correct. A real student lost a
lesson to it.

The bridge now writes a note when an anchor lands far outside −1 to 1. This is
the only check of its kind, and the bar for adding another is the same: Kaplay
accepts it, nobody could mean it, and the failure is silent.

### Errors inside a callback

An exception in `onUpdate()` happens sixty times a second, long after the line
that registered it returned, and JavaScript is what catches it. Left alone that
is either silence or thousands of identical tracebacks. So the first one is
printed — trimmed to the student's own frames, like every other error here —
and the game is stopped.

Stopping is where the subtle bug lived. Kaplay can call a handler in the same
frame it was told to quit, so freeing the Python callbacks at that moment is a
use-after-free, and it surfaces as an incoherent JavaScript error rather than a
stopped game. A stopped game's callbacks are therefore left alive and made
inert by a flag; they are released when the next `kaplay()` starts, the one
moment nothing can still hold them. Found by a test, not by reasoning.

### Checking it still works

```bash
npm install pyodide
node tools/test_kaplay_bridge.mjs
```

Twenty-six checks against real Pyodide, the real bootstrap out of
`runtime.js` and the real bridge, with a stand-in for Kaplay that records what
JavaScript was actually handed. It cannot tell you the game looks right — that
needs a GPU and a pair of eyes — but it covers every seam, including the two
that only misbehave long after the student's program has returned: a callback
that raises, and Stop.

Measured cost of writing a game in Python rather than JavaScript, 200 objects
moved every frame, in a real browser:

```
moved from JavaScript   0.135 ms per frame   0.8% of a 60fps frame
moved from Python       0.122 ms per frame   0.7% of a 60fps frame
```

Indistinguishable. Kaplay draws either way; only the callbacks are Python.

Objects come back wrapped, so that `btn.add([...])` and `player.onCollide(...)`
— calls made *on* an object rather than on the context, which Kaplay's docs are
full of — marshal their arguments properly. The wrapper roughly doubles the
per-frame cost of touching an object: `o.move(1.5, 0.5)` across 200 objects
goes from 0.17 ms to 0.38 ms, and the nested `o.pos.x = o.pos.x + 1.5` from
0.44 ms to 0.66 ms. Still 4% of a frame at the worst, so the trade is worth
making; only `add`, `use`, `wait`, `loop`, `tween` and the `on…` methods are
intercepted, and everything else falls straight through.

### Sprites

51 sprites from the KAPLAY game library are bundled and available by name, so
`loadSprite("bean", "images/bean.png")` works with no setup. The **Sprites** button opens a searchable
panel; clicking a sprite drops the two lines Kaplay needs:

```python
loadSprite("bean", "images/bean.png")
add([sprite("bean"), pos(100, 100)])
```

Two lines rather than one because Kaplay has to load a sprite before it can be
used, and forgetting the load is the commonest way a sprite silently fails to
appear. The sound chips insert `loadSound(...)` and `play(...)` for the same
reason. Paths are relative to `/static/assets/`, which the bridge sets as
Kaplay's load root when the game starts.

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
never disturbs the sprites.

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
  game.js               Kaplay: loads the library, finds the bridge
  py/kaplay.py          the Python side of Kaplay (shipped to Pyodide)
  notes.js              Markdown notes: render, sanitize
  complete.js           Name completion from Python's ast
  style.css             All styling
  assets/
    manifest.json       Generated — what the sprite panel reads
    images/             60 sprite PNGs
    sounds/             23 sound effects (.wav only)
    CREDITS.md          Sprite licensing
tools/
  build_assets.py       Regenerates static/assets from source folders
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
program, `kaplay.js`, the Python bridge, and every sprite and sound the program
actually loads, all inlined; only Pyodide comes from a CDN.

That last part is the one caveat: **the first run of an exported game needs the
internet**, and takes a few seconds while Python starts. Embedding Pyodide too
would make every export about 20 MB, which is fine for one showcase game and
absurd for a class set. A two-sprite, one-sound game exports at about 490 KB.

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
  reference is Pyodide, from `https://cdn.jsdelivr.net`. External resources are
  allowed; insecure ones are not.
- **No absolute paths**, which would leave the project's directory on their CDN
  and return 403. Every sprite and sound is a `data:` URI, so there are no paths
  to get wrong. An exported game also sets Kaplay's load root to `""` rather
  than this site's asset directory.

Worth knowing why the data URIs are safe: Kaplay's loader tests
`/^data:\w+\/\w+;base64,.+/` and leaves anything matching it alone, so the
load root is never prepended to an inlined asset.

Size is a non-issue — itch allows 200 MB for a single file and a small game
exports at about half a megabyte.

```bash
node tools/test_export.mjs
```

Builds an export with a stub `fetch` reading from `static/`, then checks it:
one document, engine and bridge inlined, asset paths turned into data URIs,
unused assets left behind, Pyodide the only external reference, and nothing
inside a `<script>` block able to end it early. Nineteen checks.

That last one is worth having. `kaplay.js` contains a literal `<script` and no
`</script`, so inlining it happens to be safe today — the export now escapes
any `</script` rather than depending on that staying true.

### Run, Stop, Run

```bash
node tools/test_canvas_cycle.mjs
```

The cycle a student repeats all lesson, and the one that has now hidden two
separate bugs — both of which let the first game run perfectly and broke the
second, which is the worst possible shape for a bug in a classroom.

**Kaplay's `quit()` ends by calling `WEBGL_lose_context.loseContext()`,** and a
canvas whose context has been deliberately lost can never hand out a working
one again: `getContext` returns the lost one forever. Reusing the element meant
the second game started, registered its handlers, ran its loop, and drew to
nothing — Stop turned the picture white and Run after that appeared to do
nothing at all. So every game gets a brand new canvas element, the same way
WebIDE replaces its preview iframe rather than reassigning `srcdoc`. The key
listeners are rebound on each swap, because they belong to the element.

The blank picture after Stop is not a choice — losing the context takes the
last frame with it, and keeping the frame would mean painting it into a 2D
context, which is then the wrong kind of context for the next game.

### Checking a guide's code actually runs

```bash
node tools/test_guide.mjs ../learn_pykaplay.md
```

Executes every ```python block in a markdown guide through the real bridge, as
if Run had been pressed, then fires every callback it registered. A block
passes only if nothing reached stderr.

Worth having because the failures it catches look perfectly fine on the page: a
function that is not in the bridge's star-import list, a keyword argument
Kaplay does not take, a callback whose arguments don't line up. It found three
on its first run, including one that would have broken every game on its second
Run of a session.

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
