# SoundCrate MCP

**Tus playlists de SoundCloud, curadas por tu agente de IA.** Busca pistas, descubre música parecida, crea
playlists privadas, ordénalas por BPM o tonalidad y quita o sustituye pistas hablando con tu asistente:
Claude, OpenCode, Cursor, VS Code (Copilot), Codex, Gemini CLI o cualquier otro cliente MCP.

[![test](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Servidor [MCP](https://modelcontextprotocol.io) que corre solo en tu Mac: tu cliente lo arranca cuando lo
necesita y le habla por stdio. Sin dependencias externas, solo Node.js. Tu client secret y tu sesión se guardan
en el Llavero de macOS (servicio `soundcloud-mcp`). No hay ningún servidor público.

> **English summary:** a zero-dependency, local-only MCP server (stdio) that lets any MCP client — Claude,
> OpenCode, Cursor, VS Code, Codex, Gemini CLI… — search SoundCloud and manage *your own* playlists. Tool
> descriptions are in English and work with any model provider. It speaks MCP 2024-11-05 to 2025-11-25
> (`initialize` handshake) and 2026-07-28 (stateless, `server/discover`). Secrets live in the macOS Keychain;
> nothing is exposed to the internet. No downloads, no stream URLs and no playlist deletion, by design.
> macOS only for now. Setup instructions below are in Spanish; the client config snippets are universal.

## Herramientas

**Descubrir pistas** (solo lectura)

| Herramienta | Qué hace |
|---|---|
| `search_tracks(query?, genres?, tags?, bpm_min?, bpm_max?, duration_min_s?, duration_max_s?, uploaded_after?, uploaded_before?, only_listenable?, limit?, cursor?)` | Busca por texto y/o filtros, hasta 200 resultados por página. |
| `get_track(track_id \| url)` | Datos de una pista por id o por URL. |
| `get_related_tracks(track_id \| url, exclude_playlist_id?, limit?, cursor?)` | Pistas relacionadas según SoundCloud, sin las que ya tienes en una playlist. |
| `get_my_tracks(source, limit?, cursor?)` | Tus `likes`, lo último escuchado (`recently_played`), tu `feed`, las subidas de quien sigues (`followings`) o tus `reposts`. |
| `search_users(query)` | Busca artistas, sellos o DJs. |
| `get_related_artists(user_id \| url)` | Artistas parecidos. |
| `get_user_content(user_id \| url, kind, sort?)` | Pistas, likes, reposts o playlists de un artista o DJ. |
| `search_playlists(query)` | Playlists públicas de cualquiera. |
| `get_station(station_id)` | Una emisora de SoundCloud con sus pistas. |
| `suggest_tracks(seed_track_ids[1-5], exclude_playlist_id?, limit?, bpm_min?, bpm_max?, duration_min_s?, duration_max_s?, genres?, only_listenable?)` | Candidatas a partir de varias pistas semilla: relacionadas de SoundCloud, sin duplicados ni lo que ya está en la playlist, con filtros. Ordena por cuántas semillas la sugieren y si mezclan en armonía. No escribe nada. |
| `find_official_version(track_id, limit?)` | Candidatas a la versión oficial de una subida de usuario, con motivos (ISRC, sello, mismo artista). Solo sugiere. |
| `analyze_playlist(playlist_id \| url)` | Resumen de una playlist: duración, BPM (mín., mediana, máx.), Camelot, géneros, años, duplicados, saltos de BPM y choques armónicos entre pistas consecutivas. Solo lectura. |

**Tu cuenta y tus playlists**

| Herramienta | Qué hace |
|---|---|
| `whoami(force_refresh?)` | Comprueba la sesión: usuario, plan, suscripciones y si has declarado Go+. |
| `get_my_playlists(kind?, query?)` | Tus playlists, privadas incluidas (`own`), las que te gustan (`liked`) o tus emisoras (`stations`), sin pistas. `query` filtra por título. |
| `get_playlist(playlist_id \| url)` | Una playlist con sus pistas, tuya o pública de otro usuario. |
| `create_playlist(title, description?, track_ids?, public?)` | Crea una playlist, **privada por defecto**. |
| `add_tracks_to_playlist(playlist_id, track_ids[])` | Añade al final sin duplicados. |
| `remove_tracks_from_playlist(playlist_id, track_ids[])` | Quita varias pistas en una sola escritura. |
| `remove_track_from_playlist(playlist_id, track_id)` | Quita una pista. |
| `replace_track_in_playlist(playlist_id, old_track_id, new_track_id)` | Sustituye una pista conservando su posición. |
| `update_playlist(playlist_id, title?, description?, genre?, tags?, sort_by?, direction?, track_order?)` | Cambia título, descripción, género o etiquetas y/o reordena: `sort_by` (`bpm`, `camelot`, `duration`, `released`) o `track_order` con todas las ids. Nunca añade ni quita pistas. |

Cada pista trae `bpm`, tonalidad (`key`, p. ej. `F:min`) y su equivalente **Camelot** (`camelot`, p. ej. `4A`)
para mezclar en armonía, además de género, etiquetas, sello, fecha de lanzamiento, ISRC, reproducciones y likes.
Las listas largas se recorren pasando el `next_cursor` de una respuesta como `cursor` de la siguiente llamada.

Las herramientas de escritura llevan anotaciones MCP (`readOnlyHint`, `destructiveHint`…), así que los clientes
que lo admiten piden confirmación antes de cambiar una playlist.

### Ideas para pedirle a tu agente

- «Busca techno de 128 a 132 BPM subido este año y hazme una playlist privada de 2 horas, ordenada por BPM y en
  claves compatibles».
- «Coge estas tres pistas, busca relacionadas que no estén ya en mi playlist *Warm-up* y propónme diez».
- «Mira qué han repostado este mes los DJs que sigo y sácame lo que encaje con mi playlist *Peak time*».
- «Quiero algo parecido a Amelie Lens: artistas relacionados y sus pistas más recientes».
- «Analiza mi playlist *Peak time* y dime dónde hay saltos de BPM o choques de tonalidad».
- «Ordena *Warm-up* por BPM ascendente y ponle el género Techno».

No incluye descargas ni URLs de streaming (las condiciones de la API de SoundCloud lo prohíben), ni borrado
de playlists, para que un error no pueda destruir nada.

### Cómo protege tus playlists

- `update_playlist` nunca cambia el conjunto de pistas. Si tras escribir SoundCloud no devuelve las mismas pistas,
  restaura el orden anterior y avisa.
- La API de SoundCloud **reemplaza la lista entera** al escribir una playlist. Por eso cada cambio lee la
  playlist, la modifica y la escribe, y los cambios sobre una misma playlist van **en cola**, uno detrás de otro,
  aunque el agente los pida en paralelo.
- Si la API oculta alguna pista al leer la playlist (`track_count` mayor que las pistas devueltas), el servidor
  **no escribe nada**, porque reescribirla borraría las pistas que no ve. `get_playlist` lo indica con
  `hidden_by_api`.

### Etiquetas de playlist

SoundCloud guarda las etiquetas separadas por espacios, y las que tienen espacios van entre comillas. El parámetro
`tags` de `update_playlist` acepta una lista separada por comas (`"warm, deep house"`) y la convierte a ese formato.

### Sobre BPM y filtros

El filtro de BPM de la API es aproximado: en pruebas reales, cerca del 10 % de lo devuelto quedaba fuera del
rango pedido. El servidor vuelve a filtrar de forma estricta y dice cuántas quitó en `out_of_range_removed`, así
que una página puede traer menos pistas que `limit`.

### Go+, `access` y `listen`

El campo `access` dice qué deja reproducir la API **fuera de SoundCloud**, no lo que tú puedes escuchar. Según la
guía de la API, una pista puede estar restringida por su autor, por ser de pago o por región, y entonces sale como
`blocked`. Por eso cada pista trae también `listen`, que lo traduce para el oyente:

| `listen` | Viene de | Qué significa |
|---|---|---|
| `full` | `playable` | Suena entera para cualquiera. |
| `go_plus` | `preview` | Catálogo distribuido: sin suscripción, solo un fragmento; con Go+, entera. |
| `go_plus_probable` | `blocked` con sello o ISRC | Catálogo de sello que la API no deja reproducir fuera de SoundCloud. Con Go+ suele sonar entera en SoundCloud, sin garantía por región. |
| `restricted` | `blocked` sin sello ni ISRC | Suele ser un remix o bootleg bloqueado por derechos, región o decisión del autor. Puede no sonar ni con Go+. |

Todas se pueden añadir a playlists. La clasificación sale de los metadatos (en una muestra de 1.760 pistas, todas
las `preview` y el 90 % de las `blocked` tenían sello o ISRC). El servidor **nunca** llama a `/streams`: las
condiciones de la API prohíben intentar acceder a contenido exclusivo de Go.

**La API no informa de si tienes Go+**: `/me` solo lista planes de artista. Si lo tienes, decláralo con
`SC_GO_PLUS=1` en la configuración de tu cliente (paso 5). Con eso, `only_listenable: true` en `search_tracks` o
`suggest_tracks` deja `full`, `go_plus` y `go_plus_probable`; sin Go+ declarado deja solo `full`. `whoami` dice si
está declarado, y el servidor se lo explica al modelo en sus instrucciones y en la descripción de esas herramientas.

## 1. Registrar la app en SoundCloud (requiere Artist Pro)

En <https://soundcloud.com/you/apps> → nueva aplicación:

- Nombre: `SoundCrate (personal)`
- Descripción: `Gestión personal de mis playlists desde mi asistente de IA`
- Web: cualquier web tuya
- **Redirect URI:** `http://127.0.0.1:8976/callback`

Apunta el **Client ID** y el **Client Secret**.

## 2. Guardar las credenciales en el Llavero

En Terminal (te pedirá el valor dos veces y no se ve al escribir; así no queda en el historial):

```bash
security add-generic-password -U -s soundcloud-mcp -a client_id -w
security add-generic-password -U -s soundcloud-mcp -a client_secret -w
```

## 3. Comprobar Node.js (18 o superior)

```bash
which node && node --version
```

Si no está instalado: `brew install node`. Apunta la ruta que da `which node` (por ejemplo
`/opt/homebrew/bin/node`): las apps de escritorio no siempre heredan el `PATH` de la Terminal, así que conviene
usar la ruta completa en la configuración.

## 4. Descargar e iniciar sesión una vez

```bash
git clone https://github.com/C4denaX/soundcrate-mcp.git ~/soundcrate-mcp
cd ~/soundcrate-mcp
node login.mjs
```

Se abre SoundCloud, autorizas la app y la Terminal dice "✅ Session saved in the macOS Keychain".

Si SoundCloud no acepta `127.0.0.1` como Redirect URI, pon en la app `http://localhost:8976/callback` y ejecuta
`SC_REDIRECT_URI=http://localhost:8976/callback node login.mjs` (y añade también `SC_REDIRECT_URI` a las variables
de entorno del paso 5).

## 5. Conectarlo a tu cliente MCP

En todos los clientes es lo mismo: un servidor **stdio** que se lanza con `node` y la ruta a `server.mjs`, y la
variable `SC_GO_PLUS=1` si tienes SoundCloud Go+ (quítala si no lo tienes). En los ejemplos, cambia
`/Users/<tu-usuario>/soundcrate-mcp` por la carpeta donde lo clonaste y `/opt/homebrew/bin/node` por tu `which node`.
Después de añadirlo, reinicia el cliente (en las apps de escritorio, ciérralas del todo con Cmd+Q).

**Claude Desktop**: Ajustes → Desarrollador → Editar configuración (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "soundcrate": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/<tu-usuario>/soundcrate-mcp/server.mjs"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add soundcrate --scope user -e SC_GO_PLUS=1 -- /opt/homebrew/bin/node /Users/<tu-usuario>/soundcrate-mcp/server.mjs
```

**OpenCode** (app de escritorio y terminal; `~/.config/opencode/opencode.jsonc` o `opencode.json` del proyecto):

```json
{
  "mcp": {
    "soundcrate": {
      "type": "local",
      "command": ["/opt/homebrew/bin/node", "/Users/<tu-usuario>/soundcrate-mcp/server.mjs"],
      "environment": { "SC_GO_PLUS": "1" },
      "enabled": true
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`), **Gemini CLI** (`~/.gemini/settings.json`) y la mayoría de clientes con el
formato `mcpServers` (Windsurf, Cline…): el mismo bloque que Claude Desktop. En Gemini CLI también vale:

```bash
gemini mcp add --scope user -e SC_GO_PLUS=1 soundcrate /opt/homebrew/bin/node /Users/<tu-usuario>/soundcrate-mcp/server.mjs
```

**VS Code** (Copilot; `mcp.json` del usuario o `.vscode/mcp.json` del proyecto):

```json
{
  "servers": {
    "soundcrate": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/<tu-usuario>/soundcrate-mcp/server.mjs"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.soundcrate]
command = "/opt/homebrew/bin/node"
args = ["/Users/<tu-usuario>/soundcrate-mcp/server.mjs"]
env = { SC_GO_PLUS = "1" }
```

o bien:

```bash
codex mcp add soundcrate --env SC_GO_PLUS=1 -- /opt/homebrew/bin/node /Users/<tu-usuario>/soundcrate-mcp/server.mjs
```

**Sin clonar el repo**: el paquete expone los ejecutables `soundcrate-mcp` y `soundcrate-login`, así que cualquier
cliente puede lanzarlo con `npx` directamente desde GitHub. Cambia `command`/`args` por:

```json
"command": "npx",
"args": ["-y", "github:C4denaX/soundcrate-mcp"]
```

El inicio de sesión del paso 4 sería entonces `npx -y -p github:C4denaX/soundcrate-mcp soundcrate-login`.

## Compatibilidad

- **Protocolo:** MCP 2024-11-05, 2025-03-26, 2025-06-18 y 2025-11-25 (con `initialize`) y 2026-07-28 (sin
  estado, con `server/discover` y la versión en `_meta`). Negocia la versión con cada cliente.
- **Modelos:** las descripciones están en inglés y los esquemas evitan construcciones que algunos proveedores
  rechazan (`$ref`, `oneOf`, descripciones de más de 1.024 caracteres), así que sirven para Claude, GPT,
  Gemini, modelos locales, etc.
- **Sistema operativo:** de momento solo macOS, porque las credenciales viven en el Llavero. En otro sistema el
  servidor arranca pero las herramientas devuelven un error que lo explica.

## Pruebas

```bash
npm test
```

Las pruebas no usan la red ni el Llavero: sustituyen `fetch`, el Llavero y los tokens por dobles de prueba
mediante `_setDeps()`. `tests/test7.mjs` lanza el servidor como proceso real y lo ejercita por stdio igual que un
cliente, con las dos generaciones del protocolo.

## Desconectar

Borra la app en <https://soundcloud.com/you/apps> y las entradas del Llavero:

```bash
security delete-generic-password -s soundcloud-mcp -a refresh_token
security delete-generic-password -s soundcloud-mcp -a client_secret
security delete-generic-password -s soundcloud-mcp -a client_id
```

## Licencia y créditos

[MIT](LICENSE). SoundCrate no está afiliado a SoundCloud ni respaldado por SoundCloud.

El diseño se inspiró en [marcellkehmstedt/soundcloud-mcp-server](https://github.com/marcellkehmstedt/soundcloud-mcp-server)
(sobre todo el fallo de los IDs largos de pista). Este código está escrito desde cero, sin dependencias y con otra
arquitectura (stdio local en lugar de servidor HTTP).
