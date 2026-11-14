import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanUser, NO_OPENSSH, type PcSshKey, type PcSshOpenSsh, type PcSshReport } from '../shared/pc-ssh.ts'

// Order o1fa0: what this PC's OpenSSH is, as its own agent can see it. READ ONLY: a few commands that only report (systemctl show, sc.exe query/qc,
// netstat, `sshd -T`, `tailscale debug prefs`) and reading files. Nothing is started, stopped, written or changed. The agent is not root/administrator:
// `sshd -T` needs the host keys, so it usually refuses; then the config files are read the way sshd reads them (Include in place, the first value
// wins, Port/ListenAddress/AllowUsers add up, Match blocks are left out). Public keys: type, fingerprint and comment only, never the key itself.

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  /** The program is not there (ENOENT). */
  missing: boolean
}
export interface SshReadDeps {
  platform: string
  exec(file: string, args: string[], timeoutMs: number): Promise<ExecResult>
  /** Rejects with an error whose `code` says why (ENOENT, EACCES, EPERM …). */
  readFile(file: string): Promise<string>
  listDir(dir: string): Promise<string[]>
  exists(file: string): Promise<boolean>
  /** `tailscale <args>` through the app's own runner (it finds the program). */
  tailscale(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>
  home: string
  user: string
  programData: string
  systemRoot: string
}

export interface SshdSettings {
  ports: number[]
  listen: string[]
  password: boolean | null
  kbd: boolean | null
  usePam: boolean | null
  root: PcSshOpenSsh['rootLogin']
  allowUsers: string[]
  allowGroups: string[]
  keysFiles: string[] | null
}
const emptySettings = (): SshdSettings => ({ ports: [], listen: [], password: null, kbd: null, usePam: null, root: null, allowUsers: [], allowGroups: [], keysFiles: null })

const yesNo = (v: string | undefined): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null)
const rootOf = (v: string | undefined): PcSshOpenSsh['rootLogin'] =>
  v === 'without-password' ? 'prohibit-password' : v === 'no' || v === 'prohibit-password' || v === 'forced-commands-only' || v === 'yes' ? v : null

/** One keyword line as sshd splits it ("Keyword value…" or "Keyword=value…"); null for a comment or an empty line. */
function splitLine(line: string): { key: string; args: string[] } | null {
  const t = line.trim()
  if (!t || t.startsWith('#')) return null
  const m = /^([A-Za-z0-9]+)\s*(?:=\s*|\s+)(.*)$/.exec(t)
  if (!m) return { key: t.toLowerCase(), args: [] }
  const args = m[2].match(/"[^"]*"|\S+/g)?.map(a => a.replace(/^"(.*)"$/, '$1')) ?? []
  return { key: m[1].toLowerCase(), args }
}

/** Takes one setting into `s` the way sshd does: the first value wins, these add up. */
function take(s: SshdSettings, key: string, args: string[]) {
  const first = args[0]?.toLowerCase()
  switch (key) {
    case 'port':
      for (const a of args) if (/^\d{1,5}$/.test(a) && Number(a) >= 1 && Number(a) <= 65535) s.ports.push(Number(a))
      break
    case 'listenaddress':
      if (args[0]) s.listen.push(args[0])
      break
    case 'passwordauthentication':
      if (s.password === null) s.password = yesNo(first)
      break
    case 'kbdinteractiveauthentication':
    case 'challengeresponseauthentication':
      if (s.kbd === null) s.kbd = yesNo(first)
      break
    case 'usepam':
      if (s.usePam === null) s.usePam = yesNo(first)
      break
    case 'permitrootlogin':
      if (s.root === null) s.root = rootOf(first)
      break
    case 'allowusers':
      s.allowUsers.push(...args)
      break
    case 'allowgroups':
      s.allowGroups.push(...args)
      break
    case 'authorizedkeysfile':
      if (s.keysFiles === null) s.keysFiles = args.filter(a => a.toLowerCase() !== 'none')
      break
  }
}

/** `sshd -T` (sshd's own answer: one "keyword value" line each, keywords in lower case). */
export function parseSshdT(text: string): SshdSettings {
  const s = emptySettings()
  for (const line of text.split(/\r?\n/)) {
    const l = splitLine(line)
    if (!l) continue
    // sshd -T prints AllowUsers one user per line and ListenAddress as "host:port"; each line is one value.
    if (l.key === 'authorizedkeysfile') s.keysFiles = l.args.filter(a => a.toLowerCase() !== 'none')
    else take(s, l.key, l.args)
  }
  return s
}

