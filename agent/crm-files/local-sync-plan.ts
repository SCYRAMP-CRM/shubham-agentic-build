import type { CrmNode } from '../../shared/crm-files.ts'
import { legalName, legalWindowsName, namesOf } from './dav-crm.ts'
import type { SyncNode } from './service.ts'

// oe86a (Shubham, 14 Nov 2026: "the drive mount working fast, so people's local Claude can use it, and keep it mounted by default even when the app switches off. It will start
// syncing when the app starts, but what they added after the app quit will stay on the PC; it will not be deleted."): the CRM files as a plain folder on this PC's own disk, kept in
// step with the CRM by the agent while it runs (local-sync.ts). This file is the pure half: where each CRM folder and file sits in the folder (`layout`), and what one pass does
// (`plan`). Nothing here touches the disk or the network.
//
// The rules (his choices of 14 Nov, order o47cf):
//   - Everything the CRM sign-in can open is there; a file over the cap (100 MB) only when it, or a folder above it, is kept ("Keep on this PC"). A size the CRM does not know is
//     tried: the download stops at the cap.
//   - Nothing is ever deleted in the CRM. A CRM file deleted on this PC comes back at the next pass.
//   - What changed on this PC goes up (a new file into its folder, a changed one as a new version) once it has been still for a while and no editor holds it.
//   - Changed on both sides: both are kept (the CRM's in its place, this PC's beside it as "<name> (conflict, <PC>, <date>)", which then goes up as a new file).
//   - A file the CRM no longer lists (deleted there, or access removed) is never deleted here: it moves to "Removed in CRM", after two listings at least `removeAfterMs` apart,
//     and never when a listing looks broken (none at all, or most files gone at once).

/** The folder a file the CRM no longer lists goes to (never synced). */
export const REMOVED_DIR = 'Removed in CRM'
/** The sync's own working folder at the top (downloads in progress; never synced). */
export const WORK_DIR = '.crm-sync'
/** What the folder is, at its top (never synced). */
export const README_NAME = 'README - CRM Files.txt'
const RESERVED_TOP = new Set([REMOVED_DIR, WORK_DIR, README_NAME].map(n => n.toLowerCase()))

export type SyncOs = 'windows' | 'linux'
/** A path's key for comparing: Windows does not tell A.txt from a.txt. */
export const keyOf = (os: SyncOs, rel: string): string => (os === 'windows' ? rel.toLowerCase() : rel)
export const dirOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
export const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
/** A top-level name the sync keeps for itself. */
export const isReservedTop = (rel: string): boolean => !rel.includes('/') && RESERVED_TOP.has(rel.toLowerCase())

/** A CRM folder or file placed in the synced folder. */
export interface Placed {
  id: string
  kind: CrmNode['kind']
  /** Its path from the folder's top, '/' between names. */
  rel: string
  isFolder: boolean
  size: number | null
  /** Files: the token that changes when the file changes in the CRM. */
  version: string | null
  modifiedAt: string | null
  type: string | null
  /** Folders: a new file may go up into it; a folder may be made in it. Files: a changed copy may go up as a new version; it may be renamed, or moved inside its project. */
  canUpload: boolean
  canMkdir: boolean
  canVersion: boolean
  canRename: boolean
  canMove: boolean
  /** The project it is in ("proj:<id>"), or null. */
  project: string | null
  /** Its folders' ids, its parent first (what "Keep on this PC" inherits from). */
  ancestors: string[]
}

/** The drive as folders and files under the synced folder's top, named as the WebDAV drive names them: legal for this PC, and unique in each folder. */
export function layout(nodes: readonly SyncNode[], os: SyncOs): Map<string, Placed> {
  const legal = os === 'windows' ? legalWindowsName : legalName
  const byParent = new Map<string, SyncNode[]>()
  for (const n of nodes) {
    const p = n.parentId ?? 'root'
    const list = byParent.get(p)
    if (list) list.push(n)
    else byParent.set(p, [n])
  }
  const out = new Map<string, Placed>()
  const walk = (parentId: string, parentRel: string, ancestors: string[], project: string | null, depth: number) => {
    if (depth > 64) return
    const named = namesOf((byParent.get(parentId) ?? []) as CrmNode[], legal, os === 'windows')
    for (const [given, node] of named) {
      const n = node as SyncNode
      // The sync's own names at the top are never a CRM folder's.
      const name = parentRel === '' && RESERVED_TOP.has(given.toLowerCase()) ? `${given} (CRM)` : given
      const rel = parentRel ? `${parentRel}/${name}` : name
      const proj = n.kind === 'project' && n.id !== 'proj:none' ? n.id : project
      out.set(n.id, {
        id: n.id,
        kind: n.kind,
        rel,
        isFolder: n.isFolder,
        size: n.size ?? null,
        version: n.version ?? null,
        modifiedAt: n.modifiedAt ?? null,
        type: n.type ?? null,
        canUpload: n.rights?.upload === true,
        canMkdir: n.rights?.mkdir === true,
        canVersion: n.rights?.version === true,
        canRename: n.rights?.rename === true,
        canMove: n.rights?.move === true,
        project: proj,
        ancestors,
      })
      if (n.isFolder) walk(n.id, rel, [n.id, ...ancestors], proj, depth + 1)
    }
  }
  walk('root', '', [], null, 0)
  return out
}

