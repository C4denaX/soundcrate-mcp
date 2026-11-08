// Almacenes de secretos (secrets.mjs) con un ejecutor de comandos simulado: comandos, lectura de resultados,
// errores que guían al usuario y, sobre todo, que el secreto nunca vaya en los argumentos (se vería con `ps`).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, storeName, defaultFilePath, SetupError } from "../secrets.mjs";

const SECRET = 'S3cr3t "quoted" $HOME `x` \\ ;|&';

// Ejecutor simulado: guarda las llamadas y responde según una tabla.
function fakeRun(handler) {
  const calls = [];
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input, env: opts.env });
    return { status: 0, stdout: "", stderr: "", missing: false, ...handler(cmd, args, opts) };
  };
  return { run, calls };
}
const noSecretInArgs = (calls, secret = SECRET) => {
  for (const c of calls) {
    assert.ok(!c.args.some((a) => a.includes(secret)), `secreto en argumentos de ${c.cmd}`);
    assert.ok(!JSON.stringify(c.env || {}).includes(secret), `secreto en el entorno de ${c.cmd}`);
  }
};

// ---------- Selección ----------
assert.equal(storeName({}, "darwin"), "keychain");
assert.equal(storeName({}, "linux"), "secret-service");
assert.equal(storeName({}, "freebsd"), "secret-service");
assert.equal(storeName({}, "win32"), "wincred");
assert.equal(storeName({ SC_SECRET_STORE: "FILE" }, "darwin"), "file");
assert.throws(() => storeName({ SC_SECRET_STORE: "vault" }, "linux"), (e) => e instanceof SetupError && /keychain, secret-service, wincred, file/.test(e.message));
assert.throws(() => createStore({ env: { SC_SECRET_SERVICE: "bad name" }, platform: "darwin", run: () => ({}) }), /Invalid SC_SECRET_SERVICE/);

// ---------- macOS: Llavero ----------
{
  const kc = new Map();
  const { run, calls } = fakeRun((cmd, args, { input }) => {
    if (args[0] === "-i") {
      const m = input.match(/^add-generic-password -U -s (\S+) -a (\S+) -X ([0-9a-f]+)\n$/);
      assert.ok(m, "orden por stdin con el valor en hexadecimal");
      kc.set(`${m[1]}/${m[2]}`, Buffer.from(m[3], "hex").toString("utf8"));
      return {};
    }
    if (args[0] === "find-generic-password") {
      const v = kc.get(`${args[2]}/${args[4]}`);
      return v == null ? { status: 44 } : { stdout: v + "\n" };
    }
    if (args[0] === "delete-generic-password") return { status: kc.delete(`${args[2]}/${args[4]}`) ? 0 : 44 };
  });
  const s = createStore({ env: {}, platform: "darwin", run });
  assert.equal(s.name, "keychain"); assert.equal(s.service, "soundcloud-mcp");
  assert.equal(s.get("refresh_token"), null);
  s.set("refresh_token", SECRET);
  assert.equal(s.get("refresh_token"), SECRET, "ida y vuelta exacta");
  noSecretInArgs(calls);
  assert.equal(s.del("refresh_token"), true); assert.equal(s.get("refresh_token"), null);
  assert.throws(() => s.set("refresh_token", "ñandú"), /printable ASCII/);
  assert.throws(() => s.get("bad account"), /Invalid account/);
  assert.equal(s.probe().ok, true);
  const broken = createStore({ env: {}, platform: "darwin", run: () => ({ status: 1, stdout: "", stderr: "boom" }) });
  assert.throws(() => broken.get("x"), /Keychain read failed/);
}

