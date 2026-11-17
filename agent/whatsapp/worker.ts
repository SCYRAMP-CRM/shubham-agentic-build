import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { clean, message, WaEngine, type WaClient } from './engine.ts'
import { CHROME_ARGS, DEVICE_NAME, LOGIN_ID, type WorkerEvent, type WorkerReply, type WorkerRequest } from './protocol.ts'

// F-079: the WhatsApp process. The hub starts it (host.ts) when WhatsApp is used and ends it when it has been
// idle; it runs whatsapp-web.js through engine.ts, on the PC's own Chrome, and talks to the hub over Node's IPC
// channel only: no port, no file of its own. It never prints a message, a number or the QR; what it does say goes
// to stderr as short, cleaned lines. Nothing imports this file: it starts itself. Settings come in its environment:
//   SAD_WA_LIB     the folder whose node_modules hold whatsapp-web.js and qrcode (setup.ts puts them there)
//   SAD_WA_AUTH    where the login is kept (LocalAuth's dataPath; the profile is <it>\session-main)
//   SAD_WA_CHROME  chrome.exe
//   SAD_WA_SHOW    1: Chrome's window is shown (to look into a problem); otherwise headless
//   SAD_WA_FAKE    tests only: a module whose createClient() stands in for whatsapp-web.js

const say = (line: string) => process.stderr.write(`${clean(line)}\n`)
const send = (m: WorkerReply | WorkerEvent) => {
  if (process.connected) process.send?.(m)
}

interface Wweb {
  Client: new (o: unknown) => WaClient
  LocalAuth: new (o: unknown) => unknown
}
interface QrCode {
  toDataURL(text: string, o?: unknown): Promise<string>
}

// Order o55b6: where Chrome goes out, told by the hub with each start (never in the environment, so nothing else in this process or any other
// picks it up): null, directly; else the SOCKS5 address of the tunnel the hub has just checked (agent/whatsapp/tunnel.ts). Every launch and
// relaunch of that start uses it. There is no fallback: with the tunnel gone, Chrome fails to load, and that failure is what is shown.
let proxy: string | null = null
const PROXY = /^socks5:\/\/127\.0\.0\.1:\d{5}$/
const chromeArgs = () => (proxy ? [...CHROME_ARGS, `--proxy-server=${proxy}`] : [...CHROME_ARGS])

async function makeEngine(): Promise<WaEngine> {
  const env = process.env
  const auth = env.SAD_WA_AUTH
  if (!auth) throw new Error('SAD_WA_AUTH is not set')
  const profileDir = path.join(auth, `session-${LOGIN_ID}`)
  if (env.SAD_WA_FAKE) {
    const fake = (await import(pathToFileURL(env.SAD_WA_FAKE).href)) as { createClient(o?: { puppeteer: { args: string[] } }): WaClient }
    return new WaEngine({ createClient: () => fake.createClient({ puppeteer: { args: chromeArgs() } }), qrImage: async t => `data:image/png;base64,${Buffer.from(t).toString('base64')}`, profileDir, log: say, pollMs: 20, pollTries: 5, retryMs: 10, chatsWaitMs: 50 })
  }
  const lib = env.SAD_WA_LIB
  const chrome = env.SAD_WA_CHROME
  if (!lib) throw new Error('SAD_WA_LIB is not set')
  if (!chrome) throw new Error('SAD_WA_CHROME is not set')
  const need = createRequire(path.join(lib, 'package.json'))
  const wweb = need('whatsapp-web.js') as Wweb
  const qrcode = need('qrcode') as QrCode
  return new WaEngine({
    createClient: () =>
      new wweb.Client({
        authStrategy: new wweb.LocalAuth({ clientId: LOGIN_ID, dataPath: auth }),
        puppeteer: { headless: env.SAD_WA_SHOW !== '1', executablePath: chrome, args: chromeArgs() },
        // Never pinned, nothing cached on disk: always the build WhatsApp serves now (it unlinks old ones).
        webVersionCache: { type: 'none' },
        deviceName: DEVICE_NAME,
        browserName: 'Chrome',
      }),
    qrImage: text => qrcode.toDataURL(text, { margin: 1, width: 320 }),
    profileDir,
    log: say,
  })
}

