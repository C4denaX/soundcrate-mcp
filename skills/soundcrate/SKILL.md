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
- Creating the app means accepting SoundCloud's API terms (https://developers.soundcloud.com/docs/api/terms-of-use).
  Section 03 forbids using content obtained through the API as input to AI technology, and SoundCloud can revoke
  the app's access without notice. Mention it when guiding the setup: the user uses SoundCrate at their own
  responsibility.
- The setup page expires 60 minutes after the user's last action on it (the page shows until what time it stays open;
  `setup_status` reports `setup_page_expired`): call `start_setup` again. After an error on /callback the page tells
  the user to go back to the setup tab or ask for a new page. `browser_opened` in the result is only a hint: always give
  the user the URL. If the user changes the Client ID, they must connect again (step 3 of the page).
- After setup, ask whether they have SoundCloud Go+ and, if so, how to declare it, depending on how SoundCrate
  was installed: extension (Claude Desktop) > Settings > Extensions > SoundCrate, switch "I have SoundCloud Go+"
  (do not edit claude_desktop_config.json); plugin (Claude Code) > `/plugin`, soundcrate, option `go_plus` (do
  not add another server with `claude mcp add`); manual or npx install > `SC_GO_PLUS=1` in the client's server
  configuration.

## Working with music

- Each track has `bpm`, `key` and `camelot`. Compatible keys for mixing: same code, the relative key (same number,
  other letter) or a neighbour on the wheel (±1, same letter). Skipping a missing number is a clash.
- `search_tracks` filters by text, genres, tags, BPM, duration and upload date. It cannot filter by key or by
  release date; filter those yourself from each result's `camelot` and release date.
- `listen` says what the user can actually hear: `full`, `go_plus`, `go_plus_probable` or `restricted`. With Go+
  declared, `only_listenable: true` keeps `full` and `go_plus` tracks (sure) and also `go_plus_probable` (label tracks:
  probable, not certain; region and rights may stop it). Every track can be added to a
  playlist.
- `get_playlist` is paged: `limit` (default 100, max 200), `offset`, `compact`; it returns `total` and
  `next_offset`. Cursors (`next_cursor`) only work with the tool that returned them.
- On a rate limit (429) the message says when the quota resets: do not retry before then, tell the user. Errors
  and timeouts are never shortened lists; a list marked `access_filter: "api_default"` may lack blocked tracks.
- To grow a playlist: pick 2-5 seed tracks, call `suggest_tracks` with `exclude_playlist_id`, then show the
  candidates before adding anything.
- To plan a set: `analyze_playlist` shows BPM jumps and key clashes; `update_playlist` with `sort_by: "bpm"` or
  `"camelot"` reorders it. `camelot` keeps the numbers in order (asc or desc); inside a number with both letters it starts with
  the one that mixes with the previous track, choosing the combination with fewest clashes (never more than plain
  1A 1B 2A 2B), zigzag 1A 1B 2B 2A… on a tie; tracks without a key go last; a number missing from the playlist is
  still an unavoidable clash. `update_playlist` metadata changes (title, etc.) are not reverted if the track list
  is restored.
- To find a user's own playlist by name, use `get_my_playlists` with `query` (it includes private playlists).

## Safety

- New playlists are private unless the user asks for public. `public` accepts true or false, also as text or 1/0:
  `true`, `1`, or the text true/1/yes/si/sí (any capitals, spaces around are ignored, e.g. `" YES "`) make it
  public; `false`, `0`, or the text false/0/no keep it private, as does leaving it out, null or empty text; anything else (for
  example `"maybe"`) is rejected with an error and nothing is created.
- Before removing, replacing or reordering tracks in an existing playlist, tell the user what will change and get
  a clear yes. SoundCrate cannot delete playlists.
- Removing a track that appears more than once needs `position` or `all_copies` (not both). Entries of `track_ids`
  that are not track ids are skipped and listed in `ignored_ids` (create, add, remove); if no valid id is left, nothing is done and an error is returned (no `ignored_ids`). `tags` accepts a list.
  A write costs 1 GET + 1 PUT (one more GET only if the PUT reply doesn't match); if the re-read fails the error
  says the change was sent but not confirmed and nothing was restored. `replace_track_in_playlist`
  lists the other copies it removed in `removed_elsewhere`; if a write loses tracks the playlist is restored.
- Writes are not atomic: do not edit the same playlist at once from two sessions or the SoundCloud website.
