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
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- Canje tras reponer las credenciales: la MISMA URL, con un token endpoint local simulado ----------
// Cubre lo que hasta la ronda 4 solo se comprobaba a mano: sin credenciales el state no se consume, y al guardarlas
// la misma URL de vuelta canjea. El token endpoint es un HTTP local de verdad (el canje va por fetch a 127.0.0.1).
{
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
  const tokenPort = tokenSrv.address().port;
  const tokenRequest = async (params) => {
    const r = await fetch(`http://127.0.0.1:${tokenPort}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`SoundCloud /oauth/token ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  const m = new Map([["client_id", "FAKEID12345"], ["client_secret", "fake-secret-XYZ"]]);
  const mem = { label: "mem", get: (a) => m.get(a) ?? null, set: (a, v) => m.set(a, v), del: (a) => m.delete(a), probe: () => ({ ok: true }) };
  let haveCreds = true;
  const cbPort2 = await free();
  const { startSetup } = await import("../setup.mjs");
  const s = await startSetup({
    store: mem,
    credentials: () => {
      if (!haveCreds) throw new Error("SoundCrate is not set up yet: the SoundCloud app credentials (Client ID and Client Secret) are missing.");
      return { clientId: m.get("client_id"), clientSecret: m.get("client_secret") };
    },
    tokenRequest,
    fetchFn: async () => Response.json({ username: "tester" }),
    redirectUri: `http://127.0.0.1:${cbPort2}/callback`,
    open: false,
  });
  try {
    const connectUrl = s.url.replace("/setup?", "/setup/connect?");
    const state = new URL((await fetch(connectUrl, { redirect: "manual" })).headers.get("location")).searchParams.get("state");
    const sameUrl = `http://127.0.0.1:${cbPort2}/callback?code=CODE1&state=${encodeURIComponent(state)}`;
    haveCreds = false;
    await assert.rejects(s.completeFromUrl(sameUrl), (e) => e.code === "no_credentials");
    assert.equal(tokenCalls, 0, "sin credenciales no se llama al token endpoint");
    haveCreds = true;
    assert.equal(await s.completeFromUrl(sameUrl), "tester");
    assert.equal(tokenCalls, 1, "la MISMA URL canjea tras reponer las credenciales");
    assert.match(tokenBody, /grant_type=authorization_code/);
    assert.equal(m.get("refresh_token"), "fake-refresh");
  } finally {
    s.close();
    await s.done;
    tokenSrv.closeAllConnections?.();
    await new Promise((r) => tokenSrv.close(r));
  }
}
process.exit(0);
