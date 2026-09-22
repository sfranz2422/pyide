# Coin Collector

You are going to build a platform game. A hero runs and jumps around a cave,
grabbing coins while ghosts rain down through a hole in the ceiling. Touch a
ghost and you explode. The longer you survive, the faster they come.

We will build it in **13 steps**. After every single one you can press **Run**
and see something new working. Nothing is left until the end.

## Before you start

Two things to know about this editor:

- **Press Run to play.** The game appears on the right. Click the picture once
  before using the arrow keys, or the keys will scroll the page instead.
- **The Sprites button** shows all 60 pictures you can use, with their names
  and sizes. You will need it in a moment.

You cannot copy the code out of these notes. That is on purpose — typing it is
how it gets into your head. You will make mistakes, and fixing them is the part
where you actually learn something.

Throughout, you will see boxes like this one:

> **Make it your own**
>
> These point out things you can change without breaking anything. Change them.
> A game that looks exactly like everyone else's is no fun to show anybody.

---

# Step 1 — A window and a hero

Delete everything in `main.py` and type this:

```python
WIDTH = 960
HEIGHT = 640
TITLE = "Coin Collector"

SKY = (52, 152, 219)

player = Actor("bean", (160, 500))


def draw():
    screen.fill(SKY)
    player.draw()
```

Press **Run**. You should see a blue window with a bean sitting in it.

**What each part does.** `WIDTH`, `HEIGHT` and `TITLE` are special names — Pygame
Zero looks for them and builds your window to match. `SKY` is a colour, written
as three numbers: red, green and blue, each from 0 to 255.

An **Actor** is a picture that knows where it is. `Actor("bean", (160, 500))`
means "load the bean picture and put its middle at x=160, y=500".

`draw()` is also special. Pygame Zero calls it about 60 times a second to
repaint the window. `screen.fill(SKY)` paints the whole window blue, then
`player.draw()` stamps the bean on top. Order matters — if you filled *after*
drawing the bean, you would paint straight over it.

> **Make it your own**
>
> `bean` is just one of 60 sprites. Click **Sprites** and pick a different hero
> — `jumpy`, `mark`, `dino` and `bobo` all work well. The panel shows each
> sprite's size; anything up to about bean's 64 by 54 is a safe swap. Something
> enormous like `gigagantrum` (186 by 204) will not fit through the gaps in the
> cave you are about to build.
>
> Change `SKY` too. `(30, 30, 46)` is a night cave, `(250, 200, 150)` is desert.

---

# Step 2 — Moving left and right

Add these two pieces. The constant goes near the top with the others, the
function goes at the bottom.

```python
MOVE_SPEED = 450
```

```python
def update(dt):
    if keyboard.left:
        player.x -= MOVE_SPEED * dt
    elif keyboard.right:
        player.x += MOVE_SPEED * dt
```

Run it, click the picture, and use the arrow keys.

**What `dt` means.** `update(dt)` is the other special function — Pygame Zero
calls it 60 times a second too, and hands it `dt`, the number of **seconds since
the last frame**. That is usually about `0.016`.

Why bother? Because computers run at different speeds. If you wrote
`player.x -= 8`, the bean would move 8 pixels per frame — fast on a quick
computer, slow on a tired one. Multiplying by `dt` means `MOVE_SPEED` is
measured in **pixels per second**, and the bean moves at the same speed
everywhere. You will see `* dt` all over this program for exactly that reason.

> **Make it your own**
>
> `MOVE_SPEED = 450` is a brisk walk. Try `250` for something heavy and
> deliberate, or `700` for a character that skids around. This one number
> changes how the whole game feels, so play with it.

---

# Step 3 — Falling

Right now the bean floats. Add gravity.

```python
GRAVITY = 1600
```

```python
player_vy = 0.0
```

And change `update` to this:

```python
def update(dt):
    global player_vy

    if keyboard.left:
        player.x -= MOVE_SPEED * dt
    elif keyboard.right:
        player.x += MOVE_SPEED * dt

    player_vy += GRAVITY * dt
    player.y += player_vy * dt
```

Run it. The bean drops off the bottom of the window and is gone. **That is
correct** — there is no ground yet. We build that next.

