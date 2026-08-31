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

### Free tier caveat

Free Render services sleep after 15 minutes idle and take ~30 seconds to wake.
The first student to open it each period will wait; everyone after that won't.
If that's annoying, the $7/month Starter plan removes it. Render's free Postgres
also expires after a set period — check the current terms when you set it up,
and upgrade the database if you want share links to last all year.

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
appears on the right. `input()` opens a browser prompt and echoes the value into
the output pane so the transcript reads like a real terminal.

**Share.** Fill in the project name and their own name, press **Share**, and
they get a link like `https://your-app.onrender.com/s/k3m9pqr`. The link is a
snapshot of the code at that moment — opening it is read-only, so nobody can
alter a submitted project. Anyone viewing it can still press Run, and can press
**Edit a copy** to fork it into their own editable version.

**Save .py** downloads the file if they want it on disk.

### For grading

Have students paste their share link into your LMS. Add `/raw` to any share URL
to get the plain source, which is handy for diffing or feeding to a checker:

```
https://your-app.onrender.com/s/k3m9pqr/raw
```

---

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

The first game run downloads about 4 MB (pygame-ce, numpy, Pygame Zero) and is
cached afterward. Console programs never pay that cost.

### Sprites

51 sprites from the KAPLAY game library are bundled and available by name, so
`Actor('bean')` works with no setup. The **Sprites** button opens a searchable
panel; clicking a sprite drops `Actor('name', (100, 100))` into the code at the
cursor.

`dino` is a nine-frame walk cycle in the original artwork, so the build script
slices it into `dino_0` through `dino_8`. Flipping between those frames is how
`examples/03_dino_run.py` animates. See `static/assets/CREDITS.md` for the
license.

### Adding sprites or sounds

Put new artwork in a folder and re-run the build script:

```bash
python tools/build_assets.py "path/to/sprites" "path/to/sounds"
```

Sounds are `.wav` or `.ogg`. They appear in the Sprites panel and become
available to student code as `sounds.<filename>.play()`. Browsers block audio
until the student has interacted with the page — since they must click the
canvas to play anyway, this rarely bites, but it explains any silent first run.

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
  404.html              Bad share link
static/
  app.js                Editor, console runtime, sprite panel, sharing
  game.js               Pygame Zero: async game loop, asset loading
  style.css             All styling
  assets/
    manifest.json       Generated — what the sprite panel reads
    images/             60 sprite PNGs
    sounds/             Empty; drop .wav/.ogg here and rebuild
    CREDITS.md          Sprite licensing
tools/
  build_assets.py       Regenerates static/assets from source folders
examples/               Pygame Zero starters, ready to share as links
```

## Possible next steps

- **Teacher dashboard** — a password-protected list of every shared snapshot
- **Fork lineage** — record which starter a project was forked from, so
  submissions can be grouped by assignment later
- **Autosave** — persist the current buffer to `localStorage`
