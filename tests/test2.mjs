import assert from "node:assert/strict";
const S = await import("../server.mjs");
let hide = true, puts = 0; const pl = { id: 99, title: "x", sharing: "private", track_count: 3, tracks: [{ id: 1 }, { id: 2 }, { id: 3 }] };
S._setDeps({
  secretGet: () => "rt", secretSet: () => {}, credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at1", refresh_token: "rt1", expires_in: 3600 }),
  fetch: async (url, o) => {
    const u = new URL(url);
    if (o.method === "GET") { assert.equal(u.searchParams.get("access"), "playable,preview,blocked"); return Response.json({ ...pl, tracks: hide ? pl.tracks.slice(0, 2) : pl.tracks }); }
    if (o.method === "PUT") { puts++; const b = JSON.parse(o.body); pl.tracks = b.playlist.tracks.map(t => ({ id: Number(t.id) })); pl.track_count = pl.tracks.length; return Response.json(pl); }
  },
});
const call = async (name, args) => (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
let r = await call("add_tracks_to_playlist", { playlist_id: "99", track_ids: ["4"] });
assert.equal(r.isError, true); assert.equal(puts, 0, "no escribe si hay pistas ocultas"); console.log("bloqueado:", r.content[0].text.slice(0, 70));
r = await call("get_playlist", { playlist_id: "99" }); assert.equal(JSON.parse(r.content[0].text).hidden_by_api, 1);
hide = false; r = await call("add_tracks_to_playlist", { playlist_id: "99", track_ids: ["4"] });
assert.deepEqual(pl.tracks.map(t => t.id), [1, 2, 3, 4]); console.log("sin ocultas añade OK:", r.content[0].text.replace(/\s+/g, " "));
console.log("OK");
