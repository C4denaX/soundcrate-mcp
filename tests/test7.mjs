// Conformidad MCP con un proceso real por stdio, como lo lanzaría cualquier cliente (Claude, OpenCode, Cursor,
// VS Code, Codex, Gemini CLI…). No usa la red ni el Llavero: solo mensajes de protocolo y validaciones locales.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server.mjs");
const PKG_VERSION = JSON.parse(await (await import("node:fs/promises")).readFile(join(ROOT, "package.json"), "utf8")).version;

// Lanza el servidor y devuelve un cliente mínimo: send(), request() y close().
function start(entry, env = {}) {
  const child = spawn(process.execPath, [entry], { env: { ...process.env, SC_GO_PLUS: "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", stderr = "";
  const lines = [];
  const waiters = [];
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      let msg;
      assert.doesNotThrow(() => (msg = JSON.parse(line)), `stdout solo lleva JSON: ${line}`);
      for (const w of [...waiters]) if (w.match(msg)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(msg);
    }
  });
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  // Si el servidor no contesta, la prueba falla con un mensaje claro (y no se queda colgada).
  const waitFor = (match, ms = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("sin respuesta a tiempo: el servidor no contestó"));
      }, ms);
      waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  let nextId = 1;
  return {
    send: (obj) => child.stdin.write((typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n"),
    request(method, params) {
      const id = nextId++;
      const p = waitFor((m) => m.id === id);
      this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
      return p;
    },
    waitFor,
    lines,
    stderr: () => stderr,
    close: () => (child.stdin.end(), exited),
  };
}

// ---------- 1. Cliente "legacy" (initialize), el que usan hoy Claude, OpenCode, Cursor… ----------
{
  const c = start(SERVER, { SC_GO_PLUS: "1" });
  let r = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(r.result.protocolVersion, "2025-06-18", "acepta la versión del cliente si la soporta");
  assert.deepEqual(r.result.serverInfo, { name: "soundcrate", title: "SoundCrate", version: PKG_VERSION });
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.match(r.result.instructions, /has declared Go\+/);
  assert.equal(r.result.resultType, undefined, "en legacy no se añaden campos modernos");
  c.send({ jsonrpc: "2.0", method: "notifications/initialized" }); // sin respuesta

  r = await c.request("ping");
  assert.deepEqual(r.result, {});

  r = await c.request("tools/list");
  const tools = r.result.tools;
  assert.equal(tools.length, 21);
  // Esquemas aceptables para los proveedores más estrictos (OpenAI, Gemini).
  const TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/, t.name);
    assert.ok(t.title && t.annotations && typeof t.annotations.readOnlyHint === "boolean", `${t.name}: título y anotaciones`);
    assert.ok(t.description.length > 20 && t.description.length <= 1024, `${t.name}: descripción de 1 a 1024 caracteres`);
    assert.doesNotMatch(t.description, /[áéíóúñ¿¡]/, `${t.name}: descripción en inglés`);
    const s = t.inputSchema;
    assert.equal(s.type, "object", t.name);
    assert.equal(typeof s.properties, "object", t.name);
    assert.doesNotMatch(JSON.stringify(s), /"\$ref"|"oneOf"|"anyOf"|"allOf"|"\$schema"/, `${t.name}: sin construcciones que Gemini rechaza`);
    for (const [k, v] of Object.entries(s.properties)) {
      assert.ok(TYPES.has(v.type), `${t.name}.${k}: tipo válido`);
      if (v.type === "array") assert.ok(v.items && TYPES.has(v.items.type), `${t.name}.${k}: array con items`);
      if (v.enum) assert.ok(v.enum.every((e) => typeof e === "string"), `${t.name}.${k}: enum de cadenas`);
      if (v.description) assert.doesNotMatch(v.description, /[áéíóúñ¿¡]/, `${t.name}.${k}: en inglés`);
    }
    for (const req of s.required || []) assert.ok(req in s.properties, `${t.name}: required ${req} existe`);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.search_tracks.annotations.readOnlyHint, true);
  assert.equal(byName.update_playlist.annotations.destructiveHint, true);
  assert.equal(byName.add_tracks_to_playlist.annotations.destructiveHint, false);
  assert.match(byName.search_tracks.description, /has declared Go\+/, "el estado de Go+ va también en la descripción");

  // Error de una herramienta: dentro del resultado (isError), sin red.
  r = await c.request("tools/call", { name: "get_track", arguments: {} });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /numeric track_id/);
  r = await c.request("tools/call", { name: "get_track", arguments: "no es un objeto" });
  assert.equal(r.result.isError, true, "argumentos no objeto se tratan como {}");
  r = await c.request("tools/call", { name: "nope", arguments: {} });
  assert.equal(r.error.code, -32602);

  // Robustez frente a clientes que piden cosas no anunciadas.
  assert.deepEqual((await c.request("resources/list")).result, { resources: [] });
  assert.deepEqual((await c.request("resources/templates/list")).result, { resourceTemplates: [] });
  assert.deepEqual((await c.request("prompts/list")).result, { prompts: [] });
  assert.equal((await c.request("no/such/method")).error.code, -32601);

  // Errores JSON-RPC.
  let p = c.waitFor((m) => m.id === null && m.error?.code === -32700);
  c.send("{esto no es json");
  assert.equal((await p).error.message, "Parse error");
  p = c.waitFor((m) => m.id === null && m.error?.code === -32600);
  c.send([{ jsonrpc: "2.0", id: 99, method: "ping" }]);
  await p;
  p = c.waitFor((m) => m.id === 7 && m.error?.code === -32600);
  c.send({ jsonrpc: "2.0", id: 7 });
  await p;

  // Al cerrar stdin el proceso termina solo.
  assert.equal(await c.close(), 0);
  assert.match(c.stderr(), /ready \(v[\d.]+, Go\+ declared\)/);
  console.log("legacy OK:", tools.length, "herramientas");
}

