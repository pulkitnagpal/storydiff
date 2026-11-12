# Core notes for the capture and ship sessions

Core owns `src/spec`, `src/render`, `src/check`, `src/cli`, `src/shot` and `src/index.ts`, on `main` in the main checkout.
This file lists what you can build on and every grammar change, newest last.

## Package API (`src/index.ts`)

- `parse(src: string): Doc` throws `SpecError` (`.line` is 1-based). The types are in `src/spec/types.ts`.
- The contract types are in `src/render/types.ts`:
  - `Captures = { shows: (ShowCapture | null)[] }` is one entry per `show` line, in order. `null` means not captured, and the card leaves that show out.
  - `Report` is `.storydiff/report.json`. `failed` counts the claims that do not hold up, and `regressed` lists the old tests that now fail.
- Card rendering:
  - `render(doc, captures, report, { warn })` returns the card `<div>`, and `renderPage(...)` returns a full HTML page. A show with no capture is left out and reported through `warn`.
  - `loadCaptures(dir)` reads `dir/captures.json` and turns screenshot paths (relative to `dir`) into data URIs.
  - `loadReport(dir, doc?)` reads `dir/report.json`. When there is no file, it gives the "not checked yet" report.
- `Report.sessionLength` ("2 h") shows in the header. Check fills it in from the session log.
- `test/canvas.test.ts` keeps every card equal to its canvas board. `node --experimental-strip-types scripts/compare.ts` writes card and board screenshots to `test/out/`.
- Checker:
  - `check({ repo, spec, base?, session?, testCmd?, noTests? }): Promise<Report>`. The base defaults to the merge-base with origin/HEAD, then main, then master. Tests come from TAP output, defaulting to `node --test --test-reporter=tap`. They run on head and on a `git archive` copy of base, with `node_modules` symlinked in. `session: null` gives every quote `ok: null` ("no session log on this machine").
  - In CI, the Action can run `check` with `session: null` and take the quote results from the author's report, which sits in the PR body. That makes `failed` count every quote it can't check there.
  - `findSession(repo)` returns the newest `.jsonl` in `~/.claude/projects/<repo path, non-alphanumerics as ->`.
- PR comment and PR body:
  - `renderMarkdown(doc, report, { imageUrl?, viewUrl? })` builds the sticky comment body. It starts with `MARKER` (`<!-- storydiff:card -->`), then the verdict line, asked and did, failing claims, the numbered list with quotes, and the Mermaid map under `<details>`.
  - `upsertBlock(body, spec, report)` and `extractSpec(body) -> { spec, report } | null` handle the PR description block. It sits between `<!-- storydiff:start -->` and `<!-- storydiff:end -->`: a fenced storydiff block plus `<!-- storydiff-report {json} -->`. The Action reads the author's quote results from there.
  - `Report.quotesCheckedAt` ("the author's machine at abc1234") is printed under the comment. `publish` sets it.
- CLI (`bin/storydiff.js`, built with `npm run build`; from source, `node --experimental-strip-types src/cli/index.ts`):
  - `storydiff check [--base REF] [--session ID|FILE|none] [--test-cmd CMD] [--no-tests]` writes `.storydiff/report.json`. It exits 1 when a claim fails or an old test regresses, and 2 on a spec error.
  - `storydiff render [--html F] [--png F] [--md F] [--image-url U] [--view-url U]`. The default is `--html .storydiff/card.html`. `--png` renders at 1440 px wide, 2x, full height.
  - `storydiff view` renders and opens the card. `STORYDIFF_NO_OPEN=1` only writes it.
  - `storydiff publish [--pr N] [--image-url U] [--view-url U] [--dry-run]` goes through `gh`: it edits the PR body and creates or updates the one comment.
  - Common to all: `--spec FILE`. The default is `handover.storydiff` at the git root.
- `capture` isn't a core command. The capture session adds it to `src/cli/index.ts`, or tells me the entry point to wire in.
- `src/shot` (headless Chromium over CDP) exports `findBrowser()`, `screenshot(url, out, opts)` and `measure(url, out, { width, height, selectors }) -> Rect[]`. Capture should import `measure` from there rather than keep a second copy.

## Grammar changes (v0.3 +)

