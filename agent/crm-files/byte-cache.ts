import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { writeAtomic } from '../config.ts'

// o4fb7 (Shubham, 14 Nov 2026: "the mounted drive doesn't load fast: optimize that"): the CRM files' bytes kept on this PC's disk, so a file opened again comes
// at disk speed (a cache, not a synced copy: it holds only what was opened, under a size limit, and drops what was used least recently).
// Each file is kept whole, under its CRM version (a new version is a new entry; the old one ages out). A file is downloaded ONCE however many readers ask at
// once (the in-app drive asks for a file in many ranges: through the CRM's own download each range used to fetch the whole file again), and every reader gets its
// bytes as soon as they have arrived. Nothing here knows about the CRM: the service gives the bytes (`fill`) and asks for ranges (`read`) or the whole (`stream`).

export interface CachedFile {
  path: string
  size: number
}

/** A download into the cache, while it lasts. */
export interface Filling {
  /** Resolves once the bytes have started to come (the source answered and its first bytes were looked at), or rejects with the source's error. */
  started: Promise<void>
  /** The whole file once kept (rejects if the download failed: the reader then asks the source itself). */
  done: Promise<CachedFile>
  written(): number
  /** The file's size when the source said it (or once it ended). */
  size(): number | null
}

export interface ByteCacheOptions {
  dir: string
  /** All the kept files together stay under this (bytes); read each time, so a setting change applies at once. */
  maxBytes: () => number
  /** A file bigger than this is never kept (bytes; default 1 GiB). */
  maxFileBytes?: number
  now?: () => number
  log?: { info(m: string): void; warn(m: string): void }
}

export interface ByteCache {
  /** The kept whole file of `key`, or null (marks it used). */
  get(key: string): CachedFile | null
  /** Starts the download of `key` into the cache, or joins the one already going. `source` gives the bytes in order and, when known, the size. */
  fill(key: string, source: () => Promise<{ chunks: AsyncIterable<Buffer> | Iterable<Buffer>; size: number | null }>): Filling
  /** o048b: the download of `key` going on now, or null; nothing is started. */
  going(key: string): Filling | null
  /** Bytes [start, start + length) of `key`: from the kept file, or from its download as soon as they are there. Null: neither (or the download failed). */
  read(key: string, start: number, length: number): Promise<Buffer | null>
  /** The whole of `key` as a stream: from the kept file, or following its download. Null: neither. */
  stream(key: string): Readable | null
  status(): { files: number; bytes: number; maxBytes: number }
  /** The agent stops (or a test ends): what is kept is written to its index now, and nothing is written after (a save left for later used to make the folder again). */
  close(): void
}

interface Entry {
  key: string
  file: string
  size: number
  used: number
}

interface Live {
  key: string
  part: string
  written: number
  size: number | null
  ended: boolean
  error: unknown
  waiters: Set<() => void>
  filling: Filling
  readers: number
}

const INDEX = 'index.json'
const hashOf = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 40)

