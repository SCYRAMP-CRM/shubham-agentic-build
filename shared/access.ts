/**
 * Order o9465 (Shubham, 14 Nov 2026: "We have to figure out what is to be added for normal users, because I am super admin; I have to slowly give
 * access to things that everyone should be having. OK, in the Settings for me please add the Access tab as well."): who else may use each page and
 * feature of the app. Settings › Access (the owner's only) sets, for each feature, "Only me", "Chosen people" (CRM members) or "Everyone signed in".
 *
 * - Everything starts as "Only me" (order o929e: kept so at publish; he opens features one by one).
 * - An agent or floor he has already shared with someone keeps working for that person whatever is chosen here (order o929e: an existing share is
 *   his explicit choice): the Agents routes marked `share` let such a person in, and the agentic mount still shows them only what is shared.
 * - The agent enforces it (agent/api.ts gate(), one check for every route and WebSocket, after the sign-in step of order oc186): a signed-in person
 *   who is not the owner reaches only the routes below whose feature is open to them, and NOTHING that is not listed here (fail closed).
 * - The page hides what is not open (the menu, the picker, the search, PC control's tabs, the overlay), from the same list.
 * - A feature that runs as him (his CRM sign-in, his passwords, his WhatsApp, his browser, his PCs' screens and updates) is `locked`: it stays his.
 */

import { AGENT_DIRECTORY_ROUTE } from './agent-directory.ts'
import { LIVE_CLASSIC_ROUTE, OLD_LEGACY_ROUTE, OLD_ROUTE } from './old-route.ts'
import { QUICK_ROUTE } from './quick-page.ts'

export type AccessMode = 'owner' | 'people' | 'everyone'

export interface AccessChoice {
  mode: AccessMode
  /** CRM user ids (lower case), for 'people'. */
  people: string[]
}

export const OWNER_ONLY: AccessChoice = Object.freeze({ mode: 'owner', people: [] }) as AccessChoice
export const ACCESS_MODES: readonly AccessMode[] = ['owner', 'people', 'everyone']
export const MODE_LABELS: Readonly<Record<AccessMode, string>> = { owner: 'Only me', people: 'Chosen people', everyone: 'Everyone signed in' }
/** At most this many chosen people on one feature. */
export const MAX_PEOPLE = 200

export type FeatureGroup = 'pages' | 'pc-control' | 'assistant' | 'settings'
export const FEATURE_GROUPS: readonly { group: FeatureGroup; title: string }[] = [
  { group: 'pages', title: 'Pages' },
  { group: 'pc-control', title: 'PC control tabs' },
  { group: 'assistant', title: 'Assistant and voice' },
  { group: 'settings', title: 'Settings' },
]

export interface Feature {
  key: string
  group: FeatureGroup
  label: string
  /** One plain line: what the person gets. */
  blurb: string
  /** The app's pages it opens (a path also opens what is below it). */
  pages?: readonly string[]
  /** Why it stays the owner's: it runs as him, holds his secrets or changes his PCs. Such a feature cannot be opened to anyone. */
  locked?: string
  /** Another feature this one needs open too (a PC control tab needs the PC control page). */
  needs?: string
  /**
   * Order o68f0: chosen for each PC on its own (Settings › Access lists the PCs under it). Its choices are kept as '<key>@<pcId>'; the feature is
   * open to a person when it is open to them on at least one PC (what the page's menu and the Server's gate need), and each PC's own routes are
   * checked for that PC (allows(caller, key, pcId)).
   */
  perPc?: true
}

