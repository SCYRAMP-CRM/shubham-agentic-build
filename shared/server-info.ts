// F-368 (Shubham: an "i" button in the foot bar, beside the build icon, with two tabs: "What works" and "Data"): the words of the first tab, and the list of kinds of data the second tab sizes.
//
// EVERYTHING HERE IS FIXED TEXT, drawn as plain text nodes (never parsed): opening the panel asks the agent for nothing. What keeps it TRUE is shared/server-info.test.ts: every row that says it was read in the
// code names the file and an exact line of it (`source.quote`), and the test opens that file and finds the line, so a change to the code that touches the words fails the test until the words are looked at again.
// The tools that stop without the Server are pinned both ways to the real list (NEEDS_SERVER in agent/agentic/index.ts). A row that was NOT found in the code is not a claim: it is shown as "Not checked yet".
// Nothing about a person, a chat, a file name or a secret is in this file.

export const SERVER_INFO_LABEL = 'What works, and what the Server holds'
export const SERVER_INFO_BUTTON = 'What works and what the Server holds'
export const SERVER_INFO_ABOUT = 'Read from the code of this build. Each row says where it was read; a row that was not checked says so.'
/** The date the rows were true: each publish that changes what the Server does updates the rows and this date together. */
export const SERVER_INFO_AS_OF = 'As of 26 Nov 2026'

/** The one paragraph at the top: what a person most needs to know if the Server is down. */
export const SERVER_DOWN_SUMMARY =
  "With the Server down, the chats already running on a PC keep running and new Claude chats can be started there. The CRM, goals and that PC's own Claude usage keep working. Everything that needs a shared place (the chats' tools, memory, tasks, WhatsApp, a person's own Assistant, updates) waits for the Server."

/** Where a row was read: a file of this program and an exact line of it. A file under agent/SPEC.md is the written spec, not the code. */
export interface Source {
  file: string
  quote: string
}

export const isSpecSource = (s: Source): boolean => s.file === 'agent/SPEC.md'

export interface Fact {
  text: string
  source: Source
}

// ---------------------------------------------------------------------------------------------
// List 1: what the Server does.

export const SERVER_DOES_TITLE = 'What the Server does'
export const SERVER_DOES: readonly Fact[] = [
  {
    text: 'Keeps every floor, agent and chat, and which PC is running each chat (one PC at a time).',
    source: { file: 'agent/agentic/index.ts', quote: 'the floors, the memory and who holds each session (sessions.json)' },
  },
  {
    text: "Is where the chats' tools work. A chat on any PC asks the Server when it uses goals and the CRM, tasks, memory, the phone, WhatsApp, the screen, SSH or the Browser.",
    source: { file: 'agent/agentic/index.ts', quote: 'F-127: tools that live on the Server only' },
  },
  {
    text: "Keeps the memory: the memory layer and each agent's notebook, whichever PC the chat runs on.",
    source: { file: 'agent/agentic/index.ts', quote: 'the agent notebooks live on the Server (its state folder), whichever PC the chat runs on' },
  },
  {
    text: 'Keeps the task list.',
    source: { file: 'agent/agentic/tasks.ts', quote: 'a JSON file on the hub' },
  },
  {
    text: 'Keeps where each goal has reached (the "Reported by" lines).',
    source: { file: 'agent/agentic/goal-progress.ts', quote: "export const GOAL_PROGRESS_FILE = 'goal-progress.json'" },
  },
  {
    text: 'Keeps which goals are waiting for you to answer.',
    source: { file: 'agent/agentic/goal-wait.ts', quote: "the app's own small file of the goals that are WAITING FOR HIM" },
  },
  {
    text: 'Runs the heartbeat and the nudges that keep chats going.',
    source: { file: 'agent/agentic/index.ts', quote: "mode() !== 'member' && !closing) void heartbeat.tick()" },
  },
  {
    text: "Copies every chat's conversation into the CRM drive.",
    source: { file: 'agent/agentic/index.ts', quote: "Only the hub (or a PC on its own) sends: it holds every PC's copy (F-021)" },
  },
  {
    text: 'Applies the automatic update.',
    source: { file: 'agent/main.ts', quote: 'F-173a: the automatic update, on the hub only.' },
  },
  {
    text: 'Runs WhatsApp.',
    source: { file: 'agent/main.ts', quote: 'F-079: on the hub only, and only with the Agents section.' },
  },
  {
    text: "Runs the SSH terminals, with the Server's own SSH key, and the Browser.",
    source: { file: 'agent/agentic/index.ts', quote: 'Order o68f0: the SSH terminals run on the Server (its ssh client and key).' },
  },
  {
    text: "Opens a person's own Assistant: it runs on the Server only.",
    source: { file: 'agent/agentic/index.ts', quote: "A person's own Assistant runs on the Server only." },
  },
  {
    text: "Makes each PC's own key at the CRM, and hands it to that PC.",
    source: { file: 'agent/agentic/index.ts', quote: "The Server mints it at the CRM with the OWNER'S session" },
  },
]

