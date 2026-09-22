# Learn Kaplay — in Python

The same thirteen lessons as the Learn Kaplay site, written for PyIDE.

The engine underneath is **kaypy** — Python from top to bottom, drawing
through pygame. Every name below — `add`, `sprite`, `onKeyDown`,
`loadSpriteAtlas` — is Kaplay's own name, in Kaplay's own order, with Kaplay's
own arguments, because kaypy was built to match it. **Which means the Kaplay
documentation, and every Kaplay example on the internet, still applies to what
you write here**, once you have read the translation table below.

### The game you write here also runs on your own computer

That is the part worth knowing before you start. There is no browser hidden
inside these games and no JavaScript anywhere. Install the engine once —

```
pip install kaypy
```

— and the file you wrote in PyIDE runs with `python game.py`, unchanged, on
your own machine. `kaypy new mygame` sets up a folder with the sprites and
sounds already in it, and `kaypy web game.py` turns a finished game into a web
page you can put anywhere.

Nothing in this guide depends on that. It matters because the thing you build
in class is not stuck in the class website.

## Getting started

Press **+ Game** in PyIDE. You get a project that already begins:

```python
from kaypy import *
```

That line matters twice. It brings in every Kaplay name, and it is also how the
editor knows this is a game rather than an ordinary program — that is what
makes the picture appear instead of the console.

Press **Run** to play. The keys go to the game straight away — you do not have
to click the picture first. Press **Stop** when you want the keyboard back for
typing; while a game is running, the arrow keys and the space bar belong to it,
not to the editor.

### Where the pictures and sounds live

The **Sprites** button opens all 202 sprites, the dungeon atlas and 23 sounds.
Click one and it inserts the lines you need. Paths look like this:

```python
loadSprite("bean", "images/bean.png")
loadSprite("elf_m", "dungeon/elf_m.png")
loadSound("ding", "sounds/ding.wav")
```

There are two packs. The **Kaplay pack** is 60 cartoon sprites. The **Dungeon
pack** is 142 pixel-art tiles and characters — knights, elves, orcs, zombies,
chests, doors, floors — and 42 of those animate. The ▶ in the corner of a cell
means it animates; the search box covers both packs at once.

Below them is **dungeon.png**, the same dungeon artwork as one uncut image.
That is a *sprite atlas*, and Lesson 12 is about cutting one up yourself.

No downloading, no folders to set up, no local web server.

---

## Reading JavaScript Kaplay as Python

You will find Kaplay examples written in JavaScript everywhere, including on
the Learn Kaplay site. Here is the whole translation. There is nothing else to
it.

| JavaScript | Python |
|---|---|
| `kaplay({ width: 800 })` | `kaplay(width=800)` |
| `body({ jumpForce: 800 })` | `body(jumpForce=800)` |
| `const SPEED = 300;` | `SPEED = 300` |
| `() => player.move(-300, 0)` | `lambda: player.move(-300, 0)` |
| `(e) => { e.destroy() }` | `lambda e: e.destroy()` |
| `function jump() { ... }` | `def jump(): ...` |
| `if (a && !b) { ... }` | `if a and not b: ...` |
| `true` / `false` / `null` | `True` / `False` / `None` |
| `// a comment` | `# a comment` |
| `{ ... }` blocks | indentation |
| `;` at the end of a line | nothing |

Two rules worth stating plainly:

**Options in curly braces become keyword arguments.** Anywhere the JavaScript
shows `{ speed: 10, loop: true }`, you write `speed=10, loop=True`.

**Callbacks can ignore arguments they don't want.** Kaplay hands `onKeyDown`
the key that was pressed, but `lambda: ...` takes nothing and works anyway,
exactly as `() => ...` does in JavaScript. If you *do* want the key, write
`lambda key: ...` and you will get it.

## Two ways to write a handler

Every `on…` function in this guide takes a function to run. You can hand it one
directly, which is what the JavaScript examples do:

```python
onKeyDown("left", lambda: player.move(-SPEED, 0))
```

Or you can put it above a function with an `@`:

```python
@onKeyDown("left")
def go_left():
    player.move(-SPEED, 0)
```

Both do exactly the same thing, and you will see both below. The first is
shorter and reads well when the action is one short line. Reach for the second
the moment it isn't, because **a lambda can only hold one expression**, and
squeezing more into one is where the code starts to look strange:

```python
# what a lambda forces you to write
onKeyPress("space", lambda: player.jump(700) if player.isGrounded() else None)

# the same thing, said plainly
@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(700)
```

The `else None` in the first one does nothing at all. It is there only because
a conditional *expression* is required to have an `else`, and it is a sure sign
the lambda has been asked to do too much. The same goes for
`lambda: setattr(obj, "pos", v)` — `setattr` appears only because a lambda
cannot contain `obj.pos = v`.

There is a third reason, and it shows up when something breaks: a function
written with `@` has a name, so an error message says `jump`, while a lambda is
reported as `<lambda>` and you get to work out which of the six you wrote it
was.

---

# 1 — Adding a game object

In Kaplay everything you put on the screen — players, bullets, rocks, clouds,
text — is a **game object**. You build one out of **components**, and each
component gives it one ability.

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")