export const FEATURES: readonly Feature[] = [
  // Pages, in the menu's order.
  { key: 'home', group: 'pages', label: 'Home', blurb: 'Where the app starts.', pages: ['/'] },
  { key: 'features', group: 'pages', label: 'Features', blurb: 'What is asked for and what is built (to read; ticking stays yours).', pages: ['/features'] },
  { key: 'themes', group: 'pages', label: 'Themes', blurb: 'The six looks, light and dark.', pages: ['/themes'] },
  { key: 'agents', group: 'pages', label: 'Agentic Platform', blurb: 'Their floors and the agents shared with them, and making their own. What you shared stays open to them anyway.', pages: ['/agents', '/chats'] },
  // Order obb81 (goal "Agents tab", step 1): every agent's definition, notes, memory files and last replies. Starts as Only me like every row; its
  // look at an agent's memory and replies (the brain route) stays the owner's even when the page is opened to someone (it is in no rule below).
  { key: 'agent-directory', group: 'pages', label: 'Agents', blurb: 'Every agent: what it does, edited here; its notes, memory files and last replies stay yours.', pages: [AGENT_DIRECTORY_ROUTE] },
  { key: 'old-reader', group: 'pages', label: 'Live talking', blurb: 'Questions about the old app, answered in seconds (both Live talking pages).', pages: [OLD_ROUTE, OLD_LEGACY_ROUTE, LIVE_CLASSIC_ROUTE] },
  { key: 'pc-control', group: 'pages', label: 'PC control', blurb: 'The PCs and their tabs (each tab below is chosen on its own).', pages: ['/pc-control'] },
  { key: 'browser', group: 'pages', label: 'Browser', blurb: 'A browser on the Server.', pages: ['/browser'], locked: 'It is your browser on the Server, with your sign-ins.' },
  { key: 'whatsapp', group: 'pages', label: 'WhatsApp', blurb: 'Your WhatsApp.', pages: ['/whatsapp'], locked: 'It is your own WhatsApp.' },
  { key: 'tasks', group: 'pages', label: 'Tasks', blurb: 'Your task list: there is one list, so whoever you open it to sees and edits yours.', pages: ['/tasks'] },
  { key: 'crm-files', group: 'pages', label: 'CRM files', blurb: 'The CRM’s files, with each person’s own CRM sign-in. The PC’s drive stays the owner’s.', pages: ['/drive'] },
  { key: 'chris', group: 'pages', label: 'Hey Chris', blurb: 'The phone app’s Hey Chris screen, to look at (no microphone).', pages: ['/chris'] },
  { key: 'goals', group: 'pages', label: 'Goals', blurb: 'Their own CRM goals and today’s tasks, on their own CRM sign-in (the CRM decides what they see).', pages: ['/goals'] },
  { key: 'crm', group: 'pages', label: 'CRM', blurb: 'The CRM in the app, full window, on their own CRM sign-in (the CRM decides what they see).', pages: ['/crm'] },
  { key: 'accounts', group: 'pages', label: 'Accounts', blurb: 'Email accounts, platforms and codebases.', pages: ['/accounts'], locked: 'It holds your passwords and keys.' },
  { key: 'build', group: 'pages', label: 'Build', blurb: 'Which build runs, updates and publishing.', pages: ['/build'], locked: 'Publishing and updating the app is yours.' },
  { key: 'dependencies', group: 'pages', label: 'Dependencies', blurb: 'What Codex in Claude needs on each PC.', pages: ['/dependencies'], locked: 'It changes what is installed on your PCs.' },
  { key: 'mcps', group: 'pages', label: 'MCPs', blurb: 'The chats’ tools, across engines.', pages: ['/mcps'], locked: 'It installs tools for the chats on your PCs.' },
  { key: 'setup', group: 'pages', label: 'Setup', blurb: 'A new PC, step by step.', pages: ['/setup'], locked: 'It joins PCs to your app.' },
  { key: 'paperclip', group: 'pages', label: 'Paperclip', blurb: 'Goals, issues and runs (empty for now).', pages: ['/paperclip'] },
  { key: 'schedules', group: 'pages', label: 'Schedules', blurb: 'Scheduled runs (empty for now).', pages: ['/schedules'] },
  { key: 'phone-app', group: 'pages', label: 'Phone app', blurb: 'The Android apps, to download.', pages: ['/phone-app'] },
  // PC control's tabs (order odbd8's list of tabs; the page itself is above).
  { key: 'pc-chats', group: 'pc-control', label: 'Chat 1 and Chat 2', blurb: 'Each PC’s two pinned chats (a chat restricted to someone stays so).', needs: 'pc-control' },
  { key: 'pc-screen', group: 'pc-control', label: 'Screen', blurb: 'Controlling a PC’s screen.', needs: 'pc-control', locked: 'It controls your PCs’ screens and keyboards.' },
  // Order o226e: a PC's own Linux desktop (noVNC), its own row, locked like Screen.
  { key: 'pc-desktop', group: 'pc-control', label: 'XFCE', blurb: 'A Linux PC’s own desktop (XFCE through noVNC), where it has one.', needs: 'pc-control', locked: 'It controls your PCs’ desktops and keyboards.' },
  { key: 'pc-updates', group: 'pc-control', label: 'Updates', blurb: 'Updating each PC.', needs: 'pc-control', locked: 'It updates and restarts your PCs.' },
  { key: 'pc-ports', group: 'pc-control', label: 'Ports', blurb: 'Each PC’s ports and Tailscale addresses, read only.', needs: 'pc-control' },
  // Order o68f0 (Shubham: "We need you to have tools to do this please, so the users I give this access to can control this PC."): chosen per PC.
  {
    key: 'pc-ssh',
    group: 'pc-control',
    label: 'SSH',
    blurb: 'A live terminal on the PCs you choose, through the Server’s own SSH key: they can do there what that login can, and their own Assistant may use it by the same rules (it never types a password; what deletes or shuts down waits for their tap).',
    needs: 'pc-control',
    perPc: true,
  },
  { key: 'pc-resources', group: 'pc-control', label: 'Resources', blurb: 'Each PC’s CPU, memory, drives and processes, read only.', needs: 'pc-control' },
  { key: 'pc-deps', group: 'pc-control', label: 'Dependencies', blurb: 'What the app needs on each PC and the command that fixes a missing one, read only.', needs: 'pc-control' },
  // The Assistant, voice and talk.
  { key: 'assistant', group: 'assistant', pages: ['/assistant-history'], label: 'Their own Assistant', blurb: 'The Assistant overlay, with each person’s own Assistant (it comes with F-162).' },
  { key: 'voice', group: 'assistant', label: 'Voice typing', blurb: 'Speaking into a chat’s message box (the PC’s speech engine).' },
  // F-267 (order o088b): the Quick page is live talk on a page of its own, so it is this feature's page: locked, the owner's only.
  { key: 'talk', group: 'assistant', pages: [QUICK_ROUTE], label: 'Live talk', blurb: 'Talking with the Assistant out loud.', locked: 'Live talk goes to your own Assistant and its orders.' },
  // Settings.
  { key: 'settings', group: 'settings', label: 'Settings › Look and Chats', blurb: 'Their own light or dark, palette, page picker and chat choices (kept in their browser).', pages: ['/settings'] },
  { key: 'settings-admin', group: 'settings', label: 'Settings › Devices, Ports, Security', blurb: 'This PC’s devices, ports, sign-in level and updates.', pages: ['/devices', '/ports'], locked: 'They are this PC’s own settings.' },
  { key: 'access', group: 'settings', label: 'Settings › Access', blurb: 'This tab.', locked: 'Who gets what is yours to decide.' },
]

