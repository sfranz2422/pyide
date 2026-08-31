# Reading a file, and writing one.
#
# Click the scores.txt tab to see the data this program reads.
# Run it, and a report.txt tab will appear — that's a file YOUR program made.

names = []
total = 0

# --- reading, one line at a time ---
with open("scores.txt") as f:
    for line in f:
        line = line.strip()          # drop the newline on the end
        if line == "":               # skip blank lines
            continue
        name, score = line.split(",")
        names.append(name)
        total += int(score)          # split() gives text, so convert it

average = total / len(names)

print("Students:", ", ".join(names))
print("Total:", total)
print("Average:", round(average, 1))

# --- writing a new file ---
with open("report.txt", "w") as out:
    out.write("Class report\n")
    out.write("============\n")
    out.write("Students: " + str(len(names)) + "\n")
    out.write("Average:  " + str(round(average, 1)) + "\n")
    for name in names:
        out.write("- " + name + "\n")

print()
print("Wrote report.txt — open the tab to read it.")
