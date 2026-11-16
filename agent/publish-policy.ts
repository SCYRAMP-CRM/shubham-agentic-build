import path from 'node:path'
import { SBSKRRT_ID } from '../shared/auth.ts'
import type { PublishActor, PublishAudit, PublishChecks, PublishRequest } from '../shared/build.ts'
import { isPageRequest, type Caller } from './auth/types.ts'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
function word(v: unknown, max = 120): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || [...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('Invalid publish actor.')
  return v.trim()
}
export function cleanPublishActor(v: unknown): PublishActor {
  if (!object(v) || !['owner', 'lead'].includes(String(v.kind))) throw new Error('Invalid publish actor.')
  const actor = { kind: v.kind as PublishActor['kind'], id: word(v.id), name: word(v.name) }
  if (actor.kind === 'owner' && actor.id !== SBSKRRT_ID) throw new Error('Only the owner publishes from a page.')
  return actor
}
export function samePublishActor(a: PublishActor | undefined, b: PublishActor): boolean {
  if (!a) return false
  return a.kind === b.kind && a.id === b.id && a.name === b.name
}
export function samePublishAudit(a: PublishAudit | undefined, b: PublishAudit): boolean {
  if (!a) return false
  return a.checks === b.checks && a.at === b.at && samePublishActor(a.by, b.by)
}

/** The API already authenticates the local machine-token channel used by Lead. Never trust actor fields in the body. */
export function publishActor(headers: Record<string, string | string[] | undefined>, caller: Caller | undefined): PublishActor | null {
  if (caller?.person?.id === SBSKRRT_ID) return { kind: 'owner', id: SBSKRRT_ID, name: caller.person.username || 'sbskrrt' }
  if (isPageRequest(headers) || caller?.person) return null
  return { kind: 'lead', id: 'local-machine', name: 'Lead (local machine)' }
}

/**
 * obcbd (Lead, 16 Nov): Skip tests and publish is human-only. Only the owner's own signed-in page may ask for it, and there its button
 * and its confirmation are humanOnly (the assistant's screen control refuses them; a click that is not a real tap does nothing). The
 * machine-token channel, which every local program and agent uses, can only Test and publish.
 */
export const maySkipTests = (actor: PublishActor): boolean => actor.kind === 'owner'

export function publishRequest(body: unknown): PublishRequest {
  if (!object(body)) throw new Error('Publish expects an object.')
  if (Object.keys(body).some(k => !['checks', 'confirmSkipTests', 'skipChecks'].includes(k))) throw new Error('Unknown publish setting (the caller supplies the audit identity).')
  if (body.skipChecks !== undefined && body.skipChecks !== false) throw new Error('Use Skip tests and publish with its explicit confirmation, not skipChecks.')
  const checks = body.checks ?? 'full'
  if (checks !== 'full' && checks !== 'skip') throw new Error('Choose Test and publish or Skip tests and publish.')
  if (body.confirmSkipTests !== undefined && typeof body.confirmSkipTests !== 'boolean') throw new Error('Invalid skip confirmation.')
  if (checks === 'skip' && body.confirmSkipTests !== true) throw new Error('Confirm that no tests will run before publishing without tests.')
  if (checks === 'full' && body.confirmSkipTests === true) throw new Error('Skip confirmation does not belong to Test and publish.')
  return checks === 'skip' ? { checks, confirmSkipTests: true } : { checks }
}

const SKIP_IS_HUMAN = 'Skip tests and publish is the owner’s own choice, made and confirmed by hand on the Build page.'
const ATTEMPT_ID = /^[a-f0-9]{32}$/