/** The config files as sshd reads them, from the main one. `unreadable` lists the files that could not be read. */
export async function readSshdConfig(main: string, d: Pick<SshReadDeps, 'readFile' | 'listDir' | 'platform'>): Promise<{ settings: SshdSettings; read: string[]; unreadable: string[]; missing: boolean }> {
  const P = d.platform === 'win32' ? path.win32 : path.posix
  const base = P.dirname(main)
  const s = emptySettings()
  const read: string[] = []
  const unreadable: string[] = []
  let missing = false
  const visit = async (file: string, depth: number) => {
    if (depth > 8) return
    let text: string
    try {
      text = await d.readFile(file)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'ENOENT') {
        if (depth === 0) missing = true
      } else unreadable.push(file)
      return
    }
    read.push(file)
    let inMatch = false
    for (const line of text.split(/\r?\n/)) {
      const l = splitLine(line)
      if (!l) continue
      if (l.key === 'match') {
        // "Match all" brings the settings back to everyone; any other Match is for some connections only, so it is left out.
        inMatch = !(l.args.length === 1 && l.args[0].toLowerCase() === 'all')
        continue
      }
      if (inMatch) continue
      if (l.key === 'include') {
        for (const pattern of l.args) for (const f of await expand(P.isAbsolute(pattern) ? pattern : P.join(base, pattern))) await visit(f, depth + 1)
        continue
      }
      take(s, l.key, l.args)
    }
  }
  const expand = async (pattern: string): Promise<string[]> => {
    const dir = P.dirname(pattern)
    const name = P.basename(pattern)
    if (!/[*?]/.test(name)) return [pattern]
    const re = new RegExp('^' + name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    try {
      return (await d.listDir(dir)).filter(f => re.test(f)).sort().map(f => P.join(dir, f))
    } catch {
      return []
    }
  }
  await visit(main, 0)
  return { settings: s, read, unreadable, missing }
}

const KEY_TYPE = /^(?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com|ssh-(?:ed25519|rsa)-cert-v01@openssh\.com)$/

/** One public key's fingerprint as ssh-keygen -lf prints it: SHA256 of the key's bytes, base64 without padding. */
export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

/** An authorized_keys file → type, fingerprint and comment of each key (options before the key are skipped). The key material never leaves here. */
export function parseAuthorizedKeys(text: string): PcSshKey[] {
  const out: PcSshKey[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const tokens = t.match(/"[^"]*"|\S+/g) ?? []
    for (let i = 0; i < tokens.length - 1; i++) {
      if (!KEY_TYPE.test(tokens[i]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(tokens[i + 1])) continue
      const blob = Buffer.from(tokens[i + 1], 'base64')
      // A real key starts with its own type name: anything else is not one.
      const n = blob.length >= 4 ? blob.readUInt32BE(0) : -1
      if (n <= 0 || n > 64 || blob.subarray(4, 4 + n).toString('latin1') !== tokens[i]) continue
      const rest = tokens.slice(i + 2).join(' ').trim()
      const comment = rest ? [...rest].filter(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').slice(0, 120) || null : null
      out.push({ type: tokens[i], fingerprint: fingerprintOf(blob), comment })
      break
    }
  }
  return out
}

/** `systemctl show -p Id -p LoadState -p ActiveState -p UnitFileState <units>` → each unit's states, by its Id. */
export function parseSystemdShow(text: string): Map<string, { load: string; active: string; file: string }> {
  const out = new Map<string, { load: string; active: string; file: string }>()
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const v = Object.fromEntries(block.split(/\r?\n/).map(l => l.split('=')).filter(p => p.length >= 2).map(([k, ...r]) => [k.trim(), r.join('=').trim()]))
    if (v.Id) out.set(v.Id, { load: v.LoadState ?? '', active: v.ActiveState ?? '', file: v.UnitFileState ?? '' })
  }
  return out
}

/** Listening addresses on some ports from Windows' `netstat -ano` ("0.0.0.0:2222", "[::]:2222"). */
export function listensFromNetstat(text: string, ports: readonly number[]): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\[[^\]]+\]|[\d.]+):(\d+)\s+\S+\s+LISTENING\s+\d+\s*$/.exec(line)
    if (m && ports.includes(Number(m[2]))) out.push(`${m[1]}:${m[2]}`)
  }
  return [...new Set(out)]
}

/** Listening addresses on some ports from Linux's /proc/net/tcp (or tcp6). */
export function listensFromProcNet(text: string, ports: readonly number[], v6: boolean): string[] {
  const out: string[] = []
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 4 || f[3] !== '0A') continue
    const [hex, portHex] = f[1].split(':')
    const port = parseInt(portHex, 16)
    if (!ports.includes(port)) continue
    const bytes: number[] = []
    // The kernel prints each 32-bit word in the host's byte order (little-endian on x86/ARM).
    for (let w = 0; w < hex.length; w += 8) {
      const word = hex.slice(w, w + 8)
      for (let b = 6; b >= 0; b -= 2) bytes.push(parseInt(word.slice(b, b + 2), 16))
    }
    if (bytes.some(Number.isNaN)) continue
    if (!v6) out.push(`${bytes.join('.')}:${port}`)
    else {
      const groups = Array.from({ length: 8 }, (_, i) => ((bytes[2 * i] << 8) | bytes[2 * i + 1]).toString(16))
      out.push(`${new URL(`http://[${groups.join(':')}]`).hostname}:${port}`)
    }
  }
  return [...new Set(out)]
}

