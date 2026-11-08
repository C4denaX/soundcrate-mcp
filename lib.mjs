// SoundCrate — utilidades comunes (sin dependencias externas).
// Las credenciales y la sesión van al almacén de secretos del sistema (ver secrets.mjs).

import { createStore, SetupError } from "./secrets.mjs";

export { SetupError };
export const AUTH_URL = "https://secure.soundcloud.com/authorize";
export const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
export const API = "https://api.soundcloud.com";
export const REDIRECT_URI = process.env.SC_REDIRECT_URI || "http://127.0.0.1:8976/callback";
export const APPS_URL = "https://soundcloud.com/you/apps";

let _store = null;
// El almacén se crea al usarlo: así un SC_SECRET_STORE inválido no impide arrancar el servidor
// (el error llega a la herramienta y el agente puede explicarlo).
export function store() {
  return (_store ??= createStore());
}

export const secretGet = (account) => store().get(account);
export const secretSet = (account, value) => store().set(account, value);

// SC_CLIENT_ID / SC_CLIENT_SECRET tienen prioridad (contenedores, CI). El refresh token no: rota en cada uso
// y hay que poder guardarlo, así que siempre va al almacén.
export function credentials() {
  const clientId = process.env.SC_CLIENT_ID || secretGet("client_id");
  const clientSecret = process.env.SC_CLIENT_SECRET || secretGet("client_secret");
  if (!clientId || !clientSecret) {
    throw new SetupError("SoundCrate is not set up yet: the SoundCloud app credentials (Client ID and Client Secret) are missing.");
  }
  return { clientId, clientSecret };
}

export async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json; charset=utf-8",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SoundCloud /oauth/token ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
