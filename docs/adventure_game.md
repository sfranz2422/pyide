# The Fork in the Path

You are going to build a choose-your-own-adventure story. The computer tells
some of it, you decide the rest, and what you decide early changes how it ends.

We will build it in **14 steps**. After every single one you can press **Run**
and play what you have so far. Nothing is left until the end.

Everything here uses only three ideas: **variables**, **input**, and **if**.
No loops, no lists, no functions of your own. That is not a limitation you have
to work around — it is genuinely enough to write a real program.

## Before you start

Four things to know about this editor:

- **Press Run to play.** Your story appears in the output pane on the right.
- **You type your answers in that same pane.** When the program asks a question,
  a line appears under it. Type there and press **Enter**.
- **There is a 15-second time limit** on programs like this one — but the clock
  resets every time the program asks you something. So thinking time is free.
  You will only hit the limit if you accidentally write something that never
  stops.
- **Save your work.** This story will get long. If you are signed in it saves
  itself; if not, use **Share** to get a link, and keep that link somewhere.

You cannot copy the code out of these notes. That is on purpose — typing it is
how it gets into your head. You will make mistakes, and fixing them is the part
where you actually learn something.

Throughout, you will see boxes like this one:

> **Make it your own**
>
> These point out things you can change without breaking anything. Change them.
> The story I have written is deliberately plain. Yours should not be.

One more thing, and it matters: **the story below is scaffolding.** A fork in a
path, a cottage, a locked door. It is there so you have something to type while
you learn what each piece does. By the end you should have replaced the words
with your own. Two students handing in the same story have both missed the
point; two students handing in the same *structure* with completely different
stories have both got it exactly right.

---

# Step 1 — Put something on the screen

Delete everything in `main.py` and type this:

```python
print("========================================")
print("         THE FORK IN THE PATH")
print("========================================")
print()

print("The path splits in two.")
print("  LEFT  climbs toward a bare ridge.")
print("  RIGHT drops into a wood too dark to see into.")
print()
```

Press **Run**. Your story appears in the output pane.

**What each part does.** `print()` writes one line and then moves to the next
line. Everything inside the quotes comes out exactly as you typed it, spaces and
all — which is why `  LEFT` is indented two spaces and lines up with `  RIGHT`.

`print()` with nothing in the brackets prints an empty line. That is not a
mistake or a waste; blank lines are how you stop a wall of text from looking
like a wall of text. Delete the two `print()` lines, run it, and see how much
worse it reads.

The row of `=` signs is just a string of forty equals signs. There is no special
"make a banner" feature — you typed the banner.

> **Make it your own**
>
> Change the title and the two paths right now, before you go any further. A
> spaceship corridor that splits, two doors in a hospital, a menu in a cafe
> where one option is suspicious. Whatever you pick, keep it to **two choices**
> for now — you will add a third in Step 4.

---

# Step 2 — Ask who is playing

Add four lines after the banner:

```python
print("========================================")
print("         THE FORK IN THE PATH")
print("========================================")
print()

name = input("What is your name, traveller? ")

print()
print("Good luck, " + name + ". You are going to need it.")
print()

print("The path splits in two.")
print("  LEFT  climbs toward a bare ridge.")
print("  RIGHT drops into a wood too dark to see into.")
print()
```

Press **Run**. It asks your name, waits, and then uses it.

**What each part does.** `input("...")` does two jobs. It prints the message in
the brackets, then it stops and waits for you to type something and press Enter.
Whatever you typed comes back as the answer.

`name = input(...)` catches that answer and keeps it in a **variable** called
`name`. Without the `name =` part the program would ask the question, take your
answer, and immediately throw it away.

`"Good luck, " + name + ". You are going to need it."` glues three pieces of
text together. The `+` between strings means "join", not "add up". Notice the
space after `Good luck,` — inside the quotes. Leave it out and you get
`Good luck,Maya`. Nothing warns you; you just have to look.

