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

import hints

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


#: What a block's fence may say after `tests` (v11 lessons, Nov 2026, the
#: teacher's request). ```tests exercise is the coding exercise's: its points
#: count as the level the student chose for it (easy, medium, master — app.py,
#: "Levels"). ```tests bonus is a challenge's: points earned on top of the
#: grade, never part of what it's out of, so nobody loses anything by
#: leaving it. A plain ```tests block is what it always was.
PARTS = ("exercise", "bonus")
#: A level after the part (```tests exercise easy): v11 lessons give each
#: level its own variables and values (the teacher: "or they will just copy
#: from a neighbor"), so each level has its own tests; only the student's
#: level's are run and counted.
LEVELS = ("easy", "medium", "master")


def _part_of(info):
    """(part, level) a fence's words name — part "", "exercise" or "bonus",
    level "" or one of LEVELS — or None for a fence that isn't a tests block."""
    words = info.strip().lower().split()
    if not words or words[0] != "tests":
        return None
    if len(words) == 1:
        return "", ""
    if len(words) == 2 and words[1] in PARTS:
        return words[1], ""
    if len(words) == 3 and words[1] in PARTS and words[2] in LEVELS:
        return words[1], words[2]
    return None


def _blocks_with_parts(md):
    """(part, level, text) for every ```tests block, in order."""
    out, lines, i = [], (md or "").split("\n"), 0
    while i < len(lines):
        f = FENCE.match(lines[i])
        part = _part_of(f.group(2)) if f else None
        if part is not None:
            fence, body, i = f.group(1), [], i + 1
            while i < len(lines):
                g = FENCE.match(lines[i])
                if g and g.group(1)[0] == fence[0] and len(g.group(1)) >= len(fence) \
                        and not g.group(2).strip():
                    break
                body.append(lines[i])
                i += 1
            out.append((part[0], part[1], "\n".join(body)))
        i += 1
    return out


def _blocks(md):
    """The text of every ```tests block, in order."""
    return [body for _, _, body in _blocks_with_parts(md)]


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
        if not line or line.startswith("#") or hints.is_hint_line(line):
            continue                      # hint: / code: belong to the test above (hints.py)
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
    for part, level, body in _blocks_with_parts(md):
        got, bad = parse_block(body)
        for t in got:
            t["part"] = part
            t["level"] = level
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
    """What the tests are worth toward a grade: a bonus test is not part of
    it (it can only add), and of an exercise written once per level, one
    level's worth (they're meant to be worth the same; the most, if not)."""
    tests = file_tests(files)[0]
    plain = sum(t["points"] for t in tests if t.get("part") != "bonus" and not t.get("level"))
    by_level = {}
    for t in tests:
        if t.get("part") == "exercise" and t.get("level"):
            by_level[t["level"]] = by_level.get(t["level"], 0) + t["points"]
    return round(plain + max(by_level.values() or [0]), 2)
