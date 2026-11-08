// Go+ y el campo 'listen': clasificación por metadatos, filtro only_listenable, SC_GO_PLUS e instrucciones.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
const T = (id, access, o = {}) => ({ id, title: "t" + id, user: { username: "u" }, access, duration: 300000, bpm: 126, key_signature: "A:min", genre: "Techno", ...o });
const SEARCH = [
  T(1, "playable"), // full
  T(2, "preview", { isrc: "X1", label_name: "L" }), // go_plus
  T(3, "blocked", { isrc: "X2", label_name: "L" }), // go_plus_probable
  T(4, "blocked", { label_name: "L" }), // go_plus_probable (solo sello)
  T(5, "blocked", { isrc: "X3" }), // go_plus_probable (solo ISRC)
  T(6, "blocked"), // restricted
];
const calls = [];
S._setDeps({
  goPlus: false,
  secretGet: () => "rt", secretSet: () => {}, credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    assert.doesNotMatch(u.pathname, /\/streams|\/preview/, "nunca se toca el audio");
    if (u.pathname === "/me") return Response.json({ id: 1, username: "dj", plan: "Pro Plus", subscriptions: [{ product: { id: "creator-pro-unlimited" } }] });
    if (u.pathname === "/tracks") return Response.json({ collection: SEARCH });
    if (u.pathname === "/tracks/1") return Response.json(SEARCH[0]);
    if (u.pathname === "/tracks/1/related") return Response.json({ collection: SEARCH.slice(1) });
    if (u.pathname === "/playlists/9") return Response.json({ id: 9, title: "p", track_count: 6, tracks: SEARCH });
    return new Response("nf", { status: 404 });
  },
});
const call = async (name, args) => {
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return r.isError ? { err: r.content[0].text } : JSON.parse(r.content[0].text);
};
const listen = (ts) => ts.map((t) => [t.id, t.listen]);

// 1. Clasificación.
let r = await call("search_tracks", { query: "x" });
assert.deepEqual(listen(r.tracks), [["1", "full"], ["2", "go_plus"], ["3", "go_plus_probable"], ["4", "go_plus_probable"], ["5", "go_plus_probable"], ["6", "restricted"]]);
assert.deepEqual(r.tracks.map((t) => t.access), ["playable", "preview", "blocked", "blocked", "blocked", "blocked"], "access se mantiene");

// 2. Sin Go+ declarado: only_listenable deja solo 'full'.
r = await call("search_tracks", { query: "x", only_listenable: true });
assert.deepEqual(listen(r.tracks), [["1", "full"]]);
assert.equal(r.not_listenable_removed, 5);
let init = (await S.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).result;
assert.match(init.instructions, /has not declared Go\+/);
assert.match(init.instructions, /go_plus_probable/);
assert.equal(init.serverInfo.version, "1.6.0");
r = await call("whoami", {});
assert.equal(r.go_plus_declared, false); assert.match(r.note, /SC_GO_PLUS/);

// 3. Con Go+ declarado: escuchables full, go_plus y go_plus_probable; restricted fuera.
S._setDeps({ goPlus: true });
r = await call("search_tracks", { query: "x", only_listenable: true });
assert.deepEqual(r.tracks.map((t) => t.id), ["1", "2", "3", "4", "5"]);
assert.equal(r.not_listenable_removed, 1);
init = (await S.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).result;
assert.match(init.instructions, /has declared Go\+/);
assert.equal((await call("whoami", {})).go_plus_declared, true);

// 4. suggest_tracks aplica el mismo filtro.
r = await call("suggest_tracks", { seed_track_ids: ["1"], only_listenable: true });
assert.deepEqual(r.tracks.map((t) => t.id).sort(), ["2", "3", "4", "5"]);
assert.equal(r.stats.dropped.not_listenable, 1);
S._setDeps({ goPlus: false });
r = await call("suggest_tracks", { seed_track_ids: ["1"], only_listenable: true });
assert.deepEqual(r.tracks, []); assert.equal(r.stats.dropped.not_listenable, 5);
r = await call("suggest_tracks", { seed_track_ids: ["1"] });
assert.equal(r.tracks.length, 5, "sin only_listenable no se filtra");

// 5. analyze_playlist cuenta por 'listen'.
r = await call("analyze_playlist", { playlist_id: "9" });
assert.deepEqual(r.listen, { full: 1, go_plus: 1, go_plus_probable: 3, restricted: 1 });

// 6. Ninguna llamada fue a /streams ni /preview (comprobado en cada fetch).
assert.ok(calls.length > 0);
console.log("OK");
