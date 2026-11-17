// F-079: WhatsApp in the app. Shubham's own WhatsApp, linked once as a device (his QR scan, the WhatsApp
// Web way), read and written from the app. This is what the hub's /agent-api/whatsapp/ part and the
// WhatsApp page say to each other. The login itself never leaves the hub's state folder.

/** The WhatsApp part of the agent's API, under AGENT_API_PREFIX. */
export const WA_PREFIX = '/whatsapp'

/**
 * Order o8416 (F-223): the WhatsApp page's own part of the agent's API, under AGENT_API_PREFIX. It proxies to the
 * WhatsApp backend on this Server (agent/whatsapp-backend/), adding the backend's token on the server side: the page never sees it.
 */
export const WA_BACKEND_PREFIX = '/whatsapp-backend'
/**
 * The WhatsApp backend's ports on 127.0.0.1 (order of5a0, 16 Nov 2026; it was the single port 50070, inside the tests' range, until then):
 * 65000 to 65099, where the floor puts new long-lived app services (agent/SPEC.md, "Ports for tests and for the app's own services"). Still his
 * "50000 or higher" (o8d7e), and never the agent's own 21221.
 *
 * THIS BAND IS SHARED, ON PURPOSE, AND NO PORT IN IT IS EVER THE BACKEND'S OWN. Two things can hold any one of these ports at any moment:
 * - Windows: this Server's ephemeral range is 49152-65535, which CONTAINS 65000-65099, so an outgoing connection (or one in TIME_WAIT) can sit on it;
 * - Stable ports: its Change can move a PC's block anywhere up to 65535, into this band too.
 * Being above the tests' range keeps only the tests away. What protects the backend is the FIRST FREE port of the hundred, taken at each start,
 * and the port it got written down (its ready word to the hub, and a `port` file beside its token) and read fresh by whoever calls it. Pinning a
 * literal port here, however tidy it looks in review, reintroduces exactly the failure this avoids.
 */
export const WA_BACKEND_PORTS = { from: 65000, to: 65099 } as const

/**
 * Why the agent's proxy could not reach the WhatsApp backend (the `code` of its 503), so the page says what is true: starting (or starting again
 * after a failure), stopped (after too many failures, with the reason), off (not running on this PC), unreachable (it did not answer), or no token.
 */
export type WaBackendCode = 'wa-backend-starting' | 'wa-backend-stopped' | 'wa-backend-off' | 'wa-backend-unreachable' | 'wa-backend-no-token'

/** Order o714a: the chat list is still being read (the first read after a link is slow): a 409 the page answers by waiting and asking again, not by failing. */
export const WA_CHATS_LOADING = 'wa-chats-loading'

/** How long WhatsApp stays open after its last use, unless it is set to stay on. */
export const WA_IDLE_MS = 10 * 60_000

/** The Assistant's drafts: how many may wait at once, how long one lasts, and how many may be sent in an hour. */
export const WA_DRAFTS_MAX = 5
export const WA_DRAFT_MS = 15 * 60_000
export const WA_ASSISTANT_SENDS_PER_HOUR = 20

/** The longest message the app sends (WhatsApp allows far more; this keeps a slip short). */
export const WA_TEXT_MAX = 4000

/** The most messages one read gives (the page pages back for more). */
export const WA_READ_MAX = 100

/** Order oWA S3: the most of one file the page is shown; a bigger one is opened on the phone. */
export const WA_MEDIA_MAX_BYTES = 16 * 1024 * 1024
/** The `code` of the answers to a file that cannot be shown: too big (413), or no longer on WhatsApp (404). */
export const WA_MEDIA_TOO_BIG = 'wa-media-too-big'
export const WA_MEDIA_GONE = 'wa-media-gone'

/** Order oWA S3: a message's file as the WhatsApp process hands it over (its bytes as base64). */
export interface WaMediaFile {
  mimetype: string
  filename: string | null
  /** The bytes, decoded. */
  size: number
  data: string
}

/** The one-time setup of the WhatsApp program on the hub (its packages, in the state folder). */
export type WaSetup = 'missing' | 'installing' | 'ready' | 'failed'

/**
 * off: nothing runs (a saved login is kept); starting: Chrome is opening WhatsApp Web; qr: waiting for his scan
 * (or for the pairing code); linking: scanned, WhatsApp is loading; ready: connected; failed: it could not start.
 */
export type WaState = 'off' | 'starting' | 'qr' | 'linking' | 'ready' | 'failed'

/** The linked account, once known (only his own name and number). */
export interface WaMe {
  name: string | null
  phone: string | null
}

