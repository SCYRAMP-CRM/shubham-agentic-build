// Order o226e (Shubham, 16 Nov 2026, his words: "Now in the code next to screen hav3 xcfe please also the browser link i will see but i think there should be that also").
// PC control's Desktop tab: a PC's own Linux desktop (XFCE, order o851d on the Z800) through that PC's noVNC, shown in the page, with the browser
// link beside it. From the Assistant's and Lead's reading, not his words: its own tab beside Screen (Screen is unchanged, the RustDesk way), shown
// only where the noVNC page answers, and its own Settings › Access row, locked like Screen's.
// He opens PC control over https almost always (the Server by its tailnet name, and the phone app), and an https page cannot frame plain http. So a
// desktop served over https on that PC's own tailnet name (tailscale serve there) comes first; plain http by its tailnet address is the fallback,
// framed only on an http page (the Server's own screen) and otherwise offered as a link with the reason.
// The VNC password is typed into noVNC's own prompt and never stored, logged or put in a link (noVNC takes ?password=: the app never sets it).

export const PC_DESKTOP_PREFIX = '/pc-desktop'
/** noVNC's own default port (websockify --web): plain http on the PC's Tailscale address (order o851d on the Z800). */
export const DESKTOP_PORT = 6080
/** The same desktop over https on the PC's tailnet name (tailscale serve on that PC, with Tailscale's certificate). */
export const DESKTOP_HTTPS_PORT = 6443

/** GET /agent-api/pc-desktop/pcs/<id>: whether that PC's desktop answers now, and its page. */
export interface PcDesktop {
  pcId: string
  /** noVNC's page on that PC (https by its tailnet name when that answers, else plain http by its tailnet address), or null when nothing answers. */
  url: string | null
  /** One sentence when url is null: why (no tailnet address, nothing answers, not noVNC). */
  why: string | null
  checkedAt: string
}

/** A Tailscale IPv4 (100.64.0.0/10), or null: one of the two kinds of host this feature ever names. */
export function tailnetIp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v.trim())
  if (!m) return null
  const [a, b, c] = m.slice(1).map(Number)
  return a >= 64 && a <= 127 && b <= 255 && c <= 255 ? v.trim() : null
}

/** A name on a tailnet ("z800.tail36192f.ts.net"), or null: the other kind. */
export function tailnetHost(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase().replace(/\.$/, '')
  return s.length <= 253 && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/.test(s) ? s : null
}

const PAGE = 'vnc.html?autoconnect=1&resize=scale'
/** noVNC's page over https on the PC's tailnet name, with what it needs and nothing else (it takes host, port and /websockify from its own address). */
export const desktopHttpsUrl = (host: string): string => `https://${host}:${DESKTOP_HTTPS_PORT}/${PAGE}`
/** noVNC's page over plain http on the PC's tailnet address. */
export const desktopUrl = (ip: string): string => `http://${ip}:${DESKTOP_PORT}/${PAGE}`

/** A noVNC page, by its answer: 200 and noVNC's own text. */
export const looksLikeNoVnc = (status: number, body: string): boolean => status === 200 && /noVNC/.test(body)

/**
 * Whether a page served at `pageProtocol` can show `url` inside it. An https page cannot frame a plain http one (the browser blocks mixed content),
 * so there the tab offers the link only, and says why.
 */
export const canFrame = (pageProtocol: string, url: string): boolean => !(pageProtocol === 'https:' && url.startsWith('http:'))

/** Lead's sentence for that case, in words he can act on. */
export const noFrameWords = (pcName: string): string => `Your app page is https and ${pcName}’s desktop is plain http, so the browser will not show it inside this page: it opens in a new tab.`

/**
 * Lead's guard (o226e review): the frame runs with allow-same-origin, which is safe only while the desktop is ANOTHER origin than the app's
 * page (another host or port), so it keeps its own origin and can never reach the app's cookies, storage or page. The host list makes that true
 * today; this makes it true whatever later happens to the host list or the ports report: a url on the app's own origin, or one that is not a
 * url at all, is never framed.
 */
export function sameOriginAsPage(url: string, pageOrigin: string): boolean {
  try {
    return new URL(url).origin === pageOrigin
  } catch {
    return true
  }
}
export const sameOriginWords = (pcName: string): string =>
  `${pcName}’s desktop answers on this app’s own address, so it is not shown inside this page (it would run with this page’s rights): it opens in a new tab.`

/** The frame's sandbox and permissions, exactly (Lead: pinned by a source test, so anything added is a red test, not a review). */
export const DESKTOP_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock'
/** No clipboard-read (Lead): reading would let a page served by one PC read the clipboard of the PC you sit at. Writing (copy out) stays. */
export const DESKTOP_ALLOW = 'clipboard-write; fullscreen'
