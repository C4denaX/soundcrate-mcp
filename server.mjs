#!/usr/bin/env node
// SoundCrate MCP: servidor MCP local (stdio) para SoundCloud. Sin dependencias externas.
// Funciona con cualquier cliente MCP por stdio (Claude, OpenCode, Cursor, VS Code, Codex, Gemini CLI…).
// Herramientas: buscar y descubrir pistas, artistas, playlists y emisoras; sugerir pistas, analizar y reordenar playlists;
// crear playlists y añadir/quitar/sustituir pistas.
// No incluye descarga ni URLs de streaming (las condiciones de la API lo prohíben) ni borrado de playlists.

import readline from "node:readline";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as lib from "./lib.mjs";
import { startSetup } from "./setup.mjs";

const SetupError = lib.SetupError;
const deps = {
  fetch: (...a) => fetch(...a),
  // Almacén de secretos del sistema (Llavero, Secret Service, Administrador de credenciales o fichero): secrets.mjs
  secretGet: lib.secretGet,
  secretSet: lib.secretSet,
  store: lib.store,
  credentials: lib.credentials,
  tokenRequest: lib.tokenRequest,
  startSetup,
  // La API no informa de Go+ (/me solo lista planes de artista): el usuario lo declara con SC_GO_PLUS=1.
  goPlus: /^(1|true|yes|si|sí)$/i.test(process.env.SC_GO_PLUS || ""),
};
export function _setDeps(d) {
  Object.assign(deps, d);
}

const log = (...a) => process.stderr.write("[soundcrate] " + a.join(" ") + "\n");

// ---------- Tokens ----------
let access = null; // { token, exp }
let refreshing = null;
let creds = null; // client_id/secret en memoria: en Windows cada lectura del almacén tarda 1-3 s

// Tras configurar o volver a conectar desde start_setup, olvidar lo que hubiera en memoria.
function resetSession(tok) {
  creds = null;
  access = tok?.access_token ? { token: tok.access_token, exp: Date.now() + ((tok.expires_in || 3600) - 120) * 1000 } : null;
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = deps.secretGet("refresh_token");
    if (!rt) throw new SetupError("SoundCrate is not connected to a SoundCloud account yet.");
    const { clientId, clientSecret } = (creds ??= deps.credentials());
    let tok;
    try {
      tok = await deps.tokenRequest({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: rt,
      });
    } catch (e) {
      if (/oauth\/token (400|401)/.test(e.message)) {
        creds = null;
        throw new SetupError("The saved SoundCloud session or app credentials are no longer valid; the user needs to connect again.");
      }
      throw e;
    }
    // Los refresh tokens son de un solo uso: guardar siempre el nuevo.
    if (tok.refresh_token) deps.secretSet("refresh_token", tok.refresh_token);
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
  if (new URL(url).origin !== API_ORIGIN) throw new Error(`URL not allowed (only ${API_ORIGIN}).`);
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
  if (res.status === 429) throw new Error("SoundCloud rate limit reached; wait a moment and retry.");
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
  "Each track has 'listen': full = plays in full for anyone; go_plus = snippet without a subscription, full with Go+; " +
  "go_plus_probable = label catalogue the API won't stream off SoundCloud, usually full with Go+ on SoundCloud (no regional guarantee); " +
  "restricted = blocked, no label or ISRC (rights, region or uploader): may not play even with Go+. " +
  "All can be added to playlists. The API does not report whether the user has Go+.";
const listenStatus = () =>
  deps.goPlus
    ? "The user has declared Go+ (SC_GO_PLUS): go_plus and go_plus_probable tracks play in full for them."
    : "The user has not declared Go+ (SC_GO_PLUS): only 'full' plays in full; go_plus plays a snippet.";

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x))) throw new Error(`Invalid date: ${x} (use YYYY-MM-DD).`);
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
    if (o?.kind !== kind) throw new Error(`That URL is a ${o?.kind || "unknown resource"}, not a ${kind}.`);
    return { id: rid(o), obj: o };
  }
  const id = idOf(idValue);
  if (!id) throw new Error(`Provide a numeric ${kind}_id or a url.`);
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
      `SoundCloud hides ${hidden} of the ${p.track_count} tracks of this playlist when reading it. ` +
        `Rewriting it would delete them, so nothing was changed. Add those tracks from the SoundCloud web or app, ` +
        `or create a new playlist with create_playlist.`
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
  if (!pid) throw new Error("Provide a numeric playlist_id.");
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
  if (!key) throw new Error("sort_by must be bpm, camelot, duration or released.");
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
    camelot: topN(tally(raw.map((t) => camelot(t.key_signature) || "unknown")), 12),
    genres: topN(tally(raw.map((t) => t.genre || "unknown")), 8),
    years: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    access: tally(raw.map((t) => t.access || "unknown")),
    listen: tally(raw.map((t) => listenOf(t) || "unknown")),
    duplicates: duplicates.slice(0, 20),
    bpm_jumps: { total: jumps.length, examples: jumps.slice(0, 10) },
    harmonic_clashes: { total: clashes.length, examples: clashes.slice(0, 10) },
  };
}


