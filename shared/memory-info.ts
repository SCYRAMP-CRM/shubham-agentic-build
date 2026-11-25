// F-347 (Shubham, the memory "i" icon: "all of this and what i pasted here put this as a i icon"; amended: "my prompt please structure it and then show in i and show the status of where everything has reached please in
// the next publish itself"): the words of the "What the memory does" panel on the Memory page. His pasted words are kept VERBATIM, as plain strings (no markup of any kind: they are drawn as text nodes, never parsed),
// from his two pastes of 23 Nov 2026 (the list the Assistant gave him, and the architecture description); STRUCTURING them is only headings, order and cards: a line "Title: text" is shown as the title and then the text,
// and joining them again with ": " gives his line back exactly (memory-info.test.ts pins that, against a second copy of his words). Beside every item sits a STATUS CHIP (one of three levels) with one short line of the
// Lead's own words, and the date it was true: THIS FILE IS WHERE EACH PUBLISH UPDATES THEM (the test pins the table, so a change is deliberate). No stored memory is ever in this file or in the panel: it is fixed
// text, and opening it asks the door and the brain for nothing.

/** The button's name for a screen reader, and the panel's title. */
export const MEMORY_INFO_LABEL = 'What the memory does'
export const MEMORY_INFO_ABOUT = 'What it is meant to be, in Shubham’s own words, and where everything has reached.'

/** The header: what the memory is, in the Lead's words. */
export const MEMORY_IS_TITLE = 'What the memory is'
export const MEMORY_IS_LINES: readonly string[] = [
  'Standalone memory on the Server; the Memory page reads it and can add a memory to it (add only).',
  "Keys and passwords you give it are kept in plain text on the Server's disk (Shubham's decision).",
]

/** The three levels, and the date this table was true. Nothing else is ever a status. */
export const MEMORY_STATUS_LEVELS = ['Built and tested', 'Partly', 'Not yet'] as const
export type InfoStatus = (typeof MEMORY_STATUS_LEVELS)[number]
export const MEMORY_STATUS_AS_OF = 'As of 24 Nov 2026'

export interface InfoItem {
  /** His title: for a line "Title: text" the words before the first ": ". */
  title: string
  /** His description (the words after the title); `${title}: ${text}` is his line exactly. */
  text: string
  /** His short tag line under a kind ("Bounded per run · short lived"); none for the parts of the list and for the last kind. */
  tag: string | null
  status: InfoStatus
  /** One short line of the Lead's own words about where it has reached. */
  note: string
}

/** SECTION A: his list. The heading is his intro without its colon (`${MEMORY_PARTS_TITLE}:` is his line exactly). */
export const MEMORY_PARTS_TITLE = 'The most advanced designs combine these parts'
export const MEMORY_PARTS: readonly InfoItem[] = [
  {
    title: 'Fast search',
    text: 'a local index on the Server that combines keyword and meaning-based search with a re-ranker, so lookups take milliseconds.',
    tag: null,
    status: 'Partly',
    note: 'Words, partial words and a re-ranker work; there is no real meaning-based model, only a simple stand-in.',
  },
  {
    title: 'One shared store',
    text: 'every chat and agent reads and writes the same memory through one door, with permissions per person and per agent.',
    tag: null,
    status: 'Built and tested',
    note: 'One door with permissions; nobody but Shubham reads it in the app; chats and agents do not use it yet.',
  },
  {
    title: 'Big context kept cheap',
    text: "long context windows plus caching, so a large stable block isn't re-read at full cost each time.",
    tag: null,
    status: 'Partly',
    note: 'A size-limited context builder and a cache are built; not wired to chats yet.',
  },
  {
    title: 'A tidier that runs while idle',
    text: 'a background agent that rewrites and merges memory when nobody is using it.',
    tag: null,
    status: 'Built and tested',
    note: 'Rules only; there is no AI tidier.',
  },
  {
    title: 'Memory that remembers when things changed',
    text: 'the Zep/Graphiti idea.',
    tag: null,
    status: 'Built and tested',
    note: 'Dated facts, a newer fact replaces an older one, history and disputes.',
  },
  {
    title: 'Memory the agent manages itself',
    text: 'the Letta idea.',
    tag: null,
    status: 'Partly',
    note: 'Agent copies propose changes to their own overlay for review; no real agent uses it yet.',
  },
]

/** SECTION B: his architecture block. */
export const MEMORY_ARCH_HEADING = 'The central architecture decision'
export const MEMORY_ARCH_STATEMENT = 'Memory is a governed record of work.'
export const MEMORY_ARCH_BODY = 'Use structured records and permission-scoped hybrid retrieval, with a readable wiki over the evidence. Different types of knowledge have different lifecycles and authority.'

const IN_SERVICE = 'Built in the memory service; chats and agents do not use it yet.'
export const MEMORY_KINDS: readonly InfoItem[] = [
  { title: 'Working context', text: 'The active goal, permitted tools, selected evidence and next checkpoint.', tag: 'Bounded per run · short lived', status: 'Built and tested', note: IN_SERVICE },
  { title: 'Episodic memory', text: 'What happened, what was attempted, what the employee accepted and what failed.', tag: 'Run events · linked outcomes', status: 'Built and tested', note: IN_SERVICE },
  { title: 'Semantic memory', text: 'Facts with a source, scope, effective time and a clear status when disputed.', tag: 'Evidence-backed · refreshable', status: 'Built and tested', note: IN_SERVICE },
  { title: 'Procedural memory', text: 'Approved SOPs, question answers, examples, checks and escalation rules.', tag: 'Versioned · owned by a person', status: 'Built and tested', note: IN_SERVICE },
  {
    title: 'Relationship graph',
    text: 'Links between goals, clients, people, projects, procedures and supporting evidence.',
    tag: 'Scoped joins · bounded exploration',
    status: 'Built and tested',
    note: 'A basic version; chats and agents do not use it yet.',
  },
  {
    title: 'Readable brain',
    text: 'A human view of what the agent knows, its sources and concise recorded decision reasons.',
    tag: 'Inspectable · correctable · auditable',
    status: 'Built and tested',
    note: 'Readable in the app; correcting is done by the program, not from the app yet.',
  },
  {
    title: 'Agent copy',
    text: 'A copy inherits a bounded task, procedure version and a narrowed permission set. It writes observations and proposed changes to its own overlay; the memory service validates and consolidates accepted changes. Copies share references, not a thousand cloned databases.',
    tag: null,
    status: 'Built and tested',
    note: 'Not used by real agents yet.',
  },
]

/** SECTION C: what is not made yet, in the Lead's words. */
export const MEMORY_NOT_YET_TITLE = 'Not made yet'
export const MEMORY_NOT_YET: readonly string[] = [
  'A real meaning-based search model (today a simple stand-in is used).',
  'Chats and agents using this memory.',
  'Fixing or correcting a memory from the phone (only adding is built: the Add memory button).',
  "Akash's memory page (it is separate and not connected to this one).",
]
