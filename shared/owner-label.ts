import { SBSKRRT_ID, type ChatOwner } from './auth.ts'
import { initials } from './initials.ts'

// Order oe6cd (his words: "on every agent chat we require the owner name"), part of F-118: whose chat or floor it is, said in WORDS wherever a chat or a floor is shown. The owner is the one F-118
// already records (ChatOwner: the CRM user who started the chat); nothing here decides or stores an owner, it only decides whether his name is DRAWN. Pure, so it is tested; the viewer and the
// setting come in from the page.
//
// The one product call in it, made on purpose: by default the name is drawn only when the chat is NOT the viewer's own. On his own floors every chat is his, so a name on every row is noise he reads
// past, and the value is seeing that a chat is RAVI'S. "Every chat" is one switch away for whoever wants the name on his own chats too, and "Initials" is the old way (the small chip with the owner's
// initials beside a chat's name, nothing in the header or the pickers), kept as a setting.

/** 'others': the name on chats that are not the viewer's own (the default). 'all': on every chat. 'initials': the old way. */
export type OwnerNames = 'others' | 'all' | 'initials'
export const OWNER_NAMES_KEY = 'sad-owner-names'
export const DEFAULT_OWNER_NAMES: OwnerNames = 'others'
export const OWNER_NAMES_CHOICES: readonly { value: OwnerNames; label: string }[] = [
  { value: 'others', label: "Avatars, and names on others' chats" },
  { value: 'all', label: 'Avatars and names on every chat' },
  { value: 'initials', label: 'Initials only (as before)' },
]

export function parseOwnerNames(value: unknown): OwnerNames {
  return value === 'all' || value === 'initials' ? value : DEFAULT_OWNER_NAMES
}

/** Who is looking: the person signed in here, else sbskrrt: a browser that is not signed in acts as him while the app is open as before (F-118, Accounts' rule (d)). */
export const viewerIdOf = (person: { id: string } | null | undefined): string => person?.id ?? SBSKRRT_ID

/** Is this the viewer's own chat or floor? Nobody's (no owner recorded) is not. */
export const isViewersOwn = (owner: Pick<ChatOwner, 'id'> | null | undefined, viewerId: string): boolean => !!owner && owner.id === viewerId

/** The words for an owner: the name he is known by, else his CRM username. */
export const ownerWords = (owner: Pick<ChatOwner, 'name' | 'username'>): string => owner.name.trim() || owner.username

/** Is the owner's NAME drawn on this chat or floor? ('initials' draws no name: the old chip is the old way's own, and it decides for itself.) */
export function showOwnerName(mode: OwnerNames, owner: ChatOwner | null | undefined, viewerId: string): boolean {
  if (!owner || mode === 'initials') return false
  return mode === 'all' || !isViewersOwn(owner, viewerId)
}

/** The name to draw, or null: for the places that need only the words (the header's line, a picker's second line). */
export const ownerNameToShow = (mode: OwnerNames, owner: ChatOwner | null | undefined, viewerId: string): string | null => (owner && showOwnerName(mode, owner, viewerId) ? ownerWords(owner) : null)

// Order oca89 (his words: "the sb should be on agetns ok", F-270): the owner's AVATAR, the two letters of the owner (SB for his chats, RT for Ravi's) on a round plate, wherever an agent is drawn. It is the
// SECOND form the owner takes beside the name above (F-268), and neither replaces the other. One call made on purpose, and it follows his words rather than the name's rule: the avatar is on EVERY
// agent, the viewer's own included ("the sb should be on agents"; a name on his own rows was noise, two letters are not). The old way ('initials': the small chip with the owner's initials beside the chat's
// name, only on chats that are not the viewer's own) draws no avatar: it IS the old way, kept as a setting.

/** What the avatar says: its two letters (F-105's convention, shared/initials.ts) and the words for whoever cannot see it (a screen reader, a hover). */
export interface OwnerMark {
  initials: string
  words: string
}

/** Is the owner's AVATAR drawn? On every agent that has a recorded owner, unless the old way is chosen. */
export const showOwnerAvatar = (mode: OwnerNames, owner: ChatOwner | null | undefined): boolean => !!owner && mode !== 'initials'

/** The avatar to draw for an owner, or null: none in the old way, none when no owner is recorded (nothing is invented), none when the owner has neither a name nor a username to take letters from. */
export function ownerMarkToShow(mode: OwnerNames, owner: ChatOwner | null | undefined): OwnerMark | null {
  if (!owner || !showOwnerAvatar(mode, owner)) return null
  const letters = initials(owner.name, owner.username)
  return letters ? { initials: letters, words: ownerWords(owner) } : null
}
