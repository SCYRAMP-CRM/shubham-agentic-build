import { createHash, createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  cleanSize,
  cleanTarget,
  PC_SSH_PREFIX,
  sshLine,
  type SshAsk,
  type SshOpenSession,
  type SshSessionAnswer,
  type SshTarget,
  type SshTargetAnswer,
  type SshTermServerMessage,
} from '../shared/pc-ssh-term.ts'
import { cleanTailnetIp } from '../shared/pc-ports.ts'
import { destructiveReason, keyName, PROMPT_WORDS, promptKind, SAFE_AT_PROMPT, SSH_KEYS, type SshPromptKind } from '../shared/ssh-assist.ts'
import { apiError, type ApiMount, type MountRequest, type WsSocket } from './api.ts'
import { describeHuman, requireCrmHuman } from './agentic/human-session.ts'
import type { PtyLike, PtySpawn } from './agentic/chats.ts'
import type { Auth } from './auth/index.ts'
import { authError, type Caller } from './auth/types.ts'
import { createSshText, type SshText } from './ssh-text.ts'

// Orders o1fa0 + o2915 (shared/pc-ssh-term.ts): a live SSH session from PC control's SSH tab. This PC's agent runs its OWN ssh client with its own key
// in a pseudo-terminal (node-pty; ConPTY on Windows) and streams it to the page. The key and any password stay on this PC: the page only sees what ssh
// prints and sends keys. Nothing about SSH itself is changed here (no config, no key written); ssh may add a PC's host key to this PC's known_hosts
// when Shubham answers its question himself.
//
// Order o68f0: his Assistant uses these sessions too (`assistant` below, the MCP tools ssh_open / ssh_read / ssh_type / ssh_close in agentic/index.ts).
// A session belongs to a SCOPE: the owner of the app's ('@owner': every page of the signed-in administrator, and the owner's Assistant), or one
// person's. The Assistant reads the text of the screen (ssh-text.ts) and types, by the rules of shared/ssh-assist.ts: never at a password, passphrase,
// sudo, one-time-code or host-key question; a command that deletes recursively, shuts down, deletes a user or wipes a disk becomes an ask card on his
// page, run only by his own tap; what it types is never logged (only how many characters, or a key's name).

const TICKET_MS = 30_000
const MAX_SESSIONS = 4
const MAX_IN = 65_536
const ID = /^[a-z0-9]{16}$/
const SESSION_ID = /^[a-f0-9]{16}$/
/** What a page that shows a session later gets first: the last of what ssh printed (cut at a line start). */
const RAW_MAX = 200_000
/** An ask card waits this long for his tap. */
const ASK_MS = 120_000
/** An Assistant's session that nobody has typed in for this long ends. */
const IDLE_MS = 30 * 60_000
/** ssh_type waits for the output to be quiet this long (after it began), and at most this long by default / at all. */
const QUIET_MS = 350
const SETTLE_MS = 2000
const SETTLE_MAX_MS = 15_000
/** What one ssh_type may type: one line. */
const TEXT_MAX = 4000

export interface SshTermOptions {
  /** A PC this agent knows (itself and its Server's or its members), with its name and its Tailscale address as its link shows it; null otherwise. */
  pc(id: string): { name: string; tailnetGuess: string | null } | null
  auth: Auth | undefined
  /** node-pty, loaded on the first session (agentic/chats.ts loadNodePty). */
  pty(): { spawn: PtySpawn } | { error: string }
  /** The ssh client, its key (null: ssh's own default), this user's known_hosts, and how it runs. */
  ssh: { exe: string; keyFile: string | null; knownHosts: string; cwd: string; env: Record<string, string> }
  /** <state>/agent/ssh: targets.json (the last target per PC). */
  dir: string
  /** Order o1fa0's read-only status and its Test (pc-ssh.ts), on this same mount: GET /pcs/<id>/status, POST /pcs/<id>/test {}. */
  status?: { status(id: string): Promise<unknown>; test(id: string): Promise<unknown> }
  now?: () => number
  log?: { info(m: string): void; warn(m: string): void }
  /** Tests: the timers (ask expiry, idle end, ssh_type's wait). */
  timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void }
  /** Order o68f0: the switch that turns the Assistant's use of SSH off (main.ts: <state>/agent/ssh/assistant.off exists). His own SSH tab is unchanged. */
  assistantOff?: () => boolean
  /**
   * Order o68f0, slice 3: whether a signed-in person who is not the owner may use SSH on this PC (Settings › Access, 'pc-ssh@<pcId>':
   * feature-access.ts allows(caller, 'pc-ssh', pcId)). Left out: the owner only, as before.
   */
  allows?(c: Caller, pcId: string): boolean
}

/** Order o68f0: who the Assistant acts for: the owner of the app ('@owner') or one person ('person:<id>'), and how to name them in the log. */
export interface SshScope {
  scope: string
  who: string
}

