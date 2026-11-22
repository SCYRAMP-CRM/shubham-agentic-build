import { readFile, stat } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { AGENT_API_PREFIX } from '../shared/agent-api.ts'
import { AUTH_PAGE_HEADER } from '../shared/auth.ts'
import { applyVia } from './auth/via.ts'
import { fromApp, hostAllowed } from './local-host.ts'
import type { Logger } from './log.ts'
import { etagMatches, isCompressible, MAX_BYTES, MIN_BYTES, pickEncoding, StaticCache, type Encoding } from './static-compress.ts'

// F-020: the app as a build has no Vite dev server, so the agent serves the built page itself
// (`--app <dir>`, the build's `app/` folder) on the page port, 5173 as Vite used, so the phone's
// address through the remote gate stays the same. It does the dev server's two jobs:
//   the page   its files, index.html for any other path (the router's), the hashed assets
//              cached for good and everything else not at all
//   the API    /agent-api, HTTP and WebSocket, forwarded to this agent's own API on 127.0.0.1,
//              with the API token added only for the app's own pages (local-host.ts fromApp,
//              Vite's own rule), so the API stays guarded exactly as in dev
// As Vite does, it answers only a Host that is an IP, localhost or *.localhost (a page that
// rebound its own name to this PC is refused), and it listens on this PC's loopbacks only.

export interface UiServerOptions {
  /** The page port (0 picks one, for tests). */
  port: number
  host?: string
  /** The built page: index.html and assets/. */
  appDir: string
  /** The agent's API port, read per request (it may be the configured one or a picked one). */
  apiPort: () => number
  /** The API token: added for the app's own pages, never handed to anything else. */
  token: string
  log?: Logger
  /** F-028: who may connect (by remote address); anyone reaching the listener when left out (loopback). */
  allowRemote?: (address: string) => boolean
  /**
   * F-058: the guard's own routes (/guard/status), tried after the host check and before the page
   * and the API. Resolves true when it answered; false lets the request go on. Never for /agent-api.
   */
  handle?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>
}

export interface UiServer {
  port: number
  /** F-310: how many compressions the static text has cost since start (one per file and encoding: never per request). */
  compressions(): number
  close(): Promise<void>
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
}

const BLOCKED = 'Blocked request. This host is not allowed.'

