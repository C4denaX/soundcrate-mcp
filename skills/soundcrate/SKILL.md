---
name: soundcrate
description: Use when the user wants to search SoundCloud, discover music, or build, analyze, reorder or clean up their SoundCloud playlists (DJ sets, BPM ranges, harmonic mixing, Go+ availability), or asks to set up SoundCrate.
---

# SoundCrate

SoundCrate gives you tools for the user's own SoundCloud account. Its tools are named `setup_status`,
`start_setup`, `search_tracks`, `suggest_tracks`, `analyze_playlist`, `update_playlist` and so on (some clients
prefix them, for example `soundcrate_search_tracks`).

## If the tools are not available

On claude.ai chat and the Claude mobile apps, plugins cannot start local servers, so the tools are missing there.
Tell the user, in plain language, how to get them:

- **Claude Desktop:** download `soundcrate.mcpb` from the latest release at
  https://github.com/C4denaX/soundcrate-mcp/releases, double-click it and choose **Install**. No other software
  is needed.
- **Claude Code or Cowork:** this plugin starts the server; it needs Node.js 18 or later on the computer.

## Setup and first use

- If the user is new, or any tool says SoundCrate is not set up, call `setup_status` and walk them through
  `next_step` one step at a time. Offer to call `start_setup`, which opens a local page in their browser.
- Never ask the user to paste the Client Secret (or any secret) into the chat. The setup page collects it.
- Registering a SoundCloud app requires a SoundCloud Artist Pro plan. Say so early so the user is not surprised.
- After setup, ask whether they have SoundCloud Go+ and, if so, how to declare it (the `go_plus` option of the
  extension or plugin, or `SC_GO_PLUS=1`).

## Working with music

- Each track has `bpm`, `key` and `camelot`. Compatible keys for mixing: same code, the relative key (same number,
  other letter) or a neighbour on the wheel (±1, same letter).
- `listen` says what the user can actually hear: `full`, `go_plus`, `go_plus_probable` or `restricted`. With Go+
  declared, use `only_listenable: true` to keep only tracks they can play in full. Every track can be added to a
  playlist.
- To grow a playlist: pick 2-5 seed tracks, call `suggest_tracks` with `exclude_playlist_id`, then show the
  candidates before adding anything.
- To plan a set: `analyze_playlist` shows BPM jumps and key clashes; `update_playlist` with `sort_by: "bpm"` or
  `"camelot"` reorders it.
- To find a user's own playlist by name, use `get_my_playlists` with `query` (it includes private playlists).

## Safety

- New playlists are private unless the user asks for public.
- Before removing, replacing or reordering tracks in an existing playlist, tell the user what will change and get
  a clear yes. SoundCrate cannot delete playlists.
