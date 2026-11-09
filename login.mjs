#!/usr/bin/env node
// Configuración desde la terminal: abre la misma página local que la herramienta start_setup.
// Uso: node login.mjs  (o soundcrate-login si se instaló con npm / npx)

import readline from "node:readline";
import { startSetup } from "./setup.mjs";
import { REDIRECT_URI } from "./lib.mjs";

let s;
try {
  s = await startSetup({ open: true });
} catch (e) {
  console.error(`✖ ${e.message}`);
  if (e.fix) console.error(["", "How to fix it:", ...[].concat(e.fix).map((x) => `  - ${x}`)].join("\n"));
  process.exit(1);
}

console.log(`Credentials will be stored in: ${s.store}`);
console.log(s.opened ? "Opening the setup page in your browser…" : "Open this page in your browser:");
console.log(`\n  ${s.url}\n`);
console.log(
  "Follow the steps there. If, after authorizing on SoundCloud, the browser cannot load the page it returns to,\n" +
    `paste that full URL here (it starts with ${REDIRECT_URI}?code=…) and press Enter.`
);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    await s.completeFromUrl(line.trim());
  } catch (e) {
    if (e.code === "no_credentials") {
      // Sin credenciales no se canjea nada y el state sigue vivo: la MISMA URL sirve al guardarlas.
      console.error(
        `Could not complete the login: ${e.message}\n` +
          "To fix it: in step 2 of the setup page, save the Client ID and the Client Secret of your SoundCloud app.\n" +
          "Then paste the SAME URL here again (no need to connect again or get a new one)."
      );
      return;
    }
    console.error("Could not complete the login with that URL:", e.message === "state" ? "that URL does not match this session (wrong, already used, or expired)" : e.message,
      "\nTo retry: connect again from step 3 on the setup page (or run soundcrate-login again), then paste the new URL."
    );
  }
});

const r = await s.done;
rl.close();
if (r.ok) {
  console.log(`\n✅ Connected to SoundCloud${r.username ? ` as ${r.username}` : ""}. Restart your MCP client (Claude, OpenCode, Cursor…) to use it.`);
  process.exit(0);
}
console.error(`\n✖ Setup did not finish (${r.reason}). Run it again when you are ready.`);
process.exit(1);