bean = add([
    sprite("bean"),
    pos(80, 40),
    area(),
    color(0, 0, 255),
])
```

Press **Run**. Bean is on the screen.

**What each part does.**

`kaplay(...)` starts the engine. It has to come first, before anything else.

`loadSprite("bean", "images/bean.png")` makes a picture available under the
name `bean`. Loading and using are two separate steps, and forgetting the load
is the commonest reason a sprite doesn't appear.

`add([...])` builds a game object out of a list of components:

- `sprite("bean")` — draw it using the picture called `bean`
- `pos(80, 40)` — put it at x=80, y=40
- `area()` — give it a collision box, so it can bump into things
- `color(0, 0, 255)` — tint it blue

There are many more components. You will meet most of them in the lessons
below.

> **Challenge**
>
> 1. Use a different sprite. Click **Sprites** to see all 202.
> 2. Play with the position, colour and scale. Try adding `scale(1.5)`, and try
>    `pos(width() / 2, height() / 2)` — `width()` and `height()` give you the
>    size of the game window, so that puts the object dead centre.

---

# 2 — Player movement

Input handling and moving things about.

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")

SPEED = 320          # pixels per second

player = add([
    sprite("bean"),
    pos(center()),
    area(),
])

onKeyDown("left",  lambda: player.move(-SPEED, 0))
onKeyDown("right", lambda: player.move(SPEED, 0))
onKeyDown("up",    lambda: player.move(0, -SPEED))
onKeyDown("down",  lambda: player.move(0, SPEED))

onClick(lambda: player.moveTo(mousePos()))

add([
    text("Arrow keys to move, click to teleport", size=20),
    pos(12, 12),
])
```

**What each part does.**

`center()` gives you the middle of the screen — it is shorthand for
`vec2(width() / 2, height() / 2)`.

`onKeyDown(key, action)` registers an event that runs **every frame** while the
key is held down. This pattern — name an event, hand it a function to run — is
the shape of nearly everything in Kaplay. Learn it once here.

`.move()` comes from the `pos()` component. **A component gives an object
abilities, and the object only has the abilities its components gave it.** No
`pos()`, no `.move()`. This is worth stopping on, because it explains a whole
category of confusing error later.

`.move()` is measured in **pixels per second**, not pixels per frame. Kaplay
multiplies by the frame time for you, so your game runs at the same speed on a
fast computer and a slow one.

`onClick(action)` runs **once** when the mouse is clicked. `.moveTo()` also
comes from `pos()`, and puts the object somewhere rather than nudging it.

`text()` is a component just like `sprite()`, but it draws words instead of a
picture.

---

# 3 — Collision handling

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")
loadSprite("ghosty", "images/ghosty.png")
loadSprite("steel", "images/steel.png")

SPEED = 320

player = add([
    sprite("bean"),
    pos(center()),
    area(),
    body(),
    "player",
])

# Three enemies, made with an ordinary Python for loop.
for i in range(3):
    add([
        sprite("ghosty"),
        pos(rand(0, width()), rand(0, height())),
        area(),
        "enemy",
    ])

# A wall that nothing can push. isStatic means it never moves.
add([
    sprite("steel"),
    pos(600, 300),
    area(),
    body(isStatic=True),
])

# Heavy, but not immovable — you can shove it, slowly.
add([
    sprite("steel"),
    pos(200, 400),
    area(),
    body(mass=100),
])

onKeyDown("left",  lambda: player.move(-SPEED, 0))
onKeyDown("right", lambda: player.move(SPEED, 0))
onKeyDown("up",    lambda: player.move(0, -SPEED))
onKeyDown("down",  lambda: player.move(0, SPEED))

player.onCollide("enemy", lambda e: e.destroy())
```

**What each part does.**

`area()` is what makes collision possible. **Both objects need it** — an object
without `area()` is invisible to collision, and this is the single most common
reason a collision "doesn't work".

`body()` makes an object respond to physics. `body(isStatic=True)` makes it a
wall: solid, and never moved by anything. `body(mass=100)` makes it heavy but
still pushable.

`"player"` and `"enemy"` in the component list are **tags**. A tag is just a
label you can look objects up by later.

`.onCollide(tag, action)` comes from `area()`. It runs when this object touches
an object carrying that tag. There are two relatives:

- `.onCollideUpdate(tag, action)` runs **every frame** while they are touching
- `.onCollideEnd(tag, action)` runs **once** when they stop touching

Also from `area()`: `.onClick(action)` runs when the object itself is clicked,
and `.isHovering()` returns `True` while the mouse is over it.

**A debugging tool worth knowing now.** Add this line and every collision box
is drawn on screen:

```python
debug.inspect = True
```

You can also press **F1** while the game is running. When a collision isn't
firing, look at the boxes before you look at the code — usually they simply
aren't touching.

### About `dt()`

`dt()` is the time since the last frame. You use it as a multiplier when you
move something by hand:

```python
onUpdate(lambda: rock.move(0, 50 * dt()))
```

`.move()` already does this for you, which is why the movement code above has
no `dt()` in it. Reach for `dt()` when you are changing a number yourself —
a timer, a fade, a score that climbs over time.

---

# 4 — Review assignment

No new material. Build this from memory, checking back only when stuck.

1. Initialize Kaplay.
2. Put a sprite on the screen that responds to collisions. *(Which component
   makes collision possible?)*
3. Put a rectangle on the screen. Think — you want a `rect()` component. What
   arguments would it take?

Hint for 3: a rectangle needs a width and a height, and like everything else it
needs a `pos()` to say where it goes.

---

# 5 — Gravity

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")

setGravity(1600)          # pixels per second, per second

player = add([
    sprite("bean"),
    pos(center()),
    area(),
    body(),
])

# A platform to land on.
add([
    rect(width(), 48),
    pos(0, height() - 48),
    outline(4),
    area(),
    body(isStatic=True),
    color(127, 200, 255),
])

def jump():
    if player.isGrounded():
        player.jump(800)

onKeyPress("space", jump)

player.onGround(lambda: print("landed"))

add([
    text("Press space to jump", size=24, width=320),
    pos(12, 12),
    color(255, 255, 255),
])
```

**What each part does.**

