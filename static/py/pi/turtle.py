"""turtle for PyIDE: Python's turtle graphics, drawn on the page.

Desktop Python's turtle draws in a Tk window, and the browser has no Tk, so
Pyodide has no turtle at all: `import turtle` was a ModuleNotFoundError.
This is the same module by its calls (the Beginner's Guide's Turtle
Snowflakes, and the usual forward / left / circle / begin_fill / write /
onkey programs), drawing on a canvas in the stage (static/turtle.js) — so
code written here runs in Thonny on a Pi, or in IDLE, unchanged.

It runs as a Pi program does (_pyide_run_pi in runtime.js), taking turns
with the page through _pyide_pi: a turtle moves a little each turn, at its
speed(), so the drawing is watched being made, and Stop is heard as it is
for a Pi. speed(0), or tracer(0), draws at once.

turtle.done() / mainloop() keeps the program running while it has keys,
clicks or timers to answer (onkey, onscreenclick, ontimer), until Stop; with
none it returns, and the drawing stays.
"""
import math
import json

import _pyide_pi as _turns

__all__ = [
    "Turtle", "RawTurtle", "Pen", "Screen", "Vec2D", "TurtleGraphicsError", "Terminator",
    "done", "mainloop", "exitonclick", "bye", "bgcolor", "title", "setup", "tracer", "update",
    "listen", "onkey", "onkeyrelease", "onkeypress", "onscreenclick", "ontimer", "colormode",
    "screensize", "window_width", "window_height", "delay", "clearscreen", "resetscreen",
    "getscreen", "getturtle", "getpen", "textinput", "numinput", "register_shape", "addshape",
]


class TurtleGraphicsError(Exception):
    pass


class Terminator(Exception):
    pass


class Vec2D(tuple):
    """A turtle's position: (x, y), printed to two places as turtle does."""

    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, other):
        return Vec2D(self[0] + other[0], self[1] + other[1])

    def __sub__(self, other):
        return Vec2D(self[0] - other[0], self[1] - other[1])

    def __mul__(self, other):
        if isinstance(other, Vec2D):
            return self[0] * other[0] + self[1] * other[1]
        return Vec2D(self[0] * other, self[1] * other)

    def __rmul__(self, other):
        if isinstance(other, (int, float)):
            return Vec2D(self[0] * other, self[1] * other)
        return NotImplemented

    def __neg__(self):
        return Vec2D(-self[0], -self[1])

    def __abs__(self):
        return math.hypot(self[0], self[1])

    def rotate(self, angle):
        a = math.radians(angle)
        c, s = math.cos(a), math.sin(a)
        return Vec2D(self[0] * c - self[1] * s, self[0] * s + self[1] * c)

    def __repr__(self):
        return "(%.2f,%.2f)" % self


# ------------------------------------------------------------------ colours
_CSS = set("""aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen""".split())

_mode = {"colormode": 1.0}


def _css(colour):
    """A colour as turtle takes it -> what the canvas draws."""
    if isinstance(colour, str):
        name = colour.strip()
        key = name.lower().replace(" ", "")
        if key in _CSS:
            return key
        if key.startswith("grey") or key.startswith("gray"):
            # Tk's grey0 .. grey100
            try:
                n = int(key[4:])
                if 0 <= n <= 100:
                    v = int(round(n * 2.55))
                    return "#%02x%02x%02x" % (v, v, v)
            except ValueError:
                pass
        if name.startswith("#") and len(name) in (4, 7):
            try:
                int(name[1:], 16)
                return name.lower()
            except ValueError:
                pass
        raise TurtleGraphicsError("bad color string: %s" % colour)
    try:
        r, g, b = colour
    except (TypeError, ValueError):
        raise TurtleGraphicsError("bad color arguments: %s" % (colour,))
    cm = _mode["colormode"]
    if not all(0 <= v <= cm for v in (r, g, b)):
        raise TurtleGraphicsError("bad color sequence: %s" % (colour,))
    if cm == 1.0:
        r, g, b = (int(round(v * 255)) for v in (r, g, b))
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def _colour_args(args):
    if len(args) == 1:
        return args[0]
    if len(args) == 3:
        return tuple(args)
    raise TurtleGraphicsError("bad color arguments: %s" % (args,))


# -------------------------------------------------------------- the page
def _page():
    return _turns.pi()