**What is happening.** `player_vy` is the bean's **vertical velocity** — how fast
it is moving up or down, in pixels per second. Every frame we do two things:

1. Gravity makes the velocity more downward: `player_vy += GRAVITY * dt`
2. The velocity moves the bean: `player.y += player_vy * dt`

That is real physics, and it is only two lines. Note that **y gets bigger going
down** the screen, which is upside down from maths class. Positive velocity
means falling.

**Why `global`.** `player_vy` was created outside the function. Without the
`global` line, Python assumes anything you assign to inside a function is a new
private variable that vanishes when the function ends. `global player_vy` says
"no, I mean the one outside — change that one." Forget this line and the bean
simply will not fall, with no error message to tell you why.

---

# Step 4 — Building the cave

Now the level. This is the biggest single piece of typing in the project.

```python
TILE = 64

LEVEL = [
    "######...######",
    "#.............#",
    "#..##.....##..#",
    "#.............#",
    "##...........##",
    "#.............#",
    "#...#######...#",
    "#.............#",
    "#.............#",
    "######...######",
]
```

And underneath, the loop that turns those strings into something the game can
use:

```python
solid_rects = []
tile_images = []

for row_index, row in enumerate(LEVEL):
    for col_index, square in enumerate(row):
        if square != "#":
            continue

        x = col_index * TILE
        y = row_index * TILE
        solid_rects.append(Rect(x, y, TILE, TILE))

        open_above = row_index > 0 and LEVEL[row_index - 1][col_index] != "#"
        tile_images.append(("grass" if open_above else "steel", x, y))
```

Then add a function to draw them, and call it from `draw`:

```python
def draw_world():
    for image_name, x, y in tile_images:
        screen.blit(image_name, (x, y))
```

```python
def draw():
    screen.fill(SKY)
    draw_world()
    player.draw()
```

Run it. A cave. The bean still falls straight through — collision comes next.

**How the map works.** `LEVEL` is a picture made of text. `#` is a solid block,
`.` is empty air. It is 15 characters wide and 10 rows tall, and each block is
`TILE` (64) pixels square — which is exactly the 960 by 640 window.

The double loop walks every row, then every character in that row.
`enumerate` hands you both the position and the thing at it, so `row_index` is
which row you are on and `square` is the character there. `continue` means
"skip the rest of this loop and go to the next character" — so empty squares
are ignored.

For each `#` we store two things: a **Rect** (an invisible rectangle, for
bumping into) and an entry in `tile_images` (for drawing). Keeping them
separate sounds odd but it is deliberate: collision is about maths, drawing is
about pictures, and they are easier to think about apart.

`open_above` checks whether the square directly above is empty. If it is, this
block is a surface you could stand on, so it gets grass. Otherwise it is buried,
so it gets steel. One line, and the cave looks hand-made.

> **Make it your own**
>
> Redraw the level. Move platforms, make the gaps wider, cut new tunnels. The
> only hard rules are that it must stay 15 characters by 10 rows, and the gaps
> in the top and bottom rows should line up — the ghosts come in the top one
> and leave through the bottom one.
>
> Swap `grass` and `steel` for `sand`, `snow`, `door` or `note`. Those are the
> only other sprites that are exactly 64 pixels square, so they line up with the
> grid. Anything else will leave gaps or overlap its neighbours.

---

# Step 5 — Standing on the ground

Two functions do all the collision work in this game. Add them above `update`:

```python
def move_horizontally(actor, dx):
    actor.x += dx
    hit_wall = False

    for wall in solid_rects:
        if actor.colliderect(wall):
            if dx > 0:
                actor.right = wall.left
            elif dx < 0:
                actor.left = wall.right
            hit_wall = True

    return hit_wall


def move_vertically(actor, dy):
    actor.y += dy
    result = None

    for wall in solid_rects:
        if actor.colliderect(wall):
            if dy > 0:
                actor.bottom = wall.top
                result = "ground"
            elif dy < 0:
                actor.top = wall.bottom
                result = "ceiling"

    return result
```

Now rewrite `update` to use them:

