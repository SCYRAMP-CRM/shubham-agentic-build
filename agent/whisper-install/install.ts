import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, statfs, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { IDENTITY_MS, listProcesses, type Proc } from '../proc-tree.ts'
import { speechPaths } from '../speech/paths.ts'
import { unpackProgram } from './archives.ts'
import { downloadChecked, type DownloadOptions } from './download.ts'
import { modelArtifact, programArtifact, WHISPER_BUILD, WHISPER_VERSION } from './manifest.ts'
import { PAYLOADS, type PayloadFile } from './payloads.ts'

// F-251: Whisper as one of the app's dependencies on THIS PC: the official whisper.cpp program (manifest.ts, its every
// file in payloads.ts) and the small model, put where speech/engine.ts looks (speech/paths.ts). Install.ps1's last step
// and PC control > Dependencies' fix run it (agent/scripts/fetch-whisper.ts); nothing in the agent does.
//
// MISSING ONLY. It adds a program folder or a model file that is not there. Whatever is there already (the pinned build,
// another build, a custom or damaged model) is kept as it is and said so: nothing is replaced, renamed or deleted, so a
// file the speech engine may be using is never touched. Downloads stream into this install's own staging folder and are
// checked by size and SHA-256; the program's files are checked again one by one before its folder moves into place in
// one rename (Windows never renames a folder over another), and the model is published with an exclusive hard link
// (never over a name that is there). User level: no service, no administrator, no restart.

export type WhisperPart = 'program' | 'model' | 'all'
export interface InstallOptions extends Pick<DownloadOptions, 'signal' | 'fetch'> {
  /** The state root (speech/paths.ts); default %LOCALAPPDATA%\shubham-agentic. */
  root?: string
  model?: string
  part?: WhisperPart
  /** Each download's progress: which one, its bytes so far and its pinned size. */
  onProgress?: (part: 'program' | 'model', bytes: number, total: number) => void
  /** Tests: the process table, and this process, for a lock that an install which has ended left behind. */
  procs?: () => Promise<Proc[]>
  self?: { pid: number; created: number }
}
export interface InstallResult {
  build: string
  version: string
  program: string
  /** Null when only the program was asked for. */
  model: string | null
  /** What this run put in place: empty when everything was here already. */
  added: ('program' | 'model')[]
  /** A cleanup that did not finish after the install itself did: what is left, to remove by hand. */
  leftover: string[]
  /** A checked payload is NOT a transcription: the app's own speech check is separate. */
  appTranscription: 'not-run'
}

type Identity = { dev: bigint; ino: bigint }
interface LockOwner { v: 1; owner: string; pid: number; created: number }
const LOCK = '.install.lock'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** A staging folder: `.install-<its install's owner id>-<mkdtemp's six>`. Only this installer makes them. */
const STAGE = new RegExp(`^\\.install-${UUID}-[A-Za-z0-9]{6}$`)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const errno = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code
const selfIdentity = () => ({ pid: process.pid, created: Math.round(Date.now() - process.uptime() * 1000) })

async function directory(dir: string): Promise<string> {
  const abs = path.resolve(dir), parsed = path.parse(abs)
  let p = parsed.root
  for (const part of abs.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    p = path.join(p, part)
    try {
      const s = await lstat(p)
      if (!s.isDirectory() || s.isSymbolicLink()) throw new Error(`Whisper's folder ${p} is not a plain folder (a link or a file is never followed)`)
    } catch (e) {
      if (errno(e) !== 'ENOENT') throw e
      await mkdir(p, { mode: 0o700 })
    }
  }
  return realpath(abs)
}

async function digest(file: string, expected: Pick<PayloadFile, 'bytes' | 'sha256'>): Promise<boolean> {
  try {
    const s = await lstat(file)
    if (!s.isFile() || s.isSymbolicLink() || s.size !== expected.bytes) return false
    const h = createHash('sha256')
    for await (const b of createReadStream(file)) h.update(b)
    return h.digest('hex') === expected.sha256
  } catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes(errno(e) ?? '')) return false
    throw e
  }
}

export async function programReady(dir: string, files: readonly PayloadFile[]): Promise<boolean> {
  try {
    const d = await lstat(dir)
    if (!d.isDirectory() || d.isSymbolicLink()) return false
  } catch (e) {
    if (errno(e) === 'ENOENT') return false
    throw e
  }
  // Exactly the pinned files: one missing, changed or extra (another build's) is not this dependency.
  const names = await readdir(dir)
  if (names.length !== files.length || names.some(name => !files.some(f => f.file === name))) return false
  for (const f of files) if (!(await digest(path.join(dir, f.file), f))) return false
  return true
}

async function requireMissing(file: string, what: string): Promise<void> {
  try { await lstat(file) }
  catch (e) {
    if (errno(e) === 'ENOENT') return
    throw e
  }
  throw new Error(`${what} is here already but is not the pinned one; it was preserved as it is. To install the pinned one, move it away first`)
}

