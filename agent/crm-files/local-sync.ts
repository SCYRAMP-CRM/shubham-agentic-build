import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CrmSyncStatus } from '../../shared/crm-files.ts'
import { writeAtomic } from '../config.ts'
import { driveType } from '../drive/mime.ts'
import { isSideName } from './dav-crm.ts'
import { buildRulesByFolder, createMatcher, type DriveignoreFile } from './driveignore.ts'
import {
  README_NAME,
  REMOVED_DIR,
  WORK_DIR,
  baseOf,
  conflictName,
  dirOf,
  emptyState,
  isReservedTop,
  keyOf,
  layout,
  plan,
  type LocalScan,
  type Placed,
  type SyncAction,
  type SyncNote,
  type SyncOs,
  type SyncPlan,
  type SyncState,
} from './local-sync-plan.ts'
import type { PinsHost } from './pins-host.ts'
import type { CrmFilesService } from './service.ts'

// oe86a: this PC's synced CRM folder (see local-sync-plan.ts for the rules). The folder is a plain one on the PC's own disk, so it is there, at disk speed, whether the app runs or
// not; while the agent runs this keeps it in step with the CRM both ways, through the CRM files service the drive uses (its rights, its names, its uploads, Google Drive for big
// files): at the start, a few seconds after a change in the folder, and every minute. What it knows of each synced file is in <state>/crm-sync/state.json; a download is written
// beside the folder's top (.crm-sync/tmp) and put in place whole, so a program never sees half a file. The old way, the mounted drive (Y:, the Linux gvfs mount), runs as before
// beside it. It is OFF unless switched on (Shubham's correction of 14 Nov, order o4fb7: "I didn't mean a fast drive folder. It is that the mounted drive
// doesn't load fast"): the settings file <state>/crm-sync.json {"on": true}, which the CRM files page's Sync switch writes, turns it on; with no such file nothing
// is made and nothing syncs.

export const SYNC_SETTINGS_FILE = 'crm-sync.json'
const STATE_DIR = 'crm-sync'
const MB = 1024 * 1024
const GB = 1024 * MB
/** Downloads per pass, so a long first sync still lets this PC's own changes go up between its parts. */
const DOWNLOADS_PER_PASS = 100
/** Folders never walked: they are never synced (they would be ignored anyway), and they can be huge. */
const SKIP_DIRS = new Set(['node_modules', '.git'])

export const README_TEXT = `CRM Files: this PC's copy of the CRM's files (Shubham Agentic)

This folder is on this PC's own disk, so programs and Claude read and write it at disk speed, and it is here when the app is off or the PC is offline. While the app runs it keeps the folder in step with the CRM both ways: when it starts, a few seconds after a change here, and every minute.

- A file saved inside a project's folder (in "Marketing Projects" or "projects", then a project, or one of its folders) goes up to the CRM, for everyone, once it is saved and closed. A changed file goes up as a new version. A new folder inside a project becomes a folder in the CRM.
- The other top folders (bank-statements, invoices and the like) and Uncategorised are the CRM's own lists: a file put there stays on this PC.
- Nothing is ever deleted in the CRM from here. A CRM file deleted here comes back at the next sync.
- A file the CRM no longer lists (deleted there, or your access removed) is never deleted here: it moves to "${REMOVED_DIR}".
- A file changed both here and in the CRM: both are kept. The CRM's stays in its place; this PC's is put beside it as "<name> (conflict, <PC>, <date>)" and goes up as a new file.
- Files over 100 MB come here only when you mark them, or a folder above them, "Keep on this PC" on the app's CRM files page.
- Editor and system files (~$..., *.tmp, Thumbs.db, desktop.ini, .DS_Store, node_modules, .git) never go up. A .driveignore file (written like .gitignore) in any folder adds more; it stays on this PC.
- Scratch work belongs outside this folder: what is saved inside a project here is sent to the CRM.
`

