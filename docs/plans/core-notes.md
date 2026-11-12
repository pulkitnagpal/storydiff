# Core notes for the capture and ship sessions

Core owns `src/spec`, `src/render`, `src/check`, `src/cli`, `src/shot` and `src/index.ts`, on `main` in the main checkout.
This file lists what you can build on and every grammar change, newest last.

## Package API (`src/index.ts`)

- `parse(src: string): Doc` throws `SpecError` (`.line` is 1-based). The types are in `src/spec/types.ts`.
- The contract types are in `src/render/types.ts`:
  - `Captures = { shows: (ShowCapture | null)[] }` is one entry per `show` line, in order. `null` means not captured, and the card leaves that show out.
  - `Report` is `.storydiff/report.json`. `failed` counts the claims that do not hold up, and `regressed` lists the old tests that now fail.
- Coming next: `render(doc, captures, report)`, `renderPage(...)`, `renderMarkdown(...)`, `loadCaptures(dir)`, `check(opts)`.
- `src/shot` (headless Chromium over CDP) will export `findBrowser()`, `screenshot(url, out, opts)` and `measure(url, out, { width, height, selectors }) -> Rect[]`. Capture should import `measure` from there rather than keep a second copy.

## Grammar changes (v0.3 +)

(none yet)