// Versión desconocida en initialize: responde con la última legacy que soporta.
{
  const c = start(SERVER);
  const r = await c.request("initialize", { protocolVersion: "2099-01-01", capabilities: {} });
  assert.equal(r.result.protocolVersion, "2025-11-25");
  assert.match(r.result.instructions, /has not declared Go\+/);
  await c.close();
}

// ---------- 2. Cliente "moderno" (2026-07-28): sin initialize, versión en _meta ----------
{
  const c = start(SERVER);
  const meta = (v = "2026-07-28") => ({ _meta: { "io.modelcontextprotocol/protocolVersion": v, "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" } } });
  let r = await c.request("server/discover", meta());
  assert.equal(r.result.resultType, "complete");
  assert.deepEqual(r.result.supportedVersions, ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  assert.deepEqual(r.result._meta["io.modelcontextprotocol/serverInfo"].name, "soundcrate");
  assert.ok(r.result.instructions && r.result.ttlMs > 0 && r.result.cacheScope);

  r = await c.request("tools/list", meta());
  assert.equal(r.result.resultType, "complete");
  assert.equal(r.result.tools.length, 21);
  assert.ok(r.result.ttlMs > 0); assert.equal(r.result.cacheScope, "private");
  assert.equal(r.result._meta["io.modelcontextprotocol/serverInfo"].version, PKG_VERSION);

  r = await c.request("tools/call", { name: "get_track", arguments: {}, ...meta() });
  assert.equal(r.result.resultType, "complete"); assert.equal(r.result.isError, true);

  r = await c.request("tools/list", meta("1900-01-01"));
  assert.equal(r.error.code, -32022);
  assert.deepEqual(r.error.data, { supported: ["2026-07-28"], requested: "1900-01-01" });
  await c.close();
  console.log("moderno OK");
}

// ---------- 3. Lanzado mediante un enlace, como hacen npx y los ejecutables de npm ----------
{
  const dir = mkdtempSync(join(tmpdir(), "soundcrate-bin-"));
  try {
    const link = join(dir, "soundcrate-mcp");
    symlinkSync(SERVER, link);
    const c = start(link);
    const r = await c.request("initialize", { protocolVersion: "2025-11-25", capabilities: {} });
    assert.equal(r.result.serverInfo.name, "soundcrate", "arranca aunque argv[1] sea un enlace");
    await c.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("enlace OK");
}
console.log("OK");
