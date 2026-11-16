// Orders o08e3 / o2215: chat presentation on THIS device, never a model or permission setting.
export type ChatHeaderLayout = 'compact' | 'classic'
export interface ChatAppearance { layout: ChatHeaderLayout; zoom: number }
export const CHAT_APPEARANCE_KEY = 'sad-chat-appearance'
export const CHAT_ZOOM_MIN = 0.65
export const CHAT_ZOOM_MAX = 1.75
export const DEFAULT_CHAT_APPEARANCE: Readonly<ChatAppearance> = { layout: 'compact', zoom: 1 }

export function chatZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(CHAT_ZOOM_MIN, Math.min(CHAT_ZOOM_MAX, value)) * 100) / 100 : 1
}
export function parseChatAppearance(value: unknown): ChatAppearance {
  const o = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { layout: o.layout === 'classic' ? 'classic' : 'compact', zoom: chatZoom(o.zoom) }
}
export function pinchChatZoom(zoom: number, firstDistance: number, distance: number): number {
  return firstDistance > 0 && Number.isFinite(firstDistance) && distance > 0 && Number.isFinite(distance) ? chatZoom(zoom * distance / firstDistance) : chatZoom(zoom)
}
/** Ctrl+wheel, and a trackpad's browser pinch: normalise line/page wheel deltas before applying the same bounded zoom. */
export function wheelChatScale(zoom: number, delta: number, mode = 0): number {
  const from = Number.isFinite(zoom) ? Math.max(CHAT_ZOOM_MIN, Math.min(CHAT_ZOOM_MAX, zoom)) : 1
  if (!Number.isFinite(delta)) return from
  const pixels = Math.max(-240, Math.min(240, delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1)))
  return Math.max(CHAT_ZOOM_MIN, Math.min(CHAT_ZOOM_MAX, from * Math.exp(-pixels * 0.002)))
}
export const wheelChatZoom = (zoom: number, delta: number, mode = 0): number => chatZoom(wheelChatScale(zoom, delta, mode))
/** Keep the same part of the chat under the fingers; a reader following the end keeps following it. */
export function zoomScrollTop(before: { top: number; height: number; viewport: number; anchor: number }, height: number): number {
  if (before.height - before.top - before.viewport < 72) return Math.max(0, height - before.viewport)
  if (before.height <= 0) return 0
  return Math.max(0, (before.top + before.anchor) * height / before.height - before.anchor)
}
