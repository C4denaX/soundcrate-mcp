// Falla si alguna referencia de versión del repo no coincide con package.json (y con el tag, si se pasa).
// Uso: node .github/scripts/check-versions.mjs [vX.Y.Z]   (raíz del repo = carpeta actual, o SC_ROOT)
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.SC_ROOT || process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const expected = json("package.json").version;
const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(expected)) errors.push(`package.json: versión no válida ${JSON.stringify(expected)}`);

const tag = process.argv[2];
if (tag !== undefined) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) errors.push(`el tag ${JSON.stringify(tag)} no tiene la forma vX.Y.Z`);
  else if (tag.slice(1) !== expected) errors.push(`el tag ${tag} no coincide con package.json (${expected})`);
}

const check = (where, got) => {
  if (got !== expected) errors.push(`${where}: ${got} != ${expected}`);
};
check("manifest.json version", json("manifest.json").version);
check(".claude-plugin/plugin.json version", json(".claude-plugin/plugin.json").version);
const m = /export const VERSION = "([^"]+)"/.exec(read("server.mjs"));
if (!m) errors.push('server.mjs: no encuentro `export const VERSION = "..."`');
else check("server.mjs VERSION", m[1]);

// Referencias de instalación #vX.Y.Z (npx / VS Code, que las codifica como %2523v...) en todos los README*.
const readmes = fs.readdirSync(ROOT).filter((f) => /^README(\..+)?\.md$/i.test(f));
if (!readmes.length) errors.push("no hay README*.md");
for (const f of readmes) {
  const refs = [...read(f).matchAll(/soundcrate-mcp(?:#|%23|%2523)v(\d+\.\d+\.\d+)/g)];
  if (!refs.length) errors.push(`${f}: no encuentro ninguna referencia #vX.Y.Z (¿cambió el formato? actualiza este script)`);
  for (const r of refs) check(`${f} (${r[0]})`, r[1]);
}

if (errors.length) {
  console.error("Versiones desalineadas:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`OK: todas las referencias de versión son ${expected}` + (tag ? ` (tag ${tag})` : ""));
