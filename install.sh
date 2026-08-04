#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AGENT_DIR=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
mkdir -p "$AGENT_DIR"
AGENT_DIR=$(cd -P "$AGENT_DIR" && pwd)
BACKUPS="$AGENT_DIR/backups"
BACKUP="$BACKUPS/pi-agent-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUPS"
suffix=0
while [ -e "$BACKUP" ]; do
  suffix=$((suffix + 1))
  BACKUP="$BACKUPS/pi-agent-$(date +%Y%m%d-%H%M%S)-$$-$suffix"
done

backup_and_link() {
  local source=$1 target=$2
  if [ "$source" = "$target" ]; then
    return
  fi
  local staged="${target}.pi-agent-link.$$.$RANDOM"
  ln -s "$source" "$staged"
  if [ -e "$target" ] || [ -L "$target" ]; then
    mv "$target" "$BACKUP/$(basename "$target")"
  fi
  mv "$staged" "$target"
}

python3 - "$AGENT_DIR/settings.json" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        settings = json.load(handle)
except FileNotFoundError:
    settings = {}
except json.JSONDecodeError:
    print(f"Refusing to overwrite malformed settings: {path}", file=sys.stderr)
    raise SystemExit(1)

if not isinstance(settings, dict):
    print(f"Refusing to overwrite non-object settings: {path}", file=sys.stderr)
    raise SystemExit(1)

ponytail = "git:github.com/DietrichGebert/ponytail"
packages = settings.get("packages", [])
if not isinstance(packages, list):
    packages = []
settings["packages"] = [
    package for package in packages if isinstance(package, str) and package != ponytail
] + [ponytail]

settings.update({
    "theme": "vraj-ink",
    "defaultProvider": "openai-codex",
    "defaultModel": "gpt-5.6-sol",
    "defaultThinkingLevel": "high",
    "quietStartup": True,
    "hideThinkingBlock": True,
    "collapseChangelog": True,
    "enableInstallTelemetry": False,
    "steeringMode": "one-at-a-time",
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

mkdir "$BACKUP"

if [ ! -d "$ROOT/node_modules" ]; then
  npm install --ignore-scripts --prefix "$ROOT"
fi
backup_and_link "$ROOT/node_modules" "$AGENT_DIR/node_modules"
backup_and_link "$ROOT/extensions" "$AGENT_DIR/extensions"
backup_and_link "$ROOT/skills" "$AGENT_DIR/skills"
backup_and_link "$ROOT/themes" "$AGENT_DIR/themes"
backup_and_link "$ROOT/SYSTEM.md" "$AGENT_DIR/SYSTEM.md"
backup_and_link "$ROOT/keybindings.json" "$AGENT_DIR/keybindings.json"

printf 'Installed Vraj Pi from %s\nBackup: %s\n' "$ROOT" "$BACKUP"
printf 'Restart Pi or run /reload.\n'
