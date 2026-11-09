// Lote D · auth, API y protocolo (revisión 1.7.0): validación de argumentos (#5), 429/5xx/timeout (#6, #28),
// refresh token (#8, #12, #17, T3, T7), paginación de get_playlist (#9), orden Camelot (#10, T8), secretos (#19),
// cierre con stdin (#24), cancelación (#26), textos Go+ (#27, #31), cursores (#29), start_setup (T1, #18, #21, #22).
// Sin red ni Llavero: la API es un servidor simulado y las credenciales son falsas. Cada caso usa una instancia
// nueva de server.mjs y se ejecuta aunque otro falle; al final se listan los que fallan y el código de salida es ≠0.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createStore } from "../secrets.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const fresh = async () => import(`../server.mjs?lote-d-${++n}`);
const J = (o, init) => Response.json(o, init);
const T = (id, extra = {}) => ({ id: Number(id), title: "t" + id, user: { username: "u" }, access: "playable", duration: 60000, permalink_url: "p" + id, ...extra });

// Servidor con una API simulada: `route(url, o)` devuelve la Response. Registra las peticiones en `calls`.
async function boot(route, deps = {}) {
  const S = await fresh();
  const calls = [];
  const kc = { refresh_token: "rt0" };
  S._setDeps({
    goPlus: false,
    restoreRetryMs: 1,
    secretGet: (a) => kc[a] ?? null,
    secretSet: (a, v) => (kc[a] = v),
    credentials: () => ({ clientId: "cid", clientSecret: "sec" }),
    tokenRequest: async () => ({ access_token: "at", refresh_token: "rt-next", expires_in: 3600 }),
    fetch: async (url, o) => {
      calls.push({ url: String(url), method: o?.method || "GET", auth: o?.headers?.Authorization, body: o?.body });
      return route(new URL(url), o || {}, calls.length);
    },
    ...deps,
  });
  let nid = 100;
  const call = async (name, args = {}) => {
    const r = await S.handle({ jsonrpc: "2.0", id: ++nid, method: "tools/call", params: { name, arguments: args } });
    if (r === null) return null;
    const res = r.result;
    const text = res.content[0].text;
    return res.isError ? { err: true, text } : { err: false, out: JSON.parse(text) };
  };
  return { S, calls, kc, call };
}

// Entorno de los procesos hijos: hereda process.env (en Windows hace falta SystemRoot, etc.) y solo pisa lo que aísla.
const isoEnv = (dir, extra = {}) => {
  const env = { ...process.env };
  for (const k of ["SC_CLIENT_ID", "SC_CLIENT_SECRET", "SC_GO_PLUS", "SC_REDIRECT_URI", "SOUNDCRATE_DIST", "CLAUDE_PLUGIN_ROOT"]) delete env[k];
  return {
    ...env,
    HOME: dir,
    USERPROFILE: dir,
    APPDATA: dir,
    XDG_CONFIG_HOME: dir,
    SC_SECRET_STORE: "file",
    SC_SECRETS_FILE: path.join(dir, "creds.json"),
    SC_SECRET_SERVICE: "soundcrate-review",
    ...extra,
  };
};

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// ===== #5 + T9: validación y coerción de argumentos =====
test("#5 create_playlist public:\"false\" crea una playlist privada; \"true\" la publica; un valor dudoso se rechaza", async () => {
  const { call, calls } = await boot((u, o) => {
    if (u.pathname === "/playlists" && o.method === "POST") {
      const b = JSON.parse(o.body).playlist;
      return J({ id: 77, title: b.title, sharing: b.sharing, track_count: 0, permalink_url: "u" });
    }
    return new Response("nf", { status: 404 });
  });
  let r = await call("create_playlist", { title: "Mi set privado", public: "false" });
  assert.equal(r.err, false);
  assert.equal(JSON.parse(calls.at(-1).body).playlist.sharing, "private");
  r = await call("create_playlist", { title: "x", public: "FALSE" });
  assert.equal(JSON.parse(calls.at(-1).body).playlist.sharing, "private");
  r = await call("create_playlist", { title: "x", public: false });
  assert.equal(JSON.parse(calls.at(-1).body).playlist.sharing, "private");
  r = await call("create_playlist", { title: "x", public: "true" });
  assert.equal(JSON.parse(calls.at(-1).body).playlist.sharing, "public");
  const before = calls.length;
  r = await call("create_playlist", { title: "x", public: "quizás" });
  assert.equal(r.err, true);
  assert.match(r.text, /public/); assert.match(r.text, /boolean/); assert.match(r.text, /Nothing was done/);
  assert.equal(calls.length, before, "un argumento inválido no llega a la API");
});

test("#5 only_listenable:\"false\" no filtra; \"true\" filtra", async () => {
  const { call } = await boot((u) =>
    u.pathname === "/tracks" ? J({ collection: [T(1), T(2, { access: "preview" }), T(3, { access: "blocked" })] }) : new Response("nf", { status: 404 })
  );
  let r = await call("search_tracks", { query: "x", only_listenable: "false" });
  assert.equal(r.out.tracks.length, 3, "con \"false\" no se descarta nada");
  assert.equal(r.out.not_listenable_removed, undefined);
  r = await call("search_tracks", { query: "x", only_listenable: "true" });
  assert.deepEqual(r.out.tracks.map((t) => t.id), ["1"]);
  r = await call("search_tracks", { query: "x", only_listenable: false });
  assert.equal(r.out.tracks.length, 3);
});

