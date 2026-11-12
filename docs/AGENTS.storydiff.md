<!-- Storydiff: paste this section into your repo's AGENTS.md (or .cursorrules, CONVENTIONS.md, …).
     Generated from plugin/skills/storydiff/language.md by scripts/agents-snippet.mjs. Do not edit by hand. -->

## Handing a change over for review (Storydiff)

When a change is ready for a pull request, or the human asks you to open or update one, hand it
over with Storydiff before you open the PR:

1. Write `handover.storydiff` at the repo root, as described below.
2. Run `npx storydiff check`. It writes `.storydiff/report.json` and exits 1 when a claim does not
   hold up. Fix the file, never the code, to match: correct a `file:line` or a test name, copy a
   quote exactly, or drop the line. Run it again until it passes (at most three rounds). If an old
   test now fails, stop and tell the human.
3. If the file has `show` lines, run `npx storydiff capture`. Remove any `show` it cannot capture.
4. Run `npx storydiff render` and `npx storydiff view`, and ask the human to look at the card.
5. Only after the human says yes: commit (never `.storydiff/`), push, open the PR if there is
   none, then run `npx storydiff publish`.

Quotes (`said`) are checked against the session log. `storydiff check` finds Claude Code's logs on
its own; for other agents, pass your transcript with `--session <file>` if you have one. Without a
log, quotes are shown as not checked. Add `.storydiff/` to `.gitignore`.

## Writing handover.storydiff (language v0.3)

You made a change. A human has to approve it: a senior engineer, a designer or a PM. They will
not read your diff first. They will read one review card drawn from `handover.storydiff`, a short
file you write now, from what you remember of this session. Every line on the card is checked
against the code, the tests and the human's own words, so only write what you can back.

Write `handover.storydiff` at the repo root.

### The card you are writing for

Six slots, top to bottom:

1. **Verdict**: old tests still pass, new tests, claims checked, things to try. Computed, you write nothing.
2. **Asked → did**: the human's request in their words (`ask`), and your approach in one line (`did`).
3. **Before → after**: the picture (`show` lines). A screen, an API call, a scenario, a pipeline,
   a recipe, or "same on both versions". Captured for real from both versions, never drawn by you.
4. **What changed underneath**: the map, boxes and arrows as they are today, then what changed.
5. **The list**: at most 7 numbered lines, in three groups: new or changed, kept the same, try
   before you merge. Pins on slot 3 carry the same numbers.
6. **Details**: files, every check, the session.

### A complete example

```
pr     "Linkbox #12" files 5
title  "Tags for links"
by     "Maya" with "Claude Code"
ask    "Add tags to links, and let me filter the list by one tag."
did    "Tags get their own table. The page shows them and filters by one. The mobile app's list is unchanged."

show screen /                          "What people see" "spot the difference"
show call POST /api/links {"url":"https://figma.com","title":"Figma tips","tags":["design"]} "What apps get back" "when they save a link"
show same "GET /api/links, the list the mobile app reads" GET /api/links

screen   page   "Page"
endpoint api    "API"
table    links  "Links"
external mobile "Mobile app"
page -> api
api -> links
mobile -> api

+ "Every link shows its tags. Pick one to see only those."
    pin screen "li .chip"
    pin screen "#filter"
    proof public/index.html:41
+ "Add tags when you save a link."
    pin screen "#tags"
    proof public/index.html:18
+ table tags "Tags" "Tags live in their own table."
    said @03:11 "in their own table, not a comma string"
    proof db.js:12
+ api -> tags
    proof server.js:40
= mobile "The list the mobile app reads."
    said @03:11 "the mobile app reads it"
    pin same 1
    proof test list keeps its fields
! "Open the page once. Nobody has yet."
    pin screen page
! "Saving a link now also returns its tags. Check the mobile app ignores it."
    pin call "tags"
    proof server.js:52
```

### Header lines

```
pr     "Repo #12" files 5        # the PR and how many files it touches; before a PR exists: pr "Repo" files 5
title  "Short name of the change, in plain words"
by     "Maya" with "Claude Code" # the human you worked with (first name), and you
ask    "..."                     # what the human asked for, copied word for word from the session
did    "..."                     # your approach in one or two plain sentences
```

`ask` is a quote: copy the human's words exactly, trimmed to the sentence that states the request.
Write `did` for a designer or a PM. No function names.

### Slot 3: show lines (the picture)

Pick the one or two pictures a reviewer would want to see first. Each `show` is captured by
`storydiff capture` from the old and the new version. If it cannot be captured, it is left out of
the card. It is never faked, so do not write a `show` you cannot back.