// ---------- Configuración guiada ----------
// Dónde se añade SC_GO_PLUS=1 en los clientes más comunes (el agente se lo explica al usuario).
const CLIENT_CONFIG = {
  "Claude Desktop": 'claude_desktop_config.json → mcpServers.<name>.env: { "SC_GO_PLUS": "1" }',
  "Claude Code": "claude mcp add … -e SC_GO_PLUS=1, or .mcp.json → env",
  OpenCode: 'opencode.json(c) → mcp.<name>.environment: { "SC_GO_PLUS": "1" }',
  Cursor: '~/.cursor/mcp.json → mcpServers.<name>.env: { "SC_GO_PLUS": "1" }',
  "VS Code": 'mcp.json → servers.<name>.env: { "SC_GO_PLUS": "1" }',
  "Codex CLI": '~/.codex/config.toml → [mcp_servers.<name>] env = { SC_GO_PLUS = "1" }',
  "Gemini CLI": '~/.gemini/settings.json → mcpServers.<name>.env: { "SC_GO_PLUS": "1" }',
};

async function buildStatus(verify) {
  const steps = [];
  const add = (id, title, status, extra = {}) => steps.push({ step: steps.length + 1, id, title, status, ...extra });

  // 1. Almacén de secretos
  let st = null, probe;
  try {
    st = deps.store();
    probe = st.probe();
  } catch (e) {
    probe = { ok: false, problem: e.message, fix: e.fix };
  }
  add("secure_storage", "Secure storage for the credentials", probe.ok ? "done" : "todo", {
    detail: st ? st.label : null,
    ...(probe.problem ? { problem: probe.problem } : {}),
    ...(probe.warning ? { warning: probe.warning } : {}),
    ...(probe.ok ? {} : { how: [].concat(probe.fix || []).concat(["Then restart the MCP client and call setup_status again."]) }),
  });

  // 2. App de SoundCloud (Client ID / Secret)
  let hasCreds = false, credsProblem = null;
  if (probe.ok || process.env.SC_CLIENT_ID) {
    try {
      deps.credentials();
      hasCreds = true;
    } catch (e) {
      if (!e.setup) credsProblem = e.message;
    }
  }
  add("soundcloud_app", "Register a SoundCloud app and save its Client ID and Client Secret", hasCreds ? "done" : "todo", {
    ...(credsProblem ? { problem: credsProblem } : {}),
    ...(hasCreds
      ? {}
      : {
          how: [
            "Call start_setup: it opens a local page that walks the user through it.",
            `On that page the user opens ${lib.APPS_URL} (needs a SoundCloud Artist Pro plan), creates an app with Redirect URI ${lib.REDIRECT_URI}, and types the Client ID and Client Secret.`,
          ],
        }),
  });

  // 3. Sesión
  let hasSession = false;
  if (probe.ok) {
    try {
      hasSession = !!deps.secretGet("refresh_token");
    } catch {}
  }
  add("connect_account", "Connect the SoundCloud account", hasSession ? "done" : "todo", hasSession ? {} : { how: ["Call start_setup and ask the user to click 'Connect with SoundCloud' and authorize the app."] });

  // 4. Comprobación real
  let user = null;
  if (verify && hasCreds && hasSession) {
    try {
      const me = await sc("/me");
      user = me.username;
      add("check_session", "Check the session with SoundCloud", "done", { detail: `Connected as ${user}` });
    } catch (e) {
      add("check_session", "Check the session with SoundCloud", "error", {
        problem: e.message,
        how: e.setup ? ["Call start_setup and connect the account again."] : ["Try again later; if it keeps failing, call start_setup to reconnect."],
      });
    }
  }

  // 5. Go+ (opcional)
  add("go_plus", "Tell SoundCrate whether the user has SoundCloud Go+ (optional)", deps.goPlus ? "done" : "optional", {
    detail: deps.goPlus ? "Go+ declared (SC_GO_PLUS=1)." : "Go+ not declared.",
    ...(deps.goPlus
      ? {}
      : {
          how: [
            "Ask the user if they have SoundCloud Go+. If yes, add the environment variable SC_GO_PLUS=1 to this MCP server in their client configuration and restart the client.",
            CLIENT_CONFIG,
          ],
        }),
  });

  const required = steps.filter((x) => x.id !== "go_plus");
  const ready = required.every((x) => x.status === "done") && (!verify || !!user);
  const next = steps.find((x) => x.status === "todo" || x.status === "error") || null;
  return {
    ready,
    ...(user ? { connected_as: user } : {}),
    platform: process.platform,
    node: process.version,
    steps,
    next_step: next,
    guidance_for_agent: ready
      ? "SoundCrate is ready. If Go+ is not declared, you may ask the user whether they have it."
      : "Explain the next step to the user in plain, friendly language (in their language), one step at a time, and offer to run start_setup yourself. Never ask for the Client Secret in the chat. After each step, call setup_status again.",
  };
}

