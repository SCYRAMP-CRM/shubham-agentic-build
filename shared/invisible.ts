// F-344a (Agent 14's fix B): the words other people (and a pasted text) can hide behind. ONE pure module, used by the curtain (what is drawn), the by-hand route (what is accepted) and the chat tool (what is accepted), so
// a title that would DRAW as nothing is the same refusal everywhere.

/** Characters that draw nothing but can hide or reorder what is around them (a zero-width space, direction marks and overrides, isolates, the byte-order mark, invisible operators). The joiners U+200C and U+200D stay: emoji and some scripts need them. */
export const INVISIBLE = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** Everything that draws nothing at all: white space, soft hyphen, the joiners, the format characters, the Hangul and Braille fillers. */
const NOTHING = /\u034F|[\s\u00AD\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/g

/** True when the text has at least one character that draws something. A text of spaces and zero-width characters has none. */
export const hasVisible = (text: string): boolean => text.replace(NOTHING, '') !== ''