/** A file in the folder, as the scan saw it. */
export interface LocalFile {
  rel: string
  size: number
  mtimeMs: number
}
/** A folder in the folder, as the scan saw it (`bornMs`: when the PC says it was made; the plan goes by `quietDir`, the sync's own looks). */
export interface LocalDir {
  rel: string
  bornMs: number
}
export interface LocalScan {
  /** By keyOf(rel). */
  files: Map<string, LocalFile>
  dirs: Map<string, LocalDir>
}

/** What the sync knows of a file it has put in step: its place, the CRM's token then, and this PC's copy then. */
export interface SyncedFile {
  id: string
  rel: string
  /** '' while the CRM's token for what this PC just sent up is not known yet: the next listing's is taken as it. */
  version: string
  size: number
  mtimeMs: number
  sha256: string
}
export interface SyncState {
  v: 1
  files: Record<string, SyncedFile>
  /** A synced file the CRM stopped listing: since when, and in how many listings. */
  missing: Record<string, { since: number; seen: number }>
}
export const emptyState = (): SyncState => ({ v: 1, files: {}, missing: {} })

export type SyncAction =
  | { kind: 'mkdir-local'; rel: string }
  | { kind: 'adopt'; id: string; version: string }
  | { kind: 'move-local'; id: string; from: string; to: string }
  | { kind: 'download'; id: string; rel: string; size: number | null; why: 'new' | 'changed' | 'back' }
  /** A file on this PC where the CRM has one the sync never put there: the same bytes are taken as synced, other bytes are kept beside it. */
  | { kind: 'check-local'; id: string; rel: string; size: number | null }
  | { kind: 'conflict'; id: string; rel: string; size: number | null }
  | { kind: 'upload-version'; id: string; rel: string; size: number }
  | { kind: 'upload-new'; rel: string; parentId: string; size: number }
  /** A synced file gone from its place and a new one of the same size elsewhere: if the bytes are the same, it was moved or renamed on this PC. */
  | { kind: 'maybe-moved'; id: string; from: string; to: string; toParentId: string | null }
  | { kind: 'mkdir-remote'; rel: string; parentId: string; name: string }
  | { kind: 'removed'; id: string; rel: string }

export interface SyncNote {
  rel: string
  why: string
}

export interface PlanInput {
  os: SyncOs
  /** The layout, by id. */
  placed: Map<string, Placed>
  local: LocalScan
  state: SyncState
  now: number
  /** Files up to this size come by themselves (bytes). */
  capBytes: number
  /** All the synced files together stay under this (bytes). */
  quotaBytes: number
  /** "Keep on this PC" on the file or a folder above it: it comes whatever its size. */
  kept: (p: Placed) => boolean
  /** .driveignore and the editors' own files: never sent up. */
  ignored: (rel: string, isDir: boolean) => boolean
  /** An editor holds it (Office's ~$ file, LibreOffice's .~lock file next to it). */
  busy: (rel: string) => boolean
  /** A change on this PC goes up only when the file has been still this long (ms). */
  stableMs: number
  /**
   * How long the sync has seen this very file (its size and time) unchanged, and this folder at all (ms). Measured by the sync's own looks, never from the file's own time, so a file
   * whose time is ahead of this PC's clock (a camera's, another PC's) is not taken as "being written" for ever.
   */
  quiet(f: LocalFile): number
  quietDir(d: LocalDir): number
  /** A file the CRM stopped listing moves to Removed in CRM only after this long, in two listings (ms). */
  removeAfterMs: number
  /** The projects whose folders (groups) this listing has in full: a folder made on this PC is sent up only there (else it might be one the CRM has). */
  groupsListed: ReadonlySet<string>
}

