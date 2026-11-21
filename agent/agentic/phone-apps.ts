import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { PHONE_APPS_PREFIX, downloadPath, type PhoneApp, type PhoneAppBuild, type PhoneAppId } from '../../shared/phone-apps.ts'
import { apiError, type ApiMount } from '../api.ts'
import type { Auth } from '../auth/index.ts'
import { APK_MIME, DEFAULT_OFFER_FILE, createAppUpdate, parseRange, type AppUpdate } from './app-update.ts'
import { requireCrmHuman } from './human-session.ts'

// Order o5dc6 (12 Nov 2026): the PC's side of the Phone app page (shared/phone-apps.ts). Owner only: every route wants a page
// signed in as the owner, through CRM (requireCrmHuman), on top of the API's own gate; a chat's tool key is refused.
//   GET  /agent-api/phone-apps/                      the apps: the build each would send, or why none
//   GET  /agent-api/phone-apps/agentic/<code>.apk    Shubham Agentic: the NEWEST build that passed verify, and only that one
//   GET  /agent-api/phone-apps/chris/<code>.apk      Hey Chris: the build its Update button offers (offer.json), and only that one
// "Verified" for Shubham Agentic: mobile/scripts/agentic.mjs writes a build's record (agentic-<version>-debug.build-info.json, with
// the APK's sha256 and size) only AFTER verify passed; a build that failed verify is never copied to C:\sac\out\agentic. The newest
// record by its build number is the build offered. Nothing older is offered in its place: a newest build whose file is missing
// or no longer matches its record is reported on the page, not skipped. At send time the file is read whole, its sha256 checked
// against the record, and exactly the bytes that were checked are sent. Hey Chris keeps its own rule (app-update.ts): the offered
// file is sent only while its sha256 matches offer.json. A <code> that is not the build offered now is refused (409): the page
// shows a build and the file is that build. Logs: the version and the bytes, nothing else.
//
// Order o5a91 (F-307, 21 Nov 2026): the phone app's OWN Update button. Two more GET routes, for the APK itself:
//   GET  /agent-api/phone-apps/agentic/update              {offered: {versionName, versionCode, bytes, sha256, notes?, offeredAt} | null}
//   GET  /agent-api/phone-apps/agentic/update/<code>.apk   exactly the offered build, GET or HEAD, one Range
// "Offered" is NEVER "the newest build": it is the file offer.json in the Agentic builds folder, written only by
// `node mobile/scripts/offer.mjs --app agentic --sha256 <hex>` for a build that has a verified record (agentic.mjs writes the record only after
// verify passed), served only while its bytes still hash to the offer AND to that record (a PC test build that is not offered is never sent).
// WHO: the Access row 'phone-app' lets these paths through (shared/access.ts: the owner always, a person only when the owner opened the row);
// here a signed-in person is enough (requireCrmHuman, not admin-only), a chat key is 403, nobody signed in is 401. A person without the row
// never gets here (the gate answers first) and the app then shows nothing to update. The owner's list and file above stay as they were
// (admin only, the newest verified build, for the Phone app page).

export const DEFAULT_AGENTIC_DIR = 'C:\\sac\\out\\agentic'
export const AGENTIC_PACKAGE = 'com.shubhamagentic.agentic'
/** The record agentic.mjs writes beside each APK it copies (after verify passed): agentic-<versionName>-debug.build-info.json. */
/** The app's own version name: 0.1.0-<build number> (what agentic.mjs writes and offer.mjs offers). Anything else never becomes part of a file name. */
const VERSION_NAME = /^\d{1,4}\.\d{1,4}\.\d{1,4}-[1-9]\d{0,11}$/
const RECORD_NAME = /^agentic-(\d{1,4}\.\d{1,4}\.\d{1,4}-([1-9]\d{0,11}))-debug\.build-info\.json$/
/** Far above the app's 2.6 MB: a record that names more is not this app's. The file is read whole, hashed, then sent as read. */
export const MAX_AGENTIC_BYTES = 64 * 1024 * 1024
const MAX_RECORD_BYTES = 64 * 1024
const SHA256 = /^[0-9a-f]{64}$/
const DOWNLOAD = /^\/(agentic|chris)\/([1-9]\d{0,11})\.apk$/

const NAMES: Record<PhoneAppId, string> = { agentic: 'Shubham Agentic', chris: 'Hey Chris' }

export interface AgenticRecord {
  build: PhoneAppBuild
  /** The APK's file name, in the record's folder. */
  apk: string
}

