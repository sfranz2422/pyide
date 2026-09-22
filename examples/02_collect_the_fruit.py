# Catch the falling fruit with the bean. Miss three and the game ends.

from kaypy import *

kaypy(width=600, height=400, background=[28, 32, 44])

FRUITS = ["apple", "grape", "lemon", "pineapple", "watermelon", "pizza"]

loadSprite("bean", "images/bean.png")
for name in FRUITS:
    loadSprite(name, "images/" + name + ".png")

bean = add([sprite("bean"), pos(300, 360), anchor("center"), area()])

score = 0
missed = 0
speed = 180

score_label = add([text("Score: 0", size=30), pos(10, 10)])
missed_label = add([text("Missed: 0", size=26), pos(10, 46),
                    color(255, 140, 140)])

fruit = add([sprite(choose(FRUITS)), pos(300, 0), anchor("center"), area()])


def drop_new_fruit():
    fruit.use(sprite(choose(FRUITS)))
    fruit.pos.x = rand(30, width() - 30)
    fruit.pos.y = 0


def each_frame():
    global score, missed, speed

    if missed >= 3:
        return

    if isKeyDown("left"):
        bean.move(-360, 0)
    if isKeyDown("right"):
        bean.move(360, 0)
    bean.pos.x = max(30, min(width() - 30, bean.pos.x))

    fruit.move(0, speed)

    if fruit.isColliding(bean):
        score += 1
        speed += 12
        score_label.text = "Score: " + str(score)
        drop_new_fruit()
    elif fruit.pos.y > height():
        missed += 1
        missed_label.text = "Missed: " + str(missed)
        drop_new_fruit()
        if missed >= 3:
            add([text("Game over", size=72), pos(width() / 2, height() / 2),
                 anchor("center")])


onUpdate(each_frame)
