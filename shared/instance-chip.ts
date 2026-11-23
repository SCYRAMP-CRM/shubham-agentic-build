// F-316 T4: the chip a chat draws on a message it received from another INSTANCE of the same template ("instance of <template> · hop <n>"), as a pure rule so it is tested without a page.
// What it reads is the sender the feed's converter made from the WHOLE received message (shared/chat.ts ChatSender.instance, from shared/instance-message.ts parseInstanceMessage): the page
// never reads a message line by line, so a header forged inside the words cannot draw a second chip.

import { INSTANCE_HOP_MAX } from './instance-message.ts'

/** The longest template name the chip itself shows; the tooltip carries the whole name (the same cut as the chat's own "instance of" chip). */
export const INSTANCE_CHIP_NAME_MAX = 32

export interface InstanceChipSender {
  name: string | null
  floor: string | null
  instance?: { template?: unknown; hop?: unknown } | null
}

export interface InstanceChip {
  /** What the chip says: short, it sits in the name line of the bubble. */
  text: string
  /** The longer sentence (the tooltip, and what a screen reader hears). */
  title: string
}

/** The chip for a received message's sender, or null when it did not come from another instance (every other message is drawn as it always was). */
export function instanceChip(from: InstanceChipSender | null | undefined): InstanceChip | null {
  const i = from?.instance
  if (!i || typeof i.template !== 'string') return null
  const template = i.template.trim()
  if (!template) return null
  const hop = typeof i.hop === 'number' && Number.isInteger(i.hop) && i.hop >= 1 ? i.hop : 1
  const shown = template.length > INSTANCE_CHIP_NAME_MAX ? `${template.slice(0, INSTANCE_CHIP_NAME_MAX - 1)}…` : template
  const who = from?.name ? `${from.name}${from.floor ? ` (floor ${from.floor})` : ''}` : 'Another chat'
  return {
    text: `instance of ${shown} · hop ${hop}`,
    title: `${who} is another instance of ${template}. This is hop ${hop} of ${INSTANCE_HOP_MAX}: messages between instances stop after hop ${INSTANCE_HOP_MAX}.`,
  }
}
