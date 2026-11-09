// Lote P3 (ronda 3): hora HH:MM en es, complete() sin credenciales, /callback repetido, state inválido.
import assert from "node:assert/strict";
import http from "node:http";
const { startSetup } = await import(new URL("../setup.mjs", import.meta.url));

const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
async function boot(extra = {}) {
  const port = await freePort();
  const m = new Map([["client_id", "abcdefgh123"], ["client_secret", "secret-12345"]]);
  const store = { label: "mem", get: (a) => m.get(a) ?? null, set: (a, v) => m.set(a, v), del: (a) => m.delete(a), probe: () => ({ ok: true }) };
  const s = await startSetup({ store, credentials: () => ({ clientId: m.get("client_id"), clientSecret: m.get("client_secret") }), redirectUri: `http://127.0.0.1:${port}/callback`, open: false, ...extra });
  return { s, m, base: `http://127.0.0.1:${port}`, k: new URL(s.url).searchParams.get("k") };
}
const txt = (h) => h.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const connect = async (t) => new URL((await fetch(`${t.base}/setup/connect?k=${t.k}`, { redirect: "manual" })).headers.get("location")).searchParams.get("state");
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("hora: la página en español usa HH:MM de 24 h, sin AM/PM", async () => {
  const orig = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleTimeString = function () { return "12:17 PM"; };
  const t = await boot();
  try {
    for (const lang of ["es", "en"]) {
      const h = txt(await (await fetch(`${t.base}/setup?k=${t.k}`, { headers: { "accept-language": lang } })).text());
      assert.match(h, /(hasta las|until) \d{2}:\d{2}(;|\.| )/, h.slice(0, 200));
      assert.doesNotMatch(h, /\b(AM|PM)\b/);
    }
  } finally { Date.prototype.toLocaleTimeString = orig; t.s.close(); await t.s.done; }
});

test("complete: sin credenciales da la causa real, no es canje fallido y el state sigue vigente", async () => {
  let creds = null, calls = 0;
  const t = await boot({
    credentials: () => { if (!creds) throw new Error("SoundCrate is not set up yet: the SoundCloud app credentials are missing."); return creds; },
    tokenRequest: async () => { calls++; return { refresh_token: "r" }; },
  });
  try {
    creds = { clientId: "abcdefgh123", clientSecret: "secret-12345" };
    const st = await connect(t);
    creds = null;
    const url = `${t.base}/callback?code=C&state=${st}`;
    await assert.rejects(t.s.completeFromUrl(url), (e) => /not set up yet/.test(e.message) && !/exchange with SoundCloud failed/.test(e.message));
    const h = txt(await (await fetch(url)).text());
    assert.match(h, /not set up yet/); assert.doesNotMatch(h, /exchange (with SoundCloud )?failed|already failed/);
    assert.equal(calls, 0);
    creds = { clientId: "abcdefgh123", clientSecret: "secret-12345" };
    await t.s.completeFromUrl(url); // el state no se consumió: con credenciales el canje sale
    assert.equal(calls, 1);
  } finally { t.s.close(); await t.s.done; }
});

test("callback repetido: la repetición HTTP solo da el estado HTTP; la primera y completeFromUrl dan el detalle", async () => {
  const secretBody = "SECRET-BODY-DETAIL-xyz";
  const t = await boot({ tokenRequest: async () => { throw new Error(`SoundCloud /oauth/token 503: ${secretBody}`); } });
  try {
    const st = await connect(t);
    const url = `${t.base}/callback?code=C&state=${st}`;
    const first = txt(await (await fetch(url)).text());
    assert.match(first, new RegExp(secretBody));
    const again = txt(await (await fetch(url)).text());
    assert.doesNotMatch(again, new RegExp(secretBody));
    assert.match(again, /already failed \(HTTP 503\)/); assert.match(again, /try step 3 again/);
    await assert.rejects(t.s.completeFromUrl(url), (e) => e.message.includes(secretBody));
    // sin código de estado: texto genérico
  } finally { t.s.close(); await t.s.done; }
  const t2 = await boot({ tokenRequest: async () => { throw new Error("network down"); } });
  try {
    const st = await connect(t2);
    const url = `${t2.base}/callback?code=C&state=${st}`;
    await fetch(url);
    const again = txt(await (await fetch(url)).text());
    assert.match(again, /the exchange already failed; connect again from step 3/); assert.doesNotMatch(again, /network down/);
  } finally { t2.s.close(); await t2.s.done; }
});

test("state inválido en /callback: una sola indicación (no badLink + cbHint), en y es", async () => {
  const t = await boot();
  try {
    for (const lang of ["en", "es"]) {
      const h = txt(await (await fetch(`${t.base}/callback?code=C&state=zzz`, { headers: { "accept-language": lang } })).text());
      assert.doesNotMatch(h, /empiece de nuevo|start the setup again|Ask your assistant to start|pide al asistente que empiece/i, h);
      assert.match(h, lang === "es" ? /repite el paso 3/ : /try step 3 again/);
      assert.ok(!h.includes(t.k));
    }
    const e = await fetch(`${t.base}/callback?error=access_denied`).then((r) => r.text());
    assert.match(txt(e), /access_denied/);
  } finally { t.s.close(); await t.s.done; }
});

test("callback repetido: mensajes con números de 3 cifras que no son estado HTTP dan el texto genérico", async () => {
  for (const msg of ["connect ETIMEDOUT 104.18.1.1:443", "Unexpected token '<' ... at position 120"]) {
    const t = await boot({ tokenRequest: async () => { throw new Error(msg); } });
    try {
      const url = `${t.base}/callback?code=C&state=${await connect(t)}`;
      await fetch(url);
      const again = txt(await (await fetch(url)).text());
      assert.match(again, /the exchange already failed; connect again from step 3/, again);
      assert.doesNotMatch(again, /HTTP \d/);
    } finally { t.s.close(); await t.s.done; }
  }
});

test("callback sin credenciales: la pista manda al paso 2 (en y es), sin la clave", async () => {
  let creds = { clientId: "abcdefgh123", clientSecret: "secret-12345" };
  const t = await boot({ credentials: () => { if (!creds) throw new Error("SoundCrate is not set up yet: the app credentials are missing."); return creds; } });
  try {
    const st = await connect(t);
    creds = null;
    for (const [lang, re] of [["en", /complete step 2/], ["es", /completa el paso 2/]]) {
      const h = await (await fetch(`${t.base}/callback?code=C&state=${st}`, { headers: { "accept-language": lang } })).text();
      assert.match(txt(h), /not set up yet/); assert.match(txt(h), re);
      assert.doesNotMatch(txt(h), /try step 3 again|repite el paso 3/); assert.ok(!h.includes(t.k));
    }
  } finally { t.s.close(); await t.s.done; }
});

const failed = [];
for (const [name, fn] of cases) {
  try { await fn(); console.log("ok   ", name); } catch (e) { failed.push(name); console.log("FAIL ", name, "\n     ", String(e.message).split("\n")[0]); }
}
console.log(failed.length ? `\n${failed.length} casos fallan` : "\ntest17 OK");
process.exit(failed.length ? 1 : 0);
