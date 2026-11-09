// Página de configuración (setup.mjs): CSRF con navegador real (Origin: null), claves que no se filtran, caducidad
// por inactividad, reapertura, openBrowser, cambio de app, escapes, CSP, /setup/connect y solo-loopback.
// Sin red: SoundCloud, el almacén y el navegador son simulados.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { startSetup, openBrowser } from "../setup.mjs";
import { SetupError } from "../secrets.mjs";

const freePort = () =>
  new Promise((r) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });
const req = (port, { method = "GET", p, headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject);
    r.end(body);
  });
const memStore = () => {
  const m = new Map();
  return { name: "mem", label: "Test store", m, get: (a) => m.get(a) ?? null, set: (a, v) => m.set(a, v), del: (a) => m.delete(a), probe: () => ({ ok: true }) };
};
const credsOf = (store) => () => {
  if (!store.get("client_id")) throw new SetupError("missing");
  return { clientId: store.get("client_id"), clientSecret: store.get("client_secret") };
};
// Arranca una página con todo simulado; devuelve utilidades.
async function boot(o = {}) {
  const port = await freePort();
  const store = o.store || memStore();
  const tokenCalls = [];
  const s = await startSetup({
    store,
    credentials: credsOf(store),
    redirectUri: `http://127.0.0.1:${port}/callback`,
    tokenRequest: o.tokenRequest || (async (p) => (tokenCalls.push(p), { access_token: "AT", refresh_token: "RT-new", expires_in: 3600 })),
    fetchFn: async () => Response.json({ username: o.username ?? "dj tester" }),
    openFn: o.openFn || (async () => true),
    open: o.open ?? false,
    ...o.extra,
  });
  const key = new URL(s.url).searchParams.get("k");
  const post = (form, headers = {}) =>
    req(port, { method: "POST", p: "/setup/credentials", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString() });
  const close = async () => {
    s.close();
    await s.done;
  };
  return { s, port, store, key, tokenCalls, post, close };
}
const good = (key, extra = {}) => ({ k: key, client_id: "abcdefgh123", client_secret: "secret-12345", ...extra });

