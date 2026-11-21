import { readFileSync } from 'node:fs'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// F-302 L4 (Agent 14's review R2): the PCs the owner marked as HIS. An unsigned page on a member PC (sign-in off there) is the app's owner only when that PC is marked here; a PC not marked is looked at, never typed from.
// The owner's only, kept on the Server. No file = no PC is marked (fail closed); a file that cannot be read marks none and says so until he marks again.

const MAX_PCS = 50
const MAX_ID = 64

export interface OwnerPcsStore {
  has(id: string): boolean
  list(): string[]
  unreadable(): boolean
  /** The page's body is the list and nothing else: who marked is the caller (the route asks requireCrmHuman). */
  set(raw: unknown): { pcs: string[] }
}

/** {pcs: [id, ...]} with at most 50 distinct ids of 1 to 64 characters; anything else is null. Other keys are not read. */
export function ownerPcsOf(v: unknown): string[] | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const pcs = (v as Record<string, unknown>).pcs
  if (!Array.isArray(pcs) || pcs.length > MAX_PCS) return null
  const out: string[] = []
  for (const id of pcs) {
    if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID) return null
    if (!out.includes(id)) out.push(id)
  }
  return out
}

export function createOwnerPcs(file: string): OwnerPcsStore {
  let pcs: string[] = []
  let unreadable = false
  try {
    const saved = ownerPcsOf(JSON.parse(readFileSync(file, 'utf8')))
    if (saved) pcs = saved
    else unreadable = true
  } catch (e) {
    // Only "there is no such file" is no PC marked yet; anything else is a list we could not read (none marked, said so).
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  return {
    has: id => pcs.includes(id),
    list: () => [...pcs],
    unreadable: () => unreadable,
    set(raw) {
      const next = ownerPcsOf(raw)
      if (!next || Object.keys(raw as object).some(k => k !== 'pcs')) throw apiError(400, 'Expected {pcs: [PC ids]} (at most 50) and nothing else')
      writeAtomic(file, `${JSON.stringify({ pcs: next }, null, 2)}\n`)
      pcs = next
      unreadable = false
      return { pcs: [...pcs] }
    },
  }
}