// ---------- Herramientas ----------
const TOOLS = {
  setup_status: {
    description:
      "Check whether SoundCrate is ready on this computer and, if not, get the exact next steps. Call it when the user is new to SoundCrate, asks how to set it up, or when any tool fails with a setup error. " +
      "Then guide the user one step at a time, in plain language and in their language, and offer to run start_setup for them. Never ask the user to paste the Client Secret into the chat: start_setup opens a local page where they type it.",
    inputSchema: {
      type: "object",
      properties: { verify_session: { type: "boolean", description: "Also check the saved session against SoundCloud (default true)" } },
    },
    run: async ({ verify_session = true }) => buildStatus(verify_session),
  },
  start_setup: {
    description:
      "Open SoundCrate's local setup page in the user's browser (served only on 127.0.0.1). There the user follows the steps to register a SoundCloud app, types its Client ID and Client Secret, and connects their account; the secrets go straight to the system's secure storage and never pass through the chat. " +
      "Returns the URL in case the browser does not open. When the user says they are done, call setup_status to confirm.",
    inputSchema: {
      type: "object",
      properties: { open_browser: { type: "boolean", description: "Default true. Set false to only get the URL (e.g. when the browser is on another machine)." } },
    },
    run: async ({ open_browser = true }) => {
      const s = await deps.startSetup({ open: open_browser !== false, onSuccess: (r) => resetSession(r) });
      return {
        url: s.url,
        browser_opened: !!s.opened,
        already_running: !!s.already_running,
        secure_storage: s.store,
        tell_user: s.opened
          ? "A setup page has opened in your browser. Follow the three steps there; when SoundCloud sends you back and the page says it is connected, tell me."
          : `Open this page in your browser on this computer and follow the three steps: ${s.url}`,
        next: "When the user says they finished, call setup_status to confirm everything is ready.",
      };
    },
  },
  search_tracks: {
    description:
      "Search tracks by text and/or filters (genres, tags, BPM, duration, upload date). Returns id, title, user, BPM, key, Camelot, genre, label, release date, plays, likes, access and listen. " +
      LISTEN_NOTE +
      " only_listenable=true keeps only tracks the user can play in full. Tracks without bpm are dropped when filtering by BPM. " +
      "For the next page, pass next_cursor as cursor.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (artist and title)" },
        genres: { type: "array", items: { type: "string" }, description: "Genres, e.g. [\"Techno\", \"House\"]" },
        tags: { type: "array", items: { type: "string" }, description: "Track tags" },
        bpm_min: { type: "number" },
        bpm_max: { type: "number" },
        duration_min_s: { type: "integer", description: "Minimum duration in seconds" },
        duration_max_s: { type: "integer", description: "Maximum duration in seconds" },
        uploaded_after: { type: "string", description: "Uploaded on or after (YYYY-MM-DD)" },
        uploaded_before: { type: "string", description: "Uploaded on or before (YYYY-MM-DD)" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum results (default 10)" },
        include_restricted: {
          type: "boolean",
          description: "Include preview/blocked tracks as well as playable ones (default true)",
        },
        only_listenable: { type: "boolean", description: "Only tracks the user can play in full on SoundCloud" },
        cursor: { type: "string", description: "next_cursor from a previous call, for the next page" },
      },
    },
    run: async (a) => {
      const { query, genres, tags, limit, include_restricted = true, cursor } = a;
      if (!cursor && !query && !list(genres).length && !list(tags).length)
        throw new Error("Provide query, genres or tags.");
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
    description: "Get one track by id or soundcloud.com URL.",
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
      "Tracks related to a track (SoundCloud's recommendations). Useful to grow a playlist from seed tracks. exclude_playlist_id removes tracks already in that playlist.",
    inputSchema: {
      type: "object",
      properties: {
        track_id: { type: "string" },
        url: { type: "string", description: "soundcloud.com track URL, instead of track_id" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20" },
        exclude_playlist_id: { type: "string", description: "Remove tracks already in this playlist from the result" },
        include_restricted: { type: "boolean", description: "Default true" },
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
      "Tracks from the user's account to inspire playlists. source: likes (liked tracks), recently_played (last 25 plays), feed (uploads and reposts from followed users), followings (recent uploads from followed users), reposts (the user's reposts).",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["likes", "recently_played", "feed", "followings", "reposts"] },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20" },
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
          throw new Error("source must be likes, recently_played, feed, followings or reposts.");
      }
    },
  },
  search_users: {
    description: "Search artists, labels or DJs. Returns id, name, location, followers and track count.",
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
    description: "Artists similar to a given one, according to SoundCloud.",
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
      "Content from an artist, label or DJ. kind: tracks (their uploads), likes, reposts or playlists. Useful for digging through what reference DJs play.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        url: { type: "string", description: "soundcloud.com profile URL, instead of user_id" },
        kind: { type: "string", enum: ["tracks", "likes", "reposts", "playlists"] },
        sort: { type: "string", enum: ["newest", "oldest"], description: "Only for kind=tracks. Default newest" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20" },
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
      if (!path) throw new Error("kind must be tracks, likes, reposts or playlists.");
      const extra = kind === "tracks" ? { sort: sort === "oldest" ? "asc" : "desc" } : {};
      const r = await pageAccess(`/users/${uid}/${path}`, extra, { limit, cursor });
      return { ...who, tracks: r.items.map(slimTrack), next_cursor: r.next_cursor };
    },
  },
  search_playlists: {
    description: "Search PUBLIC playlists from any SoundCloud user (without tracks); it does not find the user's private playlists, use get_my_playlists for those. Then get_playlist returns their tracks.",
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
      "A SoundCloud station (system playlist) with its tracks. Ids come from get_my_playlists(kind=stations), e.g. soundcloud:system-playlists:track-stations:123.",
    inputSchema: { type: "object", properties: { station_id: { type: "string" } }, required: ["station_id"] },
    run: async ({ station_id }) => {
      const sid = String(station_id || "").trim();
      if (!/^[a-z0-9-]+(:[A-Za-z0-9_-]+)+$/.test(sid)) throw new Error("Invalid station_id.");
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
      "Check the session: user, plan and subscriptions SoundCloud reports for the account, and whether Go+ is declared. force_refresh=true gets a new token first.",
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
        note: "The API does not report Go+ (subscriptions only lists creator plans). Declare it with SC_GO_PLUS=1 in the server configuration.",
      };
    },
  },
  get_my_playlists: {
    description:
      "The user's playlists, including private ones, without tracks. kind: own (default), liked (liked playlists) or stations (liked stations; open them with get_station). query filters by title (case- and accent-insensitive). Use this to find one of the user's playlists by name.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["own", "liked", "stations"] },
        query: { type: "string", description: "Only playlists whose title contains this text" },
      },
    },
    run: async ({ kind = "own", query }) => {
      const src = { own: ["/me/playlists", slimPlaylist], liked: ["/me/likes/playlists", slimPlaylist], stations: ["/me/likes/system-playlists", slimStation] }[kind];
      if (!src) throw new Error("kind must be own, liked or stations.");
      const out = [];
      let next = `${src[0]}?limit=50&linked_partitioning=true${kind === "own" ? "&show_tracks=false" : ""}`;
      for (let i = 0; next && i < 20; i++) {
        const b = await sc(next);
        out.push(...coll(b).map(src[1]));
        next = b?.next_href || null;
      }
      const q = query ? norm(query) : "";
      const found = q ? out.filter((p) => norm(p.title).includes(q)) : out;
      return { [kind === "stations" ? "stations" : "playlists"]: found, ...(q ? { total_before_filter: out.length } : {}) };
    },
  },
  get_playlist: {
    description: "A playlist with its tracks, the user's own or another user's public one. By id or soundcloud.com URL.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "string" }, url: { type: "string" } } },
    run: async ({ playlist_id, url }) => {
      const { id } = await resolveId("playlist", playlist_id, url);
      const { p, tracks, hidden } = await getPlaylistFull(id);
      return {
        ...slimPlaylist(p),
        ...(p.description ? { description: String(p.description).slice(0, 300) } : {}),
        ...(p.genre ? { genre: p.genre } : {}),
        ...(p.tag_list ? { tags: String(p.tag_list).slice(0, 200) } : {}),
        ...(hidden ? { hidden_by_api: hidden, note: "The API does not return every track of this playlist." } : {}),
        tracks: tracks.map(slimTrack),
      };
    },
  },
  create_playlist: {
    description: "Create a playlist. It is PRIVATE unless public=true.",
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
    description: "Append tracks to the end of a playlist without removing existing ones (duplicates are ignored).",
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
        if (!add.length) return { added: 0, total: cur.length, note: "Nothing new to add." };
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
    description: "Remove one or more tracks from a playlist in a single write. Keeps the order of the rest.",
    inputSchema: {
      type: "object",
      properties: { playlist_id: { type: "string" }, track_ids: { type: "array", items: { type: "string" } } },
      required: ["playlist_id", "track_ids"],
    },
    run: async ({ playlist_id, track_ids }) => removeTracks(playlist_id, track_ids),
  },
  remove_track_from_playlist: {
    description: "Remove one track from a playlist. For several, use remove_tracks_from_playlist.",
    inputSchema: {
      type: "object",
      properties: { playlist_id: { type: "string" }, track_id: { type: "string" } },
      required: ["playlist_id", "track_id"],
    },
    run: async ({ playlist_id, track_id }) => removeTracks(playlist_id, [track_id]),
  },
  replace_track_in_playlist: {
    description:
      "Replace a track with another at the same position (e.g. a user upload with the official release). If the new track was already elsewhere in the playlist, it is removed there to avoid duplicates.",
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
      if (!oldId || !newId) throw new Error("Provide numeric old_track_id and new_track_id.");
      if (oldId === newId) throw new Error("old_track_id and new_track_id are the same track.");
      return withPlaylistLock(pid, async () => {
        const { ids: cur } = await playlistTrackIds(pid);
        const pos = cur.indexOf(oldId);
        if (pos < 0) throw new Error(`Track ${oldId} is not in the playlist; nothing was changed.`);
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
      "From 1 to 5 seed tracks, gathers their SoundCloud related tracks, removes duplicates, the seeds and anything already in exclude_playlist_id, applies BPM, duration and genre filters, and ranks by how many seeds suggest each track, with a bonus when it mixes harmonically with a seed. Returns candidates only: it writes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        seed_track_ids: { type: "array", items: { type: "string" }, description: "1 to 5 seed tracks" },
        exclude_playlist_id: { type: "string", description: "Remove tracks already in this playlist" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20" },
        bpm_min: { type: "number" },
        bpm_max: { type: "number" },
        duration_min_s: { type: "integer" },
        duration_max_s: { type: "integer" },
        genres: { type: "array", items: { type: "string" }, description: "Filter by genre (case-insensitive)" },
        include_restricted: { type: "boolean", description: "Include preview/blocked. Default true" },
        only_listenable: { type: "boolean", description: "Only tracks the user can play in full on SoundCloud" },
      },
      required: ["seed_track_ids"],
    },
    run: async (a) => {
      const seeds = [...new Set(ids(list(a.seed_track_ids)))];
      if (!seeds.length || seeds.length > 5) throw new Error("Provide 1 to 5 numeric seed_track_ids.");
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
      "For a track (especially a user upload), finds candidates for its official release: same title and artist, label, or same ISRC. Scores each one and explains why. Suggestions only: to swap it in a playlist use replace_track_in_playlist.",
    inputSchema: {
      type: "object",
      properties: {
        track_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 5" },
      },
      required: ["track_id"],
    },
    run: async ({ track_id, limit }) => {
      const id = idOf(track_id);
      if (!id) throw new Error("Provide a numeric track_id.");
      const o = await sc(`/tracks/${id}`);
      const artist = o.metadata_artist || o.user?.username || "";
      const core = norm(o.title);
      if (!core) throw new Error("The track has no usable title to search for.");
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
          reasons.push("same ISRC");
        }
        if (cTitle === core) {
          score += 3;
          reasons.push("same title");
        } else {
          score += 1;
          reasons.push("similar title");
        }
        if (aNorm && cArtist === aNorm) {
          score += 3;
          reasons.push("same artist");
        }
        if (raw.label_name) {
          score += 2;
          reasons.push(`label: ${raw.label_name}`);
        }
        if (raw.isrc) score += 1;
        if (REMIX.test(raw.title || "") && !REMIX.test(o.title || "")) {
          score -= 4;
          reasons.push("looks like a remix or edit");
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
      "Summary of a playlist for planning: total duration, BPM (min, median, max), Camelot keys, genres, years, duplicate tracks, BPM jumps above 6 and harmonic clashes between consecutive tracks, plus counts by access and listen. Read-only.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "string" }, url: { type: "string" } } },
    run: async ({ playlist_id, url }) => {
      const { id } = await resolveId("playlist", playlist_id, url);
      const { p, tracks, hidden } = await getPlaylistFull(id);
      return { playlist: slimPlaylist(p), ...analyzeTracks(tracks, hidden) };
    },
  },
  update_playlist: {
    description:
      "Change a playlist's title, description, genre or tags and/or reorder its tracks: sort_by (bpm, camelot, duration or released, with direction asc/desc) or track_order with all its ids in the desired order. Never adds or removes tracks. Does not write if the API hides any track. If after writing it does not see the same set of tracks, it restores the previous order and reports it.",
    inputSchema: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        genre: { type: "string" },
        tags: { type: "string", description: "Comma-separated tags, e.g. \"warm, deep house\"" },
        sort_by: { type: "string", enum: ["bpm", "camelot", "duration", "released"] },
        direction: { type: "string", enum: ["asc", "desc"] },
        track_order: { type: "array", items: { type: "string" }, description: "All the playlist's ids, in the new order" },
      },
      required: ["playlist_id"],
    },
    run: async (a) => {
      const pid = playlistId(a.playlist_id);
      const meta = {};
      if (a.title != null) {
        if (!String(a.title).trim()) throw new Error("Title cannot be empty.");
        meta.title = String(a.title).trim();
      }
      if (a.description != null) meta.description = String(a.description);
      if (a.genre != null) meta.genre = String(a.genre);
      if (a.tags != null) meta.tag_list = toTagList(a.tags);
      if (a.sort_by && a.track_order) throw new Error("Use sort_by or track_order, not both.");
      if (!Object.keys(meta).length && !a.sort_by && !a.track_order) throw new Error("Nothing to change.");
      return withPlaylistLock(pid, async () => {
        const { p, tracks, hidden } = await getPlaylistFull(pid);
        assertComplete(p, hidden);
        const before = tracks.map(rid);
        let next = before;
        if (a.track_order) {
          const wanted = ids(list(a.track_order));
          const same =
            wanted.length === before.length && new Set(wanted).size === wanted.length && before.every((x) => wanted.includes(x));
          if (!same) throw new Error(`track_order must contain exactly the ${before.length} current tracks, once each. Nothing was changed.`);
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
          throw new Error("SoundCloud did not return the same set of tracks after writing; the previous order was restored. Check the playlist on SoundCloud.");
        }
        return { ...slimPlaylist(p2), changed: [...Object.keys(meta), ...(reordered ? ["order"] : [])], reordered, total: after.length };
      });
    },
  },
};

