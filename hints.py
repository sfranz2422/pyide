"""
Hints for a test, written under it in a ```tests block (Nov 2026, the
teacher's request: "the students are pretty much ignoring the hints").

    prints Hello
    hint: Use print() with the words inside quotes.
    hint: It's one line: print, brackets, then "Hello" in quotes.
    code: print("Hello")

A `hint:` or `code:` line belongs to the test line above it. The first
hint is free, the second costs part of that test's points, and the code
(one `code:` line per line of it, indentation kept after "code: ") costs
more (app.py, "Hints", HINT_COSTS). Failing a check never costs anything,
on purpose: charging for a failed check would teach students to stop
checking.

The lines are taken out of the notes at every exit to a student (quiz.redact
calls strip), or the code a student pays for would be free in the page's
source. The server hands each one out on request and records the ones that
cost. Every grammar's parser (autograde*.py and their .js) skips them, so a
teacher's page, which keeps them, reads the same tests a student's does.

The same in every grammar: collect() takes the grammar's parse_block to turn
a test line into its label, which is what results and hints are matched by.
"""

import re

HINT_LINE = re.compile(r"^\s*(hint|code)\s*:(.*)$", re.I)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def is_hint_line(line):
    return bool(HINT_LINE.match(line or ""))


def _walk(md):
    """(line, in_tests) for every line of the notes: whether it sits inside
    a ```tests fence (any part or level: the words after `tests` don't
    matter here)."""
    fence = None
    for line in (md or "").split("\n"):
        f = _FENCE.match(line)
        if fence is None:
            if f and (f.group(2).strip().lower().split() or [""])[0] == "tests":
                fence = f.group(1)
            yield line, False
            continue
        if f and f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence) and not f.group(2).strip():
            fence = None
            yield line, False
            continue
        yield line, True


def strip(md):
    """The notes without their hint and code lines — what a student gets."""
    if not md or ("hint" not in md.lower() and "code" not in md.lower()):
        return md
    return "\n".join(line for line, inside in _walk(md) if not (inside and is_hint_line(line)))


_EDITOR_POP = re.compile(r"^\s*:::\s*pop\s+editor\b", re.I)
_SLIDE_BREAK = re.compile(r"^\s*---\s*$")


def collect(md, parse_block):
    """{label: {"hints": [text, ...], "code": "lines", "free": bool}} for the
    tests in one notes file that have any. `parse_block` is the grammar's: a
    test line is whatever it reads as exactly one test.

    `free`: every block the test is in comes after a `:::pop editor` box
    (on the same slide), or is a ```tests try block — a Try It step, where
    the box says what to type. The
    teacher (Nov 2026): "we are basically telling the kids what to type ...
    it seems silly to penalize them". The warm-up and the exercises have no
    editor box (their directions are on the slide) and keep the costs:
    "those require independent thought"."""
    out, label, free = {}, None, {}
    after_pop = block_free = try_next = False
    was_inside = False
    # Each level's own hints and code, for a test written at more than one
    # level (```tests exercise easy …): `uses prompt` at Easy, Medium and
    # Master shared one entry, and Show me the code joined all three levels'
    # code (Nov 2026, the JavaScript unit). "by_level" holds them apart;
    # app.py's _hints_of picks the student's own.
    by_level = {}
    level = level_next = ""
    for line, inside in _walk(md):
        if not inside:
            if was_inside:
                after_pop = False                 # a box answers one card
            was_inside = False
            label = None
            if _EDITOR_POP.match(line):
                after_pop = True
            # A new slide ends a step: an editor box with no card after it
            # (a Try It's closing "✓ + glues…") once made the WARM-UP's
            # hints, slides later, free.
            if _SLIDE_BREAK.match(line):
                after_pop = False
            # ```tests try: a Try It step typed on the slide, free like the
            # editor box's (autograde.TRY).
            f = _FENCE.match(line)
            words = f.group(2).strip().lower().split() if f else []
            try_next = words == ["tests", "try"]
            level_next = words[2] if len(words) == 3 and words[0] == "tests" else ""
            continue
        if not was_inside:
            block_free = after_pop or try_next
            level = level_next
        was_inside = True
        m = HINT_LINE.match(line)
        if m:
            if label is None:
                continue                          # under no test: nothing to attach to
            entry = out.setdefault(label, {"hints": [], "code": ""})
            own = by_level.setdefault(label, {}).setdefault(level, {"hints": [], "code": ""})
            for e in (entry, own):
                if m.group(1).lower() == "hint":
                    text = m.group(2).strip()
                    if text:
                        e["hints"].append(text)
                else:
                    code = m.group(2)
                    code = code[1:] if code.startswith(" ") else code
                    e["code"] = (e["code"] + "\n" + code) if e["code"] else code
            continue
        stripped = line.strip()
        if not stripped:
            continue
        # A # line is a comment only where the grammar doesn't read it as a
        # test: `#headline contains …` is a web test, and its hints went to
        # the test above it.
        tests, _ = parse_block(stripped)
        if len(tests) != 1 and stripped.startswith("#"):
            continue
        label = tests[0]["label"] if len(tests) == 1 else None
        if label is not None:
            free[label] = free.get(label, True) and block_free
    for k, v in out.items():
        v["free"] = free.get(k, False)
        levels = by_level.get(k, {})
        if len([lv for lv in levels if lv]) > 1:
            v["by_level"] = levels
    return {k: v for k, v in out.items() if v["hints"] or v["code"]}
