# An animated dino. Press SPACE to jump over the spikes.
#
# The dino walk cycle is nine separate pictures, dino_0 through dino_8.
# Flipping between them quickly is what makes it look like walking.

from kaypy import *

kaypy(width=600, height=300, background=[246, 238, 220])

for i in range(9):
    loadSprite("dino_" + str(i), "images/dino_" + str(i) + ".png")
loadSprite("spike", "images/spike.png")

GROUND = 240

# A floor to land on, and a gravity to fall under: with a body() component
# Kaplay does the jumping physics, so there is no jump_speed to keep track of.
setGravity(1800)

add([rect(width(), 60), pos(0, GROUND + 20), area(), body(isStatic=True),
     color(90, 74, 58)])

dino = add([sprite("dino_0"), pos(100, GROUND), anchor("bot"), area(), body()])
spike = add([sprite("spike"), pos(600, GROUND + 10), anchor("bot"), area()])

frame = 0
frame_timer = 0.0
score = 0
label = add([text("Jumped: 0", size=30), pos(10, 10), color(60, 50, 40)])


def each_frame():
    global frame, frame_timer, score

    frame_timer += dt()
    if frame_timer > 0.08:
        frame_timer = 0.0
        frame = (frame + 1) % 9
        dino.use(sprite("dino_" + str(frame)))

    spike.move(-300, 0)
    if spike.pos.x < -20:
        spike.pos.x = width() + 20
        score += 1
        label.text = "Jumped: " + str(score)


onUpdate(each_frame)
onKeyPress("space", lambda: dino.jump(700) if dino.isGrounded() else None)
