#!/usr/bin/env node
// Inicio de sesión único (OAuth 2.1 + PKCE). Guarda el refresh token en el Llavero.
// Uso: node login.mjs  (o soundcrate-login si se instaló con npm)

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
    console.error("The state parameter does not match. Run the login again.");
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
  if (!tok.refresh_token) throw new Error("SoundCloud did not return a refresh_token.");
  kcSet("refresh_token", tok.refresh_token);
  console.log("\n✅ Session saved in the macOS Keychain. Restart your MCP client (Claude, OpenCode, Cursor…) to use it.");
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
      ? `<p>SoundCloud returned an error: ${String(err).replace(/[<>&]/g, "")}</p>`
      : "<p>Done. You can close this tab and go back to the terminal.</p>"
  );
  if (err) {
    console.error("Authorization error:", err);
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
  console.log("Opening SoundCloud in your browser to authorize the app…");
  console.log("If it does not open, paste this URL into your browser:\n\n" + url + "\n");
  const [cmd, ...args] =
    process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", '""'] : ["xdg-open"];
  execFile(cmd, [...args, url], () => {});
  console.log(
    "If the browser does not load the page after you authorize, paste the full URL it took you to\n" +
      "(it starts with " + REDIRECT_URI + "?code=…) and press Enter:"
  );
});

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  try {
    const u = new URL(line.trim());
    await finish(u.searchParams.get("code"), u.searchParams.get("state"));
  } catch (e) {
    console.error("Could not read that URL:", e.message);
  }
});