export interface LocalSyncOptions {
  /** The agent's state folder: the settings (crm-sync.json) and what the sync knows (crm-sync/state.json). */
  dir: string
  service: () => CrmFilesService | null
  signedIn: () => boolean
  /** "Keep on this PC": a file over the cap comes when it, or a folder above it, is kept. */
  keep?: () => PinsHost | null
  /** The PC's file manager on the folder (the page's Open folder). */
  openFolder?: (dir: string) => void
  log?: { info(m: string): void; warn(m: string): void }
  // Tests (and a settings file) may set these:
  root?: string
  os?: SyncOs
  home?: string
  pc?: string
  now?: () => number
  everyMs?: number
  watch?: boolean
  stableMs?: number
  removeAfterMs?: number
  reserveBytes?: number
  freeBytes?: (dir: string) => Promise<number>
  /** Where CRM_DRIVE is set for the chats this app starts (default: this process's environment). */
  env?: NodeJS.ProcessEnv
}

export interface LocalSync {
  start(): Promise<void>
  close(): Promise<void>
  status(): CrmSyncStatus
  /** A pass now (after any that is running); its status. */
  now(): Promise<CrmSyncStatus>
  /** The page's settings: on or off, the size a file may have to come by itself (MB), the limit of all synced files (GB). Kept in crm-sync.json; a pass follows. */
  setSettings(change: { on?: boolean; capMb?: number; quotaGb?: number }): Promise<CrmSyncStatus>
  /** Opens the folder in the PC's file manager. */
  open(): Promise<void>
}

/** The bounds of the page's settings. */
export const SYNC_CAP_MB_MAX = 100_000
export const SYNC_QUOTA_GB_MAX = 100_000

/** The folder's place: %USERPROFILE%\CRM Files on Windows, ~/CRM-Drive elsewhere (his choice 4). */
export function defaultSyncRoot(osName: SyncOs, home = os.homedir()): string {
  return osName === 'windows' ? path.join(home, 'CRM Files') : path.join(home, 'CRM-Drive')
}

interface Settings {
  on: boolean
  root: string | null
  capMb: number
  quotaGb: number
}

/** A refusal in plain words (a route answers it as 400). */
class SyncError extends Error {
  status = 400
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300)

async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const c of createReadStream(file)) h.update(c as Buffer)
  return h.digest('hex')
}

async function freeOn(dir: string): Promise<number> {
  const s = await statfs(dir)
  return Number(s.bavail) * Number(s.bsize)
}

