#!/bin/zsh
# Renders the Storydiff v1 launch film: 1920×1080, 30 fps, no sound.
#   1. stage.ts fills the assets folder (scripts/video/manifest.json lists every file). It keeps any file you dropped in
#      yourself, so a real capture from a v1 run replaces its stand-in just by having the same name.
#   2. compose.swift draws every frame from those assets; ffmpeg encodes.
#
#   scripts/video/make-film.sh [assets dir] [out.mp4]          (defaults: dist/film/assets, dist/storydiff-v1.mp4)
#   STILLS=12,40 scripts/video/make-film.sh                    (writes PNG stills at those seconds to dist/film/stills)
set -euo pipefail
cd "${0:A:h}/../.."
A="${1:-dist/film/assets}"; OUT="${2:-dist/storydiff-v1.mp4}"
mkdir -p .build/video "$(dirname "$OUT")"
node --experimental-strip-types --no-warnings scripts/video/stage.ts "$A"
swiftc -O scripts/video/compose.swift -o .build/video/compose
if [[ -n "${STILLS:-}" ]]; then
  mkdir -p dist/film/stills
  FILM_ONLY="$STILLS" FILM_STILLS=dist/film/stills .build/video/compose "$A"
  echo "wrote stills to dist/film/stills"; exit 0
fi
.build/video/compose "$A" | ffmpeg -v error -y -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i - \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
echo "wrote $OUT"
