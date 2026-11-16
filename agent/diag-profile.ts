import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import path from 'node:path'
import { apiError, type ApiMount, type MountRequest } from './api.ts'
import { isPageRequest } from './auth/types.ts'
import type { Logger } from './log.ts'

// Lead, 16 Nov 2026 (option (a) of the Y: stalls): the agent's main thread is busy (0.96 ms of CPU per ms through every stall, ~0.4-0.57 always) and nothing it logs names
// what it is doing. This names it: a CPU profile of the main thread, taken INSIDE the process through node:inspector's Session. No inspector port is ever opened (a Session
// talks to the in-process back-end; only inspector.open() listens), so nothing on the network or on loopback can attach.
//
// POST /agent-api/diag/cpu-profile {"seconds": 30}: the program on this PC only (the machine token and no page marker; the owner's own pages are refused too), and only while
// <state>/cpu-profile.on exists (fail-closed: no file, or any doubt, is off). One profile at a time. The whole profile is written to <state>/diag/cpu-<time>.cpuprofile
// (open it in Chrome's DevTools or VS Code); the answer names the functions that used the most time themselves.

export const CPU_PROFILE_SWITCH = 'cpu-profile.on'
const MAX_SECONDS = 120
const SAMPLE_US = 1000

export interface CpuProfileOptions {
  /** The agent's state folder: the switch is read here, and profiles are written to its diag folder. */
  dir: string
  log?: Logger
}

/** What a profile spent its time on, by the function that was running (its own time, not what it called). */
export interface CpuProfileAnswer {
  file: string
  seconds: number
  samples: number
  top: { fn: string; at: string; selfMs: number; pct: number }[]
}

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
}
interface Profile {
  nodes: ProfileNode[]
  startTime: number
  endTime: number
  samples?: number[]
}

/** The functions with the most samples of their own, heaviest first. */
export function topOf(profile: Profile, n = 15): CpuProfileAnswer['top'] {
  const total = profile.samples?.length ?? profile.nodes.reduce((s, x) => s + (x.hitCount ?? 0), 0)
  const msPerSample = total ? (profile.endTime - profile.startTime) / 1000 / total : 0
  const by = new Map<string, { fn: string; at: string; hits: number }>()
  for (const node of profile.nodes) {
    const hits = node.hitCount ?? 0
    if (!hits) continue
    const { functionName, url, lineNumber } = node.callFrame
    const fn = functionName || '(anonymous)'
    const at = url ? `${url.replace(/^file:\/\/\//, '')}:${lineNumber + 1}` : ''
    const key = `${fn}\0${at}`
    const was = by.get(key)
    if (was) was.hits += hits
    else by.set(key, { fn, at, hits })
  }
  return [...by.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, n)
    .map(x => ({ fn: x.fn, at: x.at, selfMs: Math.round(x.hits * msPerSample), pct: total ? Math.round((x.hits / total) * 1000) / 10 : 0 }))
}

export function createCpuProfileMount(o: CpuProfileOptions): ApiMount {
  let running = false
  const on = (): boolean => {
    try {
      return existsSync(path.join(o.dir, CPU_PROFILE_SWITCH))
    } catch {
      return false
    }
  }

  async function profile(seconds: number): Promise<CpuProfileAnswer> {
    const session = new Session()
    session.connect()
    try {
      await session.post('Profiler.enable')
      await session.post('Profiler.setSamplingInterval', { interval: SAMPLE_US })
      await session.post('Profiler.start')
      await new Promise(r => setTimeout(r, seconds * 1000))
      const { profile } = (await session.post('Profiler.stop')) as unknown as { profile: Profile }
      const out = path.join(o.dir, 'diag')
      mkdirSync(out, { recursive: true })
      const file = path.join(out, `cpu-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`)
      writeFileSync(file, JSON.stringify(profile))
      return { file, seconds, samples: profile.samples?.length ?? 0, top: topOf(profile) }
    } finally {
      session.disconnect()
    }
  }

  return {
    prefix: '/diag',
    async http(req: MountRequest) {
      if (req.rest !== '/cpu-profile') throw apiError(404, `No such path: /diag${req.rest}`)
      if (req.method !== 'POST') throw apiError(405, `${req.method} is not allowed here`)
      // The program on this PC only: a page (even the owner's own) never gets a profile of the agent.
      if (isPageRequest(req.headers)) throw apiError(403, 'Only the program on this PC may take a CPU profile')
      if (!on()) throw apiError(403, `The CPU profile is off (it is on only while ${CPU_PROFILE_SWITCH} is in the agent's folder)`)
      const asked = (req.body as { seconds?: unknown } | undefined)?.seconds
      const seconds = asked === undefined ? 30 : Number(asked)
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) throw apiError(400, `seconds is a whole number from 1 to ${MAX_SECONDS}`)
      if (running) throw apiError(409, 'A CPU profile is being taken now')
      running = true
      try {
        o.log?.info(`diag: a CPU profile of the main thread for ${seconds} s`)
        const answer = await profile(seconds)
        o.log?.info(`diag: CPU profile written (${answer.samples} samples): ${answer.file}`)
        return answer
      } finally {
        running = false
      }
    },
  }
}
