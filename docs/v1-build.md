# Storydiff v1: what to build

The card design is locked. The source of truth is `poc/v3/canvas/*.dc.html` (open them in a browser:
they render as plain HTML) and the working proof of concept in `poc/v3/`:

- `poc/v3/spec.js`: the language parser (v0.3). Grammar at the top of the file.
- `poc/v3/render.js`: spec + captures + report -> the card HTML. It reproduces the canvas boards;
  see `poc/v3/out/*.html` and the four specs in `poc/v3/data/*/handover.storydiff`.
- `poc/v3/shot.js`: headless Chromium over the DevTools protocol (Chrome, Brave or Edge): screenshots
  and element positions for pins.
- `poc/v3/build.js`: how the pieces fit for the four example cards.
- `poc/verify.js` (earlier POC): the checker. It proves file:line proofs exist, cited tests pass,
  `said` quotes match the human's messages in the session log, and finds regressions by running the
  tests on base and head.

**Rule for v1: the output must match the canvas.** Every renderer change is checked by rendering the
four example specs and comparing against `poc/v3/canvas/` (a test renders them and diffs screenshots
or at least DOM structure).

## The card (locked)

Six slots, top to bottom: verdict, asked → did, before → after (slot 3), underneath map, the list,
details. Slot 3 picture kinds: screen, call, scenario, pipeline/recipe, same (v1); table, metric,
terminal, signatures, versions are listed on `poc/v3/canvas/Coverage.dc.html` (v1.1). Forms: changed
(side by side), new (after alone), removed (before crossed out), identical (one "Same" line). Big PRs:
`chapters` + one card per chapter. Never draw a pin whose target was not found; never fake slot 3.

## Data contracts between the modules

`handover.storydiff` (written by the agent) -> parsed by `spec`.

`.storydiff/captures.json` (written by `capture`), one entry per `show` line, in order:

```json
{ "shows": [
  { "kind": "screen", "app": "Linkbox", "before": "before-0.png", "after": "after-0.png",
    "rects": [{ "sel": "#filter", "found": true, "x": 0, "y": 0, "w": 0, "h": 0 }] },
  { "kind": "call", "before": { "status": 201, "json": {} }, "after": { "status": 201, "json": {} } },
  { "kind": "same", "match": true, "diff": null },
  { "kind": "pipeline", "file": ".github/workflows/test.yml", "before": null, "after": "file text" },
  { "kind": "recipe", "file": "Dockerfile", "before": null, "after": "file text" },
  { "kind": "scenario", "before": { "steps": [["Title", "note"]], "outcome": { "big": "$98", "small": "charged twice", "tone": "bad" } },
    "after": { "steps": [["Title", "note", "watch"]], "outcome": { "big": "$49", "small": "charged once", "tone": "good" } } }
] }
```

(The POC keys captures by kind; v1 uses this per-show array so a card can have two screens or two calls.)
Screenshots are 466 px wide CSS at 2x. `rects` are in CSS px of the captured page.

What capture writes, exactly (`src/capture/index.ts`, type `Captures`):
- The top level is `{ "base": "<sha>", "shows": [...], "warnings"?: [...] }`. A show that could not be
  captured is `null` with a warning (no browser for a screen, a scenario without `do`/`then`, a page neither
  version has). Never fake it: the renderer skips a `null` show.
- screen: `before`/`after` are PNG file names in `.storydiff/` (466×252 CSS px, so 932×504). A page the old
  version answers with 404/410 is `before: null` (new); the other way round is `after: null` (removed). `rects`
  are measured on the after page, one per `pin screen` selector in the spec (`page` is the whole viewport).
- call: `{ status, json }`, plus `text` when the reply is not JSON. Lists stay lists.
- same: `diff` is `null` when they match, else `[{ "at": "$.body[0].tags", "before"?: …, "after"?: … }]`
  (a missing side means the field is not there). Calls compare status and body; screens compare a snapshot
  of the visible page (tag, box, own text). Ids and times are masked first.
- scenario: `steps` is `[[title, note]]` per `do` line; the outcome tone is `good`/`bad` against `want`,
  `watch` without one.
- Old `captures.json` and PNGs are deleted at the start of a run, so a failed run leaves no stale pictures.

### Language additions for capture (core: please add these to `src/spec`)

Capture reads them with its own small reader (`src/capture/plan.ts`) until `src/spec` parses them. Today
`spec.js` rejects `run` and `setup` as "unknown line", so `check` and `render` need these before a spec with
captures can go through the whole flow. Parsed shape in brackets.