test("#5 include_restricted:\"false\" no pide access; enteros y números como texto; null se omite", async () => {
  const { call, calls } = await boot((u) => (u.pathname === "/tracks" ? J({ collection: [T(1, { bpm: 124 })] }) : new Response("nf", { status: 404 })));
  await call("search_tracks", { query: "x", include_restricted: "false", limit: "5", bpm_min: "120", bpm_max: 130, genres: null });
  const q = new URL(calls.at(-1).url).searchParams;
  assert.equal(q.get("access"), null);
  assert.equal(q.get("limit"), "5");
  assert.equal(q.get("bpm[from]"), "120");
  assert.equal(q.get("bpm[to]"), "130");
  await call("search_tracks", { query: "x", include_restricted: null });
  assert.equal(new URL(calls.at(-1).url).searchParams.get("access"), "playable,preview,blocked", "null = omitido = valor por defecto");
});

test("#5 listas como texto, ids numéricos, enums, requeridos y entradas que no encajan", async () => {
  const { call, calls } = await boot((u) => {
    if (u.pathname === "/tracks") return J({ collection: [T(1)] });
    if (u.pathname === "/tracks/55") return J(T(55));
    return new Response("nf", { status: 404 });
  });
  await call("search_tracks", { genres: '["Techno","House"]' });
  assert.equal(new URL(calls.at(-1).url).searchParams.get("genres"), "Techno,House");
  await call("search_tracks", { tags: "deep, warm" });
  assert.equal(new URL(calls.at(-1).url).searchParams.get("tags"), "deep,warm");
  let r = await call("get_track", { track_id: 55 });
  assert.equal(r.out.id, "55", "id numérico");
  r = await call("get_my_tracks", { source: "nope" });
  assert.equal(r.err, true); assert.match(r.text, /source must be one of likes/);
  r = await call("get_my_tracks", {});
  assert.equal(r.err, true); assert.match(r.text, /Missing required argument "source"/);
  r = await call("search_tracks", { query: "x", limit: "muchos" });
  assert.equal(r.err, true); assert.match(r.text, /limit/); assert.match(r.text, /whole number/);
  r = await call("search_tracks", { query: "x", limit: 2.5 });
  assert.equal(r.err, true);
  r = await call("search_tracks", { query: { a: 1 } });
  assert.equal(r.err, true); assert.match(r.text, /query/);
  r = await call("search_tracks", { query: "x", genres: { a: 1 } });
  assert.equal(r.err, true);
  r = await call("search_tracks", { query: "x", genres: 5 }); // un valor suelto vale como lista de uno
  assert.equal(r.err, false);
  assert.equal(new URL(calls.at(-1).url).searchParams.get("genres"), "5");
  // Varios problemas a la vez: se dicen todos.
  r = await call("search_tracks", { query: "x", limit: "a", only_listenable: "q" });
  assert.match(r.text, /limit/); assert.match(r.text, /only_listenable/);
});

test("#5 las herramientas de quitar pistas aceptan all_copies, position y track_ids como texto", async () => {
  let list = ["1", "2", "2", "3"];
  const puts = [];
  const { call } = await boot((u, o) => {
    if (u.pathname !== "/playlists/10") return new Response("nf", { status: 404 });
    if (o.method === "PUT") {
      list = JSON.parse(o.body).playlist.tracks.map((t) => t.id);
      puts.push(list);
    }
    return J({ id: 10, title: "p", sharing: "private", track_count: list.length, permalink_url: "u", tracks: list.map((i) => T(i)) });
  });
  let r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: "2", all_copies: "false" });
  assert.equal(r.err, true, "all_copies:\"false\" no borra las dos copias");
  assert.equal(puts.length, 0);
  r = await call("remove_track_from_playlist", { playlist_id: "10", track_id: "2", position: "3" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(list, ["1", "2", "3"]);
  list = ["1", "2", "2", "3"];
  r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: "[\"2\",\"3\"]", all_copies: "true" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(list, ["1"]);
});

test("#5 open_browser:\"false\" llega como false a start_setup; verify_session:\"false\" no llama a /me", async () => {
  const seen = [];
  const { call, calls } = await boot(() => J({ id: 1, username: "dj" }), {
    startSetup: async (o) => (seen.push(o), { url: "http://127.0.0.1:8976/setup?k=a", opened: o.open, already_running: false, store: "S" }),
    store: () => ({ label: "S", probe: () => ({ ok: true }) }),
  });
  await call("start_setup", { open_browser: "false" });
  assert.equal(seen[0].open, false);
  await call("setup_status", { verify_session: "false" });
  assert.equal(calls.filter((c) => c.url.endsWith("/me")).length, 0);
});

