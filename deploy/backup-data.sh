#!/usr/bin/env bash
# Backup for the Excalidraw data dir (drawings, .dashboard.json, .thumbnails).
#
# Runs on the homelab host (docker-i5). The data dir is plain files, so a
# plain rsync + tarball is all that's needed. Complements — does not replace —
# the Restic coverage (see DASHBOARD_PLAN.md "Homelab-repo housekeeping").
#
# Install (as the user that owns the stack):
#   crontab -e
#   30 3 * * * /opt/stacks/excalidraw/backup-data.sh >> /var/log/excalidraw-backup.log 2>&1
set -euo pipefail

SRC="${1:-/opt/stacks/excalidraw/data}"
DEST="${2:-/opt/backups/excalidraw}"
KEEP="${KEEP:-14}"

STAMP="$(date +%F)"
mkdir -p "$DEST"

# mirror (fast incremental) + dated tarball (point-in-time restore)
rsync -a --delete "$SRC/" "$DEST/current/"
tar -czf "$DEST/excalidraw-data-$STAMP.tar.gz" -C "$DEST" current

# retention: keep the newest $KEEP tarballs
ls -1t "$DEST"/excalidraw-data-*.tar.gz | tail -n "+$((KEEP + 1))" | xargs -r rm --

echo "$(date -Is) backed up $SRC -> $DEST (kept $KEEP tarballs)"