async function removeTracks(playlist_id, track_ids) {
  const pid = playlistId(playlist_id);
  const drop = new Set(ids(track_ids));
  if (!drop.size) throw new Error("Provide at least one numeric track_id.");
  return withPlaylistLock(pid, async () => {
    const { ids: cur } = await playlistTrackIds(pid);
    const found = [...drop].filter((x) => cur.includes(x));
    const not_found = [...drop].filter((x) => !cur.includes(x));
    if (!found.length) return { removed: 0, not_found, total: cur.length, note: "None of those tracks were in the playlist." };
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
// Servidor de doble versión, como prevé la especificación 2026-07-28:
// - Clientes "legacy" (2025-11-25 y anteriores): handshake initialize / notifications/initialized.
// - Clientes "modernos" (2026-07-28): sin handshake; cada petición lleva la versión en _meta y existe server/discover.
export const VERSION = "1.7.0";
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MODERN_VERSIONS = ["2026-07-28"];
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER = "io.modelcontextprotocol/serverInfo";
const SERVER_INFO = { name: "soundcrate", title: "SoundCrate", version: VERSION };
const CAPABILITIES = { tools: { listChanged: false } };
const CACHE = { ttlMs: 300000, cacheScope: "private" }; // las descripciones dependen de SC_GO_PLUS
const SETUP_NOTE =
  "If the user is new to SoundCrate or a tool says it is not set up, call setup_status and guide them step by step; " +
  "start_setup opens a local page where they enter their credentials, so never ask for secrets in the chat.";
const instructions = () => `${SETUP_NOTE} ${LISTEN_NOTE} ${listenStatus()}`;

// Títulos y anotaciones: los clientes los usan para pedir confirmación antes de las escrituras.
const READ = { readOnlyHint: true, openWorldHint: true };
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const CHANGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
const TOOL_META = {
  setup_status: ["Check SoundCrate setup", READ],
  start_setup: ["Open SoundCrate setup page", { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
  search_tracks: ["Search tracks", READ],
  get_track: ["Get track", READ],
  get_related_tracks: ["Related tracks", READ],
  get_my_tracks: ["My tracks (likes, feed, history)", READ],
  search_users: ["Search artists and users", READ],
  get_related_artists: ["Related artists", READ],
  get_user_content: ["Artist or DJ content", READ],
  search_playlists: ["Search playlists", READ],
  get_station: ["Get station", READ],
  whoami: ["Check session", READ],
  get_my_playlists: ["My playlists", READ],
  get_playlist: ["Get playlist", READ],
  suggest_tracks: ["Suggest tracks from seeds", READ],
  find_official_version: ["Find official release", READ],
  analyze_playlist: ["Analyze playlist", READ],
  create_playlist: ["Create playlist", { ...ADD, idempotentHint: false }],
  add_tracks_to_playlist: ["Add tracks to playlist", { ...ADD, idempotentHint: true }],
  remove_tracks_from_playlist: ["Remove tracks from playlist", CHANGE],
  remove_track_from_playlist: ["Remove track from playlist", CHANGE],
  replace_track_in_playlist: ["Replace track in playlist", CHANGE],
  update_playlist: ["Update or reorder playlist", CHANGE],
};
// Herramientas que filtran por 'listen': su descripción dice si el usuario ha declarado Go+,
// por si el cliente no muestra las instructions del servidor al modelo.
const GOPLUS_AWARE = new Set(["search_tracks", "suggest_tracks"]);

export function listTools() {
  return Object.entries(TOOLS).map(([name, t]) => {
    const [title, annotations] = TOOL_META[name];
    return {
      name,
      title,
      description: GOPLUS_AWARE.has(name) ? `${t.description} ${listenStatus()}` : t.description,
      inputSchema: t.inputSchema,
      annotations: { title, ...annotations },
    };
  });
}

// Un error de configuración lleva al agente a setup_status, que le da los pasos para guiar al usuario.
function errorText(e) {
  const msg = String(e?.message || e);
  if (!e?.setup) return msg;
  const fix = e.fix ? ` How to fix it: ${[].concat(e.fix).join("; ")}.` : "";
  return `${msg}${fix} Call the setup_status tool to get step-by-step instructions, and guide the user through them.`;
}

export async function handle(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== "string") {
    // Respuestas del cliente (este servidor no le hace peticiones) o mensajes mal formados.
    if ("result" in msg || "error" in msg) return null;
    return { jsonrpc: "2.0", id: isRequest ? id : null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (!isRequest) return null; // notificaciones: notifications/initialized, notifications/cancelled…

  const requested = params?._meta?.[META_VERSION];
  const modern = requested !== undefined && method !== "initialize";
  const fail = (code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
  const reply = (result) => ({
    jsonrpc: "2.0",
    id,
    result: modern ? { resultType: "complete", ...result, _meta: { ...(result._meta || {}), [META_SERVER]: SERVER_INFO } } : result,
  });

  if (method === "server/discover") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "complete",
        supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: instructions(),
        ...CACHE,
        _meta: { [META_SERVER]: SERVER_INFO },
      },
    };
  }
  if (modern && !MODERN_VERSIONS.includes(requested)) {
    return fail(-32022, "Unsupported protocol version", { supported: MODERN_VERSIONS, requested });
  }

  try {
    switch (method) {
      case "initialize": {
        const v = params?.protocolVersion;
        return reply({
          protocolVersion: LEGACY_VERSIONS.includes(v) ? v : LEGACY_VERSIONS[0],
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
          instructions: instructions(),
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listTools(), ...(modern ? CACHE : {}) });
      case "tools/call": {
        const t = TOOLS[params?.name];
        if (!t) return fail(-32602, `Unknown tool: ${params?.name}`);
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
        try {
          const out = await t.run(args);
          return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return reply({ isError: true, content: [{ type: "text", text: errorText(e) }] });
        }
      }
      // Sin recursos ni prompts, pero algunos clientes los piden igualmente: listas vacías en vez de error.
      case "resources/list":
        return reply({ resources: [] });
      case "resources/templates/list":
        return reply({ resourceTemplates: [] });
      case "prompts/list":
        return reply({ prompts: [] });
      case "logging/setLevel":
        return reply({});
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return fail(-32603, String(e.message || e));
  }
}

// ¿Se ejecuta como programa? Con npx o un ejecutable de npm, argv[1] es un enlace: se compara la ruta real.
function isMain() {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const write = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (Array.isArray(msg)) {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch requests are not supported" } });
    }
    const out = await handle(msg);
    if (out) write(out);
  });
  log(`ready (v${VERSION}, Go+ ${deps.goPlus ? "declared" : "not declared"})`);
}
export const _camelot = camelot; // para las pruebas
export const _harmonicMatch = harmonicMatch; // para las pruebas
