// F-316 (Shubham's order o75bb, his answer "B"): every chat may carry an EXPLICIT template, `FloorAgent.template = { id, name }`: the family it is an instance of ("Agentic Platform": Lead and
// Agent 1 to 19, each with its own brief; a copy of one of them joins the family). `id` is the key of the F-309 notebook table (agent/agentic/memory-notebook.ts), so the table, the notebook
// and the Agents page's card need nothing else to know which chats belong together; `name` is the label written on the chat.
//
// ABSENT when there is none (never null, never an empty object): a chat with no template is its own, and a floors file that has none is byte for byte what it was before this field.
// SERVER-OWNED like sessionId and homePc: floors.ts patch() puts the stored value back, whatever a page's copy of the chart says, so an old page or an old member PC that saves a floor
// without it cannot wipe it and one that sends it cannot set it; adopt() drops it (a member PC's word never puts a chat into a notebook of the hub).

export interface AgentTemplate {
  id: string
  name: string
}

/** A template's id is a folder's name in the notebook: lower case letters, digits and dashes, at most 40. */
export const TEMPLATE_ID_MAX = 40
export const TEMPLATE_NAME_MAX = 60

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Names Windows keeps for devices: a folder of one of these names fails, or hits a device (the notebook's own rule, Agent 14's F4). */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/

const validId = (v: string): boolean => TEMPLATE_ID.test(v) && !RESERVED_NAME.test(v)
export const isTemplateId = (v: unknown): v is string => typeof v === 'string' && validId(v)

/** The label: one line (every kind of white space and control character becomes one space), at most TEMPLATE_NAME_MAX characters. */
export function templateName(v: unknown): string {
  if (typeof v !== 'string') return ''
  let out = ''
  let space = false
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || /\s/.test(ch)) {
      space = out !== ''
      continue
    }
    if (space) out += ' '
    space = false
    out += ch
  }
  return out.slice(0, TEMPLATE_NAME_MAX).trim()
}

/** What a chat carries, or null: a valid id and a name with something in it. Anything else is no template (never half of one). */
export function cleanTemplate(raw: unknown): AgentTemplate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isTemplateId(r.id)) return null
  const name = templateName(r.name)
  return name ? { id: r.id, name } : null
}

/**
 * The id a family gets from the name the owner gives it ("Agentic Platform" -> "agentic-platform"): lower case ASCII letters and digits, runs of anything else one dash, at most 40, never a Windows
 * device name. A name with no letter or digit in it ("日本") is "template". The same name always gives the same id, so a second chat named into the family joins it instead of starting another.
 */
export function templateIdOf(name: unknown): string {
  const text = typeof name === 'string' ? name : ''
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TEMPLATE_ID_MAX)
    .replace(/-+$/g, '')
  const id = slug || 'template'
  return validId(id) ? id : `${id.slice(0, TEMPLATE_ID_MAX - 2)}-1`
}
