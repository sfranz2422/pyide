"""The connection to the world.

On a Raspberry Pi this is a socket to Minecraft Pi Edition on port 4711. In
PyIDE the world is in the same page, so there is no socket: each command is
handed to it directly (_pyide.command) and answered at once. The address and
port are accepted, so Minecraft.create("localhost", 4711) still works.
"""
from . import _pyide
from .util import flatten_parameters_to_string


class RequestError(Exception):
    """The world couldn't do what was asked (on a Pi, Minecraft answered Fail)."""


class Connection:
    def __init__(self, address="localhost", port=4711):
        self.address = address
        self.port = port
        self.lastSent = ""
        self._reply = ""

    def send(self, f, *data):
        line = "%s(%s)" % (f, flatten_parameters_to_string(data))
        self.lastSent = line
        self._reply = _pyide.command(line)
        if self._reply == "Fail":
            raise RequestError("%s failed" % line.strip())

    def receive(self):
        return self._reply

    def sendReceive(self, *data):
        self.send(*data)
        return self.receive()

    def drain(self):
        pass

    def close(self):
        pass
