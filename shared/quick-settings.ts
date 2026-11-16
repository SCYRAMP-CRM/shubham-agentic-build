// o1cfa: a preference for the owner's existing Quick host, not an Access grant,
// microphone switch, extra process or conversational ownership claim.
export interface QuickSettings {
  keepRunning: boolean
}

export const DEFAULT_QUICK_SETTINGS: Readonly<QuickSettings> = Object.freeze({ keepRunning: true })

export interface QuickSettingsAnswer {
  settings: QuickSettings
  /** False when this Server has not enabled the Quick host. The preference alone never enables it. */
  available: boolean
}
