// Almacén de secretos multiplataforma, sin dependencias.
//
//   macOS    → Llavero (`security`)
//   Linux    → Secret Service: GNOME Keyring, KWallet… (`secret-tool`, paquete libsecret-tools)
//   Windows  → Administrador de credenciales (PowerShell, que viene con Windows, llamando a CredRead/CredWrite)
//   file     → solo si se pide con SC_SECRET_STORE=file: JSON con permisos 600 fuera del repo, SIN cifrar
//
// Los secretos nunca se pasan como argumento de un proceso (se verían con `ps`): siempre por stdin.
// SC_SECRET_STORE fuerza un almacén y SC_SECRET_SERVICE cambia el nombre del servicio (por defecto soundcloud-mcp).

import { spawnSync } from "node:child_process";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";

// Error de configuración: el servidor lo convierte en "llama a setup_status" para que el agente guíe al usuario.
export class SetupError extends Error {
  constructor(message, fix) {
    super(message);
    this.name = "SetupError";
    this.setup = true;
    if (fix) this.fix = fix;
  }
}

export const STORES = ["keychain", "secret-service", "wincred", "file"];
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
// Las credenciales de SoundCloud son ASCII; así se evita que el Llavero devuelva hexadecimal al leer.
const SAFE_VALUE = /^[\x20-\x7E]{1,4096}$/;

function checkName(name, what) {
  if (!SAFE_NAME.test(name)) throw new Error(`Invalid ${what}: ${name}`);
}
function checkValue(value) {
  if (typeof value !== "string" || !SAFE_VALUE.test(value)) {
    throw new Error("Secrets must be 1-4096 printable ASCII characters.");
  }
}

