"""The A+ lab's tasks, marked on the server: the grade.

static/lab/lab_checks.js is the same thing in the browser, for the instant
check mark; this one decides what's recorded. tools/test_lab_checks.py holds
them together on every scenario's start and solution, and on a few hundred
machines made at random, fact by fact.

The server never runs anything a student wrote. A lab's save is DATA: the
simulated PC as plain JSON (static/lab/machine.js). This reads it.

What a student sends is not trusted for what the parts ARE: sanitize() puts
back the scenario's own items (which stick is dead, which drive has
Windows), and valid() re-checks every placement against the compatibility
rules, so a hand-edited save that puts DDR5 in a DDR4 board boots nothing.
Forging a passing machine means building a correct one, which is the skill.

The few rules of machine.js this needs (the order a PC checks things at the
power button, what reaches the internet, which disks are connected) are
ported below, and the test runs both on the same machines. A change to one
without the other fails there, not silently in a grade.
"""
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, "static", "lab")
BASE_WATTS = 150                     # machine.js BASE_WATTS
PUBLIC_DNS = {"8.8.8.8", "1.1.1.1", "9.9.9.9"}

_catalog = None


def catalog():
    global _catalog
    if _catalog is None:
        with open(os.path.join(LAB, "parts.json"), encoding="utf-8") as f:
            _catalog = {p["id"]: p for p in json.load(f)["parts"]}
    return _catalog


def scenario_ids():
    folder = os.path.join(LAB, "scenarios")
    return sorted(n[:-5] for n in os.listdir(folder) if n.endswith(".json"))


