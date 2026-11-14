import type { Duplex } from 'node:stream'
import { PC_RESOURCES_PREFIX, PC_RESOURCES_PROTOCOL, PC_RESOURCES_STREAM, cleanResources, unknownResources, type PcResourcesReport, type PcResourcesRequest } from '../shared/pc-resources.ts'
import { apiError, type ApiMount, type MountRequest } from './api.ts'

// Order odbd8: the Resources tab of PC control (shared/pc-resources.ts). READ ONLY: this module never stops, starts or changes a process or anything else.
//  - GET /agent-api/pc-resources/pcs/<id>: this PC's own report, or (the Server) a member's, asked over their link on a 'pc-resources-v1' stream,
//    the same links and the same rules as the Ports tab (agent/pc-ports.ts).
//  - Not a "scoped" mount, so the API lets only the owner (sbskrrt, or the PC's own open app) in, like every core route.
//  - A member answers only its pinned Server (the link stamps `from`), one request per stream, and only with its own report.

const MAX_BYTES = 262_144
const ID = /^[a-z0-9]{16}$/
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface PcResourcesPeer {
  open(): Promise<Duplex>
}

export interface PcResourcesOptions {
  selfId: string
  role(): 'hub' | 'member'
  hubId(): string | null
  /** This PC's own report (agent/resources/collect.ts). */
  report(): Promise<PcResourcesReport>
  /** The Server: the link to a member, or null while it is not connected. */
  peer(id: string): PcResourcesPeer | null
  /** The Server: a paired PC's name, or null for an ID that is not one of its PCs (404). */
  member(id: string): { name: string } | null
  timeoutMs?: number
}

export interface PcResources {
  mount: ApiMount
  /** The member's side of the 'pc-resources-v1' stream (main.ts's onOpen). Throws for anyone but its pinned Server. */
  serve(meta: Record<string, unknown>): (stream: Duplex) => void
  /** One PC's report, as the page gets it. */
  get(id: string): Promise<PcResourcesReport>
}

export function createPcResources(o: PcResourcesOptions): PcResources {
  async function remote(id: string, name: string): Promise<PcResourcesReport> {
    const peer = o.peer(id)
    if (!peer) return unknownResources(id, 'offline', `${name} is off or not connected right now, so what it is using is unknown.`)
    let stream: Duplex
    try {
      stream = await peer.open()
    } catch {
      return unknownResources(id, 'unsupported', `${name} runs an older build that cannot show its resources. Update it from its Updates tab, then look again.`)
    }
    try {
      const request: PcResourcesRequest = { protocol: PC_RESOURCES_PROTOCOL, targetId: id }
      const report = cleanResources(await exchange(stream, request, o.timeoutMs ?? 10_000), id)
      if (report.connection !== 'online') throw new Error('not an answer from that PC')
      return report
    } catch {
      return unknownResources(id, 'offline', `${name} did not answer about its resources. It is asked again in a few seconds.`)
    } finally {
      stream.destroy()
    }
  }

  async function get(id: string): Promise<PcResourcesReport> {
    if (!ID.test(id)) throw apiError(404, 'There is no such PC.')
    if (id === o.selfId) return o.report()
    if (o.role() !== 'hub') throw apiError(409, 'Open PC control on the Server to see another PC’s resources.')
    const pc = o.member(id)
    if (!pc) throw apiError(404, 'That PC is not one of the Server’s PCs.')
    return remote(id, pc.name)
  }

  const mount: ApiMount = {
    prefix: PC_RESOURCES_PREFIX,
    async http(r: MountRequest) {
      const match = /^\/pcs\/([^/]+)$/.exec(r.rest)
      if (!match) throw apiError(404, 'Nothing here.')
      if (r.method !== 'GET' || r.query.toString()) throw apiError(400, 'Only GET, with nothing after the PC’s ID.')
      return get(match[1])
    },
  }

  function serve(meta: Record<string, unknown>): (stream: Duplex) => void {
    const from = meta.from
    if (o.role() !== 'member' || !obj(from) || typeof from.id !== 'string' || from.id !== o.hubId()) throw new Error('Only this PC’s Server may ask what it is using.')
    return stream => answerOnce(stream, raw => {
      if (!obj(raw) || raw.protocol !== PC_RESOURCES_PROTOCOL || raw.targetId !== o.selfId || Object.keys(raw).length !== 2) throw new Error('not a resources request for this PC')
      return o.report()
    })
  }

  return { mount, serve, get }
}

/** The member's side: one JSON line in, one JSON line out ({ok:true,value} or {ok:false}), then the stream ends. */
function answerOnce(stream: Duplex, work: (raw: unknown) => Promise<PcResourcesReport>) {
  let data = ''
  let used = false
  const timer = setTimeout(() => stream.destroy(), 15_000)
  timer.unref()
  stream.setEncoding('utf8')
  stream.on('error', () => {})
  stream.on('close', () => clearTimeout(timer))
  stream.on('data', (chunk: string) => {
    if (used) return
    data += chunk
    if (data.length > 4096) {
      used = true
      stream.destroy()
      return
    }
    const i = data.indexOf('\n')
    if (i < 0) return
    used = true
    void (async () => {
      let reply: string
      try {
        reply = JSON.stringify({ ok: true, value: await work(JSON.parse(data.slice(0, i))) })
      } catch {
        reply = JSON.stringify({ ok: false })
      }
      if (!stream.destroyed) stream.end(reply + '\n')
    })()
  })
}

/** The Server's side: sends the request line, reads one answer line (bounded in size and time). */
function exchange(stream: Duplex, request: PcResourcesRequest, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    let done = false
    const finish = (error: Error | null, value?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs)
    timer.unref()
    stream.setEncoding('utf8')
    stream.on('error', () => finish(new Error('transport failed')))
    stream.on('end', () => finish(new Error('incomplete answer')))
    stream.on('close', () => finish(new Error('connection closed')))
    stream.on('data', (chunk: string) => {
      data += chunk
      if (data.length > MAX_BYTES) {
        finish(new Error('oversized answer'))
        stream.destroy()
        return
      }
      const i = data.indexOf('\n')
      if (i < 0) return
      try {
        const raw: unknown = JSON.parse(data.slice(0, i))
        if (obj(raw) && raw.ok === true && Object.keys(raw).length === 2) finish(null, raw.value)
        else finish(new Error('refused'))
      } catch {
        finish(new Error('invalid answer'))
      }
    })
    stream.end(JSON.stringify(request) + '\n')
  })
}

export { PC_RESOURCES_STREAM }