export interface WaStatus {
  setup: WaSetup
  /** The setup's progress or error, in plain words. */
  setupNote: string | null
  state: WaState
  /** A login is saved here (the next start needs no QR). */
  linked: boolean
  me: WaMe | null
  /** The QR to scan, as an image (a data URL), only while state is 'qr'. */
  qr: string | null
  /** The code to type on his phone in place of the QR (Link with phone number), when he asked for one. */
  pairingCode: string | null
  /** WhatsApp Web's own loading progress (0 to 100) while it opens. */
  loading: number | null
  /** Why it is off or failed, in plain words. */
  reason: string | null
  /** Stays open (never closed for being idle). Off: it opens when used and closes after WA_IDLE_MS. */
  alwaysOn: boolean
  /** When it will close for being idle (ISO), while it is open and not always on. */
  closesAt: string | null
  /** The Assistant's drafts waiting for his tap. */
  drafts: WaDraft[]
  /** How many of the Assistant's drafts were sent in the last hour (at most WA_ASSISTANT_SENDS_PER_HOUR). */
  assistantSentLastHour: number
  /**
   * Order o55b6: where WhatsApp's Chrome goes out, where it can go another way (the WhatsApp backend): through the Z800's SSH tunnel (his choice, the
   * default there) or directly (the old way, kept as a setting). Absent where there is no other way.
   */
  route?: WaRoute
  /** Order o55b6: the tunnel as last checked (its note, its listener's PID, a SOCKS5 greeting), while the route is 'z800'; null: not checked yet. */
  tunnel?: WaTunnelSeen | null
  /** Order of5a0 (A2): which login the overlay Assistant's WhatsApp tools use (added by the agent's proxy, on the Server). */
  assistantTools?: WaAssistantTools
  /** Order obf15 (oWA S2): whether sending from the page is switched on (added by the agent's proxy; absent where the agent has no switch). OFF unless a person turned it on. */
  sends?: WaSends
}

/** Order obf15 (oWA S2): the page's send switch as the agent holds it. Only a signed-in administrator can change it (PATCH /sending). */
export interface WaSends {
  on: boolean
}

/**
 * Order of5a0 (A2): the WhatsApp login the overlay Assistant's four tools use. 'in-app': F-079's own (where it starts, and the old way);
 * 'backend': the one linked on the WhatsApp page (F-223). It moves to 'backend' on its own only once that one is linked AND answering.
 */
export type WaAssistantLogin = 'in-app' | 'backend'

/**
 * Order of5a0 (A2), Lead's rule on the record (17 Nov 2026): whose hand made a CHOICE of the Assistant's login. The choice itself is not human-only (it is reversible and fails safe), so the
 * Assistant's screen control can press it on his instruction; the record must then say so instead of calling it his tap. 'owner': a person's own tap or key (a trusted event); 'assistant': pressed by
 * the Assistant's screen control (a script's event). The page says which, from the event; the agent records exactly that and refuses a choice that does not say.
 */
export type WaAssistantHand = 'owner' | 'assistant'

export interface WaAssistantTools {
  use: WaAssistantLogin
  /** Since when (ISO); null: as it started. */
  since: string | null
  /**
   * 'auto': moved when the page's WhatsApp was linked and answered; 'owner': his own tap; 'assistant': pressed by the Assistant's screen control (on his instruction, but not his own tap);
   * null: as it started. A choice by either hand stands: nothing moves it on its own.
   */
  by: 'auto' | WaAssistantHand | null
}

/** Order o55b6: 'z800' through the Z800's SSH SOCKS tunnel (around the office firewall), 'direct' straight out (the old way). */
export type WaRoute = 'direct' | 'z800'

export interface WaTunnelSeen {
  up: boolean
  /** Why it is not used, in plain words (up: null). */
  why: string | null
  /** Through which PC (from the tunnel's note), when up. */
  via: string | null
  at: string
}

/** Order oWA S6: a private note about a chat, in the person's own words, with when it was written (kept on the Server only). */
export interface WaNote {
  id: string
  text: string
  /** ms since the epoch */
  createdAt: number
}

export interface WaChat {
  /** WhatsApp's id for the chat (…@c.us, …@g.us, …@lid). */
  id: string
  name: string
  isGroup: boolean
  unread: number
  /** The last activity (ms since the epoch). */
  at: number
  /** What the last message was, short. */
  last: string
  lastFromMe: boolean
  muted: boolean
  archived: boolean
  pinned: boolean
  /**
   * Order oWA S4: the phone number of a person's chat, digits only, so the CRM can be matched by it. Where the id is a number's (…@c.us) it is that; where WhatsApp hides the number
   * behind a privacy id (…@lid) it is what WhatsApp Web knows of it, filled in as it is learned (a later read of the list has more of them); absent when it is not known, and for a group.
   */
  number?: string
}

