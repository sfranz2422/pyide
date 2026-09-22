# Fruit Catcher

You are going to build a catching game. An apple falls from the top of the
screen and you slide a bag along the bottom to catch it. Every catch scores a
point and makes the next apple fall faster. Miss one and the game is over.

We will build it in **14 steps**. After every single one you can press **Run**
and see something new working. Nothing is left until the end.

## Before you start

Three things to know about this editor:

- **Press Run to play.** The game appears on the right. Click the picture once
  before using the arrow keys, or the keys will scroll the page instead.
- **The Sprites button** shows all 60 pictures you can use, with their names and
  sizes. You will need it in a moment.
- **No `import pgzrun`, no `pgzrun.go()`.** If you follow a Pygame Zero tutorial
  from the internet you will see those two lines. On your own computer you need
  them. Here you do not — this editor starts the game for you. Everything else
  in those tutorials works exactly the same.

You cannot copy the code out of these notes. That is on purpose — typing it is
how it gets into your head. You will make mistakes, and fixing them is the part
where you actually learn something.

Throughout, you will see boxes like this one:

> **Make it your own**
>
> These point out things you can change without breaking anything. Change them.
> A game that looks exactly like everyone else's is no fun to show anybody.

---

# Step 1 — An empty window

Delete everything in `main.py` and type this:

```python
WIDTH = 800
HEIGHT = 600


def draw():
    pass
```

Press **Run**. You get a black window, 800 across and 600 down. That is all,
and that is fine — you have to have a window before you can put anything in it.

**What each part does.** `WIDTH` and `HEIGHT` are special names. Pygame Zero
looks for them and builds the window to match. Change them and press Run again
to prove it.

`draw()` is special too. Pygame Zero calls it about 60 times a second to repaint
the window. Right now it does nothing, which is what `pass` means: "there is
deliberately no code here." You will fill it in next step.

You need `draw()` even though it is empty, for two reasons. Pygame Zero expects
it, and this editor uses it to tell a *game* from an ordinary Python program. No
`draw()` and no `update()` means no game window — just the console.

> **Make it your own**
>
> `800` by `600` is a comfortable size. Try `1000` by `700` for more room to run
> around in, or `500` by `700` for a tall narrow game. Anything much bigger than
> about 1100 wide will not fit beside the code.

---

# Step 2 — A bag to catch with

Add three lines above `draw()`, and one line inside it:

```python
WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550


def draw():
    bag.draw()
```

Press **Run**. A bag appears near the bottom of the window.

**What each part does.** An **Actor** is a picture that knows where it is.
`Actor('bag')` loads the picture called `bag`. You do not have to download it or
put it in a folder — all 60 sprites are already here.

`bag.x = 400` puts its middle 400 pixels from the left. `bag.y = 550` puts its
middle 550 pixels down from the **top**. That last part surprises everyone:
in maths class y goes up, but on a screen y counts *downwards* from the top-left
corner. So y = 0 is the very top and y = 600 is the very bottom.

`bag.draw()` stamps the picture onto the window. It has to be inside `draw()`,
indented, so that it runs every time Pygame Zero repaints.

> **Make it your own**
>
> Click **Sprites** and pick something else to catch with. `bean`, `jumpy`,
> `brock` and `bobo` all read well as a catcher. The panel shows each sprite's
> size — the bag is 85 by 75. Something much wider makes the game easier,
> something narrow makes it harder. That is a real design decision, not a
> mistake, so pick deliberately.
>
> Try changing `bag.y` to `300` and pressing Run, just to watch what y does.
> Then put it back.

---

# Step 3 — Move it with the arrow keys

Add an `update()` function above `draw()`:

```python
WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550


def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8


def draw():
    bag.draw()
```

Press **Run**, click the picture, and hold the left and right arrow keys.

**It goes wrong.** You get a smear of bags right across the screen, like
finger-paint. Do not fix it yet — look at it, and work out why before you read
on.

**What each part does.** `update()` is the other special function. Pygame Zero
calls it about 60 times a second, just before `draw()`. `draw()` is for putting
pictures on the screen; `update()` is for changing where things are. Keeping
those two jobs apart is the whole shape of a Pygame Zero game.

`keyboard.left` is `True` while the left arrow is held down and `False` when it
is not. So `if keyboard.left:` means "if the left arrow is down right now".
`bag.x = bag.x - 8` reads as "make bag.x into whatever it was, minus 8" — it
slides the bag 8 pixels to the left, sixty times a second.

