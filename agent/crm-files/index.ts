import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ApiMount } from '../api.ts'
import type { IncomingHttpHeaders } from 'node:http'
import { crmLoginOf, type CrmProxy } from '../agentic/crmproxy.ts'
import type { CrmSession } from '../claude/crm.ts'
import { createWinMount } from './mount-win.ts'
import { crmFilesMount, type CrmFilesStaff } from './routes.ts'
import { createCrmFiles, downloadViaFile, marketingFolderFile, type CrmClient, type CrmFilesService, type MountDriver } from './service.ts'
import { CRM_FILES_MAX_UPLOAD } from '../../shared/crm-files.ts'
import { UPLOAD_SETTINGS_FILE } from './upload-settings.ts'
import { createCrmUploads, type CrmUploads } from './uploads.ts'
import { createPinsHost, type PinsHost } from './pins-host.ts'
import { createLocalSync, type LocalSync } from './local-sync.ts'
import { createByteCache } from './byte-cache.ts'

// F-126: the CRM files module of the agent: the tree and its changes (service.ts), the page's routes (routes.ts), and the mount of this PC. On Windows the mount is crm-fs.exe through
// WinFsp (mount-win.ts); on Linux the Linux agent brings its own driver (a loopback WebDAV that GNOME's gvfs mounts) and passes it in as `mountDriver`; anywhere else it says it is not
// supported. The Linux part calls `service` directly, in the same process, so no token is handled at all.

export interface CrmFilesModule {
  service: CrmFilesService
  /** od0b1: uploads of any size in parts, held by the agent (their pending folder is <dir>/crm-uploads). */
  uploads: CrmUploads
  /** oe86a: this PC's synced CRM folder (local-sync.ts). */
  sync: LocalSync
  mount: ApiMount
  /** At the agent's start: brings the Windows drive back if it was on. */
  resume(): Promise<void>
  close(): Promise<void>
}

export interface CrmFilesModuleOptions {
  /** The agent's state folder (crm-drive.json goes here). */
  dir: string
  proxy: CrmProxy
  /** The folder this agent runs from (the repo in Dev, the build when published): crm-fs.exe is under crm-fs/. */
  root: string
  /**
   * Bring the Windows drive up by itself at the agent's start (and keep watching the CRM sign-in). Default: yes, EXCEPT inside a test run (node's test runner sets NODE_TEST_CONTEXT): a test
   * that signs a fake CRM in must never mount a REAL drive on this PC (the in-app drive would take the letter). A test of the drive itself passes true and a spare letter.
   */
  autoStart?: boolean
  /** Another PC's driver (Linux). Left out on Windows: the WinFsp one is used. */
  mountDriver?: MountDriver & { resume?(): Promise<void>; close?(): Promise<void> }
  log?: { info(m: string): void; warn(m: string): void }
  /** Order oc186 (slice 2): a signed-in person's own CRM session from their request (agent/auth viewerCrm); left out, nobody but the owner gets the CRM files. */
  viewerSession?: (headers: IncomingHttpHeaders) => CrmSession | null
}

/** Order oc186: how many people's CRM file services are kept at once (the least recently used goes first). */
const STAFF_SERVICES = 16

/** crm-fs.exe: next to the build (crm-fs/crm-fs.exe), or where a Dev build puts it. */
export function hostExe(root: string): string {
  const inBuild = path.join(root, 'crm-fs', 'crm-fs.exe')
  return existsSync(inBuild) ? inBuild : path.join(root, 'crm-fs', 'bin', 'Release', 'net48', 'crm-fs.exe')
}

