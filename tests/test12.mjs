// Lote C · integridad de playlists: restauración, duplicados, PUT que filtra pistas blocked, escrituras
// concurrentes, entradas de ids y guardas. Sin red ni Llavero: la API es un servidor simulado en memoria.
// Cada caso se ejecuta aunque otro falle; al final se listan los que fallan y el código de salida es ≠0.
import assert from "node:assert/strict";
const S = await import("../server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- API simulada -----
let list, blocked, hiddenN, putPlan, respectAccessOnPut, afterGet, puts, putUrls, gets, posts, inFlight, maxInFlight, trackGets;
const reset = (initial = [1, 2, 3], o = {}) => {
  list = initial.map(String);
  blocked = new Set((o.blocked || []).map(String));
  hiddenN = o.hidden || 0;
  putPlan = [];
  respectAccessOnPut = true;
  afterGet = null;
  puts = [];
  putUrls = [];
  gets = 0;
  posts = [];
  inFlight = 0;
  maxInFlight = 0;
  trackGets = [];
};
const tk = (id) => ({ id: Number(id), title: "t" + id, access: blocked.has(String(id)) ? "blocked" : "playable", user: { username: "u" } });
const view = (withBlocked) => {
  let shown = list.filter((x) => withBlocked || !blocked.has(x));
  if (hiddenN) shown = shown.slice(0, shown.length - hiddenN);
  return { id: 10, title: "pl", sharing: "private", permalink_url: "https://soundcloud.com/x/sets/10", track_count: list.length, tracks: shown.map(tk) };
};
const enter = async (ms) => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await sleep(ms);
  inFlight--;
};
S._setDeps({
  restoreRetryMs: 5,
  secretGet: () => "rt",
  secretSet: () => {},
  credentials: () => ({ clientId: "c", clientSecret: "s" }),
  tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
  fetch: async (url, o) => {
    const u = new URL(url);
    const withBlocked = (u.searchParams.get("access") || "").includes("blocked");
    let m;
    if (u.pathname === "/playlists" && o.method === "POST") {
      const b = JSON.parse(o.body).playlist;
      posts.push(b);
      return Response.json({ id: 77, title: b.title, sharing: b.sharing, track_count: b.tracks.length, tracks: b.tracks, permalink_url: "u" });
    }
    if ((m = u.pathname.match(/^\/tracks\/(\d+)$/))) {
      trackGets.push(m[1]);
      return Response.json(tk(m[1]));
    }
    if (!/^\/playlists\/10$/.test(u.pathname)) return new Response("nf " + u.pathname, { status: 404 });
    if (o.method === "GET") {
      gets++;
      await enter(8);
      const v = view(withBlocked);
      if (afterGet) afterGet();
      return Response.json(v);
    }
    if (o.method === "PUT") {
      const b = JSON.parse(o.body).playlist;
      const plan = putPlan.shift() || {};
      puts.push({ ids: b.tracks.map((t) => String(t.id)), fields: { ...b, tracks: undefined } });
      putUrls.push(u);
      await enter(4);
      if (plan.status) return new Response("err", { status: plan.status });
      let next = b.tracks.map((t) => String(t.id));
      if (plan.drop) next = next.filter((x) => !plan.drop.includes(x));
      list = next;
      return Response.json(view(respectAccessOnPut && withBlocked));
    }
    return new Response("nf", { status: 404 });
  },
});
const call = async (name, args) => {
  const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
  return { err: !!r.isError, text: r.content[0].text, out: r.isError ? null : JSON.parse(r.content[0].text) };
};
const L = () => list.map(Number);

// ----- Casos -----
const fails = [];
const tcase = async (name, fn) => {
  try {
    await fn();
    console.log("ok   ", name);
  } catch (e) {
    fails.push(name);
    console.log("FALLA", name, "→", String(e.message).split("\n")[0].slice(0, 200));
  }
};