def _op(*op):
    _page().turtleOp(json.dumps(op))


# Shapes, pointing along +y as turtle's own are; drawn turned to the heading.
_SHAPES = {
    "arrow": [(-10, 0), (10, 0), (0, 10)],
    "classic": [(0, 0), (-5, -9), (0, -7), (5, -9)],
    "triangle": [(10, -5.77), (0, 11.55), (-10, -5.77)],
    "square": [(10, -10), (10, 10), (-10, 10), (-10, -10)],
    "circle": [(10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a))) for a in range(0, 360, 18)],
    "turtle": [(0, 16), (-2, 14), (-1, 10), (-4, 7), (-7, 9), (-9, 8), (-6, 5), (-7, 1), (-5, -3),
               (-8, -6), (-6, -8), (-4, -5), (0, -7), (4, -5), (6, -8), (8, -6), (5, -3), (7, 1),
               (6, 5), (9, 8), (7, 9), (4, 7), (1, 10), (2, 14)],
    "blank": [],
}

# speed(1) .. speed(10): how far a turtle goes in a second, roughly as
# desktop turtle looks. speed(0) is at once.
_PX_PER_S = {1: 50, 2: 90, 3: 150, 4: 210, 5: 280, 6: 360, 7: 450, 8: 560, 9: 700, 10: 900}
_SPEEDS = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}


# ------------------------------------------------------------- the screen
class _Screen(object):
    def __init__(self):
        self._turtles = []
        self._tracer = 1
        self._keys = {}            # ("press"|"release", key) -> fn
        self._click = None
        self._timers = []          # [due, fn]
        self._width, self._height = 640, 480
        self._bg = "white"
        _turns.after_turn(self._poll)
        _op("reset", self._width, self._height)

    # ---- the window
    def bgcolor(self, *args):
        if not args:
            return self._bg
        self._bg = _colour_args(args)
        _op("bg", _css(self._bg))
        _turns.breathe()

    def title(self, titlestring):
        _op("title", str(titlestring))

    def setup(self, width=0.5, height=0.75, startx=None, starty=None):
        w = width if isinstance(width, int) and width > 1 else 640
        h = height if isinstance(height, int) and height > 1 else 480
        self._width, self._height = w, h
        _op("size", w, h)

    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        if canvwidth is None and canvheight is None and bg is None:
            return (self._width, self._height)
        if canvwidth:
            self._width = int(canvwidth)
        if canvheight:
            self._height = int(canvheight)
        _op("size", self._width, self._height)
        if bg is not None:
            self.bgcolor(bg)

    def window_width(self):
        return self._width

    def window_height(self):
        return self._height

    def colormode(self, cmode=None):
        if cmode is None:
            return _mode["colormode"]
        if cmode not in (1.0, 255):
            raise TurtleGraphicsError("bad color mode: %s (it's 1.0 or 255)" % cmode)
        _mode["colormode"] = 1.0 if cmode == 1 else 255

    def tracer(self, n=None, delay=None):
        if n is None:
            return self._tracer
        self._tracer = int(n)
        if self._tracer:
            self.update()

    def update(self):
        for t in self._turtles:
            t._show()
        _turns.breathe(force=True)

    def delay(self, delay=None):
        return 0 if delay is None else None

    def turtles(self):
        return list(self._turtles)

    def clear(self):
        self._keys.clear()
        self._click = None
        self._timers = []
        for t in self._turtles:
            t._hidden_by_clear()
        self._turtles = []
        _op("reset", self._width, self._height)
        self.bgcolor("white")

    clearscreen = clear

    def reset(self):
        for t in self._turtles:
            t.reset()

    resetscreen = reset

    def register_shape(self, name, shape=None):
        if shape is None:
            raise TurtleGraphicsError("PyIDE's turtle takes shapes as a list of points: register_shape(name, ((0, 0), ...))")
        _SHAPES[name] = [tuple(p) for p in shape]

    addshape = register_shape

    def getshapes(self):
        return sorted(_SHAPES)

    # ---- input
    def listen(self, xdummy=None, ydummy=None):
        _op("listen")

    def onkeyrelease(self, fun, key):
        self._on(("release", key), fun)

    onkey = onkeyrelease

    def onkeypress(self, fun, key=None):
        self._on(("press", key), fun)

    def _on(self, which, fun):
        if fun is None:
            self._keys.pop(which, None)
        else:
            self._keys[which] = fun

    def onscreenclick(self, fun, btn=1, add=None):
        self._click = fun

    onclick = onscreenclick

    def ontimer(self, fun, t=0):
        import time
        self._timers.append([time.monotonic() + max(0, t) / 1000.0, fun])

    def _poll(self):
        """Keys and clicks from the page, and timers that are due: run here,
        between the program's lines, as Tk would run them between its
        events."""
        import time
        text = str(_page().turtleEvents())
        for e in (json.loads(text) if text else []):
            if e[0] in ("press", "release"):
                f = self._keys.get((e[0], e[1])) or (self._keys.get((e[0], None)) if e[0] == "press" else None)
                if f:
                    f()
            elif e[0] == "click" and self._click:
                self._click(e[1], e[2])
        now = time.monotonic()
        due = [t for t in self._timers if t[0] <= now]
        if due:
            self._timers = [t for t in self._timers if t[0] > now]
            for _, f in due:
                f()

    def _busy(self):
        return bool(self._keys or self._click or self._timers)

    def mainloop(self):
        """Answer keys, clicks and timers until Stop; with none to answer,
        there is nothing to wait for, and the program ends with its drawing
        still showing."""
        self.update()
        while self._busy():
            _turns.sleep(0.02)

    done = mainloop

    def exitonclick(self):
        self.update()
        clicked = []
        old = self._click
        self._click = lambda x, y: clicked.append(1)
        _turns.wait_until(lambda: bool(clicked))
        self._click = old

    def bye(self):
        self._keys.clear()
        self._click = None
        self._timers = []

    def textinput(self, title, prompt):
        return input(prompt + " ")

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        while True:
            text = input(prompt + " ")
            if text == "" and default is not None:
                return default
            try:
                n = float(text)
            except ValueError:
                print("That isn't a number.")
                continue
            if (minval is not None and n < minval) or (maxval is not None and n > maxval):
                print("It must be between %s and %s." % (minval, maxval))
                continue
            return n


