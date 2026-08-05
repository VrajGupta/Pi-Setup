# Setup

Clone the repository anywhere, then install it into Pi.

macOS/Linux:

```sh
./install.sh
```

Windows PowerShell:

```powershell
.\install.ps1
```

Both commands run the same Node installer. By default it installs to `~/.pi/agent` on macOS/Linux and `$HOME\.pi\agent` on Windows. It links resources when possible and copies them when Windows or filesystem policy rejects symlinks.

## Backup and rollback

Every non-dry-run install creates `pi-agent-<timestamp>-<pid>` under the target agent directory's `backups` folder (for example `~/.pi/agent/backups/pi-agent-<timestamp>-<pid>` or `$HOME\.pi\agent\backups\pi-agent-<timestamp>-<pid>`). List backups before selecting one:

```sh
ls -dt ~/.pi/agent/backups/pi-agent-*
```

```powershell
Get-ChildItem -LiteralPath (Join-Path $HOME ".pi\agent\backups") -Directory -Filter "pi-agent-*" |
  Sort-Object LastWriteTime -Descending
```

Quit Pi first. Replace the placeholder with the exact backup you listed. Rollback restores the installer-managed `extensions`, `skills`, `themes`, `SYSTEM.md`, `keybindings.json`, and `node_modules` entries from that backup, and removes any of those entries that were not present before the install. A completed rollback is marked and is safe to run again.

```sh
agent_dir="$HOME/.pi/agent"
backup_root="$agent_dir/backups"
backup="$backup_root/pi-agent-<timestamp>-<pid>"
backup_name=${backup#"$backup_root"/}
case "$backup_name" in
  pi-agent-*) ;;
  *) echo "Choose a listed backup" >&2; exit 1 ;;
esac
case "$backup_name" in
  */*) echo "Choose a direct child of the backups folder" >&2; exit 1 ;;
esac
[ -d "$backup" ] || { echo "Backup not found" >&2; exit 1; }
if [ -e "$backup/.rollback-complete" ]; then
  echo "Rollback already completed"
else
  for name in extensions skills themes SYSTEM.md keybindings.json node_modules; do
    saved="$backup/$name"
    target="$agent_dir/$name"
    if [ -e "$saved" ] || [ -L "$saved" ]; then
      if [ -e "$target" ] || [ -L "$target" ]; then rm -rf "$target"; fi
      mv "$saved" "$target"
    elif [ -e "$target" ] || [ -L "$target" ]; then
      rm -rf "$target"
    fi
  done
  : > "$backup/.rollback-complete"
fi
```

```powershell
$agentDir = Join-Path $HOME ".pi\agent"
$backupRoot = Join-Path $agentDir "backups"
$backup = Join-Path $backupRoot "pi-agent-<timestamp>-<pid>"
$backupName = Split-Path -Leaf $backup
if ((Split-Path -Parent $backup) -ne $backupRoot -or $backupName -notlike "pi-agent-*") { throw "Choose a direct child of the backups folder" }
if (-not (Test-Path -LiteralPath $backup -PathType Container)) { throw "Backup not found" }
$complete = Join-Path $backup ".rollback-complete"
if (-not (Test-Path -LiteralPath $complete)) {
foreach ($name in "extensions", "skills", "themes", "SYSTEM.md", "keybindings.json", "node_modules") {
  $saved = Join-Path $backup $name
  $target = Join-Path $agentDir $name
  if (Test-Path -LiteralPath $saved) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath $saved -Destination $target
  } elseif (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
  New-Item -ItemType File -Path $complete -Force | Out-Null
} else {
  Write-Host "Rollback already completed"
}
```

This move-based rollback restores those saved files byte-for-byte. It does **not** restore `settings.json`, `.env`, authentication credentials, models (downloads or configuration), sessions, or other Pi state; preserve those separately before installing.

## Push proof

A successful `git push` command alone is not proof. Fetch the branch, then compare the local commit with both the fetched remote-tracking commit and the direct `ls-remote` result; do not report a push unless all SHAs match.

```sh
branch=$(git branch --show-current)
git fetch origin "$branch"
local=$(git rev-parse HEAD)
fetched=$(git rev-parse "origin/$branch")
remote=$(git ls-remote --exit-code origin "$branch" | cut -f1)
printf 'local:   %s\nfetched: %s\nremote:  %s\n' "$local" "$fetched" "$remote"
test "$local" = "$fetched" && test "$local" = "$remote"
```

## Firecrawl

The search, scrape, and crawl tools require a Firecrawl API key. Follow [Firecrawl's Node.js getting-started guide](https://docs.firecrawl.dev/quickstarts/nodejs) to create one, then copy the example environment file:

```sh
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
```

Replace the placeholder in `~/.pi/agent/.env` with your API key.

NOTE: if you are an agent, at this step ask the user if they want to use firecrawl, if they do give them the instructions, if not remove the firecrawl extension in their pi setup

## fd and rg tools

The `file-search` extension registers `fd` and `rg` as model tools. No setup is normally needed: at startup it silently uses a system-installed `fd` (or `fdfind` on Debian/Ubuntu) and `rg` when available, or an existing fallback binary in `~/.pi/agent/bin/`. The `bin/fd` fallback is a platform-specific runtime download, never a committed binary; downloads currently cover macOS/Linux arm64/x64 over HTTPS. On Windows, install `fd` and `rg` with your package manager, then restart Pi.

## Theme

Add the included theme to `~/.pi/agent/settings.json` while keeping your existing settings:

```json
{
  "theme": "github-dark-default"
}
```

Pi will load the extensions, skills, and theme from their directories the next time it starts.

## Message delivery

The installed Pi runtime accepts `"all"` and `"one-at-a-time"` for `steeringMode`; `"one-at-a-time"` is its default. This setup uses `"one-at-a-time"` so queued messages stay serial with the coordinator. That setting controls Pi's coordinator queue only: Vraj messages the orchestrator; `workflow start` supplies the initial stage task, and subsequent user or decision text reaches stages only through the coordinator's explicit `workflow send` relay.