/** Order o929e: the starting set he may want for everyone, offered at the top of the tab (nothing is switched on for him). */
export const SUGGESTED: readonly string[] = ['assistant', 'agents', 'goals', 'crm-files']

const BY_KEY = new Map(FEATURES.map(f => [f.key, f]))
export const featureOf = (key: string): Feature | undefined => BY_KEY.get(key)

/** Order o68f0: a PC's device id (identity ids: 16 lower-case letters and digits). */
export const isPcId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{16}$/.test(v)
/** Order o68f0: the key a per-PC choice is kept under. */
export const perPcKey = (feature: string, pcId: string) => `${feature}@${pcId}`
/**
 * Order o68f0: a choice's key read back: its feature and, for a per-PC feature, the PC. Null for a key that is no feature's, a per-PC feature
 * without its PC (it has no whole choice) or a PC on a feature that is not chosen per PC.
 */
export function choiceKey(key: string): { feature: Feature; pcId: string | null } | null {
  const at = key.indexOf('@')
  const feature = featureOf(at < 0 ? key : key.slice(0, at))
  if (!feature) return null
  if (at < 0) return feature.perPc ? null : { feature, pcId: null }
  const pcId = key.slice(at + 1)
  return feature.perPc && isPcId(pcId) ? { feature, pcId } : null
}

