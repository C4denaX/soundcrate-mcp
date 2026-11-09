// Lote S (ronda 2) · server.mjs: orden Camelot sin regresión (#10), coste en peticiones por escritura y confirmWrite,
// texto de caducidad (#21), coerción de listas en campos de texto (#5), position + all_copies (#3) e ids ignorados (#25).
// Sin red ni Llavero: la API es un servidor simulado en memoria. Cada caso se ejecuta aunque otro falle; al final se
// listan los que fallan y el código de salida es ≠0.
import assert from "node:assert/strict";

let nInst = 0;
const J = (o, init) => Response.json(o, init);

// ----- API simulada de una playlist (id 10) -----
// st.list: ids actuales; st.keys: id → key_signature; st.putPlan: [{drop:[ids]}...]; st.getFail: status para los GET
// st.puts/st.gets: contadores; st.lastPutBody: cuerpo del último PUT.
async function boot(initial = [1, 2, 3], keys = {}) {
  const S = await import(`../server.mjs?r2-s-${++nInst}`);
  const st = { list: initial.map(String), keys, putPlan: [], puts: 0, gets: 0, posts: [], putBodies: [], failGetsFrom: null };
  const view = () => ({
    id: 10,
    title: "pl",
    sharing: "private",
    permalink_url: "u",
    track_count: st.list.length,
    tracks: st.list.map((i) => ({ id: Number(i), title: "t" + i, user: { username: "u" }, access: "playable", duration: 1000, key_signature: st.keys[i] })),
  });
  S._setDeps({
    goPlus: false,
    restoreRetryMs: 1,
    secretGet: () => "rt",
    secretSet: () => {},
    credentials: () => ({ clientId: "c", clientSecret: "s" }),
    tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
    fetch: async (url, o) => {
      const u = new URL(url);
      if (u.pathname === "/playlists" && o.method === "POST") {
        const b = JSON.parse(o.body).playlist;
        st.posts.push(b);
        return J({ id: 77, title: b.title, sharing: b.sharing, track_count: b.tracks.length, tracks: b.tracks, permalink_url: "u" });
      }
      if (u.pathname !== "/playlists/10") return new Response("nf", { status: 404 });
      if (o.method === "PUT") {
        st.puts++;
        const b = JSON.parse(o.body).playlist;
        st.putBodies.push(b);
        const plan = st.putPlan.shift() || {};
        let next = b.tracks.map((t) => String(t.id));
        if (plan.drop) next = next.filter((x) => !plan.drop.includes(x));
        st.list = next;
        return J(view());
      }
      st.gets++;
      if (st.failGetsFrom != null && st.gets >= st.failGetsFrom) return new Response("slow down", { status: 429, headers: { "x-ratelimit-remaining": "0" } });
      return J(view());
    },
  });
  let nid = 100;
  const call = async (name, args = {}) => {
    const r = (await S.handle({ jsonrpc: "2.0", id: ++nid, method: "tools/call", params: { name, arguments: args } })).result;
    const text = r.content[0].text;
    return r.isError ? { err: true, text } : { err: false, text, out: JSON.parse(text) };
  };
  return { S, st, call };
}

// ----- Camelot -----
const KEY = {
  A: { 1: "Ab", 2: "Eb", 3: "Bb", 4: "F", 5: "C", 6: "G", 7: "D", 8: "A", 9: "E", 10: "B", 11: "Gb", 12: "Db" },
  B: { 1: "B", 2: "Gb", 3: "Db", 4: "Ab", 5: "Eb", 6: "Bb", 7: "F", 8: "C", 9: "G", 10: "D", 11: "A", 12: "E" },
};
const keySig = (c) => `${KEY[c.slice(-1)][c.slice(0, -1)]}:${c.endsWith("A") ? "min" : "maj"}`;
// Choques con un contador propio (mismo criterio que analyze_playlist: mismo número, o misma letra y número contiguo, 12↔1 incluido).
const parse = (c) => ({ n: parseInt(c, 10), l: c.slice(-1) });
const clash = (a, b) => {
  const x = parse(a), y = parse(b);
  if (x.n === y.n) return false;
  const d = Math.abs(x.n - y.n);
  return !(x.l === y.l && (d === 1 || d === 11));
};
const clashes = (order) => order.slice(1).filter((c, i) => clash(order[i], c)).length;
async function sortCamelot(set, direction) {
  const { st, call } = await boot(set.map((_, i) => i + 1), Object.fromEntries(set.map((c, i) => [String(i + 1), keySig(c)])));
  const r = await call("update_playlist", { playlist_id: "10", sort_by: "camelot", ...(direction ? { direction } : {}) });
  assert.equal(r.err, false, r.text);
  return st.list.map((i) => set[+i - 1]);
}
// Orden fijo de la 1.7.0: 1A 1B 2A 2B… (asc) o 12B 12A 11B 11A… (desc); sin clave al final.
const order170 = (set, dir) => {
  const k = (c) => parse(c).n * 2 + (parse(c).l === "B" ? 1 : 0);
  return [...set].sort((a, b) => (dir === "desc" ? k(b) - k(a) : k(a) - k(b)));
};