/** Order o68f0: which session: by its id, or the newest one to a PC (by the PC's id). */
export interface SshPick {
  session?: string
  pcId?: string
}

/** Order o68f0: what the Assistant sees of a session. */
export interface SshView {
  session: string
  pc: string
  pcId: string
  line: string
  by: 'page' | 'assistant'
  startedAt: string
  /** How many pages show it live now (0: nobody watches; ask him to open PC control › that PC › SSH to see it). */
  viewers: number
  /** A full-screen program has the terminal (top, less, vim): `lines` is its screen. */
  fullScreen: boolean
  /** The question the terminal waits at that only the person answers, or null. */
  prompt: SshPromptKind | null
  lines: string[]
  asks: SshAsk[]
  /** Why it ended, when it has. */
  ended: string | null
}

export interface SshAssist {
  sessions(as: SshScope): SshView[]
  open(as: SshScope, pcId: string, want?: { user?: unknown; host?: unknown; port?: unknown }, wait?: number): Promise<SshView & { reused: boolean }>
  read(as: SshScope, pick: SshPick, lines?: number): SshView
  /** Types one line (text, Enter after it unless enter is false) or presses one key, by the rules; then waits for the output to settle. */
  type(as: SshScope, pick: SshPick, input: { text?: unknown; enter?: unknown; key?: unknown; wait?: unknown; lines?: unknown }): Promise<SshView & { typed: string | null; waiting: SshAsk | null }>
  close(as: SshScope, pick: SshPick): SshView
}

export interface SshTerm {
  mount: ApiMount
  /** Ends every open session (the agent is stopping). */
  closeAll(): void
  /** For tests: how many sessions are open. */
  open(): number
  /** The last target a session used for this PC (targets.json), or null. */
  savedTarget(id: string): SshTarget | null
  /** Order o68f0: the Assistant's hands (agentic/index.ts ssh_*). */
  assistant: SshAssist
}

interface Ticket {
  pcId: string
  target: SshTarget
  /** The session this ticket opens (new) or shows (attach). */
  sessionId: string
  attach: boolean
  sid: string
  person: string
  scope: string
  who: string
  expires: number
  admitted: boolean
}

interface Viewer {
  socket: WsSocket
  untrack: (() => void) | null
}

interface Ask extends SshAsk {
  enter: boolean
  expires: number
  timer: unknown
}

interface Session {
  id: string
  pcId: string
  pcName: string
  target: SshTarget
  scope: string
  who: string
  by: 'page' | 'assistant'
  term: PtyLike | null
  text: SshText
  raw: string
  viewers: Set<Viewer>
  startedAt: number
  lastIn: number
  ended: string | null
  asks: Map<string, Ask>
  idle: unknown
  /** ssh_type's waits for output to settle. */
  heard: Set<() => void>
}

/** known_hosts → the fingerprints it holds for `host` on `port` (and for `host` on 22): plain names, [host]:port, or hashed (|1|salt|hash). */
export function knownFingerprints(text: string, host: string, port: number): { forPort: string[]; forHost: string[] } {
  const named = (name: string) => {
    const out: string[] = []
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#') || t.startsWith('@')) continue
      const [hosts, type, b64] = t.split(/\s+/)
      if (!hosts || !type || !b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) continue
      const hit = hosts.startsWith('|1|')
        ? (() => {
            const [, , salt, hash] = hosts.split('|')
            return !!salt && !!hash && createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash
          })()
        : hosts.split(',').some(h => h.toLowerCase() === name.toLowerCase())
      if (hit) out.push('SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, ''))
    }
    return [...new Set(out)]
  }
  const forPort = named(port === 22 ? host : `[${host}]:${port}`)
  return { forPort, forHost: port === 22 ? forPort : named(host) }
}

/** The ssh arguments for a target: its own key when it has one (and only that key), a keep-alive, a time limit to connect. Never a shell. */
export function sshArgs(t: SshTarget, keyFile: string | null): string[] {
  return [...(keyFile ? ['-i', keyFile, '-o', 'IdentitiesOnly=yes'] : []), '-o', 'ServerAliveInterval=30', '-o', 'ConnectTimeout=15', '-p', String(t.port), `${t.user}@${t.host}`]
}

/**
 * Order o68f0: what an ssh_* tool answers the Assistant: first what to do or tell him (a card waits for his tap, the terminal waits at a secret only he
 * types, whether he sees it live), then the session, then the screen's lines as plain text.
 */
