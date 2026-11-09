// Falla si las herramientas de manifest.json no son las de server.mjs o si una descripción está cortada.
// Uso: node .github/scripts/check-manifest-tools.mjs   (raíz del repo = carpeta actual, o SC_ROOT)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.SC_ROOT || process.cwd();
// Almacén de secretos aislado: importar el servidor no debe tocar el llavero real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-manifest-"));
process.env.SC_SECRET_STORE = "file";
process.env.SC_SECRETS_FILE = path.join(tmp, "creds.json");
process.env.SC_SECRET_SERVICE = "soundcrate-ci";
process.env.SC_GO_PLUS = "";

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const S = await import(pathToFileURL(path.join(ROOT, "server.mjs")).href);
const server = S.listTools();
const errors = [];
const mn = manifest.tools.map((t) => t.name), sn = server.map((t) => t.name);
for (const n of mn) if (!sn.includes(n)) errors.push(`solo en manifest.json: ${n}`);
for (const n of sn) if (!mn.includes(n)) errors.push(`solo en server.mjs: ${n}`);
if (!errors.length && mn.join() !== sn.join()) errors.push("el orden de las herramientas difiere entre manifest.json y server.mjs");
for (const t of manifest.tools) {
  const d = t.description || "";
  if (!d.trim()) errors.push(`${t.name}: descripción vacía`);
  else if (d.length > 160) errors.push(`${t.name}: descripción de ${d.length} caracteres (máximo 160)`);
  else if (/…$|\.\.\.$|\be\.g\.$|\bi\.e\.$/.test(d) || !/[.)!?]$/.test(d)) errors.push(`${t.name}: descripción cortada: ${JSON.stringify(d)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
if (errors.length) {
  console.error("manifest.json no está sincronizado con server.mjs:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`OK: ${mn.length} herramientas, descripciones completas`);
