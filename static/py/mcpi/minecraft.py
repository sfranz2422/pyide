"""The world, the player and the camera — what Minecraft.create() gives you.

    from mcpi.minecraft import Minecraft
    mc = Minecraft.create()
    mc.postToChat("Hello")
    pos = mc.player.getTilePos()
    mc.setBlock(pos.x + 1, pos.y, pos.z, 1)
"""
import math

from .block import Block
from .connection import Connection
from .event import BlockEvent, ChatEvent
from .util import flatten
from .vec3 import Vec3


def intFloor(*args):
    """Every number rounded down to a whole block, as the world wants them."""
    return [int(math.floor(value)) for value in flatten(args)]


class CmdPositioner:
    """Where an entity is, and moving it. The player is the one entity there is."""

    def __init__(self, connection, packagePrefix):
        self.conn = connection
        self.pkg = packagePrefix

    def getPos(self, id):
        s = self.conn.sendReceive(self.pkg + ".getPos", id)
        return Vec3(*[float(v) for v in s.split(",")])

    def setPos(self, id, *args):
        self.conn.send(self.pkg + ".setPos", id, args)

    def getTilePos(self, id):
        s = self.conn.sendReceive(self.pkg + ".getTile", id)
        return Vec3(*[int(v) for v in s.split(",")])

    def setTilePos(self, id, *args):
        self.conn.send(self.pkg + ".setTile", id, intFloor(*args))

    def getDirection(self, id):
        s = self.conn.sendReceive(self.pkg + ".getDirection", id)
        return Vec3(*[float(v) for v in s.split(",")])

    def getRotation(self, id):
        return float(self.conn.sendReceive(self.pkg + ".getRotation", id))

    def getPitch(self, id):
        return float(self.conn.sendReceive(self.pkg + ".getPitch", id))

    def setting(self, setting, status):
        self.conn.send(self.pkg + ".setting", setting, 1 if bool(status) else 0)


class CmdEntity(CmdPositioner):
    """Entities by id: mc.entity.getPos(id), with ids from mc.getPlayerEntityIds()."""

    def __init__(self, connection):
        CmdPositioner.__init__(self, connection, "entity")


class CmdPlayer(CmdPositioner):
    """The player: mc.player.getPos(), mc.player.setPos(x, y, z), …"""

    def __init__(self, connection):
        CmdPositioner.__init__(self, connection, "player")

    def getPos(self):
        return CmdPositioner.getPos(self, [])

    def setPos(self, *args):
        return CmdPositioner.setPos(self, [], args)

    def getTilePos(self):
        return CmdPositioner.getTilePos(self, [])

    def setTilePos(self, *args):
        return CmdPositioner.setTilePos(self, [], args)

    def getDirection(self):
        return CmdPositioner.getDirection(self, [])

    def getRotation(self):
        return CmdPositioner.getRotation(self, [])

    def getPitch(self):
        return CmdPositioner.getPitch(self, [])


class CmdCamera:
    """Where the view is from: the player's eyes, behind them, or a fixed point."""

    def __init__(self, connection):
        self.conn = connection

    def setNormal(self, *args):
        self.conn.send("camera.mode.setNormal", args)

    def setFixed(self):
        self.conn.send("camera.mode.setFixed")

    def setFollow(self, *args):
        self.conn.send("camera.mode.setFollow", args)

    def setPos(self, *args):
        self.conn.send("camera.setPos", args)


class CmdEvents:
    """What happened since you last asked: blocks hit with the sword, chat typed."""

    def __init__(self, connection):
        self.conn = connection

    def clearAll(self):
        self.conn.send("events.clear")

    def pollBlockHits(self):
        s = self.conn.sendReceive("events.block.hits")
        return [BlockEvent.Hit(*[int(v) for v in e.split(",")]) for e in s.split("|") if e]

    def pollChatPosts(self):
        s = self.conn.sendReceive("events.chat.posts")
        posts = []
        for e in s.split("|"):
            if e:
                comma = e.find(",")
                posts.append(ChatEvent.Post(int(e[:comma]), e[comma + 1:]))
        return posts


class Minecraft:
    """The world: blocks, chat, checkpoints, and mc.player, mc.camera, mc.events."""

    def __init__(self, connection):
        self.conn = connection
        self.camera = CmdCamera(connection)
        self.entity = CmdEntity(connection)
        self.player = CmdPlayer(connection)
        self.events = CmdEvents(connection)

    def getBlock(self, *args):
        return int(self.conn.sendReceive("world.getBlock", intFloor(args)))

    def getBlockWithData(self, *args):
        s = self.conn.sendReceive("world.getBlockWithData", intFloor(args))
        return Block(*[int(v) for v in s.split(",")])

    def setBlock(self, *args):
        self.conn.send("world.setBlock", intFloor(args))

    def setBlocks(self, *args):
        self.conn.send("world.setBlocks", intFloor(args))

    def getHeight(self, *args):
        return int(self.conn.sendReceive("world.getHeight", intFloor(args)))

    def getPlayerEntityIds(self):
        s = self.conn.sendReceive("world.getPlayerIds")
        return [int(v) for v in s.split("|") if v]

    def saveCheckpoint(self):
        self.conn.send("world.checkpoint.save")

    def restoreCheckpoint(self):
        self.conn.send("world.checkpoint.restore")

    def postToChat(self, msg):
        # One line of chat: a newline would end the command on a Pi too.
        self.conn.send("chat.post", str(msg).replace("\n", " "))

    def setting(self, setting, status):
        self.conn.send("world.setting", setting, 1 if bool(status) else 0)

    @staticmethod
    def create(address="localhost", port=4711):
        return Minecraft(Connection(address, port))
