import {
  SBSKRRT_ID,
  chatRights,
  scopeFloors,
  type AuthPerson,
  type AuthScope,
  type ChatAccess,
  type ChatCan,
  type ChatOwner,
} from '../../shared/auth.ts'
import { isPersonAssistant, type Floor, type FloorAgent } from '../../shared/agentic.ts'
import { OLD_STAFF_TYPING, type StaffTyping } from '../../shared/staff-typing.ts'
import type { Auth } from '../auth/index.ts'
import { authError, OPEN, type Caller } from '../auth/types.ts'

// F-118: who may do what with a chat, a floor and the PC's own pages. ONE place: the routes, the
// sockets and the chats' tools all ask here. The rule: a person (or the open app, where nobody has
// to sign in) is `owner` of their own chats, `type` or `view` on those shared with them, everything
// for sbskrrt (the admins), nothing on the rest. A route that is not in POLICY is for the owner of
// the app only (fail closed); the test in access.test.ts keeps POLICY and the route table equal.

/** What sbskrrt is as an owner of chats: the migration's owner, and the owner of what the open app (nobody signed in) makes. */
export const SBSKRRT_OWNER: ChatOwner = { id: SBSKRRT_ID, username: 'sbskrrt', name: 'Shubham Bhole' }

export type Need = 'view' | 'type' | 'owner'

export type Rule =
  /** The PC's own pages and settings: the owner of the app only (and the open app). */
  | { kind: 'owner' }
  /** Anyone past the sign-in gate; the answer is filtered for them inside. */
  | { kind: 'signed' }
  /** Anyone past the gate; what is made is theirs. */
  | { kind: 'create' }
  /** The chat of agent #agent on floor #floor (the index of the path's capture) needs this much. */
  | { kind: 'chat'; need: Need; floor: number; agent: number }
  /** A floor (capture #floor): 'view' sees it; 'manage' changes it (its maker, or the owner of the app); 'delete' also owns every chat on it. */
  | { kind: 'floor'; need: 'view' | 'manage' | 'delete'; floor: number }
  /** Moving an agent: its chat, and both floors. */
  | { kind: 'move'; floor: number; agent: number }
  /** The route checks for itself (a chat's own key). */
  | { kind: 'self' }

const OWNER: Rule = { kind: 'owner' }
const SIGNED: Rule = { kind: 'signed' }
const chat = (need: Need): Rule => ({ kind: 'chat', need, floor: 0, agent: 1 })
const floor = (need: 'view' | 'manage' | 'delete'): Rule => ({ kind: 'floor', need, floor: 0 })

