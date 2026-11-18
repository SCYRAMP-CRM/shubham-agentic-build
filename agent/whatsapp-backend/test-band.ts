// The tests' ports for the WhatsApp backend (order oWA, after the queue failed on 17 Nov at 15:13 IST: WA_BACKEND_NO_PORT on 50931, then 50932). A BAND, never one literal port: startBackend({ port }) gives
// listenFirstFree a list of ONE, so when a rig or an outgoing connection holds that number the start has nowhere to move. startBackend({ ports }) takes the first free port of the band and writes down the one
// it got, as the hub's backend does with its own band (WA_BACKEND_PORTS, 65000-65099).
//
// The floor's rule (agent/SPEC.md, "Ports for tests"): test servers take 127.0.0.1, 50000-64999; 65000 and up is the app's own services. This band starts in 55000-64899, so it ends by 64918: above the
// 50000s, where the rigs live and where Stable ports' default blocks (51011-51999) are, and below the backend's own band. Nobody assumes it is exclusive: that is what taking the first free one is for.

export const testBand = (n = 20): number[] => {
  const from = 55000 + Math.floor(Math.random() * 9900)
  return Array.from({ length: n }, (_, i) => from + i)
}

/**
 * Starts something that listens on ONE port (startApi, a plain net server) on the first FREE port of a band: what listenFirstFree does for the backend (server.ts) for a start that cannot take a list.
 * The same rule: EADDRINUSE, or EACCES (Windows' excluded ranges), moves on to the next port; anything else is a real fault and stops at once, from the first port, so it is never retried into silence.
 * `start` is given one port and returns what it started, or rejects. A band used up rejects with the band and the last code named: never a hang, never an undefined.
 * (A7 of C:/saw/port-collisions-20261117/FINDINGS.md: startApi({ port: 56000 + pid % 5000 }) was ONE draw, tried once.)
 */
export async function startOnBand<T>(start: (port: number) => Promise<T>, band: readonly number[] = testBand()): Promise<T> {
  if (band.length === 0) throw new Error('startOnBand: the band is empty')
  let last: string | undefined
  for (const port of band) {
    try {
      return await start(port)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e
      last = code
    }
  }
  const span = band.length === 1 ? `${band[0]}` : `${band[0]}-${band[band.length - 1]}`
  throw new Error(`startOnBand: no free port in ${span} (${band.length} tried, the last: ${last})`)
}
