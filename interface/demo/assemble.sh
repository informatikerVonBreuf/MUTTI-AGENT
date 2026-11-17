#!/usr/bin/env bash
# Montage : carton + chapitre pour les six chapitres, cartons de résultats après les chapitres 5 et 6, carton de fin.
# ffmpeg tourne dans Docker, sans installation locale.
# Usage, depuis interface/ et dans Git Bash : bash demo/assemble.sh demo/build/gemini demo/folio-demo.mp4
set -euo pipefail
export MSYS_NO_PATHCONV=1
SRC="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/build/work"; rm -rf "$WORK"; mkdir -p "$WORK"
cp "$HERE"/build/cards/*.png "$WORK"/; cp "$SRC"/chapitre-*.webm "$WORK"/
# Docker Desktop sous Windows attend un chemin Windows pour le volume.
MOUNT="$(cd "$WORK" && (pwd -W 2>/dev/null || pwd))"
IMAGE="jrottenberg/ffmpeg:7.1-alpine"
ENC=(-c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -r 25)
ff() { docker run --rm -v "$MOUNT:/w" -w /w "$IMAGE" -hide_banner -loglevel error -y "$@"; }
list=""
segment() { list="$list file '$1'"$'\n'; }
card() { ff -loop 1 -t "$2" -i "carton-$1.png" -vf "scale=1280:720,fade=t=in:st=0:d=0.4,fade=t=out:st=$(awk "BEGIN{print $2-0.4}"):d=0.4" "${ENC[@]}" "c$1.mp4"; segment "c$1.mp4"; }
card 00 5
for n in 1 2 3 4 5 6; do
  card "0$n" 3.5
  ff -i "chapitre-$n.webm" -vf "scale=1280:720,fps=25" "${ENC[@]}" -an "v0$n.mp4"; segment "v0$n.mp4"
  if [ "$n" = 5 ]; then card 05b 8; fi
  if [ "$n" = 6 ]; then card 06b 9; fi
done
card 99 4
printf "%s" "$list" > "$WORK/liste.txt"
ff -f concat -safe 0 -i liste.txt -c copy -movflags +faststart final.mp4
cp "$WORK/final.mp4" "$OUT"
docker run --rm -v "$MOUNT:/w" --entrypoint ffprobe "$IMAGE" -v error -show_entries format=duration -of csv=p=0 /w/final.mp4