```
run "node server.js" port 3000 env LINKBOX_DB=:memory: K="two words"   [doc.run = { cmd, port, env }]
setup POST /api/links {"url":"https://nodejs.org","tags":["dev"]}       [doc.setup = [{ method, path, body }]]
show same "Save a link" POST /api/links {"url":"x"}                     [same may carry a JSON body]
show scenario "Stripe sends the same event twice"
    do   POST /webhooks {"id":"evt_9","amount":49} "Stripe sends" "{id} · ${amount}"   [show.steps]
    do   POST /webhooks {"id":"evt_9","amount":49} "…and again"                       (note defaults to {@status})
    then GET /charges "${total}" "charged {count} times" want "$49"                    [show.then]
```

- `run`: one per spec. Capture sets `PORT` to a free port for each version, so the app must read `PORT`;
  `port N` is the app's own default, only used to say "something answers on N, does the app read PORT?".
  `PORT` in `env` is an error. Env values never reach the console.
- `setup`: sent to both versions, in order, after both answer and before the first show.
- `do`/`then`: only indented under `show scenario`. Templates: `{field.path}` from the JSON reply,
  `{@status}`, `{@ms}`, `{@s}`, `{@count}` (list length). A missing field shows `?` and warns.
- Tokenizer fix: read `{json}` to its matching bracket. `spec.js`'s greedy `\{.*\}` swallows a later quote
  that contains `}` (e.g. a `do` note `"{id}"`).

### Running capture

`storydiff capture [--base REF] [--spec FILE] [--out DIR] [--timeout SEC]` (entry: `src/capture/cli.ts`,
`main(argv)`; core's CLI dispatches to it). The base defaults to the merge-base with `origin/HEAD`, `main` or
`master`. The base is checked out detached in `<real temp dir>/storydiff-base-*/<repo>`, with the head's
`node_modules` symlinked in. The after version is the working tree as it is. Both apps run in their own
process groups (so `npm start` children die too) and are stopped, and the worktree removed, on success,
on any error, and on Ctrl-C/SIGTERM (exit 130/143). Tests: `node --test 'test/capture/*.test.ts'`.

`.storydiff/report.json` (written by `check`):
`{ "oldPass": 3, "newTests": 6, "regressed": [], "claims": 29, "failed": 0, "checks": [{ "ref": "...", "kind": "proof|said", "ok": true, "why": "...", "at": "03:11" }] }`

## Modules and owners (built in parallel, one branch each)

1. **core** (`src/spec`, `src/render`, `src/check`, `src/cli`): TypeScript port of spec.js, render.js and
   verify.js with tests from the four fixtures; the `storydiff` CLI: `check`, `render` (`--html`, `--png`,
   `--md` for a PR comment with a count line, the list and a Mermaid fallback), `view` (opens the card),
   `publish` (puts the spec in the PR description as a fenced ```storydiff block and posts the comment via
   `gh`). `render` and `check` read `.storydiff/captures.json` and `.storydiff/report.json`.
2. **capture** (`src/capture`): `storydiff capture --base <ref>`: checks out base in a temp worktree, starts
   both versions with the spec's `run` line (PORT env), runs `setup` calls, captures each `show` (screen via
   `shot`, call via fetch, same by comparing both captures with times and ids ignored, pipeline/recipe by
   reading the file at each version, scenario by running its requests in order and capturing the outcome),
   writes `.storydiff/captures.json` + PNGs. Language additions it needs (`run`, `setup`, scenario
   `do`/`then` lines) go in a short PR to `src/spec` coordinated with core.
3. **ship** (`plugin/`, `action/`, `docs/`, README): the Claude Code plugin (a skill built from
   `poc/storydiff-guide.md` updated to v0.3, and a `/storydiff` command that writes the handover, runs
   `storydiff capture`, `check` and `render`, fixes failing lines and opens the card); an `AGENTS.md`
   snippet for other agents; a GitHub Action (composite) that on each PR push re-runs `check` (code and
   test proofs; quotes are marked "checked on the author's machine"), renders the card PNG, stores it on
   an orphan `storydiff-cards` branch and posts one sticky comment linking the PNG plus the Markdown body;
   install docs and a README with the 30-second pitch.

Distribution: npm package `storydiff` (CLI, Node 22+), the plugin installable from this repo's
marketplace manifest, the Action as `uses: pulkitnagpal/storydiff@v1`.

## Done for v1

On a fresh repo: install the plugin, make a change with Claude Code, run `/storydiff`, and the PR gets a
card that matches the canvas, with every claim checked and a failing status when one is not.
