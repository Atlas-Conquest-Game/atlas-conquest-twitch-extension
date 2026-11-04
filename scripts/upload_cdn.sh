#!/usr/bin/env bash
# Upload cdn-out/twitch (scripts/build_cdn.py) to the card host:
# R2 bucket atlas-conquest-website-storage, served at https://cards.atlas-conquest.com/twitch/
#
# Art first, then the indexes, so an index never names a file that is not there yet.
# Art names carry a content hash, so they are cached forever; the JSON is what
# changes, so it is cached for five minutes. Old art is left in place: a viewer
# holding a five-minute-old index can still load what it names.
#
# Needs an rclone remote for the bucket (see the website repo's upload README);
# R2_REMOTE overrides the default "r2:" remote name.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${R2_REMOTE:-r2:}atlas-conquest-website-storage/twitch"

rclone copy cdn-out/twitch "$DEST" --include "*.webp" \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --transfers 16 --stats-one-line --stats 15s

rclone copy cdn-out/twitch "$DEST" --include "*.json" --ignore-times \
  --header-upload "Cache-Control: public, max-age=300" \
  --transfers 16