// #2
await tcase("#2 replace: SoundCloud no acepta la nueva → se restaura la lista y se avisa", async () => {
  reset([1, 2, 3]);
  putPlan = [{ drop: ["7"] }];
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "7" });
  assert.equal(r.err, true);
  assert.match(r.text, /did not accept track 7/);
  assert.match(r.text, /restored/);
  assert.deepEqual(L(), [1, 2, 3], "la pista original sigue en la playlist");
});
await tcase("#2/#16 replace: si además falla la restauración, el error da la lista original", async () => {
  reset([1, 2, 3]);
  putPlan = [{ drop: ["7"] }, { status: 429 }, { status: 503 }];
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "7" });
  assert.equal(r.err, true);
  assert.match(r.text, /FAILED/);
  assert.match(r.text, /1,2,3/, "incluye los ids originales en orden");
  assert.match(r.text, /Missing now: 2/);
});
await tcase("#2 add: si la respuesta pierde pistas que ya estaban, se restaura", async () => {
  reset([1, 2, 3]);
  putPlan = [{ drop: ["2"] }];
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9"] });
  assert.equal(r.err, true);
  assert.match(r.text, /restored/);
  assert.deepEqual(L(), [1, 2, 3]);
});
await tcase("#2 add: una pista nueva no aceptada solo se informa (sin error ni restauración)", async () => {
  reset([1, 2, 3]);
  putPlan = [{ drop: ["9"] }];
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["9", "8"] });
  assert.equal(r.err, false);
  assert.deepEqual(r.out, { added: 1, not_accepted: ["9"], total: 4 });
  assert.equal(puts.length, 1);
});
await tcase("#2 remove: si SoundCloud pierde una pista que debía quedarse, se restaura", async () => {
  reset([1, 2, 3, 4]);
  putPlan = [{ drop: ["3"] }];
  const r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["1"] });
  assert.equal(r.err, true);
  assert.match(r.text, /restored/);
  assert.deepEqual(L(), [1, 2, 3, 4]);
});

// #3
await tcase("#3 quitar una pista repetida sin position ni all_copies no escribe y dice dónde está", async () => {
  reset([1, 7, 2, 3, 7]);
  for (const [tool, args] of [
    ["remove_track_from_playlist", { playlist_id: "10", track_id: "7" }],
    ["remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["7"] }],
  ]) {
    const r = await call(tool, args);
    assert.equal(r.err, true, tool);
    assert.match(r.text, /positions 2, 5/);
    assert.equal(puts.length, 0);
    assert.deepEqual(L(), [1, 7, 2, 3, 7]);
  }
});
await tcase("#3 position quita solo esa copia y removed cuenta entradas", async () => {
  reset([1, 7, 2, 3, 7]);
  const r = await call("remove_track_from_playlist", { playlist_id: "10", track_id: "7", position: 5 });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 7, 2, 3]);
  assert.equal(r.out.removed, 1);
  assert.equal(r.out.total, 4);
  const bad = await call("remove_track_from_playlist", { playlist_id: "10", track_id: "7", position: 3 });
  assert.equal(bad.err, true);
  assert.match(bad.text, /Position 3 holds track 2/);
});
await tcase("#3 all_copies:true quita todas y removed cuenta entradas (no ids)", async () => {
  reset([1, 7, 2, 3, 7]);
  const r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["7"], all_copies: true });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3]);
  assert.equal(r.out.removed, 2);
});
await tcase("#3 create_playlist no crea duplicados", async () => {
  reset();
  await call("create_playlist", { title: "x", track_ids: ["1", "2", "1", "soundcloud:tracks:2"] });
  assert.deepEqual(posts[0].tracks, [{ id: "1" }, { id: "2" }]);
});

