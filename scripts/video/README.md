# The launch film

```bash
scripts/video/make-film.sh
```

This writes `dist/storydiff-v1.mp4`: 1920×1080, 30 fps, about 72 s, light theme, no sound.

- `stage.ts` fills `dist/film/assets/` with every file the film draws from. [`manifest.json`](manifest.json) lists each file, what it is, how its stand-in is made, and what the real capture should be.
- `compose.swift` draws every frame from those files, adding only the stage: camera, focus, pins popping in, typing, captions and transitions. ffmpeg encodes the frames.
- `STILLS=12,40 scripts/video/make-film.sh` writes PNG stills at those seconds to `dist/film/stills/`, which is quicker than a full render when you're checking a change.

## Stand-ins and real captures

Every stand-in comes from the repo: the Linkbox fixture (`test/fixtures/linkbox`), the four POC cards (`poc/v3/out`) and the real checker (`src/check`). The checker runs on the `pr-tags` branch with Maya's scrubbed session log, once as written and once with a planted quote she never typed.

To use a capture from a real v1 run, drop the file into `dist/film/assets/` under the name the manifest gives it. `stage.ts` only rewrites files listed in `assets/.stand-ins` (the ones it made), so your file stays. To get a stand-in back, delete the file.

Capture only the built-in display, never the external one.

## Beats

| s | Beat | Drawn from |
|---|---|---|
| 0–4.6 | Logo, "Review the story, not the diff." | the card header's mark, redrawn |
| 4.6–12.8 | A diff scrolling past, with its +/− counter climbing | `diff.patch`, `diff.json` |
| 12.8–31 | Claude Code finishes, `/storydiff`, the handover writes itself, then the checks tick in | `session.json`, `handover.storydiff`, `report.json` |
| 31–51 | The PR, with the card as the first comment: asked → did, before/after with pins, the list, 2 things to try | `pr.png`, `pr.json`, `card-tags-bare.png`, `card-tags.json` |
| 51–58.6 | Four cards: UI + API, infra, refactor, a big PR in chapters | `card-{tags,infra,refactor,big}.png/.json` |
| 58.6–66 | A planted quote turns red: "not in the session" | `handover-fake.storydiff`, `report-fake.json` |
| 66–72.5 | End card | text only |