// Listening from the first moment: what the hub asks while whatsapp-web.js is still loading waits here.
const early: WorkerRequest[] = []
let handle: ((r: WorkerRequest) => void) | null = null
let leaveNow: (() => void) | null = null
process.on('message', raw => {
  const r = raw as WorkerRequest
  if (!r || typeof r.id !== 'number' || typeof r.op !== 'string') return
  if (handle) handle(r)
  else early.push(r)
})
// The app went away (it stopped, or it crashed): close Chrome properly, then end.
process.on('disconnect', () => (leaveNow ? leaveNow() : process.exit(0)))

async function main() {
  const engine = await makeEngine()
  let chrome: number | null = null
  const noteChrome = () => {
    const pid = engine.chromePid()
    if (pid === chrome) return
    chrome = pid
    send({ t: 'chrome', pid })
  }
  engine.on('status', status => {
    noteChrome()
    send({ t: 'status', status })
  })
  engine.on('message', m => send({ t: 'message', message: m }))
  engine.on('ack', a => send({ t: 'ack', ...a }))

  let leaving = false
  const leave = async (code: number) => {
    if (leaving) return
    leaving = true
    // Chrome must close by itself (destroy) so its login is written out: 20 s at most, then go anyway.
    await Promise.race([engine.stop(), new Promise(r => setTimeout(r, 20_000).unref())])
    process.exit(code)
  }

  const answer = async (r: WorkerRequest): Promise<unknown> => {
    const a = r.args ?? {}
    const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
    switch (r.op) {
      case 'start': {
        const p = a.proxy === undefined || a.proxy === null ? null : typeof a.proxy === 'string' && PROXY.test(a.proxy) ? a.proxy : undefined
        if (p === undefined) throw new Error('that is not a way out this worker takes')
        proxy = p
        engine.start()
        return engine.status()
      }
      case 'status':
        return engine.status()
      case 'chats':
        return engine.chats()
      case 'messages':
        return engine.messages(s('chatId'), typeof a.count === 'number' ? a.count : 30, s('before') || undefined)
      case 'send':
        return engine.send(s('chatId'), s('text'))
      // Order oWA S4: the people behind the chats.
      case 'contact':
        return engine.contact(s('chatId'))
      case 'profilePic':
        return { url: await engine.profilePic(s('chatId')) }
      case 'seen':
        await engine.seen(s('chatId'))
        return { ok: true }
      case 'archive':
        await engine.archive(s('chatId'), a.on === true)
        return { ok: true }
      case 'pin':
        await engine.pin(s('chatId'), a.on === true)
        return { ok: true }
      case 'newChat':
        return engine.newChat(s('number'))
      // Order oWA S3: a message's file (the bytes as base64, to the hub, which hands them on as bytes).
      case 'media':
        return engine.media(s('chatId'), s('messageId'))
      case 'pairCode':
        return { code: await engine.pairCode(s('phone')) }
      case 'logout':
        return { told: await engine.logout() }
      case 'quit':
        await engine.stop()
        noteChrome()
        return engine.status()
      default:
        throw Object.assign(new Error(`unknown op ${String(r.op)}`), { status: 400 })
    }
  }

  handle = r =>
    void answer(r).then(
      result => {
        send({ id: r.id, ok: true, result })
        if (r.op === 'quit') void leave(0)
      },
      (e: unknown) => {
        const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined
        const code = typeof (e as { code?: unknown })?.code === 'string' && status ? (e as { code: string }).code : undefined
        // Our own errors are plain words; a library's could hold an id or a number.
        send({ id: r.id, ok: false, error: status ? message(e) : clean(message(e)), ...(status ? { status } : {}), ...(code ? { code } : {}) })
      },
    )
  leaveNow = () => void leave(0)
  if (!process.connected) return leaveNow()
  // The first status says "listening"; then what came early.
  send({ t: 'status', status: engine.status() })
  for (const r of early.splice(0)) handle(r)
}

process.on('unhandledRejection', e => say(`unhandled: ${message(e)}`))
main().catch(e => {
  say(`could not start: ${message(e)}`)
  process.exit(1)
})