1. **Box notes.** On a map line, a second quote is a small note under the label: `code server "server.js" "server + 4 routes"`. Under a mark that points at a box, `now "server only"` sets the note shown in the after map. This gives `Node.note` and `Node.noteAfter`.
2. **`ships-with "repo#n", ...`** is a header line naming PRs that must ship with this one (`Doc.shipsWith`). The card shows it as a header chip.
3. **A render rule, not grammar:** a gone arrow (`- a -> b`) draws its source box `a` as changed on the after map, as the canvas does for Receive and server.js.

## v1 additions (Tasks 8 and 9 and the final review), at commit b9c17eb and later

**Grammar.** Each parsed shape is in `src/spec/types.ts`, and the full list is in the comment at the top of `src/spec/parse.ts`.
- `run "cmd" [port N] [env K=V K="two words"]` gives `doc.run`. `PORT` in env is an error.
- `setup METHOD /path [{json}]` gives `doc.setup`. `run-tests "cmd"` gives `doc.runTests`.
- `show same "label" METHOD /path {json}` gives `show.body`. `show terminal "cmd" ["label"]` is a new show.
- Under `show scenario`: `do METHOD /path [{json}] "title" ["note"]` gives `show.steps`, and `then METHOD /path [{json}] "big" ["small"] [want "x"]` gives `show.then`.
- JSON is read to its matching bracket.
- `x` marks something that breaks for callers. It is listed first, and `x -> y` is still an arrow.
- `smaller "line" files a, b` gives `doc.smaller`. Those files count as covered.
- `ask "…" [from "who"] [in "#n"]` can repeat: `doc.asks` holds them all, and `doc.ask` is the first.
- `by "Maya"` with no `with` gives `agent: ''`.
- A box can end in `in "repo#n"`, giving `Node.repo`.
- `pin before <place> "…"` sets `Pin.side`, and there is a new place, `line`, for terminals.
- `chapter N` sections are split up: `doc.rest` holds the later chapters.
- The 7-item cap counts only new, changed, gone and kept. A map holds at most 10 boxes.

**Captures, for the capture session.**
- Every side can be `null`: `before: null` is new and `after: null` is removed. The card draws both forms for every kind.
- `typed: true` on any capture stamps that picture "illustrative".
- Terminal: `{ kind, cmd?, before: { exit, lines, total, timedOut? }, after }`. The card shows the last 12 lines.
- Please add `rectsBefore` to screen captures: the rects of `pin before screen` selectors, measured on the before page. Until then those pins are not drawn.
- `same.diff` as `[{ at, before?, after? }]`: the card shows the first one.
- A screenshot file named in `captures.json` but missing on disk turns that show into `null`, with a warning.

**Report: meanings changed, please read this, ship session.**
- `failed` now counts only `ok: false`. Claims that could not be checked here (`ok: null`, such as quotes in CI) go in `unverified`, shown as a grey "? N not checked here", not red.
- `regressed` means passed on base and fails on head. Old tests that did not run on head (renamed or deleted) go in `missing`.
- `oldPass: null` plus `testsLine` means the tests could not be run or read. The card then shows no ✓ anywhere.
- New fields:
  - `coverage: { files, covered, uncovered[] }`;
  - `editedOld[]`;
  - `specHash`, the first 16 hex characters of the SHA-256 of the spec;
  - `dirty`;
  - `unverified`;
  - `missing[]`.
- `storydiff check` exits 1 on `failed > 0`, any `regressed`, or any `coverage.uncovered`. The Action's status should use the same rule.
- `loadReport(dir, doc, { specText })` returns the "not checked yet" report when `specHash` doesn't match the spec, so a stale green never shows.
- `quotesCheckedAt` is set by `publish` only when the report has a session.

**CLI.**
- `storydiff capture …` is dispatched to `src/capture/cli.ts`'s `main(argv)`, through a dynamic import found next to the CLI. Once capture is merged, change it to a static import so esbuild bundles it into `dist/cli.js`.
- `bin/storydiff.js` calls `run()` from `dist/cli.js`, and the `STORYDIFF_BIN` env var is gone.
- `.storydiff/` sits next to the spec, which is the repo root in the normal case.
- `render` writes one card per chapter: `card.html` and `card-2.html`, or `--png card.png` and `card-2.png`. The Markdown covers every chapter.
- `prepare` runs the build, so `npm install -g github:pulkitnagpal/storydiff` and clone-then-`npm install` both work. There are no runtime dependencies and no postinstall step.
- `npm test` also runs `action/test/*.test.mjs` once the Action lands, and `test/**/*.test.ts` already covers `test/capture`.
