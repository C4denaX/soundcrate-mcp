// Guard de red para las pruebas: ninguna prueba debe salir a internet. Se carga con
//   node --import ./tests/_noNetwork.mjs tests/testN.mjs
// (--import existe desde Node 18.18/19.0, así que npm test necesita al menos ese Node; el servidor en sí solo
// necesita Node >=18, por eso engines no cambia) y se propaga a los procesos hijos (server.mjs, login.mjs…)
// mediante NODE_OPTIONS, que heredan.
// Solo se permiten destinos locales: 127.0.0.1, localhost, ::1 (y *.localhost), su forma IPv4-mapped
// (::ffff:127.0.0.1, que URL normaliza a ::ffff:7f00:1) y las IP de las interfaces propias.
// 0.0.0.0 y :: son direcciones sin especificar: como DESTINO de una conexión saliente pueden acabar en loopback,
// pero también se enrutan de formas que no queremos permitir en las pruebas, así que se bloquean como cualquier
// otra. La única excepción es dns.lookup("0.0.0.0"/"::"), que usa server.listen para un bind local y no genera
// tráfico (resuelve un literal IP sin consultar DNS).
// Huecos teóricos conocidos, fuera de lo que cubren las pruebas actuales:
// - Procesos hijos que no son Node (curl, etc.): no quedan bloqueados; ninguna prueba lanza uno.
// - worker_threads: el guard parchea módulos del hilo principal. NODE_OPTIONS se hereda, pero no hay prueba de que
//   un Worker no use otra vía para salir a la red.
// - dns.Resolver: las instancias tienen sus propios métodos (resolve*, reverse…), que no pasan por los parches del
//   módulo dns.
// - dns.reverse y dns.lookupService: no se parchean; pueden salir a la red sin resolver un nombre de destino.
// - host "localhost" con una opción lookup propia: isLocal solo ve el nombre (localhost), no la IP que devuelve ese
//   lookup, así que una conexión a localhost con un lookup que resuelva a otra IP podría salir fuera.
import dns from "node:dns";
import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import tls from "node:tls";

const LOCAL = /^(127\.\d+\.\d+\.\d+|localhost|.*\.localhost|::1)$/i;
// Las direcciones sin especificar solo se admiten en dns.lookup (ver arriba), nunca como destino de una conexión.
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);
// Las IP de las interfaces propias también cuentan como locales (test11 comprueba que el puerto NO responde ahí).
const own = () => { try { return new Set(Object.values(os.networkInterfaces()).flat().map((i) => i.address)); } catch { return new Set(); } };
// IPv4-mapped en forma decimal (::ffff:127.0.0.1) o hexadecimal (::ffff:7f00:1): las dos son 127.x.x.x.
const mappedV4 = (h) => {
  const m = /^::ffff:(.+)$/i.exec(h);
  if (!m) return null;
  if (m[1].includes(".")) return m[1];
  const [a, b] = m[1].split(":").map((x) => parseInt(x, 16));
  return Number.isInteger(a) && Number.isInteger(b) ? `${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}` : null;
};
const isLocal = (h) => {
  h = String(h ?? "localhost").replace(/^\[|\]$/g, "");
  if (h === "" || LOCAL.test(h)) return true;
  const v4 = mappedV4(h);
  if (v4) return LOCAL.test(v4);
  return own().has(h);
};
// Un intento bloqueado se registra y hace fallar el proceso al salir aunque el código bajo prueba se trague el error
// (setup.mjs, por ejemplo, captura los fallos de /me): la prueba no puede "pasar" con una petición externa.
const violations = [];
process.on("exit", () => { if (violations.length) { console.error(`[noNetwork] ${violations.length} petición(es) externa(s) bloqueada(s): ${violations.join(", ")}`); process.exitCode = 1; } });
const blocked = (what, host) => { violations.push(host); return new Error(`[noNetwork] petición externa BLOQUEADA en las pruebas: ${what} -> ${host}. Pasa un fetchFn/stub falso o apunta a 127.0.0.1.`); };
// Para test20, que comprueba el propio guard y bloquea a propósito: borra lo registrado hasta ahora.
export const noNetworkReset = () => { violations.length = 0; };

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
const hostArg = (a) => {
  const o = a[0];
  // (port, host) | ({host|servername|path}) | (path de socket unix: local)
  return typeof o === "object" && o ? (o.host ?? o.servername ?? "localhost") : typeof o === "number" || /^\d+$/.test(String(o)) ? (typeof a[1] === "string" ? a[1] : "localhost") : "localhost";
};
for (const [mod, name] of [[net, "connect"], [net, "createConnection"], [tls, "connect"]]) {
  const orig = mod[name];
  mod[name] = function (...a) {
    if (!isLocal(hostArg(a))) throw blocked(`${name}`, hostArg(a));
    return orig.apply(this, a);
  };
}
// new net.Socket().connect(...) no pasa por net.connect: mismo filtro en el prototipo.
const sockConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const h = hostArg(a);
  if (!isLocal(h)) throw blocked("socket.connect", h);
  return sockConnect.apply(this, a);
};

