/** The exact versions Codex in Claude Code is proved with. Any other version is refused at start-up
 * ("The target has not proved this execution capability"), so these are what each PC must have.
 * `codex` is the protocol the adapter speaks to ChatGPT (adapter.ts); `codexInstalled` is the Codex CLI the PC may have
 * (14 Nov 2026: 0.169.0 too, the same list as agent/codex/versions.ts; the bridge never runs that program). */
export const BRIDGE_REQUIREMENTS = Object.freeze({
  platform: 'win32',
  arch: 'x64',
  node: '24.22.1',
  claude: '2.1.319',
  codex: '0.163.0',
  codexInstalled: Object.freeze(['0.163.0', '0.169.0']) as readonly string[],
})
