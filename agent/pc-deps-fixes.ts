// Order oc7c9: the ONE table of fix commands for the Dependencies tab's rows (pc-deps-read.ts shows them; Agent 6's installer for order o20e2 imports
// this table instead of keeping its own copy). Each is a command to run BY HAND with Shubham's yes: this file never runs anything. `rights` says what it
// needs: 'admin' (an administrator PowerShell, a UAC prompt), 'sudo' (typed by the person on that PC), 'none' (the person's own account), or
// 'person' (something only the person can do, e.g. a sign-in: never automatic).

export type FixOs = 'windows' | 'linux'
export type FixRights = 'admin' | 'sudo' | 'none' | 'person'

/** What a command needs to know about the PC it is for. */
export interface FixContext {
  /** process.versions.node */
  nodeVersion: string
  /** Where Node.js lives: Windows its folder; Linux the prefix (e.g. ~/.local/node). */
  nodePrefix: string
  /** Linux: Node.js lives in the person's own folder (a tarball), not the system's (apt). */
  nodeInHome: boolean
  arch: 'x64' | 'arm64'
  /** The app's own folder. */
  appRoot: string
  /** It has a package-lock.json (then `npm ci`). */
  hasLock: boolean
  /** %LOCALAPPDATA%\shubham-agentic */
  stateRoot: string
  whisperModel: string
  /** The voices that are missing (BCP-47, e.g. hi-IN). */
  voices: readonly string[]
  /** The Codex version Codex in Claude Code needs. */
  codexVersion: string
}

export interface FixSpec {
  command: (c: FixContext) => string
  rights: FixRights
}

const fixed = (command: string, rights: FixRights): FixSpec => ({ command: () => command, rights })
/** PowerShell's literal string: nothing in it is expanded, and a ' is written twice. */
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
/** F-251: the app's own Whisper installer for THIS PC (agent/scripts/fetch-whisper.ts), from the app's own folder. */
const whisperFix = (c: FixContext, part: 'program' | 'model') =>
  `& node ${psQuote(`${c.appRoot.replace(/[\\/]+$/, '')}\\agent\\scripts\\fetch-whisper.ts`)} --part ${part} --model ${psQuote(c.whisperModel)}`

/** Row id → its fix on each system. A row with no entry for a system has no command there (it is ok or not used there). */
export const DEP_FIXES: Readonly<Record<string, Partial<Record<FixOs, FixSpec>>>> = {
  node: {
    windows: fixed('winget install --id OpenJS.NodeJS.LTS -e', 'admin'),
  },
  npm: {
    windows: {
      command: c => `$v='${c.nodeVersion}'; Invoke-WebRequest "https://nodejs.org/dist/v$v/node-v$v-x64.msi" -OutFile "$env:TEMP\\node-v$v-x64.msi"; Start-Process msiexec -ArgumentList '/i', "$env:TEMP\\node-v$v-x64.msi" -Wait`,
      rights: 'admin',
    },
    linux: {
      command: c =>
        c.nodeInHome
          ? `cd /tmp && curl -fsSLO https://nodejs.org/dist/v${c.nodeVersion}/node-v${c.nodeVersion}-linux-${c.arch}.tar.xz && tar -xJf node-v${c.nodeVersion}-linux-${c.arch}.tar.xz && rm -rf "${c.nodePrefix}/lib/node_modules/npm" && cp -r node-v${c.nodeVersion}-linux-${c.arch}/lib/node_modules/npm "${c.nodePrefix}/lib/node_modules/" && npm --version`
          : 'sudo apt install --reinstall nodejs npm',
      rights: 'none',
    },
  },
  packages: {
    windows: { command: c => `cd "${c.appRoot}"; npm ${c.hasLock ? 'ci' : 'install'} --omit=dev`, rights: 'none' },
    linux: { command: c => `cd "${c.appRoot}" && npm ${c.hasLock ? 'ci' : 'install'} --omit=dev`, rights: 'none' },
  },
  claude: {
    windows: fixed('irm https://claude.ai/install.ps1 | iex', 'none'),
    linux: fixed('curl -fsSL https://claude.ai/install.sh | bash', 'none'),
  },
  codex: {
    windows: { command: c => `npm install -g @openai/codex@${c.codexVersion}`, rights: 'none' },
    linux: { command: c => `npm install -g @openai/codex@${c.codexVersion}`, rights: 'none' },
  },
  git: {
    windows: fixed('winget install --id Git.Git -e', 'admin'),
    linux: fixed('sudo apt install git', 'sudo'),
  },
  python: {
    windows: fixed('winget install --id Python.Python.3.12 -e', 'none'),
    linux: fixed('sudo apt install python3', 'sudo'),
  },
  tailscale: {
    windows: fixed('winget install --id Tailscale.Tailscale -e', 'admin'),
    linux: fixed('curl -fsSL https://tailscale.com/install.sh | sh', 'sudo'),
  },
  /** Installed but not connected: a sign-in the person does (it opens a login link). Never automatic. */
  'tailscale-up': {
    windows: fixed('tailscale up', 'person'),
    linux: fixed('tailscale up', 'person'),
  },
  'ssh-client': {
    windows: fixed('Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0', 'admin'),
    linux: fixed('sudo apt install openssh-client', 'sudo'),
  },
  'ssh-server': {
    windows: fixed('Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd', 'admin'),
    linux: fixed('sudo apt install openssh-server && sudo systemctl enable --now ssh', 'sudo'),
  },
  /** OpenSSH is installed but stopped. */
  'ssh-server-start': {
    windows: fixed('Set-Service sshd -StartupType Automatic; Start-Service sshd', 'admin'),
    linux: fixed('sudo systemctl enable --now ssh', 'sudo'),
  },
  browser: {
    windows: fixed('winget install --id Google.Chrome -e', 'admin'),
    linux: fixed('cd /tmp && curl -fsSLO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install ./google-chrome-stable_current_amd64.deb', 'sudo'),
  },
  winfsp: {
    windows: fixed('winget install --id WinFsp.WinFsp -e', 'admin'),
  },
  /** The Linux drive's pieces: gio, the gvfs WebDAV and FUSE backends, FUSE 3. */
  'linux-drive': {
    linux: fixed('sudo apt install libglib2.0-bin gvfs-backends gvfs-fuse fuse3', 'sudo'),
  },
  // F-251: Whisper as a dependency. The pinned whisper.cpp b5454 program and the small model (whisper-install/manifest.ts), each checked by
  // SHA-256 and added only where missing; what is there is kept. Was a `latest` download unchecked (that release now has no binaries).
  // Windows only for now: Linux (the Z800) waits for its own approval.
  whisper: { windows: { command: c => whisperFix(c, 'program'), rights: 'none' } },
  'whisper-model': { windows: { command: c => whisperFix(c, 'model'), rights: 'none' } },
  voices: {
    windows: { command: c => c.voices.map(l => `Add-WindowsCapability -Online -Name Language.TextToSpeech~~~${l}~0.0.1.0`).join('; '), rights: 'admin' },
  },
}

/** The fix for one row on one system, with what it needs; null when the table has none. */
export function depFix(id: string, os: FixOs, c: FixContext): { command: string; rights: FixRights } | null {
  const spec = DEP_FIXES[id]?.[os]
  return spec ? { command: spec.command(c), rights: spec.rights } : null
}