/** Order oWA S4: a member of a group, as the contact panel lists them. */
export interface WaGroupParticipant {
  id: string
  /** Digits; '' when WhatsApp hides it. */
  number: string
  name: string
  isAdmin: boolean
  isSuperAdmin: boolean
}

/** Order oWA S4: what the contact panel shows for a chat: a person's, or a group's. */
export interface WaContactDetails {
  id: string
  isGroup: boolean
  name: string
  /** Their own WhatsApp name, when it differs from the one saved. */
  pushname?: string
  /** Digits; absent for a group and when WhatsApp hides it. */
  number?: string
  isBusiness: boolean
  isMyContact: boolean
  about?: string
  /** A picture's address on WhatsApp's own servers, when their privacy settings allow it. */
  profilePic: string | null
  groupDesc?: string
  owner?: string
  participantsCount?: number
  participants?: WaGroupParticipant[]
}

/** Order oWA S4: a number looked up to start a chat: its chat id, or that it is not on WhatsApp. */
export type WaNewChat = { ok: true; id: string; number: string } | { ok: false; reason: 'not-on-whatsapp'; number: string }

export type WaMessageType = 'chat' | 'image' | 'video' | 'audio' | 'ptt' | 'document' | 'sticker' | 'location' | 'vcard' | 'multi_vcard' | 'revoked' | 'other'

export interface WaMessage {
  id: string
  chatId: string
  fromMe: boolean
  /** Who wrote it, in a group (their WhatsApp name); null for his own and in one-to-one chats. */
  author: string | null
  type: WaMessageType
  /** The text, or a photo's caption. */
  text: string
  /** When (ms since the epoch). */
  at: number
  /** WhatsApp's ticks: -1 failed, 0 waiting, 1 sent, 2 delivered, 3 read, 4 played. */
  ack: number
  hasMedia: boolean
  filename: string | null
  /** Order oWA S3: a media message's kind (image/jpeg, audio/ogg, application/pdf...) when WhatsApp says; absent otherwise. */
  mimetype?: string | null
  /** Order oWA S3: a media message's size in bytes as WhatsApp says it (before anything is downloaded); absent when it does not say. */
  size?: number | null
}

/** A message the Assistant proposes. Nothing sends it but his own tap (a signed send). */
export interface WaDraft {
  id: string
  chatId: string
  chatName: string
  text: string
  /** One line from the Assistant: why. */
  why: string
  /** When it was made, and when it lapses (ISO). */
  at: string
  expiresAt: string
}

/** POST send: his message, signed by his approval device over ['wa-send'; chatId, sha256(text), draft ?? '']. */
export interface WaSendRequest {
  chatId: string
  text: string
  /** The Assistant's draft this sends, if any (it is then used up). */
  draft?: string
  sig?: unknown
}

/** What the live socket (WA_PREFIX/live) pushes to the page. */
export type WaLive =
  | { t: 'status'; status: WaStatus }
  | { t: 'message'; message: WaMessage }
  | { t: 'ack'; id: string; chatId: string; ack: number }

/**
 * Order oWA S7: what happens on WhatsApp that the page follows live (a message, a tick), as the backend keeps it for GET /events. The status is not one: the page polls that.
 */
export type WaEvent = Exclude<WaLive, { t: 'status' }>

/** How many of the newest events the backend keeps in memory, and the longest an ask for new ones may wait. */
export const WA_EVENTS_KEEP = 500
export const WA_EVENTS_WAIT_MAX_MS = 20_000

/** GET /events: what is new since a position. Ask again with `seq` (and this `run`). */
export interface WaEvents {
  /** This run of the backend: it changes when the backend restarts. */
  run: string
  /** Where the feed is now: the next ask's `since`. */
  seq: number
  /** The events after the position asked from, oldest first. */
  events: WaEvent[]
  /** The position was from another run, older than what is kept, or from the future: events were missed. Read the chat list and the open chat again, then carry on from `seq`. */
  reset?: true
}

/** A message's text as a short line: what a chat list shows for it. */
export function waPreview(m: Pick<WaMessage, 'type' | 'text' | 'filename'>): string {
  switch (m.type) {
    case 'image':
      return m.text ? `Photo: ${m.text}` : 'Photo'
    case 'video':
      return m.text ? `Video: ${m.text}` : 'Video'
    case 'ptt':
      return 'Voice message'
    case 'audio':
      return 'Audio'
    case 'document':
      return `Document: ${m.filename ?? 'file'}`
    case 'sticker':
      return 'Sticker'
    case 'location':
      return 'Location'
    case 'vcard':
    case 'multi_vcard':
      return 'Contact'
    case 'revoked':
      return 'This message was deleted'
    default:
      return m.text
  }
}