/** The feature of a page of the app, or null for a page that is not one (anything not listed is the owner's). */
export function pageFeature(pathname: string): Feature | null {
  let best: { f: Feature; len: number } | null = null
  for (const f of FEATURES)
    for (const p of f.pages ?? []) {
      const hit = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
      if (hit && (!best || p.length > best.len)) best = { f, len: p.length }
    }
  return best?.f ?? null
}

/** PC control's tabs and the feature each needs. */
export const PC_TAB_FEATURE: Readonly<Record<string, string>> = { chat1: 'pc-chats', chat2: 'pc-chats', screen: 'pc-screen', desktop: 'pc-desktop', updates: 'pc-updates', ports: 'pc-ports', ssh: 'pc-ssh', resources: 'pc-resources', deps: 'pc-deps' }

// ---- the agent's routes (the path after /agent-api) and their features

export interface RouteRule {
  /** 'WS' for a WebSocket. */
  method: string
  path: RegExp
  /** Open when any of these is open to the person. */
  features: readonly string[]
  /** Open also to a person with an agent or floor shared with them (or made by them): the mount still shows them only those. */
  share?: true
}

const A = '\\/agentic'
const r = (method: string, path: string, features: readonly string[], share?: true): RouteRule => ({ method, path: new RegExp(`^${path}$`), features, ...(share ? { share } : {}) })
const FLOOR = `${A}\\/floors\\/[^/]+`
const AGENT = `${FLOOR}\\/agents\\/[^/]+`