/** The user an ssh command logs in as: the first plain AllowUsers name (no pattern, no host), else this agent's own user. */
export function loginUser(allowUsers: readonly string[], own: string): string | null {
  const plain = allowUsers.find(u => /^[A-Za-z0-9._$-]+$/.test(u))
  return cleanUser(plain ?? own) ? (plain ?? own) : null
}

export type SshFacts = Pick<PcSshReport, 'os' | 'openssh' | 'allowUsers' | 'allowGroups' | 'keys' | 'keyFiles' | 'keysNote' | 'tailscaleSsh'> & { user: string | null }

/** This PC's SSH, read only. Never throws: what cannot be read is null, with a sentence saying why. */
export async function readSsh(d: SshReadDeps): Promise<SshFacts> {
  const windows = d.platform === 'win32'
  const linux = d.platform === 'linux'
  const osName: PcSshReport['os'] = windows ? 'windows' : linux ? 'linux' : d.platform === 'darwin' ? 'mac' : 'other'
  const tailscaleSsh = await d.tailscale(['debug', 'prefs']).then(r => {
    if (r.code !== 0) return null
    try {
      const v = (JSON.parse(r.stdout) as { RunSSH?: unknown }).RunSSH
      return typeof v === 'boolean' ? v : null
    } catch {
      return null
    }
  }, () => null)
  if (!windows && !linux) return { os: osName, openssh: { ...NO_OPENSSH, note: 'SSH is not looked at on this system.' }, allowUsers: null, allowGroups: null, keys: null, keyFiles: [], keysNote: null, tailscaleSsh, user: null }

  // 1. The service: installed, running, at boot.
  let installed: boolean | null = null
  let running: PcSshOpenSsh['running'] = null
  let atBoot: boolean | null = null
  const notes: string[] = []
  if (windows) {
    const sc = path.win32.join(d.systemRoot, 'System32', 'sc.exe')
    const q = await d.exec(sc, ['query', 'sshd'], 5000)
    if (/\b1060\b/.test(q.stdout + q.stderr)) installed = false
    else if (q.code === 0) {
      installed = true
      const state = Number(/STATE\s*:\s*(\d)/.exec(q.stdout)?.[1])
      running = state === 4 || state === 2 ? 'running' : state ? 'stopped' : null
      const c = await d.exec(sc, ['qc', 'sshd'], 5000)
      const start = Number(/START_TYPE\s*:\s*(\d)/.exec(c.stdout)?.[1])
      atBoot = start === 2 ? true : start ? false : null
    }
  } else {
    const units = ['ssh.service', 'ssh.socket', 'sshd.service']
    const r = await d.exec('systemctl', ['show', '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'UnitFileState', ...units], 5000)
    const shown = r.code === 0 ? parseSystemdShow(r.stdout) : new Map<string, { load: string; active: string; file: string }>()
    const service = [...shown.entries()].find(([id, u]) => (id === 'ssh.service' || id === 'sshd.service') && u.load === 'loaded')?.[1]
    const socket = [...shown.entries()].find(([id, u]) => id === 'ssh.socket' && u.load === 'loaded')?.[1]
    const binary = await d.exists('/usr/sbin/sshd')
    installed = Boolean(service || binary) || (r.code === 0 ? false : null)
    if (installed && shown.size) {
      running = service?.active === 'active' ? 'running' : socket?.active === 'active' ? 'socket' : 'stopped'
      atBoot = service?.file === 'enabled' || socket?.file === 'enabled'
    }
  }

  // 2. The settings: sshd's own answer when it gives one, else the config files.
  let settings: SshdSettings | null = null
  let source: PcSshOpenSsh['source'] = null
  const sshd = windows ? path.win32.join(d.systemRoot, 'System32', 'OpenSSH', 'sshd.exe') : '/usr/sbin/sshd'
  const config = windows ? path.win32.join(d.programData, 'ssh', 'sshd_config') : '/etc/ssh/sshd_config'
  if (installed !== false) {
    const t = await d.exec(sshd, ['-T'], 5000)
    if (t.code === 0 && /^port \d+/m.test(t.stdout)) {
      settings = parseSshdT(t.stdout)
      source = 'sshd -T'
    } else {
      const c = await readSshdConfig(config, d)
      if (c.read.length) {
        settings = c.settings
        source = 'config files'
        notes.push(`Read from the config files (sshd -T needs ${windows ? 'administrator rights' : 'root'} to answer).`)
      }
      if (c.unreadable.length) notes.push(`${c.unreadable.length === 1 ? 'One config file' : `${c.unreadable.length} config files`} could not be read (${windows ? 'administrator rights' : 'root'} needed), so a setting there is not shown.`)
      if (c.missing && installed) notes.push('Its config file was not found, so the settings are sshd’s defaults.')
    }
  }
  const s = settings ?? emptySettings()
  const ports = s.ports.length ? [...new Set(s.ports)] : settings || installed ? [22] : []
  const passwordLogin = settings ? (s.password ?? true) || (linux && (s.kbd ?? true) && s.usePam === true) : null
  if (settings && passwordLogin && s.password === false) notes.push('Passwords can still log in through keyboard-interactive (PAM).')

  // 3. Where it listens now.
  let listening: string[] = []
  if (ports.length && installed) {
    if (windows) {
      const n = await d.exec(path.win32.join(d.systemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'TCP'], 5000)
      const n6 = await d.exec(path.win32.join(d.systemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'TCPv6'], 5000)
      listening = listensFromNetstat(n.stdout + '\n' + n6.stdout, ports)
    } else {
      const v4 = await d.readFile('/proc/net/tcp').catch(() => '')
      const v6 = await d.readFile('/proc/net/tcp6').catch(() => '')
      listening = [...listensFromProcNet(v4, ports, false), ...listensFromProcNet(v6, ports, true)]
    }
  }

  // 4. The public keys it accepts for this user (and, on Windows, its administrators' file): type, fingerprint, comment.
  const P = windows ? path.win32 : path.posix
  const own = (s.keysFiles?.length ? s.keysFiles : ['.ssh/authorized_keys', '.ssh/authorized_keys2'])
    // sshd's tokens: %% a percent sign, %h the home folder, %u the user name (%U, the numeric id, is not known here).
    .map(f => f.replace(/%([%huU])/g, (_, c: string) => (c === '%' ? '%' : c === 'h' ? d.home : c === 'u' ? d.user : '')))
    .map(f => (P.isAbsolute(f) ? f : P.join(d.home, f)))
  const files = windows ? [...own, path.win32.join(d.programData, 'ssh', 'administrators_authorized_keys')] : own
  const keys: PcSshKey[] = []
  const keyFiles: string[] = []
  const locked: string[] = []
  for (const f of [...new Set(files)]) {
    try {
      const text = await d.readFile(f)
      keys.push(...parseAuthorizedKeys(text))
      keyFiles.push(f.startsWith(d.home) ? '~' + f.slice(d.home.length).replace(/\\/g, '/') : f)
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') locked.push(f.startsWith(d.home) ? '~' + f.slice(d.home.length).replace(/\\/g, '/') : f)
    }
  }
  const keysNote = locked.length
    ? `${locked.join(', ')} could not be read (${windows ? 'administrator rights' : 'root'} needed), so its keys are not listed.`
    : !keyFiles.length && installed
      ? 'No authorized_keys file for this user.'
      : null

  return {
    os: osName,
    openssh: {
      installed,
      running: installed ? running : null,
      atBoot: installed ? atBoot : null,
      ports: installed ? ports : [],
      listening,
      passwordLogin: installed ? passwordLogin : null,
      rootLogin: installed && settings ? (s.root ?? 'prohibit-password') : null,
      source: installed ? source : null,
      note: installed === false ? null : notes.join(' ') || (installed === null ? 'Whether OpenSSH is installed could not be read.' : null),
    },
    allowUsers: settings ? [...new Set(s.allowUsers)] : null,
    allowGroups: settings ? [...new Set(s.allowGroups)] : null,
    keys: keyFiles.length || !locked.length ? keys : null,
    keyFiles,
    keysNote,
    tailscaleSsh,
    user: loginUser(s.allowUsers, d.user),
  }
}

/** The real reads, for main.ts. `exec` never uses a shell and stops a command after its time. */
export function realSshDeps(tailscale: SshReadDeps['tailscale']): SshReadDeps {
  return {
    platform: process.platform,
    exec: (file, args, timeoutMs) =>
      new Promise(resolve => {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
          const err = error as (NodeJS.ErrnoException & { code?: string | number }) | null
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), missing: err?.code === 'ENOENT' })
        })
      }),
    readFile: file => fs.readFile(file, 'utf8'),
    listDir: dir => fs.readdir(dir),
    exists: file => fs.access(file).then(() => true, () => false),
    tailscale,
    home: os.homedir(),
    user: os.userInfo().username,
    programData: process.env.ProgramData || 'C:\\ProgramData',
    systemRoot: process.env.SystemRoot || 'C:\\Windows',
  }
}
