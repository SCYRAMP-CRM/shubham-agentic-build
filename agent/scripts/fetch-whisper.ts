import { modelFromEnv } from '../speech/engine.ts'
import { installWhisper, type InstallOptions, type InstallResult, type WhisperPart } from '../whisper-install/install.ts'
import { hasPinnedModel } from '../whisper-install/manifest.ts'

// F-251: Whisper as one of the app's dependencies on THIS PC (whisper-install/install.ts): the official whisper.cpp
// program and the small model, pinned, checked and added only where missing. Install.ps1 runs it as its last step and
// PC control > Dependencies shows it as the fix; nothing in the agent imports it. No shell, elevation or remote caller.
//   node agent/scripts/fetch-whisper.ts --part all|program|model [--model small]
// Ctrl+C (or closing its window) stops it cleanly: its partial download goes, and nothing that was here is touched.

export const USAGE = 'Usage: node agent/scripts/fetch-whisper.ts --part program|model|all [--model small]'

export interface CliPlan {
  part: WhisperPart
  model: string
  /** Said first, when the plan is narrower than asked. */
  note?: string
}

export function cliPlan(args: readonly string[], envModel: string | undefined): CliPlan {
  if (![2, 4].includes(args.length) || args[0] !== '--part' || !['program', 'model', 'all'].includes(args[1]) || (args.length === 4 && args[2] !== '--model')) throw new Error(USAGE)
  const model = args.length === 4 ? args[3] : modelFromEnv(envModel)
  if (args[1] === 'all' && !hasPinnedModel(model)) {
    return { part: 'program', model, note: `Whisper model ${model} has no pinned download: only the program is checked here. Put ggml-${model}.bin in the models folder by hand.` }
  }
  return { part: args[1] as WhisperPart, model }
}

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
  signal?: AbortSignal
  /** Tests: instead of the real install. */
  install?: (o: InstallOptions) => Promise<InstallResult>
}

/** Its exit code: 0 done (or nothing to do), 1 failed, 130 stopped. */
export async function runCli(args: readonly string[], envModel: string | undefined, io: CliIo): Promise<number> {
  try {
    const plan = cliPlan(args, envModel)
    if (plan.note) io.out(plan.note)
    const shown = new Map<string, number>()
    const result = await (io.install ?? installWhisper)({
      part: plan.part, model: plan.model, signal: io.signal,
      // A line per tenth of each download: the model is 488 MB.
      onProgress: (part, bytes, total) => {
        const tenth = Math.floor((bytes / total) * 10)
        if (shown.get(part) === tenth) return
        shown.set(part, tenth)
        io.out(`  ${part === 'program' ? 'Whisper program' : `model ${plan.model}`}: ${Math.round(bytes / 1e6)} of ${Math.round(total / 1e6)} MB`)
      },
    })
    io.out(result.added.length ? `Whisper ${result.version} (${result.build}): added the ${result.added.join(' and the ')}.` : 'Whisper is here already: nothing to add.')
    for (const l of result.leftover) io.out(`  Not cleaned up, remove it by hand: ${l}`)
    io.out(JSON.stringify(result))
    return 0
  } catch (e) {
    io.err(`Whisper setup: ${e instanceof Error ? e.message : String(e)}`)
    return io.signal?.aborted ? 130 : 1
  }
}

if (import.meta.main) {
  const controller = new AbortController()
  let stops = 0
  // The first stops it cleanly; a second one, while that cleanup runs, ends it at once.
  for (const name of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) {
    process.on(name, () => {
      if (++stops > 1) process.exit(130)
      controller.abort(new Error('Stopped'))
    })
  }
  process.exitCode = await runCli(process.argv.slice(2), process.env.SAD_WHISPER_MODEL, {
    out: line => process.stdout.write(`${line}\n`),
    err: line => process.stderr.write(`${line}\n`),
    signal: controller.signal,
  })
}
