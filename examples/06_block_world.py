# The block world: a Raspberry Pi Minecraft lesson that runs in PyIDE.
#
# Press Run, then click the world to walk about in it. A house appears
# beside you. Hit blocks with the sword (slot 1) and they turn to gold.
# Press Stop when you're done.

from mcpi.minecraft import Minecraft
from mcpi import block
import time

mc = Minecraft.create()
mc.postToChat("Building you a house...")

# Where you're standing, in whole blocks.
x, y, z = mc.player.getTilePos()

# A brick box, then air inside it to make it hollow, then a door.
mc.setBlocks(x + 3, y, z + 3, x + 9, y + 4, z + 9, block.BRICK_BLOCK.id)
mc.setBlocks(x + 4, y, z + 4, x + 8, y + 3, z + 8, block.AIR.id)
mc.setBlocks(x + 6, y, z + 3, x + 6, y + 1, z + 3, block.AIR.id)
# A red wool roof: wool's data is its colour, and 14 is red.
mc.setBlocks(x + 3, y + 5, z + 3, x + 9, y + 5, z + 9, block.WOOL.id, 14)

mc.postToChat("Done! Hit blocks with your sword to turn them to gold.")

try:
    while True:
        for hit in mc.events.pollBlockHits():
            mc.setBlock(hit.pos.x, hit.pos.y, hit.pos.z, block.GOLD_BLOCK.id)
        # A loop that runs for ever gives the world its turn, as on a Pi.
        time.sleep(0.1)
except KeyboardInterrupt:
    # Stop arrives as a KeyboardInterrupt, as Ctrl+C does on a Pi.
    mc.postToChat("Bye!")
