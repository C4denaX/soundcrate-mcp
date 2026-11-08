// Bloques 2 y 3: suggest_tracks, find_official_version, analyze_playlist y update_playlist.
// Sin red ni Llavero: la API es un servidor simulado en memoria.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
const API = "https://api.soundcloud.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- Datos simulados -----
const T = (id, o = {}) => ({
  id,
  title: "t" + id,
  user: { username: "u" + id },
  access: "playable",
  duration: 300000,
  bpm: null,
  key_signature: null,
  genre: "Techno",
  playback_count: 100,
  permalink_url: `https://soundcloud.com/x/${id}?utm_source=api`,
  ...o,
});
const TR = {};
const put = (...xs) => xs.forEach((x) => (TR[String(x.id)] = x));
// Playlist 10: orden original 1..5. Saltos de BPM: 2→3 (14) y 3→4 (13). Choques armónicos: 2→3 y 3→4.
put(
  T(1, { title: "Alpha", user: { username: "dj" }, bpm: 128, key_signature: "A:min" }), // 8A
  T(2, { title: "Beta", bpm: 126, key_signature: "C:maj" }), // 8B
  T(3, { title: "Gamma", bpm: 140, key_signature: "F:min" }), // 4A
  T(4, { title: "Delta", bpm: 127, key_signature: "E:min", access: "preview" }), // 9A
  T(5, { title: "Alpha (Original Mix)", user: { username: "dj" }, bpm: 128, key_signature: "A:min" }), // duplicado de 1
  T(6, { title: "Epsilon", bpm: 124, key_signature: "A:min" }), // 8A
  T(7, { title: "Zeta", bpm: 130, key_signature: "C:maj", genre: "House" }), // 8B
  T(8, { title: "Eta", bpm: null, key_signature: null, duration: 60000 }),
  T(9, { title: "Theta", bpm: 125, key_signature: "A:min" }),
  T(10, { title: "Iota", bpm: 200 }),
  T(50, { title: "Night Drive (Original Mix)", user: { username: "bedroom_dj" }, isrc: "ISRC1", bpm: 122, key_signature: "F:min" }),
  T(60, { title: "Night Drive", user: { username: "Label X" }, label_name: "Label X", isrc: "ISRC1" }),
  T(61, { title: "Night Drive (Dave Remix)", user: { username: "remixer" } }),
  T(62, { title: "Night Drive", user: { username: "bedroom_dj" } }),
  T(63, { title: "Something Else", user: { username: "bedroom_dj" } }),
  T(64, { title: "Night Drive - Mashup", user: { username: "mashup_guy" } }) // título parecido, sin señal fuerte
);
const PL = {
  10: { id: 10, title: "Warm-up", description: "", genre: "Techno", tag_list: "", sharing: "private", list: ["1", "2", "3", "4", "5"], hidden: 0 },
  11: { id: 11, title: "Oculta", description: "", genre: "", tag_list: "", sharing: "private", list: ["1", "2", "3", "4", "5"], hidden: 2 },
  99: { id: 99, title: "Excluir", description: "", genre: "", tag_list: "", sharing: "private", list: ["9"], hidden: 0 },
};
const SEARCH = [];
// Las relacionadas son las mismas pistas de TR (no copias), para que compartan tonalidad y duración.
const REL = {
  1: [TR["6"], TR["7"], TR["8"]],
  2: [TR["7"], TR["9"], TR["1"]], // TR["1"] es semilla: no debe salir
};
const view = (p) => ({
  id: p.id,
  title: p.title,
  sharing: p.sharing,
  permalink_url: `https://soundcloud.com/x/sets/${p.id}`,
  track_count: p.list.length,
  tracks: p.list.slice(0, p.list.length - p.hidden).map((id) => TR[id]),
});
let puts = [], dropOnPut = 0, maxInFlight = 0, inFlight = 0;
const calls = [];
const J = (x) => Response.json(x);
const nf = (p) => new Response("nf " + p, { status: 404 });

