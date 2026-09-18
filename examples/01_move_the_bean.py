# Move the bean with the arrow keys.
# Click the picture first so the keys reach the game.

from kaplay import *

kaplay(width=600, height=400, background=[120, 190, 230])

loadSprite("bean", "images/bean.png")

bean = add([
    sprite("bean"),
    pos(300, 200),
    anchor("center"),
])

SPEED = 240   # pixels per second

# move() is per-second, so the bean travels the same distance on a slow
# computer as on a fast one. Kaplay multiplies by the frame time for you.
onKeyDown("left",  lambda: bean.move(-SPEED, 0))
onKeyDown("right", lambda: bean.move(SPEED, 0))
onKeyDown("up",    lambda: bean.move(0, -SPEED))
onKeyDown("down",  lambda: bean.move(0, SPEED))


def keep_on_screen():
    bean.pos.x = max(0, min(width(), bean.pos.x))
    bean.pos.y = max(0, min(height(), bean.pos.y))


onUpdate(keep_on_screen)

add([
    text("Use the arrow keys", size=28),
    pos(10, 10),
    color(255, 255, 255),
])
