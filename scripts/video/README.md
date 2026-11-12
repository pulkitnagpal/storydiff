# The launch film

```bash
scripts/video/make-film.sh
```

This writes `dist/storydiff-v1.mp4` for X: Storydiff 1.0, 59 s, 1920×1080 at 60 fps. Each frame is drawn at 2x and scaled down. It's H.264 High, yuv420p, tagged BT.709, CRF 16 (18 if it would pass 40 MB), with faststart and no audio. Frame 0 is already the diff wall. Captions are 46 px, stay clear of the bottom 8% where X's controls sit, and each is on screen for at least 2.4 s. The end card holds for 3 s. The same run writes `dist/storydiff-v1-poster.png` (before and after, pins circled), copies it to `docs/img/film-poster.png`, and refreshes the logo files in `docs/img/`.

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

The contrast is the story: GitHub's diff wall first, then the same PR as one calm, hand-drawn card. Most of the runtime goes to that card.

| s | Beat | Caption |
|---|---|---|
| 0–9 | **Before.** A dramatised agent PR: +48,213 −9,870 and 2,000 files race up, the Files tab blurs past, the cursor jumps to Approve. A freeze, with a red circle round "1 minute". | No human can read this. · So it gets approved anyway. |
| 9–13.6 | **Turn.** An eraser clears the board. "diff" is written, "story" in front of it, and they join into the logo with a 1.0 badge. | Differences, told as a story humans understand. |
| 13.6–16.6 | **Author.** One Claude Code frame (`claude-session.png`), then `/storydiff` is typed. | Done? Type /storydiff. |
| 16.6–19.3 | **After.** The PR, with the card as its first comment (`pr-comment.png`), circled. | It's the first comment on the PR. |
| 19.3–43.7 | **The card, explained.** The tags card is drawn on the whiteboard: what was asked, and three quiet ticks beside the verdict (code · tests · your chat). Then BEFORE, AFTER sliding in with each pin circled, the list with Maya's words on sticky notes that settle into the card, and the 2 things to try. | Here's what Maya asked. · Every claim, checked. · Same screen, before and after. · Maya's calls, in her own words. · Two things I'd try before merging. |
| 43.7–52 | **Any PR.** The board pans along the wall; infra, refactor and big-PR cards are each drawn sped up. | Any kind of PR. |
| 52–59 | **End card.** A circular light wipe to "Storydiff 1.0", the tagline, "Asked · Changed · Might break · All checked", "Open source · Claude Code plugin · GitHub Action" and the URL. | |
