// Configuración guiada: la página local (setup.mjs) con peticiones HTTP reales y las herramientas
// setup_status / start_setup. Sin red: SoundCloud, el almacén y el navegador son simulados.
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { startSetup } from "../setup.mjs";
import { SetupError } from "../secrets.mjs";

const freePort = () =>
  new Promise((r) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
// Petición HTTP con control total de cabeceras (Host, Origin…).
const req = (port, { method = "GET", path, headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject);
    if (body) r.end(body);
    else r.end();
  });
const memStore = (ok = true) => {
  const m = new Map();
  return {
    name: "mem",
    label: "Test store",
    m,
    get: (a) => m.get(a) ?? null,
    set: (a, v) => m.set(a, v),
    del: (a) => m.delete(a),
    probe: () => (ok ? { ok: true } : { ok: false, problem: "no keyring", fix: ["install it"] }),
  };
};
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------- 1. Página local ----------
{
  const port = await freePort();
  const store = memStore();
  const credentials = () => {
    if (!store.get("client_id")) throw new SetupError("missing");
    return { clientId: store.get("client_id"), clientSecret: store.get("client_secret") };
  };
  const tokenCalls = [];
  let opened = null, success = null;
  const s = await startSetup({
    store,
    credentials,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    tokenRequest: async (p) => (tokenCalls.push(p), { access_token: "AT", refresh_token: "RT-new", expires_in: 3600 }),
    fetchFn: async () => Response.json({ username: "dj tester" }),
    openFn: async (u) => ((opened = u), true),
    onSuccess: (r) => (success = r),
  });
  assert.equal(s.opened, true); assert.equal(opened, s.url);
  const key = new URL(s.url).searchParams.get("k");
  assert.ok(key.length >= 30, "clave aleatoria larga");

  // Sin clave, con clave errónea o con otro Host: rechazado.
  assert.equal((await req(port, { path: "/setup" })).status, 403);
  assert.equal((await req(port, { path: "/setup?k=nope" })).status, 403);
  assert.equal((await req(port, { path: `/setup?k=${key}`, headers: { host: "evil.example" } })).status, 421, "Host ajeno (DNS rebinding)");
  assert.equal((await req(port, { path: "/otra" })).status, 404);

  // Página inicial: pasos, Redirect URI exacta, formulario y cabeceras de seguridad.
  let r = await req(port, { path: `/setup?k=${key}` });
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`http://127.0.0.1:${port}/callback`));
  assert.match(r.body, /name="client_secret" type="password"/);
  assert.doesNotMatch(r.body, /\/setup\/connect/, "sin credenciales no se ofrece conectar");
  assert.match(r.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match((await req(port, { path: `/setup?k=${key}`, headers: { "accept-language": "es-ES,es;q=0.9" } })).body, /Registra una app en SoundCloud/);

  // Guardar credenciales: Origin ajeno, sin clave o con datos malos no guarda nada.
  const post = (form, headers = {}) =>
    req(port, { method: "POST", path: "/setup/credentials", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString() });
  assert.equal((await post({ k: key, client_id: "abcdefgh123", client_secret: "secret-12345" }, { origin: "https://evil.example" })).status, 403, "CSRF desde otra web");
  assert.equal((await post({ k: "x", client_id: "abcdefgh123", client_secret: "secret-12345" })).status, 403);
  assert.match((await post({ k: key, client_id: "bad id!", client_secret: "secret-12345" })).body, /Client ID does not look right/);
  assert.match((await post({ k: key, client_id: "abcdefgh123", client_secret: "short" })).body, /Client Secret does not look right/);
  assert.equal(store.m.size, 0, "nada guardado todavía");
  r = await post({ k: key, client_id: "abcdefgh123", client_secret: "  s3cret value-12345  " }, { origin: `http://127.0.0.1:${port}` });
  assert.equal(r.status, 303); assert.equal(r.headers.location, `/setup?k=${key}&saved=1`);
  assert.equal(store.get("client_id"), "abcdefgh123"); assert.equal(store.get("client_secret"), "s3cret value-12345", "sin espacios en los extremos");
  r = await req(port, { path: `/setup?k=${key}&saved=1` });
  assert.match(r.body, /Credentials saved/); assert.match(r.body, new RegExp(`/setup/connect\\?k=${key}`));
  assert.doesNotMatch(r.body, /s3cret value/, "el secreto nunca se vuelve a mostrar");

  // Conectar: redirige a SoundCloud con PKCE (S256) y state.
  r = await req(port, { path: `/setup/connect?k=${key}` });
  assert.equal(r.status, 303);
  const auth = new URL(r.headers.location);
  assert.equal(auth.origin + auth.pathname, "https://secure.soundcloud.com/authorize");
  assert.equal(auth.searchParams.get("client_id"), "abcdefgh123");
  assert.equal(auth.searchParams.get("redirect_uri"), `http://127.0.0.1:${port}/callback`);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const state = auth.searchParams.get("state");

  // Vuelta con state erróneo: no canjea nada.
  r = await req(port, { path: `/callback?code=abc&state=wrong` });
  assert.equal(r.status, 400); assert.equal(tokenCalls.length, 0); assert.equal(store.get("refresh_token"), null);
  // Vuelta con error de SoundCloud.
  r = await req(port, { path: `/callback?error=access_denied` });
  assert.match(r.body, /access_denied/);

  // Vuelta correcta: canjea con el verifier que corresponde al challenge y guarda la sesión.
  r = await req(port, { path: `/callback?code=THE-CODE&state=${state}` });
  assert.equal(r.status, 200); assert.match(r.body, /dj tester/);
  assert.equal(tokenCalls.length, 1);
  const t = tokenCalls[0];
  assert.equal(t.grant_type, "authorization_code"); assert.equal(t.code, "THE-CODE"); assert.equal(t.client_secret, "s3cret value-12345");
  assert.equal(b64url(crypto.createHash("sha256").update(t.code_verifier).digest()), auth.searchParams.get("code_challenge"), "PKCE correcto");
  assert.equal(store.get("refresh_token"), "RT-new");
  assert.deepEqual(success, { username: "dj tester", access_token: "AT", expires_in: 3600 });
  assert.deepEqual(await s.done, { ok: true, username: "dj tester" });
  await new Promise((r) => setTimeout(r, 1700));
  await assert.rejects(req(port, { path: `/setup?k=${key}` }), "la página se cierra al terminar");
  console.log("página local OK");
}

