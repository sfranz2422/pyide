# Day 4 — Reading a File
# Read the Notes tab first, then fill this in.

total = 0
count = 0

with open("scores.txt") as f:
    for line in f:
        line = line.strip()
        if line == "":
            continue
        # TODO: split the line on the comma
        # TODO: add the score to total (remember int())
        # TODO: add 1 to count

# TODO: print the average
