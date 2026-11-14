/**
 * Input that xterm sends by ITSELF, not because a person typed: the focus reports a full-screen app (or the Windows console hosting it) asks
 * for (ESC [ I / ESC [ O, sent when the page gains or loses focus), and the answers to its queries (device attributes, cursor position,
 * status, colours). The page never lets them make a watching viewer the one that sets the size (terminal-size.ts), and the agent never takes
 * them for typing (chats.ts: input() moves no input epoch for them, so a message in flight is not cancelled by a page gaining focus: oeee2).
 */
// oxlint-disable-next-line no-control-regex -- terminal escape sequences are the point.
const AUTOMATIC = /^(?:\x1b\[[IO]|\x1b\[[?>=]?[\d;:]*[cRn]|\x1b\[\?[\d;$]*y|\x1b\](?:\d|rgb)[^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)$/
export const isAutomaticInput = (d: string): boolean => AUTOMATIC.test(d)