> **Make it your own**
>
> Ask something else as well and use it later — the name of their home town, a
> pet, what they are afraid of. One extra `input` at the top, one extra
> variable, and the story can refer back to it at the end. It is a cheap trick
> and it works every time.

---

# Step 3 — The first real choice

Add an `input` for the choice, and an `if` to react to it:

```python
choice = input("Do you go left or right? ")
print()

if choice == "left":
    print("The ridge is bright and open, and there are berries the whole way.")
    print("From the top you can see a cottage down in the valley.")
else:
    print("Under the trees the air is cold and far too quiet.")
    print("A lantern hangs from a branch, still warm. You take it.")
```

That goes at the bottom, after the two paths are described. Press **Run** and
try it both ways.

**What each part does.** `if` asks a question that can only be answered yes or
no. `choice == "left"` is that question: "is what they typed exactly the word
left?" If it is, Python runs the indented lines under the `if`. If it is not, it
runs the indented lines under the `else` instead. One or the other — never both,
never neither.

**`==` is not `=`.** One equals sign *stores* something: `choice = "left"` would
force choice to be left. Two equals signs *compare*: `choice == "left"` asks
whether it already is. Getting these backwards is the single most common
beginner mistake in any language, and Python will usually catch it with a
`SyntaxError` here, which is lucky.

**The indenting is the program.** Those four spaces before each `print` are what
tells Python which lines belong to the `if` and which belong to the `else`. In
some languages indenting is just tidiness. In Python it is the actual meaning.
Un-indent one of those lines and run it — the line will print every time, no
matter what you chose.

**Try typing something silly.** Type `banana` at the question. You get the wood,
because `else` means "anything that was not left". That is a bug, and you will
fix it next step.

---

# Step 4 — A third way, and everything else

Change `else` to `elif`, and add a new `else` underneath:

```python
if choice == "left":
    print("The ridge is bright and open, and there are berries the whole way.")
    print("From the top you can see a cottage down in the valley.")
elif choice == "right":
    print("Under the trees the air is cold and far too quiet.")
    print("A lantern hangs from a branch, still warm. You take it.")
else:
    print("You cannot decide.")
    print("You stand at the fork until the light goes, and then it is too late.")
```

Press **Run** and type `banana` again. Now the story says something sensible
about it.

**What each part does.** `elif` is short for "else if". Python works down the
chain from the top, stops at the **first** test that is true, runs that block,
and skips everything below. If none of them are true it runs the `else`.

You can have as many `elif`s as you like — one for each direction, one for each
door. The `else` at the bottom is optional, but leaving it out means that when
nobody matches, nothing at all happens and your story silently stops making
sense.

**Turning a typo into part of the story is a real design choice.** The easy
version is `print("That is not a valid option.")`, which is honest and boring.
Deciding that standing still *is* a decision, and that it costs you the day, is
better writing and exactly the same amount of code.

> **Make it your own**
>
> Add a third real direction — a path straight ahead, a third door, a window.
> That is one more `elif` and a few more `print`s, and now the shape of your
> story is different from everyone else's.

---

# Step 5 — Make "LEFT" and " left " work too

One new line, right after the `input`:

```python
choice = input("Do you go left or right? ")
choice = choice.lower().strip()
print()
```

Press **Run** and try `LEFT`, `Left`, and `left` with a space before it. All
three now work.

**What each part does.** Before this line, `"Left" == "left"` was **False**.
Python compares text character by character, and a capital L is not a small l.
So a player who typed the word correctly but capitalised it got sent to the
`else` and told they could not decide. That is infuriating, and it is your fault
rather than theirs.

`.lower()` gives you the same text with every letter made small. `.strip()`
removes spaces from the start and end — the ones you get from a stray thumb on
the space bar.

They chain together: `choice.lower().strip()` means "make it small, then trim
the result." Read it left to right, like instructions in order.

`choice = choice.lower().strip()` puts the cleaned-up version back into the same
variable, replacing the original. From this line on, `choice` is the tidy one.
That is why the line goes directly under the `input` and not somewhere further
down — clean it once, at the door, and everything after can trust it.

