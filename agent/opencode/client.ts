/** How long the event stream waits before asking again, after `failures` streams in a row that gave no data (0 or 1: a second): doubling, never over 30 s. */
export const eventsRetryWaitMs = (failures: number): number => Math.min(1000 * 2 ** Math.max(0, Math.min(failures - 1, 10)), 30_000)

/** A sleep that ends at once when the stream is aborted (a shutdown is not held up for the wait: up to 30 s), and leaves no listener behind when it ends by itself. */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

export class OpenCodeClient {
  readonly url: string
  #headers: Record<string, string>
  constructor(port: number, password: string, cwd: string) {
    this.url = `http://127.0.0.1:${port}`
    this.#headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'content-type': 'application/json', 'x-opencode-directory': cwd }
  }
  async request(route: string, method = 'GET', body?: unknown, timeout = 30000): Promise<any> {
    const res = await fetch(this.url + route, { method, headers: this.#headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) })
    if (!res.ok) { await res.body?.cancel(); throw new Error(`OpenCode request failed (${res.status}).`) }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
  async events(signal: AbortSignal, onEvent: (event: any) => void, wait: (failures: number) => number = eventsRetryWaitMs): Promise<void> {
    // F-372 (the retry-storm audit): a stream that gives no data (the server is down or refuses) is asked for again after 1, 1, 2, 4... up to 30 s, not every 1 s forever; one that delivered data starts over at 1 s.
    let failures = 0
    while (!signal.aborted) {
      let healthy = false
      try {
        const res = await fetch(this.url + '/event', { headers: this.#headers, signal })
        if (!res.ok || !res.body) throw new Error('OpenCode event connection failed')
        const decoder = new TextDecoder(); let pending = ''
        for await (const chunk of res.body) {
          healthy = true
          pending += decoder.decode(chunk, { stream: true }).replace(/\r/g, '')
          let end: number
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, end); pending = pending.slice(end + 2)
            for (const line of frame.split('\n')) if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))) } catch { /* malformed event */ } }
          }
          if (pending.length > 4 * 1024 * 1024) throw new Error('OpenCode event frame too large')
        }
      } catch { if (signal.aborted) return }
      if (!signal.aborted) { failures = healthy ? 0 : failures + 1; onEvent({ type: 'reconnect' }); await sleepUnlessAborted(wait(failures), signal) }
    }
  }
}