```python
on_ground = False


def update(dt):
    global player_vy, on_ground

    if keyboard.left:
        move_horizontally(player, -MOVE_SPEED * dt)
    elif keyboard.right:
        move_horizontally(player, MOVE_SPEED * dt)

    player_vy += GRAVITY * dt
    landed = move_vertically(player, player_vy * dt)

    if landed == "ground":
        player_vy = 0
        on_ground = True
    else:
        on_ground = False
```

Run it. The bean falls and **lands**. Walk into a wall and it stops.

**The trick here** is moving one direction at a time. Each function moves the
actor, then checks every wall, and if it ended up *inside* one, shoves it back
out to the edge it came from.

`actor.right = wall.left` reads like English: put my right edge exactly where
the wall's left edge is. Pygame Zero understands `left`, `right`, `top`,
`bottom`, `x` and `y` on any Actor, and setting one moves the whole sprite.

Why separate the two directions? If you moved diagonally and then tried to
untangle it, you could not tell whether you hit the wall from the side or landed
on top of it — and the player would snag on the corner of every block. Doing
sideways first, then vertical, removes the guesswork entirely. This is a real
technique used in real platform games.

`move_vertically` returns `"ground"`, `"ceiling"` or `None` so the caller knows
*what* it hit. Landing on the ground and banging your head need different
responses.

---

# Step 6 — Jumping

Add the constant and three lines in `update`.

```python
JUMP_VELOCITY = -820
```

Inside `update`, after the left/right block and before gravity:

```python
    if (keyboard.space or keyboard.up) and on_ground:
        player_vy = JUMP_VELOCITY
        on_ground = False
        sounds.swoosh.play()
```

Also handle banging your head — change the landing check to:

```python
    if landed == "ground":
        player_vy = 0
        on_ground = True
    elif landed == "ceiling":
        player_vy = 0
        on_ground = False
    else:
        on_ground = False
```

Run it. Space or Up to jump.

**Why negative?** Up the screen is a smaller y, so an upward kick is a negative
velocity. Gravity immediately starts adding to it, so the jump slows, stops, and
turns into a fall — an arc, for free, out of the same two lines from Step 3.

**`and on_ground`** is what stops you flying. Without it you could press space
in mid-air forever.

You can work out how high the bean jumps:

```
jump height = JUMP_VELOCITY squared, divided by (2 * GRAVITY)
            = 820 * 820 / (2 * 1600)
            = about 210 pixels
```

That is a little over three tiles. Handy to know when you design a level — if a
platform is more than three tiles above another one, you cannot get up there.

> **Make it your own**
>
> `JUMP_VELOCITY = -1000` gives a floaty moon jump. `-600` is a stubby hop.
> Change `GRAVITY` instead and the whole game changes character — `800` feels
> like swimming, `2600` feels like a brick.
>
> Swap the sound. Try `sounds.thump.play()`, `sounds.swing.play()` or
> `sounds.beep.play()`. The Sprites panel lists every sound you have.

---

# Step 7 — The coin

Add the list of places a coin can appear, a value, and the coin itself:

```python
COIN_VALUE = 5

COIN_SPOTS = [
    (128, 550), (832, 550),
    (320, 358), (640, 358),
    (96, 230), (864, 230),
    (224, 102), (736, 102),
]
```

```python
coin = Actor("coin", COIN_SPOTS[0])
score = 0
```

A function to collect it:

```python
def take_coin():
    global score

    score += COIN_VALUE
    sounds.ding.play()

    choices = [spot for spot in COIN_SPOTS if spot != coin.pos]
    new_spot = random.choice(choices)

    coin.pos = new_spot
    coin.y = new_spot[1] - 40
    animate(coin, duration=0.3, y=new_spot[1], tween="bounce_end")
```

That uses `random`, so add this at the very top of the file, above everything:

```python
import random
```

Then draw the coin and check for pickups:

```python
def draw():
    screen.fill(SKY)
    draw_world()
    coin.draw()
    player.draw()
```

And at the end of `update`:

```python
    if player.colliderect(coin):
        take_coin()
```

Run it. Collect coins. They jump to a new spot each time.

**The interesting line** is the one with the square brackets:

```python
choices = [spot for spot in COIN_SPOTS if spot != coin.pos]
```

That is a **list comprehension**. Read it right to left: go through `COIN_SPOTS`,
keep every `spot` that is not where the coin already is, and make a list of
those. Without it, the coin could "move" to the spot it is already on, and it
would look broken.