/** A build record of Shubham Agentic (its file name and text), or why it is not one. */
export function parseAgenticRecord(name: string, text: string): AgenticRecord | string {
  const m = RECORD_NAME.exec(name)
  if (!m) return `${name} is not a build record`
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return `${name} is not valid JSON`
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${name} is not an object`
  const r = v as Record<string, unknown>
  if (r.app !== AGENTIC_PACKAGE) return `${name} is not a record of ${AGENTIC_PACKAGE}`
  if (r.type !== 'debug') return `${name} is not a debug build`
  if (r.versionName !== m[1]) return `${name} names another version`
  if (r.code !== Number(m[2])) return `${name} names another build number`
  if (typeof r.apkSha256 !== 'string' || !SHA256.test(r.apkSha256)) return `${name} has no whole sha256`
  if (!Number.isSafeInteger(r.bytes) || (r.bytes as number) <= 0 || (r.bytes as number) > MAX_AGENTIC_BYTES) return `${name} has no usable size`
  const apk = `agentic-${m[1]}-debug.apk`
  if (r.apk !== apk) return `${name} names another file`
  const built = typeof r.builtAt === 'string' ? Date.parse(r.builtAt) : Number.NaN
  return {
    build: { versionName: m[1], versionCode: r.code as number, bytes: r.bytes as number, sha256: r.apkSha256, at: Number.isFinite(built) ? new Date(built).toISOString() : null, file: apk },
    apk,
  }
}

const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(file)
    s.on('data', c => h.update(c))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export interface PhoneAppsDeps {
  /** The folder agentic.mjs copies verified builds to: C:\sac\out\agentic (SAD_AGENTIC_APK_DIR for another). */
  agenticDir?: string
  /** Hey Chris's offer (app-update.ts); null leaves Hey Chris out. Left out: offer.json, as the voice mount reads it. */
  chris?: AppUpdate | null
  /** Order o5a91: the Agentic build the phone app's Update button offers (offer.json in agenticDir); null leaves the update routes out. */
  agenticOffer?: AppUpdate | null
  log?: { info(m: string): void; warn(m: string): void }
}

export interface PhoneApps {
  /** Each app with the build it would send now, or why none. */
  list(): Promise<PhoneApp[]>
  /** Sends that app's build `code` (GET or HEAD, one Range) when it is the one offered now; throws an apiError otherwise. */
  serve(id: PhoneAppId, code: number, req: IncomingMessage, res: ServerResponse): Promise<void>
  /** Order o5a91: the Agentic build the phone app's own Update button offers (offer.json + a verified record), or null (and why, in updateReason()). */
  updateOffer(): Promise<AgenticOffer | null>
  /** Why no Agentic update is offered, as a sentence; null while one is. */
  updateReason(): string | null
  /** Sends the offered Agentic build `code` (GET or HEAD, one Range): 409 when `code` is not the one offered now, 404 when none is. */
  serveUpdate(code: number, req: IncomingMessage, res: ServerResponse): Promise<void>
}

/** What the phone app is told about the build it may install (the same fields as Chris's offer). */
export interface AgenticOffer {
  versionName: string
  versionCode: number
  bytes: number
  sha256: string
  notes?: string
  offeredAt: number
}

/** offer.json for Shubham Agentic: in the folder of its verified builds, beside the APK it names. */
export const AGENTIC_OFFER_NAME = 'offer.json'

export function createPhoneApps(deps: PhoneAppsDeps = {}): PhoneApps {
  const dir = deps.agenticDir ?? process.env.SAD_AGENTIC_APK_DIR ?? DEFAULT_AGENTIC_DIR
  const chris = deps.chris === undefined ? createAppUpdate({ file: process.env.SAD_APP_OFFER ?? DEFAULT_OFFER_FILE, log: deps.log }) : deps.chris
  const agenticOffer = deps.agenticOffer === undefined ? createAppUpdate({ file: path.join(dir, AGENTIC_OFFER_NAME), log: deps.log }) : deps.agenticOffer
  let updateWhy: string | null = 'No phone app update is offered.'

  /**
   * The offered Agentic build, only when it is ALSO a verified build: its record (agentic.mjs wrote it after verify passed) exists, is valid and
   * names the same bytes (sha256, size) and the same build number as the offer. createAppUpdate already holds that the file hashes to offer.json.
   */
  async function verifiedOffer(): Promise<AgenticOffer | null> {
    if (!agenticOffer) {
      updateWhy = 'The phone app update is not offered here.'
      return null
    }
    const o = await agenticOffer.offered()
    if (!o) {
      updateWhy = agenticOffer.reason() ?? 'No phone app update is offered.'
      return null
    }
    // The record's file name is built from the offer's version name: only the app's own shape, ending in the offer's own build number, may be part of it.
    if (!VERSION_NAME.test(o.versionName) || !o.versionName.endsWith(`-${o.versionCode}`)) {
      updateWhy = "No update is offered: the offered version name is not this app's shape."
      return null
    }
    const name = `agentic-${o.versionName}-debug.build-info.json`
    let text: string
    try {
      const rf = path.join(dir, name)
      const st = statSync(rf)
      if (!st.isFile() || st.size > MAX_RECORD_BYTES) throw new Error('not a small file')
      text = await readFile(rf, 'utf8')
    } catch {
      updateWhy = `No update is offered: the offered build has no verified record (${name}).`
      return null
    }
    const r = parseAgenticRecord(name, text)
    if (typeof r === 'string') {
      updateWhy = `No update is offered: the offered build's record is not usable (${r}).`
      return null
    }
    if (r.build.sha256 !== o.sha256 || r.build.bytes !== o.bytes || r.build.versionCode !== o.versionCode) {
      deps.log?.warn(`phone-apps: the offered phone app build ${o.versionName} does not match its verified record; not offering it`)
      updateWhy = 'No update is offered: the offered build is not the one its verified record describes.'
      return null
    }
    updateWhy = null
    return { versionName: o.versionName, versionCode: o.versionCode, bytes: o.bytes, sha256: o.sha256, ...(o.notes ? { notes: o.notes } : {}), offeredAt: o.offeredAt }
  }

  /** The sha256 of the newest APK as last hashed for the list, by its path, size and mtime (the send hashes the bytes it sends). */
  let hashed: { key: string; sha256: string } | null = null

  /** The newest build record (by the build number in its name), its APK checked against it; or why nothing is offered. */
  async function newestAgentic(): Promise<{ build: PhoneAppBuild; file: string } | string> {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return 'No Shubham Agentic build on this PC yet.'
    }
    const records = names.flatMap(n => {
      const m = RECORD_NAME.exec(n)
      return m ? [{ name: n, code: Number(m[2]) }] : []
    })
    if (!records.length) return 'No Shubham Agentic build on this PC yet.'
    const newest = records.reduce((a, b) => (b.code > a.code ? b : a))
    const recordFile = path.join(dir, newest.name)
    let text: string
    try {
      const st = statSync(recordFile)
      if (!st.isFile() || st.size > MAX_RECORD_BYTES) return `The newest build's record (${newest.name}) is not a small file, so nothing is offered.`
      text = await readFile(recordFile, 'utf8')
    } catch {
      return `The newest build's record (${newest.name}) could not be read, so nothing is offered.`
    }
    const r = parseAgenticRecord(newest.name, text)
    if (typeof r === 'string') return `The newest build's record is not usable (${r}), so nothing is offered.`
    const file = path.join(dir, r.apk)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(file)
    } catch {
      return `The newest build's file (${r.apk}) is not there, so nothing is offered.`
    }
    if (!st.isFile() || st.size !== r.build.bytes) return `The newest build's file (${r.apk}) is not the size its record says, so nothing is offered.`
    const key = `${file}:${st.size}:${Math.round(st.mtimeMs)}`
    let sha = hashed?.key === key ? hashed.sha256 : null
    if (!sha) {
      try {
        sha = await sha256File(file)
      } catch {
        return `The newest build's file (${r.apk}) could not be read, so nothing is offered.`
      }
      hashed = { key, sha256: sha }
    }
    if (sha !== r.build.sha256) {
      deps.log?.warn(`phone-apps: ${r.apk} no longer matches the sha256 in its record; not offering it`)
      return `The newest build's file (${r.apk}) no longer matches the sha256 in its record, so nothing is offered.`
    }
    return { build: r.build, file }
  }

  function sendBytes(req: IncomingMessage, res: ServerResponse, bytes: Buffer, build: PhoneAppBuild, name: string) {
    const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, bytes.length)
    if (range === 'bad') {
      res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': 0, 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end : bytes.length - 1
    const head: Record<string, string | number> = {
      'Content-Type': APK_MIME,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${build.sha256.slice(0, 32)}"`,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': end - start + 1,
    }
    if (range) head['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`
    res.writeHead(range ? 206 : 200, head)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(bytes.subarray(start, end + 1))
    deps.log?.info(`phone-apps: Shubham Agentic ${build.versionName}, ${end - start + 1} of ${bytes.length} bytes sent`)
  }

  const notNewest = (code: number, versionName: string) => apiError(409, `Build ${code} is not the one offered now (${versionName} is): reload the page and download again.`)

  return {
    async list() {
      const a = await newestAgentic()
      const apps: PhoneApp[] = [
        typeof a === 'string'
          ? { id: 'agentic', name: NAMES.agentic, build: null, why: a, download: null }
          : { id: 'agentic', name: NAMES.agentic, build: a.build, why: null, download: downloadPath('agentic', a.build.versionCode) },
      ]
      if (chris) {
        const o = await chris.offered()
        apps.push(
          o
            ? {
                id: 'chris',
                name: NAMES.chris,
                build: { versionName: o.versionName, versionCode: o.versionCode, bytes: o.bytes, sha256: o.sha256, at: o.offeredAt > 0 ? new Date(o.offeredAt).toISOString() : null, file: null },
                why: null,
                download: downloadPath('chris', o.versionCode),
              }
            : { id: 'chris', name: NAMES.chris, build: null, why: chris.reason() ?? 'No Hey Chris build is offered.', download: null },
        )
      }
      return apps
    },

    async serve(id, code, req, res) {
      if (id === 'chris') {
        if (!chris) throw apiError(404, 'Hey Chris is not offered here.')
        const o = await chris.offered()
        if (!o) throw apiError(404, chris.reason() ?? 'No Hey Chris build is offered.')
        if (o.versionCode !== code) throw notNewest(code, o.versionName)
        await chris.serve(req, res)
        return
      }
      const now = await newestAgentic()
      if (typeof now === 'string') throw apiError(404, now)
      if (now.build.versionCode !== code) throw notNewest(code, now.build.versionName)
      let bytes: Buffer
      try {
        bytes = await readFile(now.file)
      } catch {
        throw apiError(404, `${path.basename(now.file)} could not be read.`)
      }
      // The check that counts: the very bytes about to be sent against the record (the list's hash may be a moment old).
      if (bytes.length !== now.build.bytes || sha256Of(bytes) !== now.build.sha256) {
        deps.log?.warn(`phone-apps: ${path.basename(now.file)} changed after its record was written; not sending it`)
        throw apiError(409, `${path.basename(now.file)} no longer matches its build record, so it is not sent.`)
      }
      sendBytes(req, res, bytes, now.build, path.basename(now.file))
    },

    updateOffer: verifiedOffer,
    updateReason: () => updateWhy,

    async serveUpdate(code, req, res) {
      const o = await verifiedOffer()
      if (!o || !agenticOffer) throw apiError(404, updateWhy ?? 'No phone app update is offered.')
      if (o.versionCode !== code) throw apiError(409, `Build ${code} is not the one offered now (${o.versionName} is): ask again.`)
      await agenticOffer.serve(req, res)
    },
  }
}

