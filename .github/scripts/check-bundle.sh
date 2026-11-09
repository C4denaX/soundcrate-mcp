#!/usr/bin/env bash
# Comprueba el contenido de un .mcpb: debe llevar el servidor y sus metadatos, y nada de tests/CI/skills/plugin.
set -euo pipefail
f="${1:?uso: check-bundle.sh soundcrate.mcpb}"
list="$(mktemp)"
unzip -Z1 "$f" | sort | tee "$list"
for n in manifest.json server.mjs lib.mjs secrets.mjs setup.mjs icon.png LICENSE PRIVACY.md; do
  grep -qx "$n" "$list" || { echo "missing $n"; exit 1; }
done
if grep -E '^(tests/|\.github/|skills/|\.claude-plugin/)' "$list"; then echo "unexpected files"; exit 1; fi
