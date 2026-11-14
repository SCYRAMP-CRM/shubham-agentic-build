/**
 * Order o1fa0 (Shubham, 14 Nov 2026: "Now add a tab SSH in the PC control please."): PC control's SSH tab, next to Ports. READ ONLY and the owner's:
 * one PC's OpenSSH as its own agent sees it (installed, running, at boot, its ports and the addresses it listens on, password and root login), the
 * users it allows, the public keys it accepts (type, fingerprint and comment only: never the key itself), whether Tailscale SSH is on, the ready
 * ssh command, and a Test that only checks the port answers (it reads the server's greeting line and closes: no login).
 *
 * - The page asks its own agent: GET /agent-api/pc-ssh/pcs/<id>/status, and POST …/pcs/<id>/test {} (owner only, like every core route; on the SSH
 *   tab's own mount, agent/pc-ssh-term.ts). The Server answers
 *   for itself and asks a member over their link (stream 'pc-ssh-v1', one request line, one answer line). A PC that is off, or on a build without the
 *   stream, is said so.
 * - Nothing here changes SSH (Agent 6's setup does, with Shubham's own sudo/UAC). The agent is not root/administrator, so `sshd -T` usually cannot run
 *   (it needs the host keys); the config files are read instead, and the page says which.
 * - What a member says is checked strictly by the Server (cleanSshReport) and again by the page.
 */
import { cleanTailnetIp, cleanTailnetName } from './pc-ports.ts'

export const PC_SSH_STREAM = 'pc-ssh-v1'
export const PC_SSH_PROTOCOL = 1 as const

export interface PcSshKey {
  /** "ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256" … */
  type: string
  /** "SHA256:…" as ssh-keygen -lf prints it. Never the key itself. */
  fingerprint: string
  /** The text after the key (often user@host), or null. */
  comment: string | null
}

export interface PcSshOpenSsh {
  /** The OpenSSH server is on this PC (Windows: the sshd service; Linux: the ssh/sshd unit or /usr/sbin/sshd); null when unknown. */
  installed: boolean | null
  /** 'running'; 'socket' (Linux: systemd listens and starts sshd per connection); 'stopped'; null when unknown. */
  running: 'running' | 'socket' | 'stopped' | null
  /** Starts by itself when the PC starts. */
  atBoot: boolean | null
  /** The ports sshd is set to (Port lines; 22 when there is none). */
  ports: number[]
  /** Where something listens on those ports now, e.g. "0.0.0.0:2222", "[::]:2222". */
  listening: string[]
  /** true when a password can log in (PasswordAuthentication, or keyboard-interactive, is on); null when unknown. */
  passwordLogin: boolean | null
  /** PermitRootLogin: 'no', 'prohibit-password' (keys only), 'forced-commands-only' or 'yes'; null when unknown. */
  rootLogin: 'no' | 'prohibit-password' | 'forced-commands-only' | 'yes' | null
  /** Where the settings came from: sshd's own answer ('sshd -T') or this agent reading the config files ('config files'); null when neither. */
  source: 'sshd -T' | 'config files' | null
  /** One plain sentence when something is unknown or worth knowing, or null. */
  note: string | null
}

export interface PcSshReport {
  protocol: 1
  pcId: string
  /** 'online': the PC answered. 'offline': it is off or not connected. 'unsupported': its build cannot say (it needs an update). */
  connection: 'online' | 'offline' | 'unsupported'
  reason: string | null
  os: 'windows' | 'linux' | 'mac' | 'other' | null
  tailnetName: string | null
  tailnetAddress: string | null
  openssh: PcSshOpenSsh
  /** AllowUsers: [] = no such line (any user with a key); null = unknown. */
  allowUsers: string[] | null
  /** AllowGroups, the same way. */
  allowGroups: string[] | null
  /** The public keys it accepts for this agent's own user (and, on Windows, its administrators' file), or null when they could not be read. */
  keys: PcSshKey[] | null
  /** The files those came from (short names, no secrets). */
  keyFiles: string[]
  keysNote: string | null
  /** Tailscale's own SSH (RunSSH): true, false, or null when unknown. */
  tailscaleSsh: boolean | null
  /** The ready command, e.g. "ssh scyramp-ai-1@100.71.234.71 -p 2222"; null when there is nothing to connect to. */
  command: string | null
  checkedAt: string | null
}

