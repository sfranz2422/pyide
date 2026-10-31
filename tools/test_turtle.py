#!/usr/bin/env python3
"""Turtle graphics (static/py/pi/turtle.py, static/turtle.js): the real
Pyodide running the book's Turtle Snowflakes and the usual turtle calls,
through the same runner as a Pi program (test_pi_python.py's harness).

    python3 tools/test_turtle.py

Pyodide has no turtle of its own (it needs Tk), so before this `import
turtle` was a ModuleNotFoundError. What each check guards fails silently
when broken: a drawing that comes out wrong is still a drawing.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_pi_python as harness  # noqa: E402

failures = 0
count = 0


def check(name, ok, detail=""):
    global failures, count
    count += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  -- " + str(detail)[:600]))
    if not ok:
        failures += 1


# The book's Turtle Snowflakes (chapter 5), as far as the colours, at speed 0.
SNOW = ("import turtle\npat = turtle.Turtle()\nturtle.Screen().bgcolor('blue')\npat.color('cyan')\npat.speed(0)\n"
        "for i in range(10):\n    for i in range(2):\n        pat.forward(100)\n        pat.right(60)\n"
        "        pat.forward(100)\n        pat.right(120)\n    pat.right(36)\nprint(pat.position(), pat.heading())\n")

RUNS = [
    ("snow", {}, SNOW, [], ""),
    ("slow", {}, "import turtle\nt = turtle.Turtle()\nt.forward(150)\nprint('there')\n", [[350, "sample", None]], ""),
    ("fill", {}, "import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.fillcolor('red')\nt.begin_fill()\n"
     "for i in range(4):\n    t.forward(50)\n    t.left(90)\nt.end_fill()\nt.forward(80)\n", [], ""),
    ("circle", {}, "import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.circle(50)\nprint(t.position(), round(t.heading()) % 360)\n", [], ""),
    ("module", {}, "from turtle import *\nspeed(0)\nforward(100)\nleft(90)\nforward(50)\nprint(pos(), xcor(), ycor())\n", [], ""),
    ("badcolour", {}, "import turtle\nt = turtle.Turtle()\nt.color('bluish')\n", [], ""),
    ("rgb", {}, "import turtle\nturtle.colormode(255)\nt = turtle.Turtle()\nt.speed(0)\nt.pencolor(255, 128, 0)\nt.forward(10)\n"
     "t.write('Hi', align='center', font=('Arial', 16, 'bold'))\n", [], ""),
    ("keys", {}, "import turtle\nscreen = turtle.Screen()\ndef up():\n    print('up')\nscreen.onkey(up, 'Up')\n"
     "screen.listen()\nturtle.done()\n", [[200, "tpush", ["release", "Up"]], [500, "stop", None]], ""),
    ("donenothing", {}, "import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.forward(20)\nturtle.done()\nprint('after')\n", [], ""),
    ("timer", {}, "import turtle\nscreen = turtle.Screen()\ndef tick():\n    print('tick')\nscreen.ontimer(tick, 100)\n"
     "turtle.mainloop()\nprint('over')\n", [], ""),
    ("click", {}, "import turtle\nscreen = turtle.Screen()\ndef where(x, y):\n    print('click', x, y)\n    screen.bye()\n"
     "screen.onscreenclick(where)\nturtle.done()\n", [[200, "tpush", ["click", 10.5, -20]]], ""),
    ("clearone", {}, "import turtle\na = turtle.Turtle()\nb = turtle.Turtle()\na.speed(0)\nb.speed(0)\na.forward(30)\n"
     "b.left(90)\nb.forward(30)\na.clear()\nb.hideturtle()\n", [], ""),
]


def main():
    r = harness.run_node(RUNS, True)
    g = lambda n: r.get(n, {})

    s = g("snow")
    d = s.get("drawing") or {}
    lines = [o for o in d.get("ops", []) if o[0] == "line"]
    check("import turtle works (Pyodide has no turtle of its own)", s.get("status") == "ok", s)
    check("Turtle Snowflakes: ten parallelograms, forty lines, all cyan", len(lines) == 40
          and all(o[6] == "cyan" for o in lines), [len(lines), lines[:1]])
    check("…on a blue screen", d.get("bg") == "blue", d.get("bg"))
    check("…and pat ends where it began, facing east, printed as turtle prints a position",
          s.get("text", "").strip() == "(0.00,0.00) 0.0", s.get("text"))

    sl = g("slow")
    mid = (sl.get("samples") or [{}])[0].get("turtles", {})
    x = list(mid.values())[0][2] if mid else None
    check("at its normal speed a turtle is seen moving (part way there mid-move)",
          x is not None and 10 < x < 140 and sl.get("ms", 0) > 600, [x, sl.get("ms")])
    check("…and the program goes on once it arrives", "there" in sl.get("text", ""), sl)

    f = g("fill")
    ops = (f.get("drawing") or {}).get("ops", [])
    kinds = [o[0] for o in ops]
    check("begin_fill/end_fill fills the shape in red", any(o[0] == "fill" and o[3] == "red" and len(o[2]) == 5 for o in ops), ops[:2])
    check("…under the lines drawn while filling, as desktop turtle draws it",
          kinds[:5] == ["fill", "line", "line", "line", "line"] and "fillmark" not in kinds, kinds)

    c = g("circle")
    check("circle(50) comes back round to where it started", c.get("text", "").strip() == "(0.00,0.00) 0", c)
    check("the module's own calls (from turtle import *) drive one turtle",
          g("module").get("text", "").strip() == "(100.00,50.00) 100.0 50.0", g("module"))
    check("a colour that isn't one is turtle's own error", "TurtleGraphicsError" in g("badcolour").get("text", "")
          and "bad color string: bluish" in g("badcolour").get("text", ""), g("badcolour"))
    rops = (g("rgb").get("drawing") or {}).get("ops", [])
    check("colormode(255) colours", any(o[0] == "line" and o[6] == "#ff8000" for o in rops), rops)
    check("write() puts the text on the screen", any(o[0] == "text" and o[4] == "Hi" and o[5] == "center" for o in rops), rops)

    k = g("keys")
    check("onkey + listen + done(): a key runs its function, until Stop", "up" in k.get("text", "")
          and k.get("status") == "stopped", k)
    dn = g("donenothing")
    check("done() with nothing to answer ends the program, the drawing still there",
          dn.get("status") == "ok" and "after" in dn.get("text", "") and dn.get("ms", 9999) < 3000
          and any(o[0] == "line" for o in (dn.get("drawing") or {}).get("ops", [])), dn)
    t = g("timer")
    check("ontimer runs its function, then mainloop has nothing left and returns",
          t.get("text", "") == "tick\nover\n" and t.get("status") == "ok", t)
    ck = g("click")
    check("onscreenclick gets turtle's x and y", "click 10.5 -20" in ck.get("text", "") and ck.get("status") == "ok", ck)
    co = g("clearone")
    cd = co.get("drawing") or {}
    cl = [o for o in cd.get("ops", []) if o[0] == "line"]
    check("clear() takes away that turtle's drawing only", len(cl) == 1 and abs(cl[0][4]) < 1e-9 and cl[0][5] == 30, cl)
    check("hideturtle hides it", sorted(v[5] for v in cd.get("turtles", {}).values()) == [False, True], cd.get("turtles"))

    print("%d checks, %s" % (count, "all ok" if not failures else "%d FAILED" % failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
