// Guard de red para las pruebas: ninguna prueba debe salir a internet. Se carga con
//   node --import ./tests/_noNetwork.mjs tests/testN.mjs
// y se propaga a los procesos hijos (server.mjs, login.mjs…) mediante NODE_OPTIONS, que heredan.
// Solo se permiten destinos locales: 127.0.0.1, localhost, ::1 (y *.localhost).
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import tls from "node:tls";

const LOCAL = /^(127\.\d+\.\d+\.\d+|localhost|.*\.localhost|::1|::ffff:127\.\d+\.\d+\.\d+)$/i;
// Las IP de las interfaces propias también cuentan como locales (test11 comprueba que el puerto NO responde ahí).
const own = () => { try { return new Set(Object.values(os.networkInterfaces()).flat().map((i) => i.address)); } catch { return new Set(); } };
const isLocal = (h) => { h = String(h ?? "localhost").replace(/^\[|\]$/g, ""); return h === "" || LOCAL.test(h) || own().has(h); };
// Un intento bloqueado se registra y hace fallar el proceso al salir aunque el código bajo prueba se trague el error
// (setup.mjs, por ejemplo, captura los fallos de /me): la prueba no puede "pasar" con una petición externa.
const violations = [];
process.on("exit", () => { if (violations.length) { console.error(`[noNetwork] ${violations.length} petición(es) externa(s) bloqueada(s): ${violations.join(", ")}`); process.exitCode = 1; } });
const blocked = (what, host) => { violations.push(host); return new Error(`[noNetwork] petición externa BLOQUEADA en las pruebas: ${what} -> ${host}. Pasa un fetchFn/stub falso o apunta a 127.0.0.1.`); };

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  let host;
  try { host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname; }
  catch { return realFetch(input, init); } // URL inválida: que falle fetch con su propio error
  if (!isLocal(host)) return Promise.reject(blocked("fetch", host));
  return realFetch(input, init);
};

const hostOf = (a) => {
  const [o, p] = a;
  if (typeof o === "string") { try { return new URL(o).hostname; } catch { return isLocal(o) ? "localhost" : o; } }
  if (o instanceof URL) return o.hostname;
  if (o && typeof o === "object") return o.hostname ?? o.host?.replace(/:\d+$/, "") ?? "localhost";
  return "localhost";
};
for (const [mod, name] of [[http, "request"], [http, "get"], [https, "request"], [https, "get"]]) {
  const orig = mod[name];
  mod[name] = function (...a) { const h = hostOf(a); if (!isLocal(h)) throw blocked(`${mod === http ? "http" : "https"}.${name}`, h); return orig.apply(this, a); };
}
for (const [mod, name] of [[net, "connect"], [net, "createConnection"], [tls, "connect"]]) {
  const orig = mod[name];
  mod[name] = function (...a) {
    const o = a[0];
    // net.connect(port, host) | net.connect({host}) | net.connect(path) (socket unix: local)
    const h = typeof o === "object" && o ? (o.host ?? o.servername ?? "localhost") : typeof o === "number" || /^\d+$/.test(String(o)) ? (typeof a[1] === "string" ? a[1] : "localhost") : "localhost";
    if (!isLocal(h)) throw blocked(`${name}`, h);
    return orig.apply(this, a);
  };
}

// Herencia en hijos: NODE_OPTIONS lleva el mismo --import (URL file:// absoluta, sin espacios: %20).
const self = import.meta.url;
const opt = `--import ${self}`;
const cur = process.env.NODE_OPTIONS ?? "";
if (!cur.includes(self)) process.env.NODE_OPTIONS = `${cur} ${opt}`.trim();