// ===== #6 + T9: 429, 5xx y timeout no se repiten sin access =====
for (const [label, make] of [
  ["429", () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } })],
  ["503", () => new Response("down", { status: 503 })],
  ["500", () => new Response("boom", { status: 500 })],
  ["timeout", () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); }],
]) {
  test(`#6 ${label}: una sola petición e isError en search_tracks, get_my_tracks, get_user_content y get_station`, async () => {
    const { call, calls } = await boot((u) => {
      if (u.pathname === "/resolve") return J({ kind: "user", id: 5, username: "a" });
      return make();
    });
    for (const [name, args] of [
      ["search_tracks", { query: "x" }],
      ["get_my_tracks", { source: "likes" }],
      ["get_related_tracks", { track_id: "9" }],
      ["search_playlists", { query: "x" }],
      ["get_user_content", { user_id: "5", kind: "tracks" }],
      ["get_station", { station_id: "soundcloud:system-playlists:track-stations:1" }],
    ]) {
      const before = calls.length;
      const r = await call(name, args);
      assert.equal(r.err, true, `${name}: isError`);
      assert.equal(calls.length - before, 1, `${name}: una sola petición (${calls.slice(before).map((c) => c.url).join(" | ")})`);
    }
  });
}

test("#6 solo 400 y 422 repiten sin access, y la respuesta avisa de que faltan las pistas blocked", async () => {
  for (const status of [400, 422]) {
    const { call, calls } = await boot((u) => {
      if (u.searchParams.get("access")) return new Response("bad access", { status });
      return J({ collection: [T(1)] });
    });
    const r = await call("search_tracks", { query: "x" });
    assert.equal(r.err, false);
    assert.equal(calls.length, 2);
    assert.equal(r.out.access_filter, "api_default"); assert.match(r.out.note, /blocked/);
  }
  const { call, calls } = await boot((u) => (u.searchParams.get("access") ? new Response("nf", { status: 404 }) : J({ collection: [] })));
  assert.equal((await call("search_tracks", { query: "x" })).err, true);
  assert.equal(calls.length, 1, "404 no se repite");
  // get_station igual
  const st = await boot((u) => (u.searchParams.get("access") ? new Response("bad", { status: 400 }) : J({ urn: "soundcloud:system-playlists:x:1", title: "s", tracks: [T(1)] })));
  const r = await st.call("get_station", { station_id: "soundcloud:system-playlists:x:1" });
  assert.equal(r.err, false); assert.equal(r.out.access_filter, "api_default"); assert.equal(st.calls.length, 2);
});

