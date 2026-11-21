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


def collect(md, parse_block):
    """{label: {"hints": [text, ...], "code": "lines"}} for the tests in one
    notes file that have any. `parse_block` is the grammar's: a test line is
    whatever it reads as exactly one test."""
    out, label = {}, None
    for line, inside in _walk(md):
        if not inside:
            label = None
            continue
        m = HINT_LINE.match(line)
        if m:
            if label is None:
                continue                          # under no test: nothing to attach to
            entry = out.setdefault(label, {"hints": [], "code": ""})
            if m.group(1).lower() == "hint":
                text = m.group(2).strip()
                if text:
                    entry["hints"].append(text)
            else:
                code = m.group(2)
                code = code[1:] if code.startswith(" ") else code
                entry["code"] = (entry["code"] + "\n" + code) if entry["code"] else code
            continue
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        tests, _ = parse_block(stripped)
        label = tests[0]["label"] if len(tests) == 1 else None
    return {k: v for k, v in out.items() if v["hints"] or v["code"]}
