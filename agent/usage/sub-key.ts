import { existsSync } from 'node:fs'
import path from 'node:path'

// Order of130 (Shubham, 18 Nov 2026: "Others ≈91.6% this is me ok so please fix it", "im not sure its me", "but this app is not tarackign usage so that needs to be fixed").
// A Claude chat's usage is filed under the CRM SUBSCRIPTION it runs on, so the CRM can place it: its Usage page splits a subscription's weekly figure among the people whose cost was filed under that subscription,
// and what it cannot place is "Others". Until this order every chat was filed under the blank key ("this PC's own Claude login, not managed"), so his own agents, which run on the Office 2(Jagtap) credential the
// CRM placed on the Server, showed as 91.6 points of Others (3,209 dollars at the CRM's 0.0283 points per dollar = 90.9 points).

/**
 * The marker file, beside the agent folder (like input-mirror.off and fast-assistant.on): its presence puts the OLD way back, every chat's usage under the blank key, exactly as before this order.
 * It is the old way, kept on purpose (Shubham's rule: a changed approach keeps the old one as a setting); it is not a debug flag.
 */
export const USAGE_SUB_OFF_FILE = 'usage-sub.off'

/**
 * The shape of a subscription key the status line takes: the CRM's subscription ids are UUIDs. statusline.mjs has the same rule (SUB_RE) and DROPS anything else to the blank key without a word, so a label
 * that is not this shape would do nothing and say nothing: usageSubKeyOf refuses it here, where it can be said (sub-key.test.ts keeps the two rules the same).
 */
export const SUB_KEY_RE = /^[0-9a-f-]{36}$/i

/** What a chat's credential says about its account: the one read claude/index.ts credentialWithSubscription() makes (its id, never its token). */
export interface CredentialRead {
  subscriptionId?: string
}

/**
 * The subscription key a Claude process started on `cred` files its usage under: the id of the CRM subscription whose credential it was started on, or '' (the PC's own login: not managed) when the credential
 * was not the CRM's (nothing placed, signed out, a token the person set, a variable removed mid-switch: an honest "unknown" beats a wrong label), when the old way is on, or when the id is not a UUID (then
 * `notAKey` hears it, so it can be said once: the status line would drop it silently). `agentFolder` is the folder that holds the PC's one-switch files. The key is fixed when the process is started, like its
 * token. Lower case, as the CRM files it.
 */
export function usageSubKeyOf(cred: CredentialRead | null | undefined, agentFolder: string, notAKey?: (id: string) => void): string {
  const id = typeof cred?.subscriptionId === 'string' ? cred.subscriptionId.trim().toLowerCase() : ''
  if (!id) return ''
  if (!SUB_KEY_RE.test(id)) {
    notAKey?.(id)
    return ''
  }
  if (existsSync(path.join(agentFolder, USAGE_SUB_OFF_FILE))) return ''
  return id
}
