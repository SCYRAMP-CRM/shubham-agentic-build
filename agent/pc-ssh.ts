import net from 'node:net'
import type { Duplex } from 'node:stream'
import { cleanTailnetIp, cleanTailnetName } from '../shared/pc-ports.ts'
import { cleanSshReport, PC_SSH_PROTOCOL, PC_SSH_STREAM, sshCommand, unknownSshReport, type PcSshReport, type PcSshTest } from '../shared/pc-ssh.ts'
import type { SshTarget } from '../shared/pc-ssh-term.ts'
import { apiError } from './api.ts'
import { answerOnce, exchange } from './pc-ports.ts'
import type { SshFacts } from './pc-ssh-read.ts'

// Order o1fa0 (second slice): PC control's SSH tab, the read-only status (shared/pc-ssh.ts). This PC's agent reads its own OpenSSH (pc-ssh-read.ts);
// the Server asks a member over their link (stream 'pc-ssh-v1', as Ports does). The Test only connects to the PC's SSH port over the tailnet and reads
// the server's greeting line ("SSH-2.0-…"), then closes: no key is offered, nothing logs in. The routes are on the SSH tab's mount (pc-ssh-term.ts).

const ID = /^[a-z0-9]{16}$/
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface ProbeResult {
  answered: boolean
  banner: string | null
  ms: number | null
  reason: string | null
}
export type Probe = (host: string, port: number, timeoutMs: number) => Promise<ProbeResult>

/** Connects, reads the first line the server sends, closes. Nothing is sent: no key, no login. */
export const realProbe: Probe = (host, port, timeoutMs) =>
  new Promise(resolve => {
    const started = Date.now()
    let data = ''
    let done = false
    const socket = net.connect({ host, port })
    const finish = (r: ProbeResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      resolve(r)
    }
    const timer = setTimeout(() => finish({ answered: false, banner: null, ms: null, reason: `No answer within ${Math.round(timeoutMs / 1000)} s.` }), timeoutMs)
    socket.setEncoding('latin1')
    socket.on('data', (chunk: string) => {
      data += chunk
      const line = data.split(/\r?\n/)[0]
      if (data.includes('\n') || data.length > 255) {
        const ms = Date.now() - started
        finish(/^SSH-[\x20-\x7e]{1,120}$/.test(line) ? { answered: true, banner: line, ms, reason: null } : { answered: true, banner: null, ms, reason: 'The port answered, but not as an SSH server.' })
      }
    })
    socket.on('error', e => {
      const code = (e as NodeJS.ErrnoException).code
      finish({ answered: false, banner: null, ms: null, reason: code === 'ECONNREFUSED' ? 'Nothing listens on that port (connection refused).' : code === 'EHOSTUNREACH' || code === 'ENETUNREACH' ? 'That address cannot be reached from the Server.' : `It did not connect (${code ?? 'error'}).` })
    })
    socket.on('end', () => finish({ answered: Boolean(data), banner: null, ms: Date.now() - started, reason: data ? 'The port answered, but not as an SSH server.' : 'The port closed without a word.' }))
  })

export interface SshStatusOptions {
  selfId: string
  role(): 'hub' | 'member'
  hubId(): string | null
  /** This PC's own SSH (pc-ssh-read.ts readSsh). */
  read(): Promise<SshFacts>
  /** This PC's own tailnet name and IPv4. */
  tailnet(): { name: string | null; address: string | null }
  /** The Server: the link to a member, or null while it is not connected. */
  peer(id: string): { open(): Promise<Duplex> } | null
  /** The Server: a paired PC's name, or null (404). */
  member(id: string): { name: string } | null
  /** The last terminal target used for a PC (pc-ssh-term.ts), so a Test works even when the PC itself cannot say. */
  savedTarget(id: string): SshTarget | null
  probe?: Probe
  timeoutMs?: number
  now?: () => number
}

export interface SshStatus {
  status(id: string): Promise<PcSshReport>
  test(id: string): Promise<PcSshTest>
  /** The member's side of 'pc-ssh-v1' (main.ts's onOpen). Throws for anyone but its pinned Server. */
  serve(meta: Record<string, unknown>): (stream: Duplex) => void
}

/** The port a command or a Test uses: one that listens now, else the first set. */
const portOf = (r: Pick<PcSshReport, 'openssh'>): number | null => {
  const listening = r.openssh.listening.map(a => Number(a.slice(a.lastIndexOf(':') + 1))).find(p => r.openssh.ports.includes(p))
  return listening ?? r.openssh.ports[0] ?? null
}

