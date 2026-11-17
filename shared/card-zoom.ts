import { CHAT_ZOOM_MAX } from './chat-appearance.ts'

// Orders o59ba / o2ef1 (Shubham, by phone, 17 Nov 2026): "This question to be resized curent chats are small so tmthd chat should also be small" and "The question and approvals should also
// be made small that". His chats are pinched small (src/chat/appearance.ts, a CSS zoom on the messages); the cards that ask him a question or an approval stayed full size beside them.
// Now the cards follow the chat's zoom, on this device, with a setting that keeps the old size.
//
// TWO LIMITS HERE ARE THE SAFETY OF THIS FEATURE, NOT ITS POLISH (Lead, 17 Nov): these are the cards he APPROVES things on. A card small enough to misread is a card he can approve the wrong
// thing from, and a small button on an approval is a mis-tap on an approval. So (1) a card is never drawn below CARD_ZOOM_FLOOR, however small the chat is pinched, and (2) on a touch screen every
// button on a card stays CARD_TAP_PX tall and wide AFTER the zoom (the same rule the chat keeps for its message buttons: --chat-touch-size in src/chat/chat.css). The tests pin both; a later
// "make it even smaller" has to change them on purpose, and that is a decision for Shubham, not for whoever is passing.

/** 'follow': the cards use the chat's zoom (the default). 'normal': the size they always had. */
export type CardSize = 'follow' | 'normal'
export const CARD_SIZE_KEY = 'sad-card-size'
export const DEFAULT_CARD_SIZE: CardSize = 'follow'
/** No card is ever drawn smaller than this fraction of its normal size (the chat itself can go to 0.65). */
export const CARD_ZOOM_FLOOR = 0.75
/** The smallest a button on a card may be on a touch screen, in CSS px as the finger sees it (after the zoom). */
export const CARD_TAP_PX = 44

export const parseCardSize = (value: unknown): CardSize => (value === 'normal' ? 'normal' : DEFAULT_CARD_SIZE)

const hundredths = (n: number) => Math.round(n * 100) / 100

/**
 * The zoom the cards are drawn at: 1 when the setting keeps the old size; else the chat's own zoom, but never below CARD_ZOOM_FLOOR and never above the chat's own limit. A zoom that is not a
 * finite number is 1.
 */
export function cardZoom(size: CardSize, chatZoom: number): number {
  if (size === 'normal') return 1
  const z = Number.isFinite(chatZoom) ? chatZoom : 1
  return hundredths(Math.max(CARD_ZOOM_FLOOR, Math.min(CHAT_ZOOM_MAX, z)))
}

export interface CardZoomStyle {
  zoom: number
  /** The size a button is made BEFORE the zoom, so that after it a finger finds CARD_TAP_PX (src/chat/chat.css reads this on a touch screen). */
  '--chat-touch-size': string
}

/** The inline style for an area of cards: null at 100% (nothing to say). */
export function cardZoomStyle(zoom: number): CardZoomStyle | null {
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom === 1) return null
  return { zoom, '--chat-touch-size': `${hundredths(CARD_TAP_PX / zoom)}px` }
}