// #4 / T9
await tcase("T9/#4 PUT sin access en la respuesta (la API ignora el parámetro): update_playlist no da falso error", async () => {
  reset([1, 13, 2], { blocked: [13] });
  respectAccessOnPut = false;
  const r = await call("update_playlist", { playlist_id: "10", title: "Nuevo" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 13, 2]);
  assert.equal(puts.length, 1, "una sola escritura, sin restauración");
  assert.equal(puts[0].fields.title, "Nuevo");
  assert.equal(r.out.total, 3);
});
await tcase("T9/#4 update_playlist con sort_by y track_order sobre una playlist con blocked", async () => {
  reset([3, 13, 1], { blocked: [13] });
  respectAccessOnPut = false;
  let r = await call("update_playlist", { playlist_id: "10", track_order: ["1", "13", "3"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 13, 3]);
  assert.equal(puts.length, 1);
  r = await call("update_playlist", { playlist_id: "10", sort_by: "duration", direction: "desc" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 13, 3], "sin datos de duración el orden no cambia y no se pierde nada");
});
await tcase("T9/#4 add con una pista blocked: no dice not_accepted", async () => {
  reset([1, 2], { blocked: [13] });
  respectAccessOnPut = false;
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["13"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(r.out, { added: 1, not_accepted: [], total: 3 });
  assert.deepEqual(L(), [1, 2, 13]);
});
await tcase("T9/#4 replace por una pista blocked: replaced:true", async () => {
  reset([1, 2, 3], { blocked: [13] });
  respectAccessOnPut = false;
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "13" });
  assert.equal(r.err, false, r.text);
  assert.equal(r.out.replaced, true);
  assert.deepEqual(L(), [1, 13, 3]);
});
await tcase("T9/#4 remove en una playlist con blocked: sin falso error ni not_removed", async () => {
  reset([1, 13, 2], { blocked: [13] });
  respectAccessOnPut = false;
  const r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["2"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(r.out, { removed: 1, total: 2 });
  assert.deepEqual(L(), [1, 13]);
});
await tcase("#4 el PUT pide access=playable,preview,blocked", async () => {
  reset([1, 13, 2], { blocked: [13] });
  const r = await call("update_playlist", { playlist_id: "10", title: "Nuevo" });
  assert.equal(r.err, false, r.text);
  const acc = putUrls[0].searchParams.get("access") || "";
  assert.ok(acc.includes("blocked") && acc.includes("playable") && acc.includes("preview"), "access=" + acc);
});

// #13 (lectura única: una sola lectura fresca dentro del cerrojo; no hay escritura condicional en SoundCloud)
await tcase("#13 la escritura parte de una lectura fresca: una edición externa anterior se conserva (1 GET + 1 PUT)", async () => {
  reset([1, 2, 3, 4]);
  list = [...list, "99"]; // otra sesión o la web añadió la 99 antes de que empiece la llamada
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["5"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3, 4, 99, 5], "la 99 externa se conserva");
  assert.equal(gets, 1, "una sola lectura");
  assert.equal(puts.length, 1);
});
await tcase("#13 limitación conocida: una edición externa entre la lectura y el PUT se pisa (no hay escritura condicional)", async () => {
  reset([1, 2, 3, 4]);
  let fired = false;
  afterGet = () => {
    if (!fired) {
      fired = true;
      list = [...list, "99"]; // llega después de nuestra lectura
    }
  };
  const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["5"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3, 4, 5], "documentado: la 99 se pierde; el cerrojo solo ordena las llamadas de este proceso");
  assert.equal(puts.length, 1, "sin reintentos ni bucles");
});