**Two lines to remember.** Every single `input` in your story wants this
treatment. Every time you add a new question, add the `.lower().strip()` line
underneath it. It is the difference between a program that works and a program
that works *when you are careful*, and nobody is careful.

---

# Step 6 — Remembering something: True and False

Add one line near the top, and one line inside the `right` branch:

```python
has_lantern = False

print("The path splits in two.")
```

...and:

```python
elif choice == "right":
    print("Under the trees the air is cold and far too quiet.")
    print("A lantern hangs from a branch, still warm. You take it.")
    has_lantern = True
```

Press **Run**. Nothing looks different yet — you are remembering something but
not using it. That is the next step.

**What each part does.** `True` and `False` are special values in Python, like
numbers or text but with only two possibilities. A variable holding one of them
is often called a **flag**: it records one fact, and later on you can check it.

`has_lantern = False` at the top is the starting state — you begin the story
without a lantern. Setting it up **before** the story begins matters. If you
only created `has_lantern` inside the `right` branch, then a player who went
left would reach a line asking about a variable that does not exist, and the
program would stop with `NameError: name 'has_lantern' is not defined`.

Try that, actually. Delete the `has_lantern = False` line, run it, go left, and
read the error. Then put it back. Errors are much less frightening once you have
caused one on purpose.

**Capital T, capital F.** `True` and `False` are spelled with capitals. `true`
is not a thing in Python and will give you a `NameError`.

**No quotes.** `has_lantern = True` is a yes/no fact. `has_lantern = "True"` is
a *piece of text that says True*, which is a different thing and will confuse
you in Step 7. This bites everybody once.

---

# Step 7 — Using what you remembered

Add a night-time scene at the bottom:

```python
print("Night comes on while you are still walking.")
if has_lantern:
    print("You light the lantern and carry on at a decent pace.")
else:
    print("You go on in the dark, slowly, with one hand out in front.")
print()
```

Press **Run** twice — once going left, once going right — and watch the night
change.

**This is the whole idea of the project.** A choice made in one part of the
story reaches forward and changes a later part. The lantern is not really about
a lantern; it is about the program *remembering*. Every interesting thing you
add from here uses this same shape: set a flag when something happens, check the
flag later when it matters.

**What each part does.** `if has_lantern:` with nothing after it. No `==`, no
comparison. That is because `has_lantern` is *already* True or False, and `if`
wants exactly that. Writing `if has_lantern == True:` also works, but it reads
like "if it is true that this is true", and Python programmers will look at you
strangely. Get used to the short form now.

Read it aloud — "if has lantern" — and you can hear why the variable is named
the way it is. Name your flags so the `if` line reads like English:
`has_key`, `door_is_open`, `told_the_truth`. Not `x`, not `flag2`.

> **Make it your own**
>
> Give the two versions of the night completely different weight. Maybe without
> a lantern you lose something, or hear something following you. This is the
> first place your story can really diverge, and a difference the player
> *notices* is worth more than a difference that is merely there.

---

# Step 8 — Ending the story early

Add a second flag, set it in the `else`, and wrap the night scene in a check:

```python
has_lantern = False
still_going = True
```

In the fork:

```python
else:
    print("You cannot decide.")
    print("You stand at the fork until the light goes, and then it is too late.")
    still_going = False
```

And around the night scene:

```python
if still_going:
    print("Night comes on while you are still walking.")
    if has_lantern:
        print("You light the lantern and carry on at a decent pace.")
    else:
        print("You go on in the dark, slowly, with one hand out in front.")
    print()
```

Press **Run** and type `banana` at the fork. The story stops there instead of
carrying on as though nothing happened.

**What each part does.** A Python program runs from the top of the file to the
bottom, and there is no way to say "stop here" — not with what you know yet.
`still_going` is how you get the same effect: a flag that means "the story has
not ended", and every scene from here on sits inside `if still_going:`.

When it goes `False`, every remaining scene is skipped, and the program runs
quietly off the bottom of the file.

