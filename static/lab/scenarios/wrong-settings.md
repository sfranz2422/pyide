# Someone changed the settings

> Network settings were typed in by hand from a guide for another network. The router is 192.168.1.1, and it's the DNS server too.

---

## Work outward

1. `ping 192.168.1.1`: can it reach the **router**?
2. `ping 93.184.215.14`: can it reach the **internet by address**? If not, the **default gateway** is wrong. `tracert` shows where it stops.
3. `ping example.com`: by **name**? If addresses work but names don't, it's **DNS**. `nslookup example.com` asks the DNS server.

```quiz
ping 93.184.215.14 works, ping example.com doesn't. What's wrong?
- [x] DNS
- [ ] The default gateway
- [ ] The network driver
```

```quiz
Which tool shows each hop on the way to an address?
- [x] tracert
- [ ] ipconfig
- [ ] nslookup
```

---

## Fix it

Settings › Network & internet › Edit IP settings: the right gateway and DNS, or back to **Automatic (DHCP)**.

```lab
online
dns
```
