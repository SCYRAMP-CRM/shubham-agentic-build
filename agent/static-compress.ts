import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { brotliCompress, constants, gzip } from 'node:zlib'

// F-310 (his order oa0fe: the card on his phone opens slowly): the built page's text files are sent as they are on disk, 3.3 MB for the card's start. This is the part of agent/ui-server.ts that sends the
// static text (JS, CSS, HTML, SVG, JSON) compressed, and nothing else of it: the API, the sockets, the guard's routes, the images and fonts are not here. Rules, each pinned by agent/static-compress.test.ts and agent/ui-server.test.ts:
//   - never per request: a file is compressed once per (path, modified time, size) and the result is kept in memory: ONLY THE NEWEST VERSION of a path (a publish replaces the build, and the copies of the one before are of no use to anyone: they are dropped the moment the next version of the same path is looked at) and under a cap (DEFAULT_MAX_HELD, oldest out); concurrent first requests share one compression; it runs in zlib's own threads, never on the server's main thread
//   - the client's Accept-Encoding decides, q-values included (`br;q=0` is no), br before gzip on a tie; no header, `identity`, or nothing acceptable is the file as it is
//   - only the types below, and only from MIN_BYTES: an image or a font is already compressed, a few bytes gain nothing
//   - the validators are the representation's: the strong ETag of the file's content for the plain file, the same with -br or -gzip for each compressed one (they are different bytes), and If-None-Match is answered 304

export type Encoding = 'br' | 'gzip'

/** Text that compresses well. Everything else (images, fonts, wasm, the unknown) is sent as it is. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt'])
/** Under this a file is not worth the work (and the 304 and the Vary are all it gets). */
export const MIN_BYTES = 1024
/** Over this a file is left alone: compressing it on the first request would hold a thread for seconds. */
export const MAX_BYTES = 16 * 1024 * 1024
/** What the Server holds of compressed copies at most: the card's start is about 1 MB, a whole build about 5 MB; the Server's memory is the scarce thing (his M1), so the cap is small. */
export const DEFAULT_MAX_HELD = 24 * 1024 * 1024

export const isCompressible = (ext: string): boolean => COMPRESSIBLE.has(ext.toLowerCase())

/** What Accept-Encoding allows: the best of br and gzip by q (br wins a tie), or null (identity). `*` stands for what is not named; q=0 is no. */
export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  const raw = Array.isArray(header) ? header.join(',') : header
  if (!raw) return null
  const q: Record<string, number> = {}
  for (const part of raw.split(',')) {
    const [nameRaw, ...params] = part.trim().split(';')
    const name = nameRaw.trim().toLowerCase()
    if (!name) continue
    let value = 1
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)
      if (m) value = Math.min(1, Math.max(0, Number.parseFloat(m[1]) || 0))
    }
    q[name === 'x-gzip' ? 'gzip' : name] = value
  }
  const star = q['*']
  const of = (n: string) => q[n] ?? star ?? 0
  const br = of('br')
  const gz = of('gzip')
  if (br <= 0 && gz <= 0) return null
  return br >= gz ? 'br' : 'gzip'
}

/** Whether an If-None-Match header holds this ETag (weak comparison, a list, or `*`). */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : header
  if (!raw) return false
  if (raw.trim() === '*') return true
  const strip = (s: string) => s.trim().replace(/^W\//, '')
  return raw.split(',').some(one => strip(one) === strip(etag))
}

interface Entry {
  tag?: Promise<string>
  br?: Promise<Buffer>
  gzip?: Promise<Buffer>
}

export interface CompressStats {
  /** How many compressions were started (not requests: one per file and encoding while it is kept). */
  compressions: number
  /** Bytes of compressed files held now. */
  held: number
}

const compress = (body: Buffer, enc: Encoding): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const done = (e: Error | null, out: Buffer) => (e ? reject(e) : resolve(out))
    if (enc === 'br') {
      brotliCompress(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, done)
    } else {
      gzip(body, { level: 6 }, done)
    }
  })

