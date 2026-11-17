import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { OpenCodeClient } from './client.ts'
import { isolatedEnvironment, providerEnvironment } from './home.ts'
import type { OpenCodeCredential } from './crm.ts'
import { freeModel, verifyFreeModel } from './free-model.ts'
import type { OpenCodeInstall } from './install.ts'
import { killTree } from '../proc-tree.ts'

export interface BackendOptions {
  install: OpenCodeInstall
  root: string
  cwd: string
  credential: OpenCodeCredential
  model: string
  native: string | null
  brief: string
  toolsUrl: string
  chatKey: string
  shim: string
  mcp?: Record<string, { command: string[]; environment?: Record<string, string> }>
  event: (event: any) => void
  exited: () => void
  /** Synthetic protocol proof only; not accepted from settings or API requests. */
  mockBaseUrl?: string
  spawned?: (pid: number) => void
}
export interface Backend {
  pid?: number
  native: string
  model: string
  client: Pick<OpenCodeClient, 'request'>
  terminal: { executable: string; args: string[]; env: Record<string, string> }
  snapshot(): Promise<unknown>
  send(text: string): Promise<void>
  abort(): Promise<void>
  close(): Promise<void>
}
async function port(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const p = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return p
}
/** Free sessions expose exactly one verified choice to HTTP and the attached TUI. */
export function modelConfiguration(credential: OpenCodeCredential, selected: string, mockBaseUrl?: string) {
  const model = credential.kind === 'free' ? freeModel(selected) : selected
  return {
    enabled_providers: [credential.provider],
    ...(model ? { model: `${credential.provider}/${model}`, small_model: `${credential.provider}/${model}` } : {}),
    ...(credential.kind === 'free' ? { provider: { opencode: { whitelist: [model] } } } : mockBaseUrl ? { provider: { [credential.provider]: {
      options: { baseURL: mockBaseUrl }, models: { [model]: { name: 'Synthetic mock', limit: { context: 32000, output: 4000 } } },
    } } } : {}),
  }
}
/** How many times a backend that exits before it answers is started: a fresh port each time. The port is asked for and closed before the child binds it, and another program can take it in that gap. */
const START_TRIES = 3

interface Launched { child: ChildProcess; client: OpenCodeClient; controller: AbortController; close: () => Promise<void> }