Two separate `if` statements, not `if`/`elif`. That is on purpose: holding both
arrows at once should cancel out, and with two `if`s it does.

**So why the smear?** You told Pygame Zero to move the bag and draw it. You
never told it to rub out the bag it drew last time. Every frame stamps a new bag
on top of all the old ones.

---

# Step 4 — Wipe the screen each frame

One new line at the top of `draw()`:

```python
def draw():
    screen.fill((80, 0, 70))
    bag.draw()
```

The whole program now looks like this:

```python
WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550


def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8


def draw():
    screen.fill((80, 0, 70))
    bag.draw()
```

Press **Run**. The smear is gone and the bag slides cleanly.

**What each part does.** `screen.fill(...)` paints the entire window one colour,
wiping out everything from the frame before. Then `bag.draw()` stamps the bag on
the fresh background.

**Order matters.** `screen.fill` must come first. If you fill *after* drawing
the bag, you paint straight over it and see nothing at all. Try swapping the two
lines to watch that happen — it is a mistake you will make for real later, and
recognising it saves you ten minutes.

`(80, 0, 70)` is a colour written as three numbers: red, green and blue, each
from 0 to 255. `(80, 0, 70)` is 80 red, no green, 70 blue — a dark purple.

> **Make it your own**
>
> Change the three numbers. `(20, 30, 60)` is midnight blue, `(250, 200, 150)`
> is warm sand, `(0, 0, 0)` is black, `(255, 255, 255)` is white. Pick something
> your sprite shows up against — a dark bag on a dark background is a game
> nobody can play.

---

# Step 5 — Keep the bag on the screen

Four lines at the end of `update()`:

```python
def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755
```

Press **Run** and hold an arrow key until the bag reaches the edge. It stops
there instead of wandering off into nowhere.

**What each part does.** Nothing was stopping the bag leaving. Hold left for
five seconds and `bag.x` reaches −2000: the bag is real, the game is still
running, it is just two thousand pixels off the side of your screen and never
coming back.

These four lines are a **clamp**. After the arrow keys have had their say, check
whether the bag has gone too far and, if it has, put it back to the limit.

Why 45 and 755? The bag is 85 pixels wide and `bag.x` is its *middle*, so the
middle can get within about 43 pixels of the edge before the bag hangs off it.
45 is that, rounded up. 755 is 800 − 45 at the other end.

> **Make it your own**
>
> If you swapped the bag for a different sprite, your numbers will be slightly
> wrong. Look up your sprite's width in the **Sprites** panel, halve it, and use
> that instead of 45 — and `800` minus it instead of 755.
>
> Or delete these four lines and let it wander off. Some games do let you wrap
> around the edges, which is a different feel entirely. Making the bag come back
> on the *other* side is Challenge 6 at the end.

---

# Step 6 — An apple to catch

Three lines for a new Actor, and one more line in `draw()`:

```python
WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550

apple = Actor('apple')
apple.x = 400
apple.y = 0


def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755


def draw():
    screen.fill((80, 0, 70))
    apple.draw()
    bag.draw()
```

Press **Run**. An apple sits at the top of the screen, doing nothing.

**What each part does.** Exactly what you did for the bag, with a different
picture and different numbers. `apple.y = 0` is the very top of the window.

**Order matters here too.** `apple.draw()` comes before `bag.draw()`, so the bag
is stamped on top of the apple. When they overlap, the apple looks like it is
going *into* the bag rather than sitting in front of it. Swap the two lines and
you will see the difference immediately — it is a one-line change that makes the
game look either right or cheap.

> **Make it your own**
>
> There are plenty of other things worth catching: `grape`, `lemon`,
> `pineapple`, `watermelon`, `meat`, `pizza`, `coin`, `heart`, `key`, `egg`.
> Pick one and rename the variable to match — but rename it **everywhere**,
> including the lines you are about to write. Python will not guess what you
> meant.
>
> If you rename `apple` to something else, the rest of these instructions will
> not match your code. That is good practice, but do it knowing you will have to
> translate as you go.

---

# Step 7 — Make it fall

Three lines at the end of `update()`:

```python
def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755

    apple.y = apple.y + 4
    if apple.y > 600:
        apple.y = 0
```

Press **Run**. The apple falls, reaches the bottom, and reappears at the top.

