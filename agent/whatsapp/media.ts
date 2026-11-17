// Order oWA S3: what a message's file is answered as, to a browser page of this app. A file comes from whoever wrote the message, so nothing about it may be trusted to run:
// - only kinds a browser SHOWS without running anything (photos, sound, video) are sent to be shown inline; every other kind, and any kind that is not exactly one of them (an HTML page, an
//   SVG with a script in it, a script, a PDF, which can carry one), is sent as an anonymous download that is saved, never opened in this app's own address;
// - whatever it is, `nosniff` (the browser does not guess a kind), and a CSP that is a sandbox with nothing allowed, so even a file that did get opened has no way to act as the app.
// The name is the sender's too: it only ever appears percent-encoded, with control characters and path parts taken out.

const SHOWN = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/3gpp',
])

/** `type/subtype` in lower case with the parameters and anything odd dropped, or null when it is not a media type at all. */
export function cleanType(raw: string): string | null {
  const bare = raw.split(';')[0].trim().toLowerCase()
  return /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,80}$/.test(bare) ? bare : null
}

/** A file name fit to be offered for a download: no path, no control characters, no quotes, short. */
export function cleanName(raw: string | null | undefined): string {
  const base = [...String(raw ?? '')]
    .filter(ch => {
      const c = ch.charCodeAt(0)
      return c > 31 && c !== 127
    })
    .join('')
    .split(/[\\/]/)
    .pop()!
    .replace(/["';<>|*?:]/g, '_')
    .trim()
    .slice(0, 120)
  return base && base !== '.' && base !== '..' ? base : 'file'
}

export interface MediaHeaders {
  'content-type': string
  'content-disposition': string
  'cache-control': string
  'x-content-type-options': 'nosniff'
  'content-security-policy': string
}

/** The headers a file is answered with (see above). `type` is the kind WhatsApp gave, `name` the file's name, if it has one. */
export function mediaHeaders(type: string, name: string | null | undefined): MediaHeaders {
  const kind = cleanType(type)
  const shown = kind !== null && SHOWN.has(kind)
  const safeName = cleanName(name)
  return {
    'content-type': shown ? kind : 'application/octet-stream',
    'content-disposition': `${shown ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    // A message's file never changes, and it is the person's own: kept by their browser, not shared.
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; media-src 'self'",
  }
}