def scenario(sid):
    """A built-in scenario by its id, or None. The id is checked against the
    folder's own list, so it can't name a path."""
    if sid not in scenario_ids():
        return None
    with open(os.path.join(LAB, "scenarios", sid + ".json"), encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------ what a save is

def _placed(s):
    out = [s.get(k) for k in ("case", "board", "cpu", "cooler", "psu", "gpu") if s.get(k)]
    for k in ("ram", "m2", "sata"):
        out += [u for u in (s.get(k) or []) if u]
    return out


def sanitize(sc, posted):
    s = copy.deepcopy(posted) if isinstance(posted, dict) else {}
    items = {}
    for it in sc["items"]:
        items[it["uid"]] = {"part": it["part"]}
        if it.get("faulty"):
            items[it["uid"]]["faulty"] = it["faulty"]
        if it.get("windows"):
            items[it["uid"]]["windows"] = True
    s["items"] = items
    placed = _placed(s)
    s["shelf"] = [u for u in items if u not in placed]
    return s


def _part(s, uid):
    if not isinstance(uid, str):
        return None
    it = (s.get("items") or {}).get(uid)
    return catalog().get(it["part"]) if it else None


def valid(s):
    """Line for line with lab_checks.js's valid()."""
    placed = _placed(s)
    if any(not isinstance(u, str) for u in placed):
        return False
    if len(set(placed)) != len(placed) or any(_part(s, u) is None for u in placed):
        return False
    box, board, cpu = _part(s, s.get("case")), _part(s, s.get("board")), _part(s, s.get("cpu"))
    cooler, psu, gpu = _part(s, s.get("cooler")), _part(s, s.get("psu")), _part(s, s.get("gpu"))
    if s.get("case") and box["type"] != "case":
        return False
    if s.get("board") and (board["type"] != "board" or not box or board["form"] not in box["fits"]):
        return False
    if s.get("cpu") and (cpu["type"] != "cpu" or not board or cpu["socket"] != board["socket"]):
        return False
    if s.get("cooler") and (cooler["type"] != "cooler" or not cpu or cooler["watts"] < cpu["watts"]):
        return False
    if s.get("psu") and (psu["type"] != "psu" or not box):
        return False
    if s.get("gpu") and (gpu["type"] != "gpu" or not board):
        return False
    slots = {"ram": (2 if board["dimms"] == 2 else 4) if board else 0,
             "m2": board["m2"] if board else 0, "sata": board["sata"] if board else 0}
    for k in ("ram", "m2", "sata"):
        for n, u in enumerate(s.get(k) or []):
            if not u:
                continue
            p = _part(s, u)
            if n >= slots[k]:
                return False
            if k == "ram":
                if p["type"] != "ram" or p["ram"] != board["ram"]:
                    return False
            elif p["type"] != "drive" or p.get("iface") != ("M.2" if k == "m2" else "SATA"):
                return False
    c = s.get("cables") or {}
    if (c.get("atx24") or c.get("cpu8")) and not (psu and board):
        return False
    if c.get("gpu8") and not (psu and psu.get("pcie") and gpu and gpu.get("power")):
        return False
    sata = s.get("sata") or []
    for n, on in enumerate(c.get("sata") or []):
        if on and not (psu and n < len(sata) and sata[n]):
            return False
    if s.get("monitor") not in (None, "gpu", "board"):
        return False
    return True


# ------------------------------------------------------------ machine.js, ported

def _watts(s):
    w = BASE_WATTS
    for k in ("cpu", "gpu"):
        p = _part(s, s.get(k))
        if p:
            w += p["watts"]
    return w + 5 * (len([u for u in s.get("m2") or [] if u]) + len([u for u in s.get("sata") or [] if u]))


def _connected(s):
    """machine.js drivesConnected: M.2 drives, then SATA ones with power."""
    cables = (s.get("cables") or {}).get("sata") or []
    out = [u for u in s.get("m2") or [] if u]
    out += [u for n, u in enumerate(s.get("sata") or []) if u and n < len(cables) and cables[n]]
    return out


def boots(s):
    """machine.js powerOn, read only: does it get to Windows, with a picture?"""
    items = s.get("items") or {}
    psu, cpu, gpu = _part(s, s.get("psu")), _part(s, s.get("cpu")), _part(s, s.get("gpu"))
    c = s.get("cables") or {}
    if not psu or not c.get("atx24") or not s.get("board"):
        return False
    if _watts(s) > psu["watts"]:
        return False
    if not cpu or not c.get("cpu8") or not s.get("cooler"):
        return False
    sticks = [u for u in s.get("ram") or [] if u]
    if not sticks or any(items[u].get("faulty") for u in sticks):
        return False
    if gpu and gpu.get("power") and not c.get("gpu8"):
        return False
    if not gpu and not cpu.get("graphics"):
        return False
    if s.get("monitor") != ("gpu" if gpu else "board"):
        return False
    return any(items[u].get("windows") and items[u].get("faulty") != "dead" for u in _connected(s))


def _on_lan(os_):
    n, lan = os_.get("net") or {}, os_.get("lan") or {}
    ip = n.get("ip") or ""
    return bool(ip and n.get("enabled") and not (os_.get("disabled") or {}).get("net")
                and (os_.get("drivers") or {}).get("net") == "ok"
                and ip.startswith(str(lan.get("subnet")) + ".") and n.get("mask") == "255.255.255.0"
                and ip != lan.get("gateway"))


def online(s):
    o = s.get("os")
    return bool(isinstance(o, dict) and _on_lan(o) and (o.get("net") or {}).get("gateway") == (o.get("lan") or {}).get("gateway")
                and (o.get("lan") or {}).get("internet"))


def dns_works(s):
    o = s.get("os")
    if not isinstance(o, dict) or not _on_lan(o):
        return False
    lan = o.get("lan") or {}
    return any(d == lan.get("dns") or (online(s) and d in PUBLIC_DNS) for d in (o.get("net") or {}).get("dns") or [])


def _memory(s):
    return sum(_part(s, u)["gb"] for u in s.get("ram") or [] if u and _part(s, u))


def _dual(s):
    board = _part(s, s.get("board"))
    if not board:
        return False
    ram = list(s.get("ram") or []) + [None] * 4
    at = [n for n in range(4) if ram[n]]
    key = ",".join(str(n) for n in at)
    return key in ("1,3", "0,1,2,3") if board["dimms"] != 2 else key == "0,1"


def facts(s):
    ok = valid(s)
    f = {"valid": ok, "boots": False, "coolerOk": False, "memoryGb": 0, "dualChannel": False,
         "online": False, "dnsWorks": False, "volumes": {}}
    if not ok:
        return f
    f["boots"] = boots(s)
    cpu, cooler = _part(s, s.get("cpu")), _part(s, s.get("cooler"))
    f["coolerOk"] = bool(cpu and cooler and s.get("coolerSeated") is True and cooler["watts"] >= cpu["watts"])
    f["memoryGb"] = _memory(s)
    f["dualChannel"] = _dual(s)
    o = s.get("os")
    if isinstance(o, dict):
        f["online"] = online(s)
        f["dnsWorks"] = dns_works(s)
        disks = o.get("disks") or {}
        for uid in _connected(s):
            d = disks.get(uid)
            if not isinstance(d, dict):
                continue
            for v in d.get("parts") or []:
                if isinstance(v, dict) and v.get("letter"):
                    f["volumes"][v["letter"]] = {"disk": uid, "fs": v.get("fs"), "label": v.get("label") or "",
                                                 "gb": v.get("gb"), "style": d.get("style")}
    return f


# ------------------------------------------------------------ a check

_MISSING = object()


def read(view, path):
    v = view
    for k in str(path).split("."):
        if isinstance(v, dict):
            v = v.get(k, _MISSING)
        elif isinstance(v, list) and k.isdigit() and int(k) < len(v):
            v = v[int(k)]
        else:
            v = _MISSING
        if v is _MISSING or v is None:
            return None
    return v


def _same(a, b):
    # JavaScript's ===: true is not 1, and 1 is 1.0.
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return False                 # objects are never === in JS
    return type(a) is type(b) and a == b


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def test(c, view):
    if "all" in c:
        return all(test(x, view) for x in c["all"])
    if "any" in c:
        return any(test(x, view) for x in c["any"])
    if "not" in c:
        return not test(c["not"], view)
    v, want, op = read(view, c.get("path")), c.get("value"), c.get("op", "==")
    if op == "==":
        return (v is None and want is None) or (v is not None and _same(v, want))
    if op == "!=":
        return not ((v is None and want is None) or (v is not None and _same(v, want)))
    if op == ">=":
        return _num(v) and v >= want
    if op == "<=":
        return _num(v) and v <= want
    if op == "startsWith":
        return isinstance(v, str) and v.startswith(want)
    if op == "notStartsWith":
        return isinstance(v, str) and not v.startswith(want)
    if op in ("has", "lacks"):
        if not isinstance(v, list):
            return False
        where = c.get("where") or {}
        hit = any(isinstance(x, dict) and all(k in x and _same(x[k], w) for k, w in where.items()) for x in v)
        return hit if op == "has" else not hit
    return False


def view(s):
    out = dict(s)
    out.update(facts(s))
    return out


def grade(sc, posted):
    """[{id, points, ok}] for each of the scenario's tasks."""
    s = sanitize(sc, posted)
    v = view(s)
    return [{"id": t["id"], "points": t["points"], "ok": bool(test(t["check"], v))} for t in sc["tasks"]]
