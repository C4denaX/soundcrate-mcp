// Cerrojo por playlist, borrado por lotes, sustitución, whoami y versión. Sin red ni Llavero.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lists = {
  10: { id: 10, title: "a", sharing: "private", tracks: [1, 2, 3] },
  20: { id: 20, title: "b", sharing: "private", tracks: [1, 2, 3, 4, 5, 6] },
};
const view = (p) => ({ ...p, track_count: p.tracks.length, tracks: p.tracks.map((id) => ({ id })) });
let puts = 0, inFlight = 0, maxInFlight = 0;
S._setDeps({ goPlus: false,
  kcGet: () => "rt", kcSet: () => {}, credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url, o) => {
    const u = new URL(url);
    if (u.pathname === "/me") return Response.json({ id: 7, username: "dj", plan: "Pro Plus", subscriptions: [{ product: { id: "creator-pro-unlimited", name: "Artist Pro" } }] });
    const pid = u.pathname.split("/")[2], p = lists[pid];
    if (!p) return new Response("nf", { status: 404 });
    if (o.method === "GET") {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(15); // ventana para que dos llamadas sin cerrojo lean el mismo estado
      inFlight--;
      return Response.json(view(p));
    }
    if (o.method === "PUT") {
      puts++;
      await sleep(5);
      p.tracks = JSON.parse(o.body).playlist.tracks.map((t) => Number(t.id));
      return Response.json(view(p));
    }
  },
});
const call = async (name, args) => {
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return { err: !!r.isError, out: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};

// 1. Cerrojo: tres añadidos en paralelo a la misma playlist no se pisan.
await Promise.all([
  call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["4"] }),
  call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["5"] }),
  call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["1"] }),
]);
assert.deepEqual(lists[10].tracks, [2, 3, 4, 5], "las escrituras en paralelo no pierden cambios");
assert.equal(maxInFlight, 1, "en la misma playlist no hay lecturas solapadas");
console.log("cerrojo OK:", lists[10].tracks);

// 2. En playlists distintas sí van en paralelo; un error no bloquea la cola.
maxInFlight = 0;
const [bad] = await Promise.all([
  call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "999", new_track_id: "1" }),
  call("get_playlist", { playlist_id: "20" }),
  call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["6"] }),
]);
assert.equal(bad.err, true); assert.match(bad.out, /no está en la playlist/);
assert.deepEqual(lists[10].tracks, [2, 3, 4, 5, 6], "tras un error la cola sigue");
assert.equal(maxInFlight, 2, "playlists distintas en paralelo");

// 3. Borrado por lotes: una sola escritura, conserva el orden, informa de lo que no estaba.
puts = 0;
let r = await call("remove_tracks_from_playlist", { playlist_id: "20", track_ids: ["2", "5", "5", "77", "x"] });
assert.deepEqual(r.out, { removed: 2, not_found: ["77"], total: 4 });
assert.deepEqual(lists[20].tracks, [1, 3, 4, 6]); assert.equal(puts, 1, "una sola escritura");
r = await call("remove_tracks_from_playlist", { playlist_id: "20", track_ids: ["77"] });
assert.equal(r.out.removed, 0); assert.equal(puts, 1, "no escribe si no hay nada que quitar");
r = await call("remove_tracks_from_playlist", { playlist_id: "20", track_ids: [] });
assert.equal(r.err, true);
r = await call("remove_track_from_playlist", { playlist_id: "20", track_id: "6" });
assert.deepEqual(lists[20].tracks, [1, 3, 4]); assert.equal(r.out.removed, 1);
console.log("lotes OK:", lists[20].tracks);

// 4. Sustituir conserva la posición y no duplica.
r = await call("replace_track_in_playlist", { playlist_id: "20", old_track_id: "3", new_track_id: "123456789012" });
assert.deepEqual(lists[20].tracks, [1, 123456789012, 4]); assert.equal(r.out.replaced, true); assert.equal(r.out.position, 2);
r = await call("replace_track_in_playlist", { playlist_id: "20", old_track_id: "1", new_track_id: "4" });
assert.deepEqual(lists[20].tracks, [4, 123456789012], "la nueva ya estaba: se mueve, no se duplica");
r = await call("replace_track_in_playlist", { playlist_id: "20", old_track_id: "4", new_track_id: "4" });
assert.equal(r.err, true);
console.log("sustituir OK:", lists[20].tracks);

// 5. playlist_id no numérico: error claro, sin peticiones a /playlists/undefined.
r = await call("get_playlist", { playlist_id: "abc" });
assert.equal(r.err, true); assert.match(r.out, /playlist_id/);

// 6. whoami y versión.
r = await call("whoami", { force_refresh: true });
assert.deepEqual(r.out, { id: "7", username: "dj", plan: "Pro Plus", subscriptions: [{ id: "creator-pro-unlimited", name: "Artist Pro" }], token_refreshed: true, go_plus_declared: false, note: r.out.note });
const init = await S.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
assert.equal(init.result.serverInfo.version, "1.4.0");
const list = (await S.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result.tools;
assert.doesNotMatch(list.find((t) => t.name === "search_tracks").description, /blocked = no reproducible/);
console.log("OK");