/** The checksum the build recorded for the host (RELEASE.json "crmFsSha256"), or undefined. */
export function hostSha256(root: string): string | undefined {
  try {
    const v = (JSON.parse(readFileSync(path.join(root, 'RELEASE.json'), 'utf8')) as { crmFsSha256?: unknown }).crmFsSha256
    return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** o4fb7: this file in the agent's state folder turns the bytes cache off (every read goes to the CRM, the way before). */
export const BYTES_CACHE_OFF_FILE = 'crm-cache.off'
const BYTES_CACHE_SETTINGS = 'crm-cache.json'
const BYTES_CACHE_DEFAULT_GB = 5

/** o4fb7: the bytes cache's limit (crm-cache.json {"maxGb": n}, 5 GB when there is none), read each time it is needed. */
export function bytesCacheMaxBytes(dir: string): number {
  try {
    const gb = (JSON.parse(readFileSync(path.join(dir, BYTES_CACHE_SETTINGS), 'utf8')) as { maxGb?: unknown }).maxGb
    if (typeof gb === 'number' && Number.isFinite(gb) && gb > 0) return Math.round(gb * 1024 * 1024 * 1024)
  } catch {
    // none: the default
  }
  return BYTES_CACHE_DEFAULT_GB * 1024 * 1024 * 1024
}

/** S5: the PC's file manager on a folder (the spool's), where this PC has one. */
function openFolderHere(dir: string) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'linux' ? 'xdg-open' : null
  if (!cmd) throw new Error('This PC cannot open a folder from here.')
  const c = spawn(cmd, [dir], { detached: true, stdio: 'ignore' })
  c.on('error', () => undefined)
  c.unref()
}

export function createCrmFilesModule(o: CrmFilesModuleOptions): CrmFilesModule {
  const client = {
    request: o.proxy.request.bind(o.proxy),
    session: () => {
      const s = o.proxy.session()
      return { signedIn: s.signedIn, name: s.name, username: s.username }
    },
  }
  // o6e65: the built-in WebDAV way serves the same service the page uses (made just below).
  let serviceRef: CrmFilesService | null = null
  const win =
    !o.mountDriver && process.platform === 'win32'
      ? createWinMount({
          exe: hostExe(o.root),
          exeSha256: hostSha256(o.root),
          dir: o.dir,
          signedIn: () => client.session().signedIn,
          service: () => serviceRef,
          bridge: { client, forward: (req, res, sub, search) => o.proxy.handle(req, res, sub, search) },
          log: o.log,
        })
      : null
  const driver = o.mountDriver ?? win ?? undefined
  // oa2f8: the size limit is the uploads' setting (the CRM's own where it said it); the one-request upload and the drive's saves follow it too.
  let uploadsRef: CrmUploads | null = null
  // o813f: a file in Google Drive is downloaded through Google's Drive API; the file crm-download-via-crm.on in this folder sends every download through the CRM's own (the old way).
  // ocbbf: "Keep on this PC" (pins-host.ts): its copies live in <state>/crm-pins; it is made after the service, which reaches it through this getter.
  let pinsRef: PinsHost | null = null
  // o4fb7: the files' bytes kept on this PC (<state>/crm-cache, 5 GB unless crm-cache.json says {"maxGb": n}): a file opened again comes from the disk, and the in-app drive's
  // ranges come from one download. The old way (every read to the CRM) is kept: the file crm-cache.off in this folder, read at the agent's start.
  const bytes = existsSync(path.join(o.dir, BYTES_CACHE_OFF_FILE)) ? null : createByteCache({ dir: path.join(o.dir, 'crm-cache'), maxBytes: () => bytesCacheMaxBytes(o.dir), log: o.log })
  const service = createCrmFiles({ client, mountDriver: driver, spoolDir: path.join(o.dir, 'crm-spool'), openFolder: openFolderHere, log: o.log, maxUpload: () => uploadsRef?.maxSize() ?? CRM_FILES_MAX_UPLOAD, downloadVia: downloadViaFile(o.dir), pins: () => pinsRef, marketingFolder: marketingFolderFile(o.dir), bytes, sizesFile: path.join(o.dir, 'crm-sizes.json') })
  serviceRef = service
  const pins = createPinsHost({ dir: path.join(o.dir, 'crm-pins'), tree: () => service.pinTree(), fetchBytes: (id, start, length) => service.fileBytes(id, start, length), log: o.log })
  pinsRef = pins
  // oa2f8: the waiting folder is a setting (crm-uploads.json beside the default one); it may not be inside the app's own folder (an update replaces it).
  const uploads = createCrmUploads({ dir: path.join(o.dir, 'crm-uploads'), settingsFile: path.join(o.dir, UPLOAD_SETTINGS_FILE), notInside: [o.root], backend: service.uploadBackend, log: o.log })
  uploadsRef = uploads
  // oe86a: the CRM files as a plain folder on this PC (%USERPROFILE%\CRM Files, ~/CRM-Drive), kept in step both ways while the agent runs; beside the mounted drive, not instead of it.
  const sync = createLocalSync({ dir: o.dir, service: () => serviceRef, signedIn: () => client.session().signedIn, keep: () => pinsRef, openFolder: openFolderHere, log: o.log })
  // Order oc186 (slice 2): a signed-in person who is not the owner reads and changes the CRM files with THEIR OWN CRM session, so the CRM decides what they see.
  // Each person gets a service of their own (its listing caches are theirs alone); the PC's local things (the drive, the spool, the copies kept here, the uploads, the synced folder) stay the owner's.
  const staffs = new Map<string, { cookie: string; service: CrmFilesService }>()
  const staff: CrmFilesStaff = {
    serviceFor(caller, headers) {
      const person = caller.person
      const session = person && o.viewerSession ? o.viewerSession(headers) : null
      if (!person || !session) return null
      const key = person.id.toLowerCase()
      const hit = staffs.get(key)
      if (hit && hit.cookie === session.cookie) return hit.service
      const login = crmLoginOf(session)
      const client: CrmClient = {
        request: (method, sub, init) => o.proxy.requestAs(login, method, sub, init),
        session: () => ({ signedIn: true, name: login.name, username: login.username }),
      }
      const made = createCrmFiles({ client, log: o.log, maxUpload: () => uploadsRef?.maxSize() ?? CRM_FILES_MAX_UPLOAD, downloadVia: downloadViaFile(o.dir) })
      staffs.delete(key)
      if (staffs.size >= STAFF_SERVICES) staffs.delete(staffs.keys().next().value!)
      staffs.set(key, { cookie: session.cookie, service: made })
      return made
    },
  }
  return {
    service,
    uploads,
    sync,
    mount: crmFilesMount(service, uploads, sync, staff),
    resume: async () => {
      // The uploads that were going on when the agent stopped carry on, side by side with the drive coming back (neither waits for, or stops, the other).
      // They start in a test run too (their folder is the test's own); only the drive keeps S9a's rule of never mounting by itself there.
      const going = uploads.start().catch(e => o.log?.warn(`uploads: the pending folder could not be read (${e instanceof Error ? e.message : String(e)})`))
      // ocbbf: the copies kept on this PC carry on (their store is read; the downloads go on by themselves).
      void pins.start().catch(e => o.log?.warn(`pins: the copies kept on this PC could not be read (${e instanceof Error ? e.message : String(e)})`))
      try {
        if (o.autoStart === false || (o.autoStart === undefined && process.env.NODE_TEST_CONTEXT)) return
        // oe86a: the synced folder comes up by itself (never in a test run: it is this PC's real home folder), side by side with the drive.
        void sync.start().catch(e => o.log?.warn(`crm sync: could not start (${e instanceof Error ? e.message : String(e)})`))
        await (win ?? o.mountDriver)?.resume?.()
      } finally {
        await going
      }
    },
    close: async () => {
      // S9a4 (Lead): the drive's own close is STARTED first (synchronously) and waited for last. Its first act, on Windows, is to remove the in-app drive's marker; the uploads and the spool
      // below can wait for a part or a send still in flight, and the agent may exit before they are done, and a marker left behind is read at the next start as a crash that switches the drive off.
      const driveClosing = (async () => (win ?? o.mountDriver)?.close?.())()
      driveClosing.catch(() => undefined)
      await sync.close().catch(() => undefined)
      await uploads.close().catch(() => undefined)
      await pins.close().catch(() => undefined)
      await service.spool?.close().catch(() => undefined)
      await driveClosing
      // o4fb7: last, once the drive no longer reads from it: the bytes cache writes its index now (and nothing after).
      bytes?.close()
    },
  }
}