`setGravity(1600)` switches gravity on for the whole game. Nothing falls until
you call it.

`body()` is what makes an object respond to gravity. And `body()` is what gives
you these:

- `.isGrounded()` — `True` when standing on something
- `.jump(force)` — launch upward
- `.onGround(action)` — an event that runs each time it lands

Again: **no `body()`, none of these exist.** If you get an error saying an
object has no `jump`, you forgot `body()`.

The `if player.isGrounded()` check is what stops infinite mid-air jumping. Take
it out and see.

`onKeyPress` runs **once** per press; `onKeyDown` runs every frame while held.
Jumping wants `onKeyPress`.

The platform is a `rect()` with `body(isStatic=True)` — solid and immovable.
`outline(4)` draws a border round it.

`text()` takes options like everything else: `size=24` sets the height,
`width=320` wraps the words at that many pixels.

> **Exercise**
>
> Add left and right movement from Lesson 2, so you can jump *and* run.

---

# 6 — Sprite animation

An animation is several pictures shown in turn. PyIDE ships a nine-frame dino
walk cycle — `dino_0` through `dino_8` — so you can build one from the frames
you already have:

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

# One sprite made out of nine pictures. The frames are numbered 0 to 8 in the
# order you list them.
loadSprite("dino", [
    "images/dino_0.png", "images/dino_1.png", "images/dino_2.png",
    "images/dino_3.png", "images/dino_4.png", "images/dino_5.png",
    "images/dino_6.png", "images/dino_7.png", "images/dino_8.png",
], anims={
    "idle": {"from": 0, "to": 0, "loop": True},
    "run":  {"from": 0, "to": 8, "speed": 12, "loop": True},
})

SPEED = 300
setGravity(1600)

player = add([
    sprite("dino"),
    pos(center()),
    anchor("center"),
    area(),
    body(),
    scale(3),
    "player",
])

player.play("idle")

add([
    rect(width(), 48),
    pos(0, height() - 48),
    area(),
    body(isStatic=True),
    color(90, 74, 58),
])


def run_left():
    player.move(-SPEED, 0)
    player.flipX = True
    if player.isGrounded() and player.curAnim() != "run":
        player.play("run")


def run_right():
    player.move(SPEED, 0)
    player.flipX = False
    if player.isGrounded() and player.curAnim() != "run":
        player.play("run")


onKeyDown("left", run_left)
onKeyDown("right", run_right)

onKeyRelease("left", lambda: player.play("idle"))
onKeyRelease("right", lambda: player.play("idle"))


@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(700)
```

**What each part does.**

`anims=` names ranges of frames. `"run": {"from": 0, "to": 8, "speed": 12}`
means "frames 0 through 8, twelve frames per second, forever". `speed` is
frames per second; `loop` decides whether it repeats.

`.play(name)` comes from `sprite()` and starts one of those animations.

**`.play()` restarts the animation from its first frame.** So calling it every
frame while a key is held gives you a character stuck on frame 0, twitching.
That is what `player.curAnim() != "run"` is for — only start the run animation
if it isn't already running. This catches everyone once.

`anchor("center")` says which point of the picture `pos()` refers to. Without
it, `pos()` means the top-left corner.

**It takes a name, not a position.** `anchor(center())` looks reasonable — the
line above it is `pos(center())` — but it is the one mistake in this guide that
costs a whole lesson. `center()` is a *place on the screen*; an anchor is an
*offset between −1 and 1*. Kaplay accepts the number either way and draws your
sprite thousands of pixels off screen, with no error and nothing on the canvas.
PyIDE prints a note when it sees this, but it is worth recognising:

```python
anchor("center")     # right — a name
anchor(center())     # wrong — a screen position
anchor(vec2(0, 1))   # also right — bottom edge, an offset in -1..1
```

`player.flipX = True` mirrors the sprite so it faces the other way. Notice this
is a plain assignment, not a method call.

`scale(3)` draws it three times the size — the dino frames are only 16×26
pixels.

**The shorter way: a spritesheet.** A spritesheet is many frames in *one* image
file, and Kaplay slices it for you. The dungeon pack in the Sprites panel is
built this way — every one of its characters is a single strip holding all of
their animations end to end:

```python
loadSprite("elf_m", "dungeon/elf_m.png",
            sliceX=9, anims={
    "idle": {"from": 0, "to": 3, "speed": 8, "loop": True},
    "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
    "hit": {"from": 8, "to": 8, "speed": 1, "loop": False},
})

player = add([sprite("elf_m", anim="idle"), pos(200, 200), scale(3)])
```

`sliceX` is how many frames across, `sliceY` how many down. `anims` names the
runs of frames: `elf_m` is nine frames, the first four an idle, the next four a
run, the last one a wince.

You don't have to type any of that. Click the elf in the Sprites panel and it
appears, filled in — then change it. Turn `speed` up and the elf runs faster.
Set `"loop": False` on the run and it stops after one lap.

`anim="idle"` starts an animation the moment the object is added, and
`.play("run")` switches it later — exactly as in the dino version above:

```python
def move_right():
    if player.curAnim() != "run":
        player.play("run")
    player.move(200, 0)
    player.flipX = False


onKeyDown("right", lambda key: move_right())
onKeyRelease("right", lambda key: player.play("idle"))
```

> **Exercise**
>
> The player walks off the edge of the screen. Add an `onUpdate` that keeps
> them on it. Hint: compare `player.pos.x` against `0` and `width()`.

---

# 7 — Scenes

A scene is one part of your game: a menu, the game itself, a game-over screen.
Each one is a function, and `go()` switches between them.

```python
from kaypy import *

kaplay(width=800, height=600)
setBackground(0, 0, 0)

