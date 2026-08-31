# Catch the falling fruit with the bean. Miss three and the game ends.

import random

WIDTH = 600
HEIGHT = 400

FRUITS = ['apple', 'grape', 'lemon', 'pineapple', 'watermelon', 'pizza']

bean = Actor('bean', (300, 360))
fruit = Actor(random.choice(FRUITS), (300, 0))
score = 0
missed = 0
speed = 3


def drop_new_fruit():
    fruit.image = random.choice(FRUITS)
    fruit.x = random.randint(30, WIDTH - 30)
    fruit.y = 0


def update(dt):
    global score, missed, speed

    if missed >= 3:
        return

    if keyboard.left:
        bean.x -= 6
    if keyboard.right:
        bean.x += 6
    bean.x = max(30, min(WIDTH - 30, bean.x))

    fruit.y += speed

    if fruit.colliderect(bean):
        score += 1
        speed += 0.2
        drop_new_fruit()
    elif fruit.y > HEIGHT:
        missed += 1
        drop_new_fruit()


def draw():
    screen.fill((28, 32, 44))
    bean.draw()
    fruit.draw()
    screen.draw.text("Score: " + str(score), (10, 10), fontsize=30, color="white")
    screen.draw.text("Missed: " + str(missed), (10, 42), fontsize=26, color=(255, 140, 140))

    if missed >= 3:
        screen.draw.text("Game over", center=(WIDTH / 2, HEIGHT / 2),
                         fontsize=72, color="white")
