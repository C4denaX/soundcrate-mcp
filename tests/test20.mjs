// test20 · Guard de red (tests/_noNetwork.mjs): huecos que señaló el informe de la ronda 4 (lote F) y quedaron
// cerrados: new net.Socket().connect, dgram, dns y la forma hexadecimal de IPv4-mapped ([::ffff:127.0.0.1], que
// URL normaliza a [::ffff:7f00:1]). Ronda 5: el caso de dgram exige el error propio de dgram (antes lo tapaba el
// parche de dns) y se comprueba que escuchar en 0.0.0.0 no es un falso positivo. Sin red real: los destinos
// "externos" de aquí son 192.0.2.1 (TEST-NET-1, no enrutable) y peticiones que el propio guard corta antes de abrir
// socket; 0.0.0.0 es una dirección sin especificar y solo se usa para escuchar.
import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns";
import { spawnSync } from "node:child_process";
import * as guard from "./_noNetwork.mjs";

// ---------- Positivos: el guard no debe tocar nada local (un bloqueo aquí hace fallar la suite al salir) ----------
{
  let rejected = null;
  try { await fetch("http://127.0.0.1:1/"); } catch (e) { rejected = e; }
  assert.ok(rejected && !/BLOQUEADA/.test(rejected.message), "fetch 127.0.0.1 permitido (falla la conexión, no el guard)");
  try { await fetch("http://[::ffff:127.0.0.1]:1/"); } catch (e) { rejected = e; }
  assert.ok(rejected && !/BLOQUEADA/.test(rejected.message), "fetch [::ffff:127.0.0.1] (forma hex de URL) permitido");
  await new Promise((res) => {
    const c = net.connect(1, "localhost");
    c.on("error", () => {});
    c.on("close", res);
    setTimeout(res, 300);
  });
  const local = await new Promise((res) => dns.lookup("localhost", (e, a) => res(e ? null : a)));
  assert.ok(local, "dns.lookup('localhost') funciona");
  // Escuchar en 0.0.0.0 es un bind local, no una salida a la red: el guard lo bloqueaba al parchear dns.lookup
  // dentro de server.listen. Falso positivo que ninguna prueba del repo usaba, pero que rompería un listen normal.
  const srv = net.createServer();
  await new Promise((res, rej) => { srv.once("error", rej); srv.listen(0, "0.0.0.0", () => srv.close(res)); });
  // Herencia: un hijo hereda el guard por NODE_OPTIONS y net.connect externo muere bloqueado (192.0.2.1 es
  // TEST-NET-1: aunque el guard fallara, no habría tráfico real). Pasa igual en 1.7.0: es red de regresión.
  // require, y no import(): las exportaciones nombradas del namespace ESM no reflejan el parche del guard; el
  // objeto CJS (default) sí. El guard fuerza exitCode=1 al salir, aunque el hijo llame a process.exit(7).
  const child = spawnSync(process.execPath, [
    "-e",
    "const net = require('node:net'); try { net.connect(1, '192.0.2.1'); process.exit(0); } catch (e) { process.exit(7); }",
  ], { encoding: "utf8" });
  assert.equal(child.status, 1, `el hijo hereda el guard y bloquea net.connect externo: rc=${child.status}`);
  assert.match(child.stderr, /bloqueada/i, "el hijo explica el bloqueo");
}

// ---------- Intencionales: estos SÍ deben bloquearse; se borran del registro para no fallar la suite al salir ----------
{
  const s = new net.Socket();
  s.on("error", () => {});
  let e1 = null;
  try { s.connect(443, "192.0.2.1"); } catch (e) { e1 = e; }
  assert.match(e1?.message ?? "", /BLOQUEADA/, "new net.Socket().connect a un destino no local debe bloquearse");
  s.destroy();

  // El mensaje debe ser el de dgram, no el de dns.lookup: si quitamos el parche de dgram, este caso debe fallar.
  const u = dgram.createSocket("udp4");
  let e2 = null;
  try { u.send(Buffer.from("x"), 1, "192.0.2.1"); } catch (e) { e2 = e; }
  assert.match(e2?.message ?? "", /dgram\.send/, "dgram.send a un destino no local debe bloquearse con su propio error");
  try { u.close(); } catch {}

  const lookup = (h) => new Promise((res, rej) => {
    try { dns.lookup(h, (e, a) => (e ? rej(e) : res(a))); } catch (e) { rej(e); }
  });
  await assert.rejects(lookup("192.0.2.1"), /BLOQUEADA/, "dns.lookup a un destino no local debe bloquearse");
  await assert.rejects(Promise.resolve().then(() => dns.promises.lookup("192.0.2.1")), /BLOQUEADA/, "dns.promises.lookup a un destino no local debe bloquearse");

  guard.noNetworkReset?.(); // el guard antiguo (1.7.0) no exporta nada: los bloqueos intencionales no pasaban de aquí
}
console.log("test20 OK");