_screen = [None]


def Screen():
    """The one screen (turtle's Screen() is the same object every call)."""
    if _screen[0] is None:
        _screen[0] = _Screen()
    return _screen[0]


# -------------------------------------------------------------- a turtle
class Turtle(object):
    _count = [0]

    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        self.screen = Screen()
        Turtle._count[0] += 1
        self._id = Turtle._count[0]
        self._shape = shape
        self._reset_state()
        self._visible = visible
        self.screen._turtles.append(self)
        self._show()

    def _reset_state(self):
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._down = True
        self._pencolor = "black"
        self._fillcolor = "black"
        self._size = 1
        self._speed = 3
        self._fill = None
        self._stretch = (1.0, 1.0)
        self._degrees = 360.0

    # ---- what's drawn
    def _show(self):
        if self.screen._tracer:
            _op("turtle", self._id, self._x, self._y, self._heading, self._visible,
                [list(p) for p in _SHAPES.get(self._shape, _SHAPES["classic"])],
                _css(self._pencolor), _css(self._fillcolor), list(self._stretch))

    def _hidden_by_clear(self):
        self._visible = False

    def _instant(self):
        return self._speed == 0 or not self.screen._tracer

    def _goto(self, x, y):
        x0, y0 = self._x, self._y
        dist = math.hypot(x - x0, y - y0)
        if self._instant() or dist == 0:
            steps = 1
        else:
            per_frame = _PX_PER_S[self._speed] / 30.0
            steps = max(1, int(math.ceil(dist / per_frame)))
        for i in range(1, steps + 1):
            nx = x0 + (x - x0) * i / steps
            ny = y0 + (y - y0) * i / steps
            if self._down:
                _op("line", self._id, self._x, self._y, nx, ny, _css(self._pencolor), self._size)
            self._x, self._y = nx, ny
            if steps > 1:
                self._show()
                _turns.sleep(1 / 30.0)
        self._x, self._y = float(x), float(y)
        if self._fill is not None:
            self._fill.append((self._x, self._y))
        self._show()
        _turns.breathe()

    def _turn(self, angle):
        full = self._degrees
        to_deg = 360.0 / full
        delta = angle * to_deg
        if not self._instant() and self._visible and delta:
            per_frame = _PX_PER_S[self._speed] * 2 / 30.0
            steps = max(1, int(math.ceil(abs(delta) / per_frame)))
            start = self._heading
            for i in range(1, steps):
                self._heading = (start + delta * i / steps) % 360
                self._show()
                _turns.sleep(1 / 30.0)
            self._heading = start
        self._heading = (self._heading + delta) % 360
        self._show()
        _turns.breathe()

    # ---- moving
    def forward(self, distance):
        a = math.radians(self._heading)
        self._goto(self._x + distance * math.cos(a), self._y + distance * math.sin(a))

    fd = forward

    def backward(self, distance):
        self.forward(-distance)

    bk = back = backward

    def left(self, angle):
        self._turn(angle)

    lt = left

    def right(self, angle):
        self._turn(-angle)

    rt = right

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._goto(float(x), float(y))

    setpos = setposition = goto

    def setx(self, x):
        self._goto(float(x), self._y)

    def sety(self, y):
        self._goto(self._x, float(y))

    def setheading(self, to_angle):
        self._turn((to_angle * 360.0 / self._degrees - self._heading + 180) % 360 - 180)

    seth = setheading

    def home(self):
        self.goto(0, 0)
        self.setheading(0)

    def circle(self, radius, extent=None, steps=None):
        if extent is None:
            extent = self._degrees
        full = extent * 360.0 / self._degrees
        if steps is None:
            frac = abs(full) / 360.0
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = full / steps
        w2 = 0.5 * w
        length = 2.0 * radius * math.sin(math.radians(w2))
        if radius < 0:
            length, w, w2 = -length, -w, -w2
        speed = self._speed
        if not self._instant():
            self._speed = max(1, speed)
        self._heading = (self._heading + w2) % 360
        for _ in range(steps):
            self.forward(length)
            self._heading = (self._heading + w) % 360
        self._heading = (self._heading - w2) % 360
        self._speed = speed
        self._show()

    def dot(self, size=None, *color):
        if not color and isinstance(size, (str, tuple)):
            color, size = (size,), None
        if size is None:
            size = max(self._size + 4, 2 * self._size)
        c = _css(_colour_args(color)) if color else _css(self._pencolor)
        _op("dot", self._id, self._x, self._y, size, c)
        _turns.breathe()

    def stamp(self):
        _op("stamp", self._id, self._x, self._y, self._heading,
            [list(p) for p in _SHAPES.get(self._shape, _SHAPES["classic"])],
            _css(self._pencolor), _css(self._fillcolor), list(self._stretch))
        return self._id

    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        if align not in ("left", "center", "right"):
            raise TurtleGraphicsError("align must be 'left', 'center' or 'right'")
        family, size, style = (list(font) + ["normal"])[:3] if isinstance(font, (tuple, list)) else ("Arial", 8, "normal")
        _op("text", self._id, self._x, self._y, str(arg), align, family, int(size), style, _css(self._pencolor))
        _turns.breathe()

    def clear(self):
        _op("clear", self._id)

    def reset(self):
        _op("clear", self._id)
        self._reset_state()
        self._show()

    # ---- where
    def position(self):
        return Vec2D(round(self._x, 10) + 0.0, round(self._y, 10) + 0.0)

    pos = position

    def xcor(self):
        return round(self._x, 10) + 0.0

    def ycor(self):
        return round(self._y, 10) + 0.0

    def heading(self):
        return round(self._heading * self._degrees / 360.0, 10) % self._degrees

    def towards(self, x, y=None):
        if y is None:
            x, y = x
        return (math.degrees(math.atan2(y - self._y, x - self._x)) % 360) * self._degrees / 360.0

    def distance(self, x, y=None):
        if y is None:
            if isinstance(x, Turtle):
                x, y = x.pos()
            else:
                x, y = x
        return math.hypot(x - self._x, y - self._y)

    def degrees(self, fullcircle=360.0):
        self._degrees = float(fullcircle)

    def radians(self):
        self._degrees = 2 * math.pi

    # ---- the pen
    def penup(self):
        self._down = False

    pu = up = penup

    def pendown(self):
        self._down = True

    pd = down = pendown

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is None:
            return self._size
        self._size = width

    width = pensize

    def speed(self, speed=None):
        if speed is None:
            return self._speed
        if isinstance(speed, str):
            if speed not in _SPEEDS:
                raise TurtleGraphicsError("bad speed: %s" % speed)
            speed = _SPEEDS[speed]
        speed = int(round(speed))
        self._speed = speed if 0.5 < speed < 10.5 else 0

    def pencolor(self, *args):
        if not args:
            return self._pencolor
        c = _colour_args(args)
        _css(c)
        self._pencolor = c
        self._show()

    def fillcolor(self, *args):
        if not args:
            return self._fillcolor
        c = _colour_args(args)
        _css(c)
        self._fillcolor = c
        self._show()

    def color(self, *args):
        if not args:
            return (self._pencolor, self._fillcolor)
        if len(args) == 1:
            self.pencolor(args[0])
            self.fillcolor(args[0])
        elif len(args) == 2:
            self.pencolor(args[0])
            self.fillcolor(args[1])
        elif len(args) == 3:
            self.pencolor(*args)
            self.fillcolor(*args)
        else:
            raise TurtleGraphicsError("bad color arguments: %s" % (args,))

    def begin_fill(self):
        self._fill = [(self._x, self._y)]
        _op("fillmark", self._id)

    def end_fill(self):
        if self._fill is not None and len(self._fill) > 2:
            _op("fill", self._id, [list(p) for p in self._fill], _css(self._fillcolor))
        self._fill = None
        _turns.breathe()

    def filling(self):
        return self._fill is not None

    # ---- how it looks
    def showturtle(self):
        self._visible = True
        self._show()

    st = showturtle

    def hideturtle(self):
        self._visible = False
        self._show()

    ht = hideturtle

    def isvisible(self):
        return self._visible

    def shape(self, name=None):
        if name is None:
            return self._shape
        if name not in _SHAPES:
            raise TurtleGraphicsError("There is no shape named %s" % name)
        self._shape = name
        self._show()

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None:
            return self._stretch + (1,)
        if stretch_len is None:
            stretch_len = stretch_wid
        self._stretch = (float(stretch_wid), float(stretch_len))
        self._show()

    turtlesize = shapesize

    def getscreen(self):
        return self.screen

    def getturtle(self):
        return self

    getpen = getturtle

    def clone(self):
        t = Turtle(self._shape, visible=False)
        for k in ("_x", "_y", "_heading", "_down", "_pencolor", "_fillcolor", "_size", "_speed", "_stretch", "_degrees"):
            setattr(t, k, getattr(self, k))
        t._visible = self._visible
        t._show()
        return t

    def onclick(self, fun, btn=1, add=None):
        raise TurtleGraphicsError("PyIDE's turtle hears clicks on the screen: use screen.onscreenclick(fun)")


