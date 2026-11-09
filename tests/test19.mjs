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
process.exit(0);