/** POST …/test: did the PC's SSH port answer? Read only: the greeting line is read and the connection closed. */
export interface PcSshTest {
  protocol: 1
  pcId: string
  answered: boolean
  /** The server's greeting, e.g. "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5". */
  banner: string | null
  /** "100.71.234.71:2222". */
  target: string | null
  ms: number | null
  reason: string | null
}

export const NO_OPENSSH: PcSshOpenSsh = { installed: null, running: null, atBoot: null, ports: [], listening: [], passwordLogin: null, rootLogin: null, source: null, note: null }

/** The ssh command for a user, a Tailscale address and a port ("-p" only when it is not 22); null without a usable user, address or port. */
export function sshCommand(user: string | null, host: string | null, port: number | null): string | null {
  if (!user || !host || !port || !cleanUser(user) || !(cleanTailnetIp(host) || cleanTailnetName(host)) || !validPort(port)) return null
  return `ssh ${user}@${host}${port === 22 ? '' : ` -p ${port}`}`
}

// ---- strict checks: what a member says, before the Server passes it on, and what the page reads ----

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validPort = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535
const plain = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && ![...v].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
const plainOrNull = (v: unknown, max: number): string | null => (plain(v, max) ? v : null)
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const PC_ID = /^[a-z0-9]{16}$/

/** A user name or AllowUsers pattern as sshd takes it (letters, digits, . _ - $ @ * ? and \ for a Windows domain); null for anything else. */
export function cleanUser(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9._$@*?\\-]{1,64}$/.test(v) ? v : null
}

/** "0.0.0.0:2222", "[::]:2222", "100.71.234.71:2222", "[fd7a:115c:a1e0::1]:22". */
const cleanListen = (v: unknown): string | null => (typeof v === 'string' && /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:.%a-z]{2,64}\]):\d{1,5}$/.test(v) ? v : null)

function cleanKey(raw: unknown): PcSshKey | null {
  if (!obj(raw)) return null
  const type = typeof raw.type === 'string' && /^[a-z0-9@.-]{3,64}$/.test(raw.type) ? raw.type : null
  const fingerprint = typeof raw.fingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(raw.fingerprint) ? raw.fingerprint : null
  if (!type || !fingerprint) return null
  return { type, fingerprint, comment: plainOrNull(raw.comment, 120) }
}

function cleanOpenSsh(raw: unknown): PcSshOpenSsh {
  if (!obj(raw)) return { ...NO_OPENSSH }
  return {
    installed: boolOrNull(raw.installed),
    running: ['running', 'socket', 'stopped'].includes(String(raw.running)) ? (raw.running as PcSshOpenSsh['running']) : null,
    atBoot: boolOrNull(raw.atBoot),
    ports: Array.isArray(raw.ports) ? raw.ports.filter(validPort).slice(0, 16) : [],
    listening: Array.isArray(raw.listening) ? raw.listening.map(cleanListen).filter((x): x is string => x !== null).slice(0, 32) : [],
    passwordLogin: boolOrNull(raw.passwordLogin),
    rootLogin: ['no', 'prohibit-password', 'forced-commands-only', 'yes'].includes(String(raw.rootLogin)) ? (raw.rootLogin as PcSshOpenSsh['rootLogin']) : null,
    source: raw.source === 'sshd -T' || raw.source === 'config files' ? raw.source : null,
    note: plainOrNull(raw.note, 300),
  }
}

const userList = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(cleanUser).filter((x): x is string => x !== null).slice(0, 64) : null)