**`animate`** is a gift from Pygame Zero. It changes a property smoothly over
time, all by itself. We drop the coin 40 pixels above its new home and then
animate it down with `tween="bounce_end"`, so it lands with a little bounce.
Other tweens worth trying: `"accelerate"`, `"elastic_end"`, `"linear"`.

> **Make it your own**
>
> Use a different pickup — `apple`, `heart`, `grape`, `pizza` or `key` all look
> good. Change `COIN_VALUE`. Add more entries to `COIN_SPOTS`, or move the ones
> that are there.
>
> Careful: every spot must sit **on top of a platform** in your level, or the
> coin will float in mid-air where nobody can reach it. The y values above are
> chosen to sit just above a solid row.

---

# Step 8 — Showing the score

Add this at the end of `draw`:

```python
    screen.draw.text(
        f"Score: {score}",
        topleft=(20, 16),
        fontsize=34,
        color="white",
        owidth=1,
        ocolor="black",
    )
```

Run it. A score in the corner that goes up.

**The f-string.** `f"Score: {score}"` builds a piece of text with a value dropped
into the middle. The `f` before the quote is what makes the curly braces work.
Without it you would literally see `Score: {score}` on screen.

**`owidth` and `ocolor`** draw an outline around the letters. It looks like a
small detail, but white text on a light background is unreadable without it, and
your background changes as the player moves around. Outlined text is readable on
anything.

> **Make it your own**
>
> Move it with `topleft`, or centre it with `center=(WIDTH // 2, 30)`. Change
> `fontsize`. Use `color=(255, 220, 0)` for gold. Add a second line showing
> something else — how many ghosts are on screen, say: `len(enemies)` once you
> have done the next step.

---

# Step 9 — The ghosts

Now the enemies. Add the constants:

```python
SPAWN_SLOW = 5.0
SPAWN_FAST = 0.5
SCORE_FOR_MAX_DIFFICULTY = 50

ENEMY_LIFETIME = 15.0
ENEMY_TURN_TIME = 2.0
ENEMY_SPAWN_X = 480
ENEMY_SPEEDS = [-280, 280, 100, -100]
```

The list they live in, and a timer:

```python
enemies = []
spawn_timer = SPAWN_SLOW
```

Then three functions:

```python
def spawn_enemy():
    enemy = Actor("ghosty", (ENEMY_SPAWN_X, -40))
    enemies.append({
        "actor": enemy,
        "vx": random.choice(ENEMY_SPEEDS),
        "vy": 0.0,
        "life": ENEMY_LIFETIME,
        "turn": ENEMY_TURN_TIME,
        "turned": False,
    })


def update_enemies(dt):
    for enemy in enemies[:]:
        actor = enemy["actor"]

        if move_horizontally(actor, enemy["vx"] * dt):
            enemy["vx"] = -enemy["vx"]

        enemy["vy"] += GRAVITY * dt
        if move_vertically(actor, enemy["vy"] * dt):
            enemy["vy"] = 0

        if not enemy["turned"]:
            enemy["turn"] -= dt
            if enemy["turn"] <= 0:
                enemy["vx"] = random.choice([-280, 280])
                enemy["turned"] = True

        enemy["life"] -= dt
        if enemy["life"] <= 0 or actor.top > HEIGHT:
            enemies.remove(enemy)


def spawn_rate():
    progress = min(score / SCORE_FOR_MAX_DIFFICULTY, 1)
    return SPAWN_SLOW - (SPAWN_SLOW - SPAWN_FAST) * progress
```

Call them from `update`:

```python
    update_enemies(dt)

    spawn_timer -= dt
    if spawn_timer <= 0:
        spawn_enemy()
        spawn_timer = spawn_rate()
```

`spawn_timer` is changed inside the function, so add it to the `global` line at
the top of `update`:

```python
    global player_vy, on_ground, spawn_timer
```

And draw them, before the player in `draw`:

```python
    for enemy in enemies:
        enemy["actor"].draw()
```

Run it. Ghosts fall in through the ceiling, bounce around, and drop out through
the hole in the floor.

**Each ghost is a dictionary** — a bundle of labelled values. `enemy["vx"]` is
its sideways speed, `enemy["life"]` is how long it has left. We could have made a
class, but a dictionary is enough for something this simple.