/** What a publish the agent starts sends first, once its listener is on: a decision sent before that would be lost. */
export const PUBLISH_READY = 'obcbd-publish-ready'
/** The decision the agent hands the publish it starts, over that process's own control channel, never its command line. */
export interface PublishDecision {
  t: 'obcbd-publish-decision'
  checks: PublishChecks
  confirmSkipTests?: true
  actor: PublishActor
  historyDir: string
  attemptId: string
}
export function publishDecision(req: PublishRequest, actor: PublishActor, historyDir: string, attemptId: string): PublishDecision {
  const checks = req.checks ?? 'full'
  if (checks === 'skip' && (req.confirmSkipTests !== true || !maySkipTests(actor))) throw new Error(SKIP_IS_HUMAN)
  if (!path.isAbsolute(historyDir) || !ATTEMPT_ID.test(attemptId)) throw new Error('Invalid publish receipt location.')
  return { t: 'obcbd-publish-decision', checks, ...(checks === 'skip' ? { confirmSkipTests: true as const } : {}), actor: cleanPublishActor(actor), historyDir, attemptId }
}
/** The publish's side: exactly the agent's decision, checked again. Skipping is never granted to anyone but the owner. */
export function readPublishDecision(m: unknown): { req: PublishRequest; actor: PublishActor; historyDir: string; attemptId: string } {
  if (!object(m) || m.t !== 'obcbd-publish-decision' || Object.keys(m).some(k => !['t', 'checks', 'confirmSkipTests', 'actor', 'historyDir', 'attemptId'].includes(k))) {
    throw new Error('This publish was started with a control channel, but what arrived is not a publish decision.')
  }
  const req = publishRequest({ checks: m.checks, ...(m.confirmSkipTests === undefined ? {} : { confirmSkipTests: m.confirmSkipTests }) })
  const actor = cleanPublishActor(m.actor)
  if (req.checks === 'skip' && !maySkipTests(actor)) throw new Error(SKIP_IS_HUMAN)
  if (typeof m.historyDir !== 'string' || !path.isAbsolute(m.historyDir) || typeof m.attemptId !== 'string' || !ATTEMPT_ID.test(m.attemptId)) throw new Error('Invalid publish receipt location.')
  return { req, actor, historyDir: m.historyDir, attemptId: m.attemptId }
}

const SKIP_FLAGS = ['--skip-tests', '--skip-checks', '--confirm-no-tests']
const flagName = (arg: string) => (arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg)

/** By hand, or from any program on this PC: always Test and publish. No flag skips the checks, names someone else or reuses a receipt. */
export function publishCli(args: readonly string[], localOperator: string): { req: PublishRequest; actor: PublishActor; push: boolean; historyDir: string | undefined } {
  const flags = new Map<string, string | true>()
  for (const arg of args) {
    const key = flagName(arg)
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : true
    if (SKIP_FLAGS.includes(key)) throw new Error(SKIP_IS_HUMAN + ' This command always runs every check (Test and publish).')
    if (flags.has(key) || !['--test-and-publish', '--no-push', '--history-dir'].includes(key)) throw new Error('Unknown or duplicate publish argument: ' + key)
    if (key === '--history-dir' ? typeof value !== 'string' || !value : value !== true) throw new Error('Invalid publish argument: ' + key)
    flags.set(key, value)
  }
  const historyDir = flags.get('--history-dir')
  return {
    req: { checks: 'full' },
    actor: cleanPublishActor({ kind: 'lead', id: 'local-machine', name: 'Lead (' + localOperator + ')' }),
    push: !flags.has('--no-push'),
    historyDir: typeof historyDir === 'string' ? historyDir : undefined,
  }
}

/** Started by the agent: the decision comes from the agent alone. Only --no-push, which can only do less, may stand beside it. */
export function publishChildArgs(args: readonly string[]): { push: boolean } {
  if (args.some(arg => SKIP_FLAGS.includes(flagName(arg)))) throw new Error(SKIP_IS_HUMAN)
  if (args.length > 1 || args.some(arg => arg !== '--no-push')) throw new Error('A publish the agent starts takes its decision from the agent alone; only --no-push may be added.')
  return { push: args.length === 0 }
}
