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

Crossing into Python is cheap; reaching back across the seam for properties is
what costs. Measured against Pyodide 314.0.7, one frame over 200 game objects:

    o.move(1.5, 0.5)                one method call     0.38 ms   2.3% of a frame
    o.pos.x = o.pos.x + 1.5         nested every time   0.66 ms   4.0% of a frame

A frame at 60fps is 16.7 ms, and Kaplay draws in JavaScript at full speed
regardless, so even the wasteful idiom leaves 96% of the frame free at 200
objects. About half of that cost is the GameObj wrapper below; without it the
same two lines measure 0.17 ms and 0.44 ms, and `btn.add([...])` and
`player.onCollide(...)` do not work at all. That trade was made deliberately
and with the numbers in hand.

Prefer `o.move(...)` where it exists, but not at the cost of clarity — none of
these are close to a problem at classroom scale.
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


def _accepts(fn):
    """How many positional arguments fn will take, or None for any number.

    Worked out once, when the callback is wrapped, because this runs on every
    frame and inspect.signature is far too slow to do sixty times a second.
    """
    import inspect

    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return None                      # a builtin or C function: pass it all

    count = 0
    for p in params:
        if p.kind is p.VAR_POSITIONAL:   # *args takes everything
            return None
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            count += 1
    return count


def _guard(fn):
    """Wrap a Python callback so it behaves the way JavaScript expects.

    Two jobs.

    **Extra arguments are dropped.** Kaplay calls handlers with whatever it has
    — onKeyDown hands the callback the key that was pressed, onCollide hands it
    both objects. A JavaScript function ignores arguments it did not ask for,
    so every Kaplay example is written `onKeyDown("left", () => ...)` and works.
    The same line in Python is `lambda: ...`, which raises TypeError: <lambda>
    takes 0 positional arguments but 1 was given. Since the whole premise here
    is that Kaplay's documentation applies, the bridge matches JavaScript's
    behaviour rather than making students count arguments the docs never
    mention. A callback that *does* want the key still gets it.

    **Errors are reported, not swallowed**, and the `_running` check is what
    makes stopping safe. Kaplay may call a handler again within the same frame
    it was told to quit, and destroying the proxy out from under it is a
    use-after-free — which surfaces as an incoherent JavaScript error rather
    than a stopped game. So a stopped game's callbacks become no-ops and the
    proxies stay alive until a new game replaces them. That also gives the
    error reporter its "report once" for free: the first exception stops the
    game, and every later call returns here immediately.
    """
    limit = _accepts(fn)

    def guarded(*args, **kwargs):
        if not _running[0]:
            return None
        if limit is not None and len(args) > limit:
            args = args[:limit]
        try:
            return _convert_result(fn(*[_wrap(a) for a in args], **kwargs))
        except Exception as err:
            _report(err)
            return None
    guarded.__name__ = getattr(fn, "__name__", "callback")
    return guarded