/** One try: `opencode serve` on a fresh port, until it answers /global/health. An exit before that carries `earlyExit` (a fresh port may help), unless the program could not be started at all. */
async function launch(o: BackendOptions, env: ReturnType<typeof isolatedEnvironment>, password: string, tried: number[], last: boolean): Promise<Launched> {
  const p = await port()
  tried.push(p)
  const started = Date.now()
  const child: ChildProcess = spawn(o.install.executable, ['serve', '--hostname', '127.0.0.1', '--port', String(p)], { cwd: o.cwd, env: providerEnvironment(env, o.credential), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
  if (child.pid) o.spawned?.(child.pid)
  // No child output is logged: a provider's diagnostics may contain credentials.
  let dead = false, closed = false, ready = false, unstartable = false
  // An exit before it answered, with another try still to come, is not the backend dying: only the last try, or a backend that had answered, tells `exited`.
  child.once('exit', () => { dead = true; if (!closed && (ready || last)) o.exited() })
  child.once('error', () => { dead = true; unstartable = true; if (!closed) o.exited() })
  const client = new OpenCodeClient(p, password, o.cwd), controller = new AbortController()
  const close = async () => {
    if (closed) return
    closed = true; controller.abort()
    if (child.pid && !dead) {
      const descendants = killTree(child.pid, { since: started }).catch(() => {})
      // End the exact child handle synchronously as well: an agent hard-exit
      // must not leave its HTTP backend alive while tree discovery is pending.
      child.kill()
      await descendants
    }
  }
  try {
    for (let i = 0; i < 100; i++) {
      if (dead) throw Object.assign(new Error(`OpenCode backend exited before becoming ready (port ${p}).`), { earlyExit: !unstartable })
      try { const health = await client.request('/global/health', 'GET', undefined, 500); if (health.version !== o.install.version) throw new Error('version'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    if (!ready) throw new Error('OpenCode did not become ready.')
  } catch (error) { await close(); throw error }
  return { child, client, controller, close }
}
/** One process, one isolated database, one provider credential, no credential files. */
export async function startBackend(o: BackendOptions): Promise<Backend> {
  const selectedModel = o.credential.kind === 'free' ? freeModel(o.model) : o.model
  const password = randomBytes(32).toString('hex')
  const env = isolatedEnvironment(o.root)
  env.OPENCODE_SERVER_PASSWORD = password
  env.SAD_AGENTIC_URL = o.toolsUrl; env.SAD_AGENTIC_KEY = o.chatKey
  const strip = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', OPENCODE_SERVER_PASSWORD: '' }
  const mcp = Object.fromEntries(Object.entries(o.mcp ?? {}).map(([name, value]) => [name, { type: 'local', command: value.command, environment: { ...value.environment, ...strip } }]))
  mcp['shubham-agentic'] = { type: 'local', command: [process.execPath, o.shim], environment: strip }
  if (o.mockBaseUrl && new URL(o.mockBaseUrl).hostname !== '127.0.0.1') throw new Error('Synthetic provider must be loopback')
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    permission: 'allow', autoupdate: false, share: 'disabled',
    // Native TUI turns must receive the same agent brief as HTTP turns.
    default_agent: 'build', agent: { build: { prompt: o.brief } },
    ...modelConfiguration(o.credential, selectedModel, o.mockBaseUrl),
    mcp,
  })
  const tried: number[] = []
  let run: Launched | undefined
  for (let attempt = 1; !run; attempt++) {
    try { run = await launch(o, env, password, tried, attempt === START_TRIES) } catch (error) {
      if (!(error as { earlyExit?: boolean }).earlyExit) throw error
      if (attempt === START_TRIES) throw new Error(`OpenCode backend exited before becoming ready on ${tried.length} tries (ports ${tried.join(', ')}); its output is not logged.`, { cause: error })
    }
  }
  const { child, client, controller, close } = run
  try {
    const providers = await client.request('/provider')
    const model = o.credential.kind === 'free' ? verifyFreeModel(providers, selectedModel) : selectedModel || providers.default?.[o.credential.provider]
    if (typeof model !== 'string' || !providers.all?.find((x: any) => x.id === o.credential.provider)?.models?.[model]) throw new Error('Choose a model supported by the installed OpenCode provider.')
    // Config is supplied through environment only. PATCH /config writes in the
    // project directory and must never be used to set app-managed defaults.
    const info = o.native ? await client.request(`/session/${o.native}`) : await client.request('/session', 'POST', { title: 'Agent conversation' })
    const native = info.id as string
    void client.events(controller.signal, o.event)
    return {
      pid: child.pid, native, model, client,
      // Attach needs only loopback auth. No provider key goes to the TUI.
      terminal: { executable: o.install.executable, args: ['attach', client.url, '--dir', o.cwd, '--session', native], env },
      snapshot: async () => ({ info: await client.request(`/session/${native}`), messages: await client.request(`/session/${native}/message`) }),
      async send(text) { await client.request(`/session/${native}/prompt_async`, 'POST', { model: { providerID: o.credential.provider, modelID: model }, system: o.brief, parts: [{ type: 'text', text }] }) },
      async abort() { await client.request(`/session/${native}/abort`, 'POST') },
      close,
    }
  } catch (error) { await close(); throw error }
}

/** No auth store is read. Interchange is a separate CLI process in the isolated chat home. */
export async function interchange(install: OpenCodeInstall, root: string, cwd: string, args: string[]): Promise<string> {
  const env = isolatedEnvironment(root)
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: 'allow', share: 'disabled', autoupdate: false, enabled_providers: [] })
  const child = spawn(install.executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const timeout = setTimeout(() => child.kill(), 30000)
  timeout.unref()
  let data = ''
  child.stdout.on('data', chunk => { data += chunk; if (data.length > 64 * 1024 * 1024) child.kill() })
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timeout))
  if (code !== 0 || data.length > 64 * 1024 * 1024) throw new Error('OpenCode interchange failed.')
  return data
}
export function readInterchange(file: string): unknown { return JSON.parse(readFileSync(file, 'utf8')) }