loadSprite("bean", "images/bean.png")
loadSprite("ghosty", "images/ghosty.png")
loadSprite("coin", "images/coin.png")
loadSprite("portal", "images/portal.png")
loadSound("ding", "sounds/ding.wav")
loadSound("danger", "sounds/screech.wav")

SPEED = 320


def game():
    score = 0
    coin_mult = 1.0

    player = add([sprite("bean"), pos(center()), area(), "player"])

    onKeyDown("left",  lambda: player.move(-SPEED, 0))
    onKeyDown("right", lambda: player.move(SPEED, 0))
    onKeyDown("up",    lambda: player.move(0, -SPEED))
    onKeyDown("down",  lambda: player.move(0, SPEED))

    for i in range(20):
        add([
            sprite("coin"),
            pos(rand(20, width() - 20), rand(20, height() - 20)),
            area(),
            "coin",
        ])

    score_label = add([text("0", size=28), pos(12, 12)])

    def got_coin(c):
        nonlocal score, coin_mult
        c.destroy()
        score += 1
        coin_mult += 0.05
        score_label.text = str(score)
        play("ding")

    player.onCollide("coin", got_coin)

    for i in range(5):
        add([
            sprite("ghosty"),
            pos(rand(0, width()), rand(0, height())),
            area(),
            "enemy",
        ])

    # Every frame, every ghost drifts toward the player — and speeds up as the
    # player collects coins.
    onUpdate("enemy", lambda g: g.moveTo(player.pos, 70 * coin_mult))

    def caught(e):
        play("danger")
        go("lose", score)

    player.onCollide("enemy", caught)

    add([
        sprite("portal"),
        pos(rand(20, width() - 20), rand(20, height() - 20)),
        area(),
        "portal",
    ])

    player.onCollide("portal", lambda p: go("win", score))


def lose(score):
    add([text("You lost", size=48), pos(center()), anchor("center")])
    add([text("Score: " + str(score), size=28),
         pos(center().x, center().y + 60), anchor("center")])
    onKeyPress("space", lambda: go("game"))


def win(score):
    add([text("You win!", size=48), pos(center()), anchor("center")])
    add([text("Score: " + str(score), size=28),
         pos(center().x, center().y + 60), anchor("center")])
    onKeyPress("space", lambda: go("game"))


scene("game", game)
scene("lose", lose)
scene("win", win)

go("game")          # nothing happens until you start a scene
```

**What each part does.**

`scene("name", function)` registers a scene. `go("name")` switches to it, and
**everything from the previous scene is thrown away** — objects, events, all of
it. That is the point: you never have to clean up by hand.

`go("lose", score)` passes a value through, and the scene function receives it
as a parameter: `def lose(score):`.

**Nothing runs until `go()` is called.** That last line is the one everybody
forgets.

`setBackground(0, 0, 0)` sets the background outside the `kaplay()` call —
handy when you want to change it later.

`onUpdate("enemy", action)` runs the action every frame for **every** object
tagged `enemy`. The object is handed to your function.

`.moveTo(target, speed)` moves toward a point at a given speed, rather than
jumping straight there.

**About `nonlocal`.** `score` belongs to the `game` function, and `got_coin` is
a function inside it. Python needs `nonlocal score` to say "change the outer
one, don't make a new one". Leave it out and the score stays at zero forever,
silently. This is Python's equivalent of the scope rules you would hit in
JavaScript, and it is the one Python-specific gotcha in this whole guide.

---

# 8 — Audio and buttons

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSound("bell", "sounds/ding.wav")
loadSound("bgMusic", "sounds/background.wav")

# Start the music paused, so it doesn't play until we say so.
music = play("bgMusic", loop=True, paused=True, volume=0.5)

bell_button = add([
    rect(200, 60, radius=8),
    pos(100, 100),
    area(),
    color(80, 120, 220),
])

# Added to the BUTTON, not to the screen — so (16, 18) is measured from the
# button's own corner, and the text travels with it if the button moves.
bell_button.add([
    text("Ring the bell", size=20),
    pos(16, 18),
])

bell_button.onClick(lambda: play("bell"))

music_button = add([
    rect(200, 60, radius=8),
    pos(100, 200),
    area(),
    color(220, 120, 80),
])

music_button.add([text("Play music", size=20), pos(30, 18)])


def toggle_music():
    music.paused = not music.paused


music_button.onClick(toggle_music)
```

**What each part does.**

`loadSound(name, path)` works just like `loadSprite`.

`play(name)` plays a sound once. `play(name, loop=True, paused=True)` hands you
back a handle you can control — `music.paused = False` starts it,
`music.volume = 0.2` turns it down.

The bell needs no handle, because we never want to control it — we just want it
to go off.

**Child objects.** `bell_button.add([...])` adds the text *to the button*
rather than to the screen. Positions of a child are relative to its parent, and
a child moves when its parent moves.

Think about where else that's useful: a player carrying a sword, a health bar
floating above an enemy's head, a label on a moving platform. Make it a child
and you never have to keep the two positions in step by hand.

`.onClick()` on an object needs `area()` on that object — the click has to land
somewhere.

---

# 9 — Timer and loop

Kaplay has its own timers. Use them instead of Python's, because Kaplay's are
tied to the frame loop and stay in step with the game.

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")

# Every half second, for as long as the game runs.
def spawn():
    b = add([
        sprite("bean"),
        pos(rand(0, width()), rand(0, height())),
        area(),
    ])
    # ...and three seconds after it appears, it goes away again.
    wait(3, lambda: b.destroy())