// ===== #28: el mensaje del 429 dice cuándo se restablece =====
test("#28 el 429 usa Retry-After / X-RateLimit-Reset y no dice 'wait a moment'", async () => {
  const msg = async (headers) => {
    const { call } = await boot(() => new Response("", { status: 429, headers }));
    return (await call("get_track", { track_id: "1" })).text;
  };
  let t = await msg({ "retry-after": "1800" });
  assert.match(t, /resets in ~30 min \(at \d\d:\d\d\)/); assert.match(t, /Do not retry before then/);
  t = await msg({ "retry-after": "30" });
  assert.match(t, /~30 s/);
  t = await msg({ "retry-after": new Date(Date.now() + 2 * 3600 * 1000 + 5000).toUTCString() });
  assert.match(t, /~2 h/);
  t = await msg({ "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) });
  assert.match(t, /~(60|61) min|~1 h/);
  t = await msg({ "x-ratelimit-reset": "600" });
  assert.match(t, /~10 min/);
  t = await msg({});
  assert.match(t, /did not say when it resets/); assert.match(t, /Do not retry/);
  assert.doesNotMatch(t, /wait a moment/);
});

// ===== #8 / T7: el refresh token rotado no se pierde si falla el guardado =====
test("T7 #8 secretSet falla una vez tras la rotación: la llamada en curso y la siguiente funcionan y el almacén acaba con el token vigente", async () => {
  let fail = true, exchanges = 0;
  const kc = { refresh_token: "rt0" };
  const { call, calls } = await boot(() => J({ id: 1, username: "dj" }), {
    secretGet: (a) => kc[a] ?? null,
    secretSet: (a, v) => {
      if (fail) { fail = false; throw new Error("User interaction is not allowed."); }
      kc[a] = v;
    },
    tokenRequest: async (p) => {
      exchanges++;
      if (p.refresh_token !== kc.refresh_token && p.refresh_token !== "rt1") throw new Error("SoundCloud /oauth/token 400: invalid_grant");
      return { access_token: "at" + exchanges, refresh_token: "rt" + exchanges, expires_in: 3600 };
    },
  });
  let r = await call("whoami");
  assert.equal(r.err, false, r.text);
  assert.equal(kc.refresh_token, "rt0", "el almacén falló: sigue el viejo");
  r = await call("whoami");
  assert.equal(r.err, false, r.text);
  assert.equal(kc.refresh_token, "rt1", "la siguiente llamada reintenta el guardado");
  assert.equal(exchanges, 1);
  assert.equal(calls.length, 2);
});

test("T7 #8 con el almacén caído varias llamadas seguidas, la sesión sigue con el token rotado (no el viejo del almacén)", async () => {
  let storeDown = true, current = "rt0";
  const kc = { refresh_token: "rt0" };
  const used = [];
  const { call } = await boot(() => J({ id: 1, username: "dj" }), {
    secretGet: (a) => kc[a] ?? null,
    secretSet: (a, v) => { if (storeDown) throw new Error("locked"); kc[a] = v; },
    tokenRequest: async (p) => {
      used.push(p.refresh_token);
      if (p.refresh_token !== current) throw new Error("SoundCloud /oauth/token 400: invalid_grant");
      current = "rt" + (used.length);
      return { access_token: "at", refresh_token: current, expires_in: 100 };
    },
  });
  for (let i = 0; i < 3; i++) {
    const r = await call("whoami", { force_refresh: true });
    assert.equal(r.err, false, `llamada ${i + 1}: ${r.text}`);
  }
  assert.deepEqual(used, ["rt0", "rt1", "rt2"], "cada canje usa el token rotado, no el viejo del almacén");
  storeDown = false;
  const r = await call("whoami");
  assert.equal(r.err, false);
  assert.deepEqual(used, ["rt0", "rt1", "rt2", "rt3"]);
  assert.equal(kc.refresh_token, "rt4", "al volver el almacén se guarda el último token rotado");
});

// ===== #12: single-flight del refresh =====
test("#12 tres herramientas en paralelo con el token caducado canjean el refresh token UNA vez", async () => {
  let exchanges = 0;
  const kc = { refresh_token: "rt0" };
  const { call } = await boot(
    (u) => {
      if (u.pathname === "/me") return J({ id: 1, username: "dj" });
      if (u.pathname === "/tracks") return J({ collection: [T(1)] });
      return J(T(7));
    },
    {
      secretGet: (a) => kc[a] ?? null,
      secretSet: (a, v) => (kc[a] = v),
      tokenRequest: async (p) => {
        exchanges++;
        await sleep(20);
        if (p.refresh_token !== kc.refresh_token) throw new Error("SoundCloud /oauth/token 400: invalid_grant");
        return { access_token: "at", refresh_token: "rt" + exchanges, expires_in: 3600 };
      },
    }
  );
  const rs = await Promise.all([call("whoami"), call("search_tracks", { query: "x" }), call("get_track", { track_id: "7" })]);
  assert.equal(exchanges, 1);
  for (const r of rs) assert.equal(r.err, false, r.text);
  assert.equal(kc.refresh_token, "rt1");
});

// ===== T3: refresh rechazado -> SetupError =====
test("T3 un refresh rechazado (400 o 401) guía al usuario; un 500 no", async () => {
  for (const code of [400, 401]) {
    let reads = 0;
    const { call } = await boot(() => J({ id: 1, username: "dj" }), {
      credentials: () => (reads++, { clientId: "cid" + reads, clientSecret: "s" }),
      tokenRequest: async () => { throw new Error(`SoundCloud /oauth/token ${code}: {"error":"invalid_client"}`); },
    });
    const r = await call("whoami");
    assert.equal(r.err, true);
    assert.match(r.text, /connect again/); assert.match(r.text, /setup_status/);
    await call("whoami");
    assert.equal(reads, 2, "tras el rechazo las credenciales se vuelven a leer");
  }
  const { call } = await boot(() => J({}), { tokenRequest: async () => { throw new Error("SoundCloud /oauth/token 500: oops"); } });
  const r = await call("whoami");
  assert.equal(r.err, true);
  assert.match(r.text, /500/); assert.doesNotMatch(r.text, /setup_status/); assert.doesNotMatch(r.text, /connect again/);
});

// ===== #17: dos procesos renuevan a la vez =====
test("#17 si otro proceso rotó el token (el almacén tiene otro), se reintenta con el vigente en vez de pedir reconectar", async () => {
  const kc = { refresh_token: "rt0" };
  const used = [];
  const { call, calls } = await boot(() => J({ id: 1, username: "dj" }), {
    secretGet: (a) => kc[a] ?? null,
    secretSet: (a, v) => (kc[a] = v),
    tokenRequest: async (p) => {
      used.push(p.refresh_token);
      if (p.refresh_token === "rt0") {
        kc.refresh_token = "rt-other"; // el otro proceso ya lo había canjeado y guardó el suyo
        throw new Error("SoundCloud /oauth/token 400: invalid_grant");
      }
      return { access_token: "at", refresh_token: "rt-mine", expires_in: 3600 };
    },
  });
  const r = await call("whoami");
  assert.equal(r.err, false, r.text);
  assert.deepEqual(used, ["rt0", "rt-other"]);
  assert.equal(kc.refresh_token, "rt-mine");
  assert.equal(calls.length, 1);
});

test("#17 si el almacén no ha cambiado, el rechazo sí pide reconectar (y sin reintento)", async () => {
  const used = [];
  const { call } = await boot(() => J({}), {
    tokenRequest: async (p) => { used.push(p.refresh_token); throw new Error("SoundCloud /oauth/token 400: invalid_grant"); },
  });
  const r = await call("whoami");
  assert.equal(r.err, true); assert.match(r.text, /connect again/);
  assert.deepEqual(used, ["rt0"]);
});

// ===== #9: get_playlist paginado =====
const bigPlaylist = (count) => {
  const tracks = Array.from({ length: count }, (_, i) => T(i + 1, { bpm: 120 + (i % 10), key_signature: "A:min", genre: "Techno", tag_list: "a b", label_name: "L" }));
  return (u) => (u.pathname === "/playlists/10" ? J({ id: 10, title: "big", sharing: "private", track_count: count, permalink_url: "u", tracks }) : new Response("nf", { status: 404 }));
};
test("#9 get_playlist: 100 pistas por defecto, next_offset, positions y respuesta sin sangría", async () => {
  const { call, S } = await boot(bigPlaylist(250));
  const raw = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_playlist", arguments: { playlist_id: "10" } } })).result.content[0].text;
  assert.ok(!raw.includes("\n"), "JSON compacto");
  let r = await call("get_playlist", { playlist_id: "10" });
  assert.equal(r.out.tracks.length, 100); assert.equal(r.out.total, 250); assert.equal(r.out.next_offset, 100);
  assert.equal(r.out.tracks[0].position, 1); assert.equal(r.out.tracks[99].position, 100);
  r = await call("get_playlist", { playlist_id: "10", offset: "100", limit: "100" });
  assert.equal(r.out.tracks[0].position, 101); assert.equal(r.out.tracks[0].id, "101"); assert.equal(r.out.next_offset, 200);
  r = await call("get_playlist", { playlist_id: "10", offset: 200, limit: 200 });
  assert.equal(r.out.tracks.length, 50); assert.equal(r.out.next_offset, null);
  r = await call("get_playlist", { playlist_id: "10", offset: 900 });
  assert.equal(r.out.tracks.length, 0); assert.equal(r.out.next_offset, null);
});
test("#9 get_playlist compact: solo position, id, title, user, bpm, camelot y listen", async () => {
  const { call } = await boot(bigPlaylist(5));
  const r = await call("get_playlist", { playlist_id: "10", compact: "true" });
  assert.deepEqual(Object.keys(r.out.tracks[0]), ["position", "id", "title", "user", "bpm", "camelot", "listen"]);
  assert.equal(r.out.tracks[0].camelot, "8A");
  const full = await call("get_playlist", { playlist_id: "10" });
  assert.ok(Object.keys(full.out.tracks[0]).length > 10);
});

// ===== #10 / T8: orden Camelot mezclable =====
const KEY = {
  A: { 1: "Ab", 2: "Eb", 3: "Bb", 4: "F", 5: "C", 6: "G", 7: "D", 8: "A", 9: "E", 10: "B", 11: "Gb", 12: "Db" },
  B: { 1: "B", 2: "Gb", 3: "Db", 4: "Ab", 5: "Eb", 6: "Bb", 7: "F", 8: "C", 9: "G", 10: "D", 11: "A", 12: "E" },
};
const keySig = (c) => `${KEY[c.slice(-1)][c.slice(0, -1)]}:${c.endsWith("A") ? "min" : "maj"}`;
async function camelotPlaylist(order, sortArgs) {
  let list = order.map((_, i) => String(i + 1));
  const keys = Object.fromEntries(order.map((c, i) => [String(i + 1), keySig(c)]));
  const { call } = await boot((u, o) => {
    if (u.pathname !== "/playlists/10") return new Response("nf", { status: 404 });
    if (o.method === "PUT") list = JSON.parse(o.body).playlist.tracks.map((t) => t.id);
    return J({ id: 10, title: "p", sharing: "private", track_count: list.length, permalink_url: "u", tracks: list.map((i) => T(i, { key_signature: keys[i] })) });
  });
  const r = await call("update_playlist", { playlist_id: "10", ...sortArgs });
  assert.equal(r.err, false, r.text);
  const a = await call("analyze_playlist", { playlist_id: "10" });
  return { order: list.map((i) => order[+i - 1]), clashes: a.out.harmonic_clashes.total };
}
test("T8 #10 8A 9A 10A 10B 9B 8B ordenado por camelot no genera choques (asc y desc)", async () => {
  const set = ["8A", "9A", "10A", "10B", "9B", "8B"];
  let r = await camelotPlaylist(set, { sort_by: "camelot" });
  assert.equal(r.clashes, 0, r.order.join(" "));
  assert.deepEqual(r.order, ["8B", "8A", "9A", "9B", "10B", "10A"]);
  r = await camelotPlaylist(set, { sort_by: "camelot", direction: "desc" });
  assert.equal(r.clashes, 0, r.order.join(" "));
});
test("#10 la rueda completa (24 claves) ordenada por camelot no tiene choques, asc ni desc", async () => {
  const all = [];
  for (let k = 1; k <= 12; k++) all.push(k + "A", k + "B");
  const shuffled = [...all].sort((a, b) => ((a.length * 7 + a.charCodeAt(0) * 13) % 11) - ((b.length * 7 + b.charCodeAt(0) * 13) % 11));
  for (const direction of ["asc", "desc"]) {
    const r = await camelotPlaylist(shuffled, { sort_by: "camelot", direction });
    assert.equal(r.clashes, 0, r.order.join(" "));
    assert.equal(r.order.length, 24);
  }
});

// ===== #19: un credentials.json mal formado no filtra fragmentos =====
test("#19 un fichero de credenciales mal formado no cita su contenido en el error", async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sc-lote-d-"));
  try {
    const file = path.join(dir, "creds.json");
    for (const bad of ['{"soundcrate":{"client_secret": SUPERSECRETVALUE123456 }}', '{"a": tOPSECRETabcdef}', "[1,2]", "null", ""]) {
      fs.writeFileSync(file, bad);
      const st = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: file }, platform: "linux", run: () => ({}) });
      let msg = null;
      try { st.get("client_secret"); } catch (e) { msg = e.message; }
      assert.ok(msg, `debe fallar con ${JSON.stringify(bad)}`);
      assert.match(msg, /not valid JSON/);
      assert.doesNotMatch(msg, /SUPERSECRET|OPSECRET|abcdef/);
    }
    // Un error de E/S sí conserva su mensaje (no es un volcado del contenido).
    fs.mkdirSync(path.join(dir, "d"));
    const st = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: path.join(dir, "d") }, platform: "linux", run: () => ({}) });
    assert.throws(() => st.get("x"), /EISDIR/);
    // Un fichero válido y uno inexistente siguen funcionando.
    fs.writeFileSync(file, JSON.stringify({ soundcrate: { client_id: "abc12345" } }));
    const ok = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: file, SC_SECRET_SERVICE: "soundcrate" }, platform: "linux", run: () => ({}) });
    assert.equal(ok.get("client_id"), "abc12345");
    const none = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: path.join(dir, "nada.json") }, platform: "linux", run: () => ({}) });
    assert.equal(none.get("client_id"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== #24: stdin cerrado detiene el servidor aunque haya una página de configuración =====
const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on("error", rej);
  });
