// Order o6e08 (Shubham, 17 Nov 2026, relayed by the Assistant: "... when the keyboard [is] open dont show [the] bottom page menu this way we can see more chat when
// keyboard open"): whether the phone's on-screen keyboard is up, for the page bar at the foot (src/app/foot-bar-keyboard.ts hides it then).
//
// index.html asks for interactive-widget=resizes-content, so a keyboard makes the layout and the visual viewport shorter (the Android app's WebView resizes the same
// way). The rule: a text field has the focus AND the visual viewport is at least KEYBOARD_MIN_PX shorter than the tallest it has been at this width. Turning the phone
// or opening a Fold changes the width and starts the count over. Chrome's address bar comes and goes by about 56 px, well under the line; a phone keyboard is 200 px
// or more. A hardware keyboard shrinks nothing, so nothing hides. A field inside a dialog, a menu or the foot bar itself never counts: the page picker's own search
// must not take away the bar that holds the picker.
//
// No React and no DOM types here, so node tests drive the rule and the watcher with stand-ins (shared/keyboard-up.test.ts).

/** How much shorter than its tallest the view must be for the keyboard to count as up. */
export const KEYBOARD_MIN_PX = 150

export interface Baseline {
  width: number
  height: number
}

/** The tallest height seen at this width; a new width (more than 1 px off) starts over. The width it started at stays the anchor, so sub-pixel steps never drift it. */
export function nextBaseline(prev: Baseline | null, width: number, height: number): Baseline {
  if (!prev || Math.abs(prev.width - width) > 1) return { width, height }
  return height > prev.height ? { width: prev.width, height } : prev
}

/** The keyboard counts as up while a text field has the focus and the view is at least KEYBOARD_MIN_PX shorter than its tallest at this width. */
export const keyboardUp = (baseline: Baseline | null, height: number, typing: boolean): boolean => typing && baseline !== null && baseline.height - height >= KEYBOARD_MIN_PX

/** Text-like input types (an input with no type attribute reports 'text'). */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/** Where a focused field does not count: a dialog or sheet (the page picker on a phone), a popup menu, the foot bar itself. */
export const NOT_THE_PAGE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-foot-bar]'

interface FieldLike {
  tagName?: string
  type?: string
  readOnly?: boolean
  disabled?: boolean
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** Whether the focused element is a field of the page that takes typed text: a textarea, a text-like input or editable content, not read-only or disabled. */
export function typingInPage(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false
  const e = el as FieldLike
  const tag = String(e.tagName ?? '').toUpperCase()
  const field = e.isContentEditable === true || (tag === 'TEXTAREA' && !e.readOnly && !e.disabled) || (tag === 'INPUT' && TEXT_TYPES.has(String(e.type ?? 'text').toLowerCase()) && !e.readOnly && !e.disabled)
  if (!field) return false
  return typeof e.closest !== 'function' || !e.closest(NOT_THE_PAGE)
}

/** What the watcher needs from the browser; stand-ins in tests. */
export interface KeyboardEnv {
  /** window.visualViewport (resize events, width, height), or null where there is none. */
  viewport: (EventTarget & { width: number; height: number }) | null
  /** window (resize events, innerWidth, innerHeight). */
  win: EventTarget & { innerWidth: number; innerHeight: number }
  /** document (focusin and focusout, activeElement). */
  doc: EventTarget & { activeElement: unknown }
  /** Runs a check after the current event (the focus has moved by then). */
  later: (f: () => void) => void
}

/**
 * Watches the view and the focus; calls `onChange(up)` each time the answer changes (not on every event). Returns `stop`, which removes every listener it added.
 * The tallest height is remembered across stop/start in `memo`, so a watcher started while the keyboard is already up does not take the short view as the tallest.
 */
export function watchKeyboard(env: KeyboardEnv, onChange: (up: boolean) => void, memo: { baseline: Baseline | null; up: boolean } = { baseline: null, up: false }): () => void {
  const measure = () => {
    const width = Math.round(env.viewport?.width ?? env.win.innerWidth)
    const height = Math.round(env.viewport?.height ?? env.win.innerHeight)
    memo.baseline = nextBaseline(memo.baseline, width, height)
    const up = keyboardUp(memo.baseline, height, typingInPage(env.doc.activeElement))
    if (up !== memo.up) {
      memo.up = up
      onChange(up)
    }
  }
  const afterFocus = () => env.later(measure)
  env.viewport?.addEventListener('resize', measure)
  env.win.addEventListener('resize', measure)
  env.doc.addEventListener('focusin', afterFocus)
  env.doc.addEventListener('focusout', afterFocus)
  measure()
  return () => {
    env.viewport?.removeEventListener('resize', measure)
    env.win.removeEventListener('resize', measure)
    env.doc.removeEventListener('focusin', afterFocus)
    env.doc.removeEventListener('focusout', afterFocus)
  }
}