**Look at the indenting carefully.** The night scene's lines moved four spaces
right, and the `if has_lantern:` inside it moved with them — so its `print`s are
now eight spaces in. That is an `if` inside an `if`, which is called
**nesting**, and the indenting is the only thing that says which belongs to
which.

This is the step where most people's program breaks. If yours does, the error
will say `IndentationError` or `expected an indented block`. Read which line
number it names and count the spaces on that line and the one above it.

**Every scene from now on starts with `if still_going:`.** That is the pattern
for the rest of the project, and it is worth saying once: this is not the
world's most elegant way to end a story early. It is the best one available
without loops, and it is completely honest — real programs are full of exactly
this kind of flag.

---

# Step 9 — A second scene

A whole new block at the bottom. Add `has_key = False` with the other flags
first:

```python
has_lantern = False
has_key = False
still_going = True
```

```python
if still_going:
    print("By evening you reach the cottage. One dark window, one open door.")
    print()

    answer = input("Do you knock? (yes / no) ")
    answer = answer.lower().strip()
    print()

    if answer == "yes":
        print("Nobody answers, but the door swings all the way open.")
        print("A small iron key sits on the table, with half a loaf beside it.")
        has_key = True
    else:
        print("You sleep in the long grass instead.")
        print("It is a cold night.")

    print()
```

Press **Run** and play it through both ways.

**What each part does.** Nothing new — that is the point. It is an `input`, a
`.lower().strip()`, an `if`/`else`, and a flag, all of which you already know.
You have just learned enough to write a scene, and now you can write as many as
you like.

Notice the **new question comes in the middle of the story**, not all the
questions at the start. That is what makes it feel like a story rather than a
form. The program talks, you answer, the program talks again.

Notice too that everything in this scene is indented four spaces, because it all
lives inside `if still_going:`, and the lines inside `if answer == "yes":` are
indented eight. Two levels. That is as deep as this project will go, deliberately
— once you are four levels in, nobody can read it, including you.

> **Make it your own**
>
> This is the moment to stop following along and start writing. Your second
> scene does not have to be a cottage. Change the place, the question, and what
> you find. Keep the *shape* — `if still_going:`, a question, a clean-up line, a
> two-way `if`, a flag — and change everything else.
>
> Then add a third scene of your own the same way. That is the whole job.

---

# Step 10 — Accepting "y" as well as "yes"

Change one line:

```python
    if answer == "yes" or answer == "y":
```

Press **Run** and answer with just `y`.

**What each part does.** `or` joins two questions into one. The whole line is
true if the left side is true, **or** the right side is true, or both. Only if
both are false does it go to the `else`.

**You have to write the variable twice.** `if answer == "yes" or "y":` looks
right, runs without an error, and is wrong — it will treat *every* answer as
yes, including "no". That is the worst kind of bug: silent. Each side of an `or`
has to be a complete question all by itself.

Try it, so you have seen it happen. Write the broken version, run it, answer
`no`, and watch yourself get the key anyway. Then fix it.

> **Make it your own**
>
> Be generous with the answers you accept. `"yes" or "y" or "yeah" or "sure"`
> is three more `or`s and makes your game feel far less fussy. You could do the
> same at the fork, for `"l"` and `"r"`.

---

# Step 11 — A number that goes up and down

Add a supplies count, and change it in three places.

With the flags:

```python
has_lantern = False
has_key = False
still_going = True
supplies = 2
```

In the fork — the ridge feeds you, the wood costs you a day:

```python
if choice == "left":
    print("The ridge is bright and open, and there are berries the whole way.")
    print("You eat well and fill your bag.")
    print("From the top you can see a cottage down in the valley.")
    supplies = supplies + 1
elif choice == "right":
    print("Under the trees the air is cold and far too quiet.")
    print("You are lost for most of the day and you eat as you walk.")
    print("A lantern hangs from a branch, still warm. You take it.")
    has_lantern = True
    supplies = supplies - 1
```