// ---------- 2. Casos de error al arrancar ----------
{
  await assert.rejects(startSetup({ store: memStore(false), openFn: async () => true }), (e) => e instanceof SetupError && /not available/.test(e.message) && e.fix[0] === "install it");
  await assert.rejects(startSetup({ store: memStore(), redirectUri: "https://example.com/callback", openFn: async () => true }), /must be http:\/\/127\.0\.0\.1/);
  const port = await freePort();
  const busy = http.createServer().listen(port, "127.0.0.1");
  await new Promise((r) => busy.once("listening", r));
  await assert.rejects(startSetup({ store: memStore(), redirectUri: `http://127.0.0.1:${port}/callback`, openFn: async () => true }), (e) => e instanceof SetupError && /busy/.test(e.message));
  busy.close();

  // Una segunda llamada mientras está abierta devuelve la misma página.
  const p2 = await freePort();
  const a = await startSetup({ store: memStore(), redirectUri: `http://127.0.0.1:${p2}/callback`, openFn: async () => false, open: true });
  const b = await startSetup({ store: memStore(), openFn: async () => true });
  assert.equal(a.opened, false); assert.equal(b.already_running, true); assert.equal(b.url, a.url);
  // completeFromUrl con state ajeno falla sin guardar.
  await assert.rejects(a.completeFromUrl(`http://127.0.0.1:${p2}/callback?code=x&state=y`), /state/);
  a.close();
  assert.deepEqual(await a.done, { ok: false, reason: "closed" });
  console.log("errores de arranque OK");
}

