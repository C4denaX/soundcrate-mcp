// Lote P ronda 2: #21 (plazo y aviso en la página), #20 (salida sin clave en /callback), T4 (login: causa real).
// Cada caso corre aunque falle otro; al final se lista cuáles fallan.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { startSetup } = await import(new URL("../setup.mjs", import.meta.url));

const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
async function boot(extra = {}) {
  const port = await freePort();
  const m = new Map([["client_id", "abcdefgh123"], ["client_secret", "secret-12345"]]);
  const store = { label: "mem", get: (a) => m.get(a) ?? null, set: (a, v) => m.set(a, v), del: (a) => m.delete(a), probe: () => ({ ok: true }) };
  const s = await startSetup({ store, credentials: () => ({ clientId: m.get("client_id"), clientSecret: m.get("client_secret") }), redirectUri: `http://127.0.0.1:${port}/callback`, open: false, ...extra });
  return { s, port, base: `http://127.0.0.1:${port}`, k: new URL(s.url).searchParams.get("k") };
}
const txt = (h) => h.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("#21 plazo por defecto 60 min: la caducidad informa idle_minutes", async () => {
  const t = await boot({ timeoutMs: 300 });
  const r = await t.s.done;
  assert.equal(r.ok, false); assert.equal(r.reason, "timeout"); assert.equal(typeof r.idle_minutes, "number");
  assert.ok(r.idle_minutes >= 1);
});
test("#21 la página dice hasta cuándo sigue abierta (en y es) y no usa JS ni refresco", async () => {
  const t = await boot();
  try {
    const r = await fetch(`${t.base}/setup?k=${t.k}`);
    const h = await r.text();
    assert.match(txt(h), /This page stays open until \d{1,2}[:.]\d{2}.*; any step you take here extends it\./);
    assert.doesNotMatch(h, /<script|http-equiv/i);
    const es = await (await fetch(`${t.base}/setup?k=${t.k}`, { headers: { "accept-language": "es" } })).text();
    assert.match(txt(es), /sigue abierta hasta las/);
  } finally { t.s.close(); await t.s.done; }
});
const norm = (x) => x.replace(/\s+/g, " "); // \s incluye U+202F y U+00A0 (Node 18.13-22 con en-US usan U+202F antes de AM/PM)
async function check60() {
  const t = await boot();
  try {
    const h = txt(await (await fetch(`${t.base}/setup?k=${t.k}`)).text());
    const f = (min) => norm(new Date(Date.now() + min * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    const exp = f(60), exp2 = f(61);
    assert.ok(h.includes(exp) || h.includes(exp2), `esperaba ${exp} en: ${h.slice(0, 300)}`);
  } finally { t.s.close(); await t.s.done; }
}
test("#21 el plazo por defecto es de 60 minutos (la hora mostrada ~ ahora+60)", check60);
test("#21 idem con toLocaleTimeString que usa U+202F / U+00A0 (Node 18-22 en-US)", async () => {
  const orig = Date.prototype.toLocaleTimeString;
  for (const sp of ["\u202f", "\u00a0"]) {
    Date.prototype.toLocaleTimeString = function () { return `11:58${sp}AM`; };
    try { await check60(); } finally { Date.prototype.toLocaleTimeString = orig; }
  }
});
test("#20 /callback con error: ofrece salida sin la clave (en y es)", async () => {
  const t = await boot();
  try {
    for (const [lang, re] of [["en", /Go back to the setup tab and try step 3 again/], ["es", /Vuelve a la pestaña de configuración y repite el paso 3/]]) {
      const r = await fetch(`${t.base}/callback?error=access_denied`, { headers: { "accept-language": lang } });
      const h = await r.text();
      assert.match(txt(h), re);
      assert.ok(!h.includes(t.k), "la clave no debe aparecer");
    }
  } finally { t.s.close(); await t.s.done; }
});
test("#20 /callback con state inválido también da salida sin clave", async () => {
  const t = await boot();
  try {
    const h = await (await fetch(`${t.base}/callback?code=C&state=zzz`)).text();
    assert.match(txt(h), /try step 3 again/); assert.ok(!h.includes(t.k));
  } finally { t.s.close(); await t.s.done; }
});
test("T4 canje fallido: /callback muestra la causa y un reintento no dice state inválido", async () => {
  const t = await boot({ tokenRequest: async () => { throw new Error("oauth/token 503 temporary"); } });
  try {
    const loc = (await fetch(`${t.base}/setup/connect?k=${t.k}`, { redirect: "manual" })).headers.get("location");
    const st = new URL(loc).searchParams.get("state");
    const h = txt(await (await fetch(`${t.base}/callback?code=C&state=${st}`)).text());
    assert.match(h, /503 temporary/); assert.match(h, /try step 3 again/);
    await assert.rejects(t.s.completeFromUrl(`${t.base}/callback?code=C&state=${st}`), (e) => e.message !== "state" && /503 temporary/.test(e.message));
    await assert.rejects(t.s.completeFromUrl(`${t.base}/callback?code=C&state=otro`), (e) => e.message === "state");
  } finally { t.s.close(); await t.s.done; }
});
test("T4 login.mjs: tras un fallo del canje, el mensaje da la causa real y cómo reintentar", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { startSetup } from ${JSON.stringify(new URL("../setup.mjs", import.meta.url).href)};
    const m = new Map([["client_id","abcdefgh123"],["client_secret","secret-12345"]]);
    const store = { label:"mem", get:a=>m.get(a)??null, set:(a,v)=>m.set(a,v), del:a=>m.delete(a), probe:()=>({ok:true}) };
    const s = await startSetup({ store, credentials:()=>({clientId:m.get("client_id"),clientSecret:m.get("client_secret")}), tokenRequest: async()=>{throw new Error("oauth/token 503 temporary")}, redirectUri:"http://127.0.0.1:${port}/callback", open:false });
    const k = new URL(s.url).searchParams.get("k");
    const loc = (await fetch("http://127.0.0.1:${port}/setup/connect?k="+k,{redirect:"manual"})).headers.get("location");
    const st = new URL(loc).searchParams.get("state");
    for (const u of ["http://127.0.0.1:${port}/callback?code=C&state="+st, "http://127.0.0.1:${port}/callback?code=C&state="+st, "http://127.0.0.1:${port}/callback?code=C&state=bad"]) {
      try { await s.completeFromUrl(u); } catch (e) { console.log("ERR " + e.message); }
    }
    s.close();
  `], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  await new Promise((r) => child.on("close", r));
  const lines = out.split("\n").filter((l) => l.startsWith("ERR "));
  assert.equal(lines.length, 3, out);
  assert.match(lines[0], /503 temporary/); assert.match(lines[1], /503 temporary/); assert.equal(lines[2], "ERR state");
  // y el texto de login.mjs
  const src = (await import("node:fs")).readFileSync(path.join(root, "login.mjs"), "utf8");
  assert.match(src, /does not match this session/); assert.match(src, /To retry: connect again from step 3/);
});

const failed = [];
for (const [name, fn] of cases) {
  try { await fn(); console.log("ok   ", name); } catch (e) { failed.push(name); console.log("FAIL ", name, "\n     ", String(e.message).split("\n")[0]); }
}
console.log(failed.length ? `\n${failed.length} casos fallan` : "\ntest15 OK");
process.exit(failed.length ? 1 : 0);