export function sshWords(v: SshView & { reused?: boolean; typed?: string | null; waiting?: SshAsk | null }): string {
  const where = `PC control › ${v.pc} › SSH`
  const say: string[] = []
  if (v.ended) say.push(`This session has ended: ${v.ended} Open a new one with ssh_open if he wants to go on.`)
  else {
    if (v.reused === true) say.push(`A session to ${v.pc} was open already (${v.by === 'page' ? 'his own' : 'yours'}): this is it.`)
    if (v.waiting) say.push(`NOT typed: that command ${v.waiting.why}. A card waits for HIS tap on Run in ${where} until ${v.waiting.expiresAt}. Tell him so; ssh_read shows when it ran. Never try another way around it.`)
    if (v.prompt) say.push(`It waits for ${PROMPT_WORDS[v.prompt]}: that is his to type, never yours. Ask him to type it himself in ${where}.`)
    say.push(v.viewers > 0 ? `He sees it live in ${where}.` : `None of his pages shows it now: ui_control goto /pc-control?pc=${v.pcId}&view=ssh shows it to him live.`)
  }
  const { lines, ...rest } = v
  return `${say.join(' ')}\n\n${JSON.stringify(rest)}\n\nScreen (the last ${lines.length} line${lines.length === 1 ? '' : 's'}):\n${lines.join('\n')}`
}

/** The owner of the app's scope (every administrator, and his Assistant), else the person's own. */
export const sshScopeOf = (person: { id: string } | null, admin: boolean): string | null => (admin ? '@owner' : person ? `person:${person.id.toLowerCase()}` : null)

/** What ssh printed, kept for a page that attaches later: the last RAW_MAX characters, cut at a line start so it begins clean. */
function keepRaw(raw: string, more: string): string {
  const all = raw + more
  if (all.length <= RAW_MAX) return all
  const cut = all.length - RAW_MAX
  const nl = all.indexOf('\n', cut)
  return nl >= 0 && nl - cut < 4096 ? all.slice(nl + 1) : all.slice(cut)
}