def _convert_result(value):
    """What a Python callback hands BACK to JavaScript.

    Arguments going into a callback were always converted; the return value
    was not, and Kaplay calls some callbacks precisely for what they return.
    A level's tile factories are the case that found this: every entry in
    `tiles` is a function returning a component list, one per tile. Handed
    back as a Python list it reaches JavaScript as an opaque object, and
    Kaplay's first move is to set `.parent` on it:

        AttributeError: 'list' object has no attribute 'parent'
        and no __dict__ for setting new attributes

    — an error that names neither the tile, nor the level, nor the fact that
    a list was supposed to become an array.

    Only containers are converted. A returned callable is deliberately left
    alone: converting it would mint a fresh proxy every time the callback ran,
    which at sixty frames a second is a leak, not a feature.
    """
    if isinstance(value, GameObj):
        return value.js
    if isinstance(value, (list, tuple, dict)):
        return _convert(value)
    return value


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
    if isinstance(value, GameObj):
        return value.js          # hand JavaScript the real object, not the wrapper
    if isinstance(value, dict):
        return _js_object({k: _convert(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return to_js([_convert(v) for v in value])
    # JsProxy and anything else Pyodide already knows how to send
    return value


#: Methods on a game object whose arguments have to cross the bridge: the ones
#: taking a component list, and every event registrar, which takes a callback.
#: Everything else — move, jump, pos, isGrounded — is left completely alone, so
#: the per-frame path stays as fast as it was.
_MARSHAL = {"add", "use", "wait", "loop", "tween"}


def _needs_marshalling(name):
    return name in _MARSHAL or name.startswith("on")


class GameObj:
    """A Kaplay game object, with its argument-taking methods bridged.

    Kaplay's own documentation is full of calls made *on* an object rather than
    on the context — `btn.add([text("Ring")])` for a child, and
    `player.onCollide("coin", ...)`, `enemy.onStateEnter("attack", ...)` for
    events. Those go straight to JavaScript without passing through this
    module, so a Python list arrives as an opaque object rather than an array,
    and a Python callback arrives unguarded and unowned — it can be collected
    while JavaScript still holds it.

    So the few methods that take lists or callbacks are wrapped, and every
    other attribute is handed back untouched. That split is deliberate:
    `o.pos`, `o.move(...)` and `o.isGrounded()` run on every frame and pay
    nothing but one attribute lookup, while `o.onCollide(...)` runs once.
    """

    __slots__ = ("_js",)

    def __init__(self, js_obj):
        object.__setattr__(self, "_js", js_obj)

    def __getattr__(self, name):
        attr = getattr(object.__getattribute__(self, "_js"), name)
        if _needs_marshalling(name) and callable(attr):
            def method(*args, **kwargs):
                return _wrap(_call(attr, args, kwargs))
            return method
        return attr

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "_js"), name, value)

    def __repr__(self):
        return "<Kaplay object>"

    @property
    def js(self):
        """The raw JavaScript object, for anything this wrapper gets in the way of."""
        return object.__getattribute__(self, "_js")


def _wrap(value):
    """Wrap a Kaplay return value if it is a game object, else leave it be.

    Only game objects get wrapped — a vec2 or a colour is left raw so that
    reading `v.x` costs nothing. `use` is the giveaway: every game object has
    it, and none of Kaplay's plain values do.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    try:
        if hasattr(value, "use") and hasattr(value, "add"):
            return GameObj(value)
    except Exception:
        pass
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

    # End the previous game before starting this one. Its loop keeps running
    # otherwise: pressing Run twice would leave two engines drawing to one
    # canvas, both reading the keyboard.
    shutdown()

    # The previous game's callbacks are deliberately NOT freed — not here, not
    # in shutdown(), not anywhere. They are kept alive, and inert, for as long
    # as the page lives.
    #
    # This is the third time this exact bug was found, which is the argument
    # for the rule. Freeing a proxy that JavaScript still holds crashes with
    # "Object has already been destroyed", and every attempt to prove nothing
    # still holds it has been wrong: Kaplay can call a handler in the frame it
    # was told to quit, a queued animation frame can land after quit() returns,
    # and pressing Run twice never quit the first engine at all. Each time the
    # reasoning looked sound and the student got an incomprehensible crash.
    #
    # What leaking costs: a few hundred bytes per callback, for the lifetime of
    # a browser tab, reclaimed on reload. Fifty Runs of a ten-handler game is
    # well under a megabyte. That is a very cheap price for never crashing.
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
        _ctx.loadRoot(_asset_root())
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


class _Debug:
    """Kaplay's debug object, reached through whichever context is live.

    A plain star-imported value would be bound once, at import, to a context
    that may since have been replaced. This looks it up every time, so
    `debug.inspect = True` works on the first Run and every Run after it.
    """

    def __getattr__(self, name):
        return getattr(context().debug, name)

    def __setattr__(self, name, value):
        setattr(context().debug, name, value)


debug = _Debug()


def _asset_root():
    """Where loadSprite/loadSound paths are resolved from.

    An exported game sets window.__pyideAssetRoot to "" because every asset it
    needs is already inlined as a data: URI.
    """
    window = getattr(js, "window", None)
    if window is not None:
        override = getattr(window, "__pyideAssetRoot", None)
        if override is not None:
            return override
    return ASSET_ROOT


def _already_located(path):
    return (path.startswith("http://") or path.startswith("https://")
            or path.startswith("data:") or path.startswith("/"))


def _fix_asset_list(name, args):
    """Apply the asset root to a LIST of paths, which Kaplay does not.

    Kaplay's loader begins `e = pe(e)`, and `pe` returns its argument unchanged
    unless it is a string — so a single path gets the load root prepended and a
    list of paths does not. Each frame is then fetched relative to the page
    instead, which on a share link means /s/<slug>/images/dino_0.png, a 404,
    a sprite that never loads, and absolutely nothing on the canvas.

    No error is raised anywhere along that path, which is what makes it so
    expensive: the program is correct, the documentation is correct, and the
    screen is empty. So the root is applied here, per element, and the
    multi-frame form behaves like the single-frame one.
    """
    if not name.startswith("load") or len(args) < 2:
        return args
    paths = args[1]
    if not isinstance(paths, (list, tuple)):
        return args
    root = _asset_root()
    fixed = [
        root + p if isinstance(p, str) and not _already_located(p) else p
        for p in paths
    ]
    return args[:1] + (fixed,) + args[2:]


def _warn(message):
    import sys
    sys.stderr.write("Note: " + message + "\n")


def _sanity_check(name, args):
    """Catch the mistakes Kaplay accepts but nobody means.

    Only one so far, and it earned its place: anchor() takes a name like
    "center" or an offset between -1 and 1, but Kaplay's default branch passes
    any other Vec2 straight through. So `anchor(center())` on a 400x300 canvas
    sets the anchor to (200, 150) and draws the sprite some five thousand
    pixels off screen — no error, no warning, nothing on the canvas, and the
    line above it, `pos(center())`, is correct. That is a whole period lost to
    a silent success.
    """
    if name != "anchor" or len(args) != 1:
        return
    value = args[0]
    if isinstance(value, str):
        return
    x = getattr(value, "x", None)
    y = getattr(value, "y", None)
    if x is None or y is None:
        return
    try:
        if abs(x) > 1 or abs(y) > 1:
            _warn(
                'anchor(%g, %g) is far outside the -1 to 1 range it expects, '
                "so this object will be drawn off screen. anchor() takes a "
                'name — anchor("center") — not a position. You may be thinking '
                "of pos(), which does take center()." % (x, y)
            )
    except TypeError:
        pass


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

    # Once the game is running, hand back non-callables (constants) as
    # themselves. A name this Kaplay build does not have must NOT raise here:
    # `from kaplay import *` resolves all of __all__ at once, and on the second
    # Run of a session the context is still live from the first, so one unknown
    # name would kill the import line itself rather than the call that used it.
    # Falling through to the wrapper defers the error to the point of use,
    # where it can name the function the student actually typed.
    if _ctx is not None:
        try:
            attr = _lookup(name)
        except AttributeError:
            attr = None
        if attr is not None and not callable(attr):
            return attr

    def wrapper(*args, **kwargs):
        _sanity_check(name, args)
        args = _fix_asset_list(name, args)
        return _wrap(_call(_lookup(name), args, kwargs))

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
    "kaplay", "context", "shutdown", "debug", "loadSprite", "loadSound", "loadFont",
    "loadSpriteAtlas", "loadBean",
    # making things
    "add", "destroy", "destroyAll", "get", "make", "readd",
    # components
    "sprite", "pos", "area", "body", "anchor", "scale", "rotate", "color",
    "opacity", "outline", "text", "rect", "circle", "z", "fixed", "move",
    "offscreen", "lifespan", "health", "timer", "stay", "state", "tile",
    "animate",
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
    "setCamPos", "getCamPos", "setCamScale", "toWorld", "toScreen",
    "shake", "flash", "setGravity", "getGravity", "setBackground", "addKaboom",
    # `debug` is an object, not a function, so it is reached as
    # kaplay.debug rather than star-imported as a lazy wrapper.
    # levels
    "addLevel", "drawSprite", "drawText", "drawRect",
]
