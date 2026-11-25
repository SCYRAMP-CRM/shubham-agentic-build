// F-345: the Server's own choice for every chat it starts: "Chats put tasks in Goals" (Shubham: "all chats should have system prompt
// automatically injected that if user gives a task put it in goals instantly and organize it with nesting"). Kept by the hub in
// chat-settings.json; the Settings page (Chats) reads and changes it. Never kept in a browser.
export interface ChatSettings {
  /** On (the default): his own chats are told, when they start, to put every task he gives them in Goals and to nest its parts. Off: today's brief, unchanged. */
  tasksToGoals: boolean
}

export const DEFAULT_CHAT_SETTINGS: Readonly<ChatSettings> = Object.freeze({ tasksToGoals: true })

export interface ChatSettingsAnswer {
  settings: ChatSettings
  /**
   * The saved choice could not be read (a missing file is not that: it is the default, on). Until a choice is saved again chats start the OLD way (no
   * paragraph), and the page says so. The same rule as Quick's choices (shared/quick-settings.ts).
   */
  unreadable?: true
}