S._setDeps({
  kcGet: () => "rt",
  kcSet: () => {},
  credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url, o) => {
    const u = new URL(url);
    calls.push(u);
    assert.equal(u.origin, API, "solo la API");
    const p = u.pathname;
    let m;
    if (p === "/tracks") return J({ collection: SEARCH });
    if ((m = p.match(/^\/tracks\/(\d+)\/related$/))) return J({ collection: REL[m[1]] || [] });
    if ((m = p.match(/^\/tracks\/(\d+)$/))) return TR[m[1]] ? J(TR[m[1]]) : nf(p);
    if ((m = p.match(/^\/playlists\/(\d+)$/))) {
      const pl = PL[m[1]];
      if (!pl) return nf(p);
      if (o.method === "GET") {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(10);
        inFlight--;
        return J(view(pl));
      }
      if (o.method === "PUT") {
        const b = JSON.parse(o.body).playlist;
        puts.push({ id: m[1], body: b });
        await sleep(5);
        const { tracks, ...fields } = b;
        Object.assign(pl, fields);
        let list = tracks.map((t) => String(t.id));
        if (dropOnPut) {
          list = list.slice(0, -dropOnPut);
          dropOnPut = 0;
        }
        pl.list = list;
        return J(view(pl));
      }
    }
    return nf(p);
  },
});
const reset = () => {
  PL[10].list = ["1", "2", "3", "4", "5"];
  PL[10].title = "Warm-up";
  PL[10].description = "";
  PL[10].genre = "Techno";
  PL[10].tag_list = "";
  PL[11].list = ["1", "2", "3", "4", "5"];
  puts = [];
  dropOnPut = 0;
};
const call = async (name, args) => {
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return { err: !!r.isError, out: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};
const ids = (xs) => xs.map((x) => x.id);

// ===== suggest_tracks =====
{
  let r = await call("suggest_tracks", { seed_track_ids: ["1", "2"], exclude_playlist_id: "99" });
  assert.equal(r.err, false, r.out);
  // 7 la sugieren las dos semillas; 6 y 8 una; 9 está en la playlist excluida; 1 es semilla.
  assert.deepEqual(ids(r.out.tracks), ["7", "6", "8"], "orden: más semillas, luego armonía");
  assert.equal(r.out.tracks[0].suggested_by, 2);
  assert.equal(r.out.tracks[0].harmonic_with_seed, true, "7 (8B) mezcla con la semilla 2 (8B)");
  assert.equal(r.out.tracks[2].harmonic_with_seed, null, "8 no tiene tonalidad");
  assert.deepEqual(r.out.stats.pool, 3);
  assert.deepEqual(r.out.seeds.map((s) => s.id), ["1", "2"]);
  console.log("suggest:", ids(r.out.tracks), JSON.stringify(r.out.stats));

  // BPM estricto: 7 (130) fuera, 8 (sin BPM) fuera; 6 (124) entra.
  r = await call("suggest_tracks", { seed_track_ids: ["1", "2"], exclude_playlist_id: "99", bpm_min: 120, bpm_max: 128 });
  assert.deepEqual(ids(r.out.tracks), ["6"]);
  assert.equal(r.out.stats.dropped.bpm, 2);

  // Género, sin distinguir mayúsculas.
  r = await call("suggest_tracks", { seed_track_ids: ["1", "2"], exclude_playlist_id: "99", genres: ["house"] });
  assert.deepEqual(ids(r.out.tracks), ["7"]);
  assert.equal(r.out.stats.dropped.genre, 2);

  // Duración mínima: 8 dura 60 s.
  r = await call("suggest_tracks", { seed_track_ids: ["1", "2"], exclude_playlist_id: "99", duration_min_s: 120 });
  assert.deepEqual(ids(r.out.tracks), ["7", "6"]);
  assert.equal(r.out.stats.dropped.duration, 1);

  // Límite: devuelve solo N y avisa de cuántas quedan.
  r = await call("suggest_tracks", { seed_track_ids: ["1", "2"], exclude_playlist_id: "99", limit: 1 });
  assert.equal(r.out.tracks.length, 1); assert.equal(r.out.stats.more, 2);

  // Validación y solo lectura.
  assert.equal((await call("suggest_tracks", { seed_track_ids: [] })).err, true);
  assert.equal((await call("suggest_tracks", { seed_track_ids: ["1", "2", "3", "4", "5", "6"] })).err, true, "máximo 5 semillas");
  const n = puts.length;
  await call("suggest_tracks", { seed_track_ids: ["1"] });
  assert.equal(puts.length, n, "suggest_tracks no escribe");
}

// ===== find_official_version =====
{
  SEARCH.splice(0, SEARCH.length, TR["60"], TR["61"], TR["62"], TR["63"], TR["64"], TR["50"]);
  const r = await call("find_official_version", { track_id: "50" });
  assert.equal(r.err, false, r.out);
  assert.deepEqual(ids(r.out.candidates), ["60", "62"], "remix y títulos distintos fuera");
  const [best, second] = r.out.candidates;
  assert.equal(best.likely_official, true, "mismo ISRC");
  assert.ok(best.reasons.includes("same ISRC"));
  assert.ok(best.reasons.some((x) => x.startsWith("label:")));
  assert.equal(second.likely_official, false);
  assert.equal(second.reasons.includes("same artist"), true);
  assert.equal(r.out.original.id, "50");
  console.log("oficial:", best.id, best.reasons.join(", "), "| 2º:", second.id, second.score);
  assert.equal((await call("find_official_version", { track_id: "abc" })).err, true);
  SEARCH.length = 0;
}

// ===== analyze_playlist =====
{
  let r = await call("analyze_playlist", { playlist_id: "10" });
  assert.equal(r.err, false, r.out);
  const a = r.out;
  assert.equal(a.tracks_read, 5);
  assert.equal(a.total_duration, "25:00");
  assert.deepEqual(a.bpm, { min: 126, median: 128, max: 140, with_bpm: 5, without_bpm: 0 });
  assert.deepEqual(a.duplicates, [[{ position: 1, id: "1", title: "Alpha" }, { position: 5, id: "5", title: "Alpha (Original Mix)" }]]);
  assert.equal(a.bpm_jumps.total, 2);
  assert.deepEqual(a.bpm_jumps.examples[0].between, [2, 3]);
  assert.equal(a.harmonic_clashes.total, 2, "2→3 y 3→4");
  assert.deepEqual(a.access, { playable: 4, preview: 1 });
  assert.equal(a.camelot["8A"], 2);
  assert.equal(a.playlist.id, "10");
  console.log("análisis:", JSON.stringify({ dur: a.total_duration, bpm: a.bpm, dup: a.duplicates.length, jumps: a.bpm_jumps.total, clashes: a.harmonic_clashes.total }));

  // Lista con pistas ocultas: informa, no falla.
  r = await call("analyze_playlist", { playlist_id: "11" });
  assert.equal(r.err, false); assert.equal(r.out.hidden_by_api, 2); assert.equal(r.out.tracks_read, 3);
}

// ===== update_playlist =====
{
  // Ordenar por BPM ascendente. Empates: el orden original.
  reset();
  let r = await call("update_playlist", { playlist_id: "10", sort_by: "bpm" });
  assert.equal(r.err, false, r.out);
  assert.deepEqual(PL[10].list, ["2", "4", "1", "5", "3"]);
  assert.equal(r.out.reordered, true); assert.deepEqual(r.out.changed, ["order"]); assert.equal(r.out.total, 5);
  assert.equal(puts.length, 1, "una sola escritura");
  assert.deepEqual(puts[0].body.tracks.map((t) => t.id), ["2", "4", "1", "5", "3"], "IDs como cadena");

  // Camelot ascendente: 8A(1,5), 8B(2), 4A(3), 9A(4) → 3,1,5,2,4
  reset();
  r = await call("update_playlist", { playlist_id: "10", sort_by: "camelot", direction: "asc" });
  assert.deepEqual(PL[10].list, ["3", "1", "5", "2", "4"]);

  // Duración descendente (todas iguales: no cambia el orden).
  reset();
  r = await call("update_playlist", { playlist_id: "10", sort_by: "duration", direction: "desc" });
  assert.equal(r.out.reordered, false); assert.deepEqual(PL[10].list, ["1", "2", "3", "4", "5"]);

  // Orden manual válido.
  reset();
  r = await call("update_playlist", { playlist_id: "10", track_order: ["5", "4", "3", "2", "1"] });
  assert.deepEqual(PL[10].list, ["5", "4", "3", "2", "1"]);

  // Metadatos sin tocar el orden: el conjunto se reenvía igual.
  reset();
  r = await call("update_playlist", { playlist_id: "10", title: " Peak time ", description: "Set de 2 h", genre: "Melodic Techno", tags: "warm, deep house" });
  assert.equal(r.err, false, r.out);
  assert.equal(PL[10].title, "Peak time"); assert.equal(PL[10].description, "Set de 2 h"); assert.equal(PL[10].genre, "Melodic Techno"); assert.equal(PL[10].tag_list, 'warm "deep house"', "etiquetas en formato SoundCloud");
  assert.deepEqual(PL[10].list, ["1", "2", "3", "4", "5"], "las pistas no cambian");
  assert.deepEqual(r.out.changed, ["title", "description", "genre", "tag_list"]);
  assert.equal(r.out.reordered, false);
  assert.deepEqual(puts[0].body.tracks.map((t) => t.id), ["1", "2", "3", "4", "5"]);

  // Validaciones: ninguna escribe.
  reset();
  const cases = [
    [{ playlist_id: "10", track_order: ["1", "2", "3", "4"] }, /exactly the 5/],
    [{ playlist_id: "10", track_order: ["1", "1", "2", "3", "4"] }, /exactly the 5/],
    [{ playlist_id: "10", track_order: ["1", "2", "3", "4", "99"] }, /exactly the 5/],
    [{ playlist_id: "10", sort_by: "bpm", track_order: ["1", "2", "3", "4", "5"] }, /not both/],
    [{ playlist_id: "10" }, /Nothing to change/],
    [{ playlist_id: "10", title: "   " }, /cannot be empty/],
    [{ playlist_id: "10", sort_by: "popularidad" }, /sort_by must be/],
    [{ playlist_id: "11", title: "x" }, /hides 2 of the 5/],
    [{ playlist_id: "11", sort_by: "bpm" }, /hides 2 of the 5/],
  ];
  for (const [args, re] of cases) {
    r = await call("update_playlist", args);
    assert.equal(r.err, true, JSON.stringify(args));
    assert.match(r.out, re, JSON.stringify(args));
  }
  assert.equal(puts.length, 0, "ninguna validación llegó a escribir");
  assert.deepEqual(PL[11].list, ["1", "2", "3", "4", "5"]);

  // La API deja caer una pista al escribir: se restaura el orden anterior y se avisa.
  reset();
  dropOnPut = 1;
  r = await call("update_playlist", { playlist_id: "10", sort_by: "bpm", direction: "desc" });
  assert.equal(r.err, true); assert.match(r.out, /restored/);
  assert.equal(puts.length, 2, "escritura + restauración");
  assert.deepEqual(puts[1].body.tracks.map((t) => t.id), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(PL[10].list, ["1", "2", "3", "4", "5"]);

  // Dos cambios a la vez sobre la misma playlist: van en cola y no se pisan.
  reset();
  maxInFlight = 0;
  const [x, y] = await Promise.all([
    call("update_playlist", { playlist_id: "10", title: "Uno", sort_by: "bpm" }),
    call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["6"] }),
  ]);
  assert.equal(x.err, false, x.out); assert.equal(y.err, false, y.out);
  // Orden exacto: primero se reordena (llamada anterior en la cola), luego se añade al final.
  assert.deepEqual(PL[10].list, ["2", "4", "1", "5", "3", "6"], "sin cerrojo el reordenado se perdería");
  assert.equal(PL[10].title, "Uno");
  console.log("update: orden final", PL[10].list.join(","));
  reset();

  // Dos borrados a la vez: sin cerrojo, el segundo escribe sobre una lectura anterior y revive la pista quitada.
  reset();
  const [d1, d2] = await Promise.all([
    call("remove_track_from_playlist", { playlist_id: "10", track_id: "1" }),
    call("remove_track_from_playlist", { playlist_id: "10", track_id: "2" }),
  ]);
  assert.equal(d1.err, false); assert.equal(d2.err, false);
  assert.deepEqual(PL[10].list, ["3", "4", "5"], "ambos borrados se aplican");
  reset();
}

// Ninguna herramienta nueva toca otras playlists.
assert.equal(PL[99].list.join(), "9", "la playlist excluida no se ha tocado");

// Versión y lista de herramientas.
const init = await S.handle({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} });
assert.equal(init.result.serverInfo.version, "1.5.0");
const names = (await S.handle({ jsonrpc: "2.0", id: 10, method: "tools/list" })).result.tools.map((t) => t.name);
for (const n of ["suggest_tracks", "find_official_version", "analyze_playlist", "update_playlist"]) assert.ok(names.includes(n), n);
console.log("OK");
