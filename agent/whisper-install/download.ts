import { createHash } from 'node:crypto'
import { lstat, open, unlink } from 'node:fs/promises'
import type { ReadableStreamDefaultReader } from 'node:stream/web'
import type { Artifact } from './manifest.ts'

export interface DownloadOptions {
  signal?: AbortSignal
  fetch?: typeof fetch
  progress?: (bytes: number) => void
  /** No data for this long gives it up (default 2 minutes). A slow link that keeps sending is never cut off by it. */
  stallMs?: number
  /** The longest one download may take in all (default 2 hours: the 488 MB model at about 70 kB/s). */
  totalMs?: number
}
const STALL_MS = 2 * 60_000
const TOTAL_MS = 2 * 60 * 60_000

/** Only public artifact origins; never an API token, cookie or other account header. */
export function artifactHost(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const h = url.hostname
  return ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co'].includes(h)
    || h.endsWith('.hf.co') || h.endsWith('.huggingface.co')
}

/** Stream to an exclusive task-owned file. A partial file is never the installed model. */
export async function downloadChecked(a: Artifact, file: string, o: DownloadOptions = {}): Promise<void> {
  if (!Number.isSafeInteger(a.bytes) || a.bytes < 1 || !/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error('Invalid pinned artifact')
  o.signal?.throwIfAborted()
  let url = new URL(a.url), response: Response | null = null
  if (!artifactHost(url)) throw new Error('Unexpected artifact download origin')
  const stallMs = o.stallMs ?? STALL_MS
  const stall = new AbortController()
  let timer: NodeJS.Timeout | undefined
  // Armed before the request and again on every chunk. Not unref'd: it must fire even when nothing else is pending.
  const quiet = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stall.abort(new Error(`The download stalled: no data for ${Math.round(stallMs / 1000)} s`)), stallMs)
  }
  const signal = AbortSignal.any([AbortSignal.timeout(o.totalMs ?? TOTAL_MS), stall.signal, ...(o.signal ? [o.signal] : [])])
  // Every wait races this, so a body that stops sending is given up even when it does not follow the signal.
  const stopped = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  stopped.catch(() => {})
  const hash = createHash('sha256')
  let done = 0
  // Reserve this invocation's file before starting HTTP. An existing destination must
  // not trigger a fetch or leave an unconsumed response/model stream behind.
  const f = await open(file, 'wx', 0o600)
  let identity: { dev: bigint; ino: bigint } | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let ok = false
  const errors: unknown[] = []
  try {
    const owned = await f.stat({ bigint: true })
    if (!owned.isFile()) throw new Error('Owned download is not a regular file')
    identity = { dev: owned.dev, ino: owned.ino }
    quiet()
    for (let redirects = 0; redirects <= 5; redirects++) {
      signal.throwIfAborted()
      if (!artifactHost(url)) throw new Error('Unexpected artifact download origin')
      response = await Promise.race([(o.fetch ?? fetch)(url, { signal, redirect: 'manual', credentials: 'omit' }), stopped])
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      await response.body?.cancel()
      response = null
      if (!location || redirects === 5) throw new Error('Invalid artifact redirect')
      url = new URL(location, url)
    }
    if (!response?.ok || !response.body) throw new Error(`Artifact download failed (${response?.status ?? 'no response'})`)
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) !== a.bytes) throw new Error('Artifact download has an unexpected size')
    reader = response.body.getReader()
    for (;;) {
      signal.throwIfAborted()
      const chunk = await Promise.race([reader.read(), stopped])
      if (chunk.done) break
      signal.throwIfAborted()
      quiet()
      const b = chunk.value
      done += b.length
      if (done > a.bytes) throw new Error('Artifact download exceeds its pinned size')
      hash.update(b)
      let at = 0
      while (at < b.length) {
        const w = await f.write(b, at, b.length - at)
        if (!w.bytesWritten) throw new Error('Artifact file could not be written')
        at += w.bytesWritten
      }
      o.progress?.(done)
    }
    signal.throwIfAborted()
    if (done !== a.bytes || hash.digest('hex') !== a.sha256) throw new Error('Artifact digest or size does not match the pinned dependency')
    await f.sync()
    signal.throwIfAborted()
    ok = true
  } catch (e) {
    errors.push(e)
  } finally {
    clearTimeout(timer)
    // Keep the native operation error AND cleanup failures; neither a rejected
    // response nor a failed close is evidence of a clean successful download.
    try {
      if (reader) {
        try { if (!ok) await reader.cancel() }
        finally { reader.releaseLock() }
      } else await response?.body?.cancel()
    } catch (e) { errors.push(e) }
    try { await f.close() } catch (e) { errors.push(e) }
    if (!ok || errors.length) {
      try {
        const current = await lstat(file, { bigint: true })
        if (!identity || !current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) errors.push(new Error('Owned download identity changed; refusing cleanup'))
        else await unlink(file)
      } catch (e) { errors.push(e) }
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, 'Artifact download or owned cleanup failed')
}