test("#24 al cerrarse stdin con start_setup activo el proceso sale solo y libera el puerto", async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sc-lote-d-"));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    env: isoEnv(dir, {
      SC_REDIRECT_URI: `http://127.0.0.1:${port}/callback`,
      SC_CLIENT_ID: "fake-client-id",
      SC_CLIENT_SECRET: "fake-client-secret",
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", () => {});
  let exited = null;
  child.on("exit", (code, sig) => (exited = { code, sig }));
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "start_setup", arguments: { open_browser: false } } }) + "\n");
    for (let i = 0; i < 100 && !out.includes('"id":1'); i++) await sleep(50);
    assert.ok(out.includes('"id":1'), "start_setup respondió: " + out);
    assert.match(out, /127\.0\.0\.1:\d+\/setup\?k=/);
    child.stdin.end();
    for (let i = 0; i < 60 && !exited; i++) await sleep(100); // hasta 6 s (el temporizador de la página es de 20 minutos)
    assert.ok(exited, "el proceso debe salir solo al cerrarse stdin");
    assert.equal(exited.code, 0);
    await new Promise((res, rej) => {
      const s = net.createServer();
      s.once("error", rej);
      s.listen(port, "127.0.0.1", () => s.close(res));
    });
  } finally {
    child.kill("SIGKILL");
    // Windows: rmdir falla con EBUSY si el hijo aún no ha salido (aunque esté matado). Esperar al 'exit' y usar
    // reintentos al borrar.
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("#24 con stdin cerrado el servidor contesta antes de salir (varias peticiones en cola)", async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sc-lote-d-"));
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    env: isoEnv(dir),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", () => {});
  const exited = new Promise((r) => child.on("exit", r));
  try {
    child.stdin.end(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n" + JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n"
    );
    await Promise.race([exited, sleep(5000)]);
    const ids = out.trim().split("\n").map((l) => JSON.parse(l).id).sort();
    assert.deepEqual(ids, [1, 2]);
  } finally {
    child.kill("SIGKILL");
    await Promise.race([exited, sleep(5000)]); // Windows: no borrar la carpeta antes de que el hijo salga (EBUSY)
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

// ===== #26: notifications/cancelled =====
test("#26 cancelar una petición lenta: no se escribe en la playlist y no se envía respuesta", async () => {
  let list = ["1", "2"];
  const puts = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const { S, call } = await boot(async (u, o) => {
    if (u.pathname !== "/playlists/10") return new Response("nf", { status: 404 });
    if (o.method === "PUT") { puts.push(1); list = JSON.parse(o.body).playlist.tracks.map((t) => t.id); }
    else await gate; // la API lenta: la lectura espera
    return J({ id: 10, title: "p", sharing: "private", track_count: list.length, permalink_url: "u", tracks: list.map((i) => T(i)) });
  });
  const p = S.handle({ jsonrpc: "2.0", id: 500, method: "tools/call", params: { name: "add_tracks_to_playlist", arguments: { playlist_id: "10", track_ids: ["3"] } } });
  await sleep(30);
  assert.equal(await S.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 500, reason: "user" } }), null);
  release();
  assert.equal(await p, null, "no hay respuesta para una petición cancelada");
  assert.equal(puts.length, 0, "no se escribió nada");
  assert.deepEqual(list, ["1", "2"]);
  // El servidor sigue sirviendo peticiones normales.
  const r = await call("get_playlist", { playlist_id: "10" });
  assert.equal(r.err, false);
});