loop(0.5, spawn)
```

**What each part does.**

`loop(seconds, action)` runs the action over and over, that many seconds apart.

`wait(seconds, action)` runs the action **once**, after a delay.

Both are measured in seconds and both are managed by Kaplay, so they pause and
resume with the game and never drift out of step with what's on screen.

You will use `wait()` constantly: a delay before a respawn, a pause before the
game-over screen appears, a gap between waves of enemies.

---

# 10 — Levels

Drawing a map by hand gets old fast. `addLevel()` lets you draw it as a
picture made of characters.

```python
from kaypy import *

kaplay(width=800, height=600, background=[141, 183, 255])

loadSprite("bean", "images/bean.png")
loadSprite("grass", "images/grass.png")
loadSprite("steel", "images/steel.png")
loadSprite("coin", "images/coin.png")
loadSprite("spike", "images/spike.png")

SPEED = 320
setGravity(2400)

layout = [
    "                          ",
    "                          ",
    "                          ",
    "      $$                  ",
    "    =====        $$       ",
    "                =====     ",
    "  @        ^^          $  ",
    "==========================",
]

level = addLevel(layout, {
    "tileWidth": 64,
    "tileHeight": 64,
    "pos": vec2(0, 0),
    "tiles": {
        "=": lambda: [sprite("grass"), area(), body(isStatic=True)],
        "$": lambda: [sprite("coin"), area(), "coin"],
        "^": lambda: [sprite("spike"), area(), "danger"],
        "@": lambda: [sprite("bean"), area(), body(), anchor("bot"), "player"],
    },
})

player = level.get("player")[0]

onKeyDown("left",  lambda: player.move(-SPEED, 0))
onKeyDown("right", lambda: player.move(SPEED, 0))


@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(1000)


# Touch a spike and you go back to the start.
@player.onCollide("danger")
def back_to_start(spike):
    player.pos = level.tile2Pos(2, 6)


player.onCollide("coin", lambda c: c.destroy())
```

**What each part does.**

The layout is a list of strings. Each character becomes one tile, and the
`tiles` dictionary says what each character means. Space means nothing at all.

Each entry in `tiles` is a **function returning a component list** — that is
why every one of them is `lambda: [...]`. It has to be a function because
Kaplay calls it once per tile; a plain list would give every tile the same
single object.

`tileWidth` and `tileHeight` are the size of one tile in pixels. Match them to
your sprites — the bundled `grass` and `steel` are 64×64.

`level.get("player")[0]` finds the object you tagged `player` inside the level,
so you can control it. `get` returns a list, hence the `[0]`.

`level.tile2Pos(col, row)` converts a tile position into real pixels. The `@`
above is at column 2, row 6.

**Design your map on paper first,** or with an ASCII map editor. Keep all the
rows the same length.

> **Exercises**
>
> 1. Send the player to a game-over scene when they fall off the bottom.
>    (Hint: `onUpdate` and check `player.pos.y > height()`.)
> 2. Add a score that goes up when a coin is collected.

---

# 11 — Camera

When the level is bigger than the window, the camera follows the player.

```python
from kaypy import *

kaplay(width=800, height=600, background=[141, 183, 255])

loadSprite("bean", "images/bean.png")
loadSprite("grass", "images/grass.png")
loadSprite("coin", "images/coin.png")

SPEED = 320
setGravity(2400)

layout = [
    "                                             ",
    "                                             ",
    "       $      $        $        $            ",
    "    ====    =====    =====    ======         ",
    "                                             ",
    " @                                        $  ",
    "=============================================",
]

level = addLevel(layout, {
    "tileWidth": 64,
    "tileHeight": 64,
    "tiles": {
        "=": lambda: [sprite("grass"), area(), body(isStatic=True)],
        "$": lambda: [sprite("coin"), area(), "coin"],
        "@": lambda: [sprite("bean"), area(), body(), anchor("bot"), "player"],
    },
})

player = level.get("player")[0]

score = 0

# A score that does NOT scroll with the world.
score_label = add([
    text("0", size=28),
    pos(12, 12),
    fixed(),
])


def keep_camera_on_player():
    setCamPos(player.pos)


onUpdate(keep_camera_on_player)


def got_coin(c):
    global score
    c.destroy()
    score += 1
    score_label.text = str(score)
    setCamScale(1 + score * 0.02)      # zoom in a little with every coin


player.onCollide("coin", got_coin)

onKeyDown("left",  lambda: player.move(-SPEED, 0))
onKeyDown("right", lambda: player.move(SPEED, 0))


@onKeyPress("space")
def jump():
    if player.isGrounded():
        player.jump(1000)