export const ROUTES: readonly RouteRule[] = [
  // Agents: what the agentic mount lets a person in for (agent/agentic/access.ts POLICY's 'signed', 'create', 'chat', 'floor' and 'move' rules).
  r('GET', `${A}\\/floors`, ['agents', 'pc-control'], true),
  r('POST', `${A}\\/floors`, ['agents']),
  r('PATCH', FLOOR, ['agents'], true),
  r('DELETE', FLOOR, ['agents'], true),
  r('POST', `${FLOOR}\\/agents`, ['agents'], true),
  r('GET', `${FLOOR}\\/transcripts`, ['agents'], true),
  r('GET', `${FLOOR}\\/memory`, ['agents'], true),
  r('POST', `${FLOOR}\\/memory`, ['agents'], true),
  r('PATCH', `${FLOOR}\\/memory\\/[^/]+`, ['agents'], true),
  r('DELETE', `${FLOOR}\\/memory\\/[^/]+`, ['agents'], true),
  r('POST', `${AGENT}\\/(tune|move|chat|run-on|terminate|restart|session|say|say-direct|draft\\/clear|share|attach)`, ['agents'], true),
  // of95c (gate A): conversion-progress too (the chat's own owner's, agent/agentic/index.ts profileOwner), so a non-admin owner's page reads it.
  r('GET', `${AGENT}\\/(messages|chat|draft|deliveries|deliveries\\/[^/]+|attachment\\/[^/]+|conversion-progress)`, ['agents'], true),
  r('GET', `${A}\\/(offline-chats|codex\\/status|opencode\\/status|codex\\/settings|sync-mode|defaults|engine-switch-capabilities|previews|runs)`, ['agents', 'pc-control'], true),
  // o7e6d (refinement2 line 56): approvals and Send as me are the owner's only: no feature and no share opens them (the policy is OWNER in agent/agentic/access.ts).
  // Orders o66aa / oa76b / o7e97: except a floor's waiting prompts for the people he chose to decide for it, who are always people the floor is
  // shared with: so a share (no feature) lets the list and an answer or a cancel past this gate, and the routes decide (decides(): that chat's
  // floor, now). Send as me stays closed to everyone but him.
  r('GET', `${A}\\/approvals`, [], true),
  r('POST', `${A}\\/approvals\\/(answer|cancel)`, [], true),
  r('WS', `${A}\\/(terminal|chat)`, ['agents', 'pc-chats'], true),
  r('WS', `${A}\\/events`, ['agents', 'pc-control'], true),
  // The Assistant's hands on this person's own pages (order o355e made the bridge per person: their pages join only their own scope).
  r('WS', `${A}\\/ui`, ['assistant']),
  // F-162 slice A: a person's own Assistant floor (agent/agentic/own-assistant.ts): read it, and make it on their first open.
  r('GET', `${A}\\/own-assistant`, ['assistant']),
  r('POST', `${A}\\/own-assistant`, ['assistant']),
  r('GET', `${A}\\/assistant-history`, ['assistant']),
  // PC control: the page, its chats, and the read-only tabs. Order o68f0: SSH (its mount checks each PC: allows(caller, 'pc-ssh', pcId)).
  r('GET', '\\/pc-ssh\\/pcs\\/[^/]+\\/(target|sessions|status)', ['pc-ssh']),
  r('POST', '\\/pc-ssh\\/pcs\\/[^/]+\\/(session|test)', ['pc-ssh']),
  r('WS', '\\/pc-ssh\\/terminal', ['pc-ssh']),
  r('GET', `${A}\\/pc-control`, ['pc-control']),
  r('GET', `${A}\\/pc-control\\/pcs\\/[^/]+`, ['pc-control']),
  r('POST', `${A}\\/pc-control\\/pcs\\/[^/]+\\/slots\\/[^/]+\\/(open|stop|engine)`, ['pc-chats']),
  r('GET', '\\/pc-ports\\/pcs\\/[^/]+', ['pc-ports']),
  r('GET', '\\/pc-resources\\/pcs\\/[^/]+', ['pc-resources']),
  r('GET', '\\/pc-deps\\/pcs\\/[^/]+', ['pc-deps']),
  // Tasks (his one list), the old-app reader's page, the phone apps, voice typing.
  r('GET', `${A}\\/tasks`, ['tasks']),
  r('POST', `${A}\\/tasks`, ['tasks']),
  r('PATCH', `${A}\\/tasks\\/[^/]+`, ['tasks']),
  r('DELETE', `${A}\\/tasks\\/[^/]+`, ['tasks']),
  r('WS', `${A}\\/old`, ['old-reader']),
  r('GET', '\\/phone-apps(\\/.*)?', ['phone-app']),
  r('GET', '\\/speech\\/(status|voices)', ['voice']),
  r('POST', '\\/speech\\/(warm|transcribe)', ['voice']),
  r('WS', '\\/speech\\/stream', ['voice']),
  // Goals and the CRM: on the person's own CRM sign-in (agent/agentic/index.ts, the CRM proxy).
  r('*', `${A}\\/crm-proxy\\/.*`, ['goals', 'crm']),
  // CRM files: the CRM's own operations, which order oc186's slice 2 (Agent 5) runs on the person's own CRM session. Inert while 'crm-files' is
  // locked; that slice unlocks it. The PC's own parts (the drive, pins, spool, uploads) are listed nowhere, so they stay the owner's.
  r('GET', `${A}\\/crm-files\\/(status|children|search|node|file|versions)`, ['crm-files']),
  r('POST', `${A}\\/crm-files\\/(upload|version|folder|rename|move)`, ['crm-files']),
]