const cases = [];
const tcase = (name, fn) => cases.push([name, fn]);

for (const set of [["8A", "8B", "9B"], ["7A", "8A", "8B", "9B"], ["8A", "9A", "10A", "10B", "9B", "8B"]]) {
  tcase(`#10 regresión Camelot: «${set.join(" ")}» da 0 choques en asc y en desc`, async () => {
    for (const direction of ["asc", "desc"]) {
      const shuffled = [...set].reverse();
      const out = await sortCamelot(shuffled, direction);
      assert.equal(clashes(out), 0, `${direction}: ${out.join(" ")}`);
      assert.equal(out.length, set.length);
    }
  });
}
tcase("#10 la rueda completa (24 claves) da 0 choques en asc y desc, y 'update_playlist' lo confirma con analyze_playlist", async () => {
  const all = [];
  for (let k = 1; k <= 12; k++) all.push(k + "A", k + "B");
  const shuffled = [...all].sort((a, b) => ((a.length * 7 + a.charCodeAt(0) * 13) % 11) - ((b.length * 7 + b.charCodeAt(0) * 13) % 11));
  for (const direction of ["asc", "desc"]) {
    const out = await sortCamelot(shuffled, direction);
    assert.equal(out.length, 24);
    assert.equal(clashes(out), 0, `${direction}: ${out.join(" ")}`);
  }
  const { st, call } = await boot(shuffled.map((_, i) => i + 1), Object.fromEntries(shuffled.map((c, i) => [String(i + 1), keySig(c)])));
  await call("update_playlist", { playlist_id: "10", sort_by: "camelot" });
  const a = await call("analyze_playlist", { playlist_id: "10" });
  assert.equal(a.out.harmonic_clashes.total, 0);
  assert.equal(st.list.length, 24);
});
tcase("#10 aleatorio (2 000 conjuntos, semilla fija): nunca más choques que el orden fijo de la 1.7.0", async () => {
  let seed = 20260101;
  const rnd = () => ((seed = (seed + 0x6d2b79f5) | 0), (((Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x1234567) >>> 0) % 1e6) / 1e6);
  const keys24 = [];
  for (let k = 1; k <= 12; k++) keys24.push(k + "A", k + "B");
  let worse = 0, better = 0, equal = 0;
  const { st, call } = await boot([1], {});
  for (let it = 0; it < 2000; it++) {
    const size = 2 + Math.floor(rnd() * 9);
    // Conjuntos con pocos números (para forzar números con una sola letra y huecos) y también dispersos.
    const span = it % 2 ? 4 : 12;
    const base = 1 + Math.floor(rnd() * (13 - span));
    const set = Array.from({ length: size }, () => (base + Math.floor(rnd() * span)) + (rnd() < 0.5 ? "A" : "B"));
    const dir = it % 3 === 0 ? "desc" : "asc";
    st.list = set.map((_, i) => String(i + 1));
    st.keys = Object.fromEntries(set.map((c, i) => [String(i + 1), keySig(c)]));
    const r = await call("update_playlist", { playlist_id: "10", sort_by: "camelot", direction: dir });
    assert.equal(r.err, false, r.text);
    const out = st.list.map((i) => set[+i - 1]);
    assert.deepEqual([...out].sort(), [...set].sort(), "no se pierde ni se inventa ninguna pista");
    const a = clashes(out), b = clashes(order170(set, dir));
    if (a > b) worse++;
    else if (a < b) better++;
    else equal++;
  }
  console.log(`      (aleatorio: peor ${worse}, mejor ${better}, igual ${equal})`);
  assert.equal(worse, 0, `peor que 1.7.0 en ${worse} conjuntos (mejor en ${better}, igual en ${equal})`);
  assert.ok(better > 0, "debería mejorar alguno");
});
tcase("#10 las pistas sin clave van al final en su orden original y las del mismo número conservan su orden", async () => {
  const { st, call } = await boot([1, 2, 3, 4, 5], { 1: "A:min", 2: undefined, 3: "A:min", 4: undefined, 5: "C:maj" });
  const r = await call("update_playlist", { playlist_id: "10", sort_by: "camelot" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(st.list, ["5", "1", "3", "2", "4"]); // 8B (C maj) antes que 8A; 1 y 3 son 8A en su orden; sin clave: 2, 4
});

// ----- Peticiones por escritura -----
const counts = async (name, args, initial = [1, 2, 3, 4], keys = {}) => {
  const { st, call } = await boot(initial, keys);
  const r = await call(name, args);
  assert.equal(r.err, false, r.text);
  return { gets: st.gets, puts: st.puts };
};
for (const [label, name, args] of [
  ["add", "add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9"] }],
  ["remove", "remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["2"] }],
  ["replace", "replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "9" }],
  ["update (metadatos)", "update_playlist", { playlist_id: "10", title: "Nuevo" }],
  ["update (sort_by)", "update_playlist", { playlist_id: "10", sort_by: "camelot" }],
]) {
  tcase(`coste: ${label} cuesta 1 GET + 1 PUT cuando la respuesta del PUT cuadra`, async () => {
    const c = await counts(name, args, [1, 2, 3, 4], { 1: "A:min", 2: "C:maj", 3: "A:min", 4: "E:min" });
    assert.deepEqual(c, { gets: 1, puts: 1 });
  });
}
tcase("coste: si la respuesta del PUT no cuadra, se relee una vez (1 GET + 1 PUT + 1 GET)", async () => {
  const { st, call } = await boot([1, 2, 3]);
  st.putPlan = [{ drop: ["9"] }];
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9"] });
  assert.equal(r.err, false, r.text);
  assert.equal(r.out.added, 0);
  assert.deepEqual(r.out.not_accepted, ["9"]);
  assert.deepEqual({ gets: st.gets, puts: st.puts }, { gets: 2, puts: 1 });
});

// ----- confirmWrite: la relectura falla -----
tcase("confirmWrite: si la relectura da 429 no se restaura y el error dice que no se pudo confirmar", async () => {
  const { st, call } = await boot([1, 2, 3]);
  st.putPlan = [{ drop: ["2"] }]; // la respuesta no cuadra con lo esperado → hay que releer
  st.failGetsFrom = 2; // la 1.ª lectura va bien, la relectura da 429
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9"] });
  assert.equal(r.err, true);
  assert.match(r.text, /could not confirm/i);
  assert.match(r.text, /429|rate limit/i, "no enmascara el 429: " + r.text);
  assert.match(r.text, /Nothing was restored/);
  assert.doesNotMatch(r.text, /FAILED|previous track list was restored/);
  assert.equal(st.puts, 1, "no hay un PUT de restauración");
});
tcase("confirmWrite: replace con la relectura caída tampoco restaura", async () => {
  const { st, call } = await boot([1, 2, 3]);
  st.putPlan = [{ drop: ["7"] }];
  st.failGetsFrom = 2;
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "7" });
  assert.equal(r.err, true);
  assert.match(r.text, /could not confirm/i);
  assert.equal(st.puts, 1);
});

