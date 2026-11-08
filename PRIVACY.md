# SoundCrate privacy policy

_Last updated: 2026-11-09_

SoundCrate is an open-source MCP server that runs **only on your own computer**. There is no SoundCrate
server, account or cloud service, and the project collects nothing.

## What SoundCrate accesses

- **Your SoundCloud account, through the SoundCloud API**, using a SoundCloud app that *you* register and
  authorize. It reads tracks, users, playlists, likes, reposts, your feed and your listening history, and it
  creates and changes your playlists when you or your AI assistant ask it to. It never deletes playlists and
  never downloads or streams audio.
- **Your SoundCloud app credentials and session** (Client ID, Client Secret and refresh token).

## Where data goes

| Data | Where it goes |
|---|---|
| Requests to SoundCloud | Directly from your computer to `api.soundcloud.com` and `secure.soundcloud.com`. SoundCrate refuses to send your token to any other address. |
| Client ID, Client Secret, refresh token | Your operating system's secret store: macOS Keychain, Linux Secret Service or Windows Credential Manager. Only if you set `SC_SECRET_STORE=file` are they kept in an unencrypted local file protected by file permissions. |
| Credentials you type during setup | The setup page runs on `127.0.0.1` on your computer and passes them straight to the secret store. They are never sent to your AI assistant or written to the chat. |
| Tool results (track lists, playlist contents, your username…) | Returned to the MCP client that started SoundCrate (Claude, OpenCode, Cursor…). What that client does with them is governed by its own privacy policy. |

SoundCrate has **no analytics, telemetry, crash reporting or third-party services**, and it writes no logs
except short status lines on the client's standard error.

## Removing your data

Remove the SoundCrate app at <https://soundcloud.com/you/apps> and delete the saved secrets as described in the
README ("Uninstall" section). Uninstalling SoundCrate from your MCP client removes the program itself.

## Contact

Questions or concerns: <https://github.com/C4denaX/soundcrate-mcp/issues>.

SoundCrate is not affiliated with, endorsed by or sponsored by SoundCloud.
