#!/usr/bin/env node
// SoundCrate MCP: servidor MCP local (stdio) para SoundCloud. Sin dependencias externas.
// Herramientas: buscar y descubrir pistas, artistas, playlists y emisoras; sugerir pistas, analizar y reordenar playlists;
// crear playlists y añadir/quitar/sustituir pistas.
// No incluye descarga ni URLs de streaming (las condiciones de la API lo prohíben) ni borrado de playlists.

import readline from "node:readline";
import * as lib from "./lib.mjs";

const deps = {
  fetch: (...a) => fetch(...a),
  kcGet: lib.kcGet,
  kcSet: lib.kcSet,
  credentials: lib.credentials,
  tokenRequest: lib.tokenRequest,
  // La API no informa de Go+ (/me solo lista planes de artista): el usuario lo declara con SC_GO_PLUS=1.
  goPlus: /^(1|true|yes|si|sí)$/i.test(process.env.SC_GO_PLUS || ""),
};
export function _setDeps(d) {
  Object.assign(deps, d);
}

const log = (...a) => process.stderr.write("[soundcloud-mcp] " + a.join(" ") + "\n");

// ---------- Tokens ----------
let access = null; // { token, exp }
let refreshing = null;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = deps.kcGet("refresh_token");
    if (!rt) throw new Error("No hay sesión guardada. Ejecuta: node login.mjs");
    const { clientId, clientSecret } = deps.credentials();
    const tok = await deps.tokenRequest({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: rt,
    });
    // Los refresh tokens son de un solo uso: guardar siempre el nuevo.
    if (tok.refresh_token) deps.kcSet("refresh_token", tok.refresh_token);
    access = { token: tok.access_token, exp: Date.now() + ((tok.expires_in || 3600) - 120) * 1000 };
    return access.token;
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function token() {
  if (access && Date.now() < access.exp) return access.token;
  return refresh();
}

// ---------- API ----------
const API_ORIGIN = new URL(lib.API).origin;

