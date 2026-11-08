import assert from "node:assert/strict";
const S = await import("../server.mjs");
const kc = { refresh_token: "rt0" }; let refreshCalls = 0;
const pl = { id: 99, title: "REMEMBER – faltan", sharing: "private", track_count: 2, tracks: [{ id: 1 }, { id: 2 }] };
let first401 = true; const calls = [];
S._setDeps({
  kcGet: (a) => kc[a] ?? null, kcSet: (a, v) => (kc[a] = v),
  credentials: () => ({ clientId: "cid", clientSecret: "sec" }),
  tokenRequest: async (p) => { refreshCalls++; assert.equal(p.refresh_token, kc.refresh_token); return { access_token: "at" + refreshCalls, refresh_token: "rt" + refreshCalls, expires_in: 3600 }; },
  fetch: async (url, o) => {
    calls.push([o.method, url, o.headers.Authorization, o.body]);
    assert.match(o.headers.Authorization, /^OAuth at\d$/);
    const u = new URL(url);
    if (u.pathname === "/tracks" && first401) { first401 = false; return new Response("no", { status: 401 }); }
    if (u.pathname === "/tracks") return Response.json({ collection: [{ id: 123456789012, title: "Extres", user: { username: "x" }, access: "preview", duration: 300000, permalink_url: "u" }] });
    if (u.pathname === "/playlists/99" && o.method === "GET") return Response.json(pl);
    if (u.pathname === "/playlists/99" && o.method === "PUT") { const b = JSON.parse(o.body); pl.tracks = b.playlist.tracks.map(t => ({ id: Number(t.id) })); return Response.json(pl); }
    return new Response("nf", { status: 404 });
  },
});
let r = await S.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
assert.equal(r.result.serverInfo.name, "soundcrate");
r = await S.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
console.log("tools:", r.result.tools.map(t => t.name).join(", "));
assert.equal(await S.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
r = await S.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_tracks", arguments: { query: "EX-3 Extres" } } });
const s = JSON.parse(r.result.content[0].text); console.log("search:", JSON.stringify(s.tracks[0]));
assert.equal(s.tracks[0].id, "123456789012"); assert.equal(s.tracks[0].duration, "5:00");
assert.equal(refreshCalls, 2, "refresh tras 401"); assert.equal(kc.refresh_token, "rt2", "refresh token rotado");
assert.match(calls.find(c => c[1].includes("/tracks"))[1], /access=playable%2Cpreview%2Cblocked/);
r = await S.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add_tracks_to_playlist", arguments: { playlist_id: "99", track_ids: ["2", "3", "abc", "4"] } } });
const a = JSON.parse(r.result.content[0].text); console.log("add:", JSON.stringify(a), "tracks:", pl.tracks.map(t => t.id));
assert.deepEqual(pl.tracks.map(t => t.id), [1, 2, 3, 4]); assert.equal(a.added, 2);
const put = calls.find(c => c[0] === "PUT"); assert.match(put[3], /"id":"3"/, "ids como cadena");
r = await S.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }); assert.equal(r.error.code, -32602);
r = await S.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_track", arguments: {} } }); assert.equal(r.result.isError, true);
console.log("OK todas las pruebas");
