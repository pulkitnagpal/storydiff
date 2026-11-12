#!/bin/zsh
# Renders the Storydiff 1.0 launch film: 1920×1080, 30 fps, no sound.
#   1. stage.ts gathers what the film draws from (scripts/video/assets/manifest.json lists it): a real capture in
#      scripts/video/assets/ when there is one, a stand-in otherwise; cuts each card into the pieces the whiteboard draws.
#   2. compose.swift draws every frame; ffmpeg encodes. It also writes the logo files and the README poster.
#
#   scripts/video/make-film.sh [out.mp4]          (default dist/storydiff-v1.mp4)
#   STILLS=12,40 scripts/video/make-film.sh       PNG stills at those seconds, in dist/film/stills
set -euo pipefail
cd "${0:A:h}/../.."
OUT="${1:-dist/storydiff-v1.mp4}"
B=dist/film/build
mkdir -p .build/video "$(dirname "$OUT")" docs/img
node --experimental-strip-types --no-warnings scripts/video/stage.ts
swiftc -O scripts/video/compose.swift -o .build/video/compose
FILM_VERIFY=1 .build/video/compose $B
FILM_LOGO=docs/img .build/video/compose $B
if [[ -n "${STILLS:-}" ]]; then
  mkdir -p dist/film/stills
  FILM_ONLY="$STILLS" FILM_STILLS=dist/film/stills .build/video/compose $B
  echo "wrote stills to dist/film/stills"; exit 0
fi
FILM_ONLY=57.8 FILM_STILLS=docs/img FILM_NAME=film-poster.png .build/video/compose $B
.build/video/compose $B | ffmpeg -v error -y -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i - \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
echo "wrote $OUT"
