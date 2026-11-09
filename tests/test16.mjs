// Lote S3 (ronda 3) · coerción: una lista vacía o solo de nulos no vacía un campo de texto en silencio, y una lista de
// ids que queda vacía tras descartar nulos da un error claro sin tocar la red. Sin red ni Llavero: API simulada en memoria.
// Cada caso se ejecuta aunque otro falle; al final se listan los que fallan y el código de salida es ≠0.
import assert from "node:assert/strict";
const S = await import("../server.mjs");

let log;
const tk = (id) => ({ id: Number(id), title: "t" + id, user: { username: "u" }, access: "playable" });
S._setDeps({
  goPlus: false,
  restoreRetryMs: 1,
  secretGet: () => "rt",
  secretSet: () => {},
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
  return { err: !!r.isError, text: r.content[0].text, n: (m) => log.filter((l) => l.m === m).length, total: log.length, log };
};
const fails = [];
const tcase = async (name, fn) => {
  try {
    await fn();
    console.log("ok    " + name);
  } catch (e) {
    fails.push(name);
    console.log("FAIL  " + name + "\n      " + String(e.message).split("\n")[0]);
  }
};
const noNet = (r, what) => assert.equal(r.total, 0, what + ": ninguna petición, hubo " + r.total);

await tcase("update_playlist tags:[] o [null] no vacía las etiquetas: sin otros cambios da «Nothing to change», sin peticiones", async () => {
  for (const tags of [[], [null], [null, null]]) {
    const r = await call("update_playlist", { playlist_id: "10", tags });
    assert.equal(r.err, true, JSON.stringify(tags));
    assert.match(r.text, /Nothing to change/);
    noNet(r, JSON.stringify(tags));
  }
});

await tcase("update_playlist description:[] con un título válido cambia solo el título (no envía description)", async () => {
  for (const description of [[], [null]]) {
    const r = await call("update_playlist", { playlist_id: "10", title: "Nuevo", description, tags: [] });
    assert.equal(r.err, false, r.text);
    const puts = r.log.filter((l) => l.m === "PUT");
    assert.equal(puts.length, 1);
    assert.equal(puts[0].body.title, "Nuevo");
    assert.equal("description" in puts[0].body, false, "description no se envía");
    assert.equal("tag_list" in puts[0].body, false, "tag_list no se envía");
  }
});

await tcase("un texto vacío explícito sigue vaciando la descripción", async () => {
  const r = await call("update_playlist", { playlist_id: "10", description: "" });
  assert.equal(r.err, false, r.text);
  assert.equal(r.log.find((l) => l.m === "PUT").body.description, "");
});

await tcase("create_playlist description:[] no envía description", async () => {
  const r = await call("create_playlist", { title: "n", description: [] });
  assert.equal(r.err, false, r.text);
  assert.equal("description" in r.log[0].body, false);
});

await tcase("un campo de texto obligatorio con lista vacía se trata como ausente", async () => {
  const r = await call("create_playlist", { title: [] });
  assert.equal(r.err, true);
  assert.match(r.text, /Missing required argument "title"/);
  noNet(r, "title:[]");
});

await tcase("create_playlist track_ids:[null,null] da error claro y no crea nada (0 POST)", async () => {
  const r = await call("create_playlist", { title: "n", track_ids: [null, null] });
  assert.equal(r.err, true);
  assert.match(r.text, /track_ids.*only has empty/);
  assert.match(r.text, /Nothing was done/);
  noNet(r, "create");
});

await tcase("create_playlist sin track_ids o con track_ids:[] sigue creando una playlist vacía", async () => {
  for (const args of [{ title: "n" }, { title: "n", track_ids: [] }]) {
    const r = await call("create_playlist", args);
    assert.equal(r.err, false, r.text);
    assert.equal(r.n("POST"), 1);
  }
});

await tcase("add_tracks_to_playlist con [null], [null,null] o [] da error claro sin ninguna petición (0 GET/0 PUT)", async () => {
  for (const track_ids of [[null], [null, null], []]) {
    const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids });
    assert.equal(r.err, true, JSON.stringify(track_ids));
    assert.match(r.text, /track_ids/);
    noNet(r, "add " + JSON.stringify(track_ids));
  }
});

await tcase("remove_tracks_from_playlist con [null] o [] da error claro sin ninguna petición", async () => {
  for (const track_ids of [[null], [null, null], []]) {
    const r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids });
    assert.equal(r.err, true, JSON.stringify(track_ids));
    noNet(r, "remove " + JSON.stringify(track_ids));
  }
});

await tcase("update_playlist track_order:[null] da error claro sin ninguna petición", async () => {
  const r = await call("update_playlist", { playlist_id: "10", track_order: [null] });
  assert.equal(r.err, true);
  assert.match(r.text, /track_order.*only has empty/);
  noNet(r, "track_order");
});

await tcase("los nulos mezclados con ids siguen descartándose (add [null,\"4\"] escribe)", async () => {
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: [null, "4"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(r.log.find((l) => l.m === "PUT").body.tracks.map((t) => t.id), ["1", "2", "3", "4"]);
});

await tcase("filtros de lista (genres, tags) con [null] o [] equivalen a omitirlos: sin «Invalid arguments»", async () => {
  for (const [tool, extra] of [["search_tracks", { query: "x" }], ["suggest_tracks", { seed_track_ids: ["1"] }]]) {
    for (const f of tool === "search_tracks" ? ["genres", "tags"] : ["genres"]) {
      for (const v of [[null], [null, null], []]) {
        const r = await call(tool, { ...extra, [f]: v });
        assert.doesNotMatch(r.text, /Invalid arguments|empty entries/, `${tool} ${f}:${JSON.stringify(v)} -> ${r.text.slice(0, 120)}`);
        assert.equal(r.err, false, `${tool} ${f}: ${r.text.slice(0, 120)}`);
      }
    }
  }
});

await tcase("campos de ids: [null] sigue dando error; seed_track_ids:[null] también", async () => {
  for (const [tool, args] of [
    ["create_playlist", { title: "n", track_ids: [null] }],
    ["add_tracks_to_playlist", { playlist_id: "10", track_ids: [null] }],
    ["suggest_tracks", { seed_track_ids: [null] }],
  ]) {
    const r = await call(tool, args);
    assert.equal(r.err, true, tool);
    noNet(r, tool);
  }
});

await tcase("create_playlist con track_ids solo en blanco ([\"\"], [\"\", \" \"], [null,\"\"]) da error claro y no crea nada; track_ids:\"\" cuenta como omitido", async () => {
  for (const track_ids of [[""], ["", " "], [null, ""]]) {
    const r = await call("create_playlist", { title: "n", track_ids });
    assert.equal(r.err, true, JSON.stringify(track_ids));
    assert.match(r.text, /track_ids.*only has empty/);
    noNet(r, "create " + JSON.stringify(track_ids));
  }
  const r = await call("create_playlist", { title: "n", track_ids: "" });
  assert.equal(r.err, false, r.text);
  assert.equal(r.n("POST"), 1);
});

if (fails.length) {
  console.log("\nFALLAN " + fails.length + " caso(s):\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("test16 OK");