// ---------- Linux: Secret Service ----------
{
  const db = new Map();
  const { run, calls } = fakeRun((cmd, args, { input }) => {
    assert.equal(cmd, "secret-tool");
    const k = `${args.at(-3)}/${args.at(-1)}`;
    if (args[0] === "store") {
      assert.deepEqual(args.slice(0, 3), ["store", "--label", `SoundCrate (${args.at(-1)})`]);
      db.set(k, input);
      return {};
    }
    if (args[0] === "lookup") return db.has(k) ? { stdout: db.get(k) } : { status: 1 };
    if (args[0] === "clear") return { status: db.delete(k) ? 0 : 1 };
  });
  const s = createStore({ env: {}, platform: "linux", run });
  assert.equal(s.name, "secret-service");
  assert.equal(s.get("client_secret"), null);
  s.set("client_secret", SECRET);
  assert.equal(s.get("client_secret"), SECRET);
  noSecretInArgs(calls);
  assert.equal(calls.find((c) => c.args[0] === "store").input, SECRET, "secreto por stdin");
  assert.equal(s.probe().ok, true);

  // Sin secret-tool: error de configuración con cómo instalarlo.
  const missing = createStore({ env: {}, platform: "linux", run: () => ({ status: null, stdout: "", stderr: "", missing: true }) });
  const p1 = missing.probe();
  assert.equal(p1.ok, false); assert.match(p1.problem, /not installed/); assert.ok(p1.fix.some((x) => /apt install libsecret-tools/.test(x)));
  assert.throws(() => missing.get("x"), (e) => e instanceof SetupError && e.fix.length >= 3);

  // Sin Secret Service (servidor sin escritorio): explica la reserva SC_SECRET_STORE=file.
  const nodbus = createStore({ env: {}, platform: "linux", run: () => ({ status: 1, stdout: "", stderr: "Cannot autolaunch D-Bus without X11 $DISPLAY" }) });
  const p2 = nodbus.probe();
  assert.equal(p2.ok, false); assert.match(p2.problem, /SC_SECRET_STORE=file/);
  assert.throws(() => nodbus.set("x", "value123"), (e) => e instanceof SetupError && /No Secret Service/.test(e.message));
}

// ---------- Windows: Administrador de credenciales ----------
{
  const vault = new Map();
  const { run, calls } = fakeRun((cmd, args, { input, env }) => {
    assert.equal(cmd, "powershell.exe");
    assert.ok(args.includes("-EncodedCommand") && args.includes("-NonInteractive"));
    const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    assert.match(script, /CredReadW/); assert.match(script, /CredWriteW/);
    const t = env.SC_CRED_TARGET;
    if (env.SC_CRED_OP === "set") {
      vault.set(t, Buffer.from(input, "base64").toString("utf8"));
      return {};
    }
    if (env.SC_CRED_OP === "get") return vault.has(t) ? { stdout: Buffer.from(vault.get(t), "utf8").toString("base64") } : { status: 3 };
    if (env.SC_CRED_OP === "del") return { status: vault.delete(t) ? 0 : 3 };
    if (env.SC_CRED_OP === "probe") return {};
  });
  const s = createStore({ env: {}, platform: "win32", run });
  assert.equal(s.name, "wincred");
  assert.equal(s.get("client_id"), null);
  s.set("client_id", SECRET);
  assert.equal(s.get("client_id"), SECRET);
  assert.ok(vault.has("soundcloud-mcp:client_id"), "nombre de la credencial: servicio:cuenta");
  noSecretInArgs(calls);
  assert.equal(s.del("client_id"), true); assert.equal(s.del("client_id"), false);
  assert.equal(s.probe().ok, true);
  const noPs = createStore({ env: {}, platform: "win32", run: () => ({ status: null, stdout: "", stderr: "", missing: true }) });
  assert.throws(() => noPs.get("x"), (e) => e instanceof SetupError && /PowerShell/.test(e.message));
}

// ---------- Fichero (de verdad, en una carpeta temporal) ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soundcrate-file-"));
  try {
    const file = path.join(dir, "sub", "credentials.json");
    const s = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: file }, platform: process.platform });
    assert.equal(s.name, "file"); assert.match(s.label, /Unencrypted file/);
    assert.match(s.probe().warning, /unencrypted/);
    assert.equal(s.get("refresh_token"), null);
    s.set("refresh_token", SECRET);
    s.set("client_id", "abc12345");
    assert.equal(s.get("refresh_token"), SECRET);
    s.set("refresh_token", "rotated123");
    assert.equal(s.get("refresh_token"), "rotated123", "la rotación sobrescribe");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { "soundcloud-mcp": { refresh_token: "rotated123", client_id: "abc12345" } });
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600, "permisos 600");
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, "carpeta 700");
    }
    // Otro servicio en el mismo fichero no se mezcla.
    const other = createStore({ env: { SC_SECRET_STORE: "file", SC_SECRETS_FILE: file, SC_SECRET_SERVICE: "otra" }, platform: process.platform });
    assert.equal(other.get("client_id"), null);
    assert.equal(s.del("client_id"), true); assert.equal(s.get("client_id"), null);
    assert.equal(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp")).length, 0, "sin temporales");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(defaultFilePath({ XDG_CONFIG_HOME: "/x" }, "linux"), /^\/x[\\/]soundcrate[\\/]credentials\.json$/);
  assert.match(defaultFilePath({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32"), /AppData.Roaming.soundcrate.credentials\.json$/);
}
console.log("OK");
