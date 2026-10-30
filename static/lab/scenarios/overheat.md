# It shuts itself off

> It works for a couple of minutes, then turns off with no warning. Someone cleaned it last week.

---

## Heat, and how Windows remembers

A CPU cooler needs **thermal paste** and to be **screwed down evenly**. A loose cooler can't move the heat away: the CPU gets hotter and hotter until the board **shuts it off** to protect it.

- The **BIOS** shows the CPU temperature: watch it climb.
- Windows logs a sudden power loss in **Event Viewer** (System): **Kernel-Power, event 41**, and **6008**: "the previous system shutdown was unexpected".

```quiz
Which Event Viewer entry means the PC lost power without shutting down?
- [x] Kernel-Power 41
- [ ] EventLog 6005
- [ ] Disk 7
```

```quiz
The CPU is at 95 °C and climbing. What's the likeliest cause after a cleaning?
- [x] The cooler isn't seated: no paste, or loose screws
- [ ] The power supply is too small
- [ ] The memory is faulty
```

---

## Fix it

Find the event, watch the temperature, then reseat the cooler (new paste, all four screws) and start it.

```lab
cool
```
