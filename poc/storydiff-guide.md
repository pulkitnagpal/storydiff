# Storydiff: hand your change to a human

You just made a change. A human (a senior engineer, a designer or a PM) has to approve it.
They will not read your diff first. They will watch a short whiteboard walkthrough drawn
from a `.storydiff` file that you write now, from what you remember of this session.

Write `handover.storydiff` at the repo root.

## The language

```
title "Short name of the change, in plain words"
why   "The problem this solves, in one sentence"
from  diff, tests, session

# 1. The picture as it is TODAY: only the parts this change touches or depends on. 3 to 8 boxes.
#    kind id "Label". Kinds: service screen part code endpoint table queue job store external file test user config
#    Ids must stay the same in every line below.
screen  page  "Links page"
endpoint api  "Links API"
table   links "links"
page -> api "fetches"
api -> links

# 2. What changed, in the order a person should hear it. Each mark line is one step of the walkthrough.
#    +  new      ~  changed      -  gone      =  untouched on purpose      !  watch: the reviewer should look here
+ table tags "tags"
    + id, name                         # items: fields, columns, props, settings (+ new, - removed, ~ changed)
    say "Plain words for a designer or PM, one sentence."
    eng "The engineer version: names, functions, numbers."
    proof db.js:12                     # file:line in the NEW code
    proof test filters links by tag    # a test name that exists and passes
    said "exact words the human typed in this session"
+ api -> tags "reads"
    proof server.js:40
= page "untouched"
    said "the human's words if they asked for this"
! api "what could go wrong"
    say "What the reviewer should check, and why."
    proof server.js:44
```

Optional grouping: `step "Caption"` followed by indented mark lines makes them one step.

## Rules

1. Every mark line needs at least one `proof` or `said`. A line with neither is drawn as
   "not backed" and the reviewer will distrust it. Never invent a proof: only cite lines and
   tests that exist in your final code.
2. `said` quotes are copied word for word from the human's messages in this session. Use them
   for every decision the human made or every correction they gave you.
3. Use `!` honestly: anything you did not test, any behaviour change nobody asked for, any risk.
   If you checked something by running it, cite the test. If you only reasoned about it, say so.
4. Use `=` for things the human told you not to touch, or that you deliberately left alone.
5. `say` lines must be readable by someone who does not code. No function names there.
6. Keep it short: 3 to 7 mark lines (not counting arrows). It is a film, not a log.
7. Write only the file. Do not change code in this step.
