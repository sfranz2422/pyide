"""Turning arguments into the comma-separated text the protocol carries."""


def flatten(items):
    """Every value in nested lists, tuples, Vec3s and Blocks, in order —
    so setBlock(pos, block.WOOL.withData(14)) sends x,y,z,35,14."""
    for item in items:
        if isinstance(item, (str, bytes)):
            yield item
            continue
        try:
            inner = iter(item)
        except TypeError:
            yield item
            continue
        for value in flatten(inner):
            yield value


def flatten_parameters_to_string(items):
    return ",".join(str(value) for value in flatten(items))
