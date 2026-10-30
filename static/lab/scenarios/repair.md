# Crashes and odd errors

> The PC lost power during an update. Since then programs crash and Windows shows odd errors.

---

## Two repair tools

- `sfc /scannow` (**System File Checker**): finds damaged **Windows system files** and puts back good copies.
- `chkdsk C: /f` (**Check Disk**): finds and fixes **file system** errors. On C:, which Windows is using, it asks to run at the **next restart**: say **Y**, then restart.

Both need a **Command Prompt run as administrator**.

```quiz
Which tool repairs damaged Windows system files?
- [x] sfc /scannow
- [ ] chkdsk /f
- [ ] ipconfig /flushdns
```

```quiz
chkdsk C: /f says it can't run now. Why?
- [x] Windows is using C:: it runs at the next restart
- [ ] You aren't an administrator
- [ ] C: isn't NTFS
```

---

## Fix it

```lab
sfc
chkdsk
```
