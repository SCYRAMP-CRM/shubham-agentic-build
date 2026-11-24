import net from 'node:net'

// F-348 (Agent 14's read): does something answer on this port of this PC right now? A connect only, nothing is sent or read, with a short timeout. The Build page's plain restart asks it of the guard's port: SAD_SUPERVISED is
// read once at the start, so if the guard has died since, an exit would leave the app down until somebody pressed Start; the restart is refused in that case.

export function portAnswers(port: number, ms = 1000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(ms, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
