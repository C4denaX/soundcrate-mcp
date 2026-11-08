<p align="center"><img src="icon.png" width="112" alt="Icono de SoundCrate"></p>

<h1 align="center">SoundCrate</h1>

<p align="center"><b>Rebusca en SoundCloud y da forma a tus playlists hablando con tu asistente de IA.</b></p>

<p align="center">
<a href="https://github.com/C4denaX/soundcrate-mcp/releases/latest"><img src="https://img.shields.io/github/v/release/C4denaX/soundcrate-mcp?label=versi%C3%B3n" alt="Última versión"></a>
<a href="https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml"><img src="https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml/badge.svg" alt="Pruebas"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-blue.svg" alt="Licencia MIT"></a>
<br><a href="README.md">Read in English</a>
</p>

SoundCrate conecta Claude (o cualquier otro asistente de IA compatible con [MCP](https://modelcontextprotocol.io))
con **tu propia cuenta de SoundCloud**. Pídeselo con tus palabras: busca pistas por género, tempo, tonalidad o
fecha, encuentra pistas y artistas parecidos, crea playlists privadas y las ordena como lo haría un DJ.

> «Busca techno de 128 a 132 BPM subido este año y hazme una playlist privada de dos horas en tonalidades compatibles».
>
> «Coge estas tres pistas, busca relacionadas que no estén ya en mi playlist *Warm-up* y propónme diez».
>
> «Analiza mi playlist *Peak time* y dime dónde salta el tempo o chocan las tonalidades».

Funciona en tu ordenador, guarda tus credenciales en el almacén seguro de tu sistema y nunca borra una playlist.

## Qué necesitas

- Una **cuenta de SoundCloud** con el plan **Artist Pro**. SoundCrate habla con SoundCloud a través de una "app"
  tuya de SoundCloud, y SoundCloud solo deja crearlas a las cuentas Artist Pro.
- Una de estas opciones:
  - **Claude Desktop** en macOS o Windows. No hace falta instalar nada más.
  - **Claude Code, Cowork u otra app MCP** (Cursor, VS Code, OpenCode, Codex, Gemini CLI…), y además
    [Node.js](https://nodejs.org) 18 o superior. Funciona en macOS, Windows y Linux.

## Instalación

### Claude Desktop (lo más fácil, sin conocimientos técnicos)

1. **[Descarga soundcrate.mcpb](https://github.com/C4denaX/soundcrate-mcp/releases/latest/download/soundcrate.mcpb)**.
2. Haz **doble clic** en el fichero (o arrástralo a la ventana de Claude) y elige **Instalar**. Si tienes
   SoundCloud Go+, activa **I have SoundCloud Go+**.
3. Abre un chat nuevo y escribe: **Ayúdame a configurar SoundCrate**. Claude te guía en el resto
   ([qué pasa después](#primera-configuración)).

Para actualizar, descarga el fichero de nuevo y ábrelo.

### Claude Code

Escribe esto en Claude Code:

```text
/plugin install soundcrate --marketplace C4denaX/soundcrate-mcp
```

O pídeselo sin más: *«Instala el plugin SoundCrate del marketplace C4denaX/soundcrate-mcp»*. Después di
**Ayúdame a configurar SoundCrate**. Necesita Node.js 18 o superior.

### Cowork

En Claude Desktop, abre **Personalizar > Plugins**, añade el marketplace `C4denaX/soundcrate-mcp` e instala
**SoundCrate**. Funciona en las sesiones de Cowork que se ejecutan en tu ordenador. Necesita Node.js 18 o superior.

> [!NOTE]
> Claude en la web y en el móvil no puede ejecutar programas en tu ordenador, así que ahí SoundCrate no está
> disponible. Usa Claude Desktop.

### VS Code

[![Instalar en VS Code](https://img.shields.io/badge/VS_Code-Instalar_SoundCrate-0098FF?logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522soundcrate%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522github%253AC4denaX%252Fsoundcrate-mcp%2523v1.7.0%2522%255D%257D)

Pulsa el botón, revisa el servidor e instálalo. Necesita Node.js y Git. Para declarar Go+, añade
`"env": { "SC_GO_PLUS": "1" }` al servidor en tu `mcp.json`.

### Otras apps

Todas las apps MCP necesitan lo mismo: un servidor **stdio** que se arranca con
`npx -y github:C4denaX/soundcrate-mcp#v1.7.0` (necesita Node.js y Git), y `SC_GO_PLUS=1` si tienes Go+. Elige tu app:

<details>
<summary><b>Cursor, Windsurf, Cline, Gemini CLI y otras apps con un fichero <code>mcpServers</code></b></summary>

Cursor: `~/.cursor/mcp.json` · Gemini CLI: `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "soundcrate": {
      "command": "npx",
      "args": ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```

En Gemini CLI también vale:
`gemini mcp add --scope user -e SC_GO_PLUS=1 soundcrate npx -y github:C4denaX/soundcrate-mcp#v1.7.0`
</details>

<details>
<summary><b>OpenCode</b></summary>

`~/.config/opencode/opencode.json` (u `opencode.jsonc`):

```json
{
  "mcp": {
    "soundcrate": {
      "type": "local",
      "command": ["npx", "-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "environment": { "SC_GO_PLUS": "1" },
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

`~/.codex/config.toml`:

```toml
[mcp_servers.soundcrate]
command = "npx"
args = ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"]
env = { SC_GO_PLUS = "1" }
```

O bien: `codex mcp add soundcrate --env SC_GO_PLUS=1 -- npx -y github:C4denaX/soundcrate-mcp#v1.7.0`
</details>

<details>
<summary><b>Claude Desktop, configurado a mano</b></summary>

Ajustes > Desarrollador > Editar configuración (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "soundcrate": {
      "command": "npx",
      "args": ["-y", "github:C4denaX/soundcrate-mcp#v1.7.0"],
      "env": { "SC_GO_PLUS": "1" }
    }
  }
}
```
</details>

<details>
<summary><b>Sin npx (desde una copia clonada)</b></summary>

```bash
git clone https://github.com/C4denaX/soundcrate-mcp.git
```

Después usa `node` como comando y la ruta completa a `server.mjs` como argumento, por ejemplo
`"command": "/opt/homebrew/bin/node", "args": ["/Users/tu-usuario/soundcrate-mcp/server.mjs"]`. Las apps de
escritorio no siempre ven el `PATH` de la terminal, así que pon la ruta completa de `node` (`which node` en macOS
y Linux, `where node` en Windows).
</details>

Después de añadir SoundCrate, reinicia la app (en macOS, ciérrala del todo con Cmd+Q).

## Primera configuración

Pídele a tu asistente: **Ayúdame a configurar SoundCrate.** Comprueba tu ordenador con `setup_status` y te
explica cada paso. Cuando toca, abre una página de configuración en tu navegador. La página solo existe en tu
ordenador (`http://127.0.0.1:8976`) y tiene tres pasos:

1. **Registrar una app de SoundCloud.** Enlaza a <https://soundcloud.com/you/apps> y te dice exactamente qué
   poner, incluida la **Redirect URI** `http://127.0.0.1:8976/callback`.
2. **Pegar el Client ID y el Client Secret de la app.** Van directos al almacén seguro de tu sistema.
3. **Pulsar «Conectar con SoundCloud»** y autorizar la app.

Y ya está. Tus secretos nunca pasan por el chat ni por el modelo de IA, y la página se cierra al terminar.

¿Prefieres la terminal? `npx -y -p github:C4denaX/soundcrate-mcp#v1.7.0 soundcrate-login` abre la misma página.

## Qué puedes pedirle

- **Descubrir:** «Pistas parecidas a esta», «¿Qué han repostado este mes los DJs que sigo?», «Artistas como
  Amelie Lens y sus últimas subidas», «Busca playlists de melodic techno».
- **Construir:** «Hazme una playlist privada con estas pistas», «Añade las cinco mejores sugerencias a
  *Warm-up*», «Cambia este bootleg por la versión oficial».
- **Preparar un set:** «Ordena *Peak time* por BPM», «Ordénala por tonalidad Camelot», «¿Dónde chocan las
  tonalidades?».
- **Ordenar:** «Busca duplicados en esta playlist», «Cámbiale el nombre y ponle el género Techno».

Cada pista trae BPM, tonalidad y su código **Camelot** (para mezclar en armonía), género, sello, fecha de
lanzamiento, reproducciones y likes.

## Cómo protege tu música

- Las playlists nuevas son **privadas** salvo que pidas lo contrario.
- SoundCrate **no puede borrar playlists** ni descargar audio.
- Los cambios en una misma playlist se aplican **de uno en uno**, así que las peticiones en paralelo no pierden
  pistas.
- Si SoundCloud oculta alguna pista al leer una playlist, SoundCrate **se niega a escribir** en ella, porque
  reescribirla las borraría.
- Reordenar nunca añade ni quita pistas; si SoundCloud devuelve otro conjunto, se restaura el orden anterior.
- Las herramientas que escriben están marcadas como tales, así que las apps que lo admiten te piden confirmación
  antes de cambiar una playlist.

## Go+ y lo que puedes escuchar

La API de SoundCloud marca las pistas como `playable`, `preview` o `blocked`, pero eso describe lo que pueden
reproducir *las apps*, no lo que puedes escuchar *tú*. SoundCrate añade el campo `listen`:

| `listen` | Qué significa |
|---|---|
| `full` | Suena entera para cualquiera. |
| `go_plus` | Un fragmento sin suscripción; entera con Go+. |
| `go_plus_probable` | Catálogo de sello que con Go+ suele sonar entero en SoundCloud (sin garantía en todos los países). |
| `restricted` | Bloqueada por derechos, región o por quien la subió; puede no sonar ni con Go+. |

SoundCloud no informa de si tienes Go+, así que se lo dices tú a SoundCrate (el interruptor **I have SoundCloud
Go+** o `SC_GO_PLUS=1`). Así puedes pedirle «solo pistas que pueda escuchar enteras».

## Privacidad y seguridad

SoundCrate no tiene servidor, cuenta, telemetría ni analítica. Solo habla con SoundCloud, desde tu ordenador.
Los detalles están en la [política de privacidad](PRIVACY.md) (en inglés).

| Sistema | Dónde se guardan tus credenciales |
|---|---|
| macOS | Llavero (servicio `soundcloud-mcp`) |
| Windows | Administrador de credenciales (`soundcloud-mcp:client_id`, …) |
| Linux | Secret Service: GNOME Keyring o KWallet, mediante `secret-tool` |

Los secretos nunca se pasan como argumentos de un programa (donde otros programas podrían verlos). Ajustes
opcionales:

- `SC_SECRET_STORE=file`: para Linux sin llavero. Guarda los secretos **sin cifrar** en
  `~/.config/soundcrate/credentials.json`, legible solo por ti. Úsalo solo si no hay otra opción.
- `SC_CLIENT_ID` / `SC_CLIENT_SECRET`: las credenciales de la app desde el entorno (útil en CI).
- `SC_SECRET_SERVICE`: otro nombre de almacén, por ejemplo para usar dos cuentas.

## Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| El asistente no ve SoundCrate | Reinicia la app del todo. En Claude Desktop, revisa **Ajustes > Extensiones**. |
| «SoundCrate is not set up yet» | Di **Ayúdame a configurar SoundCrate**. |
| No se abre la página de configuración | Pide al asistente el enlace y ábrelo en el navegador de ese mismo ordenador. |
| «Port 8976 is busy» | Cierra cualquier otra página de configuración o inicio de sesión de SoundCrate y vuelve a intentarlo. |
| SoundCloud rechaza la Redirect URI | Pon `http://localhost:8976/callback` en tu app de SoundCloud y define `SC_REDIRECT_URI=http://localhost:8976/callback` para SoundCrate. |
| Linux: «secret-tool is not installed» | Instálalo: `sudo apt install libsecret-tools gnome-keyring` (Debian/Ubuntu), `sudo dnf install libsecret` (Fedora), `sudo pacman -S libsecret` (Arch). |
| «The saved session is no longer valid» | Di **Vuelve a conectar SoundCrate** y conecta de nuevo en la página de configuración. |
| `npx` falla con un error de Git | Instala [Git](https://git-scm.com) o usa la opción de [copia clonada](#otras-apps). |

## Desinstalar

1. Quita SoundCrate de tu app (Claude Desktop: **Ajustes > Extensiones**; Claude Code: `/plugin uninstall soundcrate`).
2. Borra tu app de SoundCloud en <https://soundcloud.com/you/apps>.
3. Borra los secretos guardados:

<details>
<summary>Comandos para macOS, Linux y Windows</summary>

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
</details>

## Herramientas

<details>
<summary>Las 23 herramientas</summary>

| Herramienta | Qué hace |
|---|---|
| `setup_status` | Comprueba qué falta en este ordenador y devuelve el siguiente paso. |
| `start_setup` | Abre la página local de configuración (credenciales e inicio de sesión en SoundCloud). |
| `search_tracks` | Busca por texto, géneros, etiquetas, BPM, duración y fecha de subida (hasta 200 por página). |
| `get_track` | Una pista por id o URL. |
| `get_related_tracks` | Pistas relacionadas según SoundCloud, quitando si quieres las de una playlist. |
| `get_my_tracks` | Tus likes, lo último escuchado, tu feed, las subidas de quien sigues o tus reposts. |
| `search_users` | Busca artistas, sellos o DJs. |
| `get_related_artists` | Artistas parecidos. |
| `get_user_content` | Pistas, likes, reposts o playlists de un artista. |
| `search_playlists` | Playlists públicas de cualquiera. |
| `get_station` | Una emisora de SoundCloud con sus pistas. |
| `suggest_tracks` | Candidatas a partir de 1 a 5 pistas semilla, sin duplicados, filtradas y ordenadas (incluida la armonía). Solo lectura. |
| `find_official_version` | Candidatas a la versión oficial de una subida de usuario, con motivos. |
| `analyze_playlist` | Duración, BPM, tonalidades, géneros, duplicados, saltos de BPM y choques de tonalidad. |
| `whoami` | Tu cuenta y si has declarado Go+. |
| `get_my_playlists` | Tus playlists (privadas incluidas), las que te gustan o tus emisoras; filtra por título. |
| `get_playlist` | Una playlist con sus pistas, por id o URL. |
| `create_playlist` | Crea una playlist, privada por defecto. |
| `add_tracks_to_playlist` | Añade pistas al final, sin duplicados. |
| `remove_tracks_from_playlist` | Quita varias pistas en una sola escritura. |
| `remove_track_from_playlist` | Quita una pista. |
| `replace_track_in_playlist` | Sustituye una pista conservando su posición. |
| `update_playlist` | Cambia título, descripción, género o etiquetas, y reordena por BPM, tonalidad Camelot, duración, fecha o un orden dado. |
</details>

## Para desarrolladores

- Sin dependencias: Node.js ESM (`server.mjs`) por stdio.
- Habla MCP 2024-11-05 a 2025-11-25 (`initialize`) y 2026-07-28 (sin estado, `server/discover`).
- Las descripciones de las herramientas están en inglés, por debajo de 1.024 caracteres y con esquemas planos que
  aceptan OpenAI, Gemini y los modelos locales.
- `npm test` ejecuta diez baterías sin red (protocolo con un proceso stdio real, almacenes de secretos, la página
  de configuración con HTTP real, ficheros de distribución). `npm run test:store` prueba el almacén real de tu
  sistema con una entrada desechable. La CI lo ejecuta todo en Linux, macOS y Windows con los almacenes reales.
- Distribución: `manifest.json` (extensión de Claude Desktop, empaquetada con `@anthropic-ai/mcpb`),
  `.claude-plugin/` + `.mcp.json` + `skills/` (plugin y marketplace de Claude), `bin` de `package.json` (npx).
- Publicar una versión: sube la versión en `package.json`, `manifest.json`, `.claude-plugin/plugin.json` y
  `server.mjs` (`tests/test10.mjs` comprueba que coinciden) y sube una etiqueta `vX.Y.Z`. El flujo de release
  publica `soundcrate.mcpb`.

## Licencia y créditos

[MIT](LICENSE) © Sergio Ruiz. SoundCrate no está afiliado a SoundCloud ni respaldado o patrocinado por SoundCloud.

Inspirado en [marcellkehmstedt/soundcloud-mcp-server](https://github.com/marcellkehmstedt/soundcloud-mcp-server)
(sobre todo su arreglo para los IDs largos de pista). Este código está escrito desde cero, sin dependencias y con
otra arquitectura (stdio local en lugar de un servidor HTTP).
