import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Role } from '../shared/agent-api.ts'
import { UPDATE_EXIT_CODE, type BuildInfo, type BuildVersion, type PublishRequest } from '../shared/build.ts'
import { apiError, type ApiMount, type MountRequest } from './api.ts'
import { authError } from './auth/types.ts'
import type { Logger } from './log.ts'
import { cleanPublishActor, maySkipTests, PUBLISH_READY, publishActor, publishDecision, publishRequest, samePublishAudit, type PublishDecision } from './publish-policy.ts'
import { beginPublishRecord, finishPublishRecord, publishHistory } from './publish-history.ts'

// F-020: what this PC runs, and getting a newer one (shared/build.ts).
//   which     a build (RELEASE.json in the folder it runs from) or Dev (no RELEASE.json)
//   updates   a build that is a clone of the build repo looks on GitHub (git fetch) at start, every
//             15 minutes and on Check now; Update exits with UPDATE_EXIT_CODE, and Start.cmd, which
//             it must have been started by (SAD_SUPERVISED=1), pulls the new build and starts it
//   publish   on the hub, when Dev is there: runs Dev's own agent/scripts/publish.ts, which checks,
//             builds, tries and pushes a build, and keeps its lines for the page. Only one at a time.
// Mounted on the local API at /build (api.ts ApiMount), with the app token like the rest.

const CHECK_EVERY_MS = 15 * 60 * 1000
const FIRST_CHECK_MS = 30 * 1000
const LOG_LINES = 400
/** A line of a publish's output that stays however long the log gets: a step's heading ("== Checking: types", the checks' summary), the outcome. */
const KEY_LINE = /^(==|Done\b|Publish stopped)/
const GIT_TIMEOUT_MS = 60 * 1000
const PUBLISHED_MARK = 'PUBLISHED '
/** obcbd: what any caller but the owner's own page hears when it asks to skip the checks. */
const SKIP_REFUSED = 'Skip tests and publish is the owner’s own choice, made by hand on the Build page. This channel can only Test and publish.'
const DEV_EVERY_MS = 20_000

export type Git = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>

