# The launch film

```bash
scripts/video/make-film.sh
```

This writes `dist/storydiff-v1.mp4`: Storydiff 1.0, 1920×1080, 30 fps, about 75 s, light theme, no sound. The same run refreshes the logo files and the README poster in `docs/img/`.

1. `stage.ts` collects everything the film draws from. [`assets/manifest.json`](assets/manifest.json) is the shot list.
   - A real capture in `scripts/video/assets/` is used as is.
   - Anything without a real capture gets a stand-in in `dist/film/stand-ins/`. The stand-ins are made from the Linkbox fixture, the POC cards and real runs of `src/check`.
   - Each card is cut into its pieces in headless Chromium (one transparent PNG per piece), so the whiteboard can draw the real card piece by piece.
2. `compose.swift` draws every frame and ffmpeg encodes them. It never re-creates the product's UI: it only orders, moves and annotates the captures.
   - `FILM_VERIFY=1` puts every card back together from its pieces and diffs it against the flat render. Today under 0.06% of pixels differ, all at the pins' anti-aliased edges.
   - `FILM_LOGO=dir` writes the logo files.
   - `STILLS=12,40 scripts/video/make-film.sh` writes PNG stills at those seconds to `dist/film/stills/`. That's quicker than a full render when checking a change.

The film's own type is Inter, taken from any Inter `.ttf` on the machine (or set `STORYDIFF_INTER`). Handwriting is in Caveat, the card's own hand, rendered by the browser.

## Swapping in real captures

Take the files in the shot list from a real v1 run and save them under the names it gives. A capture's `.json` sidecar holds the rects the camera aims at; each sidecar is optional.

To have the whiteboard draw a real card, also save its HTML (`storydiff render --html`) as `card-<kind>.html`. Capture only the built-in display.

## Beats

| s | Beat | Caption |
|---|---|---|
| 0–10.6 | **Hook.** A dramatised agent PR: +48,213 −9,870 and 2,000 files race up, the Files tab blurs past, the cursor jumps to Approve. Then a freeze, with a red circle round "1 minute". | No human can read this. · So nobody does. It gets approved anyway. · Agents write faster than humans can read. |
| 10.6–15.5 | **Turn.** An eraser clears the board. "diff" is written, "story" in front of it, and they join into the logo with a 1.0 badge. | So we made Storydiff. · Differences, told as a story humans understand. |
| 15.5–26.5 | **Author.** The page flips to Claude Code finishing the work (`claude-session.png`), `/storydiff` typed, the run revealed line by line with each check ticking (`storydiff-run.png`), then `storydiff view` (`card-local.png`). | Maya's agent has just finished the work. · Maya types /storydiff. · It writes the handover, then checks every line. · And draws the card. |
| 26.5–29.2 | **The PR.** The card as the first comment (`pr-comment.png`), circled. | On the PR, it's the first comment. |
| 29.2–53.6 | **Whiteboard.** The tags card drawn and explained: asked, did and the verdict; BEFORE, then AFTER sliding in with each pin circled; underneath; the list, with each number tapped and Maya's words on sticky notes that settle into the card; 2 things to try. | Here's what Maya asked. · What the agent did, and what it checked. · Same screen, before and after. · Each pin is something that changed. · And what changed underneath. · Every change, numbered. · Maya's decisions, in her own words. · Two things I'd try before merging. |
| 53.6–61.9 | **Any PR.** The board pans along the wall, and infra, refactor and big-PR cards are each drawn sped up. | Infra: what runs on every push. · A refactor: proof nothing changed. · A big PR, told in chapters. |
| 61.9–68.5 | **Trust.** An eraser to the planted quote. The checker says "not in the session" and the status check turns red (`check-red.png`). | Plant a quote Maya never typed… · …and the check turns red. |
| 68.5–74.7 | **End card.** A circular light wipe to "Storydiff 1.0", the tagline, "Asked · Changed · Might break · All checked", "Open source · Claude Code plugin · GitHub Action" and the URL. | |