// ---------------------------------------------------------------------------------------------
// List 2 (what a person can be given, with the Server on) is NOT written here: the panel draws it from the Access list itself (shared/access.ts, FEATURES), so it cannot drift.

export const PEOPLE_TITLE = 'What a person can be given, with the Server on'
export const PEOPLE_TEXT = 'You open each of these to a person in Settings, Access. Every one starts as Only me. The ones marked as always yours cannot be opened to anyone.'
export const PEOPLE_LOCKED_TITLE = 'Always yours'

// ---------------------------------------------------------------------------------------------
// List 3: what is ON the Server. The Data tab sizes these same kinds, by the same ids (agent/agentic/server-data.ts keeps the folders; this file keeps the words).

export interface DataCategory {
  id: string
  label: string
  /** One plain line: what is in it. Never a path, a file name or a person. */
  holds: string
  /** `data` is the app's own data; `tools` is programs and models the app downloaded (listed last, as "not data"). */
  group: 'data' | 'tools'
  /** False when this app cannot measure it (the Data tab says "not read by this app"). */
  sized: boolean
}

export const ON_SERVER_TITLE = 'What is on the Server'
export const ON_SERVER_NOTE = 'The Data tab says how big each of these is.'

/** The panel's two tabs: the words, in order. Only "What works" is drawn when the panel opens; "Data" asks the app only when it is picked. */
export type InfoTab = 'works' | 'data'
export const INFO_TABS: readonly { value: InfoTab; label: string }[] = [
  { value: 'works', label: 'What works' },
  { value: 'data', label: 'Data' },
]
export const INFO_TABS_LABEL = 'What to show'
export const SERVER_DATA_CATEGORIES: readonly DataCategory[] = [
  { id: 'conversations', label: 'Chat conversations', holds: "Claude's own record of every chat, one file per chat, including the copies of the chats your other PCs ran.", group: 'data', sized: true },
  { id: 'codex', label: 'Codex home', holds: "Codex's own home on the Server: its chats and its program files.", group: 'data', sized: true },
  { id: 'app-state', label: 'App state', holds: "The app's own lists: floors, chats, tasks, how far each goal has got, approvals and receipts.", group: 'data', sized: true },
  { id: 'conv-copies', label: 'Conversation copies for the CRM drive', holds: 'Chat conversations waiting to be copied into the CRM drive.', group: 'data', sized: true },
  { id: 'memory', label: 'Memory', holds: "The memory layer, each agent's notebook, the wiki and the floors' notes. This counter stays out of the memory's folders, so no size is shown.", group: 'data', sized: false },
  { id: 'memory-service', label: 'Standalone memory service', holds: 'It keeps its own store, and this app does not read it.', group: 'data', sized: false },
  { id: 'uploads', label: 'Uploads and pictures', holds: 'Files and pictures sent into chats and to the CRM.', group: 'data', sized: true },
  { id: 'crm-cache', label: 'CRM cache', holds: 'What the app keeps of the CRM, so pages open fast.', group: 'data', sized: true },
  { id: 'logs', label: 'Logs', holds: "The app's own logs.", group: 'data', sized: true },
  { id: 'builds', label: 'Builds', holds: 'The published builds and the chat host.', group: 'data', sized: true },
  { id: 'whatsapp', label: 'WhatsApp', holds: 'The WhatsApp link and the program behind its page.', group: 'data', sized: true },
  { id: 'remote', label: 'Remote control', holds: 'The remote-control (RustDesk) server.', group: 'data', sized: true },
  { id: 'sign-ins', label: 'Sign-ins, access and settings', holds: 'Sign-in records, keys, access rules and settings. Only the total is ever shown, never one by one.', group: 'data', sized: true },
  { id: 'tools', label: 'Tools and models', holds: 'Programs and models the app downloaded (the Android tools, speech models, ffmpeg) and work folders. Not your data.', group: 'tools', sized: true },
]

// ---------------------------------------------------------------------------------------------
// List 4: what is NOT on the Server.

