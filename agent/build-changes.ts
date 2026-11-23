import { spawn, type ChildProcess } from 'node:child_process'
import { cleanCommitTitles, type PublishRecord } from '../shared/build.ts'

// F-318: which commits went into a build. The publish (agent/scripts/publish.ts) asks it once, for the build it just made; the backfill script (agent/scripts/backfill-build-changes.ts) asks it for builds already published.
// Both go through the same function with a git runner handed in, so a test never needs a repository. Honest limits: the titles are what the developers typed, and a range that cannot be told is NOT RECORDED, never guessed.

/** Runs `git <args>` in Dev (the caller fixes the folder) and says how it ended. */
export type GitRun = (args: string[]) => Promise<{ code: number; stdout: string }>

const HASH = /^[0-9a-f]{7,40}$/
/** The most commits asked of git (the newest ones); a build keeps at most 60 titles of them. */
const LOG_LIMIT = 200

/**
 * F-318 follow-up (Agent 14): the time each git call is given. These calls run AFTER a successful push, to fill in a receipt; a hung git (a locked index, a dead network drive, a prompt nobody sees) must never hold the receipt's
 * finish, so a call that has not answered in this long is a failure ("not recorded"), and the process is killed (gitRunner).
 */
export const GIT_CALL_LIMIT_MS = 5_000
/** The answer of a call that ran out of time, as `timeout(1)` says it. */
const TIMED_OUT = 124

