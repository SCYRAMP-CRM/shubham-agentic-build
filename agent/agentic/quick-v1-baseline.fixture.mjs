import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAst } from 'rolldown/parseAst'

// Published build 2026.11.18-1035, not a copy of today's changed implementation.
export const V1_BASELINE = '434628eb0f3f6553bb3479f35d7350505597e2a4'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let root
let fixture
after(() => {
  if (!root) return
  const checked = path.resolve(root)
  assert.equal(path.dirname(checked).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(checked).startsWith('sad-quick-v1-baseline-'))
  rmSync(checked, { recursive: true, force: true })
})

/** Export immutable runtime dependencies only, verifying every byte against its Git blob id. */
export async function baseline(t) {
  void t
  if (fixture) return fixture
  root = mkdtempSync(path.join(os.tmpdir(), 'sad-quick-v1-baseline-'))
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n')
  // Existing packages only; nothing installed and no cache is written to Dev.
  symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction')
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', V1_BASELINE], { cwd: REPO, maxBuffer: 8 * 1024 ** 2 }).toString('utf8')
  const blobs = new Map(listing.split('\0').filter(Boolean).map(row => {
    const [meta, file] = row.split('\t')
    return [file, meta.split(' ')[2]]
  }))
  const copied = new Set()
  function copy(rel) {
    if (copied.has(rel)) return
    assert.ok(blobs.has(rel), `baseline dependency exists: ${rel}`)
    assert.ok(!rel.startsWith('../') && !path.posix.isAbsolute(rel), 'baseline stays in its scratch root')
    const bytes = execFileSync('git', ['show', '--no-textconv', `${V1_BASELINE}:${rel}`], { cwd: REPO, maxBuffer: 8 * 1024 ** 2 })
    const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    assert.equal(hash, blobs.get(rel), `baseline blob matches ${rel}`)
    copied.add(rel)
    const target = path.join(root, ...rel.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    const source = parseAst(bytes.toString('utf8'), { lang: rel.endsWith('.tsx') ? 'tsx' : 'ts' }, rel)
    for (const node of source.body) {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) || !node.source) continue
      if (node.importKind === 'type' || node.exportKind === 'type') continue
      if (node.specifiers?.length && node.specifiers.every(n => n.importKind === 'type' || n.exportKind === 'type')) continue
      const spec = node.source.value
      if (!spec.startsWith('.')) continue
      const stem = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))
      const dep = [stem, ...['.ts', '.tsx', '.mjs', '.js', '/index.ts'].map(ext => stem + ext)].find(p => blobs.has(p))
      assert.ok(dep, `baseline runtime import ${rel} -> ${spec}`)
      copy(dep)
    }
  }
  fixture = {
    root,
    async load(rel) {
      copy(rel)
      return import(pathToFileURL(path.join(root, ...rel.split('/'))).href)
    },
    copied,
  }
  return fixture
}
