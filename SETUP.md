# Setup

Clone the repository anywhere, then install it into Pi:

```sh
./install.sh
```

On Windows PowerShell:

```powershell
.\install.ps1
```

Both entry points run the same Node installer. It links resources when possible and copies them when Windows or filesystem policy rejects symlinks.

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
