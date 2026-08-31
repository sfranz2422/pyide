# Day 4 — Reading a File

## What you're building

A program that reads `scores.txt` and prints the class average.

## Before you start

Click the **scores.txt** tab and look at the data. Each line is a name and a
score, separated by a comma:

```
ana,10
ben,7
```

## Steps

1. Open the file with `open("scores.txt")`
2. Loop over it one line at a time
3. Use `.strip()` to drop the newline, then `.split(",")` to break the line in two
4. `split()` gives you **text**, so convert the score with `int()`
5. Keep a running total, then divide by how many students there were

## Watch out for

| Problem | What you'll see |
|---|---|
| Forgot `int()` | `TypeError` when you add |
| Forgot `.strip()` | The number has a hidden newline |
| Divided by the wrong thing | An average that's way too small |

> If you get stuck, read the error message first. It tells you the line number.

## When you're done

Put your name in the box at the top and press **Share**, then paste the link
into the assignment in Canvas.
