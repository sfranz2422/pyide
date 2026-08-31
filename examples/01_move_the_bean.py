# Move the bean with the arrow keys.
# Click the picture first so the keys reach the game.

WIDTH = 600
HEIGHT = 400

bean = Actor('bean', (300, 200))
SPEED = 4


def update(dt):
    if keyboard.left:
        bean.x -= SPEED
    if keyboard.right:
        bean.x += SPEED
    if keyboard.up:
        bean.y -= SPEED
    if keyboard.down:
        bean.y += SPEED

    # keep the bean on the screen
    bean.x = max(0, min(WIDTH, bean.x))
    bean.y = max(0, min(HEIGHT, bean.y))


def draw():
    screen.fill((120, 190, 230))
    bean.draw()
    screen.draw.text("Use the arrow keys", (10, 10), fontsize=28, color="white")