// ----- #21 texto del servidor -----
tcase("#21 setup_status usa idle_minutes en el aviso de caducidad (y un texto sin número si no viene)", async () => {
  for (const [res, expect] of [
    [{ ok: false, reason: "timeout", idle_minutes: 45 }, /after 45 minutes without activity/],
    [{ ok: false, reason: "timeout", idle_minutes: 1 }, /after 1 minute without activity/],
    [{ ok: false, reason: "timeout" }, /closed after a while without activity/],
  ]) {
    const S = await import(`../server.mjs?r2-s-${++nInst}`);
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    S._setDeps({
      goPlus: false,
      store: () => ({ label: "S", probe: () => ({ ok: true }) }),
      secretGet: () => null,
      credentials: () => { throw Object.assign(new Error("no creds"), { setup: true }); },
      startSetup: async () => ({ url: "http://127.0.0.1:8976/setup?k=abc", opened: true, already_running: false, store: "S", done }),
    });
    const call = async (name) => JSON.parse((await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } })).result.content[0].text);
    await call("start_setup");
    resolveDone(res);
    await new Promise((r) => setTimeout(r, 5));
    const s = await call("setup_status");
    assert.match(s.setup_page_expired, expect);
    assert.doesNotMatch(s.setup_page_expired, /20 minutes/);
  }
});

