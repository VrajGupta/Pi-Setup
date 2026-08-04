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

Quit Pi first. Replace the placeholder with the exact backup you listed; rollback restores only the installer-managed `extensions`, `skills`, `themes`, `SYSTEM.md`, `keybindings.json`, and `node_modules` entries that exist in that backup.

```sh
agent_dir="$HOME/.pi/agent"
backup="$agent_dir/backups/pi-agent-<timestamp>-<pid>"
case "$backup" in "$agent_dir"/backups/pi-agent-*) ;; *) echo "Choose a listed backup" >&2; exit 1;; esac
for name in extensions skills themes SYSTEM.md keybindings.json node_modules; do
  [ -e "$backup/$name" ] || continue
  rm -rf "$agent_dir/$name"
  mv "$backup/$name" "$agent_dir/$name"
done
```

```powershell
$agentDir = Join-Path $HOME ".pi\agent"
$backup = Join-Path $agentDir "backups\pi-agent-<timestamp>-<pid>"
if ($backup -notlike "$agentDir\backups\pi-agent-*") { throw "Choose a listed backup" }
foreach ($name in "extensions", "skills", "themes", "SYSTEM.md", "keybindings.json", "node_modules") {
  $saved = Join-Path $backup $name
  $target = Join-Path $agentDir $name
  if (Test-Path -LiteralPath $saved) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath $saved -Destination $target
  }
}
```

This move-based rollback restores those saved files byte-for-byte. It does **not** restore `settings.json`, `.env`, authentication credentials, models (downloads or configuration), sessions, or other Pi state; preserve those separately before installing.

## Push proof

A successful `git push` command alone is not proof. Fetch the branch, then compare the local commit and fetched remote-tracking commit; do not report a push unless the SHAs match.

```sh
branch=$(git branch --show-current)
git fetch origin "$branch"
local=$(git rev-parse HEAD)
remote=$(git rev-parse "origin/$branch")
printf 'local:  %s\nremote: %s\n' "$local" "$remote"
test "$local" = "$remote"
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
