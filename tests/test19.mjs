// Lote L4 (ronda 4) · login.mjs sin credenciales: se ejecuta el comando de verdad (proceso hijo, sin navegador ni red).
// Pegar la URL de vuelta sin credenciales manda al paso 2 y dice que vale la MISMA URL; el state no se consume (la
// misma URL pegada otra vez da el mismo mensaje, no «does not match»); un state falso sigue dando «does not match».
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-test19-"));
const emptyBin = path.join(dir, "bin");
fs.mkdirSync(emptyBin);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const free = () =>
  new Promise((r) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

// Preloads del hijo: el guard primero y el token endpoint falso después (el segundo envuelve al fetch ya vigilado).
// Si la prueba se lanza ya con el guard en NODE_OPTIONS, no se duplica.
const guardUrl = new URL("./_noNetwork.mjs", import.meta.url).href;
const fakeOAuthUrl = new URL("./_fakeOAuth.mjs", import.meta.url).href;
const withPreloads = (base = "") => {
  let opts = String(base ?? "");
  if (!opts.includes(guardUrl)) opts = `${opts} --import ${guardUrl}`.trim();
  if (!opts.includes(fakeOAuthUrl)) opts = `${opts} --import ${fakeOAuthUrl}`.trim();
  return opts;
};
// Espera a que el hijo salga (Windows: no se puede borrar su carpeta antes; rmdir da EBUSY).
const waitExit = async (child, ms = 5000) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([new Promise((r) => child.once("exit", r)), sleep(ms)]);
};

const cbPort = await free();
const isolation = {
  SC_SECRET_STORE: "file",
  SC_SECRETS_FILE: path.join(dir, "creds.json"),
  SC_SECRET_SERVICE: "soundcrate-review",
  SC_REDIRECT_URI: `http://127.0.0.1:${cbPort}/callback`,
};
// SC_NO_BROWSER: garantía de que el hijo no abre nada. PATH apunta a una carpeta vacía como doble seguro para
// open/xdg-open; con UNA sola clave (PATH y Path a la vez son ambiguos en win32: los dos acabarían en el bloque de
// entorno del hijo). No está comprobado en Windows si rundll32 se resuelve desde System32 con PATH vacío; por eso
// no se confía solo en PATH.
const env = {
  ...process.env,
  ...isolation,
  SC_NO_BROWSER: "1",
  NODE_OPTIONS: withPreloads(process.env.NODE_OPTIONS),
};
delete env.PATH;
delete env.Path;
env[process.platform === "win32" ? "Path" : "PATH"] = emptyBin;
delete env.SC_CLIENT_ID;
delete env.SC_CLIENT_SECRET;
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;

// Almacén de ficheros del hijo, manejado desde aquí con el mismo entorno (se restaura al terminar).
const saved = {};
for (const k of [...Object.keys(isolation), "SC_CLIENT_ID", "SC_CLIENT_SECRET"]) saved[k] = process.env[k];
Object.assign(process.env, isolation);
delete process.env.SC_CLIENT_ID;
delete process.env.SC_CLIENT_SECRET;
const { createStore } = await import("../secrets.mjs");
const store = createStore();

