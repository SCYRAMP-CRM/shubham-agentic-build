// F-310 (his order oa0fe: the floating card on his phone opens slowly): a small record of how long each stage of the card's open took on THIS phone, numbers only, so the next step is chosen from real values
// and not from this PC's. The card page (src/panel/card-timing.ts) collects the marks and writes one row per open into its own storage (the panel's WebView shares the app's profile, so the app can read it);
// this file is everything of it that needs no browser: which marks there are, what the app's `&t=<tap epoch ms>` is worth, how a row is made from the browser's timings, and how the last 20 rows are kept.
// No content of any kind (no message, no name, no address) is in a row; nothing is sent anywhere; nothing is added to the message the page and the app speak.

export const CARD_TIMING_KEY = 'sad-card-timing'
export const CARD_TIMING_MAX_ROWS = 20
export const CARD_ROW_VERSION = 1

/** The stages of an open, in order: the head script ran; the entry's modules ran; the card's chunk loaded; the card's first render; the sign-in answer is in; the card was drawn; the Assistant's chat is known; its first message is drawn. */
export const CARD_MARKS = ['head', 'entry', 'chunk', 'render', 'auth', 'drawn', 'contact', 'message'] as const
export type CardMark = (typeof CARD_MARKS)[number]
export type CardMarks = Partial<Record<CardMark, number>>

/** What the page keeps on `window` between its own start script, main.tsx and the card (the first time a stage is reached is the one that counts). */
export interface MarkHolder {
  __sadMarks?: CardMarks
}

/** Notes the first time `name` is reached, in ms since the page's time origin (`now` is performance.now()). */
export function cardMarkOn(holder: MarkHolder, name: CardMark, now: number): void {
  const marks = (holder.__sadMarks ??= {})
  if (marks[name] === undefined && Number.isFinite(now)) marks[name] = now
}

const MAX_TAP_AGE_MS = 120_000

/**
 * `&t=<epoch ms of the tap>` from the card's address, when the app puts it there: a whole number of 10 to 14 digits that is within two minutes before now (the clock of the page and of the app is the phone's one)
 * and no more than a few seconds ahead. Anything else (a missing value, text, an old value, a future one) is no tap time: the page works the same without it.
 */
export function readTap(search: string, now: number): number | null {
  const raw = new URLSearchParams(search).get('t')
  if (raw === null || !/^[0-9]{10,14}$/.test(raw)) return null
  const t = Number(raw)
  return Number.isFinite(now) && t <= now + 5000 && t >= now - MAX_TAP_AGE_MS ? t : null
}

const round = (n: number): number => Math.round(n)
/** A duration or a time as a whole number of ms, or null when the browser had none (zero or missing where zero cannot be real) or it is not a number. */
const ms = (n: unknown, allowZero = false): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && (allowZero || n > 0) ? round(n) : null)

/** The parts of PerformanceNavigationTiming the row uses (all ms since the time origin, as the browser has them). */
export interface NavTiming {
  domainLookupStart?: number
  domainLookupEnd?: number
  connectStart?: number
  secureConnectionStart?: number
  connectEnd?: number
  requestStart?: number
  responseStart?: number
  responseEnd?: number
  domInteractive?: number
  loadEventEnd?: number
  transferSize?: number
}
export interface ResTiming {
  name: string
  transferSize: number
  decodedBodySize: number
}

export interface CardRow {
  v: number
  /** Date.now() when the row was written. */
  at: number
  /** The app's tap time (epoch ms) when it gave one, else null. */
  tap: number | null
  /** Tap to the page's time origin (the part native owns: startActivity, the WebView, loadUrl), ms, or null. */
  tapToNav: number | null
  /** Each stage, ms since the time origin, or null when it was not reached. */
  marks: Record<CardMark, number | null>
  /** The network side of the HTML: lookup, connection (with TLS), request to first byte, the body, DOM interactive, load, bytes transferred; null where the browser had none. */
  nav: { dns: number | null; connect: number | null; tls: number | null; ttfb: number | null; body: number | null; interactive: number | null; load: number | null; kb: number | null }
  /** The files the page loaded: how many, how many came from the WebView's cache (nothing transferred), the KB that crossed the network, the entry file's size in KB and whether it came from the cache (1 yes, 0 no, -1 not seen). */
  res: { n: number; cached: number; kb: number; entryKb: number; entryCached: number }
  /** The window's width in px. */
  w: number
}

