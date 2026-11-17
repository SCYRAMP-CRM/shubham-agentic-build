import type { TalkEndRule, TalkSettings } from './talk.ts'

/**
 * F-267 (order o088b), slice Q1: what the Quick page keeps for itself. Only what differs on the page lives here, under its own key and version
 * (QUICK_PAGE_SETTINGS_KEY), so the overlay's Live voice settings (their own key and TALK_SETTINGS_VERSION, src/talk/store.ts) never change
 * because of the page:
 *   - lang: English, Hindi or Marathi, always set. No Auto: Whisper's guess of the language is slow and mistakes Indian English (decision 12).
 *   - end: it ends by itself after 2 minutes of silence ('silence', TALK.autoEndMs), on by default (Q1's page safety; Q2 changes it).
 * Everything else a session needs (the voice, the PC voice, the speed, how he cuts in, the fillers, the pause, the early guess) is read from
 * his Live voice settings, never written: one place to tune his voice. The page talks to Quick only, whatever those say (no direct line).
 * Stored sparse: only what he changed, so a later default change moves nothing of his.
 */
export type QuickPageLang = 'en' | 'hi' | 'mr'
export interface QuickPageSettings {
  lang: QuickPageLang
  end: TalkEndRule
}

export const QUICK_PAGE_SETTINGS_KEY = 'sad-quick'
export const QUICK_PAGE_SETTINGS_VERSION = 1
export const QUICK_PAGE_LANGS: readonly QuickPageLang[] = ['en', 'hi', 'mr']
export const QUICK_PAGE_SETTINGS: QuickPageSettings = { lang: 'en', end: 'silence' }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** His stored page settings: a field that is missing or not valid is the page's default (never the overlay's). */
export function parseQuickPageSettings(raw: unknown): QuickPageSettings {
  const src = isObject(raw) ? raw : {}
  return {
    lang: QUICK_PAGE_LANGS.includes(src.lang as QuickPageLang) ? (src.lang as QuickPageLang) : QUICK_PAGE_SETTINGS.lang,
    end: src.end === 'button' || src.end === 'silence' ? src.end : QUICK_PAGE_SETTINGS.end,
  }
}

/** What is stored: the version, and only his choices that differ from the page's defaults. */
export function storedQuickPageSettings(s: QuickPageSettings): Partial<QuickPageSettings> & { v: number } {
  return { v: QUICK_PAGE_SETTINGS_VERSION, ...(s.lang !== QUICK_PAGE_SETTINGS.lang ? { lang: s.lang } : {}), ...(s.end !== QUICK_PAGE_SETTINGS.end ? { end: s.end } : {}) }
}

/** The live-talk settings a session on the page runs with: his Live voice settings, the page's own two, and Quick always. */
export function quickPageTalkSettings(talk: TalkSettings, page: QuickPageSettings): TalkSettings {
  return { ...talk, mode: 'quick', lang: page.lang, end: page.end }
}
