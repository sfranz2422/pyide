"""What happened in the world since a program last asked: blocks hit, chat typed."""
from .vec3 import Vec3


class BlockEvent:
    """A block hit with the sword (the first slot of the world's hotbar)."""
    HIT = 0

    def __init__(self, type, x, y, z, face, entityId):
        self.type = type
        self.pos = Vec3(x, y, z)
        self.face = face
        self.entityId = entityId

    @staticmethod
    def Hit(x, y, z, face, entityId):
        return BlockEvent(BlockEvent.HIT, x, y, z, face, entityId)

    def __repr__(self):
        return "BlockEvent(%s, %d, %d, %d, %d, %d)" % (
            "BlockEvent.HIT" if self.type == BlockEvent.HIT else "???",
            self.pos.x, self.pos.y, self.pos.z, self.face, self.entityId)


class ChatEvent:
    """A line typed into the world's chat (press T in the world)."""
    POST = 0

    def __init__(self, type, entityId, message):
        self.type = type
        self.entityId = entityId
        self.message = message

    @staticmethod
    def Post(entityId, message):
        return ChatEvent(ChatEvent.POST, entityId, message)

    def __repr__(self):
        return "ChatEvent(%s, %d, %s)" % (
            "ChatEvent.POST" if self.type == ChatEvent.POST else "???", self.entityId, self.message)
