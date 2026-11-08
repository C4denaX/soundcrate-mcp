# SoundCrate MCP

**Tus playlists de SoundCloud, curadas por tu agente de IA.** Busca pistas, descubre música parecida, crea
playlists privadas, ordénalas por BPM o tonalidad y quita o sustituye pistas hablando con tu asistente:
Claude, OpenCode, Cursor, VS Code (Copilot), Codex, Gemini CLI o cualquier otro cliente MCP.

[![test](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Servidor [MCP](https://modelcontextprotocol.io) que corre solo en tu ordenador (macOS, Linux o Windows): tu
cliente lo arranca cuando lo necesita y le habla por stdio. Sin dependencias externas, solo Node.js. Tu client
secret y tu sesión se guardan en el almacén de secretos del sistema (Llavero, Secret Service o Administrador de
credenciales). No hay ningún servidor público. **No hace falta saber de terminal:** tu agente te guía paso a paso.

> **English summary:** a zero-dependency, local-only MCP server (stdio) that lets any MCP client — Claude,
> OpenCode, Cursor, VS Code, Codex, Gemini CLI… — search SoundCloud and manage *your own* playlists. Tool
> descriptions are in English and work with any model provider. It speaks MCP 2024-11-05 to 2025-11-25
> (`initialize` handshake) and 2026-07-28 (stateless, `server/discover`). Works on macOS, Linux and Windows:
> secrets live in the OS secret store (Keychain, Secret Service, Credential Manager), never in plain text unless
> you opt in. Setup is guided by your own agent: ask it to "set up SoundCrate" and it calls `setup_status` and
> `start_setup`, which opens a local page where you enter your credentials (they never pass through the chat).
> No downloads, no stream URLs and no playlist deletion, by design. Setup instructions below are in Spanish;
> the client config snippets are universal.

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

**Configuración** (para que el agente te guíe)

| Herramienta | Qué hace |
|---|---|
| `setup_status(verify_session?)` | Comprueba qué falta en este ordenador y devuelve los pasos exactos, uno a uno. |
| `start_setup(open_browser?)` | Abre en tu navegador una página local donde registras la app, pegas el Client ID y el Client Secret y conectas tu cuenta. Los secretos no pasan por el chat. |

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
`SC_GO_PLUS=1` en la configuración de tu cliente (ver «Configuración de cada cliente»). Con eso, `only_listenable: true` en `search_tracks` o
`suggest_tracks` deja `full`, `go_plus` y `go_plus_probable`; sin Go+ declarado deja solo `full`. `whoami` dice si
está declarado, y el servidor se lo explica al modelo en sus instrucciones y en la descripción de esas herramientas.

## Instalación

### 1. Instala Node.js (18 o superior)

| Sistema | Cómo |
|---|---|
| macOS | `brew install node` (o el instalador de <https://nodejs.org>) |
| Windows | `winget install OpenJS.NodeJS.LTS` (o el instalador de <https://nodejs.org>) |
| Linux | El paquete `nodejs` de tu distribución (18 o superior) o <https://nodejs.org> |

### 2. Añade SoundCrate a tu cliente MCP

Copia el bloque de tu cliente de la sección [Configuración de cada cliente](#configuración-de-cada-cliente) y
reinicia el cliente.

### 3. Pídele a tu agente que te ayude

Escribe algo como **«Ayúdame a configurar SoundCrate»**. El agente:

1. Llama a `setup_status`, que comprueba tu sistema y le dice qué falta.
2. Te explica cada paso y, cuando toca, llama a `start_setup`, que abre en tu navegador una página local
   (`http://127.0.0.1:8976/setup`) con todo lo necesario:
   - registrar una app en <https://soundcloud.com/you/apps> (hace falta un plan **Artist Pro** de SoundCloud) con
     la Redirect URI `http://127.0.0.1:8976/callback`;
   - pegar el **Client ID** y el **Client Secret** en la propia página;
   - pulsar **Conectar con SoundCloud** y autorizar.
3. Vuelve a llamar a `setup_status` para confirmar que todo funciona y te pregunta si tienes Go+.

Los secretos van de la página al almacén de tu sistema: nunca pasan por el chat ni por el modelo. La página solo
escucha en tu ordenador, usa un enlace de un solo uso y se cierra al terminar.

### Sin agente: desde la terminal

Abre la misma página con:

```bash
npx -y -p github:C4denaX/soundcrate-mcp soundcrate-login
```

(o `node login.mjs` si has clonado el repo). Si SoundCloud no acepta `127.0.0.1` como Redirect URI, usa
`http://localhost:8976/callback` en la app y define `SC_REDIRECT_URI=http://localhost:8976/callback` tanto al
iniciar sesión como en la configuración del cliente.

### Dónde se guardan los secretos

| Sistema | Almacén | Requisitos |
|---|---|---|
| macOS | Llavero (servicio `soundcloud-mcp`) | Ninguno |
| Windows | Administrador de credenciales (`soundcloud-mcp:client_id`, …) | Ninguno (usa PowerShell, que viene con Windows) |
| Linux | Secret Service: GNOME Keyring, KWallet… | `secret-tool` (paquete `libsecret-tools` en Debian/Ubuntu, `libsecret` en Fedora y Arch) y una sesión de escritorio con llavero |

Los secretos nunca se pasan como argumento de un proceso (se verían con `ps`): siempre por la entrada estándar.

Variables opcionales del servidor:

- `SC_SECRET_STORE=file`: para Linux sin escritorio (servidores, contenedores). Guarda los secretos en
  `~/.config/soundcrate/credentials.json` (`%APPDATA%\soundcrate\credentials.json` en Windows) con permisos 600,
  **sin cifrar**. Úsalo solo si no hay otro remedio. `SC_SECRETS_FILE` cambia la ruta.
- `SC_CLIENT_ID` y `SC_CLIENT_SECRET`: si están definidas, tienen prioridad sobre el almacén (útil en CI).
  El refresh token siempre va al almacén, porque SoundCloud lo cambia en cada renovación.
- `SC_SECRET_SERVICE`: otro nombre de servicio, por ejemplo para usar dos cuentas.

## Configuración de cada cliente

En todos los clientes es lo mismo: un servidor **stdio** que se lanza con `node` y la ruta a `server.mjs`, y la
variable `SC_GO_PLUS=1` si tienes SoundCloud Go+ (quítala si no lo tienes).

- Cambia `/Users/<tu-usuario>/soundcrate-mcp` por la carpeta donde lo clonaste. En Windows, algo como
  `C:\\Users\\<tu-usuario>\\soundcrate-mcp\\server.mjs` (en JSON, con las barras dobles).
- Cambia `/opt/homebrew/bin/node` por la ruta de Node (`which node` en macOS y Linux, `where node` en Windows):
  las apps de escritorio no siempre heredan el `PATH` de la terminal.
- Si no quieres clonar nada, usa la variante con `npx` del final de esta sección.

Después de añadirlo, reinicia el cliente (en macOS, cierra las apps de escritorio del todo con Cmd+Q).

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

La configuración se hace igual: pídesela a tu agente, o desde la terminal con
`npx -y -p github:C4denaX/soundcrate-mcp soundcrate-login`.

## Compatibilidad

- **Protocolo:** MCP 2024-11-05, 2025-03-26, 2025-06-18 y 2025-11-25 (con `initialize`) y 2026-07-28 (sin
  estado, con `server/discover` y la versión en `_meta`). Negocia la versión con cada cliente.
- **Modelos:** las descripciones están en inglés y los esquemas evitan construcciones que algunos proveedores
  rechazan (`$ref`, `oneOf`, descripciones de más de 1.024 caracteres), así que sirven para Claude, GPT,
  Gemini, modelos locales, etc.
- **Sistema operativo:** macOS, Linux y Windows. La integración continua prueba la batería completa en los tres
  y cada almacén real: Llavero, GNOME Keyring con `secret-tool` y Administrador de credenciales.

## Pruebas

```bash
npm test
```

Las pruebas no usan la red ni tus secretos: sustituyen `fetch`, el almacén y los tokens por dobles de prueba
mediante `_setDeps()`. `tests/test7.mjs` lanza el servidor como proceso real y lo ejercita por stdio igual que un
cliente, con las dos generaciones del protocolo; `tests/test8.mjs` prueba los cuatro almacenes y `tests/test9.mjs`
la página de configuración con peticiones HTTP reales (incluidos los ataques que debe rechazar).

Para probar el almacén real de tu sistema con un servicio de prueba que se borra al terminar:

```bash
npm run test:store
```

## Desconectar

Borra la app en <https://soundcloud.com/you/apps> y los secretos guardados:

```bash
# macOS
security delete-generic-password -s soundcloud-mcp -a refresh_token
security delete-generic-password -s soundcloud-mcp -a client_secret
security delete-generic-password -s soundcloud-mcp -a client_id
```

```bash
# Linux
secret-tool clear service soundcloud-mcp account refresh_token
secret-tool clear service soundcloud-mcp account client_secret
secret-tool clear service soundcloud-mcp account client_id
```

```powershell
# Windows
cmdkey /delete:soundcloud-mcp:refresh_token
cmdkey /delete:soundcloud-mcp:client_secret
cmdkey /delete:soundcloud-mcp:client_id
```

Con `SC_SECRET_STORE=file`, borra el fichero `credentials.json`.

## Licencia y créditos

[MIT](LICENSE). SoundCrate no está afiliado a SoundCloud ni respaldado por SoundCloud.

El diseño se inspiró en [marcellkehmstedt/soundcloud-mcp-server](https://github.com/marcellkehmstedt/soundcloud-mcp-server)
(sobre todo el fallo de los IDs largos de pista). Este código está escrito desde cero, sin dependencias y con otra
arquitectura (stdio local en lugar de servidor HTTP).