/**
 * Publish verified staged model bytes without ever replacing a destination.
 * A same-volume hard link publishes the complete regular file in one operation;
 * the owned staging name is removed by stage cleanup. No symlink or copy fallback.
 */
export async function publishMissingModel(staged: string, destination: string, spec: Pick<PayloadFile, 'bytes' | 'sha256'>): Promise<void> {
  if (!(await digest(staged, spec))) throw new Error('Staged model does not match its pinned dependency')
  try { await link(staged, destination) }
  catch (e) {
    if (errno(e) === 'EEXIST') throw new Error('A model appeared before promotion; it was preserved', { cause: e })
    // A filesystem that cannot publish without replacement is a visible refusal,
    // never a reason to fall back to overwriting/copying into the live model path.
    throw e
  }
}

/** Moves a complete, checked program folder into place where there is none. */
export async function promoteProgram(staged: string, destination: string): Promise<void> {
  await requireMissing(destination, 'The Whisper program folder')
  // Should one appear after that check, Windows' rename refuses rather than replacing it (install.test.ts checks this).
  await rename(staged, destination)
}

/** Deletes a staging folder of this installer's own, once it is certain that it still is that folder, directly in `parent`. */
async function removeStage(dir: string, parent: string, identity: Identity) {
  const current = await lstat(dir, { bigint: true })
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Whisper staging identity changed; refusing cleanup')
  const actual = await realpath(dir), base = await realpath(parent)
  if (path.dirname(actual) !== base || path.basename(actual) !== path.basename(dir) || !STAGE.test(path.basename(actual))) throw new Error('Refusing cleanup outside the owned Whisper staging directory')
  // A virus scan may hold a file it has just been given for a moment.
  await rm(actual, { recursive: true, maxRetries: 3, retryDelay: 200 })
}

/** Holding the lock, no other install can be staging: a staging folder here is one an install that ended left behind. */
async function removeLeftovers(parent: string): Promise<void> {
  for (const name of await readdir(parent)) {
    if (!STAGE.test(name)) continue
    const dir = path.join(parent, name)
    const s = await lstat(dir, { bigint: true })
    if (s.isDirectory() && !s.isSymbolicLink()) await removeStage(dir, parent, { dev: s.dev, ino: s.ino })
  }
}

function parseLock(text: string): LockOwner | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const { v, owner, pid, created } = j as Record<string, unknown>
  if (v !== 1 || typeof owner !== 'string' || !new RegExp(`^${UUID}$`).test(owner)) return null
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || typeof created !== 'number' || !Number.isSafeInteger(created) || created < 1) return null
  return { v, owner, pid, created }
}

/**
 * One install at a time on this PC. A lock left by an install that has ended (its PID gone, or now another process: one
 * that started at another time, the way speech/engine.ts tells a left-behind server) is taken over. A lock this app did not
 * write, or one whose process may still be running, is a refusal that says what to do.
 */
async function takeLock(parent: string, me: LockOwner, procs: () => Promise<Proc[]>): Promise<FileHandle> {
  const lockPath = path.join(parent, LOCK)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(me))
        await handle.sync()
      } catch (e) {
        await handle.close()
        await unlink(lockPath)
        throw e
      }
      return handle
    } catch (e) {
      if (errno(e) !== 'EEXIST') throw e
    }
    let text: string
    try { text = await readFile(lockPath, 'utf8') }
    catch (e) {
      if (errno(e) === 'ENOENT') continue
      throw e
    }
    const held = parseLock(text)
    if (!held) throw new Error(`Whisper's install lock ${lockPath} was not written by this app. If no Whisper install is running, delete it and try again`)
    let table: Proc[]
    try { table = await procs() }
    catch (e) { throw new Error(`Another Whisper install may be running (PID ${held.pid}): this PC's process list could not be read (${message(e)})`) }
    const p = table.find(x => x.pid === held.pid)
    if (p && (p.created === 0 || Math.abs(p.created - held.created) <= IDENTITY_MS)) throw new Error(`Another Whisper install is running (PID ${held.pid}); try again when it has finished`)
    // It has ended. Move its lock aside under this install's own name (only one taker can), and check it still is that lock.
    const aside = path.join(parent, `${LOCK}.${me.owner}`)
    try { await rename(lockPath, aside) }
    catch (e) {
      if (errno(e) === 'ENOENT') continue
      throw e
    }
    if ((await readFile(aside, 'utf8')) !== text) {
      // Another install took it over in between and wrote its own: give that back, never over a newer one.
      await link(aside, lockPath).then(() => unlink(aside), () => {})
      throw new Error('Another Whisper install started at the same moment; try again')
    }
    await unlink(aside)
  }
  throw new Error('Could not take the Whisper install lock; try again')
}

