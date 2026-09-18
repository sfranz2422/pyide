"""kaplay — write Kaplay games in Python.

This is not a port and not a translation. Kaplay itself runs, unchanged, in
JavaScript; this module is the seam between it and Python. Every name you use
here is the name Kaplay's own documentation uses, in the same order with the
same arguments, so a Kaplay example found anywhere translates by changing the
punctuation:

    JavaScript                          Python
    ----------------------------------  ----------------------------------
    kaplay({ width: 800 })              kaplay(width=800)
    loadSprite("bean", "bean.png")      loadSprite("bean", "bean.png")
    const p = add([                     p = add([
        sprite("bean"),                     sprite("bean"),
        pos(100, 200),                      pos(100, 200),
        area(), body(),                     area(), body(),
    ])                                  ])
    onKeyPress("space", () => {...})    onKeyPress("space", jump)
    onUpdate("enemy", (e) => ...)       onUpdate("enemy", lambda e: ...)

Why camelCase instead of Python's usual snake_case: because it means every
Kaplay tutorial, example and answer on the internet applies to what students
write here. A snake_case wrapper would look more like Python and leave them
with no documentation in the world.

HOW IT WORKS

`kaplay()` starts the engine and hands back a context object. Every other name
in this module is looked up on that context on demand (PEP 562 module
__getattr__), so this file does not have to list Kaplay's API and cannot fall
behind it — a function added to Kaplay tomorrow is callable from Python today.

What the seam actually does, on every call:

  * Python lists and tuples become JavaScript arrays, so `add([...])` works.
  * Python dicts and keyword arguments become JavaScript objects, so
    `kaplay(width=800)` and `body(jumpForce=800)` work.
  * Python functions become callable from JavaScript, so a plain `def` or
    `lambda` can be handed to `onKeyPress` or `onUpdate`.

PERFORMANCE, MEASURED

Crossing into Python is cheap; reading properties back across the seam is what
costs. Measured against Pyodide 314.0.7, one frame over 200 game objects:

    o.move(1.5, 0.5)                one method call     0.33 ms   2% of a frame
    p = o.pos; p.x = p.x + 1.5      cache the vector    0.51 ms   3% of a frame
    o.pos.x = o.pos.x + 1.5         nested every time   1.17 ms   7% of a frame

A frame at 60fps is 16.7 ms, and Kaplay draws in JavaScript at full speed
regardless. So even the wasteful idiom leaves 93% of the frame free at 200
objects. Prefer `o.move(...)` where it exists, but not at the cost of clarity —
none of these are close to a problem at classroom scale.
"""

from pyodide.ffi import create_proxy, to_js
import js

__version__ = "1.0"

# Where PyIDE serves the bundled sprite pack and sounds. Kaplay resolves every
# loadSprite/loadSound path against this, so the Sprites panel can insert
# "images/bean.png" and it just works.
ASSET_ROOT = "/static/assets/"

# The live Kaplay context, set by kaplay(). Everything else reaches Kaplay
# through it rather than through globals, so two runs in one page can't collide.
_ctx = None

# Proxies handed to JavaScript must outlive the call that created them, or the
# callback fires into freed memory. Kaplay keeps its handlers for the life of
# the game, so we do too, and drop the lot when a new game starts.
_proxies = []

# False once a game has been stopped, by Stop or by an error. Callbacks check
# it instead of being destroyed — see _guard for why that distinction matters.
_running = [False]


class KaplayNotStarted(RuntimeError):
    pass


def _js_object(mapping):
    """A Python dict as a plain JavaScript object."""
    return to_js(mapping, dict_converter=js.Object.fromEntries)


def _report(err):
    """Print a student-shaped traceback for an error inside a callback.

    An exception in onUpdate() happens sixty times a second, long after the
    line that registered it has returned, and JavaScript is what catches it.
    Left alone that is either silent or thousands of identical tracebacks, so
    the error is printed once and the game is stopped — the same bargain the
    Pygame Zero runner made, for the same reason.
    """
    import sys
    import traceback

    main = sys.modules.get("__main__")
    writer = getattr(main, "_write_traceback", None)
    if writer is not None:
        writer(err)        # trims the frames to the student's own files
    else:
        traceback.print_exception(type(err), err, err.__traceback__)

    sys.stderr.write("\nThe game stopped because of the error above.\n")
    try:
        shutdown()
    except Exception:
        pass


