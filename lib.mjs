// SoundCloud MCP local — utilidades comunes (sin dependencias externas).
// Credenciales y tokens se guardan en el Llavero de macOS (servicio "soundcloud-mcp").

import { execFileSync } from "node:child_process";

export const SERVICE = "soundcloud-mcp";
export const AUTH_URL = "https://secure.soundcloud.com/authorize";
export const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
export const API = "https://api.soundcloud.com";
export const REDIRECT_URI = process.env.SC_REDIRECT_URI || "http://127.0.0.1:8976/callback";

// De momento las credenciales solo se guardan en el Llavero de macOS.
function assertMac() {
  if (process.platform !== "darwin") {
    throw new Error(
      "SoundCrate stores its credentials in the macOS Keychain; other operating systems are not supported yet."
    );
  }
}

export function kcGet(account) {
  assertMac();
  try {
    return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function kcSet(account, value) {
  assertMac();
  execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value], {
    stdio: "ignore",
  });
}

export function credentials() {
  const clientId = kcGet("client_id");
  const clientSecret = kcGet("client_secret");
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing client_id/client_secret in the macOS Keychain (service 'soundcloud-mcp'). See step 2 of the README."
    );
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