/** One call with a limit: no answer in time, or a throw, is a failure; the timer is always cleared (a finished call leaves nothing running). */
async function within(git: GitRun, args: string[], limitMs: number): Promise<{ code: number; stdout: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      git(args),
      new Promise<{ code: number; stdout: string }>(resolve => {
        timer = setTimeout(() => resolve({ code: TIMED_OUT, stdout: '' }), limitMs)
      }),
    ])
  } catch {
    return { code: 1, stdout: '' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A git runner for the folder `cwd`: arguments go as an array (never a shell); a call that has not finished in `limitMs` is KILLED and answers code 124; a program that cannot start answers 127; stderr is dropped.
 * `file` is git; a test hands another program to prove the limit with something that really hangs.
 */
export function gitRunner(cwd: string, limitMs = GIT_CALL_LIMIT_MS, file = 'git'): GitRun {
  return args =>
    new Promise(resolve => {
      let out = ''
      let child: ChildProcess
      try {
        child = spawn(file, args, { cwd, windowsHide: true, timeout: limitMs, killSignal: 'SIGKILL' })
      } catch {
        resolve({ code: 127, stdout: '' })
        return
      }
      child.stdout?.on('data', (c: Buffer) => (out += c.toString('utf8')))
      child.stderr?.on('data', () => {})
      child.on('error', () => resolve({ code: 127, stdout: '' }))
      // A process ended by the limit closes with no exit code.
      child.on('close', code => resolve({ code: code ?? TIMED_OUT, stdout: out }))
    })
}

/** The Dev commit a build was made from, read out of its RELEASE.json text (what the build repo held before this publish); null when it cannot be told. */
export function commitOfRelease(text: string): string | null {
  try {
    const v = JSON.parse(text) as { commit?: unknown }
    return typeof v === 'object' && v !== null && typeof v.commit === 'string' && HASH.test(v.commit) ? v.commit : null
  } catch {
    return null
  }
}

/**
 * The titles of the commits between two builds' Dev commits (`git log --no-merges --format=%s previous..commit`: the subject only, never an author, an email or a body), newest first, made safe and cut (shared cleanCommitTitles).
 * null = NOT RECORDED: no previous build, a hash that is not a hash, a commit Dev does not have, a previous commit that is not an ancestor of this one (Dev was rewritten or the branch moved), git failing or not answering within `limitMs`
 * (each of the three calls has that long). The same commit twice is an empty list.
 */
export async function commitTitlesBetween(git: GitRun, previous: string | null, commit: string | null, limitMs = GIT_CALL_LIMIT_MS): Promise<string[] | null> {
  if (!previous || !commit || !HASH.test(previous) || !HASH.test(commit)) return null
  if (previous === commit) return []
  for (const c of [previous, commit]) {
    const known = await within(git, ['cat-file', '-e', `${c}^{commit}`], limitMs)
    if (known.code !== 0) return null
  }
  const ancestor = await within(git, ['merge-base', '--is-ancestor', previous, commit], limitMs)
  if (ancestor.code !== 0) return null
  const log = await within(git, ['log', '--no-merges', '--format=%s', `--max-count=${LOG_LIMIT}`, `${previous}..${commit}`], limitMs)
  if (log.code !== 0) return null
  return cleanCommitTitles(log.stdout.split(/\r?\n/))
}

/** A build as the build repo's own history names it: its version, the Dev commit it was made from (null when the publish could not name it: the subject says "unknown"), and whether Dev had changes not committed. */
export interface BuiltFrom {
  version: string
  commit: string | null
  dirty: boolean
}
const SUBJECT = /^Build (\d{4}\.\d{2}\.\d{2}-\d{4}) from shubham-agentic-dev ([0-9a-f]{7,40}|unknown)( with changes not committed)?$/

/** The build repo's commit subjects ("Build 2026.11.22-1249 from shubham-agentic-dev abc1234"), newest first as `git log` prints them, as builds oldest first; any other subject is not a build and is skipped. */
export function buildsFromSubjects(subjectsNewestFirst: readonly string[]): BuiltFrom[] {
  const out: BuiltFrom[] = []
  for (const s of subjectsNewestFirst) {
    const m = SUBJECT.exec(s.trim())
    if (m) out.push({ version: m[1]!, commit: m[2] === 'unknown' ? null : m[2]!, dirty: m[3] !== undefined })
  }
  return out.reverse()
}

/** What the backfill would do for one published record. `why` says why nothing can be recorded for it (null when something can). */
export interface BackfillItem {
  id: string
  version: string
  commit: string | null
  changes: string[] | null
  /** The build repo's subject says Dev had changes not committed. */
  dirty: boolean
  why: string | null
}

/**
 * The backfill's plan: for each PUBLISHED record that has no commit titles yet, the build repo's history says which Dev commit that version was made from and which build came before it; the titles are the commits between. A record whose version the build
 * repo does not name exactly once, the first build (nothing before it), or a range Dev cannot tell is left NOT RECORDED with the reason. Nothing is guessed, and a record that already has titles is not touched.
 */
export async function backfillPlan(records: readonly PublishRecord[], builds: readonly BuiltFrom[], git: GitRun, limitMs = GIT_CALL_LIMIT_MS): Promise<BackfillItem[]> {
  const items: BackfillItem[] = []
  for (const r of records) {
    if (r.outcome !== 'published' || typeof r.version !== 'string' || Array.isArray(r.changes)) continue
    const at = builds.map((b, i) => (b.version === r.version ? i : -1)).filter(i => i >= 0)
    if (at.length !== 1) {
      items.push({ id: r.id, version: r.version, commit: null, changes: null, dirty: false, why: at.length === 0 ? 'the build repo has no commit for this version' : 'the build repo names this version more than once' })
      continue
    }
    const build = builds[at[0]!]!
    const dirty = build.dirty
    const before = at[0]! > 0 ? builds[at[0]! - 1]! : null
    if (!before) {
      items.push({ id: r.id, version: r.version, commit: build.commit, changes: null, dirty, why: 'the first build in the build repo: nothing before it' })
      continue
    }
    const changes = await commitTitlesBetween(git, before.commit, build.commit, limitMs)
    items.push({ id: r.id, version: r.version, commit: build.commit, changes, dirty, why: changes === null ? 'Dev does not have both commits, or the earlier one is not an ancestor of the later, or git did not answer' : null })
  }
  return items
}
