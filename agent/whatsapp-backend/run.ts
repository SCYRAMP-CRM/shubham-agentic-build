// Order o8d7e (F-223): starts WhatsApp's backend on this Server. State: WA_BACKEND_DIR (default %LOCALAPPDATA%\shubham-agentic\whatsapp-backend).
// Order of5a0: the hub starts it and keeps it running (supervisor.ts); it can still be run by hand: node agent/whatsapp-backend/run.ts (Node 24).
// Port: WA_BACKEND_PORT (one port, 50000 or higher) if set; else the first free port of WA_BACKEND_PORTS ("from-to"), by default
// shared/whatsapp.ts's band (65000-65099, shared on purpose: read the comment there). The port it got is written to <dir>\port.
// Started by the hub (an IPC channel): it says {t:'ready', port, pid} once it listens, or {t:'failed', why, code} if it can't start; it stops
// cleanly (Chrome closed properly, the login kept) on {t:'quit'}, and when the hub goes away (the channel closes). By hand: on Ctrl+C.
// Exit codes: 0 stopped as asked, 3 no free port, 4 another backend runs for this folder, 1 anything else.
import path from 'node:path'
import { WA_BACKEND_PORTS } from '../../shared/whatsapp.ts'
import { createLogger } from '../log.ts'
import { bandPorts, checkPort, startBackend, type Backend } from './server.ts'

const log = createLogger({ console: true, dir: null })
const tell = (m: Record<string, unknown>) => {
  try {
    process.send?.(m)
  } catch {
    // The hub is gone: nothing to tell.
  }
}

function portsWanted(): number[] {
  const one = process.env.WA_BACKEND_PORT
  if (one !== undefined && one !== '') return [checkPort(Number(one))]
  const band = process.env.WA_BACKEND_PORTS
  const m = band === undefined || band === '' ? null : /^(\d{5})-(\d{5})$/.exec(band)
  if (band !== undefined && band !== '' && !m) throw new Error(`WA_BACKEND_PORTS must be "from-to" (got ${band})`)
  return bandPorts(m ? { from: Number(m[1]), to: Number(m[2]) } : WA_BACKEND_PORTS)
}

const dir = process.env.WA_BACKEND_DIR || path.join(process.env.LOCALAPPDATA ?? '.', 'shubham-agentic', 'whatsapp-backend')

let backend: Backend
try {
  backend = await startBackend({ ports: portsWanted(), dir, log })
} catch (e) {
  const code = (e as { code?: unknown }).code
  const why = e instanceof Error ? e.message : String(e)
  log.error(`WhatsApp backend could not start: ${why}`)
  tell({ t: 'failed', why, code: typeof code === 'string' ? code : null })
  process.exitCode = code === 'WA_BACKEND_NO_PORT' ? 3 : code === 'WA_BACKEND_BUSY' ? 4 : 1
  process.disconnect?.()
  await log.close()
  process.exit()
}

tell({ t: 'ready', port: backend.port, pid: process.pid })
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  backend.close().then(
    () => process.exit(0),
    e => {
      log.error(`WhatsApp backend: closing failed: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    },
  )
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('message', m => {
  if (m !== null && typeof m === 'object' && (m as { t?: unknown }).t === 'quit') stop()
})
// The hub ended (or let go of it): close WhatsApp properly and end, so nothing it started outlives it.
process.on('disconnect', stop)
