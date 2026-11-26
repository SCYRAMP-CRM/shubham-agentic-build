import { GOAL_ID_RE } from './goal-floors.ts'

// F-369 (Shubham: "nwo one big probelm add this in the goals when we click th egoasl that time when we reopen it doenst rememreb the expand collapse of last time that needs to be fixed", and then "and keep all subnest expanded by defualt"): what the
// Alt+G goals curtain remembers of how he left it. The curtain is drawn again each time it opens, so what he had folded was forgotten. Two things are kept, in this browser, as goal IDS ONLY (the CRM's own id shape): the goals whose SUB-GOALS he
// COLLAPSED (`collapsed`: every goal's sub-goals show, at every level, until he collapses them, so a goal with no remembered choice is expanded) and the goals whose DETAILS he opened (`rows`: details are closed until he opens them).
// Nothing of a goal's words is ever stored. Pure: the page hands in how to read and write its storage, so the rules are tested without a page.

/** The one key, in this browser. */
export const CURTAIN_FOLD_KEY = 'sad-curtain-fold'
/** The newest this many goals of each kind are kept: a list that only grows is a list that is never read again. */
export const CURTAIN_FOLD_MAX = 500

export interface CurtainFold {
  /** Goals whose sub-goals HE collapsed. Any other goal's sub-goals show (all levels): expanded by default. */
  collapsed: ReadonlySet<string>
  /** Goals whose details he opened. */
  rows: ReadonlySet<string>
}
export const NO_CURTAIN_FOLD: CurtainFold = { collapsed: new Set(), rows: new Set() }

/** The ids of one stored list: only strings that are a goal id, each once, the newest CURTAIN_FOLD_MAX (the list is oldest first, so these are the last ones). */
function idsOf(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set()
  const seen = new Set<string>()
  const ok: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && GOAL_ID_RE.test(v) && !seen.has(v)) {
      seen.add(v)
      ok.push(v)
    }
  }
  return new Set(ok.slice(-CURTAIN_FOLD_MAX))
}

/** What was kept: nothing for no storage, a value that does not parse, or anything that is not the shape `{ c: [...], r: [...] }`; a list that is not a list is empty, an entry that is not a goal id is dropped. */
export function readCurtainFold(get: (key: string) => string | null): CurtainFold {
  let text: string | null
  try {
    text = get(CURTAIN_FOLD_KEY)
  } catch {
    return NO_CURTAIN_FOLD
  }
  if (text === null) return NO_CURTAIN_FOLD
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return NO_CURTAIN_FOLD
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return NO_CURTAIN_FOLD
  const o = v as { c?: unknown; r?: unknown }
  return { collapsed: idsOf(o.c), rows: idsOf(o.r) }
}

/** What to keep: the same shape, the newest CURTAIN_FOLD_MAX of each (a set remembers the order things were folded in), goal ids only. */
export function curtainFoldText(fold: CurtainFold): string {
  return JSON.stringify({ c: [...idsOf([...fold.collapsed])], r: [...idsOf([...fold.rows])] })
}

/** The set with `id` added, or taken out if it was there (a new set: the one given is never changed). */
export function toggledFoldSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

/** The set without `id` (a new set; the same set when `id` was not in it): a goal whose sub-goals are made to show (a sub-goal was added under it, a goal was moved in under it) is no longer a collapsed one. */
export function withoutFoldId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}