# Where did I actually click, in the world?
onClick(lambda: print("clicked world position:", toWorld(mousePos())))
```

**What each part does.**

`setCamPos(position)` points the camera somewhere. Calling it from `onUpdate`
every frame is what makes it follow.

`setCamScale(n)` zooms. Bigger than 1 zooms in.

`fixed()` is the component that makes an object **ignore the camera**. Score
labels, health bars, buttons — anything that should stay stuck to the screen
rather than to the world — needs `fixed()`. Leave it off the score and it
slides away as you walk.

`toWorld(mousePos())` converts a position on the screen into a position in the
world. Once the camera has moved, those are different things, and mixing them
up is a genuinely confusing bug. `mousePos()` is where the mouse is on screen;
`toWorld(...)` is what it's pointing at in the game.

---

# 12 — Sprite atlas

An **atlas** is one image holding many different sprites, each at a known
position. You load it once and name the pieces.

`dungeon.png` is in the Sprites panel, under **Sprite atlas**, and clicking it
inserts all of this:

```python
loadSpriteAtlas("dungeon.png", {
    "wall": {"x": 16, "y": 16, "width": 16, "height": 16},
    "floor": {"x": 16, "y": 64, "width": 48, "height": 48, "sliceX": 3, "sliceY": 3},
    "hero": {
        "x": 128, "y": 196, "width": 144, "height": 28, "sliceX": 9,
        "anims": {
            "idle": {"from": 0, "to": 3, "speed": 3, "loop": True},
            "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
            "hit": 8,
        },
    },
    "ogre": {
        "x": 16, "y": 336, "width": 256, "height": 32, "sliceX": 8,
        "anims": {
            "idle": {"from": 0, "to": 3, "speed": 3, "loop": True},
            "run": {"from": 4, "to": 7, "speed": 10, "loop": True},
        },
    },
    "chest": {
        "x": 304, "y": 400, "width": 48, "height": 16, "sliceX": 3,
        "anims": {
            "open": {"from": 0, "to": 2, "speed": 20, "loop": False},
            "close": {"from": 2, "to": 0, "speed": 20, "loop": False},
        },
    },
})
```

> **If you look this up elsewhere,** the version of these coordinates that is
> published online has `ogre` at `y: 320` and `chest` at `y: 304`. Both are
> wrong for this image: `y: 320` is 16 pixels above the ogres, so you get the
> top half of an ogre and a strip of floor, and `y: 304` is empty space, so the
> chest loads with nothing in it. Neither one is an error — Kaplay will cut out
> a rectangle of nothing without complaint. Which is the whole lesson: **the
> numbers are not checked for you, so when a sprite comes out wrong or missing,
> suspect the rectangle first.**

**What each part does.**

Each entry says where its sprite sits in the big image: `x` and `y` are how far
in from the left and down from the top, `width` and `height` how big the whole
strip is.

`sliceX` and `sliceY` cut that strip into frames — `sliceX: 9` means nine
frames side by side.

`anims` names ranges of those frames, exactly as in Lesson 6. An animation can
also be a single number (`"hit": 8` means "frame 8").

Animations are optional. `floor` and `wall` above have none — they are just
pictures.

**Atlas or ready-made?** The Dungeon pack in the Sprites panel is this same
artwork, already cut up and named — `knight_m`, `dungeon_ogre`,
`chest_full_open` and 139 others. Clicking one is faster and you cannot get a
rectangle wrong. Use the atlas when the artwork you want is in one image
somebody else laid out, which is most artwork you will find online.

The pack's ogre is called `dungeon_ogre` and not `ogre` for a reason worth
knowing, because it will happen to you with your own sprites one day: the
atlas above names a region `ogre` too, and **a sprite name is a single
shelf — load two things under one name and only the second is there.** The
pack's ogre has eight frames and a `run`; the atlas region has four and does
not. If both were called `ogre`, loading the pack's and then the atlas would
leave you with the atlas one, and `play("run")` would stop working with
nothing to say which line broke it. So the pack gives way and the atlas keeps
the name Kaplay's own example uses.

**Building a level from an atlas** is the same `addLevel()` as Lesson 10, run
twice: once for the floor, then once for the walls and objects on top, so
things sit above the floor rather than under it.

```python
# The floor, drawn first. A space means floor here, so we don't have to type
# a character for every square.
addLevel(floor_layout, {
    "tileWidth": 16,
    "tileHeight": 16,
    "tiles": {
        " ": lambda: [sprite("floor", frame=randi(0, 8))],
    },
})

# Then everything that stands on it.
addLevel(map_layout, {
    "tileWidth": 16,
    "tileHeight": 16,
    "tiles": {
        "#": lambda: [sprite("wall"), area(), body(isStatic=True), tile(isObstacle=True)],
        "$": lambda: [sprite("chest"), area(), tile()],
    },
})
```

`frame=randi(0, 8)` picks a random floor tile, so the floor is different every
time the game loads.

`tile()` marks an object as occupying a square on a grid. With
`tile(isObstacle=True)` on the walls, Kaplay can work out paths through the map
for you.

> **Note for PyIDE**
>
> The bundled sprite pack has no atlas image in it, so to run this you need to
> supply your own `dungeon.png` (Open Game Art has plenty) and load it by URL.
> Everything after the load is identical.

> **Exercise**
>
> Make the chests play their `open` animation when space is pressed.

---

# 13 — Using state to handle AI

A **state machine** gives an object a mode — idle, attack, move — and different
behaviour in each. It is how nearly all simple game AI is written.

```python
from kaypy import *

kaplay(width=800, height=600, background=[0, 0, 0])

loadSprite("bean", "images/bean.png")
loadSprite("ghosty", "images/ghosty.png")
loadSprite("coin", "images/coin.png")

SPEED = 320

player = add([
    sprite("bean"),
    pos(100, 300),
    area(),
    anchor("center"),
    "player",
])

enemy = add([
    sprite("ghosty"),
    pos(600, 300),
    area(),
    anchor("center"),
    # Start in "move", and these are the only three modes it can be in.
    state("move", ["idle", "attack", "move"]),
])

# --- what each state means -------------------------------------------------

# Idle: stand still for half a second, then attack.
enemy.onStateEnter("idle", lambda: wait(0.5, lambda: enemy.enterState("attack")))


def start_attack():
    if player.exists():
        direction = player.pos.sub(enemy.pos).unit()
        add([
            sprite("coin"),
            pos(enemy.pos),
            anchor("center"),
            area(),
            move(direction, 400),
            offscreen(destroy=True),
            "bullet",
        ])
    wait(1, lambda: enemy.enterState("move"))


enemy.onStateEnter("attack", start_attack)

# Move: chase for two seconds, then go idle.
enemy.onStateEnter("move", lambda: wait(2, lambda: enemy.enterState("idle")))

# This runs every frame, but ONLY while the state is "move".
enemy.onStateUpdate("move", lambda: enemy.moveTo(player.pos, 120))

