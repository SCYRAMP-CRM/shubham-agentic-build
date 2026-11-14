import type { Duplex } from 'node:stream'
import { cleanDepsReport, PC_DEPS_PREFIX, PC_DEPS_PROTOCOL, PC_DEPS_STREAM, unknownDepsReport, type PcDepsReport } from '../shared/pc-deps.ts'
import { apiError, type ApiMount, type MountRequest } from './api.ts'
import { answerOnce, exchange } from './pc-ports.ts'
import type { readDeps } from './pc-deps-read.ts'

// Order oc7c9: PC control's Dependencies tab (shared/pc-deps.ts). READ ONLY. GET /agent-api/pc-deps/pcs/<id>: this PC's own list, or (the Server) a
// member's, asked over their link on a 'pc-deps-v1' stream, as Ports and SSH do. Not a scoped mount: the owner only. A list is kept a minute, so a
// page that refreshes does not run the version questions again and again.

const ID = /^[a-z0-9]{16}$/
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const KEEP_MS = 60_000

export interface PcDepsOptions {
  selfId: string
  role(): 'hub' | 'member'
  hubId(): string | null
  read(): ReturnType<typeof readDeps>
  peer(id: string): { open(): Promise<Duplex> } | null
  member(id: string): { name: string } | null
  timeoutMs?: number
  now?: () => number
}

export interface PcDeps {
  mount: ApiMount
  get(id: string, fresh?: boolean): Promise<PcDepsReport>
  serve(meta: Record<string, unknown>): (stream: Duplex) => void
}

export function createPcDeps(o: PcDepsOptions): PcDeps {
  const now = o.now ?? Date.now
  let kept: { at: number; report: Promise<PcDepsReport> } | null = null

  function own(fresh = false): Promise<PcDepsReport> {
    if (!fresh && kept && now() - kept.at < KEEP_MS) return kept.report
    const report = o.read().then(r => ({ protocol: PC_DEPS_PROTOCOL, pcId: o.selfId, connection: 'online' as const, reason: null, ...r, checkedAt: new Date(now()).toISOString() }))
    kept = { at: now(), report }
    // A failed read is not kept: the next ask tries again.
    report.catch(() => {
      if (kept?.report === report) kept = null
    })
    return report
  }

  async function get(id: string, fresh = false): Promise<PcDepsReport> {
    if (!ID.test(id)) throw apiError(404, 'There is no such PC.')
    if (id === o.selfId) return own(fresh)
    if (o.role() !== 'hub') throw apiError(409, 'Open PC control on the Server to see another PC’s dependencies.')
    const pc = o.member(id)
    if (!pc) throw apiError(404, 'That PC is not one of the Server’s PCs.')
    const peer = o.peer(id)
    if (!peer) return unknownDepsReport(id, 'offline', `${pc.name} is off or not connected to the app right now, so its dependencies are unknown.`)
    let stream: Duplex
    try {
      stream = await peer.open()
    } catch {
      return unknownDepsReport(id, 'unsupported', `${pc.name} runs an older build that cannot list its dependencies. Update it from its Updates tab, then look again.`)
    }
    try {
      const report = cleanDepsReport(await exchange(stream, { protocol: PC_DEPS_PROTOCOL, targetId: id, fresh }, o.timeoutMs ?? 14_000), id)
      if (report.connection !== 'online') throw new Error('not an answer from that PC')
      return report
    } catch {
      return unknownDepsReport(id, 'offline', `${pc.name} did not answer about its dependencies. Refresh to ask again.`)
    } finally {
      stream.destroy()
    }
  }

  const mount: ApiMount = {
    prefix: PC_DEPS_PREFIX,
    async http(r: MountRequest) {
      const m = /^\/pcs\/([^/]+)$/.exec(r.rest)
      if (!m) throw apiError(404, 'Nothing here.')
      if (r.method !== 'GET') throw apiError(405, 'Only GET.')
      const q = [...r.query.keys()]
      if (q.some(k => k !== 'fresh') || (r.query.has('fresh') && r.query.get('fresh') !== '1')) throw apiError(400, 'Only ?fresh=1 after the PC’s ID.')
      return get(m[1], r.query.get('fresh') === '1')
    },
  }

  function serve(meta: Record<string, unknown>): (stream: Duplex) => void {
    const from = meta.from
    if (o.role() !== 'member' || !obj(from) || typeof from.id !== 'string' || from.id !== o.hubId()) throw new Error('Only this PC’s Server may ask for its dependencies.')
    return stream => answerOnce(stream, raw => {
      if (!obj(raw) || raw.protocol !== PC_DEPS_PROTOCOL || raw.targetId !== o.selfId || Object.keys(raw).some(k => !['protocol', 'targetId', 'fresh'].includes(k))) throw new Error('not a dependencies request for this PC')
      return own(raw.fresh === true)
    })
  }

  return { mount, get, serve }
}

export { PC_DEPS_STREAM }
