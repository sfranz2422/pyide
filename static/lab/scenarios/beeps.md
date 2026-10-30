# Three beeps and a black screen

> Since the memory upgrade, it beeps three times and shows nothing.

---

## POST and beep codes

When a PC starts it runs **POST** (power-on self-test). If something fails before there's a picture, the board tells you with **beeps** and **debug lights**:

| Beeps | Light | Means |
|---|---|---|
| 1 short | | All good |
| 3 short | DRAM | Memory |
| 1 long, 3 short | VGA | Video |
| | CPU | No CPU, or no CPU power |

Codes differ by maker: the board's manual (the spec card) has them.

```quiz
Three short beeps and the DRAM light. What do you check first?
- [x] The memory
- [ ] The graphics card
- [ ] The hard drive
```

---

## Find the bad stick

Test **one stick at a time**: a good stick starts, the bad one beeps. Then swap the bad one for the spare, in the same slot.

```lab
boots
16gb
```
