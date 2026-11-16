import { inflateRawSync } from 'node:zlib'
import type { ProgramArtifact } from './manifest.ts'

// The program's ZIP, read as data only: no archive program is run, and no file, folder or link is made here (install.ts
// writes the checked bytes). Only one flat folder of plain files is accepted: no traversal, nested folder, absolute or
// drive path, link, reparse point, encryption, ZIP64 or split archive, and nothing past the limits below.
const MAX_BYTES = 128 * 1024 * 1024
const MAX_FILE = 64 * 1024 * 1024
const MAX_FILES = 128
const fail = (): never => { throw new Error('Unexpected or unsafe Whisper archive') }

export function unpackProgram(data: Buffer, spec: Pick<ProgramArtifact, 'prefix' | 'server'>): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const names = new Set<string>()
  let total = 0
  function name(raw: string, directory: boolean): string | null {
    if (directory && raw === `${spec.prefix}/`) return null
    if (!raw.startsWith(`${spec.prefix}/`)) return fail()
    const leaf = raw.slice(spec.prefix.length + 1)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(leaf) || leaf.includes('..')) return fail()
    if (names.has(leaf.toLowerCase()) || names.size >= MAX_FILES) return fail()
    names.add(leaf.toLowerCase())
    return leaf
  }
  function add(leaf: string, b: Buffer) {
    total += b.length
    if (b.length > MAX_FILE || total > MAX_BYTES) return fail()
    files.set(leaf, b)
  }

  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_558); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break }
  }
  if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) return fail()
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12)
  let pos = data.readUInt32LE(end + 16)
  const start = pos
  if (count < 1 || count > MAX_FILES || data.readUInt16LE(end + 8) !== count || pos + size !== end) return fail()
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || data.readUInt32LE(pos) !== 0x02014b50) return fail()
    const flags = data.readUInt16LE(pos + 8), method = data.readUInt16LE(pos + 10)
    const packed = data.readUInt32LE(pos + 20), plain = data.readUInt32LE(pos + 24)
    const n = data.readUInt16LE(pos + 28), extra = data.readUInt16LE(pos + 30), comment = data.readUInt16LE(pos + 32)
    const attr = data.readUInt32LE(pos + 38), offset = data.readUInt32LE(pos + 42)
    if (pos + 46 + n + extra + comment > end || flags & 1 || ![0, 8].includes(method) || packed > data.length || plain > MAX_FILE) return fail()
    // A Unix symbolic link in the high bits, or a Windows reparse point (0x400): never.
    if (((attr >>> 16) & 0o170000) === 0o120000 || (attr & 0x400) !== 0) return fail()
    const raw = data.toString('utf8', pos + 46, pos + 46 + n)
    const leaf = name(raw, raw.endsWith('/'))
    if (offset + 30 > start || data.readUInt32LE(offset) !== 0x04034b50) return fail()
    const ln = data.readUInt16LE(offset + 26), le = data.readUInt16LE(offset + 28)
    const at = offset + 30 + ln + le
    if (data.toString('utf8', offset + 30, offset + 30 + ln) !== raw || at + packed > start || data.readUInt16LE(offset + 8) !== method) return fail()
    if (leaf) {
      const buf = data.subarray(at, at + packed)
      const out = method === 0 ? Buffer.from(buf) : inflateRawSync(buf, { maxOutputLength: MAX_FILE })
      if (out.length !== plain) return fail()
      add(leaf, out)
    } else if (plain || packed) return fail()
    pos += 46 + n + extra + comment
  }
  if (pos !== end) return fail()
  if (!files.get(spec.server)?.length) return fail()
  return files
}
