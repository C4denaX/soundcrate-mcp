<p align="center"><img src="icon.png" width="112" alt="SoundCrate icon"></p>

<h1 align="center">SoundCrate</h1>

<p align="center"><b>Dig through SoundCloud and shape your playlists by talking to your AI assistant.</b></p>

<p align="center">
<a href="https://github.com/C4denaX/soundcrate-mcp/releases/latest"><img src="https://img.shields.io/github/v/release/C4denaX/soundcrate-mcp?label=release" alt="Latest release"></a>
<a href="https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml"><img src="https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
<br><a href="README.es.md">Leer en español</a>
</p>

SoundCrate connects Claude (or any other AI assistant that supports [MCP](https://modelcontextprotocol.io)) to
**your own SoundCloud account**. Ask in plain words and it searches tracks by genre, tags, tempo, duration or upload
date (every result shows its key, so you can ask for compatible ones), finds similar tracks and artists, builds
private playlists and puts them in a DJ-friendly order.

> "Find techno between 128 and 132 BPM uploaded this year and make me a private two-hour playlist in compatible keys."
>
> "Take these three tracks, find related ones that aren't already in my *Warm-up* playlist and suggest ten."
>
> "Analyze my *Peak time* playlist and tell me where the tempo jumps or the keys clash."

It runs on your computer, keeps your credentials in your system's secure storage, and never deletes a playlist.

## What you need

- A **SoundCloud account** with an **Artist Pro** plan. SoundCrate talks to SoundCloud through your own SoundCloud
  "app", and SoundCloud only lets Artist Pro accounts create one.
- One of these:
  - **Claude Desktop** on macOS or Windows. Nothing else to install.
  - **Claude Code, Cowork or another MCP app** (Cursor, VS Code, OpenCode, Codex, Gemini CLI…), plus
    [Node.js](https://nodejs.org) 18 or later. Works on macOS, Windows and Linux.

> [!WARNING]
> **Read SoundCloud's API terms first.** Creating a SoundCloud app means accepting the
> [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use). Section 03 forbids using content obtained through the API (including
> titles, tags and other text) as input to any artificial intelligence technology, and SoundCloud can revoke an
> app's API access without notice. SoundCrate passes that kind of data to your AI assistant, so you use it at your
> own responsibility. The setup page shows this notice in step 1 and suggests the app description *Local AI
> assistant to manage my own playlists* (in Spanish if your browser is in Spanish); describe your app honestly.

## Install

### Claude Desktop (easiest, no technical knowledge needed)

1. **[Download soundcrate.mcpb](https://github.com/C4denaX/soundcrate-mcp/releases/latest/download/soundcrate.mcpb)**.
2. **Double-click** the file (or drag it onto the Claude window) and choose **Install**. If you have SoundCloud Go+,
   switch on **I have SoundCloud Go+**.
3. Open a new chat and type: **Help me set up SoundCrate**. Claude takes you through the rest
   ([what happens next](#first-time-setup)).

To update, see [Updating](#updating).

### Claude Code

Type this in Claude Code:

```text
/plugin install soundcrate --marketplace C4denaX/soundcrate-mcp
```

Or just ask: *"Install the SoundCrate plugin from the C4denaX/soundcrate-mcp marketplace."* Then say
**Help me set up SoundCrate**. Requires Node.js 18 or later.

### Cowork

In Claude Desktop, open **Customize > Plugins**, add the marketplace `C4denaX/soundcrate-mcp` and install
**SoundCrate**. It works in Cowork sessions that run on your computer. Requires Node.js 18 or later.

> [!NOTE]
> Claude on the web and on mobile can't run programs on your computer, so SoundCrate isn't available there.
> Use Claude Desktop.

### VS Code

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_SoundCrate-0098FF?logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522soundcrate%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522github%253AC4denaX%252Fsoundcrate-mcp%2523v1.7.0%2522%255D%257D)

Click the button, review the server and install it. Needs Node.js and Git. To declare Go+, add
`"env": { "SC_GO_PLUS": "1" }` to the server in your `mcp.json`.

### Other apps

Every MCP app needs the same thing: a **stdio** server started with `npx -y github:C4denaX/soundcrate-mcp#v1.7.0`
(needs Node.js and Git), plus `SC_GO_PLUS=1` if you have Go+. Pick your app:

<details>
<summary><b>Cursor, Windsurf, Cline, Gemini CLI and other apps with an <code>mcpServers</code> file</b></summary>

Cursor: `~/.cursor/mcp.json` · Gemini CLI: `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "soundcrate": {
      "command": "npx",
      "args": ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```

Gemini CLI also accepts:
`gemini mcp add --scope user -e SC_GO_PLUS=1 soundcrate npx -y github:C4denaX/soundcrate-mcp#v1.7.0`
</details>

<details>
<summary><b>OpenCode</b></summary>

`~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```json
{
  "mcp": {
    "soundcrate": {
      "type": "local",
      "command": ["npx", "-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "environment": { "SC_GO_PLUS": "1" },
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

`~/.codex/config.toml`:

```toml
[mcp_servers.soundcrate]
command = "npx"
args = ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"]
env = { SC_GO_PLUS = "1" }
```

Or: `codex mcp add soundcrate --env SC_GO_PLUS=1 -- npx -y github:C4denaX/soundcrate-mcp#v1.7.0`
</details>

<details>
<summary><b>Claude Desktop, configured by hand</b></summary>

Settings > Developer > Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "soundcrate": {
      "command": "npx",
      "args": ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```
</details>

<details>
<summary><b>Without npx (from a cloned copy)</b></summary>

```bash
git clone https://github.com/C4denaX/soundcrate-mcp.git
```

Then use `node` as the command and the full path to `server.mjs` as the argument, for example
`"command": "/opt/homebrew/bin/node", "args": ["/Users/you/soundcrate-mcp/server.mjs"]`. Desktop apps don't
always see your terminal's `PATH`, so give the full path to `node` (`which node` on macOS and Linux,
`where node` on Windows).
</details>

After adding SoundCrate, restart the app (on macOS, quit it completely with Cmd+Q).

## Updating

| How you installed it | How to update |
|---|---|
| **Claude Desktop** (`.mcpb`) | Download the latest `soundcrate.mcpb` from the [releases page](https://github.com/C4denaX/soundcrate-mcp/releases/latest) and open it again. Your credentials stay in your system's secure storage. |
| **Claude Code or Cowork** (plugin) | Run `/plugin`, open the **Marketplaces** tab, choose `soundcrate` and update it (or turn on auto-update there), then reload the plugin or restart the app. Or from the terminal: `claude plugin update soundcrate@soundcrate` (or `claude plugin update soundcrate`). |
| **npx** (VS Code, Cursor, OpenCode, Codex, Gemini CLI…) | Change the version tag in the server's arguments, for example `#v1.7.0` to the new `#vX.Y.Z` (the latest is on the [releases page](https://github.com/C4denaX/soundcrate-mcp/releases/latest)), and restart the app. Without a tag, `npx` can keep using its cached copy. |
| **Cloned copy** | Run `git pull` in the folder and restart the app. |

## First-time setup

Ask your assistant: **Help me set up SoundCrate.** It checks your computer with `setup_status` and explains each
step. When it's time, it opens a setup page in your browser. The page lives only on your computer
(`http://127.0.0.1:8976`) and has three steps:

1. **Register a SoundCloud app.** It links to <https://soundcloud.com/you/apps> and shows the exact values to
   enter, including the **Redirect URI** `http://127.0.0.1:8976/callback`, plus the notice about SoundCloud's
   [API terms](#what-you-need).
2. **Paste the app's Client ID and Client Secret.** They go straight to your system's secure storage. If you
   change the Client ID later, you have to connect again (step 3).
3. **Click "Connect with SoundCloud"** and authorize the app.

That's it. Your secrets never pass through the chat or the AI model. The page closes when you finish, when you
close the app, or after 60 minutes since your last action on the page (the page shows until what time it stays open; if it expires,
ask for the setup again: the assistant gets a new link, and `setup_status` says the page expired). If SoundCloud
sends you back with an error, the page tells you to return to the setup tab or ask for a new page. The page
usually opens by itself, but that is only a hint: the assistant always gives you the link too.

Prefer the terminal? `npx -y -p github:C4denaX/soundcrate-mcp#v1.7.0 soundcrate-login` opens the same page.

## What you can ask

- **Discover:** "Tracks similar to this one", "What have the DJs I follow reposted this month?", "Artists like
  Amelie Lens and their latest uploads", "Search playlists of melodic techno".
- **Build:** "Make a private playlist with these tracks", "Add the five best suggestions to *Warm-up*",
  "Replace this bootleg with the official release".
- **Plan a set:** "Sort *Peak time* by BPM", "Order it by Camelot key", "Where are the key clashes?".
- **Tidy up:** "Find duplicates in this playlist", "Rename it and add the genre Techno".

Every track comes with BPM, key and its **Camelot** code (for harmonic mixing), genre, label, release date, plays
and likes. Searches filter by genre, tags, BPM, duration and *upload* date; there is no filter by key or by release
date, but the key and release date of every result are shown.

**Camelot order.** Sorting by key puts the numbers in order (ascending or descending). When a number has both
letters, it starts with the one that mixes with the previous track, choosing the combination with the fewest
clashes (never more than the plain 1A 1B 2A 2B order); on a tie it zigzags 1A 1B 2B 2A…. Tracks without a key go
last. Keys that mix well are the same code, the
relative key (same number, other letter) and the neighbours (one number up or down, same letter). Skipping a
number that isn't in the playlist counts as a clash.

## Good to know

- **Long playlists** are read in pages: `get_playlist` returns 100 tracks by default (200 at most) with their
  `position`, plus `total` and `next_offset`, and has a `compact` option that returns less data per track.
- **Pages of results** (`next_cursor`) only work with the tool that gave them.
- **Rate limit:** if SoundCloud says "too many requests", SoundCrate tells you when the quota resets and doesn't
  retry. Wait until then.
- **No silent cuts:** after a rate limit, a server error or a timeout you get an error, never a shortened list.
  The one exception is when SoundCloud rejects the `access` filter (HTTP 400 or 422): SoundCrate then asks again
  without it and marks the result with `access_filter: "api_default"`, because blocked tracks may be missing.

## How it keeps your music safe

- New playlists are **private** unless you ask otherwise.
- SoundCrate **cannot delete playlists** or download audio.
- Changes to the same playlist are applied **one at a time within one SoundCrate process**, and every write reads
  the playlist once inside that lock: a write costs one read and one write (one more read only if SoundCloud's
  reply doesn't match). This is not atomic, though:
  SoundCloud has no way to lock a playlist, so two SoundCrate sessions (two apps open) or the SoundCloud website
  editing the same playlist at the same moment can overwrite each other. Don't do that.
- If SoundCloud hides some tracks of a playlist when reading it, SoundCrate **refuses to write** to that playlist,
  because rewriting it would drop them.
- If a write loses tracks, SoundCrate **restores the list as it was**; if even that fails, the error contains the
  original list so you can fix it by hand.
- Reordering never adds or removes tracks; if SoundCloud returns a different set, the previous order is restored.
  A `track_order` with repeated tracks keeps the repeats.
- Replacing a track restores the playlist if SoundCloud doesn't accept the new one, and tells you which other
  copies it removed (`removed_elsewhere`) so the playlist keeps one copy of the new track.
- If re-reading the playlist after a write fails, the error says the change was sent but could not be confirmed,
  and that nothing was restored.
- Restoring the track list does not undo metadata changes made by `update_playlist` (title, description, genre,
  tags).
- Removing a track that appears several times needs a `position` or `all_copies` (not both); otherwise nothing
  changes.
- Entries in `track_ids` that are not track ids are skipped and listed in `ignored_ids` (create, add, remove). If no valid id is left, nothing is done and an error is returned
  (without `ignored_ids`).
  `tags` accepts a list.
- Write tools are marked as such, so apps that support it ask you before changing a playlist.

## Go+ and what you can listen to

SoundCloud's API marks tracks as `playable`, `preview` or `blocked`, but that describes what *apps* may stream,
not what *you* can hear. SoundCrate adds a `listen` field for you:

| `listen` | Meaning |
|---|---|
| `full` | Plays in full for everyone. |
| `go_plus` | A preview without a subscription; full with Go+. |
| `go_plus_probable` | Label catalogue that usually plays in full on SoundCloud with Go+ (not guaranteed in every country). |
| `restricted` | Blocked for rights, region or by the uploader; may not play even with Go+. |

SoundCloud doesn't report whether you have Go+, so you tell SoundCrate. Then you can ask for "only tracks I can
listen to in full". Where you declare it depends on how you installed SoundCrate:

| Installed as | Where to turn Go+ on |
|---|---|
| Claude Desktop extension | Claude Desktop > **Settings > Extensions > SoundCrate**, switch **I have SoundCloud Go+**. Don't edit `claude_desktop_config.json`: it would start a second SoundCrate. |
| Claude Code or Cowork plugin | `/plugin`, open `soundcrate` and set its `go_plus` option. Don't add another server with `claude mcp add`. |
| npx or cloned copy | Add the variable `SC_GO_PLUS=1` to the server in your app's configuration (see [Other apps](#other-apps)). |

Tracks marked `go_plus_probable` usually play in full with Go+, but there is no guarantee (region, rights).

## Privacy and security

SoundCrate has no server, account, telemetry or analytics. It only talks to SoundCloud, from your computer.
Details in the [privacy policy](PRIVACY.md).

| System | Where your credentials are stored |
|---|---|
| macOS | Keychain (service `soundcloud-mcp`) |
| Windows | Credential Manager (`soundcloud-mcp:client_id`, …) |
| Linux | Secret Service: GNOME Keyring or KWallet, through `secret-tool` |

Secrets are never passed as command-line arguments (where other programs could see them). Optional settings:

- `SC_SECRET_STORE=file`: for Linux machines without a keyring. Stores the secrets **unencrypted** in
  `~/.config/soundcrate/credentials.json`, readable only by you. Use it only if there is no alternative.
- `SC_CLIENT_ID` / `SC_CLIENT_SECRET`: provide the app credentials through the environment (handy in CI).
- `SC_SECRET_SERVICE`: a different storage name, for example to use two accounts.

## Troubleshooting

| Problem | What to do |
|---|---|
| The assistant doesn't see SoundCrate | Restart the app completely. In Claude Desktop, check **Settings > Extensions**. |
| "SoundCrate is not set up yet" | Say **Help me set up SoundCrate**. |
| The setup page doesn't open | Ask the assistant for the link and open it in your browser on the same computer. |
| "Port 8976 is busy" | Close any other SoundCrate setup page or terminal login and try again. |
| SoundCloud rejects the Redirect URI | With a manual install (npx or cloned copy, see [Other apps](#other-apps)): use `http://localhost:8976/callback` in your SoundCloud app and add `SC_REDIRECT_URI=http://localhost:8976/callback` to the server's environment. Claude Desktop extension: there is no way to set it. Plugin: its `.mcp.json` doesn't set it, and it is not verified that the server inherits the environment Claude Code is launched with, so don't count on it; use a manual install if you need this. |
| "The setup page expired" | It closes after 60 minutes since your last action on the page. Ask the assistant to start the setup again. |
| "SoundCloud rate limit reached" | The message says when the quota resets. Wait until then. |
| Linux: "secret-tool is not installed" | Install it: `sudo apt install libsecret-tools gnome-keyring` (Debian/Ubuntu), `sudo dnf install libsecret` (Fedora), `sudo pacman -S libsecret` (Arch). |
| "The saved session is no longer valid" | Say **Reconnect SoundCrate** and connect again on the setup page. |
| `npx` fails with a Git error | Install [Git](https://git-scm.com), or use the [cloned copy](#other-apps) option. |

## Uninstall

1. Remove SoundCrate from your app (Claude Desktop: **Settings > Extensions**; Claude Code: `/plugin uninstall soundcrate`).
2. Delete your SoundCloud app at <https://soundcloud.com/you/apps>.
3. Delete the saved secrets:

<details>
<summary>Commands for macOS, Linux and Windows</summary>

```bash
# macOS
security delete-generic-password -s soundcloud-mcp -a refresh_token
security delete-generic-password -s soundcloud-mcp -a client_secret
security delete-generic-password -s soundcloud-mcp -a client_id
```

```bash
# Linux
secret-tool clear service soundcloud-mcp account refresh_token
secret-tool clear service soundcloud-mcp account client_secret
secret-tool clear service soundcloud-mcp account client_id
```

```powershell
# Windows
cmdkey /delete:soundcloud-mcp:refresh_token
cmdkey /delete:soundcloud-mcp:client_secret
cmdkey /delete:soundcloud-mcp:client_id
```

With `SC_SECRET_STORE=file`, delete `credentials.json` instead.
</details>

## Tools

<details>
<summary>All 23 tools</summary>

| Tool | What it does |
|---|---|
| `setup_status` | Checks what is missing on this computer and returns the next step. |
| `start_setup` | Opens the local setup page (credentials and SoundCloud login). |
| `search_tracks` | Search by text, genres, tags, BPM, duration and upload date (up to 200 per page). No key filter. |
| `get_track` | One track by id or URL. |
| `get_related_tracks` | SoundCloud's related tracks, optionally excluding a playlist's tracks. |
| `get_my_tracks` | Your likes, recently played, feed, followings' uploads or reposts. |
| `search_users` | Search artists, labels or DJs. |
| `get_related_artists` | Similar artists. |
| `get_user_content` | An artist's tracks, likes, reposts or playlists. |
| `search_playlists` | Public playlists from anyone. |
| `get_station` | A SoundCloud station with its tracks. |
| `suggest_tracks` | Candidates from 1-5 seed tracks, deduplicated, filtered and ranked (harmonic match included). Read-only. |
| `find_official_version` | Candidates for the official release of a user upload, with reasons. |
| `analyze_playlist` | Duration, BPM range, keys, genres, duplicates, BPM jumps and key clashes. |
| `whoami` | Your account and whether Go+ is declared. |
| `get_my_playlists` | Your playlists (private ones included), liked playlists or stations; filter by title. |
| `get_playlist` | A playlist with its tracks, by id or URL, in pages (`offset`, `limit` up to 200, `compact`). |
| `create_playlist` | Create a playlist, private by default. |
| `add_tracks_to_playlist` | Append tracks, skipping duplicates. |
| `remove_tracks_from_playlist` | Remove several tracks in one write. |
| `remove_track_from_playlist` | Remove one track. |
| `replace_track_in_playlist` | Swap a track, keeping its position. |
| `update_playlist` | Change title, description, genre or tags, and reorder by BPM, Camelot key, duration, release date or a given order. |
</details>

## For developers

- Zero dependencies: plain Node.js ESM (`server.mjs`), stdio transport.
- Speaks MCP 2024-11-05 to 2025-11-25 (`initialize`) and 2026-07-28 (stateless, `server/discover`).
- Tool descriptions are in English, under 1,024 characters, with flat schemas that OpenAI, Gemini and local
  models accept.
- `npm test` runs thirteen offline suites (protocol over a real stdio process, secret stores, the setup page over real
  HTTP, distribution files). `npm run test:store` exercises your system's real secret store with a throwaway
  entry. CI runs everything on Linux, macOS and Windows against the real secret stores.
- Distribution: `manifest.json` (Claude Desktop extension, packed with `@anthropic-ai/mcpb`),
  `.claude-plugin/` + `.mcp.json` + `skills/` (Claude plugin and marketplace), `package.json` `bin` (npx).
- Releasing: bump the version in `package.json`, `manifest.json`, `.claude-plugin/plugin.json` and `server.mjs`,
  and every `#vX.Y.Z` install reference in the READMEs, then push a `vX.Y.Z` tag. CI runs
  `node .github/scripts/check-versions.mjs` (it fails if any of those versions, or the tag, differs from
  `package.json`) and `node .github/scripts/check-manifest-tools.mjs` (the tools in `manifest.json` must match
  `server.mjs`, with complete descriptions). The release workflow then publishes `soundcrate.mcpb`.

## License and credits

[MIT](LICENSE) © Sergio Ruiz. SoundCrate is not affiliated with, endorsed by or sponsored by SoundCloud.

Inspired by [marcellkehmstedt/soundcloud-mcp-server](https://github.com/marcellkehmstedt/soundcloud-mcp-server)
(especially its fix for long track IDs). This code was written from scratch, without dependencies and with a
different architecture (local stdio instead of an HTTP server).
