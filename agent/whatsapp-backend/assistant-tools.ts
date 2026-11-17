import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { WaAssistantTools, WaChat, WaDraft, WaMessage, WaStatus } from '../../shared/whatsapp.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import type { WaTools } from '../whatsapp/index.ts'
import { statusText } from '../whatsapp/tools.ts'
import { backendPort } from './proxy.ts'
import type { BackendView } from './supervisor.ts'

// Order of5a0 (A2, Lead's GO with his conditions): the overlay Assistant's four WhatsApp tools (wa_status, wa_chats, wa_read, wa_prepare_send),
// told which of the two logins to use. There are two: F-079's own in the agent (the Assistant's until now) and the one linked on the WhatsApp
// page, in the Server's WhatsApp backend (F-223). A QR scanned on the page links only the second.
// - It starts, and stays, on F-079's, unchanged, until the page's WhatsApp is linked AND answering. Then, at the next tool call, it moves to it
//   on its own and writes that down (assistant-tools.json beside the backend's state). The page's WhatsApp has never been linked, so until he
//   links it this is inert: nothing the Assistant does today changes.
// - Once moved, the tools use the page's WhatsApp only. If it cannot answer, the call fails and says so; it never quietly answers from the
//   other login (Lead: a silent fallback is what makes him distrust the whole feature).
// - wa_status always says which login answered, and whether the other is linked.
// - He can choose either (the page's WhatsApp settings). His choice of the in-app one is kept, and it never moves on its own again; the page's
//   one can be chosen only once it is linked.

export interface AssistantToolsOptions {
  /** F-079's own WhatsApp in the agent (null where there is none). */
  inApp: WaTools | null
  /** The backend's state folder: its token, and assistant-tools.json. */
  dir: string
  /** The hub's supervisor, as it stands now (null where none runs). */
  backend: () => BackendView | null
  log: Logger
  /** Tests. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export interface AssistantTools extends WaTools {
  /** wa_status's text: which login answered, its state, and the other one's. */
  describe(): Promise<string>
  state(): WaAssistantTools
  /** His choice ('in-app' | 'backend'). */
  choose(use: unknown): Promise<WaAssistantTools>
}