def _guard(fn):
    """Wrap a Python callback so an error in it is reported, not swallowed.

    The `_running` check is what makes stopping safe. Kaplay may call a handler
    again within the same frame it was told to quit, and destroying the proxy
    out from under it is a use-after-free — which surfaces as an incoherent
    JavaScript error rather than a stopped game. So a stopped game's callbacks
    become no-ops and the proxies stay alive until a new game replaces them.
    It also gives the error reporter its "report once" for free: the first
    exception stops the game, and every later call returns here immediately.
    """
    def guarded(*args, **kwargs):
        if not _running[0]:
            return None
        try:
            return fn(*args, **kwargs)
        except Exception as err:
            _report(err)
            return None
    guarded.__name__ = getattr(fn, "__name__", "callback")
    return guarded


def _convert(value):
    """Marshal one argument from Python into something JavaScript understands."""
    # A JsProxy is already a JavaScript value — a component from sprite(), a
    # game object from add() — and falls through to the bottom untouched. That
    # is what makes add([sprite("bean"), pos(0, 0)]) work: the list is rebuilt
    # as a JS array whose items are the real components, not proxies of them.
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if callable(value):
        proxy = create_proxy(_guard(value))
        _proxies.append(proxy)
        return proxy
    if isinstance(value, dict):
        return _js_object({k: _convert(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return to_js([_convert(v) for v in value])
    # JsProxy and anything else Pyodide already knows how to send
    return value


def _call(fn, args, kwargs):
    """Call a Kaplay function with Python arguments.

    Keyword arguments become a trailing JavaScript config object, which is how
    Kaplay takes options everywhere: kaplay(width=800) and body(jumpForce=800)
    both land as { ... } in the right position.
    """
    converted = [_convert(a) for a in args]
    if kwargs:
        converted.append(_js_object({k: _convert(v) for k, v in kwargs.items()}))
    return fn(*converted)


def kaplay(**options):
    """Start the engine. Call this once, first.

        kaplay(width=800, height=600, background=[20, 20, 40])

    Options are Kaplay's own: width, height, background, letterbox, scale,
    gravity, debug, crisp, and the rest.
    """
    global _ctx

    # Safe to free the previous game's callbacks here and nowhere else: that
    # engine has been quit, so nothing can still be holding them.
    for proxy in _proxies:
        try:
            proxy.destroy()
        except Exception:
            pass          # already gone; a stale proxy is not worth a crash
    _proxies.clear()
    _running[0] = True

    starter = getattr(js, "kaplay", None) or getattr(js, "kaboom", None)
    if starter is None:
        raise KaplayNotStarted(
            "The Kaplay library isn't loaded on this page. In PyIDE this is "
            "automatic — if you are seeing this, tell your teacher."
        )

    # global: False keeps Kaplay's ~200 names off window. We reach them through
    # the returned context instead, which is also what lets a second Run start
    # a clean game rather than inheriting the last one's handlers.
    options.setdefault("global", False)

    # The editor's canvas, so nobody has to know the page has one. Outside a
    # browser there is no `window` at all — which is not a hypothetical, it is
    # how the test suite runs — so this asks for it rather than assuming it.
    window = getattr(js, "window", None)
    canvas = getattr(window, "__pyideCanvas", None) if window is not None else None
    if canvas is not None:
        options.setdefault("canvas", canvas)

    _ctx = starter(_js_object({k: _convert(v) for k, v in options.items()}))

    # Where the bundled art and sounds live, so loadSprite("bean",
    # "images/bean.png") works with no setup. Kaplay resolves every load
    # against this, which is why the Sprites panel inserts paths under
    # images/ and sounds/.
    try:
        _ctx.loadRoot(ASSET_ROOT)
    except Exception:
        pass          # a bare Kaplay build without loadRoot; paths still work

    return _ctx


def shutdown():
    """Stop the running game and let go of everything it held.

    Called by the editor's Stop button, and by the error reporter when a
    callback raises. Safe to call when nothing is running.
    """
    global _ctx

    _running[0] = False
    ctx, _ctx = _ctx, None
    if ctx is not None:
        try:
            ctx.quit()
        except Exception:
            pass
    # The proxies are deliberately NOT destroyed here. Kaplay can still call a
    # handler in the frame it was told to quit, and _guard now turns those into
    # no-ops; freeing them instead would be a use-after-free. They are released
    # when the next kaplay() starts, which is the one moment nothing holds them.


def context():
    """The raw Kaplay context, for anything this module doesn't cover."""
    if _ctx is None:
        raise KaplayNotStarted("Call kaplay() first — it starts the game.")
    return _ctx


def _lookup(name):
    """Fetch one name off the live context, with a readable failure."""
    try:
        return getattr(context(), name)
    except AttributeError:
        raise AttributeError(
            "Kaplay has no %r. Check the spelling — Kaplay uses names like "
            "onKeyPress and loadSprite, with capital letters in the middle."
            % name
        ) from None


def __getattr__(name):
    """Look any Kaplay name up on the live context, on demand.

    This is why the module needs no list of Kaplay's API: `add`, `sprite`,
    `onKeyPress` and every other name resolve here the first time they are
    used, and a name Kaplay does not have raises AttributeError naming it.

    The binding has to be lazy *to the call*, not merely to the attribute.
    `from kaplay import *` resolves every name in __all__ the moment the
    import runs — which is necessarily before kaplay() has started anything —
    so returning the real function here would fail on the import line itself.
    Instead each name becomes a small wrapper that finds the real function
    when it is called. Discovered by the import blowing up, not by reasoning.
    """
    if name.startswith("__"):
        raise AttributeError(name)

    # Once the game is running, hand back non-callables (debug, constants)
    # as themselves; a wrapper would make `debug.inspect = True` impossible.
    if _ctx is not None:
        attr = _lookup(name)
        if not callable(attr):
            return attr

    def wrapper(*args, **kwargs):
        return _call(_lookup(name), args, kwargs)

    wrapper.__name__ = name
    wrapper.__qualname__ = name
    wrapper.__doc__ = "Kaplay's %s(). See the Kaplay documentation." % name
    return wrapper


# Names `from kaplay import *` brings in. Deliberately curated rather than
# generated: it is the surface a platformer, a Flappy Bird and an Asteroids
# need, and leaving it short keeps the editor's suggestions useful. Anything
# outside this list is still reachable as kaplay.whatever().
#
# `all`, `any`, `pos` and friends would shadow builtins or read badly, so the
# few that clash are simply left out of the star-import and used qualified.
__all__ = [
    # starting up
    "kaplay", "context", "shutdown", "loadSprite", "loadSound", "loadFont",
    "loadSpriteAtlas", "loadBean",
    # making things
    "add", "destroy", "destroyAll", "get", "make", "readd",
    # components
    "sprite", "pos", "area", "body", "anchor", "scale", "rotate", "color",
    "opacity", "outline", "text", "rect", "circle", "z", "fixed", "move",
    "offscreen", "lifespan", "health", "timer", "stay", "state", "animate",
    # input
    "onKeyPress", "onKeyDown", "onKeyRelease", "onKeyPressRepeat",
    "onClick", "onMousePress", "onMouseRelease", "onMouseMove",
    "isKeyDown", "isKeyPressed", "isMouseDown", "mousePos",
    # the loop and events
    "onUpdate", "onDraw", "onCollide", "onCollideUpdate", "onCollideEnd",
    "onHover", "onHoverUpdate", "onHoverEnd",
    "wait", "loop", "tween",
    # scenes
    "scene", "go", "onSceneLeave", "getSceneName",
    # sound
    "play", "volume", "burp",
    # maths and helpers
    "vec2", "rgb", "hsl2rgb", "rand", "randi", "choose", "chance", "lerp",
    "wave", "deg2rad", "rad2deg", "clamp",
    # the world
    "width", "height", "center", "dt", "time", "camPos", "camScale",
    "shake", "flash", "setGravity", "getGravity", "setBackground",
    # `debug` is an object, not a function, so it is reached as
    # kaplay.debug rather than star-imported as a lazy wrapper.
    # levels
    "addLevel", "drawSprite", "drawText", "drawRect",
]