In the cottage, add a choice inside the choice, and a cost for sleeping out:

```python
    if answer == "yes" or answer == "y":
        print("Nobody answers, but the door swings all the way open.")
        print("A small iron key sits on the table, with half a loaf beside it.")
        has_key = True
        print()

        take = input("Do you take the bread as well? (yes / no) ")
        take = take.lower().strip()
        print()

        if take == "yes" or take == "y":
            print("You take it. It is not stealing if nobody lives here.")
            supplies = supplies + 1
        else:
            print("You leave it exactly where you found it.")
    else:
        print("You sleep in the long grass instead.")
        print("It is a cold night, and you eat to keep warm.")
        supplies = supplies - 1
```

Press **Run**. Still nothing visible — you are counting quietly. Step 12 uses it.

**What each part does.** `supplies = supplies - 1` looks like nonsense in maths
and is perfectly ordinary in programming. The right-hand side is worked out
first, using the *current* value; the answer is then stored back. So if supplies
was 2, the right side works out to 1, and 1 goes back into supplies.

`supplies = 2` is a number, with no quotes. `supplies = "2"` would be a piece of
text that looks like a number, and `"2" - 1` is an error. Quotes matter.

**Now your two paths are a real trade.** The ridge feeds you but gives you
nothing to carry. The wood costs you a day's food but gives you the lantern. A
choice where one option is better in every way is not a choice — it is a
formality. Getting this right is game design, not programming, and it is the
harder of the two.

> **Make it your own**
>
> `supplies` can be anything you count: health, money, fuel, how suspicious the
> guard is, how much your friend trusts you. Start it at whatever number makes
> your story tense. Starting at 10 when nothing costs more than 1 means it never
> matters.

---

# Step 12 — Comparing numbers

At the end of the cottage scene, still inside `if still_going:`:

```python
    if supplies <= 0:
        print("Your bag is empty. Whatever happens next, it happens hungry.")
        print()
```

Press **Run**, go right, and refuse to knock. Your supplies hit zero and the
warning appears.

**What each part does.** `<=` means "less than or equal to". The full set:

| | means |
|---|---|
| `==` | is the same as |
| `!=` | is not the same as |
| `<` | is less than |
| `>` | is greater than |
| `<=` | is less than or equal to |
| `>=` | is greater than or equal to |

Each one asks a question that comes back True or False, exactly like
`choice == "left"` did. An `if` does not care where its True came from.

**Why `<= 0` and not `== 0`?** Because if anything in your story ever costs two
supplies, you would skip straight from 1 to −1 and `== 0` would never notice.
`<= 0` catches it whatever route it took there. When you are testing for
"ran out", test for "at or below", not "exactly".

---

# Step 13 — The locked door, and `and`

The last scene. At the bottom:

```python
if still_going:
    print("Past the cottage the path ends at a locked door set into the hillside.")
    print()

    if has_key and has_lantern:
        print("The key turns. The lantern shows you steps going down, and down.")
        print("The stairs take hours and you finish the last of what you carry.")
        supplies = supplies - 1
    elif has_key:
        print("The key turns, but past the doorway it is completely black.")
        print("You feel your way down two steps, then think better of it.")
        still_going = False
    elif has_lantern:
        print("Your lantern lights the door up beautifully.")
        print("It is still locked.")
        still_going = False
    else:
        print("A locked door, in the dark, with nothing at all in your pockets.")
        still_going = False

    print()
```

Press **Run** a few times and try to get through. There is exactly one way.

**What each part does.** `and` joins two questions, and the whole thing is true
only when **both** sides are true. Compare it with `or` from Step 10, which
needed only one side. Those two words are most of the logic you will ever write.

**The `elif`s already mean "and not".** The second branch is just
`elif has_key:` — it does not need to say "and not has_lantern", because `elif`
only ever runs when every test above it failed, and the test above it was
`has_key and has_lantern`. So by the time Python reaches the second branch, it
already knows you do not have both. Writing the extra condition would not be
wrong, just noise.