export function createLocalSync(o: LocalSyncOptions): LocalSync {
  const osName: SyncOs = o.os ?? (process.platform === 'win32' ? 'windows' : 'linux')
  const now = o.now ?? Date.now
  const log = o.log
  const env = o.env ?? process.env
  const pc = o.pc ?? os.hostname()
  const stableMs = o.stableMs ?? 10_000
  const removeAfterMs = o.removeAfterMs ?? 30_000
  const reserve = o.reserveBytes ?? 5 * GB
  const freeBytes = o.freeBytes ?? freeOn
  const stateFile = path.join(o.dir, STATE_DIR, 'state.json')
  const key = (rel: string) => keyOf(osName, rel)

  let state: SyncState = emptyState()
  let closed = false
  let started = false
  let timer: ReturnType<typeof setInterval> | null = null
  let soon: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  let watching = ''
  let running: Promise<void> | null = null
  let again = false
  /** Projects whose folders (groups) the next listing asks for: a folder made on this PC to match, or just made in the CRM. */
  let askGroups = new Set<string>()
  const failures = new Map<string, { n: number; next: number }>()
  /** When each file (in its present size and time) and each folder was first seen by a pass: "still for a while" is measured from this, never from the file's own time. */
  const seenFiles = new Map<string, { size: number; mtimeMs: number; since: number }>()
  const seenDirs = new Map<string, number>()

  const status: CrmSyncStatus = { on: false, root: '', state: 'off', reason: null, lastPass: null, files: 0, bytes: 0, waiting: [], big: [], errors: [], capMb: 100, quotaGb: 50 }

  function settings(): Settings {
    try {
      const j = JSON.parse(readFileSync(path.join(o.dir, SYNC_SETTINGS_FILE), 'utf8')) as Record<string, unknown>
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
      return { on: j.on === true, root: typeof j.root === 'string' && j.root.trim() ? j.root.trim() : null, capMb: num(j.capMb, 100), quotaGb: num(j.quotaGb, 50) }
    } catch {
      return { on: false, root: null, capMb: 100, quotaGb: 50 }
    }
  }

  function loadState() {
    try {
      const j = JSON.parse(readFileSync(stateFile, 'utf8')) as SyncState
      if (j && j.v === 1 && j.files && typeof j.files === 'object') state = { v: 1, files: j.files, missing: j.missing ?? {} }
    } catch {
      state = emptyState()
    }
  }
  function saveState() {
    try {
      writeAtomic(stateFile, JSON.stringify(state))
    } catch (e) {
      log?.warn(`crm sync: what it knows could not be kept (${errText(e)})`)
    }
  }
  function totals() {
    const all = Object.values(state.files)
    status.files = all.length
    status.bytes = all.reduce((n, f) => n + f.size, 0)
  }
  function setState(s: CrmSyncStatus['state'], reason: string | null) {
    status.state = s
    status.reason = reason
  }

  const due = (rel: string) => {
    const f = failures.get(key(rel))
    return !f || f.next <= now()
  }
  function failed(rel: string, e: unknown) {
    const k = key(rel)
    const n = (failures.get(k)?.n ?? 0) + 1
    failures.set(k, { n, next: now() + Math.min(2 * 3600_000, 60_000 * 2 ** (n - 1)) })
    const error = errText(e)
    status.errors = [{ rel, error, at: new Date(now()).toISOString() }, ...status.errors.filter(x => x.rel !== rel)].slice(0, 20)
    log?.warn(`crm sync: ${rel}: ${error}`)
  }
  const done = (rel: string) => failures.delete(key(rel))

  /** The folder is ready (made where missing), or why not. On Linux, the app's own link to the mounted drive at this place moves aside to "<place> (mounted)". */
  async function ready(root: string): Promise<string | null> {
    const st = await lstat(root).catch(() => null)
    if (st?.isSymbolicLink()) {
      const target = await readlink(root).catch(() => '')
      if (osName === 'linux' && /^\/run\/user\/\d+\/gvfs\//.test(target)) {
        const aside = `${root} (mounted)`
        if (await lstat(aside).catch(() => null)) return `${root} is a link to the mounted CRM drive, and "${aside}" is taken: move one of them, then the folder syncs.`
        await rename(root, aside)
        log?.info(`crm sync: the link to the mounted drive moved to "${aside}"; ${root} is now the synced folder`)
      } else return `${root} is a link, not a folder: the sync leaves it alone (move it, or choose another place for the synced folder).`
    } else if (st && !st.isDirectory()) return `${root} is a file, not a folder: the sync leaves it alone.`
    const tmp = path.join(root, WORK_DIR, 'tmp')
    await mkdir(tmp, { recursive: true })
    for (const f of await readdir(tmp).catch(() => [] as string[])) if (f.endsWith('.part')) await rm(path.join(tmp, f), { force: true }).catch(() => undefined)
    const readme = path.join(root, README_NAME)
    if (!existsSync(readme)) await writeFile(readme, osName === 'windows' ? README_TEXT.replace(/\n/g, '\r\n') : README_TEXT).catch(() => undefined)
    return null
  }

  /** The folder as it is now: its files and folders (no links followed), the .driveignore files, and what each folder holds (for an editor's lock file). */
  async function scan(root: string): Promise<{ scan: LocalScan; ignores: DriveignoreFile[]; names: Map<string, Set<string>> }> {
    const files: LocalScan['files'] = new Map()
    const dirs: LocalScan['dirs'] = new Map()
    const ignores: DriveignoreFile[] = []
    const names = new Map<string, Set<string>>()
    const walk = async (abs: string, rel: string, depth: number) => {
      if (depth > 64) return
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      names.set(key(rel), new Set(entries.map(e => e.name)))
      for (const e of entries) {
        if (rel === '' && isReservedTop(e.name)) continue
        if (e.isSymbolicLink()) continue
        const childRel = rel ? `${rel}/${e.name}` : e.name
        const childAbs = path.join(abs, e.name)
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name.toLowerCase())) continue
          const st = await stat(childAbs).catch(() => null)
          if (!st) continue
          dirs.set(key(childRel), { rel: childRel, bornMs: st.birthtimeMs || st.ctimeMs })
          await walk(childAbs, childRel, depth + 1)
        } else if (e.isFile()) {
          if (e.name === '.driveignore') {
            ignores.push({ folder: rel, text: await readFile(childAbs, 'utf8').catch(() => '') })
            continue
          }
          const st = await stat(childAbs).catch(() => null)
          if (st) files.set(key(childRel), { rel: childRel, size: st.size, mtimeMs: st.mtimeMs })
        }
      }
    }
    await walk(root, '', 0)
    return { scan: { files, dirs }, ignores, names }
  }

  async function pass(): Promise<void> {
    const t0 = now()
    const s = settings()
    const root = o.root ?? s.root ?? defaultSyncRoot(osName, o.home)
    Object.assign(status, { on: s.on, root, capMb: s.capMb, quotaGb: s.quotaGb })
    if (!s.on) return setState('off', 'The synced folder is switched off on this PC.')
    if (!o.signedIn()) return setState('signed-out', 'This PC is not signed in to the CRM (Settings › Devices): the folder syncs once it is.')
    const svc = o.service()
    if (!svc) return setState('error', 'The CRM files are not ready yet.')
    const why = await ready(root)
    if (why) return setState('blocked', why)
    env.CRM_DRIVE = root
    if (o.watch !== false && watching !== root) watchFolder(root)
    setState('syncing', null)

    const abs = (rel: string) => path.join(root, ...rel.split('/'))
    const { scan: local, ignores, names } = await scan(root)
    const matcher = createMatcher(buildRulesByFolder(ignores, { defaults: true }))
    const ignored = (rel: string, isDir: boolean) => isSideName(baseOf(rel)) || matcher.isIgnored(rel, isDir)
    const busy = (rel: string) => {
      const n = baseOf(rel)
      const here = names.get(key(dirOf(rel)))
      if (!here) return false
      return here.has(`~$${n}`) || here.has(`~$${n.slice(1)}`) || here.has(`~$${n.slice(2)}`) || here.has(`.~lock.${n}#`)
    }
    const keep = o.keep?.() ?? null
    const kept = (p: Placed) => (keep ? keep.markOf(p.id, p.ancestors) !== null : false)
    const capBytes = s.capMb * MB

    // How long each file and folder has been as it is now, by this sync's own looks.
    const t1 = now()
    for (const [k, f] of local.files) {
      const was = seenFiles.get(k)
      if (!was || was.size !== f.size || was.mtimeMs !== f.mtimeMs) seenFiles.set(k, { size: f.size, mtimeMs: f.mtimeMs, since: t1 })
    }
    for (const k of [...seenFiles.keys()]) if (!local.files.has(k)) seenFiles.delete(k)
    for (const k of local.dirs.keys()) if (!seenDirs.has(k)) seenDirs.set(k, t1)
    for (const k of [...seenDirs.keys()]) if (!local.dirs.has(k)) seenDirs.delete(k)
    const quiet = (f: { rel: string }) => t1 - (seenFiles.get(key(f.rel))?.since ?? t1)
    const quietDir = (d: { rel: string }) => t1 - (seenDirs.get(key(d.rel)) ?? t1)

    let asked = new Set(askGroups)
    let placed = layout(await svc.syncTree(asked), osName)
    const makePlan = () => plan({ os: osName, placed, local, state, now: now(), capBytes, quotaBytes: s.quotaGb * GB, kept, ignored, busy, stableMs, quiet, quietDir, removeAfterMs, groupsListed: asked })
    let p: SyncPlan = makePlan()
    if (p.needGroups.some(g => !asked.has(g))) {
      asked = new Set([...asked, ...p.needGroups])
      placed = layout(await svc.syncTree(asked), osName)
      p = makePlan()
    }
    askGroups = new Set(p.needGroups)
    state.missing = p.missing
    const notes: SyncNote[] = [...p.waiting]
    const big = [...p.big]
    const counts = { downloaded: 0, uploaded: 0, conflicts: 0, removed: 0, failed: 0 }
    const placedById = placed

    /** A changed local file is put beside the CRM's under its conflict name (nothing is lost; it goes up as a new file next pass). */
    async function keepBeside(rel: string): Promise<string> {
      const dir = dirOf(rel)
      let name = conflictName(baseOf(rel), pc, new Date(now()))
      for (let n = 2; existsSync(abs(dir ? `${dir}/${name}` : name)); n++) name = conflictName(baseOf(rel), `${pc} ${n}`, new Date(now()))
      const to = dir ? `${dir}/${name}` : name
      await rename(abs(rel), abs(to))
      counts.conflicts++
      log?.info(`crm sync: changed here and in the CRM: this PC's copy is kept as "${to}"`)
      return to
    }

    /** The CRM's bytes into .crm-sync/tmp, counted and hashed; a file over the cap (not kept) stops there. */
    async function fetchToTmp(pl: Placed): Promise<{ tmp: string; size: number; sha256: string } | { big: number | null }> {
      const r = await svc!.file(pl.id)
      const cap = kept(pl) ? Number.POSITIVE_INFINITY : capBytes
      if (r.size !== null && r.size > cap) {
        r.stream.destroy()
        return { big: r.size }
      }
      if ((await freeBytes(root).catch(() => Number.POSITIVE_INFINITY)) - (r.size ?? 0) < reserve) {
        r.stream.destroy()
        throw new SyncError('The disk is nearly full: this file waits (5 GB are kept free).')
      }
      const tmp = path.join(root, WORK_DIR, 'tmp', `${randomBytes(8).toString('hex')}.part`)
      const h = createHash('sha256')
      let n = 0
      let over = false
      const meter = new Transform({
        transform(c: Buffer, _e, cb) {
          n += c.length
          if (n > cap) {
            over = true
            return cb(new SyncError('over the size cap'))
          }
          h.update(c)
          cb(null, c)
        },
      })
      try {
        await pipeline(r.stream, meter, createWriteStream(tmp))
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => undefined)
        if (over) return { big: null }
        throw e
      }
      if (r.size !== null && n < r.size) {
        await rm(tmp, { force: true }).catch(() => undefined)
        throw new SyncError(`The download stopped short (${n} of ${r.size} bytes); it is tried again.`)
      }
      return { tmp, size: n, sha256: h.digest('hex') }
    }

    async function download(a: { id: string; rel: string; why: 'new' | 'changed' | 'back' }) {
      const pl = placedById.get(a.id)
      if (!pl) return
      const got = await fetchToTmp(pl)
      if ('big' in got) {
        big.push({ rel: a.rel, size: got.big })
        return
      }
      try {
        const there = await stat(abs(a.rel)).catch(() => null)
        const st = state.files[a.id]
        if (there) {
          // The bytes decide, never the time alone: the CRM's very bytes are taken as synced; the bytes the sync last put there are replaced; anything else (a change made
          // here, or a file the sync never put) is kept beside, so nothing made on this PC is ever written over.
          const sha = await hashFile(abs(a.rel))
          if (sha === got.sha256) {
            state.files[a.id] = { id: a.id, rel: a.rel, version: pl.version ?? '', size: got.size, mtimeMs: there.mtimeMs, sha256: sha }
            return
          }
          if (!st || sha !== st.sha256) await keepBeside(a.rel)
        }
        await mkdir(path.dirname(abs(a.rel)), { recursive: true })
        await rename(got.tmp, abs(a.rel))
        const when = pl.modifiedAt ? Date.parse(pl.modifiedAt) : Number.NaN
        if (Number.isFinite(when)) await utimes(abs(a.rel), new Date(), new Date(when)).catch(() => undefined)
        const put = await stat(abs(a.rel))
        state.files[a.id] = { id: a.id, rel: a.rel, version: pl.version ?? '', size: got.size, mtimeMs: put.mtimeMs, sha256: got.sha256 }
        counts.downloaded++
      } finally {
        await rm(got.tmp, { force: true }).catch(() => undefined)
      }
    }

    async function uploadNew(rel: string, parentId: string) {
      const s1 = await stat(abs(rel))
      const sha = await hashFile(abs(rel))
      const name = baseOf(rel)
      const node = await svc!.upload(parentId, name, driveType(name).type, createReadStream(abs(rel)), s1.size)
      state.files[node.id] = { id: node.id, rel, version: '', size: s1.size, mtimeMs: s1.mtimeMs, sha256: sha }
      counts.uploaded++
      log?.info(`crm sync: sent up "${rel}"`)
    }

    async function uploadVersion(id: string, rel: string) {
      const st = state.files[id]
      const s1 = await stat(abs(rel))
      const sha = await hashFile(abs(rel))
      if (st && sha === st.sha256) {
        // Only its time changed: nothing to send.
        state.files[id] = { ...st, size: s1.size, mtimeMs: s1.mtimeMs }
        return
      }
      await svc!.version(id, '', driveType(baseOf(rel)).type, createReadStream(abs(rel)), s1.size)
      state.files[id] = { id, rel, version: '', size: s1.size, mtimeMs: s1.mtimeMs, sha256: sha }
      counts.uploaded++
      log?.info(`crm sync: sent up a new version of "${rel}"`)
    }

    async function maybeMoved(a: Extract<SyncAction, { kind: 'maybe-moved' }>) {
      const st = state.files[a.id]
      const pl = placedById.get(a.id)
      if (!st || !pl) return
      const sha = await hashFile(abs(a.to)).catch(() => null)
      const toParent = a.toParentId ? (placedById.get(a.toParentId) ?? null) : null
      const asCopy = async (why: string | null) => {
        // Not the same file, or it may not move there in the CRM: the CRM's comes back to its place, and this one goes up where it may.
        if (why) notes.push({ rel: a.to, why })
        if (toParent?.canUpload) await uploadNew(a.to, toParent.id)
        else notes.push({ rel: a.to, why: toParent ? 'This folder is read only for you in the CRM: it stays on this PC.' : 'Not inside a project you may add to: it stays on this PC.' })
        await download({ id: a.id, rel: st.rel, why: 'back' })
      }
      if (sha !== st.sha256) return asCopy(null)
      const sameFolder = key(dirOf(a.from)) === key(dirOf(a.to))
      const inProject = !!toParent && (toParent.kind === 'project' || toParent.kind === 'group') && toParent.id !== 'proj:none'
      const toProject = toParent ? (toParent.kind === 'project' ? toParent.id : toParent.project) : null
      if (!sameFolder && (!inProject || !pl.canMove || toProject !== pl.project)) return asCopy('Moved to another project or folder the CRM does not move it to: a copy goes up there, and the CRM\'s comes back to its place.')
      const newName = baseOf(a.to)
      if (newName !== baseOf(pl.rel) && !pl.canRename) return asCopy('Renamed, but the CRM file may not be renamed by you: a copy goes up, and the CRM\'s comes back.')
      if (!sameFolder) await svc!.move(a.id, toParent!.id)
      if (newName !== baseOf(pl.rel)) await svc!.rename(a.id, newName)
      const s2 = await stat(abs(a.to))
      state.files[a.id] = { ...st, rel: a.to, version: '', size: s2.size, mtimeMs: s2.mtimeMs }
      counts.uploaded++
      log?.info(`crm sync: "${a.from}" was moved or renamed here; the CRM file follows it to "${a.to}"`)
    }

    async function removed(id: string, rel: string) {
      const from = abs(rel)
      if (existsSync(from)) {
        let to = `${REMOVED_DIR}/${rel}`
        for (let n = 2; existsSync(abs(to)); n++) to = `${REMOVED_DIR}/${dirOf(rel) ? `${dirOf(rel)}/` : ''}${n} - ${baseOf(rel)}`
        await mkdir(path.dirname(abs(to)), { recursive: true })
        await rename(from, abs(to))
        log?.info(`crm sync: the CRM no longer lists "${rel}": it is kept in "${to}"`)
      }
      delete state.files[id]
      counts.removed++
    }

    const run = async (rel: string, f: () => Promise<void>) => {
      if (closed || !due(rel)) return
      try {
        await f()
        done(rel)
      } catch (e) {
        counts.failed++
        failed(rel, e)
      }
    }
    const pool = async <T>(items: T[], n: number, f: (t: T) => Promise<void>) => {
      let i = 0
      await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length && !closed) await f(items[i++])
      }))
    }
    const of = <K extends SyncAction['kind']>(k: K) => p.actions.filter((x): x is Extract<SyncAction, { kind: K }> => x.kind === k)

    // This PC's own work first (it must never wait on a long download), then the CRM's.
    for (const a of of('mkdir-local')) await run(a.rel, () => mkdir(abs(a.rel), { recursive: true }).then(() => undefined))
    for (const a of of('adopt')) if (state.files[a.id]) state.files[a.id] = { ...state.files[a.id], version: a.version }
    for (const a of of('move-local')) {
      await run(a.to, async () => {
        await mkdir(path.dirname(abs(a.to)), { recursive: true })
        await rename(abs(a.from), abs(a.to))
        state.files[a.id] = { ...state.files[a.id], rel: a.to }
      })
    }
    for (const a of of('removed')) await run(a.rel, () => removed(a.id, a.rel))
    for (const a of of('maybe-moved')) await run(a.to, () => maybeMoved(a))
    await pool(of('upload-version'), 2, a => run(a.rel, () => uploadVersion(a.id, a.rel)))
    await pool(of('upload-new'), 2, a => run(a.rel, () => uploadNew(a.rel, a.parentId)))
    for (const a of of('mkdir-remote')) {
      await run(a.rel, async () => {
        await svc.folder(a.parentId, a.name)
        const parent = placedById.get(a.parentId)
        const project = parent ? (parent.kind === 'project' ? parent.id : parent.project) : null
        if (project) askGroups.add(project)
        log?.info(`crm sync: the folder "${a.rel}" made here is now a folder in the CRM`)
      })
    }
    saveState()
    const fromCrm = [
      ...of('conflict').map(a => ({ id: a.id, rel: a.rel, why: 'new' as const })),
      ...of('check-local').map(a => ({ id: a.id, rel: a.rel, why: 'new' as const })),
      ...of('download').map(a => ({ id: a.id, rel: a.rel, why: a.why })),
    ]
    const now1 = fromCrm.slice(0, DOWNLOADS_PER_PASS)
    let saved = now()
    await pool(now1, 4, async a => {
      await run(a.rel, () => download(a))
      if (now() - saved > 5_000) {
        saved = now()
        saveState()
      }
    })
    saveState()
    totals()
    status.waiting = notes.slice(0, 50)
    status.big = big.slice(0, 50)
    status.lastPass = { at: new Date(now()).toISOString(), ms: now() - t0, ...counts }
    if (counts.downloaded + counts.uploaded + counts.conflicts + counts.removed + counts.failed > 0) {
      log?.info(`crm sync: pass done in ${Math.round((now() - t0) / 100) / 10} s: ${counts.downloaded} down, ${counts.uploaded} up, ${counts.conflicts} kept beside, ${counts.removed} to ${REMOVED_DIR}, ${counts.failed} failed`)
    }
    setState('idle', p.suspicious)
    // More to bring than one pass takes: the next one starts at once.
    if (fromCrm.length > now1.length) schedule(1_000)
    // Something waits to be still (being written, a new folder being named): look again just after it may be, not only at the minute's pass.
    else if (p.waiting.some(w => w.why.startsWith('Being ')) || [...local.dirs.keys()].some(k => quietDir({ rel: k }) < stableMs)) schedule(stableMs + 1_000)
  }

  function watchFolder(root: string) {
    watcher?.close()
    watcher = null
    watching = root
    try {
      watcher = watch(root, { recursive: true }, (_e, file) => {
        const f = String(file ?? '').replace(/\\/g, '/')
        if (f.startsWith(`${WORK_DIR}/`) || f === WORK_DIR) return
        schedule(3_000)
      })
      watcher.on('error', () => {
        watcher?.close()
        watcher = null
        watching = ''
      })
    } catch {
      watcher = null // the minute's pass still sees every change
    }
  }

  function schedule(ms: number) {
    if (closed || !started) return
    if (soon) clearTimeout(soon)
    soon = setTimeout(() => {
      soon = null
      void kick()
    }, ms)
    soon.unref?.()
  }

  function kick(): Promise<void> {
    if (closed) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        await pass()
      } catch (e) {
        setState('error', `The last sync stopped: ${errText(e)} (it is tried again).`)
        log?.warn(`crm sync: the pass stopped: ${errText(e)}`)
      } finally {
        running = null
        if (again && !closed) {
          again = false
          schedule(1_000)
        }
      }
    })()
    return running
  }

  return {
    async start() {
      if (started || closed) return
      started = true
      loadState()
      totals()
      timer = setInterval(() => void kick(), o.everyMs ?? 60_000)
      timer.unref?.()
      await kick()
    },
    async close() {
      closed = true
      if (timer) clearInterval(timer)
      if (soon) clearTimeout(soon)
      watcher?.close()
      watcher = null
      await running?.catch(() => undefined)
      saveState()
    },
    status: () => ({ ...status, waiting: [...status.waiting], big: [...status.big], errors: [...status.errors] }),
    async now() {
      if (!started) {
        started = true
        loadState()
      }
      if (running) await running
      await kick()
      return { ...status }
    },
    async setSettings(change) {
      const file = path.join(o.dir, SYNC_SETTINGS_FILE)
      let kept: Record<string, unknown> = {}
      try {
        const j: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (j && typeof j === 'object' && !Array.isArray(j)) kept = j as Record<string, unknown>
      } catch {
        // none yet
      }
      const whole = (v: unknown, max: number, what: string) => {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw new SyncError(`${what} is a whole number from 1 to ${max}.`)
        return v
      }
      const next = { ...kept }
      if (change.on !== undefined) {
        if (typeof change.on !== 'boolean') throw new SyncError('On is true or false.')
        next.on = change.on
      }
      if (change.capMb !== undefined) next.capMb = whole(change.capMb, SYNC_CAP_MB_MAX, 'The size a file may have to come by itself (MB)')
      if (change.quotaGb !== undefined) next.quotaGb = whole(change.quotaGb, SYNC_QUOTA_GB_MAX, 'The limit of the synced files (GB)')
      writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
      log?.info(`crm sync: settings changed (${JSON.stringify(change)})`)
      const s = settings()
      Object.assign(status, { on: s.on, capMb: s.capMb, quotaGb: s.quotaGb })
      if (!s.on) setState('off', 'The synced folder is switched off on this PC.')
      else if (started && !closed) {
        if (running) again = true
        else void kick()
      }
      return { ...status, waiting: [...status.waiting], big: [...status.big], errors: [...status.errors] }
    },
    async open() {
      const root = status.root || o.root || settings().root || defaultSyncRoot(osName, o.home)
      if (!existsSync(root)) throw new SyncError('The synced folder is not there yet: it is made at the first sync.')
      if (!o.openFolder) throw new SyncError('This PC cannot open a folder from here.')
      o.openFolder(root)
    },
  }
}
