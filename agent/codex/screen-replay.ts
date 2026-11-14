// Shubham, 14 Nov 2026: "i dont see any context in codex chat". Codex's screen replays only its own event rows (event_msg user_message /
// agent_message) when a conversation is resumed; the model reads the response_item rows. A conversation carried over from Claude had none
// of those, so the chat opened on an empty screen although the model had the whole history. A carried conversation now ends with the last
// SCREEN_REPLAY_MESSAGES person/assistant words as those rows, in order: display only, never model context, never tool output. The shapes
// are the ones real Codex 0.163.0 rollouts hold (and 0.169.0 reads).

/** How many of the last carried messages the Codex screen shows again when the chat opens. */
export const SCREEN_REPLAY_MESSAGES = 40
/** One replayed message is cut to this many characters, so a huge pasted message cannot flood the terminal. */
export const SCREEN_REPLAY_CHARS = 4000

export type ReplayPayload = Record<string, unknown>

export function screenReplay(limit = SCREEN_REPLAY_MESSAGES, chars = SCREEN_REPLAY_CHARS) {
  const kept: { role: 'user' | 'assistant'; text: string; at: string }[] = []
  return {
    add(role: string, body: string, at: string) {
      if ((role !== 'user' && role !== 'assistant') || !body.trim() || body.startsWith('[Imported tool result]') || limit <= 0) return
      kept.push({ role, text: body.length > chars ? `${body.slice(0, chars)}…` : body, at })
      if (kept.length > limit) kept.shift()
    },
    payloads(): { at: string; payload: ReplayPayload }[] {
      return kept.map(m => ({ at: m.at, payload: m.role === 'user'
        ? { type: 'user_message', client_id: null, message: m.text, images: [], local_images: [], audio: [], local_audio: [], text_elements: [] }
        : { type: 'agent_message', message: m.text, phase: 'final_answer', memory_citation: null } }))
    },
  }
}