const START: WaAssistantTools = { use: 'in-app', since: null, by: null }
const PAGE = 'the WhatsApp linked on the WhatsApp page'
const IN_APP = 'the older in-app WhatsApp'
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createAssistantTools(o: AssistantToolsOptions): AssistantTools {
  const file = path.join(o.dir, 'assistant-tools.json')
  const now = o.now ?? Date.now
  const doFetch = o.fetchImpl ?? fetch
  const timeoutMs = o.timeoutMs ?? 20_000

  function read(): WaAssistantTools {
    try {
      const v = JSON.parse(readFileSync(file, 'utf8')) as Partial<WaAssistantTools>
      if ((v.use === 'in-app' || v.use === 'backend') && (v.by === 'auto' || v.by === 'owner') && typeof v.since === 'string') return { use: v.use, since: v.since, by: v.by }
      o.log.warn(`the Assistant's WhatsApp choice (${file}) is not one this app writes: it stays on the older in-app WhatsApp`)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') o.log.warn(`the Assistant's WhatsApp choice could not be read (${message(e)}): it stays on the older in-app WhatsApp`)
    }
    return { ...START }
  }
  let state = read()
  const save = (next: WaAssistantTools) => {
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    state = next
  }

  /** The page's WhatsApp (the backend), by its token; a refusal or no answer is thrown with its words. */
  async function page<T>(method: 'GET' | 'POST', rest: string, body?: unknown, ms = timeoutMs): Promise<T> {
    const port = backendPort(o.backend())
    let token: string
    try {
      token = readFileSync(path.join(o.dir, 'token'), 'utf8').trim()
    } catch {
      throw apiError(503, 'the page\'s WhatsApp backend has no token yet')
    }
    let res: Response
    try {
      res = await doFetch(`http://127.0.0.1:${port}/whatsapp/assistant${rest}`, {
        method,
        headers: { 'x-sad-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(ms),
      })
    } catch (e) {
      throw apiError(503, `the page's WhatsApp backend did not answer (${(e as Error).name === 'TimeoutError' ? 'no answer in time' : message(e)})`)
    }
    const data = (await res.json().catch(() => null)) as T & { error?: unknown }
    if (!res.ok) throw apiError(res.status, typeof data?.error === 'string' ? data.error : `the page's WhatsApp backend answered ${res.status}`)
    return data
  }

  /** The page's WhatsApp, if it answers now: its status, or why not. */
  async function pageStatus(): Promise<{ ok: true; status: WaStatus } | { ok: false; why: string }> {
    try {
      return { ok: true, status: await page<WaStatus>('GET', '/status', undefined, 3000) }
    } catch (e) {
      return { ok: false, why: message(e) }
    }
  }

  /** Not his choice of the in-app one, and the page's WhatsApp linked AND answering: move to it, and write that down. */
  async function maybeMove(): Promise<void> {
    if (state.use === 'backend' || state.by === 'owner') return
    const p = await pageStatus()
    if (!p.ok || !p.status.linked) return
    save({ use: 'backend', since: new Date(now()).toISOString(), by: 'auto' })
    o.log.info(`the Assistant's WhatsApp tools now use ${PAGE} (it is linked and answered)`)
  }

  const inApp = (): WaTools => {
    if (!o.inApp) throw apiError(409, "WhatsApp isn't on in this app: it runs on the hub.")
    return o.inApp
  }
  /** On the page's WhatsApp, a failure says that it was that one; it is never answered from the other login instead. */
  const onPage = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (e) {
      const status = (e as { status?: number }).status
      throw apiError(typeof status === 'number' ? status : 503, `The Assistant's WhatsApp is ${PAGE}, and it could not do this: ${message(e)}. It is not answered from the older in-app WhatsApp instead.`)
    }
  }

  let lastPage: WaStatus | null = null

  return {
    status() {
      return state.use === 'backend' && lastPage ? lastPage : inApp().status()
    },
    async chats(): Promise<WaChat[]> {
      await maybeMove()
      return state.use === 'backend' ? onPage(() => page<WaChat[]>('GET', '/chats')) : inApp().chats()
    },
    async read(chatId, count): Promise<WaMessage[]> {
      await maybeMove()
      return state.use === 'backend' ? onPage(() => page<WaMessage[]>('GET', `/read?chat=${encodeURIComponent(chatId)}&count=${encodeURIComponent(String(count))}`)) : inApp().read(chatId, count)
    },
    async draft(chatId, text, why): Promise<WaDraft> {
      await maybeMove()
      return state.use === 'backend' ? onPage(() => page<WaDraft>('POST', '/draft', { chatId, text, why })) : inApp().draft(chatId, text, why)
    },
    async describe() {
      await maybeMove()
      const lines: string[] = []
      const how = state.by === 'auto' ? ', since it was linked and answered' : state.by === 'owner' ? ', his choice' : ''
      if (state.use === 'backend') {
        const p = await pageStatus()
        if (p.ok) lastPage = p.status
        lines.push(`Answering: ${PAGE}${how}.`)
        lines.push(p.ok ? statusText(p.status) : `It cannot answer now: ${p.why}. Nothing is answered from the older in-app WhatsApp instead.`)
        lines.push(o.inApp ? `Not used: ${IN_APP}, which is ${o.inApp.status().linked ? 'linked' : 'not linked'}.` : `There is no older in-app WhatsApp here.`)
      } else {
        lines.push(`Answering: ${IN_APP}${how}.`)
        lines.push(statusText(inApp().status()))
        const p = await pageStatus()
        const later = state.by === 'owner' ? 'he chose the in-app one' : 'your tools move to it on their own once it is linked and answers'
        lines.push(p.ok ? `Not used: ${PAGE}, which is ${p.status.linked ? 'linked' : 'not linked yet'} (${later}).` : `Not used: ${PAGE}, which is not answering (${p.why}).`)
      }
      return lines.join('\n')
    },
    state: () => ({ ...state }),
    async choose(use) {
      if (use !== 'in-app' && use !== 'backend') throw apiError(400, 'Expected {use: "in-app" | "backend"}')
      if (use === 'backend') {
        const p = await pageStatus()
        if (!p.ok) throw apiError(409, `${PAGE} is not answering (${p.why}), so the Assistant cannot be moved to it.`)
        if (!p.status.linked) throw apiError(409, `${PAGE} is not linked yet: link it first (its QR), then choose it for the Assistant.`)
      }
      save({ use, since: new Date(now()).toISOString(), by: 'owner' })
      o.log.info(`the Assistant's WhatsApp tools now use ${use === 'backend' ? PAGE : IN_APP} (his choice)`)
      return { ...state }
    },
  }
}
