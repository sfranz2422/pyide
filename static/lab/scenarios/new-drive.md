# Make a new drive usable

> The new 500 GB drive doesn't show up in File Explorer. Make it **E:**, NTFS, named **Backup**.

---

## Why a new drive doesn't show up

A brand-new disk is **not initialized**: it has no partition table. File Explorer only shows **volumes with a letter**.

1. **Initialize** it: **GPT** (modern, UEFI, over 2 TB) or **MBR** (old: four primary partitions at most).
2. Make a **volume** (partition) on the unallocated space.
3. **Format** it with a file system: **NTFS** for Windows; **exFAT** for removable drives; **FAT32** only up to 32 GB.
4. Give it a **drive letter**.

Disk Management does all four in its wizards; `diskpart` does them as commands (in a Command Prompt run as administrator).

```quiz
Why can't this volume be FAT32?
- [x] Windows formats FAT32 only up to 32 GB
- [ ] FAT32 is for Macs
- [ ] FAT32 needs MBR
```

```quiz
Which partition style does a 3 TB disk need?
- [x] GPT
- [ ] MBR
- [ ] Either
```

---

## Do it

Disk Management (it asks to initialize as it opens), or `diskpart`: `list disk`, `select disk 1`, `convert gpt`, `create partition primary`, `format fs=ntfs label=Backup quick`, `assign letter=E`.

```lab
gpt
e-ntfs
label
whole
```