**What each part does.** `apple.y = apple.y + 4` moves the apple 4 pixels down
every frame. Remember that bigger y means further *down*, so adding makes it
fall. At 60 frames a second that is 240 pixels a second — about two and a half
seconds from top to bottom.

`if apple.y > 600:` asks "has the apple gone past the bottom edge?" If it has,
`apple.y = 0` teleports it back to the top and it falls again. That is all a
looping game is: something that resets.

> **Make it your own**
>
> `4` is the falling speed and it is the single most important number in this
> game. `2` is a lazy drift, `8` is genuinely difficult. Try both before you
> settle. You will change this number again in Step 13, so remember where it is.

---

# Step 8 — Catch it

Two lines at the end of `update()`:

```python
    apple.y = apple.y + 4
    if apple.y > 600:
        apple.y = 0
    if apple.colliderect(bag):
        apple.y = 0
```

Press **Run** and slide the bag under the apple. It jumps back to the top the
moment it touches.

**What each part does.** `apple.colliderect(bag)` is `True` when the apple's
rectangle overlaps the bag's rectangle, and `False` when it does not. If you did
Scratch, it is the same idea as `touching sprite`.

`apple.colliderect(bag)` and `bag.colliderect(apple)` mean exactly the same
thing. Use whichever reads better to you.

**"Rectangle" is doing some work in that sentence.** Pygame Zero does not test
the actual apple shape, just the invisible box around the picture. So you can
occasionally catch an apple that looks like it went past the corner of the bag.
Every game does this — checking real shapes is slow, and boxes are close enough
that nobody notices.

---

# Step 9 — Drop it somewhere different each time

Add `import random` as the very first line, and use it in three places:

```python
import random

WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550

apple = Actor('apple')
apple.x = random.randint(30, 770)
apple.y = 0


def update():
    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755

    apple.y = apple.y + 4
    if apple.y > 600:
        apple.x = random.randint(30, 770)
        apple.y = 0
    if apple.colliderect(bag):
        apple.x = random.randint(30, 770)
        apple.y = 0


def draw():
    screen.fill((80, 0, 70))
    apple.draw()
    bag.draw()
```

Press **Run**. Now it is a game — you have to go and get it.

**What each part does.** `import random` loads Python's random-number tools.
Imports go at the top of the file, above everything else.

`random.randint(30, 770)` picks a whole number from 30 to 770, including both
ends. The apple is 58 pixels wide, so its middle has to stay about 29 pixels
from each edge or it hangs off. 30 and 770 give it that margin.

Notice you now set a new random x in **three** places: once at the start, and
once in each of the two places that send the apple back to the top. Miss one and
the apple will occasionally reappear exactly where it was. That is a real bug,
and an annoying one to find, because it only shows up sometimes.

> **Make it your own**
>
> Try `random.randint(400, 420)` for a moment. The apple now always falls down
> the same narrow strip and the game is boring. Put it back. That is worth doing
> once, because it shows you that randomness is not decoration — it is the
> reason there is a game here at all.

---

# Step 10 — Count the catches

Add a `score` variable, tell `update()` it is allowed to change it, and add 1 on
every catch:

```python
score = 0


def update():
    global score

    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755

    apple.y = apple.y + 4
    if apple.y > 600:
        apple.x = random.randint(30, 770)
        apple.y = 0
    if apple.colliderect(bag):
        apple.x = random.randint(30, 770)
        apple.y = 0
        score = score + 1
```

`score = 0` goes above `def update():`, with the other variables.

Press **Run**. Nothing looks different yet — you are counting, but not showing
it. That comes next step.

**What `global score` does, and why you need it.** Leave that line out and the
game crashes the first time you catch something:

```
UnboundLocalError: local variable 'score' referenced before assignment
```

Try it. Delete `global score`, run the game, catch one apple, and read the
error. Then put the line back.

Here is the rule behind it. A function can **read** a variable from outside
itself without any ceremony. But the moment a function **assigns** to a name,
Python decides that name belongs to the function — it makes a fresh, private
one. So `score = score + 1` inside `update()` tries to read a private `score`
that has not been given a value yet, and Python stops.

`global score` says: "when I write to `score`, I mean the one outside." One
line, and the error goes away.

This trips up everybody once. It is not you being slow; it is a genuinely
surprising rule.

---

# Step 11 — Put the score on the screen

One more line at the end of `draw()`:

```python
def draw():
    screen.fill((80, 0, 70))
    apple.draw()
    bag.draw()
    screen.draw.text('Score: ' + str(score), (15, 10),
                     color=(255, 255, 255), fontsize=30)
```

