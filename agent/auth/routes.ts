import type { AuthStatus } from '../../shared/auth.ts'
import type { FeatureAccess } from './feature-access.ts'
import type { Auth } from './index.ts'
import { authError, type Caller } from './types.ts'

// F-118: the /agent-api/auth/* routes (shared/auth.ts lists them). api.ts has read the body and
// checked the token and the Origin; this only maps a route to the Auth object and says what to
// answer, and the cookie to set.

export interface AuthRouteRequest {
  method: string
  /** The path after /agent-api/auth */
  rest: string
  query: URLSearchParams
  body: unknown
  caller: Caller
  /** The page came over https: the cookie then carries Secure. */
  secure: boolean
  /** Order o9465: Settings › Access (what is open to whom); left out (tests, an older wiring), every status says nothing of it. */
  access?: FeatureAccess
}

export interface AuthAnswer {
  status: number
  data: unknown
  setCookie?: string
}

/** The answer, or null when this is not an auth route. */
export async function authRoute(auth: Auth, r: AuthRouteRequest): Promise<AuthAnswer | null> {
  const { method, rest, caller } = r
  // Order o9465: every status carries the features this person's page shows (null: every one, the owner's).
  const withFeatures = (s: AuthStatus): AuthStatus => (r.access ? { ...s, features: r.access.features({ ...caller, person: s.person }) } : s)
  if (method === 'GET' && rest === '/status') return { status: 200, data: withFeatures(auth.status(caller)) }
  if (method === 'POST' && rest === '/sign-in') {
    const done = await auth.signIn(caller, r.body, r.secure)
    return { status: 200, data: withFeatures(done.status), setCookie: done.cookie }
  }
  if (method === 'POST' && rest === '/sign-out') {
    const out = auth.signOut(caller)
    return { status: 200, data: withFeatures(out.status), setCookie: out.cookie }
  }
  // Order o9465: Settings › Access, the owner's only (the module refuses everyone else).
  if (r.access && method === 'GET' && rest === '/access') return { status: 200, data: r.access.view(caller) }
  if (r.access && method === 'PUT' && rest === '/access') return { status: 200, data: r.access.set(caller, r.body) }
  if (method === 'GET' && rest === '/me') {
    if (!caller.person) throw authError(401, 'Not signed in.', 'sign-in')
    return { status: 200, data: caller.person }
  }
  if (method === 'GET' && rest === '/users') return { status: 200, data: { users: auth.users(caller, r.query.get('q') ?? '') } }
  if (method === 'GET' && rest === '/settings') return { status: 200, data: auth.settings(caller) }
  if (method === 'PUT' && rest === '/settings') return { status: 200, data: auth.putSettings(caller, r.body) }
  if (method === 'POST' && rest === '/settings/confirm') return { status: 200, data: auth.confirm(caller) }
  return null
}