test("#26 cancelar con el PUT ya enviado: la escritura termina y se confirma, pero no se responde", async () => {
  let list = ["1", "2"];
  const log = [];
  let putStarted;
  const started = new Promise((r) => (putStarted = r));
  const { S } = await boot(async (u, o) => {
    if (u.pathname !== "/playlists/10") return new Response("nf", { status: 404 });
    log.push(o.method || "GET");
    if (o.method === "PUT") {
      putStarted();
      await sleep(40);
      list = JSON.parse(o.body).playlist.tracks.map((t) => t.id);
    }
    return J({ id: 10, title: "p", sharing: "private", track_count: list.length, permalink_url: "u", tracks: list.map((i) => T(i)) });
  });
  const p = S.handle({ jsonrpc: "2.0", id: 501, method: "tools/call", params: { name: "add_tracks_to_playlist", arguments: { playlist_id: "10", track_ids: ["3"] } } });
  await started;
  await S.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 501 } });
  assert.equal(await p, null);
  assert.deepEqual(list, ["1", "2", "3"], "la escritura iniciada no se deja a medias");
  assert.equal(log.at(-1) === "PUT" || log.length >= 3, true);
});

test("#26 una cancelación de otro id o desconocida no afecta a las demás peticiones", async () => {
  const { S, call } = await boot((u) => J({ id: 1, username: "dj" }));
  await S.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9999 } });
  const r = await call("whoami");
  assert.equal(r.err, false);
});