# --- getting hit -----------------------------------------------------------

player.onCollide("bullet", lambda b: (b.destroy(), addKaboom(player.pos),
                                      player.destroy()))

onKeyDown("left",  lambda: player.move(-SPEED, 0))
onKeyDown("right", lambda: player.move(SPEED, 0))
onKeyDown("up",    lambda: player.move(0, -SPEED))
onKeyDown("down",  lambda: player.move(0, SPEED))
```

**What each part does.**

`state(starting, [all_possible])` gives the object a mode. It starts in the
first one, and can only ever be in one of the listed modes.

`.onStateEnter(name, action)` runs **once**, the moment the object enters that
state. `.onStateUpdate(name, action)` runs **every frame** while it is in that
state — think of it as an `onUpdate` that only applies to one mode.

`.enterState(name)` switches modes. Notice that every state ends by scheduling
a switch to another one with `wait()`, which is what makes the cycle turn:
move → idle → attack → move.

`player.exists()` checks the player hasn't already been destroyed. Without it,
the enemy would try to aim at something that isn't there.

`player.pos.sub(enemy.pos).unit()` is the direction from the enemy to the
player: subtract the positions to get the difference, then `.unit()` shrinks it
to length 1 so it is a pure direction.

`move(direction, speed)` is a component that makes an object drift in a
straight line forever. `offscreen(destroy=True)` cleans it up once it leaves
the screen — without that, every bullet ever fired is still in memory.

`addKaboom(position)` plays Kaplay's explosion animation.

> **If you have seen the JavaScript version of this lesson**
>
> It used `async` and `await` inside `onStateEnter`, which needed explaining
> and apologising for. Python has no equivalent here, so instead each state
> schedules the next one with `wait(seconds, action)`. Same behaviour, one less
> concept.

---

# Quick reference

Everything used in this guide.

### Starting up
| | |
|---|---|
| `kaplay(width=, height=, background=)` | start the engine, always first |
| `loadSprite(name, path)` | make a picture available |
| `loadSprite(name, [paths], anims={})` | build frames from several pictures |
| `loadSprite(name, path, sliceX=, anims={})` | cut a spritesheet into frames |
| `loadSpriteAtlas(path, {...})` | name many sprites inside one image |
| `loadSound(name, path)` | make a sound available |
| `setGravity(n)` / `setBackground(r, g, b)` | world settings |

### Making things
| | |
|---|---|
| `add([components])` | build a game object |
| `obj.add([components])` | build a **child** of that object |
| `obj.destroy()` | remove it |
| `get("tag")` | every object with that tag |
| `addLevel(layout, config)` | build a map out of characters |
| `addKaboom(pos)` | the explosion animation |

### Components
| | |
|---|---|
| `sprite(name)` | draw a picture — gives `.play()`, `.flipX`, `.curAnim()` |
| `text(str, size=, width=)` | draw words — gives `.text` |
| `rect(w, h, radius=)` / `circle(r)` | draw a shape |
| `pos(x, y)` | position — gives `.move()`, `.moveTo()`, `.pos` |
| `area()` | collision box — gives `.onCollide()`, `.onClick()`, `.isHovering()` |
| `body(isStatic=, mass=, jumpForce=)` | physics — gives `.jump()`, `.isGrounded()`, `.onGround()` |
| `state(start, [all])` | modes — gives `.onStateEnter()`, `.onStateUpdate()`, `.enterState()` |
| `anchor("center")` | which point `pos()` refers to |
| `scale(n)`, `color(r,g,b)`, `opacity(n)`, `outline(n)`, `z(n)` | appearance |
| `fixed()` | ignore the camera |
| `move(dir, speed)` | drift in a straight line |
| `offscreen(destroy=True)` | clean up when it leaves the screen |
| `tile(isObstacle=)` | occupies a square on a grid |
| `"a string"` | a tag |

### The mouse, beyond clicking

`onClick` tells you that someone clicked. To aim at the cursor, drag something,
or hold a button down, you need more:

```python
@onMousePress("left")
def shoot():
    direction = (mousePos() - player.pos).unit()
    add([sprite("bean"), pos(player.pos), move(direction, 500), lifespan(2)])


@onUpdate
def charging():
    if isMouseDown("left"):        # held, not just pressed
        power.text = "charging"
```

Buttons are named `"left"`, `"right"` and `"middle"`. Leave the name out and
you get the left one.

### Drawing things that are not game objects

A health bar, an aim line, a grid — those are marks on the screen for one
frame, not things in the world. They go inside `@onDraw`, and the drawing
functions only work there:

```python
@onDraw
def hud():
    drawRect(pos=vec2(20, 20), width=200, height=16, color=rgb(60, 0, 0),
             fixed=True)
    drawRect(pos=vec2(20, 20), width=20 * player.hp, height=16,
             color=rgb(220, 40, 40), fixed=True)
    drawLine(p1=player.pos, p2=mousePos(), width=2, color=rgb(255, 255, 0))
```

**`fixed=True` means "ignore the camera"**, which is what a HUD wants — without
it, your health bar slides off the screen the moment the camera moves. Leave it
out and the drawing sits in the world, next to whatever it belongs to.

### Hit points, and a high score that lasts

```python
enemy = add([sprite("ogre"), pos(300, 200), area(), health(3), "enemy"])


@enemy.onDeath
def slain():
    addKaboom(enemy.pos)
    enemy.destroy()
```

`health(3)` gives the enemy `.hp`, `.hurt()`, `.heal()` and `.onDeath()`. You
could write `enemy.hp = 3` yourself — and it works until the third place in
your game that takes a point off, because now three different lines have to
remember to check for zero. The one that forgets is the enemy that can't be
killed.

`onDeath` runs **once**, even if two bullets hit in the same frame.

```python
best = getData("best_score", 0)

