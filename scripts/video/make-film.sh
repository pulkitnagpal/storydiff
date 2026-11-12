#!/bin/zsh
# Renders the Storydiff 1.0 launch film for X: 1920×1080, 60 fps, H.264 High, BT.709, no audio, under 40 MB.
#   1. stage.ts gathers what the film draws from (scripts/video/assets/manifest.json lists it): a real capture in
#      scripts/video/assets/ when there is one, a stand-in otherwise; cuts each card into the pieces the whiteboard draws.
#   2. compose.swift draws every frame at 2x and scales it down; ffmpeg encodes. It also writes the logo files and posters.
#
#   scripts/video/make-film.sh [out.mp4]          (default dist/storydiff-v1.mp4)
#   STILLS=12,40 scripts/video/make-film.sh       PNG stills at those seconds, in dist/film/stills
#   FILM_FPS=30 scripts/video/make-film.sh        a quicker 30 fps render
set -euo pipefail
cd "${0:A:h}/../.."
OUT="${1:-dist/storydiff-v1.mp4}"
B=dist/film/build
FPS="${FILM_FPS:-60}"
POSTER_AT=31.9
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
# The poster: the strongest frame (before and after, pins circled), without captions.
FILM_NOCAPTIONS=1 FILM_ONLY=$POSTER_AT FILM_STILLS=dist FILM_NAME=storydiff-v1-poster.png .build/video/compose $B
cp dist/storydiff-v1-poster.png docs/img/film-poster.png
encode() {
  FILM_FPS=$FPS .build/video/compose $B | ffmpeg -v error -y -f rawvideo -pix_fmt bgra -s 1920x1080 -r "$FPS" -i - \
    -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
    -c:v libx264 -profile:v high -preset slow -crf "$1" -pix_fmt yuv420p -x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709 \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -an "$OUT"
}
encode 16
# X keeps the quality under 40 MB: if it's over, ease the CRF rather than the frame size.
if (( $(stat -f %z "$OUT") > 40000000 )); then echo "over 40 MB at CRF 16, re-encoding at 18"; encode 18; fi
echo "wrote $OUT ($(( $(stat -f %z "$OUT") / 1000000 )) MB)"