const UPDATE_DOWNLOAD = /^\/agentic\/update\/([1-9]\d{0,11})\.apk$/

/**
 * The mount. The list and the owner's files: owner only, signed in through CRM. Order o5a91: the two update routes (the offered build's
 * version check and file) take any signed-in person the Access row 'phone-app' lets through (the gate is before this), never a chat key.
 */
export function createPhoneAppsMount(deps: PhoneAppsDeps & { auth?: Auth } = {}): ApiMount {
  const apps = createPhoneApps(deps)
  return {
    prefix: PHONE_APPS_PREFIX,
    async http(request) {
      if (request.rest === '/agentic/update') {
        requireCrmHuman(deps.auth, request, false)
        if (request.method !== 'GET') throw apiError(405, 'The update check is read only')
        return { offered: await apps.updateOffer() }
      }
      requireCrmHuman(deps.auth, request, true)
      if (request.rest !== '/' && request.rest !== '') throw apiError(404, 'No such phone app route')
      if (request.method !== 'GET') throw apiError(405, 'The phone apps list is read only')
      return { apps: await apps.list() }
    },
    raw(rest) {
      const u = UPDATE_DOWNLOAD.exec(rest)
      if (u) {
        const code = Number(u[1])
        return async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') throw apiError(405, 'Only GET or HEAD here')
          requireCrmHuman(deps.auth, { headers: req.headers }, false)
          await apps.serveUpdate(code, req, res)
        }
      }
      const m = DOWNLOAD.exec(rest)
      if (!m) return null
      const id = m[1] as PhoneAppId
      const code = Number(m[2])
      return async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw apiError(405, 'Only GET or HEAD here')
        requireCrmHuman(deps.auth, { headers: req.headers }, true)
        await apps.serve(id, code, req, res)
      }
    },
  }
}
