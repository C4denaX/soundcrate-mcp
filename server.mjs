#!/usr/bin/env node
// SoundCrate MCP: servidor MCP local (stdio) para SoundCloud. Sin dependencias externas.
// Herramientas: buscar pistas, ver pistas y playlists, crear playlists y añadir/quitar/sustituir pistas.
// No incluye descarga ni URLs de streaming (las condiciones de la API lo prohíben) ni borrado de playlists.

import readline from "node:readline";
import * as lib from "./lib.mjs";

const deps = {
  fetch: (...a) => fetch(...a),
  kcGet: lib.kcGet,
  kcSet: lib.kcSet,
  credentials: lib.credentials,
  tokenRequest: lib.tokenRequest,
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
async function sc(path, { method = "GET", body, retry = true } = {}) {
  const url = path.startsWith("http") ? path : lib.API + path;
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
const slimTrack = (t) => ({
  id: String(t.id),
  title: t.title,
  user: t.user?.username,
  access: t.access, // playable | preview | blocked: restricción vista por la app, no por la cuenta (con Go+ suelen sonar)
  duration: mmss(t.duration),
  genre: t.genre || null,
  label: t.label_name || null,
  release_year: t.release_year || null,
  plays: t.playback_count ?? null,
  url: t.permalink_url,
});
const slimPlaylist = (p) => ({
  id: String(p.id),
  title: p.title,
  sharing: p.sharing,
  track_count: p.track_count,
  url: p.permalink_url,
});
const ids = (arr) => (arr || []).map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x));

const ALL_ACCESS = "access=playable%2Cpreview%2Cblocked";

async function getPlaylistFull(id) {
  const p = await sc(`/playlists/${id}?${ALL_ACCESS}`);
  const tracks = p.tracks || [];
  return { p, tracks, hidden: Math.max(0, (p.track_count ?? tracks.length) - tracks.length) };
}

// Seguridad: la API puede ocultar pistas al leer una playlist (p. ej. ciertas pistas de sellos).
// Como escribir una playlist REEMPLAZA su lista completa, si faltan pistas no se escribe nada.
async function playlistTrackIds(id) {
  const { p, tracks, hidden } = await getPlaylistFull(id);
  if (hidden > 0) {
    throw new Error(
      `SoundCloud oculta ${hidden} de las ${p.track_count} pistas de esta playlist al leerla. ` +
        `Reescribirla las borraría, así que no he cambiado nada. Añade esas pistas desde la web/app de SoundCloud ` +
        `o crea una playlist nueva con create_playlist.`
    );
  }
  return { p, ids: tracks.map((t) => String(t.id)) };
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

async function putTracks(id, list) {
  // Los IDs van como cadenas: SoundCloud rechaza IDs > 2^31 enviados como número.
  return sc(`/playlists/${id}`, { method: "PUT", body: { playlist: { tracks: list.map((x) => ({ id: x })) } } });
}

// ---------- Herramientas ----------
const TOOLS = {
  search_tracks: {
    description:
      "Busca pistas en SoundCloud. Devuelve id, título, usuario, sello, año, reproducciones y 'access'. 'access' es la restricción que ve la app registrada, no la cuenta del oyente: playable = la app puede reproducirla entera; preview/blocked = la app no puede, pero con Go+ suelen reproducirse en SoundCloud y se pueden añadir a playlists sin problema. No descartes pistas por ser preview o blocked.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de búsqueda (artista y título)" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Máximo de resultados (por defecto 10)" },
        include_restricted: {
          type: "boolean",
          description: "Incluir pistas preview/blocked además de las reproducibles (por defecto true)",
        },
      },
      required: ["query"],
    },
    run: async ({ query, limit = 10, include_restricted = true }) => {
      const q = new URLSearchParams({ q: query, limit: String(Math.min(50, Math.max(1, limit))), linked_partitioning: "true" });
      if (include_restricted) q.set("access", "playable,preview,blocked");
      let body;
      try {
        body = await sc(`/tracks?${q}`);
      } catch (e) {
        if (!include_restricted) throw e;
        q.delete("access");
        body = await sc(`/tracks?${q}`);
      }
      return { tracks: coll(body).map(slimTrack) };
    },
  },
  get_track: {
    description: "Datos de una pista por id o por URL de soundcloud.com.",
    inputSchema: {
      type: "object",
      properties: { track_id: { type: "string" }, url: { type: "string" } },
    },
    run: async ({ track_id, url }) => {
      if (url) return slimTrack(await sc(`/resolve?${new URLSearchParams({ url })}`));
      if (!/^\d+$/.test(String(track_id || ""))) throw new Error("Indica track_id numérico o url.");
      return slimTrack(await sc(`/tracks/${track_id}`));
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
      };
    },
  },
  get_my_playlists: {
    description: "Lista tus playlists (sin las pistas).",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const out = [];
      let next = `/me/playlists?limit=50&linked_partitioning=true`;
      for (let i = 0; next && i < 20; i++) {
        const b = await sc(next);
        out.push(...coll(b).map(slimPlaylist));
        next = b?.next_href || null;
      }
      return { playlists: out };
    },
  },
  get_playlist: {
    description: "Una playlist con sus pistas.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "string" } }, required: ["playlist_id"] },
    run: async ({ playlist_id }) => {
      const { p, tracks, hidden } = await getPlaylistFull(playlistId(playlist_id));
      return {
        ...slimPlaylist(p),
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
        const after = (p?.tracks || []).map((t) => String(t.id));
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
        const after = (p?.tracks || []).map((t) => String(t.id));
        return {
          replaced: after.includes(newId) && !after.includes(oldId),
          position: pos + 1,
          ...(after.includes(newId) ? {} : { not_accepted: [newId] }),
          total: after.length,
        };
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
    const after = (p?.tracks || []).map((t) => String(t.id));
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
          serverInfo: { name: "soundcrate", version: "1.1.0" },
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