```
show screen /path ["label" ["hint"]]             # a page of the running app, before and after
show call METHOD /path [{json}] ["label" ["hint"]]  # one HTTP request, both responses side by side
show same "label" screen /path                   # proves a page did NOT change
show same "label" METHOD /path                   # proves a response did NOT change (times and ids ignored)
show pipeline <file> ["label"]                   # a CI workflow file, drawn as its steps
show recipe   <file> ["label"]                   # a Dockerfile or similar, drawn as its lines
show scenario "what happens when…"               # a sequence of requests and its outcome
```

Which to use:

- A visible change to a page: `show screen`.
- An API change: `show call` with a realistic body.
- A refactor, or a promise that something stays the same: `show same`, one per thing promised.
- CI or a container: `show pipeline` / `show recipe`.
- Behaviour over several steps (retries, races, money): `show scenario`.

Screens and calls need the app running. Tell `storydiff capture` how to start it, and what data to
create first, with these lines (the capture step reads them; the app must listen on `$PORT`):

```
run   "npm start"
setup POST /api/links {"url":"https://figma.com","title":"Figma tips"}
```

If `storydiff` rejects one of these lines, follow its error message: it names the line and the fix.

### Slot 4: the map, as it is TODAY

Only the parts this change touches or depends on: 3 to 8 boxes, at most 4 on a row.

```
kind id "Label"      # kinds: service screen part code endpoint table queue job store external file test user config
a -> b               # an arrow that exists today
```

Ids are short words you reuse in every later line. A box or an arrow must be on the map before a
mark line refers to it, unless the mark line declares it (`+ table tags "Tags"`).

### Slot 5: mark lines (the list)

Each mark line is one claim. It starts with a mark and ends with its line for the list, in quotes.

```
+  new          ~  changed          -  gone          =  kept the same on purpose          !  try before you merge
```

A mark can point at a new box, an existing box id, an arrow, or nothing:

```
+ table tags "Tags" "Tags live in their own table."   # declares a new box; the second quote is the list line
+ api -> tags                                         # a new arrow; no list line needed
~ server "server.js only starts the server now."      # an existing box that changed
- receive -> charge "Gone: charging straight after receiving."
= mobile "The list the mobile app reads."
! "Open the page once. Nobody has yet."               # a claim about nothing on the map
```

Under each mark, indented, back it up:

```
    proof file:line              # a line in the NEW code that shows it
    proof test <test name>       # a test that exists and passes
    said @mm:ss "exact words"    # the human's words from this session; @mm:ss is optional
    eng "The engineer version: names, functions, numbers."
    pin screen "<css selector>"  # draws this item's number on the after screen (or: pin screen page)
    pin call "<json field>"      # on a field of the call's response
    pin step "<text>"            # on a pipeline step
    pin row "<text>"             # on a recipe line
    pin outcome <n>              # on the outcome of scenario n
    pin same <n>                 # on "same" line n
```

### Chapters, for big PRs

When a PR holds more than one story, or the list would pass 7 lines, split it into chapters. Each
chapter is its own `handover.storydiff` and its own card. The header lists every chapter, and
`chapter` says which one this file is:

```
chapters "Charge customers once", "Retry slow charges", "+ 6 smaller changes"
chapter  1
```

Write chapter 1 (the main story) first. Name the smaller leftovers as one last chapter
("+ 6 smaller changes") rather than a card each.

### Rules

1. **Back every mark line** with at least one `proof` or `said`. A line with neither is drawn as
   "not backed". Never invent a proof: cite only lines and tests that exist in your final code.
   Point a `file:line` at the line that shows the claim, in a file this PR changed. The one
   exception is a `!` line that says something has not been done yet ("Nobody has opened the page
   yet"): there is nothing to cite, and saying so is the point.
2. **`said` is word for word.** Copy the quote exactly from the human's messages in this session,
   not from your own messages, tool output or system text. Use `said` for every decision the human
   made and every correction they gave you. Keep quotes short: the words that carry the decision.
3. **Use `!` honestly**: anything you did not test, any behaviour change nobody asked for, any
   risk, anything that has never run (a new workflow, a new container, a migration). If you checked
   it by running it, cite the test. If you only reasoned about it, say so in the line.
4. **Use `=`** for what the human told you not to touch, or what you deliberately left alone. Back
   it with their words or a test, and a `show same` when you can.
5. **Plain words.** List lines are for someone who does not code: no function names, 16 words at
   most. Put the technical version in `eng`.
6. **Short.** At most 7 list lines (arrows don't need one). It is a card, not a log. Split big PRs
   into chapters.
7. **Never fake slot 3.** Only `show` what really runs; pin only selectors, fields and steps that
   exist in the new version.
8. **Write only the file** in this step. Do not change code to make the handover look better.
