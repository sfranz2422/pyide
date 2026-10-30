# Add memory, the right way

> One 16 GB stick, and the customer bought a second matching one. Use **dual channel**.

---

## Dual channel

A board has two memory **channels**, A and B. One stick in each channel doubles how fast memory can be read.

On a four-slot board the slots are **A1, A2, B1, B2**, and the manual says which to fill first. For two sticks it's usually **A2 and B2**: the 2nd and 4th slots from the CPU. Always check the manual.

```quiz
Two sticks on a four-slot board. Which slots does this board's manual ask for?
- [x] A2 and B2
- [ ] A1 and A2
- [ ] Any two, it doesn't matter
```

```quiz
Why put one stick in each channel?
- [x] Both channels work at once: memory is faster
- [ ] The PC won't start with both in one channel
- [ ] It uses less power
```

---

## Do it

The first stick is in the wrong slot for two. Move it, add the second, and start it.

```lab
32gb
dual
```