export function createSshTerm(o: SshTermOptions): SshTerm {
  const now = o.now ?? Date.now
  const timers = o.timers ?? {
    set: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    },
    clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  }
  const tickets = new Map<string, Ticket>()
  const sessions = new Map<string, Session>()
  /** Sessions that ended lately, so the Assistant can still read their last screen and why they ended. */
  const ended = new Map<string, Session>()
  const targetsFile = path.join(o.dir, 'targets.json')

  const readTargets = (): Record<string, SshTarget & { at: string }> => {
    try {
      const v = JSON.parse(fs.readFileSync(targetsFile, 'utf8')) as { v?: number; targets?: Record<string, unknown> }
      const out: Record<string, SshTarget & { at: string }> = {}
      for (const [id, raw] of Object.entries(v.targets ?? {})) {
        const t = ID.test(id) ? cleanTarget(raw) : null
        if (t) out[id] = { ...t, at: String((raw as { at?: unknown }).at ?? '') }
      }
      return out
    } catch {
      return {}
    }
  }
  const saveTarget = (id: string, t: SshTarget) => {
    try {
      const all = { ...readTargets(), [id]: { ...t, at: new Date(now()).toISOString() } }
      fs.mkdirSync(o.dir, { recursive: true })
      const tmp = `${targetsFile}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, targets: all }, null, 2) + '\n')
      fs.renameSync(tmp, targetsFile)
    } catch (e) {
      o.log?.warn(`ssh: the last target for ${id} could not be saved (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  const prune = () => {
    for (const [k, t] of tickets) if (t.expires <= now()) tickets.delete(k)
  }
  const newId = () => randomBytes(8).toString('hex')

  // ---- sessions

  const tell = (s: Session, m: SshTermServerMessage) => {
    const text = JSON.stringify(m)
    for (const v of s.viewers) {
      try {
        v.socket.sendText(text)
      } catch {
        // That page has gone; its close removes it.
      }
    }
  }
  const publicAsk = (a: Ask): SshAsk => ({ id: a.id, text: a.text, why: a.why, expiresAt: a.expiresAt, state: a.state })

  function end(s: Session, reason: string, code: number | null = null, closeCode = 1000) {
    if (s.ended) return
    s.ended = reason
    sessions.delete(s.id)
    ended.set(s.id, s)
    while (ended.size > 8) ended.delete(ended.keys().next().value as string)
    if (s.idle) timers.clear(s.idle)
    for (const a of s.asks.values()) {
      timers.clear(a.timer)
      if (a.state === 'waiting') a.state = 'expired'
    }
    for (const v of [...s.viewers]) {
      // Out of the set first: its socket's own close (below) then finds nothing left to do.
      s.viewers.delete(v)
      try {
        v.socket.sendText(JSON.stringify({ t: 'exit', code, reason } satisfies SshTermServerMessage))
      } catch {
        // gone
      }
      try {
        v.socket.close(closeCode, closeCode === 1000 ? 'ended' : reason)
      } catch {
        // already closed
      }
      v.untrack?.()
    }
    for (const w of [...s.heard]) w()
    // Its own handle only (node-pty ends exactly this process): never by name or a tree.
    try {
      s.term?.kill()
    } catch {
      // Already gone.
    }
  }

  function idleFrom(s: Session) {
    if (s.by !== 'assistant') return
    if (s.idle) timers.clear(s.idle)
    s.idle = timers.set(() => {
      if (!s.ended && now() - s.lastIn >= IDLE_MS - 1000) {
        o.log?.info(`ssh session to ${sshLine(s.target)} (${s.pcId}) ended: nobody typed in it for 30 minutes`)
        end(s, 'Nobody typed in it for 30 minutes.')
      } else if (!s.ended) idleFrom(s)
    }, IDLE_MS)
  }

  /** Starts ssh for a session; null when it runs, else why not. */
  function spawn(s: Session, cols = 100, rows = 30): string | null {
    const p = o.pty()
    if ('error' in p) return `This PC cannot run a terminal: ${p.error}`
    try {
      s.term = p.spawn(o.ssh.exe, sshArgs(s.target, o.ssh.keyFile), { cwd: o.ssh.cwd, env: { ...o.ssh.env, TERM: 'xterm-256color' }, cols, rows })
    } catch (e) {
      return `ssh did not start: ${e instanceof Error ? e.message : String(e)}`
    }
    s.term.onData(d => {
      if (s.ended) return
      s.raw = keepRaw(s.raw, d)
      s.text.write(d)
      tell(s, { t: 'out', d })
      for (const w of [...s.heard]) w()
    })
    s.term.onExit(e => {
      if (s.ended) return
      o.log?.info(`ssh session to ${sshLine(s.target)} ended (code ${e.exitCode})`)
      end(s, e.exitCode === 0 ? 'The session ended.' : `ssh ended (code ${e.exitCode}).`, e.exitCode)
    })
    return null
  }

  function makeSession(id: string, pcId: string, target: SshTarget, scope: string, who: string, by: Session['by']): Session {
    return { id, pcId, pcName: o.pc(pcId)?.name ?? pcId, target, scope, who, by, term: null, text: createSshText(100, 30), raw: '', viewers: new Set(), startedAt: now(), lastIn: now(), ended: null, asks: new Map(), idle: null, heard: new Set() }
  }

  function view(s: Session, lines = 40): SshView {
    const screen = s.text.screen()
    return {
      session: s.id,
      pc: s.pcName,
      pcId: s.pcId,
      line: sshLine(s.target),
      by: s.by,
      startedAt: new Date(s.startedAt).toISOString(),
      viewers: s.viewers.size,
      fullScreen: s.text.alt(),
      prompt: s.ended ? null : promptKind(screen.slice(-6)),
      lines: s.text.lines(Math.max(1, Math.min(Math.floor(lines) || 40, 400))),
      asks: [...s.asks.values()].map(publicAsk).slice(-5),
      ended: s.ended,
    }
  }

  // ---- the page

  function target(id: string): SshTargetAnswer {
    const pc = o.pc(id)
    if (!ID.test(id) || !pc) throw apiError(404, 'That is not one of this app’s PCs.')
    const saved = readTargets()[id]
    if (saved) return { pcId: id, user: saved.user, host: saved.host, port: saved.port, from: 'saved' }
    const guess = cleanTailnetIp(pc.tailnetGuess)
    return { pcId: id, user: null, host: guess, port: guess ? 22 : null, from: guess ? 'guess' : null }
  }

  /**
   * The page's own caller and the scope that gives: a person's own signed-in session, never a chat tool or a program (the PC screen's rule). The
   * owner of the app always; order o68f0, slice 3: anyone else only on a PC the owner opened SSH to them on (Settings › Access).
   */
  function human(r: MountRequest, pcId: string): { caller: Caller; scope: string } {
    const caller = requireCrmHuman(o.auth, r, false)
    const admin = !!o.auth?.isAdmin(caller)
    if (!admin && !(ID.test(pcId) && o.allows?.(caller, pcId) === true)) {
      throw authError(403, 'SSH to this PC is not open to you. The owner of this app opens it, PC by PC, in Settings › Access.', 'not-allowed')
    }
    return { caller, scope: sshScopeOf(caller.person, admin)! }
  }

  /**
   * Order o68f0, slice 3: the reads beside the terminal (the form's last target, the SSH status and its Test). The owner, and the open app on his PCs,
   * as before; a signed-in person who is not the owner only on a PC SSH is open to them.
   */
  function mayRead(r: MountRequest, pcId: string) {
    const c = o.auth?.caller(r.headers)
    if (!c?.person || o.auth?.isAdmin(c)) return
    if (!(ID.test(pcId) && o.allows?.(c, pcId) === true)) throw authError(403, 'SSH to this PC is not open to you. The owner of this app opens it, PC by PC, in Settings › Access.', 'not-allowed')
  }

  function session(id: string, r: MountRequest): SshSessionAnswer {
    const { caller, scope } = human(r, id)
    const pc = o.pc(id)
    if (!ID.test(id) || !pc) throw apiError(404, 'That is not one of this app’s PCs.')
    prune()
    if (tickets.size >= 16) throw apiError(429, 'Too many sessions are starting at once. Wait a moment.')
    const body = r.body as Record<string, unknown> | null
    // Order o68f0: show a session that is open already (the Assistant's, or his own from another page).
    if (body && typeof body === 'object' && !Array.isArray(body) && 'attach' in body) {
      const s = typeof body.attach === 'string' && SESSION_ID.test(body.attach) ? sessions.get(body.attach) : undefined
      if (!s || s.pcId !== id || s.scope !== scope) throw apiError(404, 'That session is not open any more.')
      const ticket = randomBytes(32).toString('hex')
      const expires = now() + TICKET_MS
      tickets.set(ticket, { pcId: id, target: s.target, sessionId: s.id, attach: true, sid: caller.sid!, person: caller.person!.id, scope, who: describeHuman(caller), expires, admitted: false })
      return { ticket, expiresAt: new Date(expires).toISOString(), target: s.target, session: s.id, knownForPort: [], knownForHost: [] }
    }
    const t = cleanTarget(r.body)
    if (!t) throw apiError(400, 'Give a user (letters, digits, . _ -), a Tailscale address (100.x.y.z or a name ending in .ts.net) and a port.')
    if (sessions.size >= MAX_SESSIONS) throw apiError(429, `${MAX_SESSIONS} SSH sessions are open already. Close one first.`)
    const ticket = randomBytes(32).toString('hex')
    const expires = now() + TICKET_MS
    const sessionId = newId()
    tickets.set(ticket, { pcId: id, target: t, sessionId, attach: false, sid: caller.sid!, person: caller.person!.id, scope, who: describeHuman(caller), expires, admitted: false })
    saveTarget(id, t)
    let known = { forPort: [] as string[], forHost: [] as string[] }
    try {
      known = knownFingerprints(fs.readFileSync(o.ssh.knownHosts, 'utf8'), t.host, t.port)
    } catch {
      // No known_hosts yet: ssh asks.
    }
    return { ticket, expiresAt: new Date(expires).toISOString(), target: t, session: sessionId, knownForPort: known.forPort, knownForHost: known.forHost }
  }

  function list(id: string, r: MountRequest): { sessions: SshOpenSession[] } {
    const { scope } = human(r, id)
    if (!ID.test(id) || !o.pc(id)) throw apiError(404, 'That is not one of this app’s PCs.')
    const mine = [...sessions.values()].filter(s => s.pcId === id && s.scope === scope)
    return { sessions: mine.map(s => ({ id: s.id, by: s.by, line: sshLine(s.target), startedAt: new Date(s.startedAt).toISOString(), viewers: s.viewers.size, asks: [...s.asks.values()].filter(a => a.state === 'waiting').map(publicAsk) })) }
  }

  function allow(query: URLSearchParams, caller: Caller) {
    prune()
    const t = tickets.get(query.get('ticket') ?? '')
    if (!t || t.admitted) throw Object.assign(apiError(403, 'This terminal link is used up or too old. Press Open terminal again.'), { code: 'ticket' })
    // Only the session that asked for it may open it.
    if (!caller.person || caller.sid !== t.sid || caller.person.id !== t.person) throw Object.assign(apiError(403, 'This terminal was opened by another sign-in.'), { code: 'ticket' })
    t.admitted = true
  }

  /** His answer to an ask card, from his own page: Run types the command (unless the terminal now waits at a secret), Don't drops it. */
  function answer(s: Session, id: unknown, yes: unknown) {
    const a = typeof id === 'string' ? s.asks.get(id) : undefined
    if (!a || a.state !== 'waiting') return
    timers.clear(a.timer)
    if (a.expires <= now()) a.state = 'expired'
    else if (yes !== true) a.state = 'declined'
    else if (promptKind(s.text.screen().slice(-6))) a.state = 'refused'
    else {
      a.state = 'ran'
      s.lastIn = now()
      idleFrom(s)
      s.term?.write(a.text + (a.enter ? '\r' : ''))
    }
    o.log?.info(`ssh: his answer to the Assistant's ask on ${s.pcName}: ${a.state}`)
    tell(s, { t: 'asked', id: a.id, state: a.state })
  }

  function attach(ticketId: string, socket: WsSocket, caller: Caller) {
    const t = tickets.get(ticketId)
    tickets.delete(ticketId)
    const send = (m: SshTermServerMessage) => {
      try {
        socket.sendText(JSON.stringify(m))
      } catch {
        // The page has gone; onClose ends the session.
      }
    }
    if (!t || !t.admitted || t.expires <= now()) {
      send({ t: 'exit', code: null, reason: 'This terminal link is used up or too old. Press Open terminal again.' })
      socket.close(4003, 'ticket')
      return
    }
    let s: Session
    if (t.attach) {
      const open = sessions.get(t.sessionId)
      if (!open) {
        send({ t: 'exit', code: null, reason: 'That session is not open any more.' })
        socket.close(4004, 'gone')
        return
      }
      s = open
    } else {
      if (sessions.size >= MAX_SESSIONS) {
        send({ t: 'exit', code: null, reason: `${MAX_SESSIONS} SSH sessions are open already. Close one first.` })
        socket.close(4029, 'too many')
        return
      }
      s = makeSession(t.sessionId, t.pcId, t.target, t.scope, t.who, 'page')
      const why = spawn(s)
      if (why) {
        send({ t: 'exit', code: null, reason: why })
        socket.close(1011, why.startsWith('ssh') ? 'ssh did not start' : 'no pty')
        return
      }
      sessions.set(s.id, s)
      o.log?.info(`ssh session opened to ${sshLine(t.target)} (${t.pcId}) by ${t.who}`)
    }
    const untrack = o.auth?.track(caller, () => socket.close(4001, 'The sign-in ended.'))
    const v: Viewer = { socket, untrack: typeof untrack === 'function' ? untrack : null }
    s.viewers.add(v)
    // A session shown again: what it printed so far, then the cards that wait for him.
    if (t.attach) {
      if (s.raw) send({ t: 'out', d: s.raw })
      for (const a of s.asks.values()) if (a.state === 'waiting') send({ t: 'ask', ask: publicAsk(a) })
    }
    socket.onText(text => {
      if (s.ended || text.length > MAX_IN + 64) return
      let m: unknown
      try {
        m = JSON.parse(text)
      } catch {
        return
      }
      const msg = m as { t?: unknown; d?: unknown; cols?: unknown; rows?: unknown; id?: unknown; yes?: unknown; text?: unknown; enter?: unknown; key?: unknown }
      if (msg.t === 'in' && typeof msg.d === 'string' && msg.d.length <= MAX_IN) {
        s.lastIn = now()
        s.term?.write(msg.d)
      } else if (msg.t === 'size') {
        const size = cleanSize(msg.cols, msg.rows)
        if (size) {
          s.term?.resize(size.cols, size.rows)
          s.text.resize(size.cols, size.rows)
        }
      } else if (msg.t === 'answer') answer(s, msg.id, msg.yes)
      else if (msg.t === 'assist') {
        // Order o68f0, slice 2: the Assistant typing through his screen (ui_control on ref s1): ssh_type itself, with all its rules, on this session.
        const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : ''
        assistant.type({ scope: s.scope, who: 'the Assistant (through his screen)' }, { session: s.id }, { text: msg.text, enter: msg.enter, key: msg.key, wait: 1500, lines: 30 }).then(
          r => send({ t: 'assisted', id, ok: true, words: sshWords(r) }),
          (e: unknown) => send({ t: 'assisted', id, ok: false, error: e instanceof Error ? e.message : String(e) }),
        )
      } else if (msg.t === 'close') {
        o.log?.info(`ssh session to ${sshLine(s.target)} ended by ${t.who}`)
        end(s, 'Closed on the page.')
      }
    })
    socket.onClose(() => {
      if (!s.viewers.delete(v)) return
      v.untrack?.()
      // His own Open terminal: the session is the page's, and ends with it. The Assistant's goes on (it is listed on the SSH tab).
      if (s.by === 'page' && s.viewers.size === 0 && !s.ended) {
        o.log?.info(`ssh session to ${sshLine(s.target)} closed by the page`)
        end(s, 'Closed on the page.')
      }
    })
  }

  // ---- the Assistant

  function pick(as: SshScope, p: SshPick, live = true): Session {
    if (p.session !== undefined) {
      const s = typeof p.session === 'string' ? (sessions.get(p.session) ?? (live ? undefined : ended.get(p.session))) : undefined
      if (!s || s.scope !== as.scope) throw apiError(404, 'There is no such SSH session (or it is not yours). ssh_read lists nothing then: open one with ssh_open.')
      return s
    }
    if (!p.pcId) throw apiError(400, 'Say which PC (pc) or which session.')
    const open = [...sessions.values()].filter(s => s.pcId === p.pcId && s.scope === as.scope).sort((a, b) => b.startedAt - a.startedAt)
    if (open[0]) return open[0]
    if (!live) {
      const gone = [...ended.values()].filter(s => s.pcId === p.pcId && s.scope === as.scope).sort((a, b) => b.startedAt - a.startedAt)
      if (gone[0]) return gone[0]
    }
    throw apiError(404, `No SSH session to ${o.pc(p.pcId)?.name ?? 'that PC'} is open. Open one with ssh_open (or he opens it in PC control › SSH).`)
  }

  /** Resolves when ssh has printed something and then been quiet for QUIET_MS, or after `ms` at most. */
  function settle(s: Session, ms: number): Promise<void> {
    return new Promise(resolve => {
      let quiet: unknown = null
      let done = false
      const finish = () => {
        if (done) return
        done = true
        s.heard.delete(heard)
        timers.clear(limit)
        if (quiet) timers.clear(quiet)
        resolve()
      }
      const heard = () => {
        if (s.ended) return finish()
        if (quiet) timers.clear(quiet)
        quiet = timers.set(finish, QUIET_MS)
      }
      const limit = timers.set(finish, ms)
      s.heard.add(heard)
    })
  }

  /** The Assistant's use of SSH can be switched off on this PC (assistant.off); his own SSH tab is not affected. */
  const on = () => {
    if (o.assistantOff?.()) throw Object.assign(apiError(403, "The Assistant's use of SSH is switched off on this Server (its ssh folder has assistant.off). He can still use PC control › SSH himself."), { code: 'ssh-off' })
  }

  const assistant: SshAssist = {
    sessions(as) {
      on()
      return [...sessions.values()].filter(s => s.scope === as.scope).map(s => view(s, 5))
    },

    async open(as, pcId, want = {}, wait = 4000) {
      on()
      const pc = o.pc(pcId)
      if (!ID.test(pcId) || !pc) throw apiError(404, 'That is not one of this app’s PCs.')
      const mine = [...sessions.values()].filter(s => s.pcId === pcId && s.scope === as.scope).sort((a, b) => b.startedAt - a.startedAt)[0]
      if (mine) return { ...view(mine), reused: true }
      const saved = readTargets()[pcId]
      const given = want.user !== undefined || want.host !== undefined || want.port !== undefined
      const t = cleanTarget({ user: want.user ?? saved?.user, host: want.host ?? saved?.host ?? cleanTailnetIp(pc.tailnetGuess), port: want.port ?? saved?.port ?? 22 })
      if (!t) {
        throw apiError(
          400,
          saved || cleanTailnetIp(pc.tailnetGuess)
            ? 'Give a plain user (letters, digits, . _ -), a Tailscale address (100.x.y.z or a name ending in .ts.net) and a port.'
            : `Nothing is known yet of how to reach ${pc.name}: he opens it once in PC control › ${pc.name} › SSH, or give user, host (its Tailscale address) and port.`,
        )
      }
      if (sessions.size >= MAX_SESSIONS) throw apiError(429, `${MAX_SESSIONS} SSH sessions are open already. Close one first (ssh_close), or he closes one.`)
      const s = makeSession(newId(), pcId, t, as.scope, as.who, 'assistant')
      const why = spawn(s)
      if (why) throw apiError(502, why)
      sessions.set(s.id, s)
      if (given) saveTarget(pcId, t)
      idleFrom(s)
      o.log?.info(`ssh session opened to ${sshLine(t)} (${pcId}) by ${as.who}`)
      await settle(s, Math.max(500, Math.min(wait, SETTLE_MAX_MS)))
      return { ...view(s), reused: false }
    },

    read(as, p, lines = 40) {
      on()
      return view(pick(as, p, false), lines)
    },

    async type(as, p, input) {
      on()
      const s = pick(as, p)
      const wait = typeof input.wait === 'number' && Number.isFinite(input.wait) ? Math.max(0, Math.min(input.wait, SETTLE_MAX_MS)) : SETTLE_MS
      const lines = typeof input.lines === 'number' ? input.lines : 40
      let bytes: string
      let what: string
      let key: string | null = null
      if (input.key !== undefined) {
        if (input.text !== undefined) throw apiError(400, 'Give text or key, not both.')
        key = keyName(input.key)
        if (!key) throw apiError(400, `Unknown key. Keys: ${Object.keys(SSH_KEYS).join(', ')}.`)
        bytes = SSH_KEYS[key]
        what = `pressed ${key}`
      } else {
        if (typeof input.text !== 'string' || !input.text.length) throw apiError(400, 'Give text to type (one line), or a key.')
        const text = input.text
        if (text.length > TEXT_MAX) throw apiError(400, `One line of at most ${TEXT_MAX} characters at a time.`)
        // One line: Enter is the enter flag; other control keys go by name (key).
        if ([...text].some(ch => ch.charCodeAt(0) === 127 || (ch.charCodeAt(0) < 32 && ch !== '\t'))) throw apiError(400, 'Type one line of plain text; Enter is added for you (enter: false to leave it out). Control keys go by name: key.')
        const enter = input.enter !== false
        bytes = text + (enter ? '\r' : '')
        what = `typed ${text.length} character${text.length === 1 ? '' : 's'}${enter ? ' and Enter' : ''}`
      }
      // A question only the person answers: never typed at, whatever it is (Ctrl+C, Ctrl+D and Escape only leave it).
      const asked = promptKind(s.text.screen().slice(-6))
      if (asked && !(key && SAFE_AT_PROMPT.has(key))) {
        o.log?.info(`ssh: did not type for ${as.who} on ${s.pcName}: the terminal waits for ${PROMPT_WORDS[asked]}`)
        throw Object.assign(
          apiError(
            409,
            `${s.pcName}'s terminal is asking for ${PROMPT_WORDS[asked]}. That is his to type, never yours: ask him to type it himself in PC control › ${s.pcName} › SSH. (Ctrl+C or Escape cancels the question.)`,
          ),
          { code: 'ssh-secret' },
        )
      }
      // What deletes recursively, shuts down, deletes a user or wipes a disk: a card for his own tap, nothing typed.
      const why = key ? null : destructiveReason(String(input.text))
      if (why) {
        for (const a of s.asks.values()) if (a.state === 'waiting' && a.text === input.text) return { ...view(s, lines), typed: null, waiting: publicAsk(a) }
        const id = newId()
        const expires = now() + ASK_MS
        const a: Ask = { id, text: String(input.text), why, expiresAt: new Date(expires).toISOString(), state: 'waiting', enter: input.enter !== false, expires, timer: null }
        a.timer = timers.set(() => {
          if (a.state !== 'waiting') return
          a.state = 'expired'
          tell(s, { t: 'asked', id, state: 'expired' })
        }, ASK_MS)
        s.asks.set(id, a)
        while (s.asks.size > 20) s.asks.delete(s.asks.keys().next().value as string)
        o.log?.info(`ssh: ${as.who} asked to run a command that ${why} on ${s.pcName} (${a.text.length} characters): it waits for his tap`)
        tell(s, { t: 'ask', ask: publicAsk(a) })
        return { ...view(s, lines), typed: null, waiting: publicAsk(a) }
      }
      s.lastIn = now()
      idleFrom(s)
      // Listening before the keys go, so an answer that comes at once is not missed.
      const heard = wait > 0 ? settle(s, wait) : null
      s.term?.write(bytes)
      o.log?.info(`ssh: ${as.who} ${what} on ${s.pcName}`)
      tell(s, { t: 'note', by: 'assistant', what: `The Assistant ${what}.` })
      if (heard) await heard
      return { ...view(s, lines), typed: what, waiting: null }
    },

    close(as, p) {
      on()
      const s = pick(as, p)
      o.log?.info(`ssh session to ${sshLine(s.target)} (${s.pcId}) closed by ${as.who}`)
      end(s, 'Closed by the Assistant.')
      return view(s, 10)
    },
  }

  const mount: ApiMount = {
    prefix: PC_SSH_PREFIX,
    async http(r: MountRequest) {
      const m = /^\/pcs\/([^/]+)\/(target|session|sessions|status|test)$/.exec(r.rest)
      if (!m) throw apiError(404, 'Nothing here.')
      if (r.query.toString()) throw apiError(400, 'Nothing after the path, please.')
      if (m[2] === 'target') {
        if (r.method !== 'GET') throw apiError(405, 'Only GET.')
        mayRead(r, m[1])
        return target(m[1])
      }
      if (m[2] === 'sessions') {
        if (r.method !== 'GET') throw apiError(405, 'Only GET.')
        return list(m[1], r)
      }
      if (m[2] === 'status' || m[2] === 'test') {
        if (!o.status) throw apiError(404, 'Nothing here.')
        if (r.method !== (m[2] === 'status' ? 'GET' : 'POST')) throw apiError(405, m[2] === 'status' ? 'Only GET.' : 'Only POST.')
        if (m[2] === 'test' && r.body !== null && r.body !== undefined && (typeof r.body !== 'object' || Array.isArray(r.body) || Object.keys(r.body).length)) throw apiError(400, 'The test takes an empty JSON object.')
        mayRead(r, m[1])
        if (!ID.test(m[1]) || !o.pc(m[1])) throw apiError(404, 'That is not one of this app’s PCs.')
        return m[2] === 'status' ? o.status.status(m[1]) : o.status.test(m[1])
      }
      if (r.method !== 'POST') throw apiError(405, 'Only POST.')
      return session(m[1], r)
    },
    ws(rest, query) {
      if (rest !== '/terminal') return null
      const ticket = query.get('ticket') ?? ''
      return (socket, caller) => attach(ticket, socket, caller ?? { person: null, via: 'local', sid: null })
    },
    wsAllow(rest, query, caller) {
      if (rest === '/terminal') allow(query, caller)
    },
  }

  return {
    mount,
    closeAll() {
      for (const s of [...sessions.values()]) end(s, 'The agent is stopping.', null, 1001)
    },
    open: () => sessions.size,
    savedTarget: id => {
      const t = readTargets()[id]
      return t ? { user: t.user, host: t.host, port: t.port } : null
    },
    assistant,
  }
}