/** The report as a PC said it, checked: the right PC, known words, bounded sizes; never key material. Throws on a report that is not one. */
export function cleanSshReport(raw: unknown, pcId: string): PcSshReport {
  if (!obj(raw) || raw.protocol !== PC_SSH_PROTOCOL || raw.pcId !== pcId || !PC_ID.test(pcId)) throw new Error('This is not that PC’s SSH report.')
  if (!['online', 'offline', 'unsupported'].includes(String(raw.connection))) throw new Error('The SSH report is incomplete.')
  if (raw.keys !== null && raw.keys !== undefined && (!Array.isArray(raw.keys) || raw.keys.length > 200)) throw new Error('The SSH report is incomplete.')
  const keys = Array.isArray(raw.keys) ? raw.keys.map(cleanKey).filter((k): k is PcSshKey => k !== null) : null
  const tailnetAddress = cleanTailnetIp(raw.tailnetAddress)
  const command = typeof raw.command === 'string' ? raw.command : null
  // The command is rebuilt from its parts here, so a PC can never put anything else into it.
  const m = command ? /^ssh ([^@\s]+)@(\S+?)(?: -p (\d{1,5}))?$/.exec(command) : null
  const rebuilt = m ? sshCommand(m[1], m[2], m[3] ? Number(m[3]) : 22) : null
  return {
    protocol: PC_SSH_PROTOCOL,
    pcId,
    connection: raw.connection as PcSshReport['connection'],
    reason: plainOrNull(raw.reason, 300),
    os: ['windows', 'linux', 'mac', 'other'].includes(String(raw.os)) ? (raw.os as PcSshReport['os']) : null,
    tailnetName: cleanTailnetName(raw.tailnetName),
    tailnetAddress,
    openssh: cleanOpenSsh(raw.openssh),
    allowUsers: userList(raw.allowUsers),
    allowGroups: userList(raw.allowGroups),
    keys,
    keyFiles: Array.isArray(raw.keyFiles) ? raw.keyFiles.map(f => plainOrNull(f, 200)).filter((f): f is string => f !== null).slice(0, 8) : [],
    keysNote: plainOrNull(raw.keysNote, 300),
    tailscaleSsh: boolOrNull(raw.tailscaleSsh),
    command: rebuilt === command ? rebuilt : null,
    checkedAt: typeof raw.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null,
  }
}

/** A test answer, checked the same way. */
export function cleanSshTest(raw: unknown, pcId: string): PcSshTest {
  if (!obj(raw) || raw.protocol !== PC_SSH_PROTOCOL || raw.pcId !== pcId || typeof raw.answered !== 'boolean') throw new Error('This is not that PC’s test answer.')
  return {
    protocol: PC_SSH_PROTOCOL,
    pcId,
    answered: raw.answered,
    banner: typeof raw.banner === 'string' && /^SSH-[\x20-\x7e]{1,120}$/.test(raw.banner) ? raw.banner : null,
    target: typeof raw.target === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(raw.target) ? raw.target : null,
    ms: Number.isInteger(raw.ms) && (raw.ms as number) >= 0 && (raw.ms as number) < 600_000 ? (raw.ms as number) : null,
    reason: plainOrNull(raw.reason, 300),
  }
}

/** The report for a PC whose own answer is missing. */
export function unknownSshReport(pcId: string, connection: 'offline' | 'unsupported', reason: string, last: { tailnetName: string | null; tailnetAddress: string | null } | null): PcSshReport {
  return { protocol: PC_SSH_PROTOCOL, pcId, connection, reason, os: null, tailnetName: last?.tailnetName ?? null, tailnetAddress: last?.tailnetAddress ?? null, openssh: { ...NO_OPENSSH }, allowUsers: null, allowGroups: null, keys: null, keyFiles: [], keysNote: null, tailscaleSsh: null, command: null, checkedAt: null }
}
