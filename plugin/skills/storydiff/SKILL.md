---
name: storydiff
description: Hand a change over for review as one checked Storydiff card. Writes handover.storydiff from this session, captures the old and new versions, checks every claim against the code, the tests and the human's words, shows the card, and on confirmation publishes it to the pull request. Use when the user runs /storydiff, or asks to raise, open or update a PR, or to hand the change over for review.
when_to_use: 'For example: "raise the PR", "open a pull request", "make the PR", "hand this over", "write the handover", "update the storydiff card".'
argument-hint: "[write | publish]"
allowed-tools:
  - Bash(storydiff *)
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git rev-parse *)
  - Bash(git merge-base *)
  - Bash(gh pr view *)
  - Bash(gh pr create *)
  - Bash(ls *)
  - Read
  - Grep
  - Glob
---

# Storydiff: hand the change over

You will write `handover.storydiff`, prove every line of it, show the author the exact card the
reviewer will see, and publish only after the author says yes. The author writes nothing.

Arguments: `$ARGUMENTS`

- empty: the whole flow below.
- `write`: steps 1 and 2 only (write and check the file, no capture, no publish).
- `publish`: the card already exists and the author has seen it; go to step 6.

## Where things stand

Find out first, one plain command at a time (each is pre-approved; don't chain them):

- `git rev-parse --show-toplevel` and `git rev-parse --abbrev-ref HEAD`
- `git status --short`
- `storydiff --version` (if this fails, the CLI is not installed)
- `gh pr view --json number,url,title,state` (fine if it fails: there is no PR yet, or gh is not signed in)
- `ls .storydiff` (fine if it fails: nothing written yet)

**If `storydiff --version` fails, stop here.** Tell the author to install it once, from
source, and then run `/storydiff` again:

```
npm install -g github:pulkitnagpal/storydiff
```

(or `git clone https://github.com/pulkitnagpal/storydiff && cd storydiff && npm install && npm run build && npm link`).
Do not try `npx storydiff`: the CLI is not on npm.

This session's id is `${CLAUDE_SESSION_ID}`; the checker uses it to find the human's words.

## 1. Write handover.storydiff

Read [language.md](language.md) now, every time: it is the language, the rules and a full example.

Then gather what you need, without guessing:

- the base: `git merge-base HEAD origin/HEAD` (or `main`/`master`), and `git diff --stat <base>`
  plus the uncommitted changes, so you know every file this PR touches;
- the tests: the names of the tests you added or ran, exactly as the test runner prints them;
- the human's words: the request (for `ask`), and every decision or correction they made in this
  session (for `said`). Copy them exactly. If you are not sure of the exact words, leave the quote out.

Write `handover.storydiff` at the repo root. If one exists from an earlier run, update it instead
of starting over. Don't edit `.gitignore`: `.storydiff/` holds captures and the card, and the CLI keeps it out of git
by itself.

## 2. Check it

```bash
storydiff check --session ${CLAUDE_SESSION_ID}
```

It writes `.storydiff/report.json`, prints one line per claim that does not hold up, and exits 1 if
any fails or an old test now fails. Read the report, then fix the file, not the code:

| What failed | What to do |
| --- | --- |
| `proof file:line` (line missing, or not in a changed part) | Find the line that really shows it (`Grep`) and fix the number. If none does, drop the proof. |
| `proof test <name>` (not found, or failed) | Use the test's exact name as the runner prints it. If it does not exist, drop the proof. If it fails, tell the author: that is a bug, not a handover problem. |
| `said` (no match in the session) | Copy the exact words from the human's message, or drop the quote. Never reword it to match. |
| a mark left with no proof and no `said` | Drop the mark. Keep it only if it is a `!` risk the reviewer must hear, and say in its line that it is not verified. |
| a parse error (`Line N: …`) | Do what the message says. |
| an old test now fails (regression) | Stop. Tell the author which test broke. Do not edit the handover to hide it. |

Run `check` again after each fix, at most three rounds. Lines you cannot back are dropped, not
softened. Keep a short note of what you fixed and what you dropped, for step 5.

With `write`, stop here and report.

## 3. Capture the pictures

If the file has `show` lines:

```bash
storydiff capture --base <base>
```

It starts the old and the new version (from the `run` and `setup` lines), captures each `show`,
and writes `.storydiff/captures.json` with the screenshots. If the app does not start, read the
error, fix the `run` or `setup` line once, and try again. If a `show` still cannot be captured,
remove that `show` line and any `pin` that pointed at it. Never draw slot 3 by hand.

If capture reports a pin target that was not found (`"found": false`), fix the selector or drop
the pin. Run `storydiff check` again if you changed the file.

## 4. Render and open the card

```bash
storydiff render
storydiff view
```

`view` opens `.storydiff/card.html` in the browser. This is exactly what the reviewer will see.

## 5. Show the author, and ask once

Tell the author, briefly:

- the verdict line as the card shows it (old tests, new tests, claims checked, things to try);
- the numbered list, as on the card;
- what you fixed or dropped in step 2 or 3, and why, in one line each;
- what publishing will do, concretely: which branch, whether it commits the uncommitted files
  (list them) and pushes, whether it opens a new PR or updates PR #N, and that the card goes into
  the PR description and the first comment.

Then ask one question: publish? Wait for a clear yes. If they want changes, edit the file, and go
back to step 2.

## 6. Publish (only after a yes)

1. If on the default branch, create a branch first: `git switch -c <short-name-from-title>`.
2. Commit what the author agreed to (never `.storydiff/`), with a plain message from `title`.
3. Push: `git push -u origin HEAD`.
4. If there is no PR for this branch yet, open one: `gh pr create --title "<title>" --body "<did>"`.
5. Publish the card:

   ```bash
   storydiff publish
   ```

   It puts the spec and the check result in the PR description as a fenced `storydiff` block,
   and creates or updates the one Storydiff comment.

6. Give the author the PR link. If the repo has the Storydiff GitHub Action
   (`.github/workflows/storydiff.yml`), say that it will re-check the claims and refresh the card
   on every push; if it does not, mention that a repo owner can add it (see the README).

If any step fails, stop and tell the author what failed and what is left. Do not force-push and
do not retry a publish blindly.