// #14
await tcase("#14 track_order con una pista ajena se rechaza (playlist con repetidos)", async () => {
  reset([1, 7, 2, 7]);
  const r = await call("update_playlist", { playlist_id: "10", track_order: ["2", "1", "7", "9"] });
  assert.equal(r.err, true);
  assert.equal(puts.length, 0);
  assert.deepEqual(L(), [1, 7, 2, 7]);
});
await tcase("#14 track_order que pierde una copia repetida se rechaza", async () => {
  reset([1, 7, 2, 7]);
  const r = await call("update_playlist", { playlist_id: "10", track_order: ["2", "1", "7"] });
  assert.equal(r.err, true);
  assert.equal(puts.length, 0);
});
await tcase("#14 track_order con las mismas repeticiones se acepta", async () => {
  reset([1, 7, 2, 7]);
  const r = await call("update_playlist", { playlist_id: "10", track_order: ["7", "7", "1", "2"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [7, 7, 1, 2]);
  assert.equal(r.out.reordered, true);
});

// #15
await tcase("#15 replace de una pista repetida informa de las copias que quita", async () => {
  reset([1, 7, 2, 7, 3]);
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "7", new_track_id: "8" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 8, 2, 3]);
  assert.deepEqual(r.out.removed_elsewhere, [{ id: "7", position: 4 }]);
  assert.equal(r.out.total_before, 5);
  assert.equal(r.out.total, 4);
  assert.equal(r.out.replaced, true);
});
await tcase("#15 replace cuando la nueva ya estaba en otra posición también lo informa", async () => {
  reset([1, 2, 3, 8]);
  const r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "2", new_track_id: "8" });
  assert.deepEqual(L(), [1, 8, 3]);
  assert.deepEqual(r.out.removed_elsewhere, [{ id: "8", position: 4 }]);
});

// #16
await tcase("#16 update_playlist: si falla la restauración, el error da la lista original y no un 429 mudo", async () => {
  reset([1, 2, 3, 4]);
  putPlan = [{ drop: ["4"] }, { status: 429 }, { status: 429 }];
  const r = await call("update_playlist", { playlist_id: "10", title: "Nuevo", track_order: ["4", "3", "2", "1"] });
  assert.equal(r.err, true);
  assert.match(r.text, /FAILED/);
  assert.match(r.text, /1,2,3,4/);
  assert.match(r.text, /Missing now: 4/);
  assert.match(r.text, /title were applied and not reverted/);
  assert.doesNotMatch(r.text, /^SoundCloud rate limit reached; wait a moment and retry\.$/);
});
await tcase("#16 update_playlist: restauración correcta (con un reintento tras 429) y mensaje claro", async () => {
  reset([1, 2, 3, 4]);
  putPlan = [{ drop: ["4"] }, { status: 429 }];
  const r = await call("update_playlist", { playlist_id: "10", track_order: ["4", "3", "2", "1"] });
  assert.equal(r.err, true);
  assert.match(r.text, /previous track list was restored/);
  assert.deepEqual(L(), [1, 2, 3, 4]);
});

// #25
await tcase("#25 track_ids como texto o id suelto en add/create/remove", async () => {
  reset([1, 2]);
  let r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: "3,4" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3, 4]);
  r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: "5" });
  assert.equal(r.err, false, r.text);
  r = await call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: "5" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3, 4]);
  r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: '["6","7"]' });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3, 4, 6, 7]);
  r = await call("create_playlist", { title: "n", track_ids: "1,2" });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(posts[0].tracks, [{ id: "1" }, { id: "2" }]);
});
await tcase("#25 track_ids sin ningún id válido: error claro, nada se escribe", async () => {
  reset([1, 2]);
  let r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: "abc" });
  assert.equal(r.err, true);
  assert.match(r.text, /track_ids must be an array of numeric track ids/);
  assert.doesNotMatch(r.text, /is not a function/);
  r = await call("create_playlist", { title: "n", track_ids: ["x", "y"] });
  assert.equal(r.err, true);
  assert.match(r.text, /track_ids must be an array of numeric track ids/);
  assert.equal(posts.length, 0);
  assert.equal(puts.length, 0);
});