// ----- #5 coerción -----
tcase("#5 el «item N» de un error de lista cuenta la posición original aunque haya nulos antes", async () => {
  const { call } = await boot([1, 2]);
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: [null, "5", { a: 1 }] });
  assert.equal(r.err, true);
  assert.match(r.text, /item 3 must be text or a number/);
});
tcase("failAndRestore: si el PUT de restauración no se puede confirmar, «Missing now» no usa la lista obsoleta", async () => {
  const { st, call } = await boot([1, 2, 3]);
  st.putPlan = [{ drop: ["2"] }, { drop: ["2"] }, { drop: ["2"] }]; // la escritura y los dos intentos de restauración pierden la 2
  st.failGetsFrom = 3; // la lectura y la 1.ª relectura van bien (→ failAndRestore); la relectura tras restaurar da 429
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9"] });
  assert.equal(r.err, true);
  assert.match(r.text, /FAILED/, r.text);
  assert.match(r.text, /Missing now: unknown/, r.text);
});
tcase("#5 update_playlist acepta tags como lista (y entrecomilla los que llevan espacios)", async () => {
  const { st, call } = await boot([1, 2]);
  const r = await call("update_playlist", { playlist_id: "10", tags: ["dark", "minimal techno", 7] });
  assert.equal(r.err, false, r.text);
  assert.equal(st.putBodies[0].tag_list, 'dark "minimal techno" 7');
});
tcase("#5 un null dentro de una lista se descarta (track_ids [4,null])", async () => {
  const { st, call } = await boot([1, 2]);
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: [4, null] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(st.list, ["1", "2", "4"]);
});
tcase("#5 una lista de objetos en un campo de texto sigue rechazándose", async () => {
  const { call } = await boot([1, 2]);
  const r = await call("update_playlist", { playlist_id: "10", title: [{ a: 1 }] });
  assert.equal(r.err, true);
  assert.match(r.text, /Invalid arguments/);
});

// ----- #3: position + all_copies -----
tcase("#3 position junto con all_copies se rechaza sin escribir", async () => {
  const { st, call } = await boot([1, 2, 2, 3]);
  const r = await call("remove_track_from_playlist", { playlist_id: "10", track_id: "2", position: 2, all_copies: true });
  assert.equal(r.err, true);
  assert.match(r.text, /position and all_copies cannot be used together/);
  assert.equal(st.puts, 0);
  assert.equal(st.gets, 0);
});

// ----- #25: ids ignorados -----
tcase("#25 create_playlist informa de los ids no válidos y crea con los válidos", async () => {
  const { st, call } = await boot([1]);
  const r = await call("create_playlist", { title: "x", track_ids: ["5", "abc", "6", "soundcloud:tracks:7"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(st.posts[0].tracks.map((t) => t.id), ["5", "6", "7"]);
  assert.deepEqual(r.out.ignored_ids, ["abc"]);
});
tcase("#25 add_tracks_to_playlist informa de los ids no válidos (con y sin pistas nuevas)", async () => {
  const { st, call } = await boot([1, 2]);
  let r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["5", "xyz"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(st.list, ["1", "2", "5"]);
  assert.deepEqual(r.out.ignored_ids, ["xyz"]);
  r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["5", "xyz"] });
  assert.equal(r.out.added, 0);
  assert.deepEqual(r.out.ignored_ids, ["xyz"]);
});
tcase("#25 remove_tracks_from_playlist informa de los ids no válidos", async () => {
  const { st, call } = await boot([1, 2, 3]);
  const r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["2", "q"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(st.list, ["1", "3"]);
  assert.deepEqual(r.out.ignored_ids, ["q"]);
});

// ----- ejecución -----
const failed = [];
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log("ok    " + name);
  } catch (e) {
    failed.push(name);
    console.log("FALLA " + name + "\n      " + String(e?.message || e).split("\n").slice(0, 3).join("\n      "));
  }
}
if (failed.length) {
  console.log("\nFALLAN " + failed.length + " caso(s):\n- " + failed.join("\n- "));
  process.exit(1);
}
console.log("OK");
