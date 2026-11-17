import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from '../config.ts'

// F-018: the agents' chats run on this Windows account's own Claude config (~/.claude.json).
// Before a chat starts, two questions claude would otherwise ask in its terminal are answered
// in that file, the way claude itself records the answers:
//   - its first-run setup ("Choose the text style…"): on a PC where Claude is usually run
//     through Christopher, which keeps its own config, this one was never set up. As
//     agentic-claude-manager does for its folders (server/index.js scaffoldConfigDir), the flags
//     that say setup is done are topped up.
//   - "Do you trust this folder?" for the floor's folder, which the person picked for the floor
//     in the app: projects["C:/the/folder"].hasTrustDialogAccepted, as claude writes on "Yes".
//     (In claude 2.1 that menu starts on "No, exit", so answering it with Enter would quit.)
//   - the same question for every folder the chat is STARTED WITH (--add-dir: the app's uploads
//     folder). Claude 2.1.326 asks it too, as "Adding a new directory: ... Is this a directory you
//     created or one you trust?", a select that starts on "No, exit" and whose Esc ends the chat, and
//     it is the same record that answers it. permissions.additionalDirectories does NOT: that is
//     tool access, not trust (proved by effect, twice, 17 Nov 2026: Lead's restart of a chat, and a
//     scratch claude started with it set that still drew the prompt). The app recorded the consent
//     for the chat's own folder and, silently, not for the folders it passes (order of24b).
// Shubham explicitly chose bypass permissions for all existing and new chats. Record that
// native consent too, so a managed bypass launch opens without another startup question.
// Other preferences are only filled when absent; credentials and unrelated settings stay.
// The sign-in is not touched: it comes from CLAUDE_CODE_OAUTH_TOKEN (F-007).

export const claudeJsonPath = (home = os.homedir()) => path.join(home, '.claude.json')

/** claude's key for a folder in projects: the path with forward slashes. */
export const projectKey = (cwd: string) => cwd.replace(/\\/g, '/')

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Marks setup done, records the requested bypass consent and trusts `cwd` and every folder in `addDirs` (the ones the chat is started with --add-dir);
 * returns the changed preferences. The file is written only when something changed, and an unreadable one is left alone (claude asks in the terminal).
 */
export function prepareClaudeConfig(cwd: string, file = claudeJsonPath(), addDirs: readonly string[] = []): string[] {
  let data: Record<string, unknown> = {}
  if (existsSync(file)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // Unreadable: leave it to claude, whose own file it is; it asks in the terminal instead.
      return []
    }
    if (!isObject(parsed)) return []
    data = parsed
  }
  const changed: string[] = []
  if (data.bypassPermissionsModeAccepted !== true) {
    data.bypassPermissionsModeAccepted = true
    changed.push('bypass permissions consent')
  }
  if (data.hasCompletedOnboarding === undefined) {
    data.hasCompletedOnboarding = true
    changed.push('first-run setup')
  }
  // The chats are drawn on a dark code surface in every theme and mode.
  if (data.theme === undefined) {
    data.theme = 'dark'
    changed.push('theme')
  }
  const projects = isObject(data.projects) ? data.projects : {}
  for (const dir of [cwd, ...addDirs]) {
    if (!dir) continue
    const key = projectKey(dir)
    const project = isObject(projects[key]) ? projects[key] : {}
    if (project.hasTrustDialogAccepted !== true) {
      projects[key] = { ...project, hasTrustDialogAccepted: true }
      data.projects = projects
      changed.push(`trust for ${key}`)
    }
  }
  if (changed.length) writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
  return changed
}