// #30
await tcase("#30 una URN de usuario o playlist no se toma como pista", async () => {
  reset([1, 2]);
  for (const bad of ["soundcloud:users:7", "soundcloud:playlists:5"]) {
    const r = await call("add_tracks_to_playlist", { playlist_id: "10", track_ids: [bad] });
    assert.equal(r.err, true, bad);
    assert.match(r.text, /URN, not a track/);
  }
  let r = await call("add_tracks_to_playlist", { playlist_id: "soundcloud:users:99", track_ids: ["3"] });
  assert.equal(r.err, true);
  assert.match(r.text, /user URN, not a playlist/);
  r = await call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "soundcloud:users:1", new_track_id: "3" });
  assert.equal(r.err, true);
  r = await call("create_playlist", { title: "n", track_ids: ["soundcloud:users:7"] });
  assert.equal(r.err, true);
  assert.equal(puts.length + posts.length, 0);
  assert.deepEqual(L(), [1, 2]);
  // las URN del tipo correcto siguen valiendo
  r = await call("add_tracks_to_playlist", { playlist_id: "soundcloud:playlists:10", track_ids: ["soundcloud:tracks:3"] });
  assert.equal(r.err, false, r.text);
  assert.deepEqual(L(), [1, 2, 3]);
});
await tcase("#30 get_track con la URN de un usuario falla sin llamar a la API", async () => {
  reset([1]);
  const r = await call("get_track", { track_id: "soundcloud:users:42" });
  assert.equal(r.err, true);
  assert.match(r.text, /user URN, not a track/);
  assert.deepEqual(trackGets, []);
});

// #11: guarda de pistas ocultas en remove y replace (y el resto de escrituras)
await tcase("#11 con pistas ocultas ninguna escritura sobre la playlist escribe", async () => {
  const cases = [
    ["remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["1"] }],
    ["remove_track_from_playlist", { playlist_id: "10", track_id: "1" }],
    ["replace_track_in_playlist", { playlist_id: "10", old_track_id: "1", new_track_id: "7" }],
    ["add_tracks_to_playlist", { playlist_id: "10", track_ids: ["7"] }],
    ["update_playlist", { playlist_id: "10", sort_by: "duration" }],
    ["update_playlist", { playlist_id: "10", track_order: ["3", "2", "1"] }],
    ["update_playlist", { playlist_id: "10", title: "otro" }],
  ];
  for (const [tool, args] of cases) {
    reset([1, 2, 3], { hidden: 1 });
    const r = await call(tool, args);
    assert.equal(r.err, true, tool);
    assert.equal(puts.length, 0, tool + " no escribe");
    assert.match(r.text, /hides 1 of the 3/, tool);
    assert.deepEqual(L(), [1, 2, 3], tool);
  }
});

// T5: el cerrojo usa el id normalizado, no el valor recibido
await tcase("T5 el cerrojo serializa la misma playlist dada como id y como URN", async () => {
  reset([1, 2, 3, 4, 5, 6]);
  const rs = await Promise.all([
    call("add_tracks_to_playlist", { playlist_id: "10", track_ids: ["7"] }),
    call("add_tracks_to_playlist", { playlist_id: "soundcloud:playlists:10", track_ids: ["8"] }),
    call("remove_tracks_from_playlist", { playlist_id: "soundcloud:playlists:10", track_ids: ["1"] }),
    call("remove_tracks_from_playlist", { playlist_id: "10", track_ids: ["9"] }),
    call("replace_track_in_playlist", { playlist_id: "soundcloud:playlists:10", old_track_id: "2", new_track_id: "20" }),
    call("replace_track_in_playlist", { playlist_id: "10", old_track_id: "3", new_track_id: "30" }),
    call("update_playlist", { playlist_id: "soundcloud:playlists:10", title: "T" }),
    call("update_playlist", { playlist_id: "10", title: "T2" }),
  ]);
  for (const r of rs) assert.equal(r.err, false, r.text);
  assert.equal(maxInFlight, 1, "nunca dos peticiones a la vez sobre la misma playlist");
  assert.deepEqual([...L()].sort((a, b) => a - b), [4, 5, 6, 7, 8, 20, 30], "no se pierde ningún cambio");
});

if (fails.length) {
  console.log("\nFALLAN " + fails.length + " caso(s):\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("OK");