export interface SyncPlan {
  actions: SyncAction[]
  /** On this PC only, and why (stays here; nothing is lost). */
  waiting: SyncNote[]
  /** In the CRM, over the cap and not kept: not brought here. */
  big: { rel: string; size: number | null }[]
  /** The missing-files record for the state. */
  missing: SyncState['missing']
  /** The listing looked broken: nothing was taken as removed. */
  suspicious: string | null
  /** Projects with a folder made on this PC that the CRM's listing did not have: the next listing asks for their folders. */
  needGroups: string[]
}

/** Any other size or time than when it was synced (the bytes then decide: a file only touched is not sent, and a copy here is never replaced unless its bytes are the synced ones). */
const changedOnPc = (here: LocalFile, st: SyncedFile) => here.size !== st.size || here.mtimeMs !== st.mtimeMs

export function plan(i: PlanInput): SyncPlan {
  const key = (rel: string) => keyOf(i.os, rel)
  const actions: SyncAction[] = []
  const waiting: SyncNote[] = []
  const big: SyncPlan['big'] = []
  const placedByKey = new Map<string, Placed>()
  for (const p of i.placed.values()) placedByKey.set(key(p.rel), p)
  /** Local files spoken for (a CRM file's place, or a synced file's old place). */
  const claimed = new Set<string>()
  let used = 0
  for (const st of Object.values(i.state.files)) used += st.size

  // The CRM's folders: made here.
  for (const p of i.placed.values()) if (p.isFolder && !i.local.dirs.has(key(p.rel))) actions.push({ kind: 'mkdir-local', rel: p.rel })

  // The CRM's files.
  const backs: Extract<SyncAction, { kind: 'download' }>[] = []
  const comeIn = (p: Placed) => p.size === null || p.size <= i.capBytes || i.kept(p)
  const room = (p: Placed) => p.size === null || used + p.size <= i.quotaBytes
  for (const p of i.placed.values()) {
    if (p.isFolder) continue
    const st = i.state.files[p.id]
    const here = i.local.files.get(key(p.rel))
    if (here) claimed.add(key(p.rel))
    if (st && key(st.rel) !== key(p.rel)) {
      // Moved or renamed in the CRM: the copy here follows it (with any change made here; that goes up after).
      const old = i.local.files.get(key(st.rel))
      claimed.add(key(st.rel))
      if (old && !here) {
        actions.push({ kind: 'move-local', id: p.id, from: st.rel, to: p.rel })
        continue
      }
    }
    if (st && st.version === '' && p.version) {
      // What this PC sent up: the CRM's token for it is taken as synced. When someone else's change came in between (its size differs), it counts as changed in the CRM below.
      if (p.size === null || p.size === st.size) {
        actions.push({ kind: 'adopt', id: p.id, version: p.version })
        continue
      }
    }
    if (!here) {
      if (!comeIn(p)) {
        big.push({ rel: p.rel, size: p.size })
        continue
      }
      if (!room(p)) {
        waiting.push({ rel: p.rel, why: 'Not brought to this PC: the synced files have reached their size limit.' })
        continue
      }
      const d = { kind: 'download' as const, id: p.id, rel: p.rel, size: p.size, why: st ? ('back' as const) : ('new' as const) }
      if (st && key(st.rel) === key(p.rel)) backs.push(d)
      else actions.push(d)
      used += p.size ?? 0
      continue
    }
    if (!st) {
      actions.push({ kind: 'check-local', id: p.id, rel: p.rel, size: p.size })
      continue
    }
    const pcChanged = changedOnPc(here, st)
    const crmChanged = p.version !== null && p.version !== st.version
    if (!pcChanged && !crmChanged) continue
    if (!pcChanged) {
      actions.push({ kind: 'download', id: p.id, rel: p.rel, size: p.size, why: 'changed' })
      continue
    }
    if (i.quiet(here) < i.stableMs || i.busy(here.rel)) {
      waiting.push({ rel: here.rel, why: 'Being edited: it goes up once it is saved and closed.' })
      continue
    }
    if (crmChanged) {
      actions.push({ kind: 'conflict', id: p.id, rel: p.rel, size: p.size })
      continue
    }
    if (!p.canVersion) {
      waiting.push({ rel: here.rel, why: 'This file is read only for you in the CRM: the change stays on this PC.' })
      continue
    }
    actions.push({ kind: 'upload-version', id: p.id, rel: p.rel, size: here.size })
  }

  // Synced files the CRM no longer lists.
  const stateFiles = Object.values(i.state.files)
  const gone = stateFiles.filter(st => !i.placed.has(st.id))
  const listed = [...i.placed.values()].filter(p => !p.isFolder).length
  let suspicious: string | null = null
  if (stateFiles.length > 0 && listed === 0) suspicious = 'The CRM listed no files at all: nothing is taken as removed.'
  else if (gone.length > 20 && gone.length * 2 > stateFiles.length) suspicious = `The CRM's listing is missing ${gone.length} of ${stateFiles.length} synced files at once: nothing is taken as removed.`
  const missing: SyncState['missing'] = {}
  for (const st of gone) {
    claimed.add(key(st.rel))
    const was = i.state.missing[st.id]
    if (suspicious) {
      if (was) missing[st.id] = was
      continue
    }
    const m = { since: was?.since ?? i.now, seen: (was?.seen ?? 0) + 1 }
    if (m.seen >= 2 && i.now - m.since >= i.removeAfterMs) actions.push({ kind: 'removed', id: st.id, rel: st.rel })
    else missing[st.id] = m
  }

  // Synced files missing from their place (deleted, moved or renamed on this PC), by size, for the new files below.
  const vanished = new Map<number, SyncedFile[]>()
  for (const d of backs) {
    const st = i.state.files[d.id]
    const p = i.placed.get(d.id)
    if (!st || !p || p.version !== st.version) continue
    vanished.set(st.size, [...(vanished.get(st.size) ?? []), st])
  }
  const movedAway = new Set<string>()

  // Files made on this PC.
  const needGroups = new Set<string>()
  const projectOf = (rel: string): Placed | null => {
    for (let r = dirOf(rel); r; r = dirOf(r)) {
      const p = placedByKey.get(key(r))
      if (p) return p.isFolder ? p : null
    }
    return null
  }
  for (const [k, lf] of i.local.files) {
    if (claimed.has(k) || placedByKey.has(k)) continue
    if (i.ignored(lf.rel, false)) continue
    if (i.quiet(lf) < i.stableMs || i.busy(lf.rel)) {
      waiting.push({ rel: lf.rel, why: 'Being written: it goes up once it is saved and closed.' })
      continue
    }
    const parent = placedByKey.get(key(dirOf(lf.rel)))
    const same = vanished.get(lf.size)?.find(st => !movedAway.has(st.id))
    if (same) {
      movedAway.add(same.id)
      actions.push({ kind: 'maybe-moved', id: same.id, from: same.rel, to: lf.rel, toParentId: parent?.isFolder ? parent.id : null })
      continue
    }
    if (parent?.isFolder) {
      if (parent.canUpload) actions.push({ kind: 'upload-new', rel: lf.rel, parentId: parent.id, size: lf.size })
      else waiting.push({ rel: lf.rel, why: whyNotHere(parent) })
      continue
    }
    const holder = projectOf(lf.rel)
    waiting.push({ rel: lf.rel, why: holder?.canMkdir ? 'Goes up once its folder is made in the CRM.' : 'Not inside a project you may add to: it stays on this PC.' })
  }

  // The deleted ones come back (his choice 2); a moved or renamed one is settled by its bytes instead.
  for (const d of backs) if (!movedAway.has(d.id)) actions.push(d)

  // Folders made on this PC.
  for (const [k, d] of i.local.dirs) {
    if (placedByKey.has(k) || isReservedTop(d.rel) || i.ignored(d.rel, true)) continue
    const parent = placedByKey.get(key(dirOf(d.rel)))
    if (!parent?.isFolder) continue // inside another folder made here: made after it
    if (!parent.canMkdir) {
      waiting.push({ rel: `${d.rel}/`, why: whyNotHere(parent) })
      continue
    }
    const project = parent.kind === 'project' ? parent.id : parent.project
    if (project && !i.groupsListed.has(project)) {
      needGroups.add(project)
      continue
    }
    if (i.quietDir(d) < i.stableMs) continue // a new folder is often renamed at once
    actions.push({ kind: 'mkdir-remote', rel: d.rel, parentId: parent.id, name: baseOf(d.rel) })
  }

  return { actions, waiting, big, missing, suspicious, needGroups: [...needGroups] }
}

function whyNotHere(folder: Placed): string {
  if (folder.kind === 'category') return 'This folder is the CRM\'s own list (only the CRM adds to it): put the file inside a project to send it up. It stays on this PC.'
  if (folder.id === 'proj:none') return 'Uncategorised is the CRM\'s own: put the file inside a project to send it up. It stays on this PC.'
  return 'This project is read only for you in the CRM: it stays on this PC.'
}

/** The name a conflicted copy gets beside the CRM's: "<name> (conflict, <PC>, 2026-11-14 18.05).<ext>". */
export function conflictName(name: string, pc: string, at: Date): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`
  // eslint-disable-next-line no-control-regex
  const who = pc.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 40) || 'this PC'
  return `${stem} (conflict, ${who}, ${stamp})${ext}`
}
