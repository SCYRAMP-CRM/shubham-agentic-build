import { existsSync, readFileSync } from 'node:fs'
import { WA_BACKEND_PREFIX, WA_PREFIX, type WaBackendCode } from '../../shared/whatsapp.ts'
import { apiError, type ApiMount, type MountRequest } from '../api.ts'
import type { AssistantTools } from './assistant-tools.ts'
import type { BackendView } from './supervisor.ts'

// Order o8416 (F-223): the WhatsApp page talks to the agent, and the agent passes its requests to the WhatsApp backend on
// 127.0.0.1 (server.ts), adding the backend's token itself. The page never sees the token.
// - This mount is not `scoped`, so the agent's own guard lets only the owner (sbskrrt) through before any of this runs.
// - Only the routes the WhatsApp page uses are passed on; anything else is 404.
// - Sends still need the backend's own answer: the backend refuses them (server.ts), so a page send cannot go through yet.
// Order of5a0: the backend is the hub's to keep running (supervisor.ts). Its port is the one the RUNNING backend said it got (its ready word), never
// a port file that may be stale (another program may hold that port by now, and the token would go to it). Not running, a 503 that says the
// truth, with a code the page reads (WaBackendCode): starting (or starting again after a failure, and which), stopped (and why), off, no answer.

interface Route {
  method: string
  pattern: RegExp
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/status$/ },
  { method: 'POST', pattern: /^\/setup$/ },
  { method: 'POST', pattern: /^\/open$/ },
  { method: 'POST', pattern: /^\/close$/ },
  { method: 'POST', pattern: /^\/pair-code$/ },
  { method: 'POST', pattern: /^\/unlink$/ },
  { method: 'PATCH', pattern: /^\/settings$/ },
  { method: 'GET', pattern: /^\/chats$/ },
  { method: 'GET', pattern: /^\/messages$/ },
  { method: 'POST', pattern: /^\/send$/ },
  { method: 'DELETE', pattern: /^\/drafts\/[^/]+$/ },
]

export const allowedRoute = (method: string, rest: string): boolean => ROUTES.some(r => r.method === method && r.pattern.test(rest))

export interface ProxyOptions {
  /** The backend's state folder: its token file is <dir>\token. */
  dir: string
  /** Order of5a0: the hub's supervisor, as it stands now (null where none runs: not the Server). */
  backend?: () => BackendView | null
  /** Order of5a0 (A2): which login the Assistant's WhatsApp tools use (the hub's), shown with the status and chosen here. */
  assistantTools?: () => AssistantTools | null
  /** Tests: a backend on a known port, with no supervisor. */
  port?: number
  /** Tests: a fetch to use in place of the network. */
  fetchImpl?: typeof fetch
  /** Tests: how long one call may take. */
  timeoutMs?: number
}

const down = (code: WaBackendCode, message: string) => Object.assign(apiError(503, message), { code })

/** The port to call, or the true reason there is none (a 503 with its code). */
export function backendPort(view: BackendView | null): number {
  if (view === null) throw down('wa-backend-off', 'WhatsApp runs on the Server; its backend does not run on this PC.')
  if (view.state === 'running' && view.port !== null) return view.port
  if (view.state === 'starting')
    throw down('wa-backend-starting', view.why ? `The WhatsApp backend is starting again after a failure (${view.why}). Try again in a few seconds.` : 'The WhatsApp backend is starting on this Server. Try again in a few seconds.')
  if (view.state === 'stopped') throw down('wa-backend-stopped', `The WhatsApp backend is stopped: ${view.why ?? 'no reason was given'}.`)
  throw down('wa-backend-off', view.why ? `The WhatsApp backend is not running on this Server: ${view.why}.` : 'The WhatsApp backend is not running on this Server.')
}

export function createWhatsAppBackendProxy(o: ProxyOptions): ApiMount {
  const doFetch = o.fetchImpl ?? fetch
  const timeoutMs = o.timeoutMs ?? 20_000
  const tokenFile = `${o.dir}/token`

  /** Read fresh each call: a restarted backend that made a new token is picked up at once. */
  function token(): string {
    if (!existsSync(tokenFile)) throw down('wa-backend-no-token', 'The WhatsApp backend has not made its token on this Server yet.')
    const t = readFileSync(tokenFile, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/.test(t)) throw down('wa-backend-no-token', 'The WhatsApp backend has no valid token on this Server yet.')
    return t
  }

  return {
    prefix: WA_BACKEND_PREFIX,
    async http(req: MountRequest): Promise<unknown> {
      const { method, rest, query, body } = req
      // Order of5a0 (A2): his choice of the Assistant's login is the agent's own, not the backend's.
      if (method === 'PATCH' && rest === '/assistant-tools') {
        const at = o.assistantTools?.() ?? null
        if (!at) throw apiError(404, 'The Assistant has only one WhatsApp here.')
        return at.choose((body as { use?: unknown } | undefined)?.use)
      }
      if (!allowedRoute(method, rest)) throw apiError(404, `No such WhatsApp path: ${method} ${rest}`)
      const port = o.port ?? backendPort(o.backend?.() ?? null)
      const qs = query.toString()
      const url = `http://127.0.0.1:${port}${WA_PREFIX}${rest}${qs ? `?${qs}` : ''}`
      const json = method !== 'GET' && method !== 'HEAD' && body !== undefined
      const headers = { 'x-sad-token': token(), ...(json ? { 'content-type': 'application/json' } : {}) }
      let res: Response
      try {
        res = await doFetch(url, { method, cache: 'no-store', headers, body: json ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) })
      } catch (e) {
        const cause = (e as { cause?: { code?: unknown } }).cause?.code
        const what = (e as Error).name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : typeof cause === 'string' ? cause : 'the connection failed'
        throw down('wa-backend-unreachable', `The WhatsApp backend did not answer (${what}).`)
      }
      const data = (await res.json().catch(() => null)) as unknown
      if (!res.ok) throw apiError(res.status, typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `The WhatsApp backend answered ${res.status}`)
      const at = method === 'GET' && rest === '/status' ? (o.assistantTools?.() ?? null) : null
      return at && data !== null && typeof data === 'object' ? { ...(data as Record<string, unknown>), assistantTools: at.state() } : data
    },
  }
}