export function createByteCache(o: ByteCacheOptions): ByteCache {
  const now = o.now ?? Date.now
  const maxFile = o.maxFileBytes ?? 1024 * 1024 * 1024
  const entries = new Map<string, Entry>()
  const live = new Map<string, Live>()
  const reading = new Map<string, number>()
  mkdirSync(o.dir, { recursive: true })

  // What was kept before: the index names each file; a file it does not name, and a download cut short, are dropped.
  try {
    const j = JSON.parse(readFileSync(path.join(o.dir, INDEX), 'utf8')) as { entries?: Entry[] }
    for (const e of j.entries ?? []) if (e && typeof e.key === 'string' && typeof e.file === 'string' && existsSync(path.join(o.dir, e.file))) entries.set(e.key, e)
  } catch {
    // none yet
  }
  const named = new Set([...entries.values()].map(e => e.file))
  for (const f of readdirSync(o.dir)) if (f !== INDEX && !named.has(f)) rmSync(path.join(o.dir, f), { force: true })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const writeIndex = () => {
    try {
      writeAtomic(path.join(o.dir, INDEX), JSON.stringify({ entries: [...entries.values()] }))
    } catch (e) {
      o.log?.warn(`crm cache: its index could not be kept (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  const save = () => {
    if (saveTimer || closed) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      writeIndex()
    }, 2_000)
    saveTimer.unref?.()
  }
  const total = () => [...entries.values()].reduce((n, e) => n + e.size, 0)

  /** Least recently used first, never one being read, until the kept files fit. */
  function evict() {
    const max = Math.max(0, o.maxBytes())
    let sum = total()
    if (sum <= max) return
    for (const e of [...entries.values()].sort((a, b) => a.used - b.used)) {
      if (sum <= max) break
      if ((reading.get(e.key) ?? 0) > 0) continue
      entries.delete(e.key)
      rmSync(path.join(o.dir, e.file), { force: true })
      sum -= e.size
    }
    save()
  }

  const wake = (l: Live) => {
    for (const w of [...l.waiters]) w()
  }
  /** Until at least `end` bytes are written, or the download ended. */
  const waitFor = (l: Live, end: number) =>
    new Promise<void>(resolve => {
      if (l.ended || l.written >= end) return resolve()
      const w = () => {
        if (l.ended || l.written >= end) {
          l.waiters.delete(w)
          resolve()
        }
      }
      l.waiters.add(w)
    })

  async function readAt(file: string, start: number, length: number): Promise<Buffer> {
    const fh = await open(file, 'r')
    try {
      const out = Buffer.alloc(length)
      let got = 0
      while (got < length) {
        const { bytesRead } = await fh.read(out, got, length - got, start + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      return out.subarray(0, got)
    } finally {
      await fh.close()
    }
  }

  /** A range of a file still downloading; if it has just been kept (its part file renamed), from the kept file. */
  async function readLive(l: Live, start: number, length: number, kept: () => CachedFile | null): Promise<Buffer> {
    try {
      return await readAt(l.part, start, length)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      const k = kept()
      if (!k) throw e
      return readAt(k.path, start, length)
    }
  }

  /** The kept whole file of a key, or null (marks it used). */
  function keptFile(key: string): CachedFile | null {
    const e = entries.get(key)
    if (!e) return null
    e.used = now()
    save()
    return { path: path.join(o.dir, e.file), size: e.size }
  }

  const using = (key: string, d: number) => {
    const n = (reading.get(key) ?? 0) + d
    if (n > 0) reading.set(key, n)
    else reading.delete(key)
  }

  return {
    get: keptFile,

    fill(key, source) {
      const going = live.get(key)
      if (going) return going.filling
      const file = hashOf(key)
      const l: Live = { key, part: path.join(o.dir, `${file}.part`), written: 0, size: null, ended: false, error: null, waiters: new Set(), filling: null as unknown as Filling, readers: 0 }
      let startedOk!: () => void
      let startedFail!: (e: unknown) => void
      const started = new Promise<void>((res, rej) => {
        startedOk = res
        startedFail = rej
      })
      const done = (async (): Promise<CachedFile> => {
        let fh: FileHandle | null = null
        try {
          const src = await source()
          l.size = src.size
          if (src.size !== null && src.size > maxFile) throw Object.assign(new Error('too big to keep'), { tooBig: true })
          fh = await open(l.part, 'w')
          let first = true
          for await (const chunk of src.chunks) {
            if (first) {
              first = false
              startedOk()
            }
            if (l.written + chunk.length > maxFile) throw Object.assign(new Error('too big to keep'), { tooBig: true })
            await fh.write(chunk, 0, chunk.length, l.written)
            l.written += chunk.length
            wake(l)
          }
          if (first) startedOk()
          await fh.close()
          fh = null
          if (l.size !== null && l.written < l.size) throw new Error(`the download stopped short (${l.written} of ${l.size} bytes)`)
          l.size = l.written
          const finalName = `${file}.bin`
          // Windows will not rename a file a reader has open this very moment: a few short tries.
          for (let tries = 0; ; tries++) {
            try {
              await rename(l.part, path.join(o.dir, finalName))
              break
            } catch (e) {
              const code = (e as NodeJS.ErrnoException).code
              if (tries >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
              await new Promise(r => setTimeout(r, 50))
            }
          }
          entries.set(key, { key, file: finalName, size: l.written, used: now() })
          save()
          evict()
          return { path: path.join(o.dir, finalName), size: l.written }
        } catch (e) {
          l.error = e
          startedFail(e)
          throw e
        } finally {
          if (fh) await fh.close().catch(() => undefined)
          l.ended = true
          wake(l)
          live.delete(key)
          if (l.error) await rm(l.part, { force: true }).catch(() => undefined)
        }
      })()
      done.catch(() => undefined)
      started.catch(() => undefined)
      l.filling = { started, done, written: () => l.written, size: () => l.size }
      live.set(key, l)
      return l.filling
    },

    going: key => live.get(key)?.filling ?? null,

    async read(key, start, length) {
      const kept = keptFile(key)
      if (kept) {
        using(key, 1)
        try {
          return await readAt(kept.path, start, Math.max(0, Math.min(length, kept.size - start)))
        } finally {
          using(key, -1)
        }
      }
      const l = live.get(key)
      if (!l) return null
      using(key, 1)
      try {
        await waitFor(l, start + length)
        if (l.error) return null
        if (l.ended) {
          const k = keptFile(key)
          return k ? await readAt(k.path, start, Math.max(0, Math.min(length, k.size - start))) : null
        }
        return await readLive(l, start, Math.max(0, Math.min(length, l.written - start)), () => keptFile(key))
      } finally {
        using(key, -1)
      }
    },

    stream(key) {
      const kept = keptFile(key)
      const l = kept ? null : (live.get(key) ?? null)
      if (!kept && !l) return null
      using(key, 1)
      return Readable.from(
        (async function* () {
          try {
            if (kept) {
              for (let at = 0; at < kept.size; at += 1024 * 1024) yield await readAt(kept.path, at, Math.min(1024 * 1024, kept.size - at))
              return
            }
            let at = 0
            for (;;) {
              await waitFor(l!, at + 1)
              if (l!.error) throw l!.error
              if (l!.ended) {
                const k = keptFile(key)
                if (!k) throw new Error('the download was not kept')
                for (; at < k.size; at += 1024 * 1024) yield await readAt(k.path, at, Math.min(1024 * 1024, k.size - at))
                return
              }
              const upTo = l!.written
              while (at < upTo) {
                const part = await readLive(l!, at, Math.min(1024 * 1024, upTo - at), () => keptFile(key))
                if (part.length === 0) break
                at += part.length
                yield part
              }
            }
          } finally {
            using(key, -1)
          }
        })(),
        { objectMode: false },
      )
    },

    status: () => ({ files: entries.size, bytes: total(), maxBytes: o.maxBytes() }),

    close() {
      if (closed) return
      closed = true
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
        writeIndex()
      }
    },
  }
}
