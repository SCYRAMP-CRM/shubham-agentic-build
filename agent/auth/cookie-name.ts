import { AUTH_COOKIE } from '../../shared/auth.ts'

// Shubham's order off76 ("if i login in the dev the build logs out"), via Lead, 23 Nov 2026. Cookies belong to a host NAME, not to a port: a sign-in on the Dev copy (https://server.<tailnet>.ts.net:5174)
// overwrote the live app's `sad_session` cookie (:5173) and the other way round, so signing in to one signed the other out. The cookie's name is therefore settable, by ONE environment setting, SAD_AUTH_COOKIE,
// so the Dev copy can be started with a name of its own and the two stop sharing a cookie. Nothing changes for anyone who does not set it: the name stays exactly `sad_session` (shared/auth.ts AUTH_COOKIE).

/** The environment setting that renames the sign-in cookie of THIS agent. */
export const AUTH_COOKIE_ENV = 'SAD_AUTH_COOKIE'
/** A name this app accepts: letters, digits and underscores, 3 to 40 of them (no "=", ";", space, dot or dash: nothing that could change what a Cookie or Set-Cookie header means). */
const VALID_NAME = /^[A-Za-z0-9_]{3,40}$/

/**
 * The name of this agent's sign-in cookie: SAD_AUTH_COOKIE when it is set to a valid name, else the default `sad_session`. An unset (or empty) setting is the default and says nothing; a setting that is not a valid name is
 * IGNORED (the default is used) and `warn` hears ONE sentence, which never repeats the value. Read once, when the agent starts: the one name is used for what is read from a request, for the Set-Cookie of a sign-in and for the one that ends a session.
 */
export function authCookieName(env: NodeJS.ProcessEnv, warn?: (message: string) => void): string {
  const raw = env[AUTH_COOKIE_ENV]
  if (raw === undefined || raw === '') return AUTH_COOKIE
  if (VALID_NAME.test(raw)) return raw
  warn?.(`${AUTH_COOKIE_ENV} is not a cookie name this app accepts (3 to 40 letters, digits or underscores): it is ignored and the default name is used`)
  return AUTH_COOKIE
}