**`for enemy in enemies[:]`** — notice the `[:]`. That makes a *copy* of the list
to loop over, because we remove ghosts from the real list inside the loop.
Changing a list while looping over it makes Python skip items, and you get
ghosts that refuse to die. The `[:]` costs nothing and saves a baffling bug.

**The one turn.** Look carefully at the `turned` flag. Each ghost changes
direction **exactly once**, two seconds after it appears — not every two
seconds. That matters more than it sounds. A ghost that keeps flip-flopping
never travels far enough sideways to reach the edge of a platform, so it gets
stuck up there forever, right where your coins are. One turn and it wanders off
and falls out of the world, which is what you want.

**Nothing here looks at the player.** There is no chasing code anywhere. Ghosts
just fall, bounce and drift. If one seems to be hunting you, that is your
imagination — or the level funnelling it toward you.

**`spawn_rate`** makes the game harder as you improve. At score 0 you get a ghost
every 5 seconds; by score 50 it is every half second, and it slides smoothly in
between. `min(..., 1)` stops `progress` going past 1 once you are past 50.

> **Make it your own**
>
> Pick a different villain. `spike`, `apple`, `bomb`, `bobo` and `brock` have
> all been tested in this level and find their way out every time.
>
> **One warning, and it is a real one.** Your villain must be **under about 128
> pixels wide**. Above that it cannot fit between the big platform and the
> ledges either side of it, so it bounces back and forth up there forever —
> right where your coins are — instead of dropping out of the world. `boom`,
> `jacob`, `gazer`, `kaboom` and `gigagantrum` all get stuck. The Sprites panel
> shows you every width.
>
> If you also redraw your level, that number changes with it. The rule behind
> it is that the gap between the edge of a platform and whatever hangs above it
> has to be wider than your sprite, or the sprite hits the overhang before it
> reaches the edge it was trying to walk off.
>
> Change `ENEMY_SPEEDS`, or `ENEMY_TURN_TIME`. Make the game brutal with
> `SPAWN_FAST = 0.2`, or gentle with `SPAWN_SLOW = 8.0`.

---

# Step 10 — Dying

## First, a tidy-up

`update` is getting long, and it is about to get longer. Before adding
anything, move everything about the player into its own function. Cut those
lines out of `update` and paste them into this:

```python
def update_player(dt):
    global player_vx, player_vy, on_ground

    player_vx = 0
    if keyboard.left:
        player_vx = -MOVE_SPEED
    elif keyboard.right:
        player_vx = MOVE_SPEED

    move_horizontally(player, player_vx * dt)

    if (keyboard.space or keyboard.up) and on_ground:
        player_vy = JUMP_VELOCITY
        on_ground = False
        sounds.swoosh.play()

    player_vy += GRAVITY * dt
    landed = move_vertically(player, player_vy * dt)

    if landed == "ground":
        player_vy = 0
        on_ground = True
    elif landed == "ceiling":
        player_vy = 0
        on_ground = False
    else:
        on_ground = False
```

Then `update` just calls it:

```python
def update(dt):
    global spawn_timer

    update_player(dt)
    update_enemies(dt)

    spawn_timer -= dt
    if spawn_timer <= 0:
        spawn_enemy()
        spawn_timer = spawn_rate()

    if player.colliderect(coin):
        take_coin()
```

Run it. **Nothing has changed** — the game plays exactly as before. That is the
whole point of tidying up: the program does the same thing, but it is easier to
read and safer to add to.

You will notice `player_vy` and `on_ground` moved out of `update`'s `global`
line and into `update_player`'s, because that is where they are changed now.
Also new is `player_vx`, which holds sideways speed the same way `player_vy`
holds vertical speed. Add it up with your other variables:

```python
player_vx = 0.0
```

Splitting a long function into smaller named ones is the single most useful
habit in programming. A function called `update_player` tells you what it does;
forty lines in the middle of `update` do not.

## Now, dying

The game needs to be losable. Add a state and the constants:

```python
DEATH_PAUSE = 1.0
```

```python
state = "play"
best_score = 0
death_timer = 0.0
player_vx = 0.0
```

A function for dying, and one to start over:

```python
def player_dies():
    global state, death_timer, best_score

    state = "dead"
    death_timer = DEATH_PAUSE
    sounds.small_boom.play()

    if score > best_score:
        best_score = score


def reset_game():
    global player_vy, on_ground, score, spawn_timer, death_timer

    player.pos = (160, 500)
    player_vy = 0.0
    on_ground = False

    coin.pos = random.choice(COIN_SPOTS)
    enemies.clear()

    score = 0
    spawn_timer = SPAWN_SLOW
    death_timer = 0.0
```

Now restructure `update` so it checks the state first. Put this right after the
`global` line:

```python
    if state == "dead":
        death_timer -= dt
        if death_timer <= 0:
            reset_game()
            state = "play"
        return
```

Add `state` and `death_timer` to the `global` line:

```python
    global player_vy, on_ground, spawn_timer, state, death_timer
```

And at the end of `update`, the two ways to die:

```python
    for enemy in enemies:
        if player.colliderect(enemy["actor"]):
            player_dies()
            return

    if player.top > HEIGHT or player.bottom < 0:
        player_dies()
```

Finally, call `reset_game()` on the very last line of the file so the game
starts clean:

```python
reset_game()
```

Run it. Touch a ghost, or fall down the hole, and after a second the game
restarts.

**`return` ends a function early.** After `player_dies()` there is no point
checking the remaining ghosts — you are already dead. `return` walks out
immediately.

**Why a `state` variable?** Your game is now in one of several situations, and it
should behave differently in each. Rather than a tangle of flags, one word says
which situation you are in. In the last step we will add a third: `"menu"`.

> **Make it your own**
>
> `DEATH_PAUSE` is how long you sit looking at your mistake. Change the death
> sound to `screech`, `burp` or `scary_fading`.

---

# Step 11 — The explosion

A death deserves more than a sound. Add a particle list:

```python
particles = []
```

Some maths, at the top with your other import:

```python
import math
```

Add this to the end of `player_dies`:

```python
    for _ in range(60):
        angle = random.uniform(0, 6.283)
        speed = random.uniform(60, 300)
        particles.append({
            "x": player.x,
            "y": player.y,
            "vx": speed * math.cos(angle),
            "vy": speed * math.sin(angle),
            "life": 1.0,
        })
```

A function to move them:

```python
def update_particles(dt):
    for particle in particles[:]:
        particle["x"] += particle["vx"] * dt
        particle["y"] += particle["vy"] * dt
        particle["vy"] += 400 * dt
        particle["life"] -= dt
        if particle["life"] <= 0:
            particles.remove(particle)
```

Call it from the dead branch of `update`:

```python
    if state == "dead":
        update_particles(dt)
        death_timer -= dt
        ...
```

Clear them in `reset_game`, next to `enemies.clear()`:

```python
    particles.clear()
```

And draw them, at the end of `draw`:

```python
    for particle in particles:
        size = max(2, int(6 * particle["life"]))
        screen.draw.filled_rect(
            Rect(particle["x"], particle["y"], size, size),
            (255, 235, 120),
        )
```

Run it and die on purpose. Sixty sparks fly out and fall.

**How to throw things in every direction.** Picking a random `x` and `y` speed
gives you a square-shaped spray. To get a circle you pick a random **angle**
instead, then use sine and cosine to turn that angle into an x and a y. A full
circle is 6.283 radians — that is 2 times pi. This is the single most useful
thing trigonometry does in games.

`particle["vy"] += 400 * dt` is gravity again, gentler than the player's, so the
sparks arc downward. And `life` counts from 1 down to 0, doing double duty: it
says when to delete the particle, and `int(6 * life)` makes it shrink as it dies.

> **Make it your own**
>
> `range(60)` is the number of sparks — try 200. Change the colour, or the
> speed range. Make them shrink faster by changing `"life": 1.0` to `0.5`.
> You could also call this on collecting a coin, in gold, for a nice pickup
> sparkle.

---

# Step 12 — Screen shake and the red flash

Two effects that sell the impact. Constants first:

```python
FLASH_TIME = 0.3
SHAKE_TIME = 0.3
FLASH_RED = (255, 50, 35)
```