RawTurtle = RawPen = Pen = Turtle


# ------------------------------------------------- the module's own calls
# turtle.forward(100) and friends use one turtle made on first use, and
# turtle.bgcolor(...) the screen, as desktop turtle does.
_pen = [None]


def getturtle():
    if _pen[0] is None:
        _pen[0] = Turtle()
    return _pen[0]


getpen = getturtle


def getscreen():
    return Screen()


def _turtle_function(name):
    def f(*args, **kwargs):
        return getattr(getturtle(), name)(*args, **kwargs)
    f.__name__ = name
    return f


def _screen_function(name):
    def f(*args, **kwargs):
        return getattr(Screen(), name)(*args, **kwargs)
    f.__name__ = name
    return f


for _name in ("forward fd backward bk back left lt right rt goto setpos setposition setx sety "
              "setheading seth home circle dot stamp write position pos xcor ycor heading towards "
              "distance degrees radians penup pu up pendown pd down isdown pensize width speed "
              "pencolor fillcolor color begin_fill end_fill filling showturtle st hideturtle ht "
              "isvisible shape shapesize turtlesize clone reset clear").split():
    globals()[_name] = _turtle_function(_name)
    __all__.append(_name)

for _name in ("bgcolor title setup screensize window_width window_height colormode tracer update "
              "delay listen onkey onkeyrelease onkeypress onscreenclick ontimer mainloop done "
              "exitonclick bye textinput numinput register_shape addshape clearscreen resetscreen "
              "turtles getshapes").split():
    globals()[_name] = _screen_function(_name)


del _name
