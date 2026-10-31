"""PyIDE's side of the simulated Raspberry Pi: talking to the page, and taking
turns with it.

The same shape as mcpi/_pyide.py, which says why at length. In short: the
program runs on the page's own thread (Pyodide has no other), so while it
runs, nothing else can — not the breadboard's LEDs lighting, not a click on
a button, not the Stop button. So every gpiozero / Sense HAT / camera call,
every time.sleep, and the trace guard in a loop that does neither, gives the
page a turn (run_sync on a promise: WebAssembly stack switching, as input()
uses). A turn is also when a button press is heard, and when Stop is: as a
KeyboardInterrupt, which is what Ctrl+C gives on a Pi, so a lesson's
`except KeyboardInterrupt:` tidies up as it would there.

_pyide_run_pi in runtime.js runs the program; pi.js is the page's side
(window.PyIDEPi). Without stack switching (Safari) there are no turns: the
program runs to the end with the page frozen, and gets the console's time
limit — a program that lights an LED and ends still works.
"""
import time

import js

try:
    from pyodide.ffi import can_run_sync, run_sync
except ImportError:          # a Pyodide without stack switching
    run_sync = None

    def can_run_sync():
        return False

# How long a program runs between turns (mcpi/_pyide.py's FRAME).
FRAME = 0.025

_real_sleep = time.sleep


class PiStopped(KeyboardInterrupt):
    """Stop was pressed. A KeyboardInterrupt, as Ctrl+C is on a Pi."""


class StopNow(BaseException):
    """A program that caught PiStopped and carried on for more than 2 s: it
    is ended anyway, or Stop would be a request a loop could ignore."""


# _pyide_run_turns (runtime.js) reads these two names, as it does mcpi's.
WorldStopped = PiStopped

state = {"run": 0, "last": 0.0, "suspended": False, "stopped_at": None}


def begin(run_id):
    """A new run: its id (from PyIDEPi.beginRun) and a fresh clock."""
    state.update(run=int(run_id), last=time.monotonic(), suspended=False, stopped_at=None)
    _after_turn.clear()
    _keepers.clear()
    _in_callback[0] = False
    import signal
    signal.pause = pause


def can_yield():
    return run_sync is not None and bool(can_run_sync())


def pi():
    p = getattr(js, "PyIDEPi", None)
    if p is None:
        raise ConnectionError("There is no Raspberry Pi on this page to connect to.")
    return p


# What runs after every turn: gpiozero's when_pressed callbacks, the Sense HAT
# joystick's. They run here, on the program's own thread, between its lines —
# where a real Pi's background thread would have run them at about that time.
_after_turn = []


def after_turn(f):
    if f not in _after_turn:
        _after_turn.append(f)


def _yield(promise):
    state["suspended"] = True
    try:
        stop = run_sync(promise)
    finally:
        state["suspended"] = False
        state["last"] = time.monotonic()
    if stop:
        _stop()
    _run_after_turn()


_in_callback = [False]


def _run_after_turn():
    # Not again from inside a callback's own turns (a when_pressed that
    # sleeps): a real Pi runs one callback at a time per device, and this
    # keeps a callback from running inside itself.
    if _in_callback[0]:
        return
    _in_callback[0] = True
    try:
        for f in list(_after_turn):
            f()
    finally:
        _in_callback[0] = False


# Devices with a callback set (when_pressed, a joystick direction). While
# there are any, a program that reaches its last line keeps running — as in
# Thonny, where the program's callbacks keep firing until Stop — so the
# book's Quick Reaction Game, whose last line sets when_pressed, works.
_keepers = set()


def keep_alive(device, on):
    if on:
        _keepers.add(id(device))
    else:
        _keepers.discard(id(device))


def linger():
    """Called by _pyide_run_turns after the program's last line."""
    if not can_yield():
        return
    while _keepers:
        sleep(0.05)


def pause():
    """signal.pause(): gpiozero's examples end with it, to wait for callbacks
    for ever. Here: take turns until Stop."""
    while True:
        sleep(0.1)


def _stop():
    if state["stopped_at"] is None:
        state["stopped_at"] = time.monotonic()
        raise PiStopped()
    if time.monotonic() - state["stopped_at"] > 2:
        raise StopNow()


def breathe(force=False):
    """Give the page its turn, if one is due."""
    if not force and time.monotonic() - state["last"] < FRAME:
        return
    if can_yield():
        _yield(pi().nextFrame(state["run"]))


def sleep(secs):
    """time.sleep while a program drives the Pi: the page keeps going, so an
    LED stays lit on screen and a button can be pressed meanwhile."""
    secs = float(secs)       # the TypeError time.sleep would give for sleep("1")
    if secs < 0:
        raise ValueError("sleep length must be non-negative")
    if can_yield():
        _yield(pi().sleep(secs * 1000, state["run"]))
    else:
        _real_sleep(secs)


def wait_until(test, timeout=None):
    """Take turns until test() is true (a button pressed), or timeout seconds
    pass. True if it happened. Without turns nothing on the page can change,
    so this answers at once."""
    start = time.monotonic()
    while not test():
        if timeout is not None and time.monotonic() - start >= timeout:
            return False
        if not can_yield():
            return test()
        breathe(force=True)
    return True