**Four outcomes from two flags.** Both, one, the other, neither. Two yes/no
facts always give exactly four combinations, and this is the first time in the
project you have handled all four honestly. Add a third flag and there are
eight, which is where you start needing to be organised.

**Notice this scene is where your earlier choices finally pay off.** The
lantern came from Step 6 and the key from Step 9, and neither of them mattered
until now. That gap is what makes the story feel like it has consequences.

> **Make it your own**
>
> One winning route out of four is harsh. Give a second route through — perhaps
> the key alone works if you have enough supplies to feel around in the dark.
> That is an `and` you write yourself, mixing a flag with a number.

---

# Step 14 — Work out the ending

Right at the bottom of the file, not indented at all:

```python
print("----------------------------------------")

if not still_going:
    print("ENDING: You turn back, " + name + ". The door is still there.")
elif supplies <= 0:
    print("ENDING: You get through, " + name + ", on an empty stomach.")
else:
    print("ENDING: You get through, " + name + ", and you still have food.")

print("Supplies left: " + str(supplies))
print("----------------------------------------")
```

Press **Run**. Play it several times and try to reach all three endings.

**What each part does.** `not` flips True into False and False into True. So
`if not still_going:` means "if the story did **not** make it to the end". You
could write `if still_going == False:` instead — same result, and `not` reads
better once you are used to it.

`not`, `and` and `or` are the complete set. Everything else is built from those
three.

**This chain runs outside every `if still_going:` block**, right at the left
margin. That is deliberate — it has to run whatever happened, because every
route through the story has to finish somewhere.

**`str(supplies)`** turns the number into text so `+` can join it to a string.
Without it, `"Supplies left: " + supplies` is a `TypeError`: Python will not
guess whether you meant to add numbers or join text. Try it and read the error;
you will see it again.

**Three endings, and every one of them reachable.** That last part is worth
checking on your own story. It is very easy to write an ending whose conditions
can never all be true at once, and then wonder why nobody ever sees it. Play
your game enough times to reach every ending you wrote. If you cannot reach one,
either the conditions are wrong or the ending should not be there.

---

# You are done

Play it a few more times. Then read your program from the top, out loud if you
can stand it, and notice that it is just:

- some `print`s
- some `input`s, each cleaned with `.lower().strip()`
- some variables that remember things — `True`/`False` flags and one number
- a lot of `if`, `elif` and `else`
- `and`, `or`, `not` where one question was not enough

That is the whole toolkit, and you have now written about a hundred lines with
it.

**The story is the assignment, not the structure.** What you should hand in is
this shape with your writing in it — your setting, your choices, your endings.
Go back through and replace the words. Then add a scene of your own.

---

# Challenges

No code given. Work them out from what you already know — every one of these is
possible with variables, input, and if.

### 1. A secret ending

Add an ending that almost nobody will find, because it needs an unlikely
combination — the lantern, no key, full supplies, and the right answer to a
question you only get asked if you went left.

### 2. A password on a door

Ask the player for a word. Compare it to the right one. The interesting part is
where the player *learns* the word: hide it in a scene they only reach one way,
so the password is a reward for exploring rather than a guess.

### 3. Count something the player does not know about

Track how many risky choices they made. Do not show the number. Use it once, at
the end, to change the final line. Players noticing that the game was watching
them is a genuinely good moment.

### 4. Two things you cannot both have

Offer a choice between two items and let them take only one. Later, make two
different scenes where each item is the one that helps. Now replaying the game
means something.

### 5. Ask a number instead of a word

Offer numbered options — `1`, `2`, `3` — and compare what they typed against
`"1"`, `"2"`, `"3"` **as text**, with quotes. It will work, and the reason it
works is worth thinking about. Then try it *without* the quotes and read the
error carefully; that error is the whole reason `input` and numbers are a
chapter of their own.

### 6. A stat that changes how people speak to you

Track how honest the player has been. Then, in a later scene, use it to pick
between two versions of the *same* conversation. This is the hardest one here,
and the closest to how real games work.
