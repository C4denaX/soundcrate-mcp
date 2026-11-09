// Página local de configuración: el usuario escribe aquí el Client ID y el Client Secret de su app de SoundCloud
// y conecta su cuenta. Los secretos van del navegador al almacén del sistema sin pasar por el chat ni por el modelo.
//
// Seguridad: solo escucha en 127.0.0.1 (el host de la Redirect URI), exige una clave aleatoria de un solo uso en
// cada petición (contra CSRF desde otras webs), comprueba Host (contra DNS rebinding) y Origin, usa PKCE + state
// en OAuth y sirve las páginas con CSP estricta y sin Referer (la clave no sale hacia soundcloud.com).
//
// CSRF en el POST de credenciales: la defensa real es la clave aleatoria (una web ajena no la conoce). Origin y
// Sec-Fetch-Site son un refuerzo. Con "Referrer-Policy: no-referrer" los navegadores envían "Origin: null" en el
// POST del formulario (aunque sea del mismo origen), así que "null" solo se acepta si el navegador declara además
// Sec-Fetch-Site: same-origin (o no manda Sec-Fetch-Site: navegadores antiguos). Cualquier otro valor de
// Sec-Fetch-Site (cross-site, same-site, none) se rechaza.

import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import * as lib from "./lib.mjs";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Abre una URL en el navegador por defecto, en cualquier sistema. Devuelve true solo si hay indicios razonables de
// que se abrió: en Linux sin sesión gráfica (SSH, contenedor) ni se intenta; si el comando termina con error, es
// false; si sigue vivo pasado un rato (algunos xdg-open esperan al navegador), se da por abierto.
// LIMITACIÓN CONOCIDA (#23): con DISPLAY definido pero sin servidor X, o con un navegador que falla, xdg-open puede
// salir con código 0 y aquí se da por abierto sin estarlo; no hay forma barata y fiable de comprobarlo. Está mitigado
// porque server.mjs devuelve SIEMPRE la URL en tell_user (el asistente se la da al usuario), así que "opened" es
// solo una pista, nunca la única vía para llegar a la página.
// OPT-OUT PARA LAS PRUEBAS: con SC_NO_BROWSER en el entorno no se intenta abrir nada. Es lo que usan las pruebas
// (test19) para ejecutar login.mjs de verdad: en Windows rundll32 está en System32 y no depende de PATH, así que
// vaciar PATH no basta para garantizar que npm test no abra un navegador.
export function openBrowser(url, platform = process.platform, { env = process.env, timeoutMs = 3000 } = {}) {
  if (env.SC_NO_BROWSER) return Promise.resolve(false);
  if (platform !== "darwin" && platform !== "win32" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return Promise.resolve(false);
  const [cmd, args] =
    platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = execFile(cmd, args, { windowsHide: true, env }, (err) => {
        clearTimeout(timer);
        resolve(!err);
      });
      const timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref();
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// ---------- Textos (español si el navegador lo pide; si no, inglés) ----------
const T = {
  en: {
    title: "SoundCrate setup",
    intro: "Connect SoundCrate to your SoundCloud account. Everything stays on this computer: what you type here goes straight to",
    s1: "1. Register a SoundCloud app",
    s1a: "Open",
    s1b: "(you need a SoundCloud Artist Pro plan) and create a new app with these values:",
    name: "Name", desc: "Description", descVal: "Local AI assistant to manage my own playlists", web: "Website", any: "any website of yours", redirect: "Redirect URI",
    s1c: "SoundCloud will show you a Client ID and a Client Secret.",
    terms1: "Important: by creating the app you accept the",
    terms2: "SoundCloud API Terms of Use",
    terms3: ". Section 03 forbids using content obtained through the API (including titles, tags and other text) as input to any artificial intelligence technology, and SoundCloud can revoke an app's API access without notice. SoundCrate sends this kind of data to your AI assistant, so you use it at your own responsibility.",
    s2: "2. Paste the app credentials",
    save: "Save credentials",
    saved: "Credentials saved.",
    have: "App credentials are already saved.",
    change: "Change app credentials",
    s3: "3. Connect your account",
    connect: "Connect with SoundCloud",
    s3b: "SoundCloud will ask you to authorize the app and then send you back here.",
    okTitle: "All set!",
    ok: "SoundCrate is connected to SoundCloud as",
    okBack: "You can close this tab and go back to your assistant.",
    errTitle: "Something went wrong",
    retry: "Back to the setup page",
    cbHintCreds: "Go back to the setup tab and complete step 2 (the app credentials), then connect again in step 3.",
    cbHint: "Go back to the setup tab and try step 3 again, or ask your assistant to open the setup page again.",
    openUntil: "This page stays open until",
    openUntil2: "; any step you take here extends it.",
    badState: "This return link does not match the current setup (it is wrong, already used or expired).",
    badLink: "This setup link is not valid or has expired. Ask your assistant to start the setup again.",
    reconnect: "You changed the app credentials: connect your account again (step 3).",
    badId: "The Client ID does not look right (letters, numbers, - and _ only).",
    badSecret: "The Client Secret does not look right (8-256 printable characters, no spaces at the ends).",
    envNote: "SC_CLIENT_ID / SC_CLIENT_SECRET are set in the server environment and take priority.",
  },
  es: {
    title: "Configurar SoundCrate",
    intro: "Conecta SoundCrate con tu cuenta de SoundCloud. Todo se queda en este ordenador: lo que escribas aquí va directo a",
    s1: "1. Registra una app en SoundCloud",
    s1a: "Abre",
    s1b: "(hace falta un plan Artist Pro de SoundCloud) y crea una app nueva con estos datos:",
    name: "Nombre", desc: "Descripción", descVal: "Asistente de IA local para gestionar mis propias playlists", web: "Web", any: "cualquier web tuya", redirect: "Redirect URI",
    s1c: "SoundCloud te mostrará un Client ID y un Client Secret.",
    terms1: "Importante: al crear la app aceptas las",
    terms2: "condiciones de uso de la API de SoundCloud",
    terms3: ". La sección 03 prohíbe usar el contenido obtenido por la API (incluidos títulos, etiquetas y otros textos) como entrada de cualquier tecnología de inteligencia artificial, y SoundCloud puede revocar sin aviso el acceso a la API de una app. SoundCrate envía este tipo de datos a tu asistente de IA, así que lo usas bajo tu responsabilidad.",
    s2: "2. Pega las credenciales de la app",
    save: "Guardar credenciales",
    saved: "Credenciales guardadas.",
    have: "Las credenciales de la app ya están guardadas.",
    change: "Cambiar las credenciales de la app",
    s3: "3. Conecta tu cuenta",
    connect: "Conectar con SoundCloud",
    s3b: "SoundCloud te pedirá autorizar la app y te devolverá aquí.",
    okTitle: "¡Listo!",
    ok: "SoundCrate está conectado a SoundCloud como",
    okBack: "Ya puedes cerrar esta pestaña y volver a tu asistente.",
    errTitle: "Algo ha fallado",
    retry: "Volver a la página de configuración",
    cbHintCreds: "Vuelve a la pestaña de configuración y completa el paso 2 (las credenciales de la app); después conecta de nuevo en el paso 3.",
    cbHint: "Vuelve a la pestaña de configuración y repite el paso 3, o pide a tu asistente que abra de nuevo la página de configuración.",
    openUntil: "Esta página sigue abierta hasta las",
    openUntil2: "; cualquier paso que des aquí amplía el plazo.",
    badState: "Este enlace de vuelta no corresponde a la configuración actual (es incorrecto, ya se usó o ha caducado).",
    badLink: "Este enlace de configuración no es válido o ha caducado. Pide a tu asistente que empiece la configuración de nuevo.",
    reconnect: "Has cambiado las credenciales de la app: vuelve a conectar tu cuenta (paso 3).",
    badId: "El Client ID no parece correcto (solo letras, números, - y _).",
    badSecret: "El Client Secret no parece correcto (de 8 a 256 caracteres imprimibles, sin espacios al principio ni al final).",
    envNote: "SC_CLIENT_ID / SC_CLIENT_SECRET están definidas en el entorno del servidor y tienen prioridad.",
  },
};
const langOf = (req) => (/^\s*es\b/i.test(String(req.headers["accept-language"] || "")) ? "es" : "en");

const page = (t, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)}</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1d1d1f;--mut:#666;--card:#fff;--line:#ddd;--acc:#ff5500}
@media(prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mut:#aaa;--card:#1f1f1f;--line:#333}}
body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px}
main{max-width:640px;margin:0 auto}h1{font-size:24px}h2{font-size:18px;margin-top:28px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin:16px 0}
code{background:var(--line);padding:1px 6px;border-radius:4px;word-break:break-all}
label{display:block;margin:12px 0 4px;font-weight:600}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
button,.btn{display:inline-block;margin-top:14px;padding:10px 18px;border:0;border-radius:6px;background:var(--acc);color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.ok{color:#1a7f37}.err{color:#c62828}.mut{color:var(--mut)}a{color:var(--acc)}td{padding:2px 12px 2px 0;vertical-align:top}
</style></head><body><main>${body}</main></body></html>`;

let active = null; // una sola página de configuración por proceso

// Cierra la página de configuración activa, sea quien sea el que la abrió (no hace nada si no hay ninguna).
export function stopSetup() {
  active?.stop?.();
}

export async function startSetup({
  store = lib.store(),
  credentials = lib.credentials,
  tokenRequest = lib.tokenRequest,
  fetchFn = (...a) => fetch(...a),
  redirectUri = lib.REDIRECT_URI,
  open = true,
  openFn = openBrowser,
  onSuccess = () => {},
  onCredentialsChanged = () => {}, // al guardar credenciales de OTRA app: el servidor debe vaciar su sesión en memoria
  timeoutMs = 60 * 60 * 1000, // plazo de INACTIVIDAD (la actividad con clave válida lo renueva)
} = {}) {
  if (active) {
    // Página ya abierta: se reintenta abrirla (si se pide) y se devuelve el estado real, no el de la primera llamada.
    const opened = open ? await openFn(active.info.url) : false;
    return { ...active.info, opened, already_running: true };
  }

  // Si el almacén de secretos no funciona, mejor decirlo ya (el agente explicará cómo arreglarlo).
  const pr = store.probe();
  if (!pr.ok) throw new lib.SetupError(`The secure storage (${store.label}) is not available: ${pr.problem}`, pr.fix);

  const cb = new URL(redirectUri);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(cb.hostname) || cb.protocol !== "http:") {
    throw new lib.SetupError(`The Redirect URI must be http://127.0.0.1:<port>/callback or http://localhost:<port>/callback (got ${redirectUri}).`);
  }
  const port = Number(cb.port || 80);
  const origin = `${cb.protocol}//${cb.host}`;
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...(port === 80 ? ["127.0.0.1", "localhost", "[::1]"] : [])]);
  const okOrigins = new Set([...okHosts].map((h) => `http://${h}`));
  const key = b64url(crypto.randomBytes(24));
  const url = `${origin}/setup?k=${key}`;
  let oauth = null; // { verifier, state }
  let finished = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  let timer;
  let deadline = Date.now() + timeoutMs;
  let lastFail = null; // { state, message }: canje que falló (el state ya se consumió), para dar la causa real al reintentar

  const send = (res, status, html, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(html);
  };
  const redirect = (res, to) => send(res, 303, "", { Location: to });
  // El enlace de vuelta lleva la clave: solo se pone cuando quien pide ya la tenía y era válida (backLink). En el
  // resto de respuestas de error (clave mala, /callback que no autentica, 500) no se devuelve nunca.
  // Sin backLink se ofrece una salida SIN clave (texto: volver a la pestaña de configuración o pedir otra página).
  const errorPage = (res, t, msg, status = 400, backLink = false, hint = false) =>
    send(res, status, page(t, `<h1>${esc(t.errTitle)}</h1><p class="err">${esc(msg)}</p>${backLink ? `<p><a href="/setup?k=${key}">${esc(t.retry)}</a></p>` : ""}${hint ? `<p>${esc(hint === "creds" ? t.cbHintCreds : t.cbHint)}</p>` : ""}`));
  const touch = () => {
    // actividad con clave válida: el plazo de caducidad cuenta desde la última
    deadline = Date.now() + timeoutMs;
    timer?.refresh();
  };
  // Refuerzo anti-CSRF del POST (ver cabecera del fichero).
  const originOk = (req) => {
    const o = req.headers.origin;
    const sfs = req.headers["sec-fetch-site"];
    if (sfs !== undefined && sfs !== "same-origin") return false;
    return o === undefined || o === "null" || okOrigins.has(o);
  };

  const hasCreds = () => {
    try {
      credentials();
      return true;
    } catch {
      return false;
    }
  };

  // HH:MM de 24 h en hora local del equipo; no depende del locale del proceso (la página puede estar en otro idioma).
  const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const setupPage = (t, note = "") => {
    const creds = hasCreds();
    const envCreds = !!(process.env.SC_CLIENT_ID && process.env.SC_CLIENT_SECRET);
    const form = `<form method="post" action="/setup/credentials" autocomplete="off">
<input type="hidden" name="k" value="${key}">
<label for="cid">Client ID</label><input id="cid" name="client_id" required spellcheck="false">
<label for="sec">Client Secret</label><input id="sec" name="client_secret" type="password" required spellcheck="false">
<button type="submit">${esc(t.save)}</button></form>`;
    return page(
      t,
      `<h1>${esc(t.title)}</h1><p>${esc(t.intro)} <b>${esc(store.label)}</b>.</p>${note}
<p class="mut">${esc(t.openUntil)} ${esc(hhmm(deadline))}${esc(t.openUntil2)}</p>
<section><h2>${esc(t.s1)}</h2><p>${esc(t.s1a)} <a href="${lib.APPS_URL}" target="_blank" rel="noopener noreferrer">${lib.APPS_URL}</a> ${esc(t.s1b)}</p>
<table><tr><td>${esc(t.name)}</td><td><code>SoundCrate (personal)</code></td></tr><tr><td>${esc(t.desc)}</td><td><code>${esc(t.descVal)}</code></td></tr>
<tr><td>${esc(t.web)}</td><td>${esc(t.any)}</td></tr><tr><td>${esc(t.redirect)}</td><td><code>${esc(redirectUri)}</code></td></tr></table>
<p class="mut">${esc(t.s1c)}</p>
<p><b>${esc(t.terms1)} <a href="https://developers.soundcloud.com/docs/api/terms-of-use" target="_blank" rel="noopener noreferrer">${esc(t.terms2)}</a></b>${esc(t.terms3)}</p></section>
<section><h2>${esc(t.s2)}</h2>${
        creds
          ? `<p class="ok">✓ ${esc(t.have)}</p>${envCreds ? `<p class="mut">${esc(t.envNote)}</p>` : `<details><summary>${esc(t.change)}</summary>${form}</details>`}`
          : form
      }</section>
<section><h2>${esc(t.s3)}</h2>${
        creds ? `<p>${esc(t.s3b)}</p><a class="btn" href="/setup/connect?k=${key}">${esc(t.connect)}</a>` : `<p class="mut">${esc(t.s3b)}</p>`
      }</section>`
    );
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c) => {
        data += c;
        if (data.length > 8192) {
          reject(new Error("too large"));
          req.destroy();
        }
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  // Canjea el código de SoundCloud por la sesión y la guarda.
  // brief: respuesta HTTP de /callback; en la repetición de un canje fallido no reenseña el cuerpo de error del token
  // endpoint (solo el estado HTTP). completeFromUrl (terminal del usuario) pide el detalle completo.
  async function complete(code, state, { brief = false } = {}) {
    if (!oauth && lastFail && code && sameSecret(state, lastFail.state)) {
      const http = /\/oauth\/token ([1-5]\d\d)\b/.exec(lastFail.message)?.[1];
      const why = !brief ? lastFail.message : http ? `HTTP ${http}` : null;
      const e = new Error(
        why
          ? `the exchange already failed (${why}) and the code cannot be reused`
          : "the exchange already failed; connect again from step 3"
      );
      e.code = "exchange_failed";
      throw e;
    }
    if (!oauth || !code || !sameSecret(state, oauth.state)) throw new Error("state");
    // Sin credenciales no hay canje: se dice la causa real, no se registra como canje fallido y el state NO se
    // consume (el code no llegó a enviarse a SoundCloud, así que sigue siendo válido al guardar las credenciales).
    let clientId, clientSecret;
    try {
      ({ clientId, clientSecret } = credentials());
    } catch (e) {
      e.code = "no_credentials";
      throw e;
    }
    const o = oauth;
    oauth = null; // el state es de un solo uso, también si el canje falla (el code tampoco se puede reutilizar)
    lastFail = null;
    let tok;
    try {
      tok = await tokenRequest({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: o.verifier,
        code,
      });
    } catch (e) {
      lastFail = { state: o.state, message: String(e?.message || e).slice(0, 200) };
      const err = new Error(`the exchange with SoundCloud failed: ${lastFail.message}`);
      err.code = "exchange_failed";
      throw err;
    }
    if (!tok.refresh_token) throw new Error("SoundCloud did not return a refresh_token.");
    store.set("refresh_token", tok.refresh_token);
    let username = null;
    try {
      const me = await fetchFn(`${lib.API}/me`, {
        headers: { Authorization: "OAuth " + tok.access_token, Accept: "application/json; charset=utf-8" },
        signal: AbortSignal.timeout(15000),
      });
      if (me.ok) username = (await me.json()).username || null;
    } catch {}
    onSuccess({ username, access_token: tok.access_token, expires_in: tok.expires_in });
    finish({ ok: true, username });
    return username;
  }

  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolveDone(result);
    active = null;
    setTimeout(() => server.close(), 1500).unref();
  }

  const server = http.createServer(async (req, res) => {
    const t = T[langOf(req)];
    try {
      if (!okHosts.has(String(req.headers.host || ""))) return send(res, 421, "Misdirected request");
      const u = new URL(req.url, origin);

      if (req.method === "GET" && u.pathname === "/setup") {
        if (!sameSecret(u.searchParams.get("k"), key)) return errorPage(res, t, t.badLink, 403);
        touch();
        const note = u.searchParams.get("saved")
          ? `<p class="ok">✓ ${esc(t.saved)}</p>${u.searchParams.get("reconnect") ? `<p class="err">${esc(t.reconnect)}</p>` : ""}`
          : "";
        return send(res, 200, setupPage(t, note));
      }

      if (req.method === "POST" && u.pathname === "/setup/credentials") {
        if (!originOk(req)) return send(res, 403, "Forbidden");
        const form = new URLSearchParams(await readBody(req));
        if (!sameSecret(form.get("k"), key)) return errorPage(res, t, t.badLink, 403);
        touch();
        const id = String(form.get("client_id") || "").trim();
        const secret = String(form.get("client_secret") || "").trim();
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return errorPage(res, t, t.badId, 400, true);
        if (!/^[\x21-\x7E](?:[\x20-\x7E]{6,254})[\x21-\x7E]$/.test(secret)) return errorPage(res, t, t.badSecret, 400, true);
        // Si cambia la app (otro Client ID), el refresh_token guardado era de la anterior y ya no sirve.
        const prevId = store.get("client_id");
        const changed = !!prevId && prevId !== id;
        store.set("client_id", id);
        store.set("client_secret", secret);
        if (changed) {
          store.del("refresh_token");
          oauth = null;
          try {
            onCredentialsChanged();
          } catch {}
        }
        return redirect(res, `/setup?k=${key}&saved=1${changed ? "&reconnect=1" : ""}`);
      }

      if (req.method === "GET" && u.pathname === "/setup/connect") {
        if (!sameSecret(u.searchParams.get("k"), key)) return errorPage(res, t, t.badLink, 403);
        touch();
        const { clientId } = credentials();
        const verifier = b64url(crypto.randomBytes(48));
        oauth = { verifier, state: b64url(crypto.randomBytes(18)) };
        const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
        const auth = new URL(lib.AUTH_URL);
        auth.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: oauth.state,
        });
        return redirect(res, auth.href);
      }

      if (req.method === "GET" && u.pathname === cb.pathname) {
        const err = u.searchParams.get("error");
        if (err) return errorPage(res, t, `SoundCloud: ${err} ${u.searchParams.get("error_description") || ""}`, 400, false, true); // sin enlace: esta ruta no autentica
        try {
          const username = await complete(u.searchParams.get("code"), u.searchParams.get("state"), { brief: true });
          return send(res, 200, page(t, `<h1 class="ok">${esc(t.okTitle)}</h1><p>${esc(t.ok)} <b>${esc(username || "?")}</b>.</p><p>${esc(t.okBack)}</p>`));
        } catch (e) {
          return errorPage(res, t, e.message === "state" ? t.badState : e.message, 400, false, e.code === "no_credentials" ? "creds" : true);
        }
      }
      return send(res, 404, "Not found");
    } catch (e) {
      return errorPage(res, t, e.message, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", (e) =>
      reject(
        e.code === "EADDRINUSE"
          ? new lib.SetupError(`Port ${port} is busy: another SoundCrate setup or login is probably open. Close it and try again.`)
          : e
      )
    );
    server.listen(port, cb.hostname.replace(/^\[|\]$/g, ""), resolve);
  });
  timer = setTimeout(() => finish({ ok: false, reason: "timeout", idle_minutes: Math.max(1, Math.round(timeoutMs / 60000)) }), timeoutMs);
  timer.unref();

  const opened = open ? await openFn(url) : false;
  const info = { url, opened, store: store.label };
  active = {
    info,
    done,
    // Cierra la página y el servidor ya (no a los 1,5 s de finish): lo usa server.mjs cuando el cliente cierra stdin.
    stop: () => {
      finish({ ok: false, reason: "closed" });
      server.close();
      server.closeAllConnections?.();
    },
    // Para login.mjs: si el navegador no vuelve a la página, el usuario pega la URL de retorno.
    completeFromUrl: async (pasted) => {
      const p = new URL(pasted);
      return complete(p.searchParams.get("code"), p.searchParams.get("state"));
    },
  };
  return { ...info, already_running: false, done, completeFromUrl: active.completeFromUrl, close: () => finish({ ok: false, reason: "closed" }) };
}