// ===== #27: Go+ declarado, la heurística no se presenta como certeza =====
test("#27 con Go+ declarado, instructions y descripciones dicen que go_plus_probable no está garantizado", async () => {
  const { S } = await boot(() => J({}), { goPlus: true });
  const init = (await S.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).result.instructions;
  assert.match(init, /go_plus plays in full/);
  assert.match(init, /go_plus_probable usually does but is not guaranteed/);
  assert.doesNotMatch(init, /go_plus and go_plus_probable tracks play in full/);
  const tools = S.listTools();
  for (const name of ["search_tracks", "suggest_tracks"]) {
    const t = tools.find((x) => x.name === name);
    assert.match(t.description, /not guaranteed/);
    assert.match(t.inputSchema.properties.only_listenable.description, /not guaranteed/);
    assert.doesNotMatch(t.inputSchema.properties.only_listenable.description, /Only tracks the user can play in full/);
    assert.ok(t.description.length <= 1024, `${name}: ${t.description.length} caracteres`);
  }
});

// ===== #29: el cursor solo vale para su colección =====
test("#29 un cursor de otra ruta (streams, download, otra colección) se rechaza sin llamar a la API", async () => {
  const { call, calls } = await boot((u) => J({ collection: [T(1)] }));
  const bad = [
    ["search_tracks", { cursor: "https://api.soundcloud.com/tracks/123/streams" }],
    ["search_tracks", { cursor: "https://api.soundcloud.com/tracks/123/download" }],
    ["search_tracks", { cursor: "https://api.soundcloud.com/me" }],
    ["search_users", { query: "x", cursor: "https://api.soundcloud.com/tracks/123/streams" }],
    ["get_related_tracks", { cursor: "https://api.soundcloud.com/tracks/123/streams" }],
    ["get_user_content", { kind: "tracks", cursor: "https://api.soundcloud.com/users/5/likes/tracks" }],
    ["get_user_content", { kind: "likes", cursor: "https://api.soundcloud.com/tracks/1/download" }],
    ["get_my_tracks", { source: "followings", cursor: "https://api.soundcloud.com/tracks/123/streams" }],
    ["get_my_tracks", { source: "likes", cursor: "https://api.soundcloud.com/me/feed/tracks" }],
    ["search_playlists", { query: "x", cursor: "https://api.soundcloud.com/tracks/123/streams" }],
    ["get_related_artists", { cursor: "https://api.soundcloud.com/tracks/123/streams" }],
  ];
  for (const [name, args] of bad) {
    const r = await call(name, args);
    assert.equal(r.err, true, `${name} ${args.cursor}`);
  }
  assert.equal(calls.length, 0, "ninguna llamada a la API: " + calls.map((c) => c.url).join(" "));
  // Los cursores legítimos siguen funcionando.
  const ok = [
    ["search_tracks", { cursor: "https://api.soundcloud.com/tracks?q=x&limit=10&linked_partitioning=true&offset=10" }],
    ["get_related_tracks", { cursor: "https://api.soundcloud.com/tracks/5/related?limit=20&offset=20" }],
    ["get_user_content", { kind: "likes", cursor: "https://api.soundcloud.com/users/5/likes/tracks?cursor=abc" }],
    ["get_my_tracks", { source: "followings", cursor: "https://api.soundcloud.com/me/followings/tracks?limit=20&offset=20" }],
    ["get_my_tracks", { source: "likes", cursor: "https://api.soundcloud.com/me/likes/tracks?cursor=abc" }],
  ];
  for (const [name, args] of ok) {
    const r = await call(name, args);
    assert.equal(r.err, false, `${name}: ${r.text}`);
  }
  assert.equal(calls.length, ok.length);
});

