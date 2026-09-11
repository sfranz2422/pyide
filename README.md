# PyIDE

A browser-based Python editor for an intro programming class, with shareable
project links.

Student code runs **entirely in the student's browser** using Pyodide (CPython
3.14 compiled to WebAssembly). The server never executes student code, so there
is nothing to sandbox, no CPU cost per run, and a class of thirty can all hit
Run at once on Render's free tier without trouble.

---

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
For a Pygame Zero project the game runs on the canvas exactly as it does in
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

## Pygame Zero

Students can write Pygame Zero games in the same editor, with no imports and no
`pgzrun` boilerplate — exactly what they'd write locally:

```python
WIDTH = 600
HEIGHT = 400
bean = Actor('bean', (300, 200))

def update(dt):
    if keyboard.right:
        bean.x += 4

def draw():
    screen.fill((120, 190, 230))
    bean.draw()
```

**Mode is detected automatically.** Defining `draw()` or `update()` at the top
level switches the editor into game mode: a canvas appears and the toolbar chip
reads *Game*. Nothing in an ordinary console program looks like that, so it
doesn't misfire. If it ever guesses wrong, click the chip to lock the mode by
hand — a dot on the chip means it's locked.

**Games run until stopped.** The 15-second limit applies to console programs
only; a game loop is an infinite loop on purpose. Use the red **Stop** button,
or press Escape.

**Students must click the picture** before the keyboard reaches the game. The
editor prints a reminder each time a game starts, but it's worth saying aloud on
day one.

**The keyboard is handed back when a game stops.** Emscripten's SDL installs a
document-level `keypress` handler that calls `preventDefault`, and it survives
the game loop ending — which made the editor silently refuse typed characters
while Enter and mouse clicks still worked, so it looked like a focus bug rather
than a keyboard one. Shutting the display down removes the handler (Pygame
Zero's own runner does the same). Since that also blanks the canvas, the last
frame is copied out and put back, so the picture stays on screen after Stop.

One case this doesn't cover: clicking into the editor while a game is still
running. The game owns the keyboard until it stops, which is what you want for
playing, but it means Stop first, then edit.

The first game run downloads about 4 MB (pygame-ce, numpy, Pygame Zero) and is
cached afterward. Console programs never pay that cost.

### Sprites

51 sprites from the KAPLAY game library are bundled and available by name, so
`Actor('bean')` works with no setup. The **Sprites** button opens a searchable
panel; clicking a sprite drops `Actor('name', (100, 100))` into the code at the
cursor.

The button only appears in game mode, so it stays out of the way during console
work. A student who wants to browse sprites before writing any `draw()` can
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
  game.js               Pygame Zero: async game loop, asset loading
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
examples/               Pygame Zero, file-handling and notes starters
```

`runtime.js` exists because two pages need the same Python: the `input()` shim,
the runaway-loop guard, and the traceback filtering. Keeping one copy is what
stops the editor and a demo link from slowly disagreeing about how a program
behaves. The output piping lives there too, because the raw-`write` decision
and the `flush()` in `input()` are two halves of one fix and would be a puzzle
apart.

## Possible next steps

- **Teacher dashboard** — a password-protected list of every shared snapshot
- **Fork lineage** — record which starter a project was forked from, so
  submissions can be grouped by assignment later
- **Autosave** — persist the current buffer to `localStorage`
