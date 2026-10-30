# Connected, no internet

> It says it's connected, but nothing loads. The router was restarted this morning.

---

## APIPA

A PC on **DHCP** asks the router for an address. If no DHCP server answers, Windows gives **itself** an address starting **169.254** (APIPA). It can't reach the router or the internet with it.

- `ipconfig` shows it as **Autoconfiguration IPv4 Address**.
- `ipconfig /release` then `ipconfig /renew` asks again.

```quiz
ipconfig shows 169.254.83.17. What does it mean?
- [x] No DHCP server answered: Windows gave itself an address
- [ ] The PC has internet
- [ ] The DNS server is wrong
```

```quiz
Which command asks the router for a new address?
- [x] ipconfig /renew
- [ ] ipconfig /all
- [ ] ping 169.254.83.17
```

---

## Fix it, then prove it

`ipconfig`, `ipconfig /release`, `ipconfig /renew`, then `ping example.com`.

```lab
address
online
```