if score > best:
    setData("best_score", score)
```

That is remembered after you close the game. In PyIDE it lives in the browser;
on your own computer it is a small `kaypy-data.json` file next to your game,
which you can open and read — and delete, if you want to start over.

### Events
| | |
|---|---|
| `onUpdate(action)` | every frame |
| `onUpdate("tag", action)` | every frame, for each tagged object |
| `onKeyDown/onKeyPress/onKeyRelease(key, action)` | held / pressed once / let go |
| `onClick(action)` | left mouse button clicked anywhere |
| `onMousePress("left", action)` | once, when a mouse button goes down |
| `onMouseRelease` / `onMouseDown` / `onMouseMove` | came up / is held / the mouse moved |
| `onDraw(action)` | draw straight to the screen, after everything else |
| `obj.onClick(action)` | that object clicked (needs `area()`) |
| `obj.onCollide("tag", action)` | touched something tagged |
| `obj.onCollideUpdate` / `obj.onCollideEnd` | while touching / when it stops |
| `wait(seconds, action)` | once, after a delay |
| `loop(seconds, action)` | over and over |

Every one of these can also go above a function with an `@`, with the action
left off: `@onKeyPress("space")`, `@player.onCollide("coin")`, `@wait(3)`,
`@onUpdate("enemy")`. `tween` is the exception — see below.

### Tweens — moving something smoothly

A tween changes a number over time. You say where it starts, where it ends, how
long it takes, and what to do with each value along the way.

```python
box = add([rect(60, 60), pos(100, 300), opacity(1)])


def move_box(x):
    box.pos.x = x


def fade_box(a):
    box.opacity = a


# slide right over half a second
tween(100, 600, 0.5, move_box)

# fade out, then say so
tween(1.0, 0.0, 1.0, fade_box).then(lambda: print("gone"))
```

Unlike the `on…` functions, `tween` is **not** a decorator — what it takes is a
setter that runs many times with a different value each frame, not a handler
that runs once — so write the setter as an ordinary `def` above it, as here.

You will see the same thing written with a lambda:

```python
tween(100, 600, 0.5, lambda x: setattr(box.pos, "x", x))
```

`setattr(thing, "name", value)` means `thing.name = value`; it is there only
because a lambda cannot contain an assignment. It works, and it is harder to
read than the version above.

The fifth argument is the **easing** — the shape of the movement. Without one
everything travels at a flat, robotic pace.

```python
tween(100, 600, 0.5, move_box, easings.easeOutBounce)
```

There are thirty-one, named `easeInX`, `easeOutX` and `easeInOutX` for X in
Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Back, Elastic and Bounce, plus
`easings.linear` for none at all. `easeOut...` arrives slowing down, which is
what most things in life do; `easeOutBack` and `easeOutElastic` overshoot and
spring back. Any Python function from 0–1 to 0–1 works too.

| | |
|---|---|
| `tween(start, end, seconds, setter, ease)` | change a value over time |
| `tween(vec2(...), vec2(...), ...)` | a position, both at once |
| `easings.easeOutBounce` | one of thirty-one curves |
| `.then(action)` | run something when it finishes |
| `.cancel()` | stop it where it is |
| `.finish()` | jump it to the end |
| `obj.tween(...)` | the same, tied to an object with `timer()` |

### Scenes
| | |
|---|---|
| `scene("name", function)` | define one |
| `go("name", value)` | switch to it, optionally passing something |

### Useful values
| | |
|---|---|
| `width()`, `height()`, `center()` | the size and middle of the window |
| `dt()` | seconds since the last frame |
| `vec2(x, y)` | a position — has `.x`, `.y`, `.sub()`, `.unit()` |
| `rand(a, b)`, `randi(a, b)`, `choose(list)` | randomness |
| `mousePos()`, `toWorld(pos)` | on screen / in the world |
| `setCamPos(pos)`, `setCamScale(n)`, `shake(n)` | the camera |
| `play(name, loop=, paused=, volume=)` | play a sound |
| `debug.inspect = True` | show every collision box (or press F1) |

---

# When something doesn't work

**"has no attribute 'jump'"** — the object is missing the component that
provides it. `.jump()` and `.isGrounded()` come from `body()`; `.move()` from
`pos()`; `.onCollide()` from `area()`.

**A collision never fires** — one of the two objects has no `area()`. Turn on
`debug.inspect = True` and look at the boxes.

**Nothing appears at all** — you called `scene()` but never `go()`, or you
loaded a sprite but never added it.

**The sprite is invisible but the game runs** — check the path. It should look
like `"images/bean.png"` or `"dungeon/elf_m.png"`, and the file must be one the
Sprites panel lists. The two packs are separate folders; a dungeon sprite is not
in `images/`.

**Every frame is half one pose and half the next** — `sliceX` doesn't match the
spritesheet. Use the number the Sprites panel inserted.

**The animation is stuck on one frame** — you are calling `.play()` every
frame. Guard it with `if obj.curAnim() != "run"`.

**The score never changes** — a function inside another function needs
`nonlocal score`, or `global score` if the score lives at the top level of the
file.

**The keys do nothing** — check the key name. `onKeyDown("space")` is right;
`onKeyDown("jump")` is not a key and the engine will say so when you press Run.
The names are `"left"`, `"right"`, `"up"`, `"down"`, `"space"`, `"enter"`,
`"escape"`, `"tab"`, `"shift"`, `"ctrl"`, `"alt"`, `"backspace"`, and any
single letter or digit.

**You cannot type in the editor** — a game is still running. Press **Stop**.
