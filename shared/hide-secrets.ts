// F-361 (moved here from agent/agentic/old-reader.ts, o5007; the old reader re-exports it unchanged): ONE line with the secrets in it hidden. It is the one masker of the app for text that came from a file or a chat
// and is about to be shown or kept: the old-app reader runs every line it hands back through it, and a chat's goal-progress line (F-361) goes through it before it is kept. It only ever HIDES: a line without a
// secret comes back as it was. One line at a time (a private key that spans lines is handled by old-reader.ts's maskLines).

const LINE_SECRETS: [RegExp, string][] = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[a token is stored here]'],
  [/\b(?:sk|pk|rk)-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/g, '[a key is stored here]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[a token is stored here]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[a key is stored here]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[a key is stored here]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[a token is stored here]'],
  // The password of a connection string (scheme://user:password@host).
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:)[^\s@'"`]+@/gi, '$1[hidden]@'],
  // password = "…", "apiKey": '…', token: `…` (a literal of six characters or more given to a secret's name).
  [/((?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|client[-_]?secret|auth[-_]?key)\w*["']?\s*[:=]\s*["'`])([^"'`\s]{6,})(["'`])/gi, '$1[hidden]$3'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, '$1[hidden]'],
]

/** One line with its secrets hidden. */
export function hideSecrets(line: string): string {
  let s = line
  for (const [re, to] of LINE_SECRETS) s = s.replace(re, to)
  return s
}

// F-361 (Agent 14's fix 2): the words a CHAT writes about its own work are not a file, so two more shapes are hidden from them. hideSecrets is left as it was (the old-app reader's behaviour does not change); a chat's
// goal-progress and waiting lines go through hideKeys AFTER it. The PC key (F-351) is "<this PC's device id>.<43 base64url characters>" (agent/claude/pc-key.ts KEY_SHAPE, the CRM's lib/agenticPcKey.js); and a
// bare run of 40 or more letters, digits, "-" and "_" with no space is a key, a token or a hash and never a word of a status line. A run is hidden WHOLE, so a key cut by the 200-code-point limit afterwards is never half shown.
const KEY_SECRETS: [RegExp, string][] = [
  [/(?<![A-Za-z0-9_.:-])[A-Za-z0-9][A-Za-z0-9_.:-]{3,99}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '[a key is stored here]'],
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, '[a key is stored here]'],
]

/** One line with the PC key shape and every bare run of 40 or more key-like characters hidden (the rest as it was). */
export function hideKeys(line: string): string {
  let s = line
  for (const [re, to] of KEY_SECRETS) s = s.replace(re, to)
  return s
}
