"""What goes in the brackets of every kaypy call, for the editor's hints.

    python3 tools/kaypy_signatures.py      # rewrites static/py/kaypy_sigs.json

Read from the VENDORED engine's source with `ast` — nothing is imported, so
pygame is not needed. vendor_kaypy.py calls build() every time kaypy is
copied in, and test_sighint.py fails if the JSON no longer matches the
source, so a renamed parameter can never be hinted under its old name.

Two tables:

  functions   everything in kaypy's __all__ that is callable: add(), pos(),
              onKeyPress(), ...
  methods     what a game object answers to once its components are on it:
              player.jump(), player.onCollide(), player.hurt(), ...

A function whose first docstring line spells out its forms — onUpdate(fn) /
onUpdate(tag, fn) — is hinted with those, because its real signature is
`*args` and says nothing. Otherwise the signature is the def's own.
"""
import ast
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
ROOT = os.path.join(PYIDE, "static", "py", "kaypy")
OUT = os.path.join(PYIDE, "static", "py", "kaypy_sigs.json")

# Methods that are engine plumbing, not something a student calls. `add` is
# the component's own setup hook, which would otherwise shadow nothing useful
# and confuse with add() the function.
NOT_FOR_STUDENTS = {"add", "update", "late_update", "use_all", "get_rect",
                    "render_surface", "current_surface", "state_name", "comp",
                    "is_", "draw"}


def _split_params(text):
    """'a, b=(1, 2), c' -> ['a', 'b=(1, 2)', 'c'], commas inside brackets kept."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def _tidy(name):
    """`pos_` and `text_str` are names chosen to dodge a clash inside kaypy;
    a student reads them as pos and text."""
    name = re.sub(r"_+$", "", name)
    return {"text_str": "text", "comp_list": "components"}.get(name, name)


def _params(fn):
    a = fn.args
    ps = list(a.posonlyargs) + list(a.args)
    if ps and ps[0].arg in ("self", "cls"):
        ps = ps[1:]
    first_default = len(ps) - len(a.defaults)
    out = []
    for i, p in enumerate(ps):
        name = _tidy(p.arg)
        if i >= first_default:
            d = ast.unparse(a.defaults[i - first_default])
            # a private sentinel means "not given", which is how None reads
            out.append(name + "=" + ("None" if d.startswith("_") else d))
        else:
            out.append(name)
    if a.vararg:
        out.append("*" + a.vararg.arg)
    for k, d in zip(a.kwonlyargs, a.kw_defaults):
        out.append(_tidy(k.arg) + ("" if d is None else "=" + ast.unparse(d)))
    if a.kwarg:
        out.append("**" + a.kwarg.arg)
    return out


def _doc(node, name):
    """(forms from the docstring, a one-line description)."""
    # The first paragraph, unwrapped, then its first sentence: docstrings
    # wrap at 72 columns, and the first LINE ends mid-sentence.
    para = " ".join((ast.get_docstring(node) or "").strip().split("\n\n")[0].split())
    first = re.split(r"(?<=[.!?])\s", para, maxsplit=1)[0]
    forms = [_split_params(m) for m in re.findall(r"\b%s\(([^()]*)\)" % re.escape(name), first)]
    if forms and len(forms) >= 1 and not first.startswith(("A ", "An ", "The ")):
        desc = ""
    else:
        forms, desc = [], first
    desc = re.sub(r"`([^`]*)`", r"\1", desc)
    if len(desc) > 90:
        cut = desc[:90].rfind(" ")
        desc = desc[:cut].rstrip(",;:") + "…"
    return forms, desc


def _defs():
    """Every top-level function and class in the package, by name."""
    found = {}
    for dirpath, _, names in os.walk(ROOT):
        for f in sorted(names):
            if f.endswith(".py"):
                tree = ast.parse(open(os.path.join(dirpath, f), encoding="utf-8").read())
                for node in tree.body:
                    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                        found.setdefault(node.name, node)
                    if isinstance(node, ast.ClassDef) and (
                            node.name == "GameObj" or "comps" in dirpath):
                        found.setdefault(("class", node.name), node)
    return found


def build():
    defs = _defs()
    init = ast.parse(open(os.path.join(ROOT, "__init__.py"), encoding="utf-8").read())
    exported = next(n.value for n in init.body if isinstance(n, ast.Assign)
                    and getattr(n.targets[0], "id", "") == "__all__")
    functions = {}
    for name in [e.value for e in exported.elts]:
        node = defs.get(name)
        if node is None:
            continue                       # a constant: RED, easings, debug
        target = node
        if isinstance(node, ast.ClassDef):
            target = next((b for b in node.body if isinstance(b, ast.FunctionDef)
                           and b.name == "__init__"), None)
            if target is None:
                continue
        forms, desc = _doc(node, name)
        functions[name] = {"forms": forms or [_params(target)], "doc": desc}

    methods = {}
    for key, node in defs.items():
        if not (isinstance(key, tuple) and key[0] == "class"):
            continue
        for b in node.body:
            if (isinstance(b, ast.FunctionDef) and not b.name.startswith("_")
                    and b.name not in NOT_FOR_STUDENTS):
                forms, desc = _doc(b, b.name)
                entry = methods.setdefault(b.name, {"forms": [], "doc": desc})
                for f in forms or [_params(b)]:
                    if f not in entry["forms"]:
                        entry["forms"].append(f)
                entry["doc"] = entry["doc"] or desc
    return {"functions": dict(sorted(functions.items())),
            "methods": dict(sorted(methods.items()))}


def write():
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    return data


if __name__ == "__main__":
    d = write()
    print("kaypy_sigs.json: %d functions, %d methods"
          % (len(d["functions"]), len(d["methods"])))
