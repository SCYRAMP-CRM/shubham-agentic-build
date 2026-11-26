// F-306 (his order od3f8: "we need to have 5 tabs on the top: Chats, Goals, Notes, Tab 4, and Tab 5. Keep Tab 4 and Tab 5 empty, and Tab 3, which is the Notes, should come from the CRM itself"). ONE list of the overlay
// Assistant's tabs, read by the tab row (src/approvals/OverlayTabs.tsx) AND by the swipe order (src/overlay/swipe-tabs.ts), so the two can never differ: before this there were two lists and a test that kept them equal.
// Pure, so it is tested by tables (shared/overlay-tabs.test.ts). Who may have which tab is decided elsewhere (src/overlay-goals/access.ts); this file only orders and filters.

export type OverlayTab = 'chat' | 'goals' | 'notes' | 'tab4' | 'tab5'

/** The order of the tabs, left to right (and the order a swipe goes in). Tab 1 is today's Chat tab, Tab 2 Goals, Tab 3 Notes (the CRM's own), Tab 4 and Tab 5 are empty. */
export const OVERLAY_TAB_ORDER: readonly OverlayTab[] = ['chat', 'goals', 'notes', 'tab4', 'tab5']

/** What each tab says on its button and to a screen reader ("Chats": his word; Tab 4 and Tab 5 are labels only). */
export const OVERLAY_TAB_LABELS: Readonly<Record<OverlayTab, string>> = { chat: 'Chats', goals: 'Goals', notes: 'Notes', tab4: 'Questions', tab5: 'Tab 5' }

/** What a tab's button says: the old two-tab row (a setting: the old way stays) says "Chat" as it always did; the five say "Chats". */
export const tabLabel = (tab: OverlayTab, choice: TabsChoice): string => (choice === 'two' && tab === 'chat' ? 'Chat' : OVERLAY_TAB_LABELS[tab])

/** The tabs that have nothing in them (yet): their body is empty. F-317 (his order o0933): Tab 4 is the Questions tab now (src/overlay-notes/QuestionsTab.tsx); only Tab 5 is empty. */
export const EMPTY_TABS: readonly OverlayTab[] = ['tab5']

/** 'five': the row he asked for (the start). 'two': the old row, Chat and Goals only (a device setting, Settings > Chats > Assistant style: the old way stays). */
export type TabsChoice = 'five' | 'two'
export const DEFAULT_TABS_CHOICE: TabsChoice = 'five'

/** Anything but 'two' is 'five': a new device, junk in storage, or no storage at all. */
export const parseTabsChoice = (raw: string | null | undefined): TabsChoice => (raw === 'two' ? 'two' : DEFAULT_TABS_CHOICE)

/** What a person may have of the tabs that are not always there (src/overlay-goals/access.ts: Goals follows the Goals page's rule, Notes follows the CRM page's). */
export interface TabAccess {
  goals: boolean
  notes: boolean
}

/**
 * Whether the tab row is shown at all. The owner's window always shows it; a person's window shows it only when they have a tab beyond Chats (Goals, or Notes with the five): Tab 4 and Tab 5 come WITH the row,
 * they never make a row of their own (a person with only a chat sees the chat, as before).
 */
export const rowShown = (access: TabAccess, choice: TabsChoice): boolean => (choice === 'two' ? access.goals : access.goals || access.notes)

/** The tabs in the row, in order. When no row is shown, only the chat. */
export function visibleTabs(access: TabAccess, choice: TabsChoice): readonly OverlayTab[] {
  if (!rowShown(access, choice)) return ['chat']
  if (choice === 'two') return ['chat', 'goals']
  return OVERLAY_TAB_ORDER.filter(t => (t === 'goals' ? access.goals : t === 'notes' ? access.notes : true))
}

/** The tab on show: a tab that is not in the row (signed out, another person, a setting changed, access closed after it was opened) shows the chat. */
export const shownTab = (tab: OverlayTab, visible: readonly OverlayTab[]): OverlayTab => (visible.includes(tab) ? tab : 'chat')