async function sc(path, { method = "GET", body, retry = true } = {}) {
  const url = path.startsWith("http") ? path : lib.API + path;
  // El token solo viaja a la API de SoundCloud: un cursor o next_href manipulado no puede mandarlo a otro sitio.
  if (new URL(url).origin !== API_ORIGIN) throw new Error(`Dirección no permitida (solo ${API_ORIGIN}).`);
  const res = await deps.fetch(url, {
    method,
    headers: {
      Authorization: "OAuth " + (await token()),
      Accept: "application/json; charset=utf-8",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 && retry) {
    access = null;
    return sc(path, { method, body, retry: false });
  }
  const text = await res.text();
  if (res.status === 429) throw new Error("SoundCloud: límite de peticiones alcanzado, espera un poco.");
  if (!res.ok) throw new Error(`SoundCloud ${method} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const coll = (b) => (b && Array.isArray(b.collection) ? b.collection : Array.isArray(b) ? b : []);
const mmss = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : null);
// Acepta "123" o una URN ("soundcloud:tracks:123"). La API está migrando de id numérico a URN.
const idOf = (x) => String(x ?? "").trim().match(/^(?:soundcloud:[a-z-]+:)?(\d+)$/)?.[1] ?? null;
const ids = (arr) => (arr || []).map(idOf).filter(Boolean);
const rid = (o) => (o?.id != null ? String(o.id) : idOf(o?.urn) ?? o?.urn ?? null);
const releaseDate = (t) =>
  t.release_year ? [t.release_year, t.release_month, t.release_day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, "0") : n)).join("-") : null;

// Tonalidad de SoundCloud ("F:min", "C#:maj"…) a notación Camelot ("4A", "3B"…), la que se usa para mezclar en armonía.
const ENHARMONIC = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
const CAMELOT = {
  min: { Ab: 1, Eb: 2, Bb: 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, Gb: 11, Db: 12 },
  maj: { B: 1, Gb: 2, Db: 3, Ab: 4, Eb: 5, Bb: 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 },
};
function camelot(k) {
  const m = String(k || "").trim().match(/^([A-G][b#]?):?\s*(min|maj)/i);
  if (!m) return null;
  const note = ENHARMONIC[m[1]] || m[1];
  const mode = m[2].toLowerCase();
  const n = CAMELOT[mode][note];
  return n ? `${n}${mode === "min" ? "A" : "B"}` : null;
}

// 'access' dice qué deja reproducir la API fuera de SoundCloud, no qué puede escuchar el usuario.
// 'listen' lo traduce para el oyente usando solo metadatos (sin tocar /streams: las condiciones de la API
// prohíben intentar acceder a contenido exclusivo de Go). En 1.760 pistas reales: todas las preview tienen ISRC
// (catálogo distribuido) y casi todas las blocked también; las blocked sin sello ni ISRC son remixes y bootlegs.
function listenOf(t) {
  if (t.access === "playable") return "full";
  if (t.access === "preview") return "go_plus";
  if (t.access === "blocked") return t.isrc || t.label_name ? "go_plus_probable" : "restricted";
  return null;
}
const listenable = () => new Set(deps.goPlus ? ["full", "go_plus", "go_plus_probable"] : ["full"]);
const LISTEN_NOTE =
  "Cada pista trae 'listen': full = suena entera para cualquiera; go_plus = catálogo que sin suscripción solo da un fragmento y con Go+ suena entera; " +
  "go_plus_probable = catálogo de sello que la API no deja reproducir fuera de SoundCloud, con Go+ suele sonar entera en SoundCloud (sin garantía por región); " +
  "restricted = bloqueada y sin sello ni ISRC (derechos, región o decisión del autor): puede no sonar ni con Go+. " +
  "Todas se pueden añadir a playlists. La API no informa de si el usuario tiene Go+.";
const listenStatus = () =>
  deps.goPlus
    ? "El usuario ha declarado Go+ (SC_GO_PLUS): go_plus y go_plus_probable las puede escuchar completas."
    : "El usuario no ha declarado Go+ (SC_GO_PLUS): solo 'full' suena entera; go_plus da un fragmento.";

const cleanUrl = (u) => (u ? String(u).split("?")[0] : null);

const slimTrack = (t) => ({
  id: rid(t),
  title: t.title,
  user: t.user?.username,
  ...(t.metadata_artist ? { artist: t.metadata_artist } : {}),
  access: t.access, // playable | preview | blocked: lo que la API deja reproducir fuera de SoundCloud
  listen: listenOf(t), // full | go_plus | go_plus_probable | restricted: lo que oye el usuario en SoundCloud
  duration: mmss(t.duration),
  bpm: t.bpm ? Math.round(t.bpm * 10) / 10 : null,
  key: t.key_signature || null,
  camelot: camelot(t.key_signature),
  genre: t.genre || null,
  ...(t.tag_list ? { tags: String(t.tag_list).slice(0, 160) } : {}),
  label: t.label_name || null,
  release: releaseDate(t),
  ...(t.isrc ? { isrc: t.isrc } : {}),
  uploaded: t.created_at ? String(t.created_at).slice(0, 10).replace(/\//g, "-") : null,
  plays: t.playback_count ?? null,
  likes: t.favoritings_count ?? null,
  reposts: t.reposts_count ?? null,
  url: cleanUrl(t.permalink_url),
});
const slimPlaylist = (p) => ({
  id: rid(p),
  title: p.title,
  ...(p.user?.username ? { user: p.user.username } : {}),
  sharing: p.sharing,
  track_count: p.track_count,
  url: cleanUrl(p.permalink_url),
});
const slimStation = (p) => ({
  id: p.urn,
  title: p.title,
  ...(p.description ? { description: String(p.description).slice(0, 200) } : {}),
  track_count: p.track_count ?? null,
  url: cleanUrl(p.permalink_url),
});
const slimUser = (u) => ({
  id: rid(u),
  username: u.username,
  ...(u.full_name ? { name: u.full_name } : {}),
  ...(u.city || u.country ? { location: [u.city, u.country].filter(Boolean).join(", ") } : {}),
  followers: u.followers_count ?? null,
  tracks: u.track_count ?? null,
  url: cleanUrl(u.permalink_url),
});

const ALL_ACCESS = "access=playable%2Cpreview%2Cblocked";
const clamp = (n, def, max = 200) => Math.min(max, Math.max(1, Number.isFinite(+n) && n != null ? Math.floor(+n) : def));

// Una página de una colección. cursor = next_cursor de una llamada anterior (sc() comprueba que sea de la API).
async function page(path, params, { limit, cursor, def = 20 }) {
  if (cursor) return pageOut(await sc(String(cursor)));
  const q = new URLSearchParams({ ...params, limit: String(clamp(limit, def)), linked_partitioning: "true" });
  return pageOut(await sc(`${path}?${q}`));
}
const pageOut = (b) => ({ items: coll(b), next_cursor: b?.next_href || null });

const num = (x) => (x == null || x === "" || !Number.isFinite(+x) ? null : +x);
const list = (x) => (Array.isArray(x) ? x : x ? String(x).split(",") : []).map((s) => String(s).trim()).filter(Boolean);
const day = (x) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x))) throw new Error(`Fecha no válida: ${x} (usa AAAA-MM-DD).`);
  return String(x);
};
// Rango "campo[from]/campo[to]" de la búsqueda de pistas.
function range(p, field, from, to, fmt) {
  if (from != null && from !== "") p[`${field}[from]`] = fmt(from, false);
  if (to != null && to !== "") p[`${field}[to]`] = fmt(to, true);
}

// page() pidiendo también las pistas preview/blocked. Si la API rechaza el parámetro, repite sin él.
async function pageAccess(path, params, opts, include = true) {
  if (!include || opts.cursor) return page(path, params, opts);
  try {
    return await page(path, { ...params, access: "playable,preview,blocked" }, opts);
  } catch (e) {
    if (/límite de peticiones|→ 40[134]/.test(e.message)) throw e;
    return page(path, params, opts);
  }
}

// /me/followings/tracks se pagina con offset, no con next_href: el cursor es la URL de la página siguiente.
async function followingsTracks(limit, cursor) {
  let url = cursor ? String(cursor) : null;
  if (!url) {
    const q = new URLSearchParams({ limit: String(clamp(limit, 20)), offset: "0", access: "playable,preview,blocked" });
    url = `${lib.API}/me/followings/tracks?${q}`;
  }
  const b = await sc(url);
  const items = coll(b);
  let next = b?.next_href || null;
  if (!next) {
    const u = new URL(url);
    const n = +u.searchParams.get("limit") || items.length;
    if (items.length && items.length >= n) {
      u.searchParams.set("offset", String((+u.searchParams.get("offset") || 0) + items.length));
      next = u.href;
    }
  }
  return { tracks: items.map(slimTrack), next_cursor: next };
}

// Convierte track_id/user_id/playlist_id o una URL de soundcloud.com en id numérico, comprobando el tipo.
async function resolveId(kind, idValue, url) {
  if (url) {
    const o = await sc(`/resolve?${new URLSearchParams({ url })}`);
    if (o?.kind !== kind) throw new Error(`Esa URL es de un ${o?.kind || "recurso desconocido"}, no de un ${kind}.`);
    return { id: rid(o), obj: o };
  }
  const id = idOf(idValue);
  if (!id) throw new Error(`Indica un ${kind}_id numérico o una url.`);
  return { id, obj: null };
}

async function getPlaylistFull(id) {
  const p = await sc(`/playlists/${id}?${ALL_ACCESS}`);
  const tracks = p.tracks || [];
  return { p, tracks, hidden: Math.max(0, (p.track_count ?? tracks.length) - tracks.length) };
}

// Seguridad: la API puede ocultar pistas al leer una playlist (p. ej. ciertas pistas de sellos).
// Como escribir una playlist REEMPLAZA su lista completa, si faltan pistas no se escribe nada.
function assertComplete(p, hidden) {
  if (hidden > 0) {
    throw new Error(
      `SoundCloud oculta ${hidden} de las ${p.track_count} pistas de esta playlist al leerla. ` +
        `Reescribirla las borraría, así que no he cambiado nada. Añade esas pistas desde la web/app de SoundCloud ` +
        `o crea una playlist nueva con create_playlist.`
    );
  }
}

async function playlistTrackIds(id) {
  const { p, tracks, hidden } = await getPlaylistFull(id);
  assertComplete(p, hidden);
  return { p, ids: tracks.map(rid) };
}

// Cerrojo por playlist: las operaciones leer-modificar-escribir sobre la misma playlist van en serie.
// Sin esto, dos llamadas en paralelo leerían el mismo estado y la última escritura borraría la otra.
const locks = new Map();
function withPlaylistLock(pid, fn) {
  const prev = locks.get(pid) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  locks.set(pid, tail);
  tail.then(() => {
    if (locks.get(pid) === tail) locks.delete(pid);
  });
  return run;
}

function playlistId(x) {
  const pid = ids([x])[0];
  if (!pid) throw new Error("Indica un playlist_id numérico.");
  return pid;
}

// Escribe la lista completa y, opcionalmente, campos de la playlist (título, descripción, género, etiquetas).
async function writePlaylist(id, list, fields = {}) {
  // Los IDs van como cadenas: SoundCloud rechaza IDs > 2^31 enviados como número.
  return sc(`/playlists/${id}`, { method: "PUT", body: { playlist: { ...fields, tracks: list.map((x) => ({ id: x })) } } });
}
const putTracks = (id, list) => writePlaylist(id, list);

// SoundCloud guarda las etiquetas separadas por espacios, con comillas si tienen espacios ("deep house").
const toTagList = (s) =>
  list(String(s))
    .map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t))
    .join(" ");

// ---------- Ayudas para listas (bloques 2 y 3) ----------
const camKey = (c) => {
  const m = /^(\d{1,2})([AB])$/.exec(c || "");
  return m ? { n: +m[1], l: m[2] } : null;
};
// Mezcla armónica: misma tonalidad, relativa (mismo número, otra letra) o vecina en la rueda (±1, misma letra).
function harmonicMatch(a, b) {
  const x = camKey(a), y = camKey(b);
  if (!x || !y) return null;
  if (x.n === y.n) return true;
  const d = Math.abs(x.n - y.n);
  return x.l === y.l && (d === 1 || d === 11);
}
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const round1 = (x) => Math.round(x * 10) / 10;
const median = (a) => (a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);
const hms = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const topN = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));

const releaseKey = (t) => (t.release_year ? t.release_year * 10000 + (t.release_month || 0) * 100 + (t.release_day || 0) : null);
const camelotKey = (t) => {
  const k = camKey(camelot(t.key_signature));
  return k ? k.n * 2 + (k.l === "B" ? 1 : 0) : null;
};
const SORTS = { bpm: (t) => t.bpm || null, duration: (t) => t.duration || null, released: releaseKey, camelot: camelotKey };

// Orden nuevo de las ids. Las pistas sin dato van al final, en su orden original.
function sortIds(tracks, by, dir = "asc") {
  const key = SORTS[by];
  if (!key) throw new Error("sort_by debe ser bpm, camelot, duration o released.");
  const sign = dir === "desc" ? -1 : 1;
  return tracks
    .map((t, i) => ({ id: rid(t), i, k: key(t) }))
    .sort((a, b) => {
      if (a.k == null && b.k == null) return a.i - b.i;
      if (a.k == null) return 1;
      if (b.k == null) return -1;
      return sign * (a.k - b.k) || a.i - b.i;
    })
    .map((x) => x.id);
}

// Análisis de una lista leída (pistas en bruto de la API).
function analyzeTracks(raw, hidden = 0) {
  const bpms = raw.filter((t) => t.bpm).map((t) => round1(t.bpm)).sort((a, b) => a - b);
  const secs = raw.reduce((s, t) => s + (t.duration || 0) / 1000, 0);
  const years = raw.map((t) => t.release_year || Number(String(t.created_at || "").slice(0, 4)) || null).filter(Boolean);
  const groups = new Map();
  raw.forEach((t, i) => {
    if (!norm(t.title)) return;
    const k = `${norm(t.metadata_artist || t.user?.username)}|${norm(t.title)}`;
    groups.set(k, [...(groups.get(k) || []), { position: i + 1, id: rid(t), title: t.title }]);
  });
  const duplicates = [...groups.values()].filter((g) => g.length > 1);
  const jumps = [], clashes = [];
  for (let i = 0; i + 1 < raw.length; i++) {
    const a = raw[i], b = raw[i + 1];
    if (a.bpm && b.bpm && Math.abs(a.bpm - b.bpm) > 6) jumps.push({ between: [i + 1, i + 2], bpm: [round1(a.bpm), round1(b.bpm)] });
    const ca = camelot(a.key_signature), cb = camelot(b.key_signature);
    if (harmonicMatch(ca, cb) === false) clashes.push({ between: [i + 1, i + 2], camelot: [ca, cb] });
  }
  return {
    tracks_read: raw.length,
    ...(hidden ? { hidden_by_api: hidden } : {}),
    total_duration: hms(secs),
    bpm: bpms.length
      ? { min: bpms[0], median: round1(median(bpms)), max: bpms[bpms.length - 1], with_bpm: bpms.length, without_bpm: raw.length - bpms.length }
      : { with_bpm: 0, without_bpm: raw.length },
    camelot: topN(tally(raw.map((t) => camelot(t.key_signature) || "sin dato")), 12),
    genres: topN(tally(raw.map((t) => t.genre || "sin dato")), 8),
    years: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    access: tally(raw.map((t) => t.access || "desconocido")),
    listen: tally(raw.map((t) => listenOf(t) || "desconocido")),
    duplicates: duplicates.slice(0, 20),
    bpm_jumps: { total: jumps.length, examples: jumps.slice(0, 10) },
    harmonic_clashes: { total: clashes.length, examples: clashes.slice(0, 10) },
  };
}

// ---------- Herramientas ----------
const TOOLS = {
  search_tracks: {
    description:
      "Busca pistas por texto y/o filtros (géneros, etiquetas, BPM, duración, fecha de subida). Devuelve id, título, usuario, BPM, tonalidad, género, sello, fecha de lanzamiento, reproducciones, likes y 'access'. " +
      LISTEN_NOTE +
      " only_listenable=true deja solo las que el usuario puede escuchar completas (con Go+ declarado incluye go_plus y go_plus_probable). " +
      "bpm y key casi siempre vienen; las pistas sin ese dato quedan fuera al filtrar por BPM. Para seguir, pasa next_cursor como cursor.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de búsqueda (artista y título)" },
        genres: { type: "array", items: { type: "string" }, description: "Géneros, p. ej. [\"Techno\", \"House\"]" },
        tags: { type: "array", items: { type: "string" }, description: "Etiquetas de las pistas" },
        bpm_min: { type: "number" },
        bpm_max: { type: "number" },
        duration_min_s: { type: "integer", description: "Duración mínima en segundos" },
        duration_max_s: { type: "integer", description: "Duración máxima en segundos" },
        uploaded_after: { type: "string", description: "Fecha de subida desde (AAAA-MM-DD)" },
        uploaded_before: { type: "string", description: "Fecha de subida hasta (AAAA-MM-DD)" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Máximo de resultados (por defecto 10)" },
        include_restricted: {
          type: "boolean",
          description: "Incluir pistas preview/blocked además de las reproducibles (por defecto true)",
        },
        only_listenable: { type: "boolean", description: "Solo pistas que el usuario puede escuchar completas en SoundCloud" },
        cursor: { type: "string", description: "next_cursor de una búsqueda anterior, para la página siguiente" },
      },
    },
    run: async (a) => {
      const { query, genres, tags, limit, include_restricted = true, cursor } = a;
      if (!cursor && !query && !list(genres).length && !list(tags).length)
        throw new Error("Indica query, genres o tags.");
      const p = {};
      if (query) p.q = query;
      if (list(genres).length) p.genres = list(genres).join(",");
      if (list(tags).length) p.tags = list(tags).join(",");
      range(p, "bpm", a.bpm_min, a.bpm_max, (x, end) => String(end ? Math.ceil(+x) : Math.floor(+x)));
      range(p, "duration", a.duration_min_s, a.duration_max_s, (x) => String(Math.round(+x * 1000)));
      range(p, "created_at", a.uploaded_after, a.uploaded_before, (x, end) => day(x) + (end ? " 23:59:59" : " 00:00:00"));
      const r = await pageAccess("/tracks", p, { limit, cursor, def: 10 }, include_restricted);
      let tracks = r.items.map(slimTrack);
      // El filtro de BPM de la API es aproximado (deja pasar ~10 % fuera de rango): se aplica aquí de forma estricta.
      const cq = cursor ? new URL(String(cursor)).searchParams : null;
      const lo = num(a.bpm_min ?? cq?.get("bpm[from]")), hi = num(a.bpm_max ?? cq?.get("bpm[to]"));
      let out_of_range = 0;
      if (lo != null || hi != null) {
        const ok = (t) => t.bpm != null && (lo == null || t.bpm >= lo) && (hi == null || t.bpm <= hi);
        out_of_range = tracks.filter((t) => !ok(t)).length;
        tracks = tracks.filter(ok);
      }
      let not_listenable = 0;
      if (a.only_listenable) {
        const ok = listenable();
        not_listenable = tracks.filter((t) => !ok.has(t.listen)).length;
        tracks = tracks.filter((t) => ok.has(t.listen));
      }
      return {
        tracks,
        ...(out_of_range ? { out_of_range_removed: out_of_range } : {}),
        ...(not_listenable ? { not_listenable_removed: not_listenable } : {}),
        next_cursor: r.next_cursor,
      };
    },
  },
  get_track: {
    description: "Datos de una pista por id o por URL de soundcloud.com.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, url: { type: "string" } },
    },
    run: async ({ track_id, url }) => {
      const { id, obj } = await resolveId("track", track_id, url);
      return slimTrack(obj || (await sc(`/tracks/${id}`)));
    },
  },
  get_related_tracks: {
    description:
      "Pistas relacionadas con una pista: las recomendaciones de SoundCloud. Sirve para ampliar una playlist a partir de pistas semilla. exclude_playlist_id quita las que ya están en esa playlist.",
    inputSchema: {
      type: "object",
      properties: {
        track_id: { type: "string" },
        url: { type: "string", description: "URL de la pista en soundcloud.com, en lugar de track_id" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Por defecto 20" },
        exclude_playlist_id: { type: "string", description: "Quita del resultado las pistas que ya están en esta playlist" },
        include_restricted: { type: "boolean", description: "Por defecto true" },
        cursor: { type: "string" },
      },
    },
    run: async ({ track_id, url, limit, exclude_playlist_id, include_restricted = true, cursor }) => {
      const seed = cursor ? null : (await resolveId("track", track_id, url)).id;
      const r = await pageAccess(`/tracks/${seed}/related`, {}, { limit, cursor }, include_restricted);
      let tracks = r.items.map(slimTrack).filter((t) => t.id !== seed);
      let excluded;
      if (exclude_playlist_id) {
        const { tracks: pt } = await getPlaylistFull(playlistId(exclude_playlist_id));
        const have = new Set(pt.map(rid));
        excluded = tracks.filter((t) => have.has(t.id)).length;
        tracks = tracks.filter((t) => !have.has(t.id));
      }
      return { tracks, ...(excluded !== undefined ? { excluded } : {}), next_cursor: r.next_cursor };
    },
  },
  get_my_tracks: {
    description:
      "Pistas de tu cuenta para inspirar playlists. source: likes (tus me gusta), recently_played (las 25 últimas que has escuchado), feed (subidas y reposts de quien sigues), followings (subidas recientes de quien sigues), reposts (tus reposts).",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["likes", "recently_played", "feed", "followings", "reposts"] },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Por defecto 20" },
        cursor: { type: "string" },
      },
      required: ["source"],
    },
    run: async ({ source, limit, cursor }) => {
      switch (source) {
        case "likes":
        case "reposts": {
          const r = await pageAccess(`/me/${source}/tracks`, {}, { limit, cursor });
          return { tracks: r.items.map(slimTrack), next_cursor: r.next_cursor };
        }
        case "recently_played": {
          const r = await pageAccess(`/me/recently-played/tracks`, {}, { limit: 25, cursor, def: 25 });
          return { tracks: r.items.map(slimTrack) };
        }
        case "feed": {
          const r = await pageAccess(`/me/feed/tracks`, {}, { limit, cursor });
          const tracks = r.items
            .filter((x) => x?.origin && !Array.isArray(x.origin.tracks) && x.origin.kind !== "playlist")
            .map((x) => ({ ...slimTrack(x.origin), activity: x.type, activity_at: String(x.created_at || "").slice(0, 10) || null }));
          return { tracks, next_cursor: r.next_cursor };
        }
        case "followings":
          return followingsTracks(limit, cursor);
        default:
          throw new Error("source debe ser likes, recently_played, feed, followings o reposts.");
      }
    },
  },
  search_users: {
    description: "Busca artistas, sellos o DJs. Devuelve id, nombre, ubicación, seguidores y número de pistas.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" } },
      required: ["query"],
    },
    run: async ({ query, limit, cursor }) => {
      const r = await page(`/users`, { q: query }, { limit, cursor, def: 10 });
      return { users: r.items.map(slimUser), next_cursor: r.next_cursor };
    },
  },
  get_related_artists: {
    description: "Artistas parecidos a uno dado, según SoundCloud.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" }, url: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" } },
    },
    run: async ({ user_id, url, limit, cursor }) => {
      const uid = cursor ? null : (await resolveId("user", user_id, url)).id;
      const r = await page(`/users/${uid}/related`, {}, { limit, cursor, def: 20 });
      return { users: r.items.map(slimUser), next_cursor: r.next_cursor };
    },
  },
  get_user_content: {
    description:
      "Contenido de un artista, sello o DJ. kind: tracks (sus subidas), likes (lo que le gusta), reposts (lo que repostea) o playlists. Útil para rebuscar en lo que escuchan DJs de referencia.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        url: { type: "string", description: "URL del perfil en soundcloud.com, en lugar de user_id" },
        kind: { type: "string", enum: ["tracks", "likes", "reposts", "playlists"] },
        sort: { type: "string", enum: ["newest", "oldest"], description: "Solo para kind=tracks. Por defecto newest" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Por defecto 20" },
        cursor: { type: "string" },
      },
      required: ["kind"],
    },
    run: async ({ user_id, url, kind, sort, limit, cursor }) => {
      const { id: uid, obj } = cursor ? { id: null, obj: null } : await resolveId("user", user_id, url);
      const who = obj ? { user: slimUser(obj) } : {};
      if (kind === "playlists") {
        const r = await pageAccess(`/users/${uid}/playlists`, { show_tracks: "false" }, { limit, cursor });
        return { ...who, playlists: r.items.map(slimPlaylist), next_cursor: r.next_cursor };
      }
      const path = { tracks: "tracks", likes: "likes/tracks", reposts: "reposts/tracks" }[kind];
      if (!path) throw new Error("kind debe ser tracks, likes, reposts o playlists.");
      const extra = kind === "tracks" ? { sort: sort === "oldest" ? "asc" : "desc" } : {};
      const r = await pageAccess(`/users/${uid}/${path}`, extra, { limit, cursor });
      return { ...who, tracks: r.items.map(slimTrack), next_cursor: r.next_cursor };
    },
  },
  search_playlists: {
    description: "Busca playlists públicas de cualquier usuario (sin las pistas). Luego get_playlist da sus pistas.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" } },
      required: ["query"],
    },
    run: async ({ query, limit, cursor }) => {
      const r = await pageAccess(`/playlists`, { q: query, show_tracks: "false" }, { limit, cursor, def: 10 });
      return { playlists: r.items.map(slimPlaylist), next_cursor: r.next_cursor };
    },
  },
  get_station: {
    description:
      "Una emisora de SoundCloud (system playlist) con sus pistas. Los ids salen de get_my_playlists(kind=stations), p. ej. soundcloud:system-playlists:track-stations:123.",
    inputSchema: { type: "object", properties: { station_id: { type: "string" } }, required: ["station_id"] },
    run: async ({ station_id }) => {
      const sid = String(station_id || "").trim();
      if (!/^[a-z0-9-]+(:[A-Za-z0-9_-]+)+$/.test(sid)) throw new Error("station_id no válido.");
      let p;
      try {
        p = await sc(`/system-playlists/${encodeURIComponent(sid)}?${ALL_ACCESS}`);
      } catch {
        p = await sc(`/system-playlists/${encodeURIComponent(sid)}`);
      }
      return { ...slimStation(p), tracks: (p.tracks || []).map(slimTrack) };
    },
  },
  whoami: {
    description:
      "Comprueba la sesión: usuario, plan y suscripciones que SoundCloud ve en tu cuenta. force_refresh=true pide un token nuevo antes de consultar.",
    inputSchema: { type: "object", properties: { force_refresh: { type: "boolean" } } },
    run: async ({ force_refresh = false }) => {
      if (force_refresh) access = null;
      const me = await sc(`/me`);
      return {
        id: String(me.id),
        username: me.username,
        plan: me.plan ?? null,
        subscriptions: (me.subscriptions || []).map((x) => ({ id: x?.product?.id ?? null, name: x?.product?.name ?? null })),
        token_refreshed: !!force_refresh,
        go_plus_declared: !!deps.goPlus,
        note: "La API no informa de Go+ (subscriptions solo lista planes de artista). Se declara con SC_GO_PLUS=1 en la configuración del servidor.",
      };
    },
  },
  get_my_playlists: {
    description:
      "Tus playlists, sin las pistas. kind: own (las tuyas, por defecto), liked (las que te gustan) o stations (emisoras que te gustan; ábrelas con get_station).",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["own", "liked", "stations"] } } },
    run: async ({ kind = "own" }) => {
      const src = { own: ["/me/playlists", slimPlaylist], liked: ["/me/likes/playlists", slimPlaylist], stations: ["/me/likes/system-playlists", slimStation] }[kind];
      if (!src) throw new Error("kind debe ser own, liked o stations.");
      const out = [];
      let next = `${src[0]}?limit=50&linked_partitioning=true${kind === "own" ? "&show_tracks=false" : ""}`;
      for (let i = 0; next && i < 20; i++) {
        const b = await sc(next);
        out.push(...coll(b).map(src[1]));
        next = b?.next_href || null;
      }
      return { [kind === "stations" ? "stations" : "playlists"]: out };
    },
  },
  get_playlist: {
    description: "Una playlist con sus pistas, tuya o pública de otro usuario. Por id o por URL de soundcloud.com.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "string" }, url: { type: "string" } } },
    run: async ({ playlist_id, url }) => {
      const { id } = await resolveId("playlist", playlist_id, url);
      const { p, tracks, hidden } = await getPlaylistFull(id);
      return {
        ...slimPlaylist(p),
        ...(p.description ? { description: String(p.description).slice(0, 300) } : {}),
        ...(p.genre ? { genre: p.genre } : {}),
        ...(p.tag_list ? { tags: String(p.tag_list).slice(0, 200) } : {}),
        ...(hidden ? { hidden_by_api: hidden, note: "La API no devuelve todas las pistas de esta lista." } : {}),
        tracks: tracks.map(slimTrack),
      };
    },
  },
  create_playlist: {
    description: "Crea una playlist. Es PRIVADA salvo que public=true.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        track_ids: { type: "array", items: { type: "string" } },
        public: { type: "boolean" },
      },
      required: ["title"],
    },
    run: async ({ title, description, track_ids, public: pub = false }) => {
      const p = await sc(`/playlists`, {
        method: "POST",
        body: {
          playlist: {
            title,
            sharing: pub ? "public" : "private",
            ...(description ? { description } : {}),
            tracks: ids(track_ids).map((id) => ({ id })),
          },
        },
      });
      return slimPlaylist(p);
    },
  },
  add_tracks_to_playlist: {
    description: "Añade pistas al final de una playlist sin quitar las que ya tiene (ignora duplicados).",
    inputSchema: {
      type: "object",
      properties: { playlist_id: { type: "string" }, track_ids: { type: "array", items: { type: "string" } } },
      required: ["playlist_id", "track_ids"],
    },
    run: async ({ playlist_id, track_ids }) => {
      const pid = playlistId(playlist_id);
      return withPlaylistLock(pid, async () => {
        const { ids: cur } = await playlistTrackIds(pid);
        const add = [...new Set(ids(track_ids))].filter((x) => !cur.includes(x));
        if (!add.length) return { added: 0, total: cur.length, note: "Nada nuevo que añadir." };
        const p = await putTracks(pid, [...cur, ...add]);
        const after = (p?.tracks || []).map(rid);
        return {
          added: add.filter((x) => after.includes(x)).length,
          not_accepted: add.filter((x) => !after.includes(x)),
          total: after.length,
        };
      });
    },
  },
  remove_tracks_from_playlist: {
    description: "Quita una o varias pistas de una playlist en una sola escritura. Conserva el orden del resto.",
    inputSchema: {
      type: "object",
      properties: { playlist_id: { type: "string" }, track_ids: { type: "array", items: { type: "string" } } },
      required: ["playlist_id", "track_ids"],
    },
    run: async ({ playlist_id, track_ids }) => removeTracks(playlist_id, track_ids),
  },
  remove_track_from_playlist: {
    description: "Quita una pista de una playlist. Para varias, usa remove_tracks_from_playlist.",
    inputSchema: {
      type: "object",
      properties: { playlist_id: { type: "string" }, track_id: { type: "string" } },
      required: ["playlist_id", "track_id"],
    },
    run: async ({ playlist_id, track_id }) => removeTracks(playlist_id, [track_id]),
  },
  replace_track_in_playlist: {
    description:
      "Sustituye una pista por otra en la misma posición (p. ej. una subida de usuario por la versión oficial). Si la nueva ya estaba en otra posición, se quita de allí para no duplicarla.",
    inputSchema: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        old_track_id: { type: "string" },
        new_track_id: { type: "string" },
      },
      required: ["playlist_id", "old_track_id", "new_track_id"],
    },
    run: async ({ playlist_id, old_track_id, new_track_id }) => {
      const pid = playlistId(playlist_id);
      const [oldId] = ids([old_track_id]);
      const [newId] = ids([new_track_id]);
      if (!oldId || !newId) throw new Error("Indica old_track_id y new_track_id numéricos.");
      if (oldId === newId) throw new Error("old_track_id y new_track_id son la misma pista.");
      return withPlaylistLock(pid, async () => {
        const { ids: cur } = await playlistTrackIds(pid);
        const pos = cur.indexOf(oldId);
        if (pos < 0) throw new Error(`La pista ${oldId} no está en la playlist; no he cambiado nada.`);
        const next = cur.flatMap((x, i) => (i === pos ? [newId] : x === oldId || x === newId ? [] : [x]));
        const p = await putTracks(pid, next);
        const after = (p?.tracks || []).map(rid);
        return {
          replaced: after.includes(newId) && !after.includes(oldId),
          position: pos + 1,
          ...(after.includes(newId) ? {} : { not_accepted: [newId] }),
          total: after.length,
        };
      });
    },
  },
  suggest_tracks: {
    description:
      "A partir de 1 a 5 pistas semilla, reúne sus relacionadas de SoundCloud, quita duplicados, las semillas y lo que ya está en exclude_playlist_id, aplica filtros de BPM, duración y género, y ordena por cuántas semillas la sugieren, con bonus si mezcla en armonía con alguna. Solo devuelve candidatas: no escribe nada.",
    inputSchema: {
      type: "object",
      properties: {
        seed_track_ids: { type: "array", items: { type: "string" }, description: "Entre 1 y 5 pistas de partida" },
        exclude_playlist_id: { type: "string", description: "Quita las pistas que ya están en esta playlist" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Por defecto 20" },
        bpm_min: { type: "number" },
        bpm_max: { type: "number" },
        duration_min_s: { type: "integer" },
        duration_max_s: { type: "integer" },
        genres: { type: "array", items: { type: "string" }, description: "Filtra por género (sin distinguir mayúsculas)" },
        include_restricted: { type: "boolean", description: "Incluir preview/blocked. Por defecto true" },
        only_listenable: { type: "boolean", description: "Solo pistas que el usuario puede escuchar completas en SoundCloud" },
      },
      required: ["seed_track_ids"],
    },
    run: async (a) => {
      const seeds = [...new Set(ids(list(a.seed_track_ids)))];
      if (!seeds.length || seeds.length > 5) throw new Error("Indica entre 1 y 5 seed_track_ids numéricos.");
      const include = a.include_restricted !== false;
      const limit = clamp(a.limit, 20, 100);
      const exclude = new Set();
      if (a.exclude_playlist_id) {
        const { tracks } = await getPlaylistFull(playlistId(a.exclude_playlist_id));
        tracks.forEach((t) => exclude.add(rid(t)));
      }
      const seedRaw = [];
      for (const s of seeds) seedRaw.push(await sc(`/tracks/${s}`));
      const seedSet = new Set(seeds);
      const pool = new Map();
      for (const s of seeds) {
        const r = await pageAccess(`/tracks/${s}/related`, {}, { limit: 30 }, include);
        for (const t of r.items) {
          const id = rid(t);
          if (!id || seedSet.has(id) || exclude.has(id)) continue;
          const e = pool.get(id) || { raw: t, count: 0 };
          e.count++;
          pool.set(id, e);
        }
      }
      const lo = num(a.bpm_min), hi = num(a.bpm_max), dmin = num(a.duration_min_s), dmax = num(a.duration_max_s);
      const genres = list(a.genres).map(norm);
      const seedCams = seedRaw.map((t) => camelot(t.key_signature)).filter(Boolean);
      const dropped = { bpm: 0, duration: 0, genre: 0, not_listenable: 0 };
      const canListen = listenable();
      const cands = [];
      for (const { raw, count } of pool.values()) {
        const bpm = raw.bpm ? round1(raw.bpm) : null;
        if ((lo != null || hi != null) && (bpm == null || (lo != null && bpm < lo) || (hi != null && bpm > hi))) {
          dropped.bpm++;
          continue;
        }
        const secs = raw.duration ? raw.duration / 1000 : null;
        if ((dmin != null || dmax != null) && (secs == null || (dmin != null && secs < dmin) || (dmax != null && secs > dmax))) {
          dropped.duration++;
          continue;
        }
        if (genres.length && !genres.includes(norm(raw.genre))) {
          dropped.genre++;
          continue;
        }
        if (a.only_listenable && !canListen.has(listenOf(raw))) {
          dropped.not_listenable++;
          continue;
        }
        const cam = camelot(raw.key_signature);
        const harmonic = cam && seedCams.length ? seedCams.some((c) => harmonicMatch(c, cam)) : null;
        cands.push({ t: slimTrack(raw), count, harmonic, score: count * 10 + (harmonic ? 3 : 0) + Math.log10((raw.playback_count || 0) + 1) });
      }
      cands.sort((x, y) => y.score - x.score);
      const tracks = cands.slice(0, limit).map((c) => ({ ...c.t, suggested_by: c.count, harmonic_with_seed: c.harmonic }));
      return {
        seeds: seedRaw.map(slimTrack),
        tracks,
        stats: { pool: pool.size, dropped, returned: tracks.length, ...(cands.length > limit ? { more: cands.length - limit } : {}) },
      };
    },
  },
  find_official_version: {
    description:
      "Para una pista (sobre todo una subida de usuario), busca candidatas a su versión oficial: mismo título y artista, sello o mismo ISRC. Puntúa cada una y explica por qué. Solo sugiere: para cambiarla en una playlist usa replace_track_in_playlist.",
    inputSchema: {
      type: "object",
      properties: {
        track_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Por defecto 5" },
      },
      required: ["track_id"],
    },
    run: async ({ track_id, limit }) => {
      const id = idOf(track_id);
      if (!id) throw new Error("Indica un track_id numérico.");
      const o = await sc(`/tracks/${id}`);
      const artist = o.metadata_artist || o.user?.username || "";
      const core = norm(o.title);
      if (!core) throw new Error("La pista no tiene un título útil para buscar.");
      const r = await pageAccess(`/tracks`, { q: `${artist} ${core}`.trim() }, { limit: 30, def: 30 }, true);
      // "mix" no cuenta: "Original Mix" es el original, no un remix.
      const REMIX = /\b(remix|edit|bootleg|cover|rework|vip|live|dub|version|radio)\b/i;
      const aNorm = norm(artist);
      const out = [];
      for (const raw of r.items) {
        if (rid(raw) === id) continue;
        const cTitle = norm(raw.title);
        const sameIsrc = !!(o.isrc && raw.isrc && o.isrc === raw.isrc);
        if (!sameIsrc && cTitle !== core && !cTitle.includes(core)) continue;
        const cArtist = norm(raw.metadata_artist || raw.user?.username);
        // Sin ISRC, mismo artista o sello, el título parecido solo es ruido (p. ej. mashups).
        if (!sameIsrc && !(aNorm && cArtist === aNorm) && !raw.label_name) continue;
        const reasons = [];
        let score = 0;
        if (sameIsrc) {
          score += 10;
          reasons.push("mismo ISRC");
        }
        if (cTitle === core) {
          score += 3;
          reasons.push("mismo título");
        } else {
          score += 1;
          reasons.push("título parecido");
        }
        if (aNorm && cArtist === aNorm) {
          score += 3;
          reasons.push("mismo artista");
        }
        if (raw.label_name) {
          score += 2;
          reasons.push(`sello: ${raw.label_name}`);
        }
        if (raw.isrc) score += 1;
        if (REMIX.test(raw.title || "") && !REMIX.test(o.title || "")) {
          score -= 4;
          reasons.push("parece remix o edit");
        }
        if (score <= 0) continue;
        out.push({ ...slimTrack(raw), score, reasons, likely_official: sameIsrc || (!!raw.label_name && cArtist === aNorm) });
      }
      out.sort((x, y) => y.score - x.score);
      return { original: slimTrack(o), candidates: out.slice(0, clamp(limit, 5, 20)) };
    },
  },
  analyze_playlist: {
    description:
      "Resumen de una playlist para planificarla: duración total, BPM (mín., mediana, máx.), tonalidades en Camelot, géneros, años, pistas duplicadas, saltos de BPM mayores de 6 y choques armónicos entre pistas consecutivas. Solo lectura.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "string" }, url: { type: "string" } } },
    run: async ({ playlist_id, url }) => {
      const { id } = await resolveId("playlist", playlist_id, url);
      const { p, tracks, hidden } = await getPlaylistFull(id);
      return { playlist: slimPlaylist(p), ...analyzeTracks(tracks, hidden) };
    },
  },
  update_playlist: {
    description:
      "Cambia título, descripción, género o etiquetas de una playlist y/o reordena sus pistas: sort_by (bpm, camelot, duration o released, con direction asc/desc) o track_order con todas sus ids en el orden deseado. Nunca añade ni quita pistas. Si la API oculta alguna, no escribe. Si tras escribir no ve el mismo conjunto de pistas, restaura el orden anterior y avisa.",
    inputSchema: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        genre: { type: "string" },
        tags: { type: "string", description: "Etiquetas separadas por comas, p. ej. \"warm, deep house\"" },
        sort_by: { type: "string", enum: ["bpm", "camelot", "duration", "released"] },
        direction: { type: "string", enum: ["asc", "desc"] },
        track_order: { type: "array", items: { type: "string" }, description: "Todas las ids de la playlist, en el orden nuevo" },
      },
      required: ["playlist_id"],
    },
    run: async (a) => {
      const pid = playlistId(a.playlist_id);
      const meta = {};
      if (a.title != null) {
        if (!String(a.title).trim()) throw new Error("El título no puede estar vacío.");
        meta.title = String(a.title).trim();
      }
      if (a.description != null) meta.description = String(a.description);
      if (a.genre != null) meta.genre = String(a.genre);
      if (a.tags != null) meta.tag_list = toTagList(a.tags);
      if (a.sort_by && a.track_order) throw new Error("Usa sort_by o track_order, no los dos.");
      if (!Object.keys(meta).length && !a.sort_by && !a.track_order) throw new Error("No hay nada que cambiar.");
      return withPlaylistLock(pid, async () => {
        const { p, tracks, hidden } = await getPlaylistFull(pid);
        assertComplete(p, hidden);
        const before = tracks.map(rid);
        let next = before;
        if (a.track_order) {
          const wanted = ids(list(a.track_order));
          const same =
            wanted.length === before.length && new Set(wanted).size === wanted.length && before.every((x) => wanted.includes(x));
          if (!same) throw new Error(`track_order debe llevar exactamente las ${before.length} pistas actuales, una vez cada una. No he cambiado nada.`);
          next = wanted;
        } else if (a.sort_by) {
          next = sortIds(tracks, a.sort_by, a.direction);
        }
        const reordered = next.some((x, i) => x !== before[i]);
        const p2 = await writePlaylist(pid, next, meta);
        const after = (p2?.tracks || []).map(rid);
        const sameSet = after.length === before.length && before.every((x) => after.includes(x));
        if (!sameSet) {
          await writePlaylist(pid, before);
          throw new Error("SoundCloud no devolvió el mismo conjunto de pistas tras escribir; he restaurado el orden anterior. Revisa la playlist en SoundCloud.");
        }
        return { ...slimPlaylist(p2), changed: [...Object.keys(meta), ...(reordered ? ["order"] : [])], reordered, total: after.length };
      });
    },
  },
};

async function removeTracks(playlist_id, track_ids) {
  const pid = playlistId(playlist_id);
  const drop = new Set(ids(track_ids));
  if (!drop.size) throw new Error("Indica al menos un track_id numérico.");
  return withPlaylistLock(pid, async () => {
    const { ids: cur } = await playlistTrackIds(pid);
    const found = [...drop].filter((x) => cur.includes(x));
    const not_found = [...drop].filter((x) => !cur.includes(x));
    if (!found.length) return { removed: 0, not_found, total: cur.length, note: "Ninguna de esas pistas estaba en la playlist." };
    const p = await putTracks(pid, cur.filter((x) => !drop.has(x)));
    const after = (p?.tracks || []).map(rid);
    const still = found.filter((x) => after.includes(x));
    return {
      removed: found.length - still.length,
      ...(not_found.length ? { not_found } : {}),
      ...(still.length ? { not_removed: still } : {}),
      total: after.length,
    };
  });
}

// ---------- Protocolo MCP (JSON-RPC por stdio, un mensaje por línea) ----------
export async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return null; // notificación
  try {
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "soundcrate", version: "1.4.0" },
          instructions: `${LISTEN_NOTE} ${listenStatus()}`,
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
        });
      case "tools/call": {
        const t = TOOLS[params?.name];
        if (!t) return fail(-32602, `Herramienta desconocida: ${params?.name}`);
        try {
          const out = await t.run(params.arguments || {});
          return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return reply({ isError: true, content: [{ type: "text", text: String(e.message || e) }] });
        }
      }
      default:
        return fail(-32601, `Método no soportado: ${method}`);
    }
  } catch (e) {
    return fail(-32603, String(e.message || e));
  }
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  });
  log("listo");
}
export const _camelot = camelot; // para las pruebas
export const _harmonicMatch = harmonicMatch; // para las pruebas
