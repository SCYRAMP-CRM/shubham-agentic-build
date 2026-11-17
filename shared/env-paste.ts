import { TAB_LIMITS, VAR_NAME } from './codebase-tabs.ts'

// order o94f3 (Shubham: "urgently we nee md the env tab with plus button for adding envs"; the Assistant's words: an "import from .env" paste box that parses KEY=VALUE lines): the parser of what is pasted.
// Pure and dependency-free. The values stay in the browser until he presses Import (the preview lists NAMES only), and nothing here ever puts a value in a message: a line it cannot use is reported by its
// number and the reason, never by its text.

export interface EnvLine {
  name: string
  value: string
}
export interface EnvSkip {
  /** The line's number in what was pasted (from 1); 0 for the variables left out because there were too many. */
  line: number
  why: string
}
export interface EnvParse {
  vars: EnvLine[]
  skipped: EnvSkip[]
  /** Names that were given more than once: the LAST one is kept (as dotenv does). */
  duplicates: string[]
}

/** The most one paste may hold (the agent's own limit, too). */
export const ENV_PASTE_MAX_VARS = 200

/** The first quote character at or after `from` that is not escaped (a backslash makes the character after it a pair with it), or -1. */
function closingQuote(s: string, quote: string, from: number): number {
  for (let k = from; k < s.length; k++) {
    if (s[k] === '\\') k++
    else if (s[k] === quote) return k
  }
  return -1
}

/**
 * KEY=VALUE lines as a .env file has them. Blank lines and lines that start with # are ignored; "export KEY=VALUE" is read as KEY=VALUE; a value in single or double quotes is what is between them (it may
 * run over several lines, as a private key does; what follows the closing quote, a comment, is dropped); an unquoted value ends at a " #" comment. Nothing is unescaped: a backslash and an \n stay as
 * they were typed, so what is kept is exactly what stood between the quotes.
 */
export function parseEnvText(text: string): EnvParse {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = body.split(/\r?\n/)
  const last = new Map<string, EnvLine>()
  const order: string[] = []
  const skipped: EnvSkip[] = []
  const duplicates: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t || t.startsWith('#')) continue
    const start = i + 1
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(t)
    if (!m) {
      skipped.push({ line: start, why: 'not NAME=VALUE' })
      continue
    }
    const name = m[1]
    const rest = m[2]
    let value: string
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0]
      const end = closingQuote(rest, quote, 1)
      if (end >= 0) value = rest.slice(1, end)
      else {
        // Not closed on this line: the value goes on over the lines that follow, up to the line that closes it.
        const parts = [rest.slice(1)]
        let closedAt = -1
        for (let j = i + 1; j < lines.length && closedAt < 0; j++) {
          const e = closingQuote(lines[j], quote, 0)
          if (e >= 0) {
            parts.push(lines[j].slice(0, e))
            closedAt = j
          } else parts.push(lines[j])
        }
        if (closedAt < 0) {
          skipped.push({ line: start, why: 'a quote that is never closed' })
          continue
        }
        value = parts.join('\n')
        i = closedAt
      }
    } else {
      value = rest.startsWith('#') ? '' : rest.replace(/\s+#.*$/, '').trimEnd()
    }
    if (!VAR_NAME.test(name) || name.length > TAB_LIMITS.varName) {
      skipped.push({ line: start, why: 'the name is not usable' })
      continue
    }
    if (value.length > TAB_LIMITS.varValue) {
      skipped.push({ line: start, why: `the value is longer than ${TAB_LIMITS.varValue} characters` })
      continue
    }
    if (last.has(name)) duplicates.push(name)
    else order.push(name)
    last.set(name, { name, value })
  }
  const vars = order.map(n => last.get(n) as EnvLine)
  if (vars.length > ENV_PASTE_MAX_VARS) {
    for (const extra of vars.splice(ENV_PASTE_MAX_VARS)) skipped.push({ line: 0, why: `more than ${ENV_PASTE_MAX_VARS} variables in one paste (${extra.name} and the rest were left out)` })
  }
  return { vars, skipped, duplicates: [...new Set(duplicates)] }
}
