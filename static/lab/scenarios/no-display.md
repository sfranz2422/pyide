# It runs, but there's no picture

> The fans spin, and the monitor says No Signal. The graphics card was taken out and put back.

---

## Where the picture comes from

- A **graphics card** that uses more than the slot's **75 W** needs a **PCIe power cable** (6- or 8-pin) from the power supply. Without it: **1 long, 3 short** beeps and the **VGA** light.
- With a graphics card in, the picture comes **from the card**. The monitor has to be plugged into **the card**, not the motherboard.
- Intel **F** models (12700**K**F) have **no graphics**: the motherboard's video ports show nothing.

```quiz
Which card needs an 8-pin PCIe power cable?
- [x] A 180 W card
- [ ] A 75 W card
- [ ] Every card
```

```quiz
This CPU is an F model. Where does the monitor go?
- [x] Into the graphics card
- [ ] Into the motherboard
- [ ] Either one
```

---

## Fix it

```lab
power
monitor
boots
```
