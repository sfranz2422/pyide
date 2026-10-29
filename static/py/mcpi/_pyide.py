"""PyIDE's side of mcpi: commands to the world, and taking turns with the page.

The program runs on the page's own thread (Pyodide has no other), so while
it runs nothing else can: not drawing the world, not moving the player, not
even the Stop button. A Pi lesson program is typically

    while True:
        pos = mc.player.getPos()
        ...
        time.sleep(0.1)

and on a Pi each call waits for Minecraft, which keeps running meanwhile.
Here every call is answered at once (window.PyIDEWorld.command, in
world_model.js), and then — at most every FRAME seconds — the program is
suspended for one frame of the page (run_sync on a promise: WebAssembly
stack switching, as input() uses) so the world can draw and the keys can
move the player. time.sleep is the same, for the time asked.

Each turn is also when Stop is heard: the promise answers 1 and the program
gets WorldStopped, a KeyboardInterrupt — what Ctrl+C gives on a Pi, so a
lesson's `except KeyboardInterrupt:` tidies up as it would there.

Without stack switching (Safari, older browsers) there are no turns: the
program runs to the end with the page frozen, and runtime.js gives it the
console's time limit. Programs that build and finish still work.
"""
import time

import js

try:
    from pyodide.ffi import can_run_sync, run_sync
except ImportError:          # a Pyodide without stack switching
    run_sync = None

    def can_run_sync():
        return False

# How long a program runs between turns: short enough that the world moves
# smoothly, long enough that a program building something isn't slowed down
# by thousands of turns.
FRAME = 0.025

_real_sleep = time.sleep


class WorldStopped(KeyboardInterrupt):
    """Stop was pressed. A KeyboardInterrupt, as Ctrl+C is on a Pi."""


class StopNow(BaseException):
    """A program that caught WorldStopped and carried on for more than 2 s:
    it is ended anyway, or Stop would be a request a loop could ignore."""


state = {"run": 0, "last": 0.0, "suspended": False, "stopped_at": None}


def begin(run_id):
    """A new run: its id (from PyIDEWorld.beginRun) and a fresh clock."""
    state.update(run=int(run_id), last=time.monotonic(), suspended=False, stopped_at=None)


def can_yield():
    return run_sync is not None and bool(can_run_sync())


def world():
    w = getattr(js, "PyIDEWorld", None)
    if w is None:
        raise ConnectionError("There is no block world on this page to connect to.")
    return w


def _yield(promise):
    state["suspended"] = True
    try:
        stop = run_sync(promise)
    finally:
        state["suspended"] = False
        state["last"] = time.monotonic()
    if stop:
        _stop()


def _stop():
    if state["stopped_at"] is None:
        state["stopped_at"] = time.monotonic()
        raise WorldStopped()
    if time.monotonic() - state["stopped_at"] > 2:
        raise StopNow()


def breathe(force=False):
    """Give the page its turn, if one is due."""
    if not force and time.monotonic() - state["last"] < FRAME:
        return
    if can_yield():
        _yield(world().nextFrame(state["run"]))


def sleep(secs):
    """time.sleep while a program drives the world: the world keeps going."""
    secs = float(secs)       # the TypeError time.sleep would give for sleep("1")
    if secs < 0:
        raise ValueError("sleep length must be non-negative")
    if can_yield():
        _yield(world().sleep(secs * 1000, state["run"]))
    else:
        _real_sleep(secs)


def command(line):
    """One line of the Pi's protocol, answered by the world; then a turn if one is due."""
    reply = str(world().command(line))
    breathe()
    return reply
