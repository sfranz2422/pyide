# An animated dino. Press SPACE to jump over the spikes.
#
# The dino walk cycle is nine separate pictures, dino_0 through dino_8.
# Flipping between them quickly is what makes it look like walking.

WIDTH = 600
HEIGHT = 300
GROUND = 240

dino = Actor('dino_0', (100, GROUND))
spike = Actor('spike', (600, GROUND + 10))

frame = 0
frame_timer = 0.0
jump_speed = 0.0
on_ground = True
score = 0


def update(dt):
    global frame, frame_timer, jump_speed, on_ground, score

    # --- animate the walk cycle ---
    frame_timer += dt
    if frame_timer > 0.08:
        frame_timer = 0.0
        frame = (frame + 1) % 9
        dino.image = 'dino_' + str(frame)

    # --- jumping ---
    if keyboard.space and on_ground:
        jump_speed = -11
        on_ground = False

    if not on_ground:
        dino.y += jump_speed
        jump_speed += 0.6
        if dino.y >= GROUND:
            dino.y = GROUND
            on_ground = True

    # --- the spike slides past ---
    spike.x -= 5
    if spike.x < -20:
        spike.x = WIDTH + 20
        score += 1


def draw():
    screen.fill((246, 238, 220))
    screen.draw.filled_rect(Rect((0, GROUND + 20), (WIDTH, HEIGHT)), (90, 74, 58))
    dino.draw()
    spike.draw()
    screen.draw.text("Jumped: " + str(score), (10, 10), fontsize=30, color=(60, 50, 40))
