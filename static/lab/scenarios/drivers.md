# No network, and no sound

> After Windows was reinstalled: no internet and no sound. The maker's drivers are in a folder on the desktop.

---

## Device Manager

- **⚠ yellow triangle**, under *Other devices*, with a vague name: **no driver** (Code 28).
- **↓ down arrow**: the device is **disabled** (Code 22).

**Update driver** offers two ways: *search automatically* (online, through Windows Update) or *browse my computer* (a folder you have).

```quiz
The network adapter has no driver. Why won't searching online work?
- [x] Without its driver, the PC can't reach the internet
- [ ] Windows Update is turned off
- [ ] Drivers can only be installed from a USB stick
```

```quiz
A device shows a down arrow. What does it mean?
- [x] It's disabled
- [ ] It has no driver
- [ ] It's about to fail
```

---

## Fix it

```lab
net
audio
online
```