// UDP (dgram): send(msg[, offset, length,] port[, address][, cb]); sin address el destino es localhost.
// connect(port[, address][, cb]) también se vigila: dgram.connect resuelve la dirección con el lookup del socket, y ese
// lookup deja pasar "0.0.0.0"/"::" (lo necesita bind), de modo que un connect a una dirección sin especificar seguido
// de send() ya no pasaba por el filtro de send (la dirección explícita no existe). Dos controles:
//  1) dgram.Socket.prototype.connect: isLocal sobre la dirección ANTES de resolverla (error propio "dgram.connect",
//     síncrono) y registro de la dirección como destino pendiente. El parche va en el prototipo (connect y send), así
//     que cubre también new dgram.Socket(...);
//  2) el lookup del socket (el propio de dgram.createSocket({lookup}) o dns.lookup, envuelto siempre): si es la
//     resolución del destino de un connect pendiente, se comprueba la IP RESULTANTE con isLocal y, si no es local,
//     se devuelve error al lookup, así que dgram nunca llega a conectar y send() no puede enviar nada. Es más robusto
//     que mirar remoteAddress() en el evento 'connect' (para entonces el socket ya está conectado) y cubre un
//     "localhost" o nombre que un lookup propio resuelva a otra IP. El bind (que usa el mismo lookup con 0.0.0.0/::)
//     no se toca: solo se inspecciona la resolución cuya dirección coincide con el destino de un connect pendiente.
//  3) Red de seguridad en send: si el socket ya está conectado, remoteAddress() también debe ser local.
// Falta: con new dgram.Socket directo y un lookup propio, solo se comprueba el nombre, no la IP resultante (el
// envoltorio del lookup solo se instala en dgram.createSocket); lo único que lo frena es el control 3 en send(), una
// vez conectado.
const connecting = new WeakMap(); // socket -> Set de destinos de connect pendientes de resolver
const createSocket = dgram.createSocket;
dgram.createSocket = function (opts, ...rest) {
  const o = typeof opts === "string" ? { type: opts } : { ...opts };
  let s;
  const userLookup = o.lookup;
  o.lookup = function (addr, family, cb) {
    const base = userLookup ?? dns.lookup;
    const pending = s && connecting.get(s);
    if (!pending || !pending.has(addr)) return base.call(this, addr, family, cb);
    return base.call(this, addr, family, function (err, ip, ...more) {
      if (!err && !isLocal(ip)) {
        pending.delete(addr);
        return cb.call(this, blocked("dgram.connect (resuelto)", `${addr} -> ${ip}`));
      }
      return cb.call(this, err, ip, ...more);
    });
  };
  s = createSocket.call(this, o, ...rest);
  return s;
};
const dgSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (msg, ...rest) {
  const cand = rest.length >= 4 ? rest[3] : rest[1];
  if (typeof cand === "string" && !isLocal(cand)) throw blocked("dgram.send", cand);
  let remote = null;
  try { remote = this.remoteAddress().address; } catch {} // sin conectar: lanza ERR_SOCKET_DGRAM_NOT_CONNECTED
  if (remote !== null && !isLocal(remote)) throw blocked("dgram.send (conectado)", remote);
  return dgSend.call(this, msg, ...rest);
};
const dgConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function (port, address, ...more) {
  const addr = typeof address === "string" ? address : undefined; // sin address: localhost
  if (addr !== undefined && !isLocal(addr)) throw blocked("dgram.connect", addr);
  if (addr !== undefined) { const p = connecting.get(this) ?? new Set(); p.add(addr); connecting.set(this, p); }
  return dgConnect.call(this, port, address, ...more);
};

// DNS: resolver un nombre externo también es salir a la red (y delata el destino aunque luego se bloquee la conexión).
const guardDns = (orig, name) => function (host, ...rest) {
  // server.listen(port, "0.0.0.0" | "::") resuelve el literal por dns.lookup: no hay tráfico y es un bind local.
  const literal = String(host ?? "").replace(/^\[|\]$/g, "");
  if (name === "lookup" && UNSPECIFIED.has(literal)) return orig.call(this, host, ...rest);
  if (!isLocal(host)) throw blocked(`dns.${name}`, host);
  return orig.call(this, host, ...rest);
};
for (const k of ["lookup", ...Object.keys(dns).filter((k) => k.startsWith("resolve"))]) {
  if (typeof dns[k] === "function") dns[k] = guardDns(dns[k], k);
}
for (const k of ["lookup", ...Object.keys(dns.promises).filter((k) => k.startsWith("resolve"))]) {
  if (typeof dns.promises[k] === "function") dns.promises[k] = guardDns(dns.promises[k], k);
}

// Herencia en hijos: NODE_OPTIONS lleva el mismo --import (URL file:// absoluta, sin espacios: %20).
const self = import.meta.url;
const opt = `--import ${self}`;
const cur = process.env.NODE_OPTIONS ?? "";
if (!cur.includes(self)) process.env.NODE_OPTIONS = `${cur} ${opt}`.trim();