/** Every route of the agentic mount and what it needs. Keyed by method and the route's own regular expression. */
export const POLICY: readonly [string, RegExp, Rule][] = [
  ['GET', /^\/pc-control$/, SIGNED],
  ['GET', /^\/pc-control\/pcs\/([^/]+)$/, SIGNED],
  ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/open$/, SIGNED],
  ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/stop$/, SIGNED],
  ['POST', /^\/pc-control\/pcs\/([^/]+)\/slots\/([^/]+)\/engine$/, SIGNED],
  ['GET', /^\/watchdog$/, OWNER],
  ['GET', /^\/accounts\/email$/, OWNER],
  // Databases section: the two fixed databases and their pings (the owner's only).
  ['GET', /^\/accounts\/databases$/, OWNER],
  ['POST', /^\/accounts\/databases\/([^/]+)\/ping$/, OWNER],
  // Add codebase: a codebase made in the app (the owner's only).
  ['POST', /^\/accounts\/codebases$/, OWNER],
  // Codebase details slice: the codebase's details (the owner's only).
  ['PUT', /^\/accounts\/codebases\/([^/]+)$/, OWNER],
  // Accounts edit slice: the platform accounts edit, disable and enable (the owner's only).
  ['POST', /^\/accounts\/platforms$/, OWNER],
  ['PUT', /^\/accounts\/platforms\/([^/]+)$/, OWNER],
  ['POST', /^\/accounts\/platforms\/([^/]+)\/disable$/, OWNER],
  ['POST', /^\/accounts\/platforms\/([^/]+)\/enable$/, OWNER],
  // F-293 (his decision "A"): the platform account's password: Reveal, Disable password, Enable password (the owner's only; the routes are humanOnly as well). There is no remove.
  ['POST', /^\/accounts\/platforms\/([^/]+)\/password\/reveal$/, OWNER],
  ['POST', /^\/accounts\/platforms\/([^/]+)\/password\/disable$/, OWNER],
  ['POST', /^\/accounts\/platforms\/([^/]+)\/password\/enable$/, OWNER],
  // Order o8ebe: the password reveal (the owner's only).
  ['POST', /^\/accounts\/email\/([^/]+)\/reveal$/, OWNER],
  // Order ofd53: the email edit modal (the owner's only).
  ['POST', /^\/accounts\/email$/, OWNER],
  ['PUT', /^\/accounts\/email\/([^/]+)$/, OWNER],
  // Slice D (disable, never delete): the five DELETE routes of the Accounts page are gone; each kind is disabled and enabled again.
  ['POST', /^\/accounts\/email\/([^/]+)\/disable$/, OWNER],
  ['POST', /^\/accounts\/email\/([^/]+)\/enable$/, OWNER],
  ['POST', /^\/accounts\/email\/import$/, OWNER],
  ['GET', /^\/accounts\/platforms$/, OWNER],
  ['GET', /^\/accounts\/codebases$/, OWNER],
  ['POST', /^\/accounts\/codebases\/import$/, OWNER],
  // Order ocf00: the codebase tabs (the owner's only).
  ['GET', /^\/accounts\/codebases\/([^/]+)\/tabs$/, OWNER],
  ['PUT', /^\/accounts\/codebases\/([^/]+)\/sections\/([^/]+)$/, OWNER],
  ['POST', /^\/accounts\/codebases\/([^/]+)\/links$/, OWNER],
  ['PUT', /^\/accounts\/links\/([^/]+)$/, OWNER],
  ['POST', /^\/accounts\/links\/([^/]+)\/disable$/, OWNER],
  ['POST', /^\/accounts\/links\/([^/]+)\/enable$/, OWNER],
  ['POST', /^\/accounts\/codebases\/([^/]+)\/subsets$/, OWNER],
  ['PUT', /^\/accounts\/subsets\/([^/]+)$/, OWNER],
  ['POST', /^\/accounts\/subsets\/([^/]+)\/disable$/, OWNER],
  ['POST', /^\/accounts\/subsets\/([^/]+)\/enable$/, OWNER],
  ['POST', /^\/accounts\/subsets\/([^/]+)\/vars$/, OWNER],
  ['PUT', /^\/accounts\/vars\/([^/]+)$/, OWNER],
  ['POST', /^\/accounts\/vars\/([^/]+)\/disable$/, OWNER],
  ['POST', /^\/accounts\/vars\/([^/]+)\/enable$/, OWNER],
  ['POST', /^\/accounts\/vars\/([^/]+)\/reveal$/, OWNER],
  // Order o94f3: the Env tab's "+" and its ".env" paste box, and "show all" (the owner's only; the routes are humanOnly as well).
  ['POST', /^\/accounts\/codebases\/([^/]+)\/env$/, OWNER],
  ['POST', /^\/accounts\/subsets\/([^/]+)\/reveal$/, OWNER],
  ['GET', /^\/fast\/names$/, OWNER],
  ['GET', /^\/fast\/forwarding$/, OWNER],
  ['PUT', /^\/fast\/forwarding$/, OWNER],
  ['POST', /^\/fast\/names$/, OWNER],
  ['GET', /^\/fast\/settings$/, OWNER],
  ['PUT', /^\/fast\/settings$/, OWNER],
  // F-345: "Chats put tasks in Goals" (the first owner's only: the route asks for the first owner by id, and a signed-in person for the PUT).
  ['GET', /^\/chat-settings$/, OWNER],
  ['PUT', /^\/chat-settings$/, OWNER],
  ['GET', /^\/heartbeat$/, OWNER],
  ['POST', /^\/heartbeat\/morning$/, OWNER],
  ['PATCH', /^\/heartbeat$/, OWNER],
  ['POST', /^\/heartbeat\/beat$/, OWNER],
  // F-359: a chat's goals heartbeat: read all, and the switch of one chat (the first owner's only; the routes ask for a signed-in human and the first owner by id before anything is read or written).
  ['GET', /^\/beats$/, OWNER],
  ['PUT', /^\/floors\/([^/]+)\/agents\/([^/]+)\/beat$/, OWNER],
  ['GET', /^\/floors$/, SIGNED],
  ['GET', /^\/goal-floors$/, OWNER],
  // F-361: what the agents reported on one floor's goals, and who made each (the first owner's page only; the route asks for a signed-in person and the first owner by id before it reads the file).
  ['GET', /^\/floors\/([^/]+)\/goal-progress$/, OWNER],
  // F-362: his answer to a goal that waits for him, and his "Not waiting any more" (the first owner's page only; human-only; every check comes before the wait file is read).
  ['POST', /^\/floors\/([^/]+)\/goals\/([^/]+)\/answer$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/goals\/([^/]+)\/dismiss$/, OWNER],
  ['PUT', /^\/floors\/([^/]+)\/goal-order$/, OWNER],
  // F-343: a goal added by hand in the goals curtain (the owner's page only; the route asks for a signed-in human and the first owner by id before it touches the CRM).
  ['POST', /^\/floors\/([^/]+)\/goals$/, OWNER],
  // F-344b: a goal changed by hand (the Edit goal form) and a goal's history read (the History modal): the owner's page only; the routes ask for a signed-in human and the first owner by id before the CRM is touched.
  ['PATCH', /^\/floors\/([^/]+)\/goals\/([^/]+)$/, OWNER],
  ['GET', /^\/floors\/([^/]+)\/goals\/([^/]+)\/history$/, OWNER],
  // F-354: a note added to a goal's history by hand (the History modal): the owner's page only; the route asks for a signed-in human and the first owner by id before it touches the CRM.
  ['POST', /^\/floors\/([^/]+)\/goals\/([^/]+)\/notes$/, OWNER],
  ['GET', /^\/offline-chats$/, SIGNED],
  // F-211: the conversations' copy in the CRM drive, chat by chat (the owner of the app only).
  ['GET', /^\/conversations-drive$/, OWNER],
  // F-134: Codex on this PC: its status (names only), asking the CRM now, and the setting.
  ['GET', /^\/codex\/status$/, SIGNED],
  ['GET', /^\/opencode\/status$/, SIGNED],
  ['POST', /^\/codex\/refresh$/, OWNER],
  // F-165: what Codex in Claude Code needs on each PC (versions, sign-in, setup state): the owner of the app only.
  ['GET', /^\/dependencies$/, OWNER],
  // F-168 part 2: every MCP server on each PC and the register-only install: the owner of the app, and the route itself also needs a signed-in CRM administrator.
  ['GET', /^\/mcp-inventory$/, OWNER],
  // F-350: which Claude subscription each PC runs on (the first owner of the app; the route itself also needs a signed-in CRM person and the first owner by id).
  ['GET', /^\/claude-pcs$/, OWNER],
  ['POST', /^\/claude-pcs\/preview$/, OWNER],
  ['POST', /^\/claude-pcs\/switch$/, OWNER],
  ['POST', /^\/claude-pcs\/restart$/, OWNER],
  ['GET', /^\/claude-pcs\/restart\/([^/]+)$/, OWNER],
  // F-351: the PC's own key: the owner gives a PC one and takes it away (the route itself also asks for the first owner, by id, like the ones above).
  ['POST', /^\/claude-pcs\/key$/, OWNER],
  ['POST', /^\/claude-pcs\/key\/take-away$/, OWNER],
  ['POST', /^\/claude-pcs\/refresh$/, OWNER],
  ['POST', /^\/mcp-install\/plan$/, OWNER],
  ['POST', /^\/mcp-install$/, OWNER],
  ['POST', /^\/mcp-remove$/, OWNER],
  // F-349: give a server of a PC's own list to every chat that starts on it (the owner's page only; the route asks for a signed-in human)
  ['POST', /^\/mcp-default$/, OWNER],
  ['GET', /^\/codex\/settings$/, SIGNED],
  ['PUT', /^\/codex\/settings$/, OWNER],
  ['PUT', /^\/offline-chats$/, OWNER],
  // Stage 1 (o400b): the "Old way" switch of this PC's chat-terminal layer: every page reads it (it shows chats by it), only the owner changes it.
  ['GET', /^\/sync-mode$/, SIGNED],
  ['POST', /^\/sync-mode$/, OWNER],
  ['GET', /^\/sessions$/, OWNER],
  ['GET', /^\/sessions\/copy-all$/, OWNER],
  ['POST', /^\/sessions\/copy-all$/, OWNER],
  ['POST', /^\/floors$/, { kind: 'create' }],
  ['POST', /^\/floors\/reorder$/, OWNER],
  ['PATCH', /^\/floors\/([^/]+)$/, floor('manage')],
  ['DELETE', /^\/floors\/([^/]+)$/, floor('delete')],
  ['GET', /^\/defaults$/, SIGNED],
  ['GET', /^\/engine-switch-capabilities$/, SIGNED],
  ['PUT', /^\/defaults$/, OWNER],
  // Settings › Assistant › "Goals on mobile: use the API": the owner's own setting, for the owner's own Assistant.
  ['GET', /^\/assistant-settings$/, OWNER],
  ['PUT', /^\/assistant-settings$/, OWNER],
  // Order o5007: Settings › Old app reader (the switch, the model, the old app's folder it reads): the owner of the app only.
  ['GET', /^\/old\/settings$/, OWNER],
  ['PUT', /^\/old\/settings$/, OWNER],
  // Order o7f34: the Anthropic API key (owner only: it is the owner's key, on the Server).
  ['PUT', /^\/old\/api-key$/, OWNER],
  ['DELETE', /^\/old\/api-key$/, OWNER],
  ['POST', /^\/old\/api-key\/test$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/tune$/, chat('owner')],
  // o7e6d (refinement2 line 56): the owner's only, human proof on top (humanTarget in index.ts).
  // Orders o66aa / oa76b / o7e97 (his "1A"): a floor's waiting prompts, and answering or cancelling one, also for the people he chose to decide
  // for that floor. Signed in here; the routes themselves decide who (requireCrmHuman, then listApprovals / humanTarget with decides(), read
  // at every step): the owner of the app, or a decision-maker for that chat's floor now, and nobody else (refused 403 admin-only, as before).
  ['GET', /^\/approvals$/, SIGNED],
  ['POST', /^\/approvals\/answer$/, SIGNED],
  ['POST', /^\/approvals\/cancel$/, SIGNED],
  // F-294 (his o8c55, "give button ignroe pleae"): hide a card from the person who taps (Ignore), bring it back (Restore), and read which prompts they have ignored (the badge).
  // The same people as the list and with Cancel's proof (requireCrmHuman, then rights on that chat's floor: the owner, or a decision-maker now). Nothing is ever typed.
  ['POST', /^\/approvals\/ignore$/, SIGNED],
  ['POST', /^\/approvals\/restore$/, SIGNED],
  ['GET', /^\/approvals\/ignored$/, SIGNED],
  ['POST', /^\/send-as-me$/, OWNER],
  // o0c50 / o66aa: where each floor's decisions go ("Decisions go to…"). The owner's only (and a change takes his CRM session on the Server's page).
  ['GET', /^\/question-routing$/, OWNER],
  ['PUT', /^\/question-routing\/([^/]+)$/, OWNER],
  // Orders of95c / o9ccb / ocf0e: which chats a non-owner may type into. The owner's only (and a change also takes his signed-in CRM session on
  // the Server's own page, in the route itself: never a chat's key, a member PC's word, or a name in the body).
  ['GET', /^\/staff-typing$/, OWNER],
  ['PUT', /^\/staff-typing$/, OWNER],
  // F-302 L4: the PCs the owner marks as his (owner-pcs.ts): the owner's only, and a signed-in human's (the route asks requireCrmHuman).
  ['GET', /^\/owner-pcs$/, OWNER],
  ['PUT', /^\/owner-pcs$/, OWNER],
  // F-221 (ob98a): live talk's cards and direct line: the owner's page (and Send also takes his signed-in CRM session, in the route itself).
  ['GET', /^\/talk\/cards$/, OWNER],
  ['POST', /^\/talk\/cards\/([^/]+)\/send$/, OWNER],
  ['POST', /^\/talk\/cards\/([^/]+)\/drop$/, OWNER],
  ['POST', /^\/talk\/ask$/, OWNER],
  ['GET', /^\/talk\/ask\/([^/]+)$/, OWNER],
  // F-221 (T4): his Let go on a direct line (the route also takes his signed-in CRM session), and the voice lock's reach.
  ['POST', /^\/talk\/ask\/([^/]+)\/let-go$/, OWNER],
  ['GET', /^\/talk\/caps$/, OWNER],
  ['GET', /^\/auto-update$/, OWNER],
  ['POST', /^\/auto-update$/, OWNER],
  ['GET', /^\/approvals\/devices$/, OWNER],
  ['POST', /^\/approvals\/devices\/code$/, OWNER],
  ['POST', /^\/approvals\/devices\/register$/, OWNER],
  ['GET', /^\/approvals\/devices\/recover$/, OWNER],
  ['POST', /^\/approvals\/devices\/recover\/start$/, OWNER],
  ['POST', /^\/approvals\/devices\/recover\/finish$/, OWNER],
  ['POST', /^\/approvals\/devices\/remove$/, OWNER],
  ['POST', /^\/approvals\/devices\/unsigned$/, OWNER],
  ['GET', /^\/approvals\/log$/, OWNER],
  // The floors' structural history (floor-events.ts): who made, removed, adopted, filled, moved or shared what. The owner's only; no ROUTES rule opens it; the route is humanOnly as well (R6).
  ['GET', /^\/floor-events$/, OWNER],
  // Order o5d4e: the switch for buttons on claude's unnumbered selects: the owner's.
  ['GET', /^\/approvals\/arrow-prompts$/, OWNER],
  ['PUT', /^\/approvals\/arrow-prompts$/, OWNER],
  // Who was present at a chat (chat-presence.ts): keys that reached a terminal (their class, never the keys) and the screen an Assistant drove (the kind of act, never what).
  // The owner's only; no ROUTES rule opens it, so no feature or share does either; the route is humanOnly as well (R6).
  ['GET', /^\/chat-presence$/, OWNER],
  // F-297: what a person's own Assistant sent and where, never the text (staff-sends.ts). The owner's only; no ROUTES rule opens it, and the route is humanOnly as well.
  ['GET', /^\/staff-sends$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/agents$/, floor('manage')],
  // F-316 T2: a copy of a chat lands on a floor like an add does (the floor's 'manage'); the route itself asks that the caller owns the SOURCE chat. Stamping a floor's chats with a template, and its undo:
  // the owner's only (the route asks for the FIRST owner by id and refuses a chat's key); no ROUTES rule opens them.
  ['POST', /^\/floors\/([^/]+)\/agents\/copy$/, floor('manage')],
  ['POST', /^\/floors\/([^/]+)\/template$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/template\/undo$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/move$/, { kind: 'move', floor: 0, agent: 1 }],
  // F-235 (order o7c1c): a conversation from any of the PCs onto a floor: the owner of the app only (as listing them is).
  ['POST', /^\/floors\/([^/]+)\/import$/, OWNER],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/chat$/, chat('owner')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/run-on$/, chat('owner')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/terminate$/, chat('owner')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/restart$/, chat('owner')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/session$/, chat('owner')],
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/messages$/, chat('view')],
  // Order obb81: the Agents page's look at one agent (its notes, its project folder's memory files, its last replies): the owner's only for now.
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/brain$/, OWNER],
  ['GET', /^\/floors\/([^/]+)\/transcripts$/, floor('view')],
  // F-162 slice A: a person's own Assistant floor; the feature 'assistant' opens it (shared/access.ts ROUTES), the owner rule otherwise.
  ['GET', /^\/own-assistant$/, OWNER],
  ['POST', /^\/own-assistant$/, OWNER],
  // Order o7e6d (Agent 12, agreed with Agent 7): the staff preflight, the owner of the app only.
  ['GET', /^\/staff\/preflight$/, OWNER],
  // Order oa09e: his overlay Assistant (the hub's Orchestrator), found or made by the hub from its whole list. His only (not in Settings › Access).
  ['POST', /^\/assistant$/, OWNER],
  // The handler returns only this person's own bindings and journal, not shared chats or arbitrary files.
  ['GET', /^\/assistant-history$/, SIGNED],
  ['GET', /^\/tasks$/, OWNER],
  ['POST', /^\/tasks$/, OWNER],
  ['PATCH', /^\/tasks\/([^/]+)$/, OWNER],
  ['DELETE', /^\/tasks\/([^/]+)$/, OWNER],
  ['GET', /^\/crm$/, OWNER],
  ['PATCH', /^\/crm$/, OWNER],
  ['GET', /^\/crm\/session$/, OWNER],
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/chat$/, chat('view')],
  ['GET', /^\/previews$/, SIGNED],
  ['GET', /^\/runs$/, SIGNED],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/say$/, chat('type')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/say-direct$/, chat('type')],
  // o4743: what the input line holds, and one tap that clears an unsent draft there.
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/draft$/, chat('type')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/draft\/clear$/, chat('type')],
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/deliveries$/, chat('type')],
  ['GET', /^\/floors\/([^/]+)\/agents\/([^/]+)\/deliveries\/([^/]+)$/, chat('type')],
  ['POST', /^\/floors\/([^/]+)\/agents\/([^/]+)\/share$/, chat('owner')],
  ['GET', /^\/floors\/([^/]+)\/memory$/, floor('view')],
  ['POST', /^\/floors\/([^/]+)\/memory$/, floor('manage')],
  ['PATCH', /^\/floors\/([^/]+)\/memory\/([^/]+)$/, floor('manage')],
  ['DELETE', /^\/floors\/([^/]+)\/memory\/([^/]+)$/, floor('manage')],
  ['POST', /^\/mcp\/call$/, { kind: 'self' }],
  ['GET', /^\/mcp\/tools$/, { kind: 'self' }],
  ['POST', /^\/mcp\/recall$/, { kind: 'self' }],
  ['GET', /^\/memory\/status$/, OWNER],
  ['GET', /^\/memory\/search$/, OWNER],
  ['GET', /^\/memory\/wiki$/, OWNER],
  ['GET', /^\/memory\/page$/, OWNER],
  ['GET', /^\/memory\/read$/, OWNER],
  ['GET', /^\/memory\/brief$/, OWNER],
  ['POST', /^\/memory\/compile$/, OWNER],
  ['PATCH', /^\/memory\/settings$/, OWNER],
  // F-332 step 1: the NEW standalone memory (memory-door.ts), read only: the owner's only (no ROUTES rule opens it to a feature or a share); the routes themselves ask for a signed-in human and the first owner by id.
  ['GET', /^\/memory\/new\/status$/, OWNER],
  ['GET', /^\/memory\/new\/brain$/, OWNER],
  // F-309 N1: the agent notebooks (memory-notebook.ts): the table, the notes, the held list, the refusals log. The owner of the app's only: the routes themselves ask for the first owner
  // (a second owner does not read or erase them) and refuse a chat's key (index.ts notebookOwner).
  ['GET', /^\/notebooks$/, OWNER],
  ['PATCH', /^\/notebooks\/settings$/, OWNER],
  ['GET', /^\/notebooks\/([a-z0-9-]+)\/(notes|held|log)$/, OWNER],
  ['POST', /^\/notebooks\/([a-z0-9-]+)\/held\/([^/]+)$/, OWNER],
  ['POST', /^\/notebooks\/([a-z0-9-]+)\/notes\/([^/]+)\/share$/, OWNER],
  ['DELETE', /^\/notebooks\/([a-z0-9-]+)\/notes\/([^/]+)$/, OWNER],
]