// ===== #31: guía de Go+ según cómo se instaló =====
test("#31 setup_status y whoami mandan al interruptor de la extensión o del plugin, no a editar ficheros", async () => {
  const saved = { d: process.env.SOUNDCRATE_DIST, p: process.env.CLAUDE_PLUGIN_ROOT };
  try {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const { call } = await boot(() => J({ id: 1, username: "dj", subscriptions: [] }), { store: () => ({ label: "S", probe: () => ({ ok: true }) }) });
    const how = async () => (await call("setup_status", { verify_session: false })).out.steps.find((s) => s.id === "go_plus").how;
    process.env.SOUNDCRATE_DIST = "mcpb";
    let h = await how();
    assert.ok(h.every((x) => typeof x === "string"), "sin la tabla de ficheros de configuración");
    assert.match(h.join(" "), /Settings > Extensions > SoundCrate/); assert.match(h.join(" "), /I have SoundCloud Go\+/);
    assert.match((await call("whoami")).out.note, /Settings > Extensions/);
    process.env.SOUNDCRATE_DIST = "plugin";
    h = await how();
    assert.ok(h.every((x) => typeof x === "string"));
    assert.match(h.join(" "), /\/plugin/); assert.match(h.join(" "), /go_plus/);
    assert.match((await call("whoami")).out.note, /\/plugin/);
    delete process.env.SOUNDCRATE_DIST;
    process.env.CLAUDE_PLUGIN_ROOT = "/x/plugin";
    assert.match((await how()).join(" "), /\/plugin/, "el plugin también se reconoce por CLAUDE_PLUGIN_ROOT");
    delete process.env.CLAUDE_PLUGIN_ROOT;
    h = await how();
    assert.ok(h[1]["Claude Desktop"] && h[1]["Claude Code"], "sin marca: la tabla de clientes de siempre");
    assert.match((await call("whoami")).out.note, /SC_GO_PLUS=1/);
  } finally {
    for (const [k, v] of [["SOUNDCRATE_DIST", saved.d], ["CLAUDE_PLUGIN_ROOT", saved.p]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

// ===== T1, #18, #21, #22/#23: start_setup =====
test("T1 start_setup cablea onSuccess a resetSession: tras reconectar se usa el token nuevo y las credenciales nuevas", async () => {
  let opts;
  const kc = { refresh_token: "rt0" };
  let cid = "cid-old";
  const reqs = [];
  const { call, calls } = await boot(() => J({ id: 1, username: "dj" }), {
    secretGet: (a) => kc[a] ?? null,
    secretSet: (a, v) => (kc[a] = v),
    credentials: () => ({ clientId: cid, clientSecret: "s" }),
    tokenRequest: async (p) => (reqs.push(p), { access_token: "at-old", refresh_token: "rtX", expires_in: 3600 }),
    startSetup: async (o) => ((opts = o), { url: "http://127.0.0.1:8976/setup?k=abc", opened: true, already_running: false, store: "S" }),
  });
  await call("whoami");
  assert.equal(calls.at(-1).auth, "OAuth at-old");
  await call("start_setup");
  cid = "cid-new";
  opts.onSuccess({ username: "dj", access_token: "NEW", expires_in: 3600 });
  await call("whoami");
  assert.equal(calls.at(-1).auth, "OAuth NEW", "el token anterior ya no se usa");
  // Sin access_token en onSuccess: la próxima llamada renueva con las credenciales (ya no las cacheadas).
  opts.onSuccess({ username: "dj", expires_in: 3600 });
  await call("whoami");
  assert.equal(reqs.at(-1).client_id, "cid-new", "creds en memoria vaciadas");
});

test("#18 start_setup pasa onCredentialsChanged: vacía sesión y credenciales en memoria", async () => {
  let opts, cid = "cid-old";
  const reqs = [];
  const { call, calls } = await boot(() => J({ id: 1, username: "dj" }), {
    credentials: () => ({ clientId: cid, clientSecret: "s" }),
    tokenRequest: async (p) => (reqs.push(p), { access_token: "at" + reqs.length, refresh_token: "rt" + reqs.length, expires_in: 3600 }),
    startSetup: async (o) => ((opts = o), { url: "http://127.0.0.1:8976/setup?k=abc", opened: true, already_running: false, store: "S" }),
  });
  await call("whoami");
  await call("start_setup");
  assert.equal(typeof opts.onCredentialsChanged, "function");
  cid = "cid-new";
  opts.onCredentialsChanged();
  await call("whoami");
  assert.equal(reqs.length, 2, "se renovó la sesión");
  assert.equal(reqs.at(-1).client_id, "cid-new");
  assert.equal(calls.at(-1).auth, "OAuth at2");
});

test("#22 #23 tell_user lleva siempre la URL (también si ya estaba abierta o se abrió)", async () => {
  const url = "http://127.0.0.1:8976/setup?k=abc";
  for (const [res, expectOpenedPhrase] of [
    [{ opened: true, already_running: false }, /has opened/],
    [{ opened: true, already_running: true }, /already running/],
    [{ opened: false, already_running: true }, /Open this page/],
    [{ opened: false, already_running: false }, /Open this page/],
  ]) {
    const { call } = await boot(() => J({}), { startSetup: async () => ({ url, store: "S", ...res }) });
    const r = await call("start_setup", { open_browser: false });
    assert.ok(r.out.tell_user.includes(url), JSON.stringify(res) + " → " + r.out.tell_user);
    assert.match(r.out.tell_user, expectOpenedPhrase);
  }
});

test("#21 si la página de configuración caduca, setup_status lo dice", async () => {
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const { call } = await boot(() => J({}), {
    store: () => ({ label: "S", probe: () => ({ ok: true }) }),
    secretGet: () => null,
    credentials: () => { throw Object.assign(new Error("no creds"), { setup: true }); },
    startSetup: async () => ({ url: "http://127.0.0.1:8976/setup?k=abc", opened: true, already_running: false, store: "S", done }),
  });
  await call("start_setup");
  assert.equal((await call("setup_status")).out.setup_page_expired, undefined);
  resolveDone({ ok: false, reason: "timeout" });
  await sleep(5);
  const s = await call("setup_status");
  assert.match(s.out.setup_page_expired, /start_setup again/);
});

// ----- ejecución -----
const failed = [];
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log("ok    " + name);
  } catch (e) {
    failed.push(name);
    console.log("FALLA " + name + "\n      " + String(e?.message || e).split("\n").slice(0, 4).join("\n      "));
  }
}
if (failed.length) {
  console.log(`\n${failed.length} caso(s) fallan:\n  - ` + failed.join("\n  - "));
  process.exit(1);
}
console.log("OK");
process.exit(0);
