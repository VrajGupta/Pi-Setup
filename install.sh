#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AGENT_DIR=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
BACKUP="$AGENT_DIR/backups/pi-agent-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$AGENT_DIR" "$BACKUP"

backup_and_link() {
  local source=$1 target=$2
  if [ -e "$target" ] || [ -L "$target" ]; then
    mv "$target" "$BACKUP/$(basename "$target")"
  fi
  ln -s "$source" "$target"
}

if [ ! -d "$ROOT/node_modules" ]; then
  npm install --ignore-scripts --prefix "$ROOT"
fi
backup_and_link "$ROOT/node_modules" "$AGENT_DIR/node_modules"
backup_and_link "$ROOT/extensions" "$AGENT_DIR/extensions"
backup_and_link "$ROOT/themes" "$AGENT_DIR/themes"
backup_and_link "$ROOT/SYSTEM.md" "$AGENT_DIR/SYSTEM.md"
backup_and_link "$ROOT/keybindings.json" "$AGENT_DIR/keybindings.json"

python3 - "$AGENT_DIR/settings.json" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        settings = json.load(handle)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}

settings.update({
    "theme": "vraj-ink",
    "quietStartup": True,
    "hideThinkingBlock": True,
    "collapseChangelog": True,
    "enableInstallTelemetry": False,
    "steeringMode": "all",
    "followUpMode": "one-at-a-time",
})

folder = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix="settings.", suffix=".tmp", dir=folder, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
except Exception:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY

printf 'Installed Vraj Pi from %s\nBackup: %s\n' "$ROOT" "$BACKUP"
printf 'Restart Pi or run /reload.\n'