export const runGit: Git = (args, cwd) =>
  new Promise(resolve => {
    execFile('git', args, { cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

/**
 * The page's copy of a publish's output, held to `max` lines. A test run prints a line of dots for every
 * few tests, which used to push the step headings out of a 400-line window (build 2325 looked as if its
 * checks had been skipped), so what goes first is the oldest plain line, never a key line (KEY_LINE);
 * only when key lines alone are over the cap do the oldest of those go too.
 */
export function trimLog(log: string[], max = LOG_LINES): string[] {
  let extra = log.length - max
  if (extra <= 0) return log
  const kept = log.filter(line => {
    if (extra > 0 && !KEY_LINE.test(line)) {
      extra--
      return false
    }
    return true
  })
  return kept.length > max ? kept.slice(kept.length - max) : kept
}

/** "748 tests" from the test runner's spec summary ("ℹ pass 748"; it colours even a file), or null when there is none. */
export function testCountOf(summary: string): string | null {
  // oxlint-disable-next-line no-control-regex
  const plain = summary.replace(/\u001b\[[0-9;]*m/g, '')
  const pass = /^\S+ pass (\d+)\s*$/m.exec(plain)?.[1]
  return pass ? `${pass} tests` : null
}

/** F-075: what the update needs to know of the chat host that runs now. */
export interface ChatHostGate {
  protocol: number
  version: number
  /** Chats that are in the middle of something (running or asking). */
  busy(): number
  /** Lets go of the host's chats for good: they are written to the open-chats list, then ended, and come back resumed after the update. */
  retire(): Promise<void>
}

/**
 * Order o7e6d S1 (Lead's GO for the Update guard): what holds an Update on this PC now, read only. Each string is one reason, in words; an empty
 * list: nothing holds it. It only answers: it never clears, changes, bypasses or retries anything, and it starts nothing.
 */
export interface UpdateGuard {
  blockers(): string[]
}

export interface BuildOptions {
  /** The folder this agent runs from (the repo or build root). */
  root: string
  /** Dev's folder on this PC, when it has one; Publish is offered only there, and only on the hub. */
  devDir: string | null
  role: () => Role
  log?: Logger
  /** Exit with this code (the entry's shutdown). */
  restart: (code: number) => void
  /** Started by Start.cmd, which updates and restarts it (SAD_SUPERVISED=1). */
  supervised: boolean
  /** Tests: a fake git, and the command publish runs. */
  git?: Git
  publishCommand?: (devDir: string, req: PublishRequest) => { file: string; args: string[] }
  /** Durable receipts; main supplies the state folder, never the source checkout. */
  publishHistoryDir?: string
  /** F-075: set once the agent runs its chats in the chat host. */
  chatHostGate?: { current: ChatHostGate | null }
  /**
   * Order o7e6d S1: asked when an Update is pressed (or the automatic one commits), before anything else it does, and again at each later step
   * before anything more is cut: at each look of its wait for busy chats, after the automatic update's quiet wait, right before the chat host
   * is retired, right after, and right before the restart. Supplied (main.ts supplies it from the start), a holder whose `current` is still null
   * holds every Update ('the update guard is not ready'); left out (a caller that does not integrate it), nothing is asked, as before.
   */
  updateGuard?: { current: UpdateGuard | null }
  /** Tests: how long an update waits for idle chats before it asks (10 min), and how often it looks (5 s). */
  hostWaitMs?: number
  hostPollMs?: number
  /**
   * F-173a: who may press Update (POST /update) and cancel it (POST /update-cancel) from a route. main.ts passes F-119's rule
   * (auth/types.ts mayPublish): a PAGE (a browser, remote or local) needs a signed-in administrator; a program on the Server with
   * the local machine token and no page headers is as before (Lead presses Update that way on the person's typed words). That is
   * NOT Publish's rule any more: obcbd narrowed Publish to the owner signed in or the machine-token channel (publish-policy.ts
   * publishActor), so an administrator who is not the owner may press Update from a page but may not publish.
   * Required and without a default, so a build made without it does not compile. The AUTOMATIC update never goes through this route:
   * it spends a permit (commitUpdate) that only the coordinator in this process can make.
   */
  authorizeUpdate: (r: MountRequest) => void
  /** F-173a: the automatic update hears the Cancel button, and holds the build it was about to apply. */
  onUpdateCancel?: () => void
}

/** F-173a: the right to start ONE update. Made by `issuePermit`, spent by `commitUpdate`; it names the build it is for and lasts 15 s. */
export interface UpdatePermit {
  readonly id: string
  /** The build version it was issued for ('' when none is known: only an administrator's press may be for that). */
  readonly to: string
  readonly via: 'admin' | 'auto'
}

/**
 * F-173a: how an AUTOMATIC update stays honest between the last look and the restart. `quiet()` is read synchronously and returns why the
 * app is not quiet any more (null = still quiet): a send that is pending, a chat that became busy, a draft, an open order. The restart
 * waits for it to clear for at most `waitMs` instead of cutting; if it does not, nothing is restarted and `onAbort` hears why.
 */
export interface UpdateHold {
  quiet(): string | null
  onAbort(reason: string): void
  /** Default 15 s. */
  waitMs?: number
  /** Default 250 ms. */
  pollMs?: number
}

export interface Build {
  mount: ApiMount
  info(): BuildInfo
  check(): Promise<BuildInfo>
  close(): void
  /** F154: typed target-local update; no force/body accepted. */
  requestUpdate(): BuildInfo & { restarting: boolean }
  busy(): number
  /** F-173a: a permit to start one update (for the build that is available now when `to` is given). */
  issuePermit(via: UpdatePermit['via'], to: string): UpdatePermit
  /**
   * F-173a: starts the update a permit stands for, once. An automatic one never forces: it is refused (409) while any chat of this
   * PC is busy; with a `hold` it looks once more right before it cuts anything and waits (bounded) for the app to be quiet instead of
   * cutting, and when the chat host has to be retired it only restarts if that worked.
   */
  commitUpdate(permit: UpdatePermit, hold?: UpdateHold): BuildInfo & { restarting: boolean }
}

const PERMIT_MS = 15_000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A RELEASE.json's contents, checked; null when it isn't one. */
export function parseVersion(text: string): BuildVersion | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(v) || typeof v.version !== 'string' || typeof v.builtAt !== 'string') return null
  let publishAudit: BuildVersion['publishAudit']
  if (isObject(v.publishAudit) && (v.publishAudit.checks === 'full' || v.publishAudit.checks === 'skip') && typeof v.publishAudit.at === 'string' && Number.isFinite(Date.parse(v.publishAudit.at))) {
    try { publishAudit = { checks: v.publishAudit.checks, at: v.publishAudit.at, by: cleanPublishActor(v.publishAudit.by) } } catch { /* Malformed audit is not proof of checks. */ }
  }
  return {
    version: v.version,
    commit: typeof v.commit === 'string' ? v.commit : null,
    dirty: v.dirty === true,
    builtAt: v.builtAt,
    devHash: typeof v.devHash === 'string' ? v.devHash : null,
    ...(publishAudit ? { publishAudit } : {}),
    // F-075: only when the build says so (builds from before it have no such field).
    ...(isObject(v.chatHost) && typeof v.chatHost.protocol === 'number' && typeof v.chatHost.version === 'number' ? { chatHost: { protocol: v.chatHost.protocol, version: v.chatHost.version } } : {}),
  }
}

/**
 * F-026: Dev's files as a fingerprint: its commit, every change to tracked files and every new
 * file not ignored. Publish records it in the build; the same fingerprint now means nothing new.
 */
export async function devFingerprint(dir: string, git: Git = runGit, also: string[] = []): Promise<string | null> {
  const h = createHash('sha256')
  if (!(await addRepo(h, dir, git))) return null
  // F-054: the page is built from other folders too (the CRM's source); a change there is something
  // new as well. One that isn't a git folder (or isn't there) adds nothing.
  for (const other of also) {
    const part = createHash('sha256')
    if (await addRepo(part, other, git)) h.update(`\0also ${path.basename(other)}\0`).update(part.digest())
  }
  return h.digest('hex').slice(0, 20)
}

/** A git folder's commit, changes to tracked files and new files, added to a hash; false when git can't say. */
async function addRepo(h: ReturnType<typeof createHash>, dir: string, git: Git): Promise<boolean> {
  const [head, diff, others] = await Promise.all([git(['rev-parse', 'HEAD'], dir), git(['diff', 'HEAD', '--binary'], dir), git(['ls-files', '--others', '--exclude-standard', '-z'], dir)])
  if (head.code !== 0 || diff.code !== 0 || others.code !== 0) return false
  h.update(head.stdout.trim()).update('\0').update(diff.stdout)
  for (const f of others.stdout.split('\0').filter(Boolean).sort()) {
    h.update(`\0${f}\0`)
    try {
      h.update(readFileSync(path.join(dir, f)))
    } catch {
      // Gone since it was listed.
    }
  }
  return true
}

/**
 * F-054: the CRM's source, which the page is compiled with (crm-host/vite-plugin.ts): the sam-crm-fe
 * checkout beside Dev's folder, read in place and never copied or changed, or where SAD_CRM_SRC says.
 * Empty when it isn't there. The build repo never has it: it gets only what was compiled.
 */
export function crmSourceDirs(devDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = path.resolve(env.SAD_CRM_SRC || path.join(devDir, '..', '..', 'sam-crm-fe', 'src'))
  return existsSync(path.join(dir, 'app')) ? [dir] : []
}

/** Dev beside a build: the sibling shubham-agentic-dev folder, or the folder itself when it is Dev. */
export function findDevDir(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const given = env.SAD_DEV_DIR
  if (given) return existsSync(path.join(given, 'agent', 'scripts', 'publish.ts')) ? path.resolve(given) : null
  for (const dir of [root, path.join(path.dirname(root), 'shubham-agentic-dev')]) {
    if (existsSync(path.join(dir, 'agent', 'scripts', 'publish.ts'))) return path.resolve(dir)
  }
  return null
}

export function createBuild(o: BuildOptions): Build {
  const git = o.git ?? runGit
  const log = o.log
  const historyDir = o.publishHistoryDir ?? path.join(o.root, '.publish-history')
  const releaseFile = path.join(o.root, 'RELEASE.json')
  const current = existsSync(releaseFile) ? parseVersion(readFileSync(releaseFile, 'utf8')) : null
  const kind: BuildInfo['kind'] = current ? 'build' : 'dev'
  const isClone = existsSync(path.join(o.root, '.git'))
  const cannot =
    kind !== 'build'
      ? 'This is Dev, run from its source: it is updated with git, not here.'
      : !isClone
        ? 'This build is not a clone of the build repo, so it has nowhere to pull from.'
        : !o.supervised
          ? 'This build was not started by its Start.cmd, so it cannot start itself again: run Update.cmd, then Start.cmd.'
          : null

  const update: BuildInfo['update'] = { state: 'unknown', available: null, checkedAt: null, error: null, can: cannot === null, cannot, hostWait: null }
  const publish: NonNullable<BuildInfo['publish']> | null = o.devDir
    ? { devDir: o.devDir, devCommit: null, devChanges: 0, pending: null, newest: null, state: 'idle', startedAt: null, endedAt: null, log: [], published: null, error: null }
    : null
  let running: ChildProcess | null = null
  /** F-075: Update is waiting for the chats to be idle because the chat host changes with it. */
  let hostWait: { since: number; ask: boolean } | null = null
  let hostTimer: NodeJS.Timeout | null = null
  let checking: Promise<BuildInfo> | null = null

  const info = (): BuildInfo => ({
    kind,
    root: o.root,
    current,
    update: { ...update, hostWait: hostWait ? { since: new Date(hostWait.since).toISOString(), busy: o.chatHostGate?.current?.busy() ?? 0, ask: hostWait.ask } : null },
    publish: publish && o.role() === 'hub' ? { ...publish, ...pendingNow(), log: [...publish.log], history: publishHistory(historyDir) } : null,
  })

  /** Dev against the newest build: published since (the last publish, or one on GitHub), or this one. */
  let devHash: string | null = null
  function pendingNow(): { pending: boolean | null; newest: string | null } {
    const newest = publish?.published ?? update.available ?? current
    if (!newest) return { pending: null, newest: null }
    return { pending: newest.devHash && devHash ? newest.devHash !== devHash : null, newest: newest.version }
  }

  async function devStatus() {
    if (!publish) return
    const [head, status] = await Promise.all([git(['rev-parse', '--short', 'HEAD'], publish.devDir), git(['status', '--porcelain'], publish.devDir)])
    publish.devCommit = head.code === 0 ? head.stdout.trim() : null
    publish.devChanges = status.code === 0 ? status.stdout.split('\n').filter(l => l.trim()).length : 0
    devHash = await devFingerprint(publish.devDir, git, crmSourceDirs(publish.devDir))
  }

  async function checkNow(): Promise<BuildInfo> {
    void devStatus().catch(() => {})
    if (kind !== 'build' || !isClone) return info()
    update.state = 'checking'
    const fetched = await git(['fetch', '--quiet', 'origin', 'main'], o.root)
    update.checkedAt = new Date().toISOString()
    if (fetched.code !== 0) {
      update.state = 'failed'
      update.error = `Couldn't reach the build repo: ${fetched.stderr.trim().split('\n').at(-1) || `git fetch exited ${fetched.code}`}`
      return info()
    }
    const [head, remote, shown] = await Promise.all([git(['rev-parse', 'HEAD'], o.root), git(['rev-parse', 'origin/main'], o.root), git(['show', 'origin/main:RELEASE.json'], o.root)])
    const headCommit = head.code === 0 ? head.stdout.trim() : ''
    const remoteCommit = remote.code === 0 ? remote.stdout.trim() : ''
    if (!headCommit || !remoteCommit) {
      // Order oeb87: never "up to date" on a guess (two failed reads used to compare equal).
      update.state = 'failed'
      update.error = `Couldn't read this build's git folder: ${(head.code !== 0 ? head : remote).stderr.trim().split('\n').at(-1) || 'git rev-parse gave nothing'}`
      return info()
    }
    update.error = null
    const newest = shown.code === 0 ? parseVersion(shown.stdout) : null
    // Order oeb87: the folder can already hold the newest build while this app still runs an older one: on Ravi_Scyramp it was pulled
    // by hand (17:29, 14 Nov) and never restarted, so this said "up to date" for a PC on 2127 with 1707 published. That is an update
    // too: Update restarts the app (Update.cmd's pull is then a no-op) and it runs the build its folder holds.
    const behind = newest !== null && current !== null && newest.version !== current.version
    if (headCommit === remoteCommit && !behind) {
      update.state = 'up-to-date'
      update.available = null
      return info()
    }
    update.available = newest
    update.state = 'available'
    log?.info(
      headCommit === remoteCommit
        ? `the newest build, ${newest?.version}, is already in this folder but this app still runs ${current?.version}: Update restarts it onto it`
        : `a newer build is published: ${newest?.version ?? remoteCommit.slice(0, 7)}`,
    )
    return info()
  }

  function check(): Promise<BuildInfo> {
    checking ??= checkNow().finally(() => {
      checking = null
    })
    return checking
  }

  function startPublish(req: PublishRequest, actor: NonNullable<ReturnType<typeof publishActor>>) {
    if (!publish || o.role() !== 'hub') throw apiError(404, 'Publishing is done on the hub, from Dev')
    if (publish.state === 'running') throw apiError(409, 'A publish is already running')
    // obcbd: skipping every check is human-only (the owner's own page, by hand); the machine channel only tests and publishes.
    if (req.checks === 'skip' && !maySkipTests(actor)) throw authError(403, SKIP_REFUSED, 'admin-only')
    // Fail closed BEFORE spawning if the decision cannot be recorded.
    const attempt = beginPublishRecord(historyDir, req.checks ?? 'full', actor)
    let decision: PublishDecision
    try {
      decision = publishDecision(req, actor, historyDir, attempt.id)
    } catch (e) {
      finishPublishRecord(historyDir, attempt.id, 'failed', null, e instanceof Error ? e.message : String(e))
      throw e
    }
    // No option on its command line says how to publish: the decision goes over the process's own control channel (below).
    const cmd = o.publishCommand?.(publish.devDir, req) ?? { file: process.execPath, args: ['agent/scripts/publish.ts'] }
    Object.assign(publish, { state: 'running', startedAt: new Date().toISOString(), endedAt: null, log: [], error: null })
    log?.info(`publishing a build from ${publish.devDir}`)
    let child: ChildProcess
    try {
      child = running = spawn(cmd.file, cmd.args, { cwd: publish.devDir, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    } catch (e) {
      finishPublishRecord(historyDir, attempt.id, 'failed', null, e instanceof Error ? e.message : String(e))
      publish.state = 'failed'
      publish.error = 'The publish process could not start.'
      throw e
    }
    // It says it is listening first (a message sent before that would be lost), then gets this attempt's decision, once.
    let handed = false
    child.on('message', m => {
      if (handed || !isObject(m) || m.t !== PUBLISH_READY) return
      handed = true
      child.send(decision, e => {
        if (e) log?.warn(`the publish decision could not be handed to its process: ${e.message}`)
      })
    })
    let published: BuildVersion | null = null
    const line = (raw: string) => {
      // Plain text for the page: tools colour their output even when asked not to.
      // oxlint-disable-next-line no-control-regex
      const text = raw.replace(/\u001b\[[0-9;]*m/g, '')
      if (!text.trim()) return
      if (text.startsWith(PUBLISHED_MARK)) {
        published = parseVersion(text.slice(PUBLISHED_MARK.length))
        return
      }
      publish.log.push(text)
      if (publish.log.length > LOG_LINES) publish.log.splice(0, publish.log.length, ...trimLog(publish.log))
    }
    const streams = [new StringDecoder('utf8'), new StringDecoder('utf8')]
    const pending = ['', '']
    const take = (which: number, chunk: Buffer) => {
      pending[which] += streams[which].write(chunk)
      const parts = pending[which].split(/\r?\n/)
      pending[which] = parts.pop() ?? ''
      for (const part of parts) line(part)
    }
    child.stdout?.on('data', chunk => take(0, chunk as Buffer))
    child.stderr?.on('data', chunk => take(1, chunk as Buffer))
    child.on('error', e => {
      publish.log.push(e.message)
    })
    child.on('close', code => {
      for (let i = 0; i < streams.length; i++) line(pending[i] + streams[i].end())
      if (published && req.checks === 'skip' && !samePublishAudit(published.publishAudit, attempt.audit)) {
        code = 1
        publish.log.push('The published marker does not carry this attempt’s skipped-checks audit. Inspect the artifact before claiming success.')
      }
      running = null
      publish.endedAt = new Date().toISOString()
      if (code === 0) {
        publish.state = 'done'
        if (published) publish.published = published
        log?.info(`published ${published?.version ?? 'a build'}`)
        // This PC sees it too: Update brings the server onto it.
        void check()
      } else {
        publish.state = 'failed'
        publish.error = publish.log.at(-1) ?? `The publish exited ${code}`
        log?.warn(`publish failed: ${publish.error}`)
      }
      try { finishPublishRecord(historyDir, attempt.id, code === 0 ? (published ? 'published' : 'unchanged') : 'failed', published?.version ?? null, publish.error) }
      catch (e) {
        publish.state = 'failed'
        publish.error = 'The publish finished, but its audit receipt could not be updated: ' + (e instanceof Error ? e.message : String(e))
        log?.warn(publish.error)
      }
    })
    return info()
  }

  /** Does the host that runs differ from the one the newer build ships? (A build without one is a change too: it could not take the chats over.) */
  const hostChanges = (g: ChatHostGate) => {
    // Nothing known of a newer build (Update pressed without one): nothing to compare, nothing changes.
    if (!update.available) return false
    const next = update.available.chatHost
    return !next || next.protocol !== g.protocol || next.version !== g.version
  }

  /** F-173a: waits (bounded) until the app is quiet again; null as soon as `hold.quiet()` says so, else why it never was. Nothing is cut meanwhile. */
  async function holdUntilQuiet(hold: UpdateHold): Promise<string | null> {
    const until = Date.now() + (hold.waitMs ?? 15_000)
    for (;;) {
      let why: string | null
      try {
        why = hold.quiet()
      } catch (e) {
        why = `the last look failed: ${e instanceof Error ? e.message : String(e)}`
      }
      if (why === null) return null
      if (Date.now() >= until) return why
      await new Promise<void>(resolve => setTimeout(resolve, hold.pollMs ?? 250).unref())
    }
  }

  /**
   * Order o7e6d S1: why an Update can't go now (empty: nothing holds it). Fail closed: a supplied holder with no guard in it yet, a guard that
   * throws, and an answer that is not a list of words all hold it. No holder supplied at all: nothing is asked (as before).
   */
  function heldBy(): string[] {
    const holder = o.updateGuard
    if (!holder) return []
    const guard = holder.current
    if (!guard) return ['the update guard is not ready']
    let answer: unknown
    try {
      answer = guard.blockers()
    } catch {
      return ['the update guard could not answer']
    }
    if (!Array.isArray(answer) || !answer.every(x => typeof x === 'string' && x.trim() !== '')) return ['the update guard gave an answer it does not understand']
    return answer as string[]
  }

  /** Order o7e6d S1: the wait for busy chats ends because the Update is held now: no timer is left, and nothing goes later by itself. */
  function stopWaiting(why: string[]) {
    if (hostTimer) clearInterval(hostTimer)
    hostTimer = null
    hostWait = null
    log?.warn(`updating: held while it waited for the chats, so the update stops here and nothing was cut; press Update again once nothing holds it: ${why.join('; ')}`)
  }

  function go(retire: ChatHostGate | null, strict = false, hold?: UpdateHold) {
    if (hostTimer) clearInterval(hostTimer)
    hostTimer = null
    hostWait = null
    /**
     * Order o7e6d S1: is the update held at this step? Then it stops here for good: nothing after this step is done, and it is never resumed by
     * itself (a new press, or the automatic update's next look, starts again from the beginning); the automatic update hears why (onAbort). Not
     * atomic: a hold found after the chat host was retired can't undo that (its chats were saved and ended, and come back resumed at the next
     * start of the app); only what is still to come (the restart) is not done.
     */
    const heldAt = (step: string): boolean => {
      const why = heldBy()
      if (!why.length) return false
      log?.warn(`updating: held ${step}, so the update stops here: ${why.join('; ')}`)
      hold?.onAbort(`the update is held (${why.join('; ')})`)
      return true
    }
    // Answer first; then go, and Start.cmd (or the guard) takes it from here.
    void (async () => {
      if (hold) {
        // The coordinator's last look was a moment ago; a send, a draft or a busy chat since then makes the restart wait, never cut.
        const why = await holdUntilQuiet(hold)
        if (why !== null) {
          log?.warn(`updating: the automatic update stops here, the app was not quiet: ${why}`)
          return hold.onAbort(why)
        }
        if (heldAt('after its last look')) return
      }
      if (retire) {
        if (heldAt('before the chat host was retired (nothing was cut)')) return
        try {
          log?.info('updating: the chat host changes with this build; its chats are saved and ended, and come back resumed')
          await retire.retire()
        } catch (e) {
          log?.warn(`updating: could not retire the chat host: ${e instanceof Error ? e.message : String(e)}`)
          // F-173a: an automatic update does not restart over a host it could not retire; the person's own press always did.
          if (strict) {
            log?.warn('updating: the automatic update stops here; nothing was restarted')
            return hold?.onAbort('the chat host could not be retired')
          }
        }
        if (heldAt('after the chat host\'s retire (its chats may already be saved and ended; they come back resumed at the next start; the app is not restarted)')) return
      }
      // An automatic update has no answer to send first: it restarts at once, so the window after the last look stays as short as it can.
      if (hold) {
        if (heldAt('right before the restart')) return
        return o.restart(UPDATE_EXIT_CODE)
      }
      setTimeout(() => {
        try {
          if (heldAt('right before the restart')) return
          o.restart(UPDATE_EXIT_CODE)
        } catch (e) {
          log?.warn(`updating: the restart failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }, 300).unref()
    })().catch((e: unknown) => log?.warn(`updating: stopped by an error, nothing more was done: ${e instanceof Error ? e.message : String(e)}`))
  }

  function startUpdate(body?: unknown, via: UpdatePermit['via'] = 'admin', hold?: UpdateHold) {
    if (!update.can) throw apiError(409, update.cannot ?? "This PC can't update itself")
    // Order o7e6d S1: before force, the wait for busy chats, the chat host or the restart: nothing has been started or cut yet. Force never passes it.
    const holding = heldBy()
    if (holding.length) {
      log?.warn(`updating: held, nothing was started: ${holding.join('; ')}`)
      throw Object.assign(apiError(409, `The update is held: ${holding.join('; ')}.`), { code: 'update-held' })
    }
    const g = o.chatHostGate?.current ?? null
    const force = via === 'admin' && isObject(body) && body.force === true
    if (via === 'auto') {
      // Never a wait, never a force: the coordinator checked every chat a moment ago; a busy one now means "not now".
      if (!g) throw apiError(409, 'The chat host is not reporting, so whether chats are busy is unknown.')
      if (g.busy() > 0) throw apiError(409, `${g.busy()} chat(s) are busy; the automatic update does not wait for them.`)
      if (hostWait) throw apiError(409, 'An update is already waiting for the chats.')
      go(hostChanges(g) ? g : null, true, hold)
      return { ...info(), restarting: true }
    }
    if (g && hostChanges(g)) {
      if (!force && g.busy() > 0) {
        // F-075: not while a chat is mid-answer: wait for them to be idle, then ask.
        if (!hostWait) {
          hostWait = { since: Date.now(), ask: false }
          log?.info(`updating: the chat host changes with this build and ${g.busy()} chat(s) are busy; waiting for them to be idle`)
          hostTimer = setInterval(() => {
            try {
              if (!hostWait) return
              // Order o7e6d S1: held while it waits: the wait ends here for good (never resumed by itself); the person presses Update again.
              const late = heldBy()
              if (late.length) return stopWaiting(late)
              const gate = o.chatHostGate?.current
              if (!gate) return
              if (gate.busy() === 0) return go(gate)
              if (!hostWait.ask && Date.now() - hostWait.since >= (o.hostWaitMs ?? 10 * 60_000)) {
                hostWait.ask = true
                log?.info('updating: the chats are still busy after the wait; asking on the Build page')
              }
            } catch (e) {
              // Never a throw out of a timer (it would end the app): the wait stops, nothing is cut.
              stopWaiting([`its look failed: ${e instanceof Error ? e.message : String(e)}`])
            }
          }, o.hostPollMs ?? 5000)
          hostTimer.unref()
        }
        return { ...info(), restarting: false }
      }
      go(g)
      return { ...info(), restarting: true }
    }
    log?.info('updating: restarting so Start.cmd pulls the new build')
    go(null)
    return { ...info(), restarting: true }
  }

  function cancelUpdate() {
    if (hostTimer) clearInterval(hostTimer)
    hostTimer = null
    hostWait = null
    o.onUpdateCancel?.()
    return info()
  }

  // F-173a: one permit, one update. A permit for build X is refused once X is no longer the one available (a newer one was published
  // since), after 15 s, and the second time.
  const permits = new Map<string, { to: string; via: UpdatePermit['via']; at: number }>()
  function issuePermit(via: UpdatePermit['via'], to: string): UpdatePermit {
    const now = Date.now()
    for (const [id, p] of permits) if (now - p.at > PERMIT_MS) permits.delete(id)
    const id = randomBytes(12).toString('hex')
    permits.set(id, { to, via, at: now })
    return Object.freeze({ id, to, via })
  }
  function commitUpdate(permit: UpdatePermit, hold?: UpdateHold) {
    const held = permits.get(permit.id)
    permits.delete(permit.id)
    if (!held || held.via !== permit.via || held.to !== permit.to || Date.now() - held.at > PERMIT_MS) throw apiError(409, 'That update permit is not valid (used, expired or not issued here).')
    if (held.via === 'auto' && (held.to === '' || update.available?.version !== held.to)) throw apiError(409, 'The build this update was for is no longer the newest one.')
    return startUpdate(undefined, held.via, held.via === 'auto' ? hold : undefined)
  }

  const first = setTimeout(() => void check(), FIRST_CHECK_MS)
  first.unref()
  const every = setInterval(() => void check(), CHECK_EVERY_MS)
  every.unref()
  void devStatus().catch(() => {})
  // F-026: Dev looked at again every 20 s, so Publish shows once something changes there.
  const devEvery = publish ? setInterval(() => void devStatus().catch(() => {}), DEV_EVERY_MS) : null
  devEvery?.unref()

  const routes: Record<string, (r: MountRequest) => unknown> = {
    // F-119: whether this browser may press Publish rides with the info, for the page that shows the button.
    'GET /info': r => ({ ...info(), mayPublish: publishActor(r.headers, r.caller) !== null }),
    'POST /check': () => check(),
    // F-173a: from a page, only a signed-in administrator presses Update or cancels it (F-119's rule, not Publish's: obcbd narrowed Publish to the owner); a program on this PC with the machine token and no page headers is as before.
    'POST /update': r => {
      o.authorizeUpdate(r)
      // The person's own press: its body (force, after the wait) is theirs, as it always was.
      return startUpdate(r.body, 'admin')
    },
    'POST /update-cancel': r => {
      o.authorizeUpdate(r)
      return cancelUpdate()
    },
    'POST /publish': r => {
      // F-119: from a page, only a browser signed in as sbskrrt; a local tool with the machine token and no page headers is as before.
      const actor = publishActor(r.headers, r.caller)
      if (!actor) throw authError(403, 'Only the owner, signed in, or Lead on the local machine channel may publish.', 'admin-only')
      // obcbd: told plainly, before any confirmation is asked for: this caller can never skip the checks.
      if (isObject(r.body) && r.body.checks === 'skip' && !maySkipTests(actor)) throw authError(403, SKIP_REFUSED, 'admin-only')
      let req: PublishRequest
      try { req = publishRequest(r.body) } catch (e) { throw apiError(400, e instanceof Error ? e.message : String(e)) }
      return startPublish(req, actor)
    },
  }

  return {
    requestUpdate: () => startUpdate(),
    issuePermit,
    commitUpdate,
    busy: () => o.chatHostGate?.current?.busy() ?? 0,
    mount: {
      prefix: '/build',
      async http(r) {
        const run = routes[`${r.method} ${r.rest}`]
        if (!run) throw apiError(404, `No such path: /build${r.rest}`)
        return await run(r)
      },
    },
    info,
    check,
    close() {
      clearTimeout(first)
      clearInterval(every)
      if (hostTimer) clearInterval(hostTimer)
      if (devEvery) clearInterval(devEvery)
      running?.kill()
    },
  }
}