// Ejecuta un comando sin shell. El secreto, si hay, va por stdin.
export function defaultRun(cmd, args, { input, env, timeout = 20000 } = {}) {
  const r = spawnSync(cmd, args, {
    input,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    missing: r.error?.code === "ENOENT",
    error: r.error || null,
  };
}

const stripNewline = (s) => s.replace(/\r?\n$/, "");

// ---------- macOS: Llavero ----------
function keychain({ run, service }) {
  return {
    name: "keychain",
    label: "macOS Keychain",
    get(account) {
      const r = run("security", ["find-generic-password", "-s", service, "-a", account, "-w"]);
      if (r.status === 0) return stripNewline(r.stdout);
      if (r.status === 44) return null; // errSecItemNotFound
      throw new Error(`macOS Keychain read failed (${r.status}): ${r.stderr.trim().slice(0, 200)}`);
    },
    set(account, value) {
      checkValue(value);
      // `security -i` lee órdenes por stdin; con -X el valor va en hexadecimal (sin problemas de comillas).
      const hex = Buffer.from(value, "utf8").toString("hex");
      const r = run("security", ["-i"], { input: `add-generic-password -U -s ${service} -a ${account} -X ${hex}\n` });
      if (r.missing) throw new SetupError("The macOS `security` tool was not found.");
      if (this.get(account) !== value) throw new Error(`macOS Keychain write failed: ${r.stderr.trim().slice(0, 200)}`);
    },
    del(account) {
      const r = run("security", ["delete-generic-password", "-s", service, "-a", account]);
      return r.status === 0;
    },
    probe() {
      const r = run("security", ["find-generic-password", "-s", service, "-a", "__probe__", "-w"]);
      if (r.missing) return { ok: false, problem: "The macOS `security` tool was not found." };
      return { ok: r.status === 0 || r.status === 44, problem: r.status === 0 || r.status === 44 ? null : r.stderr.trim() };
    },
  };
}

// ---------- Linux: Secret Service ----------
const LINUX_INSTALL = [
  "Debian/Ubuntu: sudo apt install libsecret-tools gnome-keyring",
  "Fedora: sudo dnf install libsecret gnome-keyring",
  "Arch: sudo pacman -S libsecret gnome-keyring",
  "openSUSE: sudo zypper install libsecret-tools gnome-keyring",
];
const LINUX_NO_SERVICE =
  "No Secret Service is running (common on servers or minimal desktops without GNOME Keyring or KWallet). " +
  "Start a desktop session with a keyring, or, if you accept an unencrypted file protected by file permissions, " +
  "set SC_SECRET_STORE=file in the MCP server environment.";

function secretService({ run, service }) {
  const fail = (r) => {
    if (r.missing) throw new SetupError("secret-tool is not installed.", LINUX_INSTALL);
    throw new SetupError(`${LINUX_NO_SERVICE} (${r.stderr.trim().slice(0, 160)})`);
  };
  return {
    name: "secret-service",
    label: "Linux Secret Service (GNOME Keyring / KWallet)",
    get(account) {
      const r = run("secret-tool", ["lookup", "service", service, "account", account]);
      if (r.status === 0) return stripNewline(r.stdout);
      if (r.status === 1 && !r.stderr.trim()) return null; // no existe
      return fail(r);
    },
    set(account, value) {
      checkValue(value);
      const r = run("secret-tool", ["store", "--label", `SoundCrate (${account})`, "service", service, "account", account], { input: value });
      if (r.status !== 0) fail(r);
    },
    del(account) {
      const r = run("secret-tool", ["clear", "service", service, "account", account]);
      return r.status === 0;
    },
    probe() {
      const r = run("secret-tool", ["lookup", "service", service, "account", "__probe__"]);
      if (r.missing) return { ok: false, problem: "secret-tool is not installed.", fix: LINUX_INSTALL };
      if (r.status === 0 || (r.status === 1 && !r.stderr.trim())) return { ok: true, problem: null };
      return { ok: false, problem: LINUX_NO_SERVICE, detail: r.stderr.trim().slice(0, 200) };
    },
  };
}

// ---------- Windows: Administrador de credenciales ----------
// PowerShell compila una pequeña clase que llama a CredReadW/CredWriteW/CredDeleteW de advapi32.
// La operación y el nombre van en variables de entorno (no son secretos); el secreto va por stdin en base64.
const WINCRED_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class SoundCrateCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) {
      int e = Marshal.GetLastWin32Error();
      if (e == 1168) return null;
      throw new Win32Exception(e);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) return "";
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string secret) {
    byte[] b = Encoding.Unicode.GetBytes(secret);
    IntPtr blob = Marshal.AllocHGlobal(b.Length);
    try {
      Marshal.Copy(b, 0, blob, b.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
      c.CredentialBlobSize = b.Length; c.CredentialBlob = blob;
      if (!CredWrite(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(blob); }
  }
  public static bool Delete(string target) {
    if (CredDelete(target, 1, 0)) return true;
    int e = Marshal.GetLastWin32Error();
    if (e == 1168) return false;
    throw new Win32Exception(e);
  }
}
'@
$t = $env:SC_CRED_TARGET
switch ($env:SC_CRED_OP) {
  'get' {
    $v = [SoundCrateCred]::Read($t)
    if ($null -eq $v) { exit 3 }
    [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)))
  }
  'set' {
    $in = [Console]::In.ReadToEnd().Trim()
    [SoundCrateCred]::Write($t, $env:SC_CRED_USER, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in)))
  }
  'del' { if (-not [SoundCrateCred]::Delete($t)) { exit 3 } }
  'probe' { [void][SoundCrateCred]::Read($t) }
}
`;
const WINCRED_ENCODED = Buffer.from(WINCRED_PS, "utf16le").toString("base64");

function wincred({ run, service }) {
  const ps = (op, account, input) =>
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", WINCRED_ENCODED], {
      input,
      env: { SC_CRED_OP: op, SC_CRED_TARGET: `${service}:${account}`, SC_CRED_USER: account },
      timeout: 60000, // Add-Type compila la clase en cada llamada (1-3 s)
    });
  const fail = (r, what) => {
    if (r.missing) throw new SetupError("PowerShell (powershell.exe) was not found; it ships with Windows, check that it is on PATH.");
    throw new Error(`Windows Credential Manager ${what} failed (${r.status}): ${r.stderr.trim().slice(0, 300)}`);
  };
  return {
    name: "wincred",
    label: "Windows Credential Manager",
    get(account) {
      const r = ps("get", account);
      if (r.status === 0) return Buffer.from(r.stdout.trim(), "base64").toString("utf8");
      if (r.status === 3) return null;
      return fail(r, "read");
    },
    set(account, value) {
      checkValue(value);
      const r = ps("set", account, Buffer.from(value, "utf8").toString("base64"));
      if (r.status !== 0) fail(r, "write");
    },
    del(account) {
      return ps("del", account).status === 0;
    },
    probe() {
      const r = ps("probe", "__probe__");
      if (r.missing) return { ok: false, problem: "PowerShell (powershell.exe) was not found." };
      return { ok: r.status === 0, problem: r.status === 0 ? null : r.stderr.trim().slice(0, 300) };
    },
  };
}

// ---------- Fichero (solo bajo petición) ----------
export function defaultFilePath(env = process.env, platform = process.platform, os = nodeOs) {
  if (env.SC_SECRETS_FILE) return env.SC_SECRETS_FILE;
  // Separadores del sistema de destino (no del que ejecuta), para que la ruta sea siempre coherente.
  const path = platform === "win32" ? nodePath.win32 : nodePath.posix;
  if (platform === "win32") return path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "soundcrate", "credentials.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "soundcrate", "credentials.json");
}

function fileStore({ service, env, platform, fs = nodeFs }) {
  const file = defaultFilePath(env, platform);
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw new Error(`Could not read ${file}: ${e.message}`);
    }
  };
  const write = (data) => {
    fs.mkdirSync(nodePath.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
  };
  return {
    name: "file",
    // En Windows no hay permisos 600: el fichero queda dentro del perfil del usuario.
    label: `Unencrypted file ${file} (${platform === "win32" ? "inside your user profile" : "permissions 600"})`,
    file,
    get(account) {
      return read()?.[service]?.[account] ?? null;
    },
    set(account, value) {
      checkValue(value);
      const d = read();
      d[service] = { ...(d[service] || {}), [account]: value };
      write(d);
    },
    del(account) {
      const d = read();
      if (!d[service] || !(account in d[service])) return false;
      delete d[service][account];
      write(d);
      return true;
    },
    probe() {
      const guard = platform === "win32" ? "the user profile's access rules" : "file permissions";
      return { ok: true, problem: null, warning: `Secrets are stored unencrypted in ${file}, protected only by ${guard}.` };
    },
  };
}

// ---------- Selección ----------
export function storeName(env = process.env, platform = process.platform) {
  const forced = String(env.SC_SECRET_STORE || "").trim().toLowerCase();
  if (forced) {
    if (!STORES.includes(forced)) {
      throw new SetupError(`Unknown SC_SECRET_STORE "${forced}". Use one of: ${STORES.join(", ")}.`);
    }
    return forced;
  }
  return platform === "darwin" ? "keychain" : platform === "win32" ? "wincred" : "secret-service";
}

export function createStore({ env = process.env, platform = process.platform, run = defaultRun, fs } = {}) {
  const service = env.SC_SECRET_SERVICE || "soundcloud-mcp";
  checkName(service, "SC_SECRET_SERVICE");
  const name = storeName(env, platform);
  const make = { keychain, "secret-service": secretService, wincred, file: fileStore }[name];
  const store = make({ run, service, env, platform, fs });
  const wrap = (fn) => (account, ...rest) => {
    checkName(account, "account");
    return fn.call(store, account, ...rest);
  };
  return { ...store, service, get: wrap(store.get), set: wrap(store.set), del: wrap(store.del) };
}