/** The kept compressed files and the content tags of the static text files of one app folder. */
export class StaticCache {
  readonly stats: CompressStats = { compressions: 0, held: 0 }
  private readonly entries = new Map<string, Entry>()
  /** The newest version looked at of each path: its key and its modified time. */
  private readonly latest = new Map<string, { key: string; mtimeMs: number }>()
  private readonly sizes = new Map<Promise<Buffer>, number>()

  private readonly maxHeld: number

  constructor(maxHeld = DEFAULT_MAX_HELD) {
    this.maxHeld = maxHeld
  }

  /** The most it holds of compressed copies. */
  get capBytes(): number {
    return this.maxHeld
  }

  /** How many versions are held (compressed copies or tags): one per path at most. */
  get entryCount(): number {
    return this.entries.size
  }

  private keyOf(file: string, st: { mtimeMs: number; size: number }): string {
    return `${file}|${st.mtimeMs}|${st.size}`
  }

  /** One version of a path is kept: looking at a NEWER one drops the old (its copies and its tag); a stale look at an OLDER one is served from an entry of its own that is not kept. */
  private entry(file: string, st: { mtimeMs: number; size: number }): Entry {
    const key = this.keyOf(file, st)
    const cur = this.latest.get(file)
    if (cur && cur.key !== key) {
      if (st.mtimeMs < cur.mtimeMs) return {}
      this.drop(cur.key)
    }
    this.latest.set(file, { key, mtimeMs: st.mtimeMs })
    let e = this.entries.get(key)
    if (!e) {
      e = {}
      this.entries.set(key, e)
    }
    return e
  }

  /** A version out: its held bytes are given back, and a compression still on its way for it is not counted when it ends (see `encoded`). */
  private drop(key: string) {
    const e = this.entries.get(key)
    if (!e) return
    for (const enc of ['br', 'gzip'] as const) {
      const p = e[enc]
      const n = p ? this.sizes.get(p) : undefined
      if (p && n !== undefined) {
        this.stats.held -= n
        this.sizes.delete(p)
      }
    }
    this.entries.delete(key)
  }

  /** The file's content tag (a hash of its bytes: the plain file's ETag), read once per version of the file. */
  tag(file: string, st: { mtimeMs: number; size: number }): Promise<string> {
    const e = this.entry(file, st)
    e.tag ??= readFile(file).then(
      b => createHash('sha256').update(b).digest('hex').slice(0, 32),
      err => {
        e.tag = undefined
        throw err
      },
    )
    return e.tag
  }

  /** The file compressed, once per version of the file and encoding. */
  encoded(file: string, st: { mtimeMs: number; size: number }, enc: Encoding): Promise<Buffer> {
    const e = this.entry(file, st)
    const key = this.keyOf(file, st)
    const kept = e[enc]
    if (kept) return kept
    this.stats.compressions++
    const p: Promise<Buffer> = readFile(file)
      .then(b => compress(b, enc))
      .then(out => {
        // Only a version that is still the kept one is held: a newer one may have replaced it while this was on its way (its requester still gets what it asked for).
        if (this.entries.get(key) === e) {
          this.stats.held += out.length
          this.sizes.set(p, out.length)
          this.trim()
        }
        return out
      })
    p.catch(() => {
      // A failed compression is tried again by the next request (the caller sends the plain file this time).
      if (e[enc] === p) e[enc] = undefined
    })
    e[enc] = p
    return p
  }

  /** Oldest files out while more than the cap is held. */
  private trim() {
    for (const [key, e] of this.entries) {
      if (this.stats.held <= this.maxHeld) return
      for (const enc of ['br', 'gzip'] as const) {
        const p = e[enc]
        const n = p ? this.sizes.get(p) : undefined
        if (p && n !== undefined) {
          this.stats.held -= n
          this.sizes.delete(p)
          e[enc] = undefined
        }
      }
      if (!e.br && !e.gzip) this.entries.delete(key)
    }
  }
}
