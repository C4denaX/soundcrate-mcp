// Ficheros de distribución: extensión de Claude Desktop (manifest.json), plugin de Claude (plugin.json,
// marketplace.json, .mcp.json, skill) y paquete npm. Comprueba que no se desincronicen del servidor y los
// requisitos del directorio de Anthropic que se pueden verificar sin red.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// En Windows, git puede convertir los saltos de línea a CRLF al descargar el repo.
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const json = (f) => JSON.parse(read(f));
const pkg = json("package.json");
const manifest = json("manifest.json");
const plugin = json(".claude-plugin/plugin.json");
const market = json(".claude-plugin/marketplace.json");
const mcp = json(".mcp.json");
process.env.SC_GO_PLUS = "";
const S = await import("../server.mjs");
const tools = S.listTools();

// 1. Una sola versión en todas partes.
for (const [name, v] of [["manifest.json", manifest.version], ["plugin.json", plugin.version], ["server", S.VERSION]]) {
  assert.equal(v, pkg.version, `${name} tiene la versión ${v} y package.json ${pkg.version}`);
}

// 2. La extensión lista exactamente las herramientas del servidor.
assert.deepEqual(manifest.tools.map((t) => t.name), tools.map((t) => t.name), "manifest.json: regenera la lista de herramientas");
for (const t of manifest.tools) assert.ok(t.description && t.description.length <= 160, `${t.name}: descripción corta`);
assert.equal(manifest.tools_generated, false);

// 3. Extensión: arranque, Go+ y metadatos que exige el formato.
assert.equal(manifest.manifest_version, "0.3");
assert.equal(manifest.server.type, "node");
assert.equal(manifest.server.entry_point, "server.mjs");
assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/server.mjs"]);
assert.equal(manifest.server.mcp_config.env.SC_GO_PLUS, "${user_config.go_plus}");
assert.equal(manifest.user_config.go_plus.type, "boolean");
assert.equal(manifest.user_config.go_plus.default, false);
assert.ok(manifest.privacy_policies?.[0]?.endsWith("/PRIVACY.md"), "política de privacidad (se conecta a SoundCloud)");
assert.deepEqual(manifest.compatibility.platforms, ["darwin", "win32"], "Claude Desktop existe para macOS y Windows");
assert.ok(fs.existsSync(path.join(ROOT, manifest.icon)));

// 4. El valor booleano que pone Claude Desktop ("true"/"false") se interpreta bien.
for (const [v, expected] of [["true", true], ["false", false], ["1", true], ["", false]]) {
  assert.equal(/^(1|true|yes|si|sí)$/i.test(v), expected, `SC_GO_PLUS=${v}`);
}

// 5. Plugin de Claude: nombre válido, servidor dentro del plugin y opción Go+ con valor por defecto
//    (Cowork ignora un servidor que referencia una opción sin valor por defecto).
assert.match(plugin.name, /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
assert.doesNotMatch(plugin.name, /^(claude|anthropic|official|plugin|mcp|test)$/);
assert.equal(plugin.license, "MIT");
for (const k of ["documentationUrl", "supportUrl", "privacyPolicyUrl"]) assert.match(plugin[k], /^https:\/\//, k);
assert.ok(fs.existsSync(path.join(ROOT, plugin.icon)));
const server = mcp.mcpServers.soundcrate;
assert.equal(server.command, "node");
assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/server.mjs"], "se lanza con node y un fichero del plugin, sin npx");
for (const ref of JSON.stringify(server).match(/\$\{user_config\.(\w+)\}/g) || []) {
  const key = ref.slice(14, -1);
  assert.ok(plugin.userConfig[key], `${key} declarado en userConfig`);
  assert.ok("default" in plugin.userConfig[key], `${key} con valor por defecto`);
}
assert.equal(market.name, "soundcrate");
assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["soundcrate", "./"]]);

// 6. Skill con front matter válido.
const skill = read("skills/soundcrate/SKILL.md");
const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert.ok(fm, "front matter");
assert.match(fm[1], /^name: soundcrate$/m);
assert.match(fm[1], /^description: .{40,}$/m);
for (const t of ["setup_status", "start_setup", "suggest_tracks", "update_playlist"]) assert.ok(skill.includes(t), `la skill menciona ${t}`);

// 7. Requisitos del directorio: README de 40+ palabras fuera de bloques de código, LICENSE, sin ficheros de
//    sistema, ficheros de texto < 256 KiB, sin lockfile junto a package.json y sin carpeta bin/.
const prose = read("README.md").replace(/```[\s\S]*?```/g, "");
assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40, "README de al menos 40 palabras");
assert.ok(fs.existsSync(path.join(ROOT, "LICENSE")));
assert.ok(!fs.existsSync(path.join(ROOT, "bin")), "una carpeta bin/ impide instalar el plugin en Cowork");
assert.ok(!fs.existsSync(path.join(ROOT, "package-lock.json")), "sin lockfile (el directorio lo retendría)");
const tracked = (dir) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if ([".git", "node_modules"].includes(e.name)) return [];
    return e.isDirectory() ? tracked(rel) : [rel];
  });
const ignored = new Set(read(".gitignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
for (const f of tracked(".")) {
  const base = path.basename(f);
  if (ignored.has(base) || /\.bak/.test(base) || base.endsWith(".mcpb")) continue;
  assert.ok(![".DS_Store", "Thumbs.db", "desktop.ini"].includes(base), `fichero de sistema: ${f}`);
  if (!/\.(png|jpe?g|gif|webp|svg|woff2?)$/i.test(f)) assert.ok(fs.statSync(path.join(ROOT, f)).size < 256 * 1024, `${f} supera 256 KiB`);
}
// 8. Icono: PNG de 512x512 con transparencia.
const png = fs.readFileSync(path.join(ROOT, "icon.png"));
assert.equal(png.subarray(1, 4).toString(), "PNG");
assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[25]], [512, 512, 6], "512x512 RGBA");

// 9. El paquete npm incluye lo necesario para npx.
for (const f of ["server.mjs", "lib.mjs", "secrets.mjs", "setup.mjs", "login.mjs"]) assert.ok(pkg.files.includes(f), `package.json files: ${f}`);
assert.equal(pkg.bin["soundcrate-mcp"], "server.mjs");
console.log("OK");