// ---------- 3. Herramientas setup_status y start_setup ----------
{
  const S = await import("../server.mjs");
  const store = memStore();
  let meOk = true, probeOk = true;
  S._setDeps({
    goPlus: false,
    store: () => ({ ...store, probe: () => (probeOk ? { ok: true } : { ok: false, problem: "secret-tool is not installed.", fix: ["sudo apt install libsecret-tools"] }) }),
    secretGet: (a) => store.get(a),
    secretSet: (a, v) => store.set(a, v),
    credentials: () => {
      if (!store.get("client_id")) throw new SetupError("SoundCrate is not set up yet: missing credentials.");
      return { clientId: store.get("client_id"), clientSecret: store.get("client_secret") };
    },
    tokenRequest: async () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 }),
    fetch: async (url) => (new URL(url).pathname === "/me" && meOk ? Response.json({ id: 1, username: "dj tester", subscriptions: [] }) : new Response("x", { status: 500 })),
    startSetup: async (o) => ({ url: "http://127.0.0.1:8976/setup?k=abc", opened: o.open, already_running: false, store: "Test store", _o: o }),
  });
  const call = async (name, args = {}) => {
    const r = (await S.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result;
    return r.isError ? { err: r.content[0].text } : JSON.parse(r.content[0].text);
  };

  // Almacén no disponible: el primer paso dice cómo instalarlo.
  probeOk = false;
  let r = await call("setup_status");
  assert.equal(r.ready, false); assert.equal(r.next_step.id, "secure_storage");
  assert.ok(r.next_step.how.includes("sudo apt install libsecret-tools"));
  assert.match(r.guidance_for_agent, /one step at a time/);
  probeOk = true;

  // Sin credenciales: siguiente paso, la app de SoundCloud, con start_setup.
  r = await call("setup_status");
  assert.equal(r.next_step.id, "soundcloud_app"); assert.match(r.next_step.how[0], /start_setup/);
  // Cualquier herramienta que necesite sesión manda a setup_status.
  r = await call("search_tracks", { query: "x" });
  assert.match(r.err, /not connected/); assert.match(r.err, /Call the setup_status tool/);

  // Con credenciales pero sin sesión: conectar la cuenta.
  store.set("client_id", "abcdefgh123"); store.set("client_secret", "secret-12345");
  r = await call("setup_status");
  assert.equal(r.next_step.id, "connect_account");

  // start_setup devuelve la URL y qué decirle al usuario; open_browser=false no abre nada.
  r = await call("start_setup");
  assert.equal(r.url, "http://127.0.0.1:8976/setup?k=abc"); assert.equal(r.browser_opened, true); assert.match(r.tell_user, /browser/);
  r = await call("start_setup", { open_browser: false });
  assert.equal(r.browser_opened, false); assert.match(r.tell_user, /http:\/\/127\.0\.0\.1:8976\/setup/);

  // Todo listo: comprueba la sesión contra /me.
  store.set("refresh_token", "rt1");
  r = await call("setup_status");
  assert.equal(r.ready, true); assert.equal(r.connected_as, "dj tester"); assert.equal(r.next_step, null);
  assert.equal(r.steps.find((x) => x.id === "go_plus").status, "optional", "Go+ es opcional");
  assert.ok(r.steps.find((x) => x.id === "go_plus").how[1].OpenCode, "dice dónde declararlo en cada cliente");
  assert.equal(store.get("refresh_token"), "rt2", "la comprobación rota y guarda el token");
  // Sin verificar no llama a SoundCloud.
  meOk = false;
  r = await call("setup_status", { verify_session: false });
  assert.equal(r.ready, true); assert.equal(r.steps.some((x) => x.id === "check_session"), false);

  // Las instrucciones del servidor explican cómo actuar con usuarios nuevos.
  const init = (await S.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })).result;
  assert.match(init.instructions, /setup_status/); assert.match(init.instructions, /never ask for secrets in the chat/);
  const names = S.listTools().map((t) => t.name);
  assert.deepEqual(names.slice(0, 2), ["setup_status", "start_setup"]);
  assert.equal(S.listTools().find((t) => t.name === "start_setup").annotations.readOnlyHint, false);
  console.log("herramientas de configuración OK");
}
console.log("OK");