export function createSshStatus(o: SshStatusOptions): SshStatus {
  const now = o.now ?? Date.now
  const probe = o.probe ?? realProbe
  const last = new Map<string, { tailnetName: string | null; tailnetAddress: string | null }>()

  async function own(): Promise<PcSshReport> {
    const f = await o.read()
    const t = o.tailnet()
    const base = { protocol: PC_SSH_PROTOCOL, pcId: o.selfId, connection: 'online' as const, reason: null, os: f.os, tailnetName: cleanTailnetName(t.name), tailnetAddress: cleanTailnetIp(t.address), openssh: f.openssh, allowUsers: f.allowUsers, allowGroups: f.allowGroups, keys: f.keys, keyFiles: f.keyFiles, keysNote: f.keysNote, tailscaleSsh: f.tailscaleSsh, checkedAt: new Date(now()).toISOString() }
    return { ...base, command: f.openssh.installed ? sshCommand(f.user, base.tailnetAddress, portOf(base)) : null }
  }

  async function status(id: string): Promise<PcSshReport> {
    if (!ID.test(id)) throw apiError(404, 'There is no such PC.')
    if (id === o.selfId) return own()
    if (o.role() !== 'hub') throw apiError(409, 'Open PC control on the Server to see another PC’s SSH.')
    const pc = o.member(id)
    if (!pc) throw apiError(404, 'That PC is not one of the Server’s PCs.')
    const before = last.get(id) ?? null
    const peer = o.peer(id)
    if (!peer) return unknownSshReport(id, 'offline', `${pc.name} is off or not connected to the app right now, so its SSH status is unknown.`, before)
    let stream: Duplex
    try {
      stream = await peer.open()
    } catch {
      return unknownSshReport(id, 'unsupported', `${pc.name} runs an older build that cannot report its SSH. Update it from its Updates tab, then look again.`, before)
    }
    try {
      const report = cleanSshReport(await exchange(stream, { protocol: PC_SSH_PROTOCOL, targetId: id }, o.timeoutMs ?? 14_000), id)
      if (report.connection !== 'online') throw new Error('not an answer from that PC')
      last.set(id, { tailnetName: report.tailnetName, tailnetAddress: report.tailnetAddress })
      return report
    } catch {
      return unknownSshReport(id, 'offline', `${pc.name} did not answer about its SSH, so it is unknown. Refresh to ask again.`, before)
    } finally {
      stream.destroy()
    }
  }

  async function test(id: string): Promise<PcSshTest> {
    const r = await status(id)
    // Where to knock: what the PC itself says (its Tailscale address and its SSH port), else the last terminal target used for it.
    const saved = o.savedTarget(id)
    const fromReport = r.connection === 'online' && r.openssh.installed && r.tailnetAddress && portOf(r) ? { host: r.tailnetAddress, port: portOf(r)! } : null
    const target = fromReport ?? (saved ? { host: saved.host, port: saved.port } : null)
    const answer = (p: Partial<PcSshTest>): PcSshTest => ({ protocol: PC_SSH_PROTOCOL, pcId: id, answered: false, banner: null, target: null, ms: null, reason: null, ...p })
    if (r.connection === 'online' && r.openssh.installed === false) return answer({ reason: 'OpenSSH is not installed on this PC, so there is no port to test.' })
    if (!target || !(cleanTailnetIp(target.host) || cleanTailnetName(target.host))) return answer({ reason: 'No SSH address is known for this PC yet: open a terminal to it once, or update it so it can say.' })
    const p = await probe(target.host, target.port, 5000)
    return answer({ ...p, target: cleanTailnetIp(target.host) ? `${target.host}:${target.port}` : null })
  }

  function serve(meta: Record<string, unknown>): (stream: Duplex) => void {
    const from = meta.from
    if (o.role() !== 'member' || !obj(from) || typeof from.id !== 'string' || from.id !== o.hubId()) throw new Error('Only this PC’s Server may ask for its SSH status.')
    return stream => answerOnce(stream, raw => {
      if (!obj(raw) || raw.protocol !== PC_SSH_PROTOCOL || raw.targetId !== o.selfId || Object.keys(raw).length !== 2) throw new Error('not an SSH request for this PC')
      return own()
    })
  }

  return { status, test, serve }
}

export { PC_SSH_STREAM }
