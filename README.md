# SoundCrate MCP

**Tus playlists de SoundCloud, curadas con Claude.** Busca pistas, crea playlists privadas y añade,
quita o sustituye pistas hablando con Claude, sin salir de la app.

[![test](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/C4denaX/soundcrate-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Servidor MCP que corre solo en tu Mac y que la app de Claude arranca cuando la necesita.
Sin dependencias externas: solo Node.js. Tu client secret y tu sesión se guardan en el
Llavero de macOS (servicio `soundcloud-mcp`). No hay ningún servidor público.

> **English summary:** a zero-dependency, local-only [MCP](https://modelcontextprotocol.io) server that lets
> the Claude desktop app (macOS) search SoundCloud and manage *your own* playlists. Secrets live in the macOS
> Keychain; nothing is exposed to the internet. No downloads, no stream URLs and no playlist deletion, by design.
> Instructions below are in Spanish.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `search_tracks(query, limit?, include_restricted?)` | Busca pistas. |
| `get_track(track_id \| url)` | Datos de una pista por id o por URL. |
| `whoami(force_refresh?)` | Comprueba la sesión: usuario, plan y suscripciones. |
| `get_my_playlists()` | Tus playlists (sin pistas). |
| `get_playlist(playlist_id)` | Una playlist con sus pistas. |
| `create_playlist(title, description?, track_ids?, public?)` | Crea una playlist, **privada por defecto**. |
| `add_tracks_to_playlist(playlist_id, track_ids[])` | Añade al final sin duplicados. |
| `remove_tracks_from_playlist(playlist_id, track_ids[])` | Quita varias pistas en una sola escritura. |
| `remove_track_from_playlist(playlist_id, track_id)` | Quita una pista. |
| `replace_track_in_playlist(playlist_id, old_track_id, new_track_id)` | Sustituye una pista conservando su posición. |

No incluye descargas ni URLs de streaming (las condiciones de la API de SoundCloud lo prohíben), ni borrado
de playlists, para que un error no pueda destruir nada.

### Cómo protege tus playlists

- La API de SoundCloud **reemplaza la lista entera** al escribir una playlist. Por eso cada cambio lee la
  playlist, la modifica y la escribe, y los cambios sobre una misma playlist van **en cola**, uno detrás de otro,
  aunque Claude los pida en paralelo.
- Si la API oculta alguna pista al leer la playlist (`track_count` mayor que las pistas devueltas), el servidor
  **no escribe nada**, porque reescribirla borraría las pistas que no ve. `get_playlist` lo indica con
  `hidden_by_api`.

### `access`: playable, preview y blocked

El campo `access` de cada pista refleja lo que puede reproducir **la app registrada**, no tu cuenta. Con Go+,
muchas pistas marcadas como `preview` o `blocked` (sobre todo de sellos) se reproducen sin problema en la web y
en la app de SoundCloud, y se pueden añadir a playlists igual que las demás. No las descartes por ese campo.

## 1. Registrar la app en SoundCloud (requiere Artist Pro)

En <https://soundcloud.com/you/apps> → nueva aplicación:

- Nombre: `Claude SoundCloud (personal)`
- Descripción: `Gestión personal de mis playlists desde Claude`
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

Si no está instalado: `brew install node`.

## 4. Iniciar sesión una vez

```bash
git clone https://github.com/C4denaX/soundcrate-mcp.git ~/Claude/soundcrate-mcp
cd ~/Claude/soundcrate-mcp
node login.mjs
```

Se abre SoundCloud, autorizas la app y la Terminal dice "✅ Sesión guardada en el Llavero".

Si SoundCloud no acepta `127.0.0.1` como Redirect URI, pon en la app
`http://localhost:8976/callback` y ejecuta:
`SC_REDIRECT_URI=http://localhost:8976/callback node login.mjs`
(y añade `"env": {"SC_REDIRECT_URI": "http://localhost:8976/callback"}` en el paso 5).

## 5. Conectarlo a la app de Claude

Claude → Ajustes → Desarrollador → Editar configuración (`claude_desktop_config.json`) y añade
(usa la ruta que te dio `which node`):

```json
{
  "mcpServers": {
    "soundcloud": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/<tu-usuario>/Claude/soundcrate-mcp/server.mjs"]
    }
  }
}
```

Si el fichero ya tiene otras entradas en `mcpServers`, añade solo el bloque `"soundcloud"`.
Cierra la app de Claude del todo (Cmd+Q) y vuelve a abrirla.

Tras actualizar `server.mjs`, cierra la app de Claude del todo (Cmd+Q) y vuelve a abrirla para que cargue
la versión nueva.

## Pruebas

```bash
npm test
```

Las pruebas no usan la red ni el Llavero: sustituyen `fetch`, el Llavero y los tokens por dobles de prueba
mediante `_setDeps()`.

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