```python
flash_timer = 0.0
shake_timer = 0.0
shake_x = 0
shake_y = 0
flash_overlay = None
```

Start them both in `player_dies`:

```python
    flash_timer = FLASH_TIME
    shake_timer = SHAKE_TIME
```

with `flash_timer` and `shake_timer` added to its `global` line. Reset them in
`reset_game` too, both to `0.0`.

Now the shake, at the top of `update` just after the `global` line (and add
`flash_timer`, `shake_timer`, `shake_x`, `shake_y` to that line):

```python
    if shake_timer > 0:
        shake_timer -= dt
        strength = 10 * max(shake_timer / SHAKE_TIME, 0)
        shake_x = random.uniform(-strength, strength)
        shake_y = random.uniform(-strength, strength)
    else:
        shake_x = 0
        shake_y = 0

    if flash_timer > 0:
        flash_timer -= dt
```

**Here is the part that changes existing code.** For the shake to work, every
single thing must be drawn nudged by the same amount. So instead of calling
`.draw()` on each actor, everything goes through one function that adds the
offset. Add these:

```python
def blit_at(image_name, left, top):
    screen.blit(image_name, (left + shake_x, top + shake_y))


def draw_actor(actor):
    blit_at(actor.image, actor.left, actor.top)
```

Change `draw_world` to use it:

```python
def draw_world():
    for image_name, x, y in tile_images:
        blit_at(image_name, x, y)
```

And in `draw`, replace every `something.draw()` with `draw_actor(something)`:

```python
    draw_world()
    draw_actor(coin)

    for enemy in enemies:
        draw_actor(enemy["actor"])

    if state == "play":
        draw_actor(player)
```

Also add the shake to the particles' `Rect`:

```python
            Rect(particle["x"] + shake_x, particle["y"] + shake_y, size, size),
```

Now the red flash. Add this function:

```python
def make_flash_overlay():
    sheet = screen.surface.copy()
    sheet.fill(FLASH_RED)
    return sheet
```

And at the very end of `draw`:

```python
    if flash_timer > 0:
        global flash_overlay
        if flash_overlay is None:
            flash_overlay = make_flash_overlay()
        flash_overlay.set_alpha(int(200 * (flash_timer / FLASH_TIME)))
        screen.blit(flash_overlay, (0, 0))
```

The `global flash_overlay` must be the **first line inside `draw`**, not buried
in the middle — Python insists. Move it up there.

Run it and die. The world jolts and the screen flashes red.

**Why the shake works.** Nothing actually moves. Every drawing is offset by the
same random amount each frame, so the whole picture jitters as one. Because
`strength` shrinks as `shake_timer` runs down, the shake settles rather than
stopping dead. That fade is what makes it feel physical rather than broken.

**The see-through red sheet.** `screen.surface` is the picture the game draws on.
Copying it gives us another one exactly the same size, which we fill with red.
`set_alpha` sets how see-through it is: 255 is solid, 0 is invisible. We tie it
to `flash_timer`, so the flash fades out on its own.

We build it the first time it is needed rather than at the top of the file,
because `screen` does not exist yet while the file is still being read. That is
also why `flash_overlay` starts as `None`.

> **A trap worth knowing.** You might expect to skip all that and write
> `screen.draw.filled_rect(Rect(0, 0, WIDTH, HEIGHT), (255, 50, 35, 60))` —
> a fourth number for transparency. It does not work. Pygame Zero's drawing
> functions ignore the fourth number and you get solid red. See-through only
> comes from `set_alpha` on a surface.

> **Make it your own**
>
> Change `10` in the strength line for a bigger or smaller jolt. Change
> `FLASH_RED` to white for a camera flash, or green for poison. Use the same
> trick on a coin pickup with a tiny shake and no flash.

---

# Step 13 — The menu

The last piece. A title screen that the game returns to.

```python
menu_timer = 0.0
```

Change the starting state at the bottom of the file:

```python
reset_game()
state = "menu"
```

In `update`, add a menu branch before the dead branch (and add `menu_timer` to
the `global` line):

```python
    if state == "menu":
        menu_timer += dt
        if keyboard.RETURN or keyboard.KP_ENTER:
            reset_game()
            state = "play"
        return
```

Change the dead branch so it goes back to the menu instead of straight into a
new game:

```python
    if state == "dead":
        update_particles(dt)
        death_timer -= dt
        if death_timer <= 0:
            menu_timer = 0.0
            state = "menu"
        return
```

Now the menu screen itself:

```python
def draw_menu():
    progress = min(menu_timer / 1.0, 1)
    eased = 1 - (1 - progress) ** 3
    title_y = -60 + (150 - -60) * eased

    screen.draw.text(
        "Coin Collector",
        center=(WIDTH // 2, title_y),
        fontsize=90,
        color="white",
        owidth=1.2,
        ocolor=(20, 60, 100),
    )

    screen.draw.text(
        "Press ENTER to start",
        center=(WIDTH // 2, 340),
        fontsize=44,
        color="white",
        owidth=1,
        ocolor=(20, 60, 100),
    )

    screen.draw.text(
        "Arrow keys to move    SPACE to jump",
        center=(WIDTH // 2, 420),
        fontsize=30,
        color=(230, 245, 255),
        owidth=1,
        ocolor=(20, 60, 100),
    )

    screen.draw.text(
        f"Score: {score}          Best: {best_score}",
        center=(WIDTH // 2, 510),
        fontsize=34,
        color="white",
        owidth=1,
        ocolor=(20, 60, 100),
    )
```

And split `draw` so the menu replaces the world:

```python
def draw():
    global flash_overlay

    screen.fill(SKY)

    if state == "menu":
        draw_menu()
    else:
        draw_world()
        draw_actor(coin)

        for enemy in enemies:
            draw_actor(enemy["actor"])

        if state == "play":
            draw_actor(player)

        for particle in particles:
            size = max(2, int(6 * particle["life"]))
            screen.draw.filled_rect(
                Rect(particle["x"] + shake_x, particle["y"] + shake_y, size, size),
                (255, 235, 120),
            )

        screen.draw.text(
            f"Score: {score}",
            topleft=(20, 16),
            fontsize=34,
            color="white",
            owidth=1,
            ocolor="black",
        )

    if flash_timer > 0:
        if flash_overlay is None:
            flash_overlay = make_flash_overlay()
        flash_overlay.set_alpha(int(200 * (flash_timer / FLASH_TIME)))
        screen.blit(flash_overlay, (0, 0))
```

Run it. **That is the whole game.**

**The title drop.** Those three lines at the top of `draw_menu` are worth
understanding. `progress` goes from 0 to 1 over one second. If we used it
directly the title would slide down at a constant speed, which looks mechanical.

`eased = 1 - (1 - progress) ** 3` bends it: fast at first, slowing as it
arrives — the way a real object settles. It is called an **easing curve**, and
changing the `3` changes how sharply it settles. This one trick is the
difference between an interface that feels cheap and one that feels considered.

The last line mixes the start and end positions using `eased` as the blend.
When `eased` is 0 you get -60; when it is 1 you get 150; in between you get a
smooth ride.

> **Make it your own**
>
> Retitle the game. Change the instructions text. Try `** 2` or `** 5` in the
> easing. Add a line showing how many games you have played, or the fastest
> you ever reached 50 points.

---

# When it goes wrong

Four mistakes almost everyone makes at least once.

**Nothing happens when I press a key.** Click the game picture first. The keys
go wherever you last clicked.

**My variable will not change.** You are missing a `global` line. If a function
assigns to a variable that lives outside it, the function needs
`global that_variable` as its first line. There is no error for this — the
change just silently does not happen.

**`IndentationError`.** Python uses indentation the way other languages use
curly braces, and it must be consistent. Everything inside a function is
indented four spaces; everything inside an `if` inside a function is indented
eight. The editor will indent for you when you end a line with `:`.

**`NameError: name 'Surface' is not defined`** — or any other name. Python is
telling you it has never heard of that word. Either you have not created it
yet, or it is spelled differently where you created it, or you are using it
above the line that makes it. Check the spelling first; it is usually the
spelling.

---

# What you built

Stand back and look at what is in this file. Physics with velocity and
acceleration. Collision detection that works in two dimensions. A state machine.
A particle system. An easing curve. Difficulty that scales with skill.

None of those are toys — they are the same ideas, under the same names, that
run in games you have paid money for. You now know what they look like from the
inside.
