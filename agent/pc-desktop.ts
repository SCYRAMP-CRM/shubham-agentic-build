import { DESKTOP_HTTPS_PORT, DESKTOP_PORT, PC_DESKTOP_PREFIX, desktopHttpsUrl, desktopUrl, looksLikeNoVnc, tailnetHost, tailnetIp, type PcDesktop } from '../shared/pc-desktop.ts'
import { apiError, type ApiMount, type MountRequest } from './api.ts'

// Order o226e: whether a PC's desktop answers, for PC control's Desktop tab (shared/pc-desktop.ts). READ ONLY: at most two bounded GETs of noVNC's
// page on that PC: https by its tailnet name (port 6443, tailscale serve there) first, then plain http by its tailnet address (port 6080). The name
// and address are the ones that PC's own agent reports, so this never names any other host. No password, no write, nothing else on that PC. Not a
// "scoped" mount and no Settings › Access route opens it (pc-desktop is locked), so the API lets only the owner in, like Screen.

const ID = /^[a-z0-9]{16}$/
const MAX_BODY = 65_536

export interface PcDesktopOptions {
  selfId: string
  role(): 'hub' | 'member'
  /** The Server: a paired PC's name, or null for an ID that is none of its PCs (404). */
  member(id: string): { name: string } | null
  /** That PC's Tailscale address and name as its own agent says them (this PC's own, or a member's ports report); nulls when unknown. */
  whereIs(id: string): Promise<{ address: string | null; name: string | null }>
  /** Tests: a fake fetch. */
  fetch?: typeof fetch
  timeoutMs?: number
  cacheMs?: number
  now?: () => number
}

export interface PcDesktopCheck {
  mount: ApiMount
  check(id: string, fresh?: boolean): Promise<PcDesktop>
}

/** At most `max` bytes of a body, as text; the rest is never read. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.length
      if (size >= max) break
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8')
}

export function createPcDesktop(o: PcDesktopOptions): PcDesktopCheck {
  const get = o.fetch ?? fetch
  const now = o.now ?? Date.now
  const cache = new Map<string, { at: number; value: PcDesktop }>()

  /** null: noVNC answers there; otherwise what did. */
  async function probe(page: string): Promise<string | null> {
    try {
      const res = await get(page, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 2500) })
      const body = res.status === 200 ? await readCapped(res, MAX_BODY) : ''
      if (res.status !== 200) void res.body?.cancel().catch(() => {})
      return looksLikeNoVnc(res.status, body) ? null : `something answers, but not noVNC's page (HTTP ${res.status})`
    } catch {
      return 'nothing answers'
    }
  }

  async function check(id: string, fresh = false): Promise<PcDesktop> {
    if (!ID.test(id)) throw apiError(404, 'There is no such PC.')
    if (id !== o.selfId) {
      if (o.role() !== 'hub') throw apiError(409, 'Open PC control on the Server to see another PC’s desktop.')
      if (!o.member(id)) throw apiError(404, 'That PC is not one of the Server’s PCs.')
    }
    const hit = cache.get(id)
    if (!fresh && hit && now() - hit.at < (o.cacheMs ?? 60_000)) return hit.value
    const checkedAt = new Date(now()).toISOString()
    const at = await o.whereIs(id).catch(() => ({ address: null, name: null }))
    const host = tailnetHost(at.name)
    const ip = tailnetIp(at.address)
    const save = (url: string | null, why: string | null): PcDesktop => {
      const value = { pcId: id, url, why, checkedAt }
      cache.set(id, { at: now(), value })
      return value
    }
    const tried: string[] = []
    if (host) {
      const why = await probe(`https://${host}:${DESKTOP_HTTPS_PORT}/vnc.html`)
      if (why === null) return save(desktopHttpsUrl(host), null)
      tried.push(`https on ${host}:${DESKTOP_HTTPS_PORT}: ${why}`)
    }
    if (ip) {
      const why = await probe(`http://${ip}:${DESKTOP_PORT}/vnc.html`)
      if (why === null) return save(desktopUrl(ip), null)
      tried.push(`http on ${ip}:${DESKTOP_PORT}: ${why}`)
    }
    return save(null, tried.length ? `No desktop answers (${tried.join('; ')}).` : 'Its Tailscale name and address are not known: Tailscale is off there, or it did not answer.')
  }

  const mount: ApiMount = {
    prefix: PC_DESKTOP_PREFIX,
    async http(r: MountRequest) {
      const match = /^\/pcs\/([^/]+)$/.exec(r.rest)
      if (!match) throw apiError(404, 'Nothing here.')
      if (r.method !== 'GET') throw apiError(400, 'Only GET.')
      // ?fresh=1 (the tab's Check again) asks now instead of answering from the last minute; nothing else may be asked.
      const keys = [...r.query.keys()]
      if (keys.some(k => k !== 'fresh') || (keys.length && r.query.get('fresh') !== '1')) throw apiError(400, 'Only GET, with ?fresh=1 at most.')
      return check(match[1], r.query.get('fresh') === '1')
    },
  }
  return { mount, check }
}