// ---------- #1 / T6: el navegador real envía "Origin: null" (Referrer-Policy: no-referrer) ----------
{
  const t = await boot();
  const base = { origin: "null" };
  // Navegador real: Origin null + Sec-Fetch-Site same-origin -> acepta y guarda.
  let r = await t.post(good(t.key), { ...base, "sec-fetch-site": "same-origin" });
  assert.equal(r.status, 303, "Origin: null + same-origin debe guardarse");
  assert.equal(t.store.get("client_id"), "abcdefgh123");
  // Origin null desde otra web (iframe sandbox, data: URL...): cross-site / same-site / none -> 403.
  t.store.m.clear();
  for (const sfs of ["cross-site", "same-site", "none"]) {
    r = await t.post(good(t.key), { ...base, "sec-fetch-site": sfs });
    assert.equal(r.status, 403, `Origin: null + ${sfs}`);
  }
  // Un Origin real y correcto pero declarado cross-site tampoco pasa; ajeno con same-origin tampoco.
  assert.equal((await t.post(good(t.key), { origin: `http://127.0.0.1:${t.port}`, "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await t.post(good(t.key), { origin: "https://evil.example", "sec-fetch-site": "same-origin" })).status, 403);
  assert.equal(t.store.m.size, 0, "nada guardado en los rechazos");
  // Navegadores sin Sec-Fetch-Site (Safari antiguo): Origin null pasa si la clave es buena; sin clave no.
  assert.equal((await t.post(good(t.key), base)).status, 303);
  assert.equal((await t.post(good("mala"), { ...base, "sec-fetch-site": "same-origin" })).status, 403, "con Origin null sigue haciendo falta la clave");
  await t.close();
  console.log("#1/T6 Origin null OK");
}

// ---------- #20: la clave válida no se entrega a quien no la presenta ----------
{
  const t = await boot();
  const leaks = (r) => r.body.includes(t.key) || JSON.stringify(r.headers).includes(t.key);
  let r = await req(t.port, { p: "/setup?k=x" });
  assert.equal(r.status, 403); assert.ok(!leaks(r), "403 de clave errónea sin la clave");
  r = await req(t.port, { p: "/setup" });
  assert.ok(!leaks(r), "sin clave");
  r = await t.post({ k: "x", client_id: "abcdefgh123", client_secret: "secret-12345" });
  assert.equal(r.status, 403); assert.ok(!leaks(r), "POST con clave errónea");
  r = await req(t.port, { p: "/callback?error=access_denied" });
  assert.match(r.body, /access_denied/); assert.ok(!leaks(r), "/callback?error= sin la clave");
  r = await req(t.port, { p: "/callback?code=a&state=b" });
  assert.equal(r.status, 400); assert.ok(!leaks(r), "/callback con state erróneo sin la clave");
  r = await req(t.port, { p: "/setup/connect?k=x" });
  assert.ok(!leaks(r), "/setup/connect con clave errónea");
  // Errores de validación con clave válida: sí hay enlace de vuelta (quien envía ya la conocía).
  r = await t.post(good(t.key, { client_id: "bad id!" }));
  assert.match(r.body, /Client ID does not look right/); assert.ok(r.body.includes(`/setup?k=${t.key}`));
  await t.close();
  console.log("#20 clave sin filtrar OK");
}

// ---------- #21: el plazo cuenta desde la última actividad con clave válida ----------
{
  const t = await boot({ extra: { timeoutMs: 700 } });
  let finished = false;
  t.s.done.then(() => (finished = true));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 5; i++) {
    await sleep(300); // 1500 ms en total > 700 ms
    assert.equal((await req(t.port, { p: `/setup?k=${t.key}` })).status, 200, `sigue viva tras ${(i + 1) * 300} ms`);
  }
  assert.equal(finished, false);
  // Las peticiones con clave errónea no alargan la vida.
  for (let i = 0; i < 3; i++) {
    await sleep(300);
    await req(t.port, { p: "/setup?k=mala" }).catch(() => {});
  }
  assert.deepEqual(await t.s.done, { ok: false, reason: "timeout", idle_minutes: 1 });
  console.log("#21 caducidad por inactividad OK");
}

// ---------- #22: repetir start_setup reabre y cuenta la verdad ----------
{
  let opens = [];
  const t = await boot({ open: true, openFn: async (u) => (opens.push(u), true) });
  assert.equal(opens.length, 1);
  let r = await startSetup({ open: true, openFn: async (u) => (opens.push(u), true) });
  assert.equal(r.already_running, true); assert.equal(r.url, t.s.url); assert.equal(r.opened, true); assert.deepEqual(opens, [t.s.url, t.s.url], "se vuelve a abrir la misma URL");
  r = await startSetup({ open: false, openFn: async (u) => (opens.push(u), true) });
  assert.equal(r.already_running, true); assert.equal(r.opened, false, "open:false no abre ni dice que se abrió"); assert.equal(opens.length, 2);
  r = await startSetup({ open: true, openFn: async () => false });
  assert.equal(r.opened, false, "si no se pudo abrir, no se dice que sí");
  await t.close();
  console.log("#22 reapertura OK");
}

// ---------- #23: openBrowser no da por abierto lo que falló ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fakebin-"));
  const marker = path.join(dir, "ran");
  const fake = (body) => fs.writeFileSync(path.join(dir, "xdg-open"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  // Se pasa el entorno por parámetro y también por process.env (así la prueba vale para firmas sin ese parámetro).
  const open = (env, o = {}) => {
    const saved = { ...process.env };
    for (const k of ["PATH", "DISPLAY", "WAYLAND_DISPLAY"]) delete process.env[k];
    Object.assign(process.env, env);
    const p = openBrowser("http://x/", "linux", { env, ...o });
    Object.assign(process.env, saved);
    return p;
  };
  // Los xdg-open falsos son scripts de sh (como en Linux/macOS, donde existe xdg-open/open): en Windows no hay
  // sh ni execFile arranca scripts sin extensión, así que esos casos se saltan allí. Los dos casos sin script
  // (sin pantalla y comando inexistente) corren en todas las plataformas.
  assert.equal(await open({ PATH: path.join(dir, "no") }), false, "sin DISPLAY ni WAYLAND_DISPLAY");
  assert.equal(await open({ PATH: path.join(dir, "no"), DISPLAY: ":0" }), false, "xdg-open no instalado");
  if (process.platform === "win32") console.log("#23: casos con xdg-open falso SALTADOS en Windows (scripts sh)");
  else {
    const env = { PATH: dir, DISPLAY: ":0" };
    fake("exit 3");
    assert.equal(await open(env), false, "xdg-open sale con error");
    fake("exit 0");
    assert.equal(await open(env), true, "xdg-open ok");
    fake("/bin/sleep 5");
    assert.equal(await open(env, { timeoutMs: 200 }), true, "sigue vivo: se da por abierto");
    fake(`/usr/bin/touch ${marker}; exit 0`);
    assert.equal(await open({ PATH: dir }), false, "sin DISPLAY ni WAYLAND_DISPLAY");
    assert.ok(!fs.existsSync(marker), "ni siquiera se lanza xdg-open");
    assert.equal(await open({ PATH: dir, WAYLAND_DISPLAY: "wayland-0" }), true, "con Wayland");
    assert.equal(await open({ PATH: path.join(dir, "no"), DISPLAY: ":0" }), false, "xdg-open no instalado");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("#23 openBrowser OK");
}

// ---------- #18: cambiar a otra app invalida la sesión de la anterior ----------
{
  const store = memStore();
  store.set("client_id", "oldapp12345"); store.set("client_secret", "old-secret-1"); store.set("refresh_token", "RT-old");
  let changedCalls = 0;
  const t = await boot({ store, extra: { onCredentialsChanged: () => changedCalls++ } });
  // Mismo Client ID (solo rota el secret): la sesión se conserva.
  let r = await t.post(good(t.key, { client_id: "oldapp12345", client_secret: "new-secret-9" }));
  assert.equal(r.status, 303); assert.doesNotMatch(r.headers.location, /reconnect/);
  assert.equal(store.get("refresh_token"), "RT-old"); assert.equal(changedCalls, 0);
  // Otra app: se borra el refresh_token, se avisa al servidor y la página pide repetir el paso 3.
  r = await t.post(good(t.key, { client_id: "newapp67890" }));
  assert.equal(r.status, 303); assert.match(r.headers.location, /reconnect=1/);
  assert.equal(store.get("client_id"), "newapp67890");
  assert.equal(store.get("refresh_token"), null, "el refresh_token de la app anterior se borra");
  assert.equal(changedCalls, 1);
  r = await req(t.port, { p: r.headers.location });
  assert.match(r.body, /connect your account again/); assert.match(r.body, /\/setup\/connect\?k=/);
  // Primera vez (sin app previa) no cuenta como cambio.
  const s2 = memStore();
  await t.close();
  const t2 = await boot({ store: s2, extra: { onCredentialsChanged: () => changedCalls++ } });
  r = await t2.post(good(t2.key));
  assert.doesNotMatch(r.headers.location, /reconnect/); assert.equal(changedCalls, 1);
  await t2.close();
  console.log("#18 cambio de app OK");
}

// ---------- #7: aviso de las condiciones de la API y descripción honesta ----------
{
  const t = await boot();
  let r = await req(t.port, { p: `/setup?k=${t.key}` });
  assert.match(r.body, /developers\.soundcloud\.com\/docs\/api\/terms-of-use/);
  assert.match(r.body, /Section 03/); assert.match(r.body, /artificial intelligence/); assert.match(r.body, /revoke/);
  assert.doesNotMatch(r.body, /<code>SoundCrate<\/code>/, "la descripción de la app ya no es solo «SoundCrate»");
  assert.match(r.body, /<code>Local AI assistant/);
  r = await req(t.port, { p: `/setup?k=${t.key}`, headers: { "accept-language": "es-ES,es;q=0.9" } });
  assert.match(r.body, /sección 03/); assert.match(r.body, /inteligencia artificial/); assert.match(r.body, /<code>Asistente de IA local/);
  await t.close();
  console.log("#7 aviso de condiciones OK");
}

// ---------- T2: escape en /callback y en la página de éxito; CSP completa ----------
{
  const t = await boot({ username: `<img src=x onerror=alert(1)>"&` });
  const csp = (await req(t.port, { p: `/setup?k=${t.key}` })).headers["content-security-policy"];
  assert.deepEqual(csp.split(/;\s*/).sort(), ["base-uri 'none'", "default-src 'none'", "form-action 'self'", "frame-ancestors 'none'", "style-src 'unsafe-inline'"]);
  for (const p of ["/setup", `/setup?k=${t.key}`, "/callback?error=x", "/nada"]) {
    const h = (await req(t.port, { p })).headers;
    assert.equal(h["x-content-type-options"], "nosniff", p); assert.equal(h["cache-control"], "no-store", p); assert.equal(h["referrer-policy"], "no-referrer", p);
    if (p !== "/nada") assert.equal(h["content-security-policy"], csp, p);
  }
  const evil = `<script>alert(1)</script>"'&`;
  const q = new URLSearchParams({ error: evil, error_description: `<img src=x onerror=alert(2)>` });
  const r = await req(t.port, { p: `/callback?${q}` });
  assert.doesNotMatch(r.body, /<script>alert|<img src=x/, "sin HTML sin escapar en /callback");
  assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/);
  assert.match(r.body, /&lt;img src=x onerror=alert\(2\)&gt;/);
  // Página de éxito: el nombre de usuario también va escapado.
  {
    await req(t.port, { p: `/setup?k=${t.key}` });
    await t.post(good(t.key));
    const c = await req(t.port, { p: `/setup/connect?k=${t.key}` });
    const state = new URL(c.headers.location).searchParams.get("state");
    const ok = await req(t.port, { p: `/callback?code=C&state=${state}` });
    assert.equal(ok.status, 200);
    assert.doesNotMatch(ok.body, /<img src=x/); assert.match(ok.body, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;/);
  }
  await t.s.done;
  console.log("T2 escapes y CSP OK");
}

// ---------- T4: /setup/connect exige la clave y el state es de un solo uso ----------
{
  const t = await boot();
  await t.post(good(t.key));
  for (const p of ["/setup/connect", "/setup/connect?k=", "/setup/connect?k=mala"]) {
    const r = await req(t.port, { p });
    assert.equal(r.status, 403, p); assert.ok(!r.headers.location, "sin redirección a SoundCloud");
  }
  // Sin /setup/connect válido todavía no hay state: ningún /callback canjea.
  assert.equal((await req(t.port, { p: "/callback?code=C&state=" })).status, 400);
  assert.equal(t.tokenCalls.length, 0);
  // Un segundo /setup/connect invalida el state del primero.
  const s1 = new URL((await req(t.port, { p: `/setup/connect?k=${t.key}` })).headers.location).searchParams.get("state");
  const s2 = new URL((await req(t.port, { p: `/setup/connect?k=${t.key}` })).headers.location).searchParams.get("state");
  assert.notEqual(s1, s2);
  assert.equal((await req(t.port, { p: `/callback?code=C&state=${s1}` })).status, 400, "state antiguo");
  assert.equal(t.tokenCalls.length, 0);
  // El state bueno funciona una vez y no se puede reutilizar.
  assert.equal((await req(t.port, { p: `/callback?code=C&state=${s2}` })).status, 200);
  assert.equal(t.tokenCalls.length, 1);
  assert.equal((await req(t.port, { p: `/callback?code=C2&state=${s2}` })).status, 400, "state ya usado");
  assert.equal(t.tokenCalls.length, 1);
  await t.s.done;

  // También es de un solo uso si el canje falla.
  let n = 0;
  const f = await boot({ tokenRequest: async () => (n++, Promise.reject(new Error("invalid_grant"))) });
  await f.post(good(f.key));
  const st = new URL((await req(f.port, { p: `/setup/connect?k=${f.key}` })).headers.location).searchParams.get("state");
  let r = await req(f.port, { p: `/callback?code=C&state=${st}` });
  assert.equal(r.status, 400); assert.match(r.body, /invalid_grant/); assert.equal(n, 1);
  r = await req(f.port, { p: `/callback?code=C&state=${st}` });
  assert.equal(r.status, 400); assert.equal(n, 1, "el state fallido no se reutiliza");
  await f.close();
  console.log("T4 connect y state OK");
}

// ---------- T10: la página solo escucha en loopback ----------
{
  const created = [];
  const orig = http.createServer;
  http.createServer = (...a) => {
    const s = orig(...a);
    created.push(s);
    return s;
  };
  try {
    for (const host of ["127.0.0.1", "localhost"]) {
      const port = await freePort();
      const store = memStore();
      const n = created.length;
      const s = await startSetup({ store, credentials: credsOf(store), redirectUri: `http://${host}:${port}/callback`, openFn: async () => true, open: false });
      const addr = created[n].address();
      assert.ok(["127.0.0.1", "::1"].includes(addr.address), `${host}: escucha en ${addr.address}`);
      // Y de verdad no contesta por las direcciones de red del equipo.
      for (const list of Object.values(os.networkInterfaces()))
        for (const ni of list || []) {
          if (ni.internal || ni.family !== "IPv4") continue;
          const code = await new Promise((resolve) => {
            const c = net.connect({ host: ni.address, port, timeout: 1500 });
            c.once("connect", () => (c.destroy(), resolve("connected")));
            c.once("timeout", () => (c.destroy(), resolve("timeout")));
            c.once("error", (e) => resolve(e.code));
          });
          assert.notEqual(code, "connected", `no debe aceptar conexiones en ${ni.address}`);
        }
      s.close();
      await s.done;
    }
  } finally {
    http.createServer = orig;
  }
  console.log("T10 solo loopback OK");
}

console.log("OK");