async function releaseLock(handle: FileHandle, lockPath: string, mine: string): Promise<void> {
  await handle.close()
  if ((await readFile(lockPath, 'utf8')) !== mine) throw new Error(`Whisper's install lock ${lockPath} changed hands; it was left in place`)
  await unlink(lockPath)
}

/** Fixed, user-level payload installer. No service, SSH, elevated command, key or app restart. */
export async function installWhisper(o: InstallOptions = {}): Promise<InstallResult> {
  const part = o.part ?? 'all'
  if (!['program', 'model', 'all'].includes(part)) throw new Error('Unknown Whisper dependency')
  const model = o.model ?? 'small'
  const program = programArtifact(process.platform, process.arch)
  const modelSpec = part === 'program' ? null : modelArtifact(model)
  const files = PAYLOADS.windows
  const root = await directory(speechPaths(model, o.root).root)
  const paths = speechPaths(model, root)
  const parent = await directory(path.dirname(paths.bin))
  await directory(paths.models)
  o.signal?.throwIfAborted()
  const me: LockOwner = { v: 1, owner: randomUUID(), ...(o.self ?? selfIdentity()) }
  const lock = await takeLock(parent, me, o.procs ?? listProcesses)
  let tmp: string | null = null, stage: Identity | null = null
  const added: InstallResult['added'] = []
  const errors: unknown[] = []
  try {
    await removeLeftovers(parent)
    o.signal?.throwIfAborted()
    const needProgram = part !== 'model' && !(await programReady(paths.bin, files))
    const needModel = modelSpec !== null && !(await digest(paths.model, modelSpec))
    // Missing only: anything already there (another build, a custom or damaged model) is kept, never replaced.
    if (needProgram) await requireMissing(paths.bin, 'The Whisper program folder')
    if (needModel) await requireMissing(paths.model, `Whisper model ${model}`)
    if (needProgram || needModel) {
      const want = needModel ? 1_200_000_000 : 200_000_000
      const space = await statfs(root)
      if (space.bavail * space.bsize < want) throw new Error(`Whisper needs ${(want / 1e9).toFixed(1)} GB free on this disk to download and check it`)
      tmp = await mkdtemp(path.join(parent, `.install-${me.owner}-`))
      const s = await lstat(tmp, { bigint: true })
      if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Whisper staging is not a regular owned directory')
      stage = { dev: s.dev, ino: s.ino }
    }
    if (needProgram) {
      const archive = path.join(tmp!, 'program.download')
      await downloadChecked(program, archive, { signal: o.signal, fetch: o.fetch, progress: b => o.onProgress?.('program', b, program.bytes) })
      const unpacked = unpackProgram(await readFile(archive), program)
      if (unpacked.size !== files.length) throw new Error('Program file list differs from the pinned dependency')
      for (const f of files) {
        const b = unpacked.get(f.file)
        if (!b || b.length !== f.bytes || createHash('sha256').update(b).digest('hex') !== f.sha256) throw new Error('Program payload differs from the pinned dependency')
      }
      const staged = await directory(path.join(tmp!, 'Release'))
      for (const f of files) await writeFile(path.join(staged, f.file), unpacked.get(f.file)!, { flag: 'wx', mode: 0o600 })
      if (!(await programReady(staged, files))) throw new Error('The staged Whisper program does not match the pinned dependency')
      o.signal?.throwIfAborted()
      await promoteProgram(staged, paths.bin)
      added.push('program')
    }
    if (needModel) {
      const staged = path.join(tmp!, 'model.download')
      await downloadChecked(modelSpec!, staged, { signal: o.signal, fetch: o.fetch, progress: b => o.onProgress?.('model', b, modelSpec!.bytes) })
      o.signal?.throwIfAborted()
      await publishMissingModel(staged, paths.model, modelSpec!)
      added.push('model')
    }
  } catch (e) {
    errors.push(e)
  }
  // Cleanup always runs. After a failure its own errors go with the first one; after success they are left to say.
  const leftover: string[] = []
  const after = (what: string, e: unknown) => {
    if (errors.length) errors.push(e)
    else leftover.push(`${what} (${message(e)})`)
  }
  if (tmp) {
    try {
      if (!stage) throw new Error('its identity is unknown')
      await removeStage(tmp, parent, stage)
    } catch (e) { after(tmp, e) }
  }
  try { await releaseLock(lock, path.join(parent, LOCK), JSON.stringify(me)) }
  catch (e) { after(path.join(parent, LOCK), e) }
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, `${message(errors[0])} (and the cleanup after it did not finish)`)
  return { build: WHISPER_BUILD, version: WHISPER_VERSION, program: paths.exe, model: modelSpec ? paths.model : null, added, leftover, appTranscription: 'not-run' }
}
