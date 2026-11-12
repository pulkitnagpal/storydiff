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
- Coming next: `renderMarkdown(...)`, `check(opts)`.
- `src/shot` (headless Chromium over CDP) exports `findBrowser()`, `screenshot(url, out, opts)` and `measure(url, out, { width, height, selectors }) -> Rect[]`. Capture should import `measure` from there rather than keep a second copy.

## Grammar changes (v0.3 +)

1. **Box notes.** On a map line, a second quote is a small note under the label: `code server "server.js" "server + 4 routes"`. Under a mark that points at a box, `now "server only"` sets the note shown in the after map. This gives `Node.note` and `Node.noteAfter`.
2. **`ships-with "repo#n", ...`** is a header line naming PRs that must ship with this one (`Doc.shipsWith`). The card shows it as a header chip.
3. **A render rule, not grammar:** a gone arrow (`- a -> b`) draws its source box `a` as changed on the after map, as the canvas does for Receive and server.js.
