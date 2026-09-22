# Student guides

The walkthroughs handed to students, kept here so they are version-controlled
and so `tools/test_guide.py` can find them.

| | what it teaches | runs today? |
|---|---|---|
| `learn_pykaplay.md` | The thirteen Learn Kaplay lessons, in Python on kaypy | **yes** — game mode |
| `adventure_game.md` | A branching text adventure: `input()`, `if`, functions | **yes** — console mode |
| `fruit_catcher.md` | Catching falling fruit | **no** — see below |
| `instructions.md` | Coin Collector, a 13-step platform game | **no** — see below |

## Two of these no longer run

`fruit_catcher.md` and `instructions.md` were written for **Pygame Zero**, which
PyIDE used before Kaplay and then kaypy. They open with

```python
WIDTH = 960
player = Actor("bean", (160, 500))

def draw():
    ...
```

and nothing in PyIDE provides `Actor`, `WIDTH` or `draw()` any more. Worse, a
program written that way is not recognised as a game at all — game mode is
detected by `from kaypy import *` — so it runs as an ordinary console program
and stops at `NameError: name 'Actor' is not defined`, with no canvas and no
hint that the whole tutorial is written for a different engine.

They are kept because they are good tutorials and the writing is worth
porting, not because they work. Between them they are about 2,000 lines and
around 80 code blocks, most of which would need rewriting rather than
translating: Pygame Zero's `draw()`/`update()` shape and kaypy's
components-and-events shape are genuinely different ways to think about a
game, which is most of why the port has not happened by accident.

`tools/test_guide.py` reports them honestly — it finds no runnable lesson in
either, because there isn't one:

```
fruit_catcher.md — 0 whole lessons
  (no block runs on its own; nothing here to check)
```

## Checking the ones that do

```bash
python3 tools/test_guide.py                       # learn_pykaplay.md
python3 tools/test_guide.py docs/adventure_game.md
```

Every fenced `python` block that imports *and* calls `kaplay` is executed the
way pressing Run executes it, and then played: every key the lesson registers a
handler for is held down and released, the mouse is clicked, every scene is
built, and the timers are run out. A lesson passes only if nothing raised.