const policyKey = (method: string, pattern: RegExp) => `${method} ${pattern.source}`
const RULES = new Map(POLICY.map(([m, p, r]) => [policyKey(m, p), r]))

/** The rule for a route of the agentic table (undefined: not listed, so for the owner only). */
export const ruleOf = (method: string, pattern: RegExp): Rule | undefined => RULES.get(policyKey(method, pattern))

/** The route table's keys, so a test can hold POLICY and the table equal. */
export const policyKeys = (): string[] => [...RULES.keys()]
export { policyKey }

export interface Access {
  /** Whether this caller is the owner of the app (or the app is open). */
  isAdmin(c: Caller): boolean
  /** The person as an owner, to put on what they make: the open app's caller is sbskrrt. */
  ownerOf(c: Caller): ChatOwner
  rights(c: Caller, agent: FloorAgent): { access: ChatAccess; can: ChatCan } | null
  /** Throws 403 not-yours unless the caller has this much on that chat. `route` and `sid` are for the log. */
  needChat(c: Caller, agent: FloorAgent, need: Need, route: string): void
  /**
   * May this caller type into this chat (the terminal's keys, a message, a draft, a file)? The owner of the app: every chat. Anyone else: their
   * own Assistant, and by his choice (staff-typing.ts, of95c / o9ccb / ocf0e) a chat they own and one shared to them as "Can type".
   */
  mayType(c: Caller, agent: FloorAgent): boolean
  /**
   * F-300 S3 (Lead's safe default; his o2f56: "I don't think anyone should be able to talk on the server"): do the owner's saved typing choice's own terms let a non-owner's keys reach this chat's PC at all? A chat that is not the Server's: yes. A chat that is
   * the Server's (it runs as the Server's Windows user, with full tools): only on the one choice that opens typing there, 'owned-and-type-shares' with 'every-pc'; on the default, the 15 Nov rule or an unreadable choice: no. An access built with no choice at all
   * (tests, older callers): yes, as mayType. Asked by a decision-maker's door (index.ts decides()), whose digit is typing without being a share: one source of truth with mayType's scope line.
   */
  typingScopeOpen(agent: FloorAgent): boolean
  floorSeen(c: Caller, f: Floor): boolean
  /** Throws 403 not-yours unless the caller sees / manages / may delete the floor. */
  needFloor(c: Caller, f: Floor, need: 'view' | 'manage' | 'delete', route: string): void
  /** The floors as this caller may see them (scoped, tagged). */
  scope(c: Caller, floors: Floor[], scope?: AuthScope): Floor[]
  /** The session ids this caller may view; null = all of them. */
  visible(c: Caller, floors: Floor[]): Set<string> | null
  /** A chat's own caller: its owner, so what a chat's tools may do is what its owner may. */
  asChat(agent: FloorAgent): Caller
  deny(c: Caller, route: string, chatId?: string | null): void
}

