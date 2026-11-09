// Lote S4 (ronda 4) · track_ids como texto que solo trae separadores o blancos da el mismo error que [""], sin peticiones.
// "" y [] siguen contando como omitidos. Sin red ni Llavero: API simulada en memoria.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
let log;
const tk = (id) => ({ id: Number(id), title: "t" + id, user: { username: "u" }, access: "playable" });
S._setDeps({
  goPlus: false, restoreRetryMs: 1, secretGet: () => "rt", secretSet: () => {},
  credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url, o = {}) => {
    const u = new URL(url);
    const m = o.method || "GET";
    const body = o.body ? JSON.parse(o.body).playlist : undefined;
    log.push({ m, path: u.pathname, body });
    if (u.pathname === "/playlists" && m === "POST") return Response.json({ id: 77, title: body.title, tracks: body.tracks, track_count: body.tracks.length });
    if (/^\/playlists\/10$/.test(u.pathname)) {
      const tracks = m === "PUT" ? body.tracks.map((t) => tk(t.id)) : [1, 2, 3].map(tk);
      return Response.json({ id: 10, title: "pl", sharing: "private", permalink_url: "u", track_count: tracks.length, tracks });
    }
    if (m === "GET" && /^\/tracks(\/\d+(\/related)?)?$/.test(u.pathname)) return Response.json(/\/tracks\/\d+$/.test(u.pathname) ? tk(u.pathname.split("/").pop()) : { collection: [] });
    return new Response("nf", { status: 404 });
  },
});
const call = async (name, args) => {
  log = [];
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return { err: !!r.isError, text: r.content[0].text, n: (m) => log.filter((l) => l.m === m).length, total: log.length };
};
const fails = [];
const tcase = async (name, fn) => {
  try { await fn(); console.log("ok    " + name); } catch (e) { fails.push(name); console.log("FAIL  " + name + "\n      " + String(e.message).split("\n")[0]); }
};
const blanks = [" , ", ",", " ,, ", "\t", " "];
const cases = [
  ["create_playlist", (v) => ({ title: "x", track_ids: v })],
  ["add_tracks_to_playlist", (v) => ({ playlist_id: "10", track_ids: v })],
  ["remove_tracks_from_playlist", (v) => ({ playlist_id: "10", track_ids: v })],
  ["suggest_tracks", (v) => ({ seed_track_ids: v })],
  ["update_playlist", (v) => ({ playlist_id: "10", track_order: v })],
];
for (const [tool, mk] of cases) {
  await tcase(`${tool}: texto solo de separadores/blancos da error «empty entries», 0 peticiones`, async () => {
    for (const v of blanks) {
      const r = await call(tool, mk(v));
      assert.equal(r.err, true, JSON.stringify(v));
      assert.match(r.text, /only has empty entries/, JSON.stringify(v) + ": " + r.text);
      assert.equal(r.total, 0, JSON.stringify(v) + ": peticiones " + r.total);
    }
  });
}
await tcase("create_playlist sin pistas sigue valiendo: track_ids omitido, \"\" o []", async () => {
  for (const a of [{ title: "x" }, { title: "x", track_ids: "" }, { title: "x", track_ids: [] }]) {
    const r = await call("create_playlist", a);
    assert.equal(r.err, false, JSON.stringify(a) + ": " + r.text);
    assert.equal(r.n("POST"), 1, JSON.stringify(a));
  }
});
await tcase("add_tracks_to_playlist con \"\" da error, como con [], sin peticiones", async () => {
  const a = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: "" });
  const b = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: [] });
  assert.equal(a.err, true);
  assert.equal(b.err, true);
  assert.equal(b.total, 0);
  assert.equal(a.total, 0);
});
await tcase("ids válidos en texto siguen funcionando", async () => {
  const r = await call("create_playlist", { title: "x", track_ids: " 1, ,2 " });
  assert.equal(r.err, false, r.text);
  assert.equal(r.n("POST"), 1);
});
if (fails.length) { console.log("\nFALLAN " + fails.length + ": " + fails.join(" | ")); process.exit(1); }
console.log("\ntest18: todo ok");