export interface RowInput {
  now: number
  timeOrigin: number
  search: string
  width: number
  marks: CardMarks
  nav: NavTiming | null
  resources: readonly ResTiming[]
}

const ENTRY = /\/assets\/index-[^/]*\.js(?:\?|$)/

export function rowFrom(i: RowInput): CardRow {
  const tap = readTap(i.search, i.now)
  const toNav = tap === null ? null : i.timeOrigin - tap
  const marks = {} as Record<CardMark, number | null>
  for (const m of CARD_MARKS) marks[m] = ms(i.marks[m])
  const n = i.nav
  const span = (a: number | undefined, b: number | undefined): number | null => (typeof a === 'number' && typeof b === 'number' && b >= a ? ms(b - a) : null)
  const entry = i.resources.find(r => ENTRY.test(r.name))
  const cachedOne = (r: ResTiming) => r.transferSize === 0 && r.decodedBodySize > 0
  const net = i.resources.reduce((a, r) => a + (Number.isFinite(r.transferSize) && r.transferSize > 0 ? r.transferSize : 0), 0)
  return {
    v: CARD_ROW_VERSION,
    at: round(i.now),
    tap,
    tapToNav: toNav !== null && toNav >= -50 && toNav <= MAX_TAP_AGE_MS ? round(Math.max(0, toNav)) : null,
    marks,
    nav: {
      dns: n ? span(n.domainLookupStart, n.domainLookupEnd) : null,
      connect: n ? span(n.connectStart, n.connectEnd) : null,
      tls: n && (n.secureConnectionStart ?? 0) > 0 ? span(n.secureConnectionStart, n.connectEnd) : null,
      ttfb: n ? span(n.requestStart, n.responseStart) : null,
      body: n ? span(n.responseStart, n.responseEnd) : null,
      interactive: n ? ms(n.domInteractive) : null,
      load: n ? ms(n.loadEventEnd) : null,
      kb: n ? ms((n.transferSize ?? 0) / 1024, true) : null,
    },
    res: {
      n: i.resources.length,
      cached: i.resources.filter(cachedOne).length,
      kb: round(net / 1024),
      entryKb: entry ? round(entry.decodedBodySize / 1024) : -1,
      entryCached: entry ? (cachedOne(entry) ? 1 : 0) : -1,
    },
    w: Number.isFinite(i.width) && i.width > 0 ? round(i.width) : 0,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNullableNum = (v: unknown): boolean => v === null || isNum(v)

/** A row as this version writes it (an old or hand-edited entry that does not fit is dropped, never shown). */
export function isRow(v: unknown): v is CardRow {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.v !== CARD_ROW_VERSION || !isNum(r.at) || !isNullableNum(r.tap) || !isNullableNum(r.tapToNav) || !isNum(r.w)) return false
  const marks = r.marks as Record<string, unknown> | null
  if (typeof marks !== 'object' || marks === null || !CARD_MARKS.every(m => isNullableNum(marks[m]))) return false
  const nav = r.nav as Record<string, unknown> | null
  if (typeof nav !== 'object' || nav === null || !['dns', 'connect', 'tls', 'ttfb', 'body', 'interactive', 'load', 'kb'].every(k => isNullableNum(nav[k]))) return false
  const res = r.res as Record<string, unknown> | null
  return typeof res === 'object' && res !== null && ['n', 'cached', 'kb', 'entryKb', 'entryCached'].every(k => isNum(res[k]))
}

/** The stored rows: junk, a wrong shape or a missing value is none. */
export function parseRows(raw: string | null): CardRow[] {
  if (typeof raw !== 'string') return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(isRow) : []
  } catch {
    return []
  }
}

/** The stored text with `row` added, the oldest out beyond the last 20. */
export function addRow(raw: string | null, row: CardRow): string {
  return JSON.stringify([...parseRows(raw), row].slice(-CARD_TIMING_MAX_ROWS))
}