/** Orders of95c / o9ccb / ocf0e: what decides a non-owner's typing (agent/agentic/staff-typing.ts). Left out (tests, older callers): the 15 Nov rule. */
export interface AccessTyping {
  /** The owner's choice now (on a member PC: the Server's, from its current state frame; the 15 Nov rule while it has none). */
  typing?: () => StaffTyping
  /** Whether a chat's home is the Server (for the 'not-on-server' scope). Left out, or unsure: true, so that scope stays closed. */
  serverChat?: (agent: FloorAgent) => boolean
  /**
   * F-300 S0: whether Settings > Access has the 'assistant' feature open to this (non-owner) caller NOW (read at every ask: closing it takes effect at once). While it is closed they have NO right on a
   * person's own Assistant, whatever they made or own: every door of that chat (needChat, mayType, visible, the sockets, the chat's own tools) asks rights(). Left out (tests, older callers): no gate.
   */
  assistantOpen?: (c: Caller) => boolean
}

export function createAccess(auth: Auth | undefined, onDeny?: (c: Caller, route: string, chatId: string | null) => void, o: AccessTyping = {}): Access {
  const admins = () => auth?.admins() ?? [SBSKRRT_ID]
  const isAdmin = (c: Caller) => (auth ? auth.isAdmin(c) : true)
  const person = (c: Caller): Pick<AuthPerson, 'id'> | null => c.person

  function rights(c: Caller, agent: FloorAgent) {
    if (agent.pcControlSlot) {
      if (c.machine) return { access: 'mine' as const, can: 'owner' as const }
      if (!c.person) return null
    }
    // F-300 S0: a person's own Assistant needs the 'assistant' feature open to them, on every door of the chat, not only on the two routes that name it (shared/access.ts ROUTES): they MADE its floor, so
    // the share clause let them in whatever Access said. Nothing changes for the owner of the app, or for any other agent.
    if (isPersonAssistant(agent) && !isAdmin(c) && o.assistantOpen && !o.assistantOpen(c)) return null
    return chatRights(person(c), agent.owner ?? null, agent.sharedWith ?? [], admins())
  }

  const deny = (c: Caller, route: string, chatId?: string | null) => {
    auth?.deny(c, 403, 'not-yours', route, chatId)
    onDeny?.(c, route, chatId ?? null)
  }

  /**
   * o7e6d (Lead's B2): a non-owner types only into their OWN person-assistant; every other chat they see is view only. The owner: as before.
   * Orders of95c / o9ccb / ocf0e (Shubham, 16 Nov: "yes", then "A"): this deliberately REVERSES B2's 15 Nov staff rule (refinement2 line 53),
   * by default and as a choice that keeps the old rule (staff-typing.ts): a non-owner may also type into a chat they OWN and one shared to
   * them as "Can type", on every PC. Never a "Can view" share (refused above), never another person's Assistant (theirs alone, whatever it is
   * shared as), never a PC-control slot (its own branch in rights(); not opened by owning or sharing), and with the 'not-on-server' scope never
   * a chat whose home is the Server (it runs as the Server's Windows user with full tools). The staff fence (runFenced) is a separate gate.
   */
  function mayType(c: Caller, agent: FloorAgent): boolean {
    const r = rights(c, agent)
    if (r === null || r.can === 'view') return false
    if (isAdmin(c)) return true
    if (!c.person) return false
    // A person's Assistant: its own person types into it, nobody else, under every choice (B2, unchanged: a "Can type" share does not open it).
    if (isPersonAssistant(agent)) return agent.owner?.id === c.person.id
    // PC control: never opened to a non-admin, by either choice.
    if (agent.pcControlSlot) return false
    const t = o.typing?.() ?? OLD_STAFF_TYPING
    // The 15 Nov rule, kept as his choice: nothing beyond their own Assistant.
    if (t.rule !== 'owned-and-type-shares') return false
    if (t.scope === 'not-on-server' && (o.serverChat?.(agent) ?? true)) return false
    // THE OWNER, on its own and not as a side effect of the widening (Shubham, 17 Nov, o808f: "the owner should be able to type"; a chat's owner types in their own chat): a person types in
    // a chat they own, whatever KIND of agent it is, because it is theirs. B2 let them type only into a person's Assistant, so the owner of a floor's Lead (an Orchestrator), or of any other
    // agent, could not type in what they had made. `access: 'mine'` is chatRights' own word for that: the chat's owner on record is this person.
    if (r.access === 'mine' && agent.owner?.id === c.person.id) return true
    // What the choice adds beyond that: a chat shared to them as "Can type".
    return r.access === 'shared' && r.can === 'type'
  }

  function typingScopeOpen(agent: FloorAgent): boolean {
    if (!o.typing) return true
    if (!(o.serverChat?.(agent) ?? true)) return true
    const t = o.typing()
    return t.rule === 'owned-and-type-shares' && t.scope === 'every-pc'
  }

  function needChat(c: Caller, agent: FloorAgent, need: Need, route: string) {
    const r = rights(c, agent)
    const ok = r !== null && (need === 'view' || (need === 'type' && mayType(c, agent)) || (need === 'owner' && r.can === 'owner'))
    if (ok) return
    deny(c, route, agent.sessionId)
    throw authError(403, r ? "You can only look at this chat; it isn't yours to change." : "That chat isn't yours.", 'not-yours')
  }

  const madeBy = (c: Caller, f: Floor) => !!c.person && f.createdBy?.id === c.person.id

  function floorSeen(c: Caller, f: Floor) {
    return isAdmin(c) || madeBy(c, f) || f.agents.some(a => rights(c, a) !== null)
  }

  function needFloor(c: Caller, f: Floor, need: 'view' | 'manage' | 'delete', route: string) {
    let ok: boolean
    if (isAdmin(c)) ok = true
    else if (need === 'view') ok = floorSeen(c, f)
    else if (need === 'manage') ok = madeBy(c, f)
    else ok = madeBy(c, f) && f.agents.every(a => rights(c, a)?.can === 'owner')
    if (ok) return
    deny(c, route)
    throw authError(403, floorSeen(c, f) ? "That floor isn't yours to change." : "That floor isn't yours.", 'not-yours')
  }

  return {
    isAdmin,
    ownerOf: c => (c.person ? { id: c.person.id, username: c.person.username, name: c.person.name } : SBSKRRT_OWNER),
    rights,
    mayType,
    typingScopeOpen,
    needChat,
    floorSeen,
    needFloor,
    scope: (c, floors, scope) => {
      if (scope === 'all' && !isAdmin(c)) throw authError(403, 'Only the owner of this app sees all chats.', 'not-yours')
      return scopeFloors(floors, person(c), admins(), scope)
    },
    visible(c, floors) {
      if (isAdmin(c) && (c.machine || c.person || !floors.some(f => f.workspace === 'pc-control'))) return null
      const out = new Set<string>()
      for (const f of floors) for (const a of f.agents) if (a.sessionId && rights(c, a)) out.add(a.sessionId)
      return out
    },
    asChat(agent) {
      const o = agent.owner
      if (!o) return OPEN
      return { person: { id: o.id, username: o.username, name: o.name, canSeeAll: admins().includes(o.id) }, via: 'local', sid: null }
    },
    deny,
  }
}