export const NOT_ON_SERVER_TITLE = 'What is not on the Server'
export const NOT_ON_SERVER: readonly Fact[] = [
  {
    text: 'On each PC: its own Codex home. Codex runs on that PC, not on the Server.',
    source: { file: 'agent/main.ts', quote: "codexHome: path.join(paths.agent, 'codex', 'home')" },
  },
  {
    text: 'On each PC: its own Claude sign-in. A new chat made on a PC while the Server is away uses that PC\'s own login.',
    source: { file: 'agent/agentic/index.ts', quote: "new floors and chats on this PC use this PC's own Claude sign-in (F-007)" },
  },
  {
    text: 'On each PC: a copy of every conversation that PC ran or caught up on, brought up to date as chats grow.',
    source: { file: 'agent/agentic/index.ts', quote: 'is caught up in the background (pull), so every PC has it.' },
  },
  {
    text: "On each PC: a read-only copy of the Server's floors, kept to show while the Server cannot be reached.",
    source: { file: 'agent/agentic/index.ts', quote: "a copy in replica.json, read-only while the hub can't be reached" },
  },
  {
    text: "On each PC: its own CRM sign-in, and its own record of who signed in to the app.",
    source: { file: 'agent/agentic/index.ts', quote: "path.join(o.dir, '..', 'crm-session.json')" },
  },
  {
    text: "Only in the CRM: goals, leads, members, reminders and the CRM's files and drive.",
    source: { file: 'agent/SPEC.md', quote: "reached through this PC's agent, with this PC's CRM session" },
  },
]

// ---------------------------------------------------------------------------------------------
// List 5: what still works WITHOUT the Server (a PC at its own app). "Down" means the PC cannot reach the Server.

export const STATUS_LEVELS = ['Works', 'Partly', 'Stops', 'Not checked yet'] as const
export type Status = (typeof STATUS_LEVELS)[number]

export interface WithoutRow {
  what: string
  status: Status
  note: string
  /** Absent only for a row that is `Not checked yet`: nothing was found to read. */
  source: Source | null
}

/** Seconds the Server must be out of reach before a PC starts new chats of its own: the same number as OFFLINE_AFTER_MS in agent/agentic/offline.ts (the test pins it). */
export const OFFLINE_AFTER_SECONDS = 20

export const WITHOUT_TITLE = 'With the Server down (a PC at its own app)'
export const WITHOUT: readonly WithoutRow[] = [
  {
    what: 'A chat already running on a PC',
    status: 'Works',
    note: 'It runs on that PC, so it goes on.',
    source: { file: 'agent/agentic/index.ts', quote: 'Chats running here go on.' },
  },
  {
    what: "That chat's tools for goals and the CRM, tasks, memory, notebooks, the phone, WhatsApp, the screen, SSH and the Browser",
    status: 'Stops',
    note: 'They are asked of the Server. The chat is told it needs the Server.',
    source: { file: 'agent/agentic/index.ts', quote: 'That needs the Server (' },
  },
  {
    what: "Looking at the Server's floors from a PC",
    status: 'Works',
    note: 'Read only: the PC shows its last copy.',
    source: { file: 'agent/agentic/index.ts', quote: 'so the floors on it are read-only here' },
  },
  {
    what: "Changing a Server floor, or starting a chat of a Server agent, from a PC",
    status: 'Stops',
    note: 'The PC says the floors are read-only until the Server is back.',
    source: { file: 'agent/agentic/index.ts', quote: 'no chat of theirs can start' },
  },
  {
    what: 'A new chat in a new floor made on that PC',
    status: 'Works',
    note: `Claude only, and only if that PC is signed in to Claude and its setting is on (it starts on). It starts once the Server has been out of reach for ${OFFLINE_AFTER_SECONDS} seconds, and joins the Server's list when the Server is back.`,
    source: { file: 'agent/agentic/index.ts', quote: "new floors and chats on this PC use this PC's own Claude sign-in (F-007)" },
  },
  {
    what: 'A new Codex or OpenCode chat made while the Server is down',
    status: 'Not checked yet',
    note: 'The code asks only for a Claude sign-in. Nobody has tried a Codex one.',
    source: null,
  },
  {
    what: 'Listing, reading and sending to the chats of that same floor, from inside such a chat',
    status: 'Partly',
    note: 'They are not on the Server-only list, so they run on the PC. Not tried with the Server really off.',
    source: { file: 'agent/agentic/index.ts', quote: 'F-127: tools that live on the Server only' },
  },
  {
    what: 'The CRM page, the Goals page and the goal order',
    status: 'Works',
    note: "Straight from the PC to the CRM, with that PC's own CRM sign-in, for as long as the CRM itself is up.",
    source: { file: 'agent/agentic/index.ts', quote: 'createCrmProxy({ file: o.crmSession' },
  },
  {
    what: 'Signing in to the app',
    status: 'Works',
    note: 'It is checked against the CRM, not the Server.',
    source: { file: 'agent/main.ts', quote: "const auth = createAuth({ file: path.join(paths.agent, 'auth.json')" },
  },
  {
    what: "That PC's Claude usage report to the CRM",
    status: 'Works',
    note: "It goes with that PC's own CRM sign-in, for as long as the CRM is up.",
    source: { file: 'agent/usage/pc-reporter.ts', quote: "this PC's own session (crm-session.json)" },
  },
  {
    what: 'Goal links, the "Reported by" lines and "Waiting for you"',
    status: 'Stops',
    note: 'The Server keeps them, and the tools that write them are Server-only.',
    source: { file: 'agent/agentic/index.ts', quote: 'F-127: tools that live on the Server only' },
  },
  {
    what: 'The heartbeat and the nudges',
    status: 'Stops',
    note: 'Only the Server runs them.',
    source: { file: 'agent/agentic/index.ts', quote: "mode() !== 'member' && !closing) void heartbeat.tick()" },
  },
  {
    what: "The memory layer and the agents' notebooks",
    status: 'Stops',
    note: 'They live on the Server.',
    source: { file: 'agent/agentic/index.ts', quote: 'the agent notebooks live on the Server (its state folder), whichever PC the chat runs on' },
  },
  {
    what: "A person's own Assistant",
    status: 'Stops',
    note: 'It opens on the Server only.',
    source: { file: 'agent/agentic/index.ts', quote: "A person's own Assistant runs on the Server only." },
  },
  {
    what: "Changing another PC's Claude subscription",
    status: 'Stops',
    note: "It is changed from the Server's page, not from a PC.",
    source: { file: 'agent/agentic/index.ts', quote: "Another PC's Claude subscription is changed from the Server's page, not from here." },
  },
  {
    what: 'The automatic update',
    status: 'Stops',
    note: 'Only the Server applies it.',
    source: { file: 'agent/main.ts', quote: 'F-173a: the automatic update, on the hub only.' },
  },
  {
    what: 'WhatsApp',
    status: 'Stops',
    note: 'Only the Server runs it.',
    source: { file: 'agent/main.ts', quote: 'F-079: on the hub only, and only with the Agents section.' },
  },
  {
    what: "PC control: another PC's screen, Chat 1 and Chat 2, updates and resources, from a PC at its own app",
    status: 'Not checked yet',
    note: 'The link goes to the Server; nobody has tried it with the Server off.',
    source: null,
  },
  {
    what: 'The phone app with the Server down',
    status: 'Not checked yet',
    note: "The phone app's code was not read for this.",
    source: null,
  },
  {
    what: "Which Settings, Access rows a PC enforces when it cannot reach the Server",
    status: 'Not checked yet',
    note: "Each PC has its own access file. No line was found that copies the Server's rows to it.",
    source: null,
  },
  {
    what: 'The Tasks, Memory and Subscriptions pages opened on a PC at its own app',
    status: 'Not checked yet',
    note: 'Only the chats\' tools were checked, not what those pages show.',
    source: null,
  },
]