function plain(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

/** The headers to forward: Host is the agent's (as Vite's changeOrigin), the token is ours to add or not, and F-118's x-sad-via is only ever set here (auth/via.ts). */
function forwardHeaders(req: IncomingMessage, apiPort: number, token: string | null) {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${apiPort}` }
  delete headers['x-sad-token']
  if (token) headers['x-sad-token'] = token
  applyVia(headers, req.headers, req.socket.remoteAddress)
  // F-118: everything this server forwards came from a page: said here, once, so no browser (old ones send no fetch metadata) can look like the PC itself.
  headers[AUTH_PAGE_HEADER] = '1'
  return headers
}

export async function startUiServer(o: UiServerOptions): Promise<UiServer> {
  const root = path.resolve(o.appDir)
  const log = o.log
  const sockets = new Set<Duplex>()
  const statics = new StaticCache()

  /** A file under the app folder for this URL path, or null (never outside it). */
  async function fileFor(urlPath: string): Promise<string | null> {
    let rel: string
    try {
      rel = decodeURIComponent(urlPath)
    } catch {
      return null
    }
    const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`)
    if (file !== root && !file.startsWith(root + path.sep)) return null
    try {
      return (await stat(file)).isFile() ? file : null
    } catch {
      return null
    }
  }

  async function page(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      return res.end()
    }
    let file = await fileFor(url.pathname)
    // Any other path is the router's: the page itself. A missing asset stays a 404.
    if (!file && !path.extname(url.pathname)) file = path.join(root, 'index.html')
    if (!file) return plain(res, 404, 'Not found')
    const ext = path.extname(file).toLowerCase()
    const hashed = file.startsWith(path.join(root, 'assets') + path.sep)
    const type = TYPES[ext] ?? 'application/octet-stream'
    // Built assets carry a hash in their name; the page and the rest must be asked for again.
    const cache = hashed ? 'public, max-age=31536000, immutable' : 'no-cache'
    if (isCompressible(ext)) return text(req, res, file, type, cache)
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return plain(res, 404, 'Not found')
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /**
   * F-310: the static text (JS, CSS, HTML, SVG, JSON): sent compressed when the client accepts it (shared/the cache in static-compress.ts: once per file, never per request), with the validators of the
   * representation it is (an ETag per encoding, 304 for If-None-Match) and Vary: Accept-Encoding. A Range request, a file under MIN_BYTES or over MAX_BYTES, and a client that accepts nothing get the file as it is.
   */
  async function text(req: IncomingMessage, res: ServerResponse, file: string, type: string, cache: string) {
    let st: Awaited<ReturnType<typeof stat>>
    let tag: string
    try {
      st = await stat(file)
      tag = await statics.tag(file, st)
    } catch {
      return plain(res, 404, 'Not found')
    }
    const wanted = req.headers.range || st.size < MIN_BYTES || st.size > MAX_BYTES ? null : pickEncoding(req.headers['accept-encoding'])
    const headers: http.OutgoingHttpHeaders = { 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept-Encoding' }
    const planned = `"${tag}${wanted ? `-${wanted}` : ''}"`
    if (etagMatches(req.headers['if-none-match'], planned)) {
      res.writeHead(304, { ...headers, ETag: planned })
      return res.end()
    }
    let body: Buffer | null = null
    let used: Encoding | null = null
    if (wanted) {
      try {
        body = await statics.encoded(file, st, wanted)
        used = wanted
      } catch {
        body = null
      }
    }
    if (!body) {
      try {
        body = await readFile(file)
      } catch {
        return plain(res, 404, 'Not found')
      }
    }
    headers.ETag = `"${tag}${used ? `-${used}` : ''}"`
    headers['Content-Length'] = body.length
    if (used) headers['Content-Encoding'] = used
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  function api(req: IncomingMessage, res: ServerResponse) {
    const port = o.apiPort()
    const upstream = http.request(
      { host: '127.0.0.1', port, method: req.method, path: req.url, headers: forwardHeaders(req, port, fromApp(req.headers) ? o.token : null) },
      up => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    // The agent's API not answering: the API's own error shape, as Vite's proxy gives it.
    upstream.on('error', () => {
      if (res.headersSent || res.destroyed) return void res.destroy()
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: `Nothing answers on 127.0.0.1:${port}` }))
    })
    // F-221: the page went away before its answer (a fetch it aborted, a tab it closed): the agent's request goes too, as Vite's proxy does
    // in Dev, so the agent can drop work still queued for it (Whisper's queue: agent/speech/routes.ts).
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  }

  function onRequest(req: IncomingMessage, res: ServerResponse) {
    if (o.allowRemote && !o.allowRemote(req.socket.remoteAddress ?? '')) return plain(res, 403, 'Not from this PC or its tailnet')
    if (!hostAllowed(req.headers.host)) return plain(res, 403, BLOCKED)
    const url = new URL(req.url ?? '/', 'http://app')
    const isApi = url.pathname === AGENT_API_PREFIX || url.pathname.startsWith(`${AGENT_API_PREFIX}/`)
    const fail = (e: unknown) => {
      log?.error(`page ${url.pathname}: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) plain(res, 500, 'Internal error')
      else res.destroy()
    }
    const route = () => {
      if (isApi) return api(req, res)
      page(req, res, url).catch(fail)
    }
    if (!o.handle || isApi) return route()
    Promise.resolve(o.handle(req, res, url)).then(answered => {
      if (!answered) route()
    }, fail)
  }

  // A WebSocket for /agent-api (the state, a screen's pipe, the keys, the agents' terminals): the
  // handshake goes on to the agent with the token added for the app's own pages, then bytes both
  // ways as they come, whatever their size; either side closing closes the other.
  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (o.allowRemote && !o.allowRemote(req.socket.remoteAddress ?? '')) return void socket.destroy()
    socket.on('error', () => {})
    const url = new URL(req.url ?? '/', 'http://app')
    if (!hostAllowed(req.headers.host) || !url.pathname.startsWith(`${AGENT_API_PREFIX}/`)) {
      return socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Length: ${BLOCKED.length}\r\nConnection: close\r\n\r\n${BLOCKED}`)
    }
    const port = o.apiPort()
    const upstream = net.connect(port, '127.0.0.1')
    sockets.add(socket)
    sockets.add(upstream)
    const done = () => {
      sockets.delete(socket)
      sockets.delete(upstream)
      socket.destroy()
      upstream.destroy()
    }
    upstream.on('error', () => {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      done()
    })
    upstream.once('connect', () => {
      const headers = forwardHeaders(req, port, fromApp(req.headers) ? o.token : null)
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`)
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    socket.on('close', done)
    upstream.on('close', done)
  }

  const make = () => http.createServer(onRequest).on('upgrade', onUpgrade)
  const listen = (server: http.Server, port: number, host: string) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        server.on('error', e => log?.error(e.message))
        resolve((server.address() as net.AddressInfo).port)
      })
    })

  // localhost as Vite has it, on both loopbacks: whatever reaches localhost:5173 (a browser here,
  // the remote gate for the phone) may come over either. Never on the network.
  const hosts = o.host ? [o.host] : ['127.0.0.1', '::1']
  const servers = [make()]
  const port = await listen(servers[0], o.port, hosts[0])
  for (const host of hosts.slice(1)) {
    const extra = make()
    try {
      await listen(extra, port, host)
      servers.push(extra)
    } catch (e) {
      // No IPv6 here, most often: 127.0.0.1 alone serves it.
      log?.warn(`the page isn't on ${host} too: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  log?.info(`the app's page: http://localhost:${port} (from ${root})`)
  return {
    port,
    compressions: () => statics.stats.compressions,
    close: async () => {
      for (const s of sockets) s.destroy()
      sockets.clear()
      await Promise.all(
        servers.map(
          s =>
            new Promise<void>(r => {
              s.close(() => r())
              s.closeAllConnections()
            }),
        ),
      )
    },
  }
}