/**
 * The CRM paths the Goals page and the overlay's Goals tab use (src/goals/api.ts): all that Goals alone opens on the CRM proxy, on the person's own
 * CRM sign-in. The CRM feature opens every path (still their own sign-in, so the CRM decides).
 */
// Plain segments only (letters, digits, "-" and "_"): no dots and no "%", so nothing like "goals/../finance" can climb out of these paths.
export const GOALS_CRM_PATH = /^v1\/(auth\/me|org\/(goals|bucket|members|projects|services)(\/[A-Za-z0-9_-]+)*)$/

/** The rule of a route, or null when it is no feature's (a person who is not the owner is then refused it). */
export function routeRule(method: string, path: string): RouteRule | null {
  const m = method.toUpperCase()
  return ROUTES.find(x => (x.method === '*' || x.method === m) && x.path.test(path)) ?? null
}

/** Whether a choice opens a feature to this person (the owner has everything anyway, and a locked feature nobody else). */
export function choiceOpens(choice: AccessChoice, personId: string): boolean {
  if (choice.mode === 'everyone') return true
  return choice.mode === 'people' && choice.people.includes(personId.toLowerCase())
}

// ---- the tab's data

export interface AccessPerson {
  id: string
  name: string
  username: string | null
}

export interface AccessChange {
  at: string
  /** Who changed it (the owner). */
  by: { id: string; name: string }
  feature: string
  /** Order o68f0: the PC, for a feature chosen per PC. */
  pcId?: string
  from: AccessChoice
  to: AccessChoice
}

/** What Settings › Access reads: every feature's choice, the names of the people chosen, and the latest changes (newest first). */
export interface AccessView {
  choices: Record<string, AccessChoice>
  people: AccessPerson[]
  log: AccessChange[]
}

const CRM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A choice as sent to the agent, checked: a known mode, CRM user ids only (no duplicates); null when it is not one. */
export function cleanChoice(v: unknown): AccessChoice | null {
  if (!obj(v) || !ACCESS_MODES.includes(v.mode as AccessMode)) return null
  if (v.mode !== 'people') return { mode: v.mode as AccessMode, people: [] }
  if (!Array.isArray(v.people) || v.people.length > MAX_PEOPLE || !v.people.every(p => typeof p === 'string' && CRM_ID.test(p.toLowerCase()))) return null
  return { mode: 'people', people: [...new Set(v.people.map(p => (p as string).toLowerCase()))] }
}

/** Order o929e: whether anything at all is open to others (the tab says "Nothing is open to others yet" while not). */
export const anythingOpen = (choices: Readonly<Record<string, AccessChoice>>) =>
  Object.entries(choices).some(([k, c]) => { const ck = choiceKey(k); return !!ck && !ck.feature.locked && (c.mode === 'everyone' || (c.mode === 'people' && c.people.length > 0)) })

/** The features open to everyone signed in, or to this person: what the page shows them (the owner has every one). */
export function openTo(choices: Readonly<Record<string, AccessChoice>>, personId: string): string[] {
  const out: string[] = []
  for (const f of FEATURES) {
    if (f.locked) continue
    if (!f.perPc) {
      if (choiceOpens(choices[f.key] ?? OWNER_ONLY, personId)) out.push(f.key)
      continue
    }
    // Order o68f0: a per-PC feature: its key (open on at least one PC) and one '<key>@<pcId>' for each PC open to them.
    const pcs = Object.entries(choices).filter(([k, c]) => choiceKey(k)?.feature === f && choiceOpens(c, personId)).map(([k]) => k)
    if (pcs.length) out.push(f.key, ...pcs.sort())
  }
  return out
}