// ---------------------------------------------------------------------------------------------
// The tools a chat on a PC cannot use without the Server. The test opens agent/agentic/index.ts, reads NEEDS_SERVER, and pins this list to it BOTH WAYS: a tool added there and not named here fails; so does one
// named here that the code does not stop. The panel names the groups, never the tool names.

export const SERVER_ONLY_TOOLS: readonly { label: string; tools: readonly string[] }[] = [
  { label: 'Tasks', tools: ['task_add', 'task_list', 'task_update'] },
  { label: 'The screen', tools: ['ui_screen', 'ui_control', 'ui_modules', 'ui_invoke'] },
  { label: 'The phone', tools: ['phone_screen', 'phone_control', 'phone_update'] },
  { label: 'WhatsApp', tools: ['wa_status', 'wa_chats', 'wa_read', 'wa_prepare_send'] },
  { label: 'The watchdog', tools: ['watchdog_status'] },
  { label: 'Memory and notebooks', tools: ['memory_read', 'notebook_add', 'notebook_search', 'notebook_read'] },
  { label: 'Messages between instances', tools: ['message_instance', 'prepare_send'] },
  {
    label: 'The CRM: goals, boards, files',
    tools: ['crm_whoami', 'crm_members', 'crm_goals', 'crm_goal_add', 'crm_goal_update', 'crm_scopes', 'crm_board', 'crm_catalog', 'crm_query', 'crm_write', 'crm_files', 'show_crm_file'],
  },
  { label: 'Goal progress and waiting', tools: ['goal_progress', 'goal_wait'] },
  { label: 'SSH and the Browser', tools: ['ssh_open', 'ssh_read', 'ssh_type', 'ssh_close', 'browser_open', 'browser_read'] },
]

/** The chat tools that are NOT Server-only, so a chat made on a PC can still use them on its own floor. */
export const LOCAL_CHAT_TOOLS: readonly string[] = ['list_chats', 'read_chat', 'send_to_chat', 'broadcast_to_chats']