Press **Run**. The score climbs in the top-left corner.

**What each part does.** `screen.draw.text(...)` writes words on the window, and
like everything else that draws, it belongs inside `draw()`.

`'Score: ' + str(score)` glues two strings together. `score` is a *number*, and
Python will not glue a number onto a string — `'Score: ' + 0` is an error.
`str(score)` turns the number 0 into the text `"0"` so the join works.

`(15, 10)` is where to put the top-left corner of the text. `color=(255, 255,
255)` is white, same three-number system as the background. `fontsize=30` is the
height in pixels.

The line is split across two lines because it is long. Python does not mind, as
long as the break is inside the brackets.

> **Make it your own**
>
> Move the score. `(15, 10)` is top-left; try `(650, 10)` for top-right. Make it
> huge with `fontsize=60`. Change the wording — `'Apples: '`, `'Caught: '`, or
> your own name and a colon.

---

# Step 12 — Control it with the mouse

Add a whole new function above `update()`:

```python
def on_mouse_move(pos, rel, buttons):
    bag.x = pos[0]
```

Press **Run** and move the mouse across the picture. The bag follows it. The
arrow keys still work too — you did not take anything away.

**What each part does.** `on_mouse_move` is another special name. Pygame Zero
calls it every time the mouse moves over the window. You do not call it
yourself; you just write it, and it gets used.

It receives three things:

- `pos` — where the mouse is, as a pair. `pos[0]` is x, `pos[1]` is y.
- `rel` — how far it moved since last time, as a pair.
- `buttons` — which mouse buttons are held down right now.

You only need `pos[0]`, the across-position, because the bag never moves up or
down. But you have to list all three in the brackets, in that order, because
that is what Pygame Zero will hand you.

There are more of these. `on_mouse_down(pos, buttons)` runs when a button is
pressed, `on_key_down(key, mod, unicode)` when a key goes down, `on_key_up(key,
mod)` when it comes back up. You do not need them here, but knowing they exist
is how you make a game respond to anything.

**Notice the mouse skipped the clamp.** `on_mouse_move` sets `bag.x` directly,
and the four clamp lines in `update()` run afterwards and tidy it up. That is
lucky rather than clever — and worth seeing, because it is the kind of thing
that stops being lucky as a program grows.

> **Make it your own**
>
> The mouse makes this game *much* easier than the arrow keys — a mouse can
> cross the screen instantly, and the bag can only manage 8 pixels a frame.
> Decide which one your game is really for. If you want the keyboard to stand a
> chance, raise the `8` in Step 3 to `12`. If you want the mouse to be the
> proper way to play, delete the `keyboard` lines altogether.

---

# Step 13 — Speed it up as you get better

Find this line:

```python
    apple.y = apple.y + 4
```

and change it to this:

```python
    apple.y = apple.y + 4 + score / 5
```

Press **Run**. The first few apples drift down. By the time you have twenty, they
are dropping fast.

**What each part does.** The falling speed is no longer a fixed 4 — it is 4 plus
a fifth of your score. At score 0 the apple falls at 4. At score 10 it falls at
6. At score 50 it falls at 14.

This one line is what makes the game worth playing twice. A game at one fixed
difficulty is either too easy or too hard; a game that *follows you up* is
interesting the whole way, because it always ends just past where you are good.

> **Make it your own**
>
> `score / 5` climbs fast. `score / 10` is a gentler ramp and gives longer
> games; `score / 3` gets frantic quickly. Change the `4` as well and you change
> where the game *starts*, separately from how fast it gets harder. Those two
> numbers between them are the entire difficulty of your game.

---

# Step 14 — Game over

Last step. Three changes.

**One:** add a new variable next to `score`:

```python
score = 0
game_over = False
```

**Two:** in `update()`, add `game_over` to the `global` line, stop the game once
it is over, and end the game instead of recycling the apple:

```python
def update():
    global score, game_over

    if game_over:
        return

    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755

    apple.y = apple.y + 4 + score / 5
    if apple.y > 600:
        game_over = True
    if apple.colliderect(bag):
        apple.x = random.randint(30, 770)
        apple.y = 0
        score = score + 1
```

**Three:** in `draw()`, show one thing or the other:

```python
def draw():
    screen.fill((80, 0, 70))
    if game_over:
        screen.draw.text('Game Over', center=(400, 280),
                         color=(255, 255, 255), fontsize=70)
        screen.draw.text('Final Score: ' + str(score), center=(400, 350),
                         color=(255, 255, 255), fontsize=50)
    else:
        apple.draw()
        bag.draw()
        screen.draw.text('Score: ' + str(score), (15, 10),
                         color=(255, 255, 255), fontsize=30)
```

Press **Run**. Miss an apple and the game ends with your final score.

**What each part does.** `game_over` is a **flag** — a variable that is only
ever `True` or `False`, holding one fact about the game. `False` at the start,
because you have not lost yet.

`if apple.y > 600:` used to send the apple back to the top. Now missing it is
how you lose, so it sets the flag instead.

`if game_over: return` stops `update()` right there. `return` means "leave this
function now". Without it the apple keeps falling and the score keeps changing
behind the Game Over screen — invisible, but wrong, and it would break a restart
button later.

In `draw()`, `if`/`else` picks one of two screens. Watch the indenting: the
three lines under `else:` have to be indented to line up with each other, or
Python will not run the file at all.

`center=(400, 280)` centres the text on that point, instead of putting its
top-left corner there. That is why the message sits neatly in the middle, even
when your score grows from 1 digit to 3. Using `(400, 280)` on its own would
drift to the right as the number got longer.

---

# You are done

Here is the whole thing, in order, so you can check yours against it:

```python
import random

WIDTH = 800
HEIGHT = 600

bag = Actor('bag')
bag.x = 400
bag.y = 550

apple = Actor('apple')
apple.x = random.randint(30, 770)
apple.y = 0

score = 0
game_over = False


def on_mouse_move(pos, rel, buttons):
    bag.x = pos[0]


def update():
    global score, game_over

    if game_over:
        return

    if keyboard.left:
        bag.x = bag.x - 8
    if keyboard.right:
        bag.x = bag.x + 8

    if bag.x < 45:
        bag.x = 45
    if bag.x > 755:
        bag.x = 755

    apple.y = apple.y + 4 + score / 5
    if apple.y > 600:
        game_over = True
    if apple.colliderect(bag):
        apple.x = random.randint(30, 770)
        apple.y = 0
        score = score + 1


def draw():
    screen.fill((80, 0, 70))
    if game_over:
        screen.draw.text('Game Over', center=(400, 280),
                         color=(255, 255, 255), fontsize=70)
        screen.draw.text('Final Score: ' + str(score), center=(400, 350),
                         color=(255, 255, 255), fontsize=50)
    else:
        apple.draw()
        bag.draw()
        screen.draw.text('Score: ' + str(score), (15, 10),
                         color=(255, 255, 255), fontsize=30)
```

Forty-four lines of code. Look back at Step 1 and notice nothing here was magic
— every line arrived because the step before it was not quite a game yet.

---

# Challenges

No code given for these. Work them out. They get harder as you go.

### 1. A sound when you catch

One line. `sounds.ding.play()` in the right place. The **Sprites** panel lists
every sound you have — `chirp`, `beep`, `burp` and `small_boom` are all worth
trying. Put a different one on the game-over line too.

*Where does the line go? Somewhere it runs once per catch, not sixty times a
second. That narrows it down a lot.*

### 2. A different fruit every time

Make each new apple a random one out of several. You will need a list of
sprite names, `random.choice(...)`, and an Actor whose picture you can swap —
look up `apple.image` in the Pygame Zero documentation.

### 3. Three lives

Instead of ending on the first miss, take away a life. End the game when the
third one goes. You will need a `lives` variable, and it goes in the `global`
line with the others.

Show them on screen. Three little `heart` sprites drawn in a row looks far
better than the word "Lives: 3" — you would draw them in a loop.

### 4. Press a key to play again

After Game Over, let `on_key_down` start a fresh game: score back to 0,
`game_over` back to `False`, apple back to the top. Remember `global`.

### 5. Something you must *not* catch

Add a `bomb` falling alongside the apple. Catch it and you lose instantly, or
lose a life if you did Challenge 3. This is the one that turns it from a
catching game into a game you have to think about — you can no longer just park
the bag under whatever is falling.

### 6. Wrap around the edges

Go off the left edge and come back on the right. Replace the clamp from Step 5.
Two lines, and they look a lot like the clamp.

### 7. Two apples at once

Harder than it sounds, because copy-pasting every line with `apple` in it will
work and will also be horrible. Try a **list** of apples and a `for` loop
instead. If you get this one working, you have understood something that most of
the class has not.
