// oc58f: forwarding a request is not human approval of the requested action.
export interface QuickForwardingSettings {
  sendsWithoutAsking: boolean
}

export interface QuickForwardingAnswer {
  settings: QuickForwardingSettings
  /**
   * oc58f follow-up: the saved choice could not be read (not a missing file: that is the default, on). Until a choice is saved again Quick asks
   * first, the card until his tap, and the page says so. Absent when the choice was read or never made.
   */
  unreadable?: true
}

export const DEFAULT_QUICK_FORWARDING: Readonly<QuickForwardingSettings> = Object.freeze({ sendsWithoutAsking: true })

/** Labels may lower trust, never claim a tap that did not happen. Names are chosen by the hub, not the model. */
export const quickUntappedSender = (name: string, via: 'voice' | 'typed') =>
  `${name} (${via === 'voice' ? 'spoken' : 'typed'}, not tapped)`