let child;
let out = "";
let err = "";
try {
  store.set("client_id", "FAKEID12345");
  store.set("client_secret", "fake-secret-XYZ");
  child = spawn(process.execPath, [path.join(root, "login.mjs")], { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const waitFor = async (get, re, what) => {
    for (let i = 0; i < 100 && !re.test(get()); i++) await sleep(100);
    assert.match(get(), re, `${what}: out=${out} err=${err}`);
  };

  await waitFor(() => out, /http:\/\/\S+\/setup\?k=\S+/, "URL de la página");
  const url = out.match(/http:\/\/\S+\/setup\?k=\S+/)[0];
  const res = await fetch(url.replace("/setup?", "/setup/connect?"), { redirect: "manual" });
  const state = new URL(res.headers.get("location")).searchParams.get("state");
  assert.ok(state, "hay state");
  store.del("client_secret"); // ahora faltan las credenciales

  const paste = async (u) => {
    const n = err.length;
    child.stdin.write(u + "\n");
    await waitFor(() => err.slice(n), /\S/, "respuesta de login.mjs");
    await sleep(200);
    return err.slice(n);
  };
  const back = `http://127.0.0.1:${cbPort}/callback?code=CODE1&state=${encodeURIComponent(state)}`;

  const m1 = await paste(back);
  assert.match(m1, /step 2/, m1);
  assert.match(m1, /Client ID/, m1);
  assert.match(m1, /Client Secret/, m1);
  assert.match(m1, /SAME URL/, m1);
  assert.doesNotMatch(m1, /step 3|new URL|does not match/i, m1);

  // El state no se consumió: la misma URL, otra vez, da el mismo aviso (no «does not match»).
  const m2 = await paste(back);
  assert.match(m2, /step 2/, m2);
  assert.doesNotMatch(m2, /does not match/, m2);

  // Un state falso sigue dando su mensaje de siempre.
  const m3 = await paste(`http://127.0.0.1:${cbPort}/callback?code=CODE1&state=otro`);
  assert.match(m3, /does not match this session/, m3);
  assert.match(m3, /step 3/, m3);

  assert.equal(child.exitCode, null, "login.mjs sigue escuchando");
  assert.ok(!(out + err).includes("fake-secret-XYZ"), "el secreto no sale por pantalla");
  console.log("test19 OK");
} finally {
  try {
    child?.kill();
  } catch {}
  await waitExit(child);
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ---------- login.mjs REAL, canje tras reponer las credenciales y página de éxito antes de salir ----------
// Sustituye al bloque de la ronda 5 que llamaba a startSetup dentro de este proceso (duplicaba test17): aquí se
// lanza login.mjs de verdad (hijo, almacén de fichero, SC_NO_BROWSER=1) y el canje va a un token endpoint HTTP
// local. El preload tests/_fakeOAuth.mjs reescribe la URL del token y /me; no se habla con SoundCloud.
// Cubre: (1) sin credenciales el state no se consume y la misma URL no canjea; (2) al reponerlas, la MISMA URL
// canjea; (3) el navegador recibe la página de éxito (200) ANTES de que login.mjs salga con código 0.
{
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-test19-login-"));
  const emptyBin2 = path.join(dir2, "bin");
  fs.mkdirSync(emptyBin2);
  let tokenCalls = 0;
  let tokenBody = "";
  const tokenSrv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      tokenCalls++;
      tokenBody = body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 }));
    });
  });
  await new Promise((r) => tokenSrv.listen(0, "127.0.0.1", r));
  const cbPort2 = await free();
  const credsFile = path.join(dir2, "creds.json");
  const env2 = {
    ...process.env,
    SC_SECRET_STORE: "file",
    SC_SECRETS_FILE: credsFile,
    SC_SECRET_SERVICE: "soundcrate-review",
    SC_REDIRECT_URI: `http://127.0.0.1:${cbPort2}/callback`,
    SC_NO_BROWSER: "1",
    SC_TEST_TOKEN_URL: `http://127.0.0.1:${tokenSrv.address().port}/oauth/token`,
    NODE_OPTIONS: withPreloads(process.env.NODE_OPTIONS),
  };
  delete env2.SC_CLIENT_ID;
  delete env2.SC_CLIENT_SECRET;
  delete env2.DISPLAY;
  delete env2.WAYLAND_DISPLAY;
  delete env2.PATH;
  delete env2.Path;
  env2[process.platform === "win32" ? "Path" : "PATH"] = emptyBin2;
  const { createStore } = await import("../secrets.mjs");
  const store2 = createStore({ env: env2 });
  store2.set("client_id", "FAKEID12345");
  store2.set("client_secret", "fake-secret-XYZ");
  let child2;
  let out2 = "";
  let err2 = "";
  let exited = null;
  try {
    child2 = spawn(process.execPath, [path.join(root, "login.mjs")], {
      env: env2,
      cwd: dir2,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child2.stdout.on("data", (d) => (out2 += d));
    child2.stderr.on("data", (d) => (err2 += d));
    exited = new Promise((r) => child2.once("exit", (code, signal) => r({ code, signal })));
    const waitFor = async (get, re, what) => {
      for (let i = 0; i < 100 && !re.test(get()); i++) await sleep(100);
      assert.match(get(), re, `${what}: out=${out2} err=${err2}`);
    };
    await waitFor(() => out2, /http:\/\/\S+\/setup\?k=\S+/, "URL de la página");
    const url = out2.match(/http:\/\/\S+\/setup\?k=\S+/)[0];
    const connect = await fetch(url.replace("/setup?", "/setup/connect?"), { redirect: "manual" });
    const state = new URL(connect.headers.get("location")).searchParams.get("state");
    assert.ok(state, "hay state");
    const back = `http://127.0.0.1:${cbPort2}/callback?code=CODE1&state=${encodeURIComponent(state)}`;

    store2.del("client_secret"); // faltan credenciales
    const r1 = await fetch(back);
    const h1 = await r1.text();
    assert.equal(r1.status, 400, "sin credenciales /callback da error");
    assert.match(h1, /SoundCrate is not set up yet/, "la página explica que faltan las credenciales");
    assert.equal(tokenCalls, 0, "sin credenciales no se llama al token endpoint");

    store2.set("client_secret", "fake-secret-XYZ"); // la MISMA URL debe seguir valiendo (el state no se consumió)
    const r2 = await fetch(back);
    const h2 = await r2.text();
    assert.equal(r2.status, 200, `el navegador recibe la página de éxito: ${h2.slice(0, 300)}`);
    assert.match(h2, /All set!|¡Listo!/, "es la página de éxito");
    assert.match(h2, /tester/, "muestra el usuario de /me");
    assert.equal(tokenCalls, 1, "la MISMA URL canjea tras reponer las credenciales");
    assert.match(tokenBody, /grant_type=authorization_code/);
    assert.equal(store2.get("refresh_token"), "fake-refresh", "el refresh_token se guardó");

    const ex = await Promise.race([exited, sleep(10000).then(() => null)]);
    assert.ok(ex, `login.mjs debe salir tras enviar la página: out=${out2} err=${err2}`);
    assert.equal(ex.code, 0, `login.mjs sale con 0: out=${out2} err=${err2}`);
    assert.ok(!(out2 + err2).includes("fake-secret-XYZ"), "el secreto no sale por pantalla");
  } finally {
    try {
      child2?.kill();
    } catch {}
    await waitExit(child2);
    tokenSrv.closeAllConnections?.();
    await new Promise((r) => tokenSrv.close(r));
    fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
process.exit(0);
