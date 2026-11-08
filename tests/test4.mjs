// Bloque 1 de descubrimiento: filtros, cursores, URN, relacionadas, fuentes propias, usuarios, playlists y emisoras.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
const API = "https://api.soundcloud.com";
const T = (id, extra = {}) => ({ id, title: "t" + id, user: { username: "u" }, access: "playable", duration: 60000, permalink_url: "p" + id, ...extra });
const calls = [];
let rejectAccess = false;
S._setDeps({
  kcGet: () => "rt", kcSet: () => {}, credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url, o) => {
    const u = new URL(url);
    calls.push(u);
    assert.equal(u.origin, API, "solo se llama a la API");
    const q = u.searchParams, p = u.pathname;
    if (rejectAccess && q.has("access")) return new Response("bad access", { status: 400 });
    const J = (x) => Response.json(x);
    if (p === "/tracks") return J({ collection: [T(1, { bpm: 124.04, key_signature: "A:min", tag_list: "deep \"minimal techno\"", isrc: "ES1234", release_year: 2024, release_month: 3, release_day: 7, favoritings_count: 9, metadata_artist: "Real Artist", created_at: "2024/03/01 10:00:00 +0000" }), { urn: "soundcloud:tracks:2", title: "solo urn", access: "blocked" }], next_href: `${API}/tracks?cursor=abc` });
    if (p === "/tracks/5/related") return J({ collection: [T(5), T(6), T(7), T(8)], next_href: null });
    if (p === "/playlists/99") return J({ id: 99, title: "x", track_count: 1, tracks: [{ id: 7 }] });
    if (p === "/resolve") {
      const r = q.get("url");
      if (r.endsWith("/artist")) return J({ kind: "user", id: 42, username: "artist", followers_count: 1000, city: "Madrid", permalink_url: r + "?utm_source=api" });
      if (r.endsWith("/set")) return J({ kind: "playlist", id: 99 });
      return J({ kind: "track", ...T(5) });
    }
    if (p === "/me/likes/tracks") return J({ collection: [T(11)], next_href: `${API}/me/likes/tracks?cursor=n2` });
    if (p === "/me/recently-played/tracks") return J({ collection: [T(12)] });
    if (p === "/me/feed/tracks") return J({ collection: [{ type: "track:repost", created_at: "2026-11-01T00:00:00Z", origin: T(13) }, { type: "playlist", created_at: "x", origin: { kind: "playlist", tracks: [], id: 3 } }] });
    if (p === "/me/followings/tracks") { const off = +q.get("offset"); return J(off === 0 ? [T(14), T(15)] : [T(16)]); }
    if (p === "/users") return J({ collection: [{ id: 42, username: "artist", full_name: "A B", followers_count: 1000, track_count: 50, permalink_url: "pu" }] });
    if (p === "/users/42/related") return J({ collection: [{ urn: "soundcloud:users:43", username: "twin" }] });
    if (p === "/users/42/tracks") return J({ collection: [T(21)] });
    if (p === "/users/42/likes/tracks") return J({ collection: [T(22)] });
    if (p === "/users/42/playlists") return J({ collection: [{ id: 31, title: "pl", user: { username: "artist" }, track_count: 4, sharing: "public" }] });
    if (p === "/playlists") return J({ collection: [{ id: 32, title: "found", track_count: 9 }] });
    if (p === "/me/likes/system-playlists") return J({ collection: [{ urn: "soundcloud:system-playlists:track-stations:5", title: "Station: t5", track_count: 50 }] });
    if (p.startsWith("/system-playlists/")) return J({ urn: decodeURIComponent(p.split("/")[2]), title: "Station", tracks: [T(41)] });
    if (p === "/me/likes/playlists") return J({ collection: [{ id: 33, title: "liked pl" }] });
    return new Response("nf " + p, { status: 404 });
  },
});
const call = async (name, args) => {
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return { err: !!r.isError, out: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};
const last = () => calls[calls.length - 1];

// 1. search_tracks: filtros a la API, campos de DJ y URN.
let r = await call("search_tracks", { query: "acid", genres: ["Techno", "House"], tags: "deep", bpm_min: 120, bpm_max: 128.4, duration_min_s: 300, uploaded_after: "2025-01-01", uploaded_before: "2025-12-31", limit: 500 });
let q = last().searchParams;
assert.equal(q.get("genres"), "Techno,House"); assert.equal(q.get("tags"), "deep");
assert.equal(q.get("bpm[from]"), "120"); assert.equal(q.get("bpm[to]"), "129");
assert.equal(q.get("duration[from]"), "300000"); assert.equal(q.has("duration[to]"), false);
assert.equal(q.get("created_at[from]"), "2025-01-01 00:00:00"); assert.equal(q.get("created_at[to]"), "2025-12-31 23:59:59");
assert.equal(q.get("limit"), "200", "limit acotado a 200"); assert.equal(q.get("access"), "playable,preview,blocked");
const t1 = r.out.tracks[0];
assert.deepEqual([t1.bpm, t1.key, t1.camelot, t1.release, t1.isrc, t1.likes, t1.artist, t1.uploaded], [124, "A:min", "8A", "2024-03-07", "ES1234", 9, "Real Artist", "2024-03-01"]);
assert.equal(r.out.tracks.length, 1, "la pista sin bpm queda fuera del filtro estricto"); assert.equal(r.out.out_of_range_removed, 1);
r = await call("search_tracks", { query: "acid" });
assert.equal(r.out.tracks[1].id, "2", "id sacado de la URN"); assert.equal(r.out.tracks[1].camelot, null);
assert.equal(r.out.next_cursor, `${API}/tracks?cursor=abc`);
console.log("búsqueda:", JSON.stringify(t1));
r = await call("search_tracks", { cursor: r.out.next_cursor });
assert.equal(last().href, `${API}/tracks?cursor=abc`, "el cursor se usa tal cual");
assert.equal((await call("search_tracks", {})).err, true, "sin criterios da error");
assert.match((await call("search_tracks", { query: "x", uploaded_after: "ayer" })).out, /YYYY-MM-DD/);

// 1b. Camelot y filtro estricto también en la página siguiente.
const cam = (k) => S._camelot(k);
assert.deepEqual(["F:min", "C#:min", "Db:min", "C:maj", "F#:maj", "B:maj", "Ab:min", "H:min", "", null].map(cam), ["4A", "12A", "12A", "8B", "2B", "1B", "1A", null, null, null]);
r = await call("search_tracks", { cursor: `${API}/tracks?bpm%5Bfrom%5D=125&bpm%5Bto%5D=130&cursor=z` });
assert.equal(r.out.tracks.length, 0, "el cursor conserva el rango de BPM");

// 2. Seguridad: un cursor de otro dominio no recibe el token.
const n = calls.length;
for (const evil of ["https://evil.example/steal", "http://api.soundcloud.com/tracks", "https://api.soundcloud.com.evil.example/x"]) {
  r = await call("search_tracks", { cursor: evil });
  assert.equal(r.err, true); assert.match(r.out, /not allowed/);
}
assert.equal(calls.length, n, "ninguna petición salió");

// 3. Si la API rechaza access, se repite sin él.
rejectAccess = true;
r = await call("search_tracks", { query: "x" });
assert.equal(r.err, false); assert.equal(last().searchParams.has("access"), false);
rejectAccess = false;

// 4. Relacionadas: por URL, sin la semilla y sin lo que ya está en la playlist.
r = await call("get_related_tracks", { url: "https://soundcloud.com/a/t5", exclude_playlist_id: "soundcloud:playlists:99" });
assert.deepEqual(r.out.tracks.map((t) => t.id), ["6", "8"]); assert.equal(r.out.excluded, 1);
assert.equal((await call("get_related_tracks", { url: "https://soundcloud.com/x/artist" })).err, true, "URL de otro tipo");
console.log("relacionadas:", r.out.tracks.map((t) => t.id), "excluidas:", r.out.excluded);

// 5. Fuentes propias.
r = await call("get_my_tracks", { source: "likes", limit: 5 });
assert.equal(r.out.tracks[0].id, "11"); assert.match(r.out.next_cursor, /cursor=n2/);
r = await call("get_my_tracks", { source: "recently_played" });
assert.equal(r.out.tracks[0].id, "12");
r = await call("get_my_tracks", { source: "feed" });
assert.deepEqual(r.out.tracks.map((t) => [t.id, t.activity]), [["13", "track:repost"]], "solo pistas del feed");
r = await call("get_my_tracks", { source: "followings", limit: 2 });
assert.deepEqual(r.out.tracks.map((t) => t.id), ["14", "15"]);
r = await call("get_my_tracks", { source: "followings", cursor: r.out.next_cursor });
assert.equal(last().searchParams.get("offset"), "2"); assert.deepEqual(r.out.tracks.map((t) => t.id), ["16"]);
assert.equal(r.out.next_cursor, null, "página incompleta: no hay más");
assert.equal((await call("get_my_tracks", { source: "nope" })).err, true);

// 6. Usuarios.
r = await call("search_users", { query: "artist" });
assert.deepEqual(r.out.users[0], { id: "42", username: "artist", name: "A B", followers: 1000, tracks: 50, url: "pu" });
r = await call("get_related_artists", { user_id: "42" });
assert.equal(r.out.users[0].id, "43");
r = await call("get_user_content", { url: "https://soundcloud.com/x/artist", kind: "tracks", sort: "oldest" });
assert.equal(last().searchParams.get("sort"), "asc"); assert.equal(r.out.user.location, "Madrid"); assert.equal(r.out.user.url, "https://soundcloud.com/x/artist", "URL sin utm"); assert.equal(r.out.tracks[0].id, "21");
r = await call("get_user_content", { user_id: "42", kind: "likes" });
assert.equal(r.out.tracks[0].id, "22");
r = await call("get_user_content", { user_id: "42", kind: "playlists" });
assert.equal(r.out.playlists[0].user, "artist");

// 7. Playlists ajenas y emisoras.
r = await call("search_playlists", { query: "minimal" });
assert.equal(r.out.playlists[0].id, "32"); assert.equal(last().searchParams.get("show_tracks"), "false");
r = await call("get_playlist", { url: "https://soundcloud.com/x/set" });
assert.equal(r.out.id, "99");
r = await call("get_my_playlists", { kind: "stations" });
const sid = r.out.stations[0].id;
assert.equal(sid, "soundcloud:system-playlists:track-stations:5");
r = await call("get_station", { station_id: sid });
assert.equal(r.out.tracks[0].id, "41"); assert.equal(r.out.id, sid);
assert.equal((await call("get_station", { station_id: "../../me" })).err, true, "station_id con barras rechazado");
r = await call("get_my_playlists", { kind: "liked" });
assert.equal(r.out.playlists[0].title, "liked pl");
// Filtro por título: sin distinguir mayúsculas ni acentos (norm quita lo que va entre paréntesis).
r = await call("get_my_playlists", { kind: "liked", query: "LIKED" });
assert.deepEqual(r.out.playlists.map((p) => p.title), ["liked pl"]); assert.equal(r.out.total_before_filter, 1);
r = await call("get_my_playlists", { kind: "liked", query: "nada" });
assert.deepEqual(r.out.playlists, []);
console.log("OK");
