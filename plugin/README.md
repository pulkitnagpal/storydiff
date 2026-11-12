# Storydiff plugin for Claude Code

Run `/storydiff` when your change is ready. Claude writes `handover.storydiff` from this session,
captures the old and new versions of the app, checks every claim against the code, the tests and
your own words, fixes or drops the lines that don't hold up, and opens the review card so you see
exactly what the reviewer will see. Say yes once and it publishes the card to the pull request.

- `/storydiff`: the whole flow, ending with one confirmation before anything is pushed or posted.
- `/storydiff write`: only write and check the handover file.
- `/storydiff publish`: publish a card you have already looked at.

Claude also offers the flow when you ask it to "raise the PR".

The skill runs the `storydiff` CLI, which must be on your PATH. Install it once from source
(Node 22 or later):

```
npm install -g github:pulkitnagpal/storydiff
```

If it is missing, `/storydiff` stops and tells you this line.

Install the plugin:

```
/plugin marketplace add pulkitnagpal/storydiff
/plugin install storydiff@storydiff
```

See the [main README](../README.md) for the reviewer side and the GitHub Action.
