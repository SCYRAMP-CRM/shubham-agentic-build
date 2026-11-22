import { SBSKRRT_ID, type AuthErrorCode, type AuthPerson } from '../../shared/auth.ts'

// F-118: the two things api.ts and the modules share without importing each other as values.

/** Who a request is: its person (null: nobody signed in), where it came from, and which session. */
export interface Caller {
  person: AuthPerson | null
  via: 'local' | 'tailnet'
  /** The session's public id (the first 12 characters of its hash), or null. Safe to log. */
  sid: string | null
  /**
   * The PC itself, not a browser: a request with the machine token and none of the page markers (isPageRequest), such as the Server's own
   * build-api.mjs. It is not bound by the sign-in level and acts as the owner of the app ('system'); it never holds a person's session.
   */
  machine?: boolean
}

/** A caller with no cookie from this PC's own browser: what everything is when no auth is wired (tests, the open app). */
export const OPEN: Caller = { person: null, via: 'local', sid: null }

/**
 * Whether a request came from a PAGE (a browser, through the page server or a Ports share) as opposed to a program on the PC.
 * Any one marker is enough, so it is enough to be wrong in only one direction (a program that wears a marker is treated as a page and
 * is bound by the level; nothing a page can do removes them): the page server's own x-sad-page, an Origin, the fetch metadata a browser
 * always sends (sec-fetch-site, sec-fetch-dest; NOT sec-fetch-mode, which Node's own fetch sends too: it is what build-api.mjs is), or any x-sad-via at all (the Ports gate and the page server set it; the value is not trusted for this).
 */
export function isPageRequest(headers: Record<string, string | string[] | undefined>): boolean {
  return (
    headers['x-sad-page'] !== undefined ||
    headers.origin !== undefined ||
    headers['sec-fetch-site'] !== undefined ||
    headers['sec-fetch-dest'] !== undefined ||
    headers['x-sad-via'] !== undefined
  )
}

/**
 * F-119: whether this request may press Update (F-173a: main.ts wires it for POST /update and /update-cancel). It was Publish's
 * rule too until obcbd narrowed Publish to the owner signed in or the machine-token channel (publish-policy.ts publishActor); the
 * name is older than that. A PAGE (a browser: it sends an Origin or fetch metadata, or the page server tagged it as from the
 * tailnet) may only when it is signed in as Shubham, the first owner, BY HIS ID (a second owner does not: order o2f32): "unsigned, so the open app" does not count, since every tailnet
 * device can open the Server's page. A program on the Server calling with the machine token and no page headers (build-api.mjs)
 * is not a page and keeps working.
 */
export function mayPublish(headers: Record<string, string | string[] | undefined>, caller: Caller | undefined): boolean {
  // Shubham's order o2f32: Update is the first owner's BY HIS ID (a second owner listed in the owners file, or any other administrator, does not press it from a page: canSeeAll is no longer the test).
  return !isPageRequest(headers) || caller?.person?.id === SBSKRRT_ID
}

/** What a caller may do about Update (Shubham's order ob12b): the OWNER (the first owner by id, or the PC's own program) presses as before, with force and cancel; a PERSON presses under the guards, while the switch is on. */
export type UpdateRights = { kind: 'owner'; by?: { id: string; name: string } } | { kind: 'person'; by: { id: string; name: string } }

/**
 * Who presses Update, decided in ONE place (main.ts wires it into POST /update, /update-cancel, /update-policy and GET /status):
 *  - the first owner (Shubham, by id) on a page, and a program on this PC with the machine token and no person: the OWNER, as before;
 *  - any other signed-in person (a second owner, an administrator, is a person for this), while `peopleMayUpdate()` is true: a PERSON;
 *  - anyone else: refused, with the reason as `why` (a code of shared/build.ts UPDATE_WHY_WORDS) so the Build page can say it in words.
 * A request WITH a person is judged by the person, never by "looks like a program" (a cookie sent without page headers is not the machine channel).
 */
export function updateRights(headers: Record<string, string | string[] | undefined>, caller: Caller | undefined, peopleMayUpdate: () => boolean): UpdateRights {
  const person = caller?.person
  if (!person) {
    if (isPageRequest(headers)) throw Object.assign(authError(401, 'Sign in to update.', 'sign-in'), { why: 'not-signed-in' })
    return { kind: 'owner' }
  }
  // The name goes into the audit line: cut at 120, no line end or other control character in it (no regex: oxlint's no-control-regex).
  const by = { id: person.id, name: [...(person.name || person.username || '').slice(0, 120)].map(c => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('') }
  if (person.id.toLowerCase() === SBSKRRT_ID) return { kind: 'owner', by }
  if (!peopleMayUpdate()) throw Object.assign(authError(403, 'The owner has switched off Update for everyone else.', 'admin-only'), { why: 'people-off' })
  return { kind: 'person', by }
}

/** An error the API answers with this status, message and the contract's code. */
export function authError(status: number, message: string, code: AuthErrorCode): Error & { status: number; code: AuthErrorCode } {
  return Object.assign(new Error(message), { status, code })
}
