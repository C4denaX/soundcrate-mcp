#!/usr/bin/env node
// Inicio de sesión único (OAuth 2.1 + PKCE). Guarda el refresh token en el Llavero.
// Uso: node login.mjs

import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { credentials, tokenRequest, kcSet, AUTH_URL, REDIRECT_URI } from "./lib.mjs";

const { clientId, clientSecret } = credentials();
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const url =
  AUTH_URL +
  "?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

let done = false;

async function finish(code, gotState) {
  if (done) return;
  if (gotState !== state) {
    console.error("El parámetro state no coincide. Vuelve a ejecutar node login.mjs.");
    process.exit(1);
  }
  done = true;
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    code,
  });
  if (!tok.refresh_token) throw new Error("SoundCloud no devolvió refresh_token.");
  kcSet("refresh_token", tok.refresh_token);
  console.log("\n✅ Sesión guardada en el Llavero. Ya puedes reiniciar la app de Claude.");
  process.exit(0);
}

const cb = new URL(REDIRECT_URI);
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT_URI);
  if (u.pathname !== cb.pathname) {
    res.writeHead(404).end();
    return;
  }
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    err
      ? `<p>SoundCloud devolvió un error: ${String(err).replace(/[<>&]/g, "")}</p>`
      : "<p>Listo. Puedes cerrar esta pestaña y volver a la Terminal.</p>"
  );
  if (err) {
    console.error("Error de autorización:", err);
    process.exit(1);
  }
  try {
    await finish(code, u.searchParams.get("state"));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
});

server.listen(Number(cb.port || 80), cb.hostname, () => {
  console.log("Abriendo SoundCloud en el navegador para autorizar la app…");
  console.log("Si no se abre, copia esta dirección en el navegador:\n\n" + url + "\n");
  execFile("open", [url], () => {});
  console.log(
    "Si tras autorizar el navegador no carga la página de vuelta, pega aquí la dirección completa\n" +
      "a la que te ha llevado (empieza por " + REDIRECT_URI + "?code=…) y pulsa Intro:"
  );
});

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  try {
    const u = new URL(line.trim());
    await finish(u.searchParams.get("code"), u.searchParams.get("state"));
  } catch (e) {
    console.error("No he podido leer esa dirección:", e.message);
  }
});
