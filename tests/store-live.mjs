// Prueba el almacén de secretos REAL del sistema (Llavero, Secret Service, Administrador de credenciales o fichero).
// Usa un servicio aleatorio "soundcrate-test-…", así que nunca toca las credenciales de verdad, y lo limpia al final.
// Uso: node tests/store-live.mjs            (almacén por defecto del sistema)
//      SC_SECRET_STORE=file node tests/store-live.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, defaultRun } from "../secrets.mjs";

const env = { ...process.env, SC_SECRET_SERVICE: `soundcrate-test-${process.pid}-${Date.now()}` };
let tmp = null;
if ((env.SC_SECRET_STORE || "").toLowerCase() === "file" && !env.SC_SECRETS_FILE) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soundcrate-live-"));
  env.SC_SECRETS_FILE = path.join(tmp, "credentials.json");
}
const calls = [];
const run = (cmd, args, opts) => (calls.push({ cmd, args, env: opts?.env }), defaultRun(cmd, args, opts));
const store = createStore({ env, run });
console.log(`almacén: ${store.name} (${store.label}) · servicio de prueba: ${store.service}`);

const accounts = ["client_id", "client_secret", "refresh_token"];
const values = {
  client_id: "AbCdEf0123456789",
  client_secret: 'sec "quoted" $HOME `x` \\back ;|&<>~',
  refresh_token: "rt-" + "x".repeat(200),
};
try {
  const p = store.probe();
  assert.ok(p.ok, `el almacén no está disponible: ${p.problem}`);
  for (const a of accounts) assert.equal(store.get(a), null, `${a} no existe al empezar`);
  for (const a of accounts) store.set(a, values[a]);
  for (const a of accounts) assert.equal(store.get(a), values[a], `${a}: ida y vuelta exacta`);
  // Rotación del refresh token: sobrescribe.
  store.set("refresh_token", "rt-rotated-1");
  assert.equal(store.get("refresh_token"), "rt-rotated-1");
  // Valores no ASCII rechazados antes de tocar el almacén.
  assert.throws(() => store.set("client_id", "ñandú"), /printable ASCII/);
  // Ningún secreto en los argumentos ni en el entorno de los procesos lanzados.
  for (const c of calls) for (const v of [...Object.values(values), "rt-rotated-1"]) {
    assert.ok(!c.args.some((x) => x.includes(v)), `secreto en argumentos de ${c.cmd}`);
    assert.ok(!JSON.stringify(c.env || {}).includes(v), `secreto en el entorno de ${c.cmd}`);
  }
  for (const a of accounts) assert.equal(store.del(a), true, `${a} borrado`);
  for (const a of accounts) assert.equal(store.get(a), null, `${a} ya no existe`);
  console.log(`OK (${calls.length} llamadas al sistema)`);
} finally {
  for (const a of accounts) {
    try {
      store.del(a);
    } catch {}
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
