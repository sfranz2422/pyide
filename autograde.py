"""
Tests in an assignment's notes, for Check my work and Check all.

A ```tests block in the notes is the assignment's tests, one per line:

    input 3, 4 -> prints 7          run it, typing 3 then 4; its output must
                                    contain 7 (case and spacing ignored)
    input 5 -> prints exactly 25    ... and be exactly that, trimmed
    prints Hello                    run it with no input
    area(3, 4) == 12                call their function; == compares
    uses for                        a for loop somewhere (for, while, if,
                                    def, return, or any name: uses len)
    avoids sum                      the name sum appears nowhere
    defines area                    there is a def area
    # a comment                     ignored

Each is worth 1 point, or "(2 points)" at the end of its line says so.

THE TESTS RUN IN A BROWSER, NEVER ON THE SERVER — the server never runs a
student's code (CLAUDE.md). A student's Check my work runs them in their own
browser and is feedback, and a determined student could fake it; it is kept
only so the teacher can see it. What counts toward the grade is the
teacher's Check all, which runs every turned-in project in the TEACHER's
browser and posts the result from there (app.py, "Tests").

The tests are not secret: the notes go to students whole, so they see what
they will be checked against, which is the point of a visible test.

static/autograde.js reads a block exactly as parse() here does, and runs
it; test_autograde.py holds the two to each other.
"""

import re

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
POINTS = re.compile(r"\s*\((\d{1,4}(?:\.\d{1,2})?)\s*points?\)\s*$", re.I)
OUTPUT = re.compile(r"^input\s+(.*?)\s*->\s*prints(\s+exactly)?\s+(.+)$", re.I)
PRINTS = re.compile(r"^prints(\s+exactly)?\s+(.+)$", re.I)
CODE = re.compile(r"^(uses|avoids|defines)\s+(.+?)\s*$", re.I)

#: How a code check on a Python word reads to a student.
WORDS = {"for": "a for loop", "while": "a while loop", "if": "an if statement",
         "def": "a function", "function": "a function", "return": "return",
         "else": "else", "elif": "elif", "try": "try / except",
         "list": "a list", "dict": "a dictionary", "class": "a class"}


def _blocks(md):
    """The text of every ```tests block, in order."""
    out, lines, i = [], (md or "").split("\n"), 0
    while i < len(lines):
        f = FENCE.match(lines[i])
        if f and f.group(2).strip().lower() == "tests":
            fence, body, i = f.group(1), [], i + 1
            while i < len(lines):
                g = FENCE.match(lines[i])
                if g and g.group(1)[0] == fence[0] and len(g.group(1)) >= len(fence) \
                        and not g.group(2).strip():
                    break
                body.append(lines[i])
                i += 1
            out.append("\n".join(body))
        i += 1
    return out


def _label(t):
    k = t["kind"]
    if k == "output":
        said = ("prints exactly " if t["exact"] else "prints ") + t["expect"]
        if t["inputs"]:
            return "With input %s, %s" % (", ".join(t["inputs"]), said)
        return said[0].upper() + said[1:]
    if k == "call":
        return "%s gives %s" % (t["expr"], t["expect"])
    if k == "defines":
        return "Defines %s()" % t["name"]
    word = WORDS.get(t["name"].lower(), t["name"])
    return ("Uses " if k == "uses" else "Doesn't use ") + word


def parse_block(body):
    """(tests, errors) for one block's text. An error is a line the teacher
    wrote that isn't a test — said, not skipped, or a typo silently becomes
    a test nobody can fail."""
    tests, errors = [], []
    for n, raw in enumerate((body or "").split("\n"), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        points = 1.0
        m = POINTS.search(line)
        if m:
            points = float(m.group(1))
            line = line[:m.start()].rstrip()
        t = None
        m = OUTPUT.match(line)
        if m:
            t = {"kind": "output", "exact": bool(m.group(2)), "expect": m.group(3).strip(),
                 "inputs": [s.strip() for s in m.group(1).split(",")] if m.group(1).strip() else []}
        if t is None:
            m = PRINTS.match(line)
            if m:
                t = {"kind": "output", "exact": bool(m.group(1)),
                     "expect": m.group(2).strip(), "inputs": []}
        if t is None:
            m = CODE.match(line)
            if m:
                name = m.group(2).strip()
                if name.endswith("()"):
                    name = name[:-2]
                t = {"kind": m.group(1).lower(), "name": name}
        if t is None and " == " in line:
            expr, expect = line.split(" == ", 1)
            t = {"kind": "call", "expr": expr.strip(), "expect": expect.strip()}
        if t is None:
            errors.append("Line %d of the tests isn't a test: %s" % (n, line))
            continue
        t["points"] = points
        t["label"] = _label(t)
        tests.append(t)
    return tests, errors


def parse(md):
    """Every test in a notes file, and every line that isn't one."""
    tests, errors = [], []
    for body in _blocks(md):
        got, bad = parse_block(body)
        tests += got
        errors += bad
    return tests, errors


def file_tests(files):
    """The tests in an assignment's notes (every .md), and the errors."""
    tests, errors = [], []
    for name in sorted(files or {}):
        if name.lower().endswith(".md") and isinstance(files[name], str):
            got, bad = parse(files[name])
            tests += got
            errors += bad
    return tests, errors


def possible(files):
    return round(sum(t["points"] for t in file_tests(files)[0]), 2)
