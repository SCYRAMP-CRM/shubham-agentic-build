import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// Order ofedf: a chat's --settings replaces the person's own status line for that chat, so the person's own command (if they had one)
// is run by the usage hook and its output printed (statusline.mjs, SAD_STATUSLINE_CHAIN). This reads only the command text from the
// person's Claude settings file. No credential is read, and nothing is written.

/** The configured status-line command of the Claude config folder, or null (none, unreadable, or our own hook). */
export function ownStatusLineCommand(configDir: string, ourHook: string): string | null {
  let j: unknown
  try {
    j = JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
  } catch {
    return null
  }
  const sl = (j as { statusLine?: { command?: unknown } } | null)?.statusLine
  const command = typeof sl?.command === 'string' ? sl.command.trim() : ''
  if (!command || command.includes(ourHook)) return null
  return command
}

/** The Claude config folder a chat reads its settings from: the CLAUDE_CONFIG_DIR given to the agent, else ~/.claude. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR : path.join(homedir(), '.claude')
}
