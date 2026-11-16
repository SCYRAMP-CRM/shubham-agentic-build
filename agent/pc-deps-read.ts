import path from 'node:path'
import { meetsRange, type DepRow, type DepState, type PcDepsReport } from '../shared/pc-deps.ts'
import { depFix, type FixContext, type FixOs } from './pc-deps-fixes.ts'
import type { SshFacts } from './pc-ssh-read.ts'
import { speechPaths } from './speech/paths.ts'

// Order oc7c9: what the app needs on this PC and what it has (shared/pc-deps.ts). READ ONLY: version questions (`--version`, `npm --version` run once
// to prove npm loads), file and folder checks, and on Windows WinFsp's version from its DLL and the voices from the registry. Nothing is
// installed, started or changed; the login files (Codex's auth.json, Claude's) are never opened. Each row that is not ok carries the command that
// would fix it on THIS PC (pc-deps-fixes.ts, the one table Agent 6's installer imports too), to run by hand with Shubham's yes.

export interface ExecOut {
  code: number
  stdout: string
  stderr: string
  /** The program is not there. */
  missing: boolean
}

export interface DepsReadDeps {
  platform: string
  arch: string
  /** process.versions.node and process.execPath. */
  node: { version: string; exec: string }
  /** The app's own folder (its package.json and node_modules). */
  appRoot: string
  /** %LOCALAPPDATA%\shubham-agentic (Whisper and its models live there). */
  stateRoot: string
  home: string
  exec(file: string, args: string[], timeoutMs: number): Promise<ExecOut>
  readFile(file: string): Promise<string>
  /** A file's bytes (WinFsp's DLL, for its version block). */
  readBytes(file: string): Promise<Buffer>
  exists(file: string): Promise<boolean>
  listDir(dir: string): Promise<string[]>
  /** `tailscale <args>` through the app's own runner. */
  tailscale(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>
  /** Claude Code's path and version (asked alongside the other checks). */
  claude(): Promise<{ path: string | null; version: string | null }>
  codex: { path: string; version: string | null } | null
  /** The app's Codex home (CODEX_HOME for its Codex chats). */
  codexHome: string
  /** What Codex in Claude Code needs exactly (codex-claude/requirements.ts), said in the notes. */
  bridge: { claude: string; codex: string }
  browsers: readonly { name: string; path: string }[]
  /** This PC's OpenSSH (pc-ssh-read.ts), or null when it could not be read. */
  ssh(): Promise<SshFacts | null>
  /** The Whisper model the app uses (SAD_WHISPER_MODEL, else small). */
  whisperModel: string
}

const WINFSP_DLL = 'C:\\Program Files (x86)\\WinFsp\\bin\\winfsp-x64.dll'
const VOICES_WANTED = ['en-IN', 'hi-IN'] as const
const version = (s: string) => /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/.exec(s)?.[1] ?? null
const firstLine = (s: string) => s.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? ''

/** A Windows program's or DLL's file version, from its VS_FIXEDFILEINFO block (signature 0xFEEF04BD): "2.1.25156.0"; null when it has none. */
export function peFileVersion(buf: Buffer): string | null {
  const at = buf.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]))
  if (at < 0 || at + 16 > buf.length) return null
  const ms = buf.readUInt32LE(at + 8)
  const ls = buf.readUInt32LE(at + 12)
  return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`
}

// Windows' language ids (hex, as the voices' registry entries hold them) for the ones that matter here.
const LCIDS: Readonly<Record<string, string>> = { '409': 'en-US', '809': 'en-GB', '4009': 'en-IN', '439': 'hi-IN', '44e': 'mr-IN', 'c09': 'en-AU', '1009': 'en-CA' }

/** `reg query …\Speech_OneCore\Voices\Tokens /s /v Language` → the voices' languages ("en-US", "hi-IN", or "lcid 0x…" for others). */
export function voicesFromReg(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^\s*Language\s+REG_SZ\s+([0-9a-fA-F;]+)\s*$/gm)) for (const id of m[1].split(';')) if (id) out.push(LCIDS[id.toLowerCase()] ?? `lcid 0x${id.toLowerCase()}`)
  return out
}

/** The line of an error worth showing: the one that names the problem, never a stack frame. */
export function errorLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^at\s/.test(l) && !/^\^+$/.test(l) && !/^node:internal/.test(l))
  const named = lines.find(l => /Error|error|Cannot|cannot|not found|ENOENT|EACCES/.test(l))
  return (named ?? lines[0] ?? '').slice(0, 300) || null
}

type RowIn = Omit<DepRow, 'note' | 'fix' | 'fixRights' | 'where' | 'installed'> & { installed?: string | null; where?: string | null; note?: string | null; fixId?: string | null }

/** Everything on this PC, in the tab's order. Never throws: what cannot be read is "unknown", said in a note. */
export async function readDeps(d: DepsReadDeps): Promise<Pick<PcDepsReport, 'os' | 'appRoot' | 'rows'>> {
  const windows = d.platform === 'win32'
  const linux = d.platform === 'linux'
  const os: PcDepsReport['os'] = windows ? 'windows' : linux ? 'linux' : d.platform === 'darwin' ? 'mac' : 'other'
  const fixOs: FixOs | null = windows ? 'windows' : linux ? 'linux' : null
  const P = windows ? path.win32 : path.posix
  const rows: DepRow[] = []
  const pkg = await d.readFile(P.join(d.appRoot, 'package.json')).then(t => JSON.parse(t) as { engines?: { node?: string }; dependencies?: Record<string, string> }, () => null)
  const nodePrefix = windows ? P.dirname(d.node.exec) : P.dirname(P.dirname(d.node.exec))
  const ctx: FixContext = {
    nodeVersion: d.node.version,
    nodePrefix,
    nodeInHome: nodePrefix.startsWith(d.home),
    arch: d.arch === 'arm64' ? 'arm64' : 'x64',
    appRoot: d.appRoot,
    hasLock: await d.exists(P.join(d.appRoot, 'package-lock.json')),
    stateRoot: d.stateRoot,
    whisperModel: d.whisperModel,
    voices: [],
    codexVersion: d.bridge.codex,
  }
  const row = (r: RowIn, c: FixContext = ctx): DepRow => {
    const { fixId, ...rest } = r
    const fix = fixId && fixOs ? depFix(fixId, fixOs, c) : null
    return { installed: null, where: null, note: null, ...rest, fix: fix?.command ?? null, fixRights: fix?.rights ?? null }
  }

  // Every question that does not depend on another starts now, at once (a PC answers in a few seconds, not one after the other).
  const npmCli = windows ? P.join(nodePrefix, 'node_modules', 'npm', 'bin', 'npm-cli.js') : P.join(nodePrefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const npmP = d.exists(npmCli).then(async there => (there ? d.exec(d.node.exec, [npmCli, '--version'], 30_000) : null))
  const claudeP = d.claude().catch(() => ({ path: null, version: null }))
  const gitP = d.exec('git', ['--version'], 8000)
  const pyP = windows ? d.exec('py', ['-3', '--version'], 8000).then(async r => (r.code === 0 ? r : d.exec('python', ['--version'], 8000))) : d.exec('python3', ['--version'], 8000)
  const tsP = d.tailscale(['version']).then(async ts => {
    const v = ts.code === 0 ? version(firstLine(ts.stdout)) : null
    const state = v ? await d.tailscale(['status', '--json']).then(r => { try { return String((JSON.parse(r.stdout) as { BackendState?: unknown }).BackendState ?? '') } catch { return '' } }, () => '') : ''
    return { v, state }
  }, () => ({ v: null as string | null, state: '' }))
  const sshClientP = d.exec('ssh', ['-V'], 8000)
  const sshdP = d.ssh().catch(() => null)
  // Windows: WinFsp's version from the DLL's own version block, and the voices from the registry (PowerShell took 4-9 s here, these a few ms).
  const winfspP = windows ? d.readBytes(WINFSP_DLL).then(peFileVersion, () => null) : null
  const voicesP = windows ? d.exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices\\Tokens', '/s', '/v', 'Language'], 8000).then(r => (r.code === 0 || /Language/.test(r.stdout) ? voicesFromReg(r.stdout) : null)) : null
  const linuxP = linux
    ? Promise.all([
        d.exec('gio', ['version'], 8000),
        Promise.all(['/usr/libexec/gvfsd-dav', '/usr/lib/gvfs/gvfsd-dav'].map(async f => ((await d.exists(f)) ? f : null))).then(a => a.find(Boolean) ?? null),
        Promise.all(['/usr/libexec/gvfsd-fuse', '/usr/lib/gvfs/gvfsd-fuse'].map(async f => ((await d.exists(f)) ? f : null))).then(a => a.find(Boolean) ?? null),
        d.exec('fusermount3', ['--version'], 8000),
      ])
    : null

  // ---- Node.js and npm ----
  const needNode = pkg?.engines?.node ?? '>=22.22'
  const nodeOk = meetsRange(d.node.version, needNode)
  rows.push(row({
    id: 'node', group: 'core', name: 'Node.js', required: needNode, installed: d.node.version, where: d.node.exec, state: nodeOk ? 'ok' : 'outdated',
    note: nodeOk ? 'The app’s agent runs on it.' : `Install Node.js ${needNode.replace(/^>=\s*/, '')} or newer${windows ? '' : ` into ${nodePrefix}, the way it is installed now`}.`,
    fixId: nodeOk ? null : 'node',
  }))
  let npmWorks = false
  const npmRun = await npmP
  if (!npmRun) {
    rows.push(row({ id: 'npm', group: 'core', name: 'npm', required: 'works', state: 'missing', note: `npm is not next to this Node.js (${npmCli}).`, fixId: 'npm' }))
  } else {
    const r = npmRun
    npmWorks = r.code === 0 && !!version(r.stdout)
    rows.push(row({
      id: 'npm', group: 'core', name: 'npm', required: 'works (run once here)', installed: version(r.stdout), where: npmCli, state: npmWorks ? 'ok' : 'broken',
      note: npmWorks ? 'It installs the app’s packages at every Update.' : `npm --version failed: ${errorLine(r.stderr + '\n' + r.stdout) ?? `exit ${r.code}`}. Updates cannot install the app’s packages until it is fixed.`,
      fixId: npmWorks ? null : 'npm',
    }))
  }

  // ---- The app's packages (its own package.json: on an installed build, only what the agent needs at run time) ----
  const wanted = Object.entries(pkg?.dependencies ?? {})
  const pkgRows: DepRow[] = []
  for (const [name, range] of wanted) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) continue
    const dir = P.join(d.appRoot, 'node_modules', ...name.split('/'))
    const have = await d.readFile(P.join(dir, 'package.json')).then(t => String((JSON.parse(t) as { version?: unknown }).version ?? ''), () => null)
    const state: DepState = !have ? 'missing' : meetsRange(have, range) ? 'ok' : 'outdated'
    if (state !== 'ok') pkgRows.push(row({ id: `pkg:${name}`, group: 'packages', name: `${name} (app package)`, required: range, installed: have, where: have ? dir : null, state, note: npmWorks ? null : 'Fix npm first (above): this is installed by npm.', fixId: 'packages' }))
  }
  if (!pkg) {
    rows.push(row({ id: 'packages', group: 'packages', name: 'The app’s packages', required: 'package.json', where: d.appRoot, state: 'unknown', note: 'The app’s package.json could not be read here.' }))
  } else {
    const missing = pkgRows.filter(r => r.state === 'missing').length
    rows.push(row({
      id: 'packages', group: 'packages', name: 'The app’s packages', required: `${wanted.length} in package.json`, installed: `${wanted.length - pkgRows.length} of ${wanted.length} in place`, where: P.join(d.appRoot, 'node_modules'),
      state: missing ? 'missing' : pkgRows.length ? 'outdated' : 'ok',
      note: pkgRows.length ? `Not in place: ${pkgRows.map(r => r.name.replace(' (app package)', '')).join(', ')}.` : null,
      fixId: pkgRows.length ? 'packages' : null,
    }), ...pkgRows)
  }

  // ---- Chats: Claude Code and Codex ----
  const claude = await claudeP
  rows.push(row({
    id: 'claude', group: 'chats', name: 'Claude Code', required: `any (Codex in Claude Code: exactly ${d.bridge.claude})`, installed: claude.version, where: claude.path,
    state: !claude.path ? 'missing' : claude.version ? 'ok' : 'broken',
    note: !claude.path ? 'The agents’ chats run in it.' : claude.version ? null : 'Found, but `claude --version` did not answer.',
    fixId: claude.path && claude.version ? null : 'claude',
  }))
  rows.push(row({
    id: 'codex', group: 'chats', name: 'Codex CLI', required: `any (Codex in Claude Code: exactly ${d.bridge.codex})`, installed: d.codex?.version ?? null, where: d.codex?.path ?? null,
    state: !d.codex ? 'missing' : d.codex.version ? 'ok' : 'broken',
    note: !d.codex ? 'Agents whose engine is Codex run in it.' : d.codex.version ? null : 'Found, but `codex --version` did not answer.',
    fixId: d.codex?.version ? null : 'codex',
  }))
  const homeThere = await d.exists(d.codexHome)
  const configThere = homeThere && (await d.exists(P.join(d.codexHome, 'config.toml')))
  rows.push(row({
    id: 'codex-home', group: 'chats', name: 'CODEX_HOME (the app’s Codex folder)', required: 'made by the app', installed: configThere ? 'config.toml in place' : homeThere ? 'folder only' : null, where: d.codexHome,
    state: configThere ? 'ok' : 'missing',
    note: configThere ? 'Its login comes from the CRM; it is never opened here.' : 'The app makes it the first time a Codex chat starts on this PC (Codex runs with CODEX_HOME set to it). No command needed.',
  }))

  // ---- Tools ----
  const git = await gitP
  rows.push(row({
    id: 'git', group: 'tools', name: 'git', required: 'any', installed: git.code === 0 ? version(git.stdout) : null, where: git.code === 0 ? 'on PATH' : null,
    state: git.missing ? 'missing' : git.code === 0 ? 'ok' : 'broken', note: 'Updates and code agents use it.', fixId: git.code === 0 ? null : 'git',
  }))
  const py = await pyP
  const pyVersion = /^Python (\d+\.\d+\.\d+)/.exec((py.stdout + py.stderr).trim())?.[1] ?? null
  const pyOk = !!pyVersion && meetsRange(pyVersion, '>=3.10')
  rows.push(row({
    id: 'python', group: 'tools', name: 'Python', required: '>=3.10', installed: pyVersion, where: pyVersion ? 'on PATH' : null,
    state: !pyVersion ? 'missing' : pyOk ? 'ok' : 'outdated', note: 'Only for MCP servers that run with uvx, and helper scripts.', fixId: pyOk ? null : 'python',
  }))
  const { v: tsVersion, state: tsState } = await tsP
  rows.push(row({
    id: 'tailscale', group: 'tools', name: 'Tailscale', required: 'installed and signed in', installed: tsVersion, where: tsVersion ? 'tailscale' : null,
    state: !tsVersion ? 'missing' : tsState === 'Running' ? 'ok' : 'broken',
    note: tsVersion && tsState !== 'Running' ? `Installed but not connected (${tsState || 'state unknown'}): sign in with \`tailscale up\` yourself (it opens a login link; never automatic).` : 'The PCs reach each other and the phone over it.',
    fixId: !tsVersion ? 'tailscale' : tsState === 'Running' ? null : 'tailscale-up',
  }))
  const sshClient = await sshClientP
  const sshClientVersion = /OpenSSH[_\w]*?_(\d+\.\d+(?:p\d+)?)/.exec(sshClient.stderr + sshClient.stdout)?.[1] ?? null
  rows.push(row({
    id: 'ssh-client', group: 'tools', name: 'OpenSSH client', required: 'any', installed: sshClientVersion, where: sshClientVersion ? 'on PATH' : null,
    state: sshClientVersion ? 'ok' : 'missing', note: 'The SSH tab’s terminal uses it.', fixId: sshClientVersion ? null : 'ssh-client',
  }))
  const sshd = (await sshdP)?.openssh ?? null
  const sshState: DepState = !sshd || sshd.installed === null ? 'unknown' : !sshd.installed ? 'missing' : sshd.running === 'stopped' ? 'broken' : 'ok'
  rows.push(row({
    id: 'ssh-server', group: 'tools', name: 'OpenSSH server', required: 'installed and running (keys only)', installed: sshd?.installed ? (sshd.running === 'stopped' ? 'stopped' : 'running') : null,
    where: sshd?.installed ? (windows ? 'sshd service' : 'ssh service') : null, state: sshState,
    note: sshState === 'unknown' ? 'Whether it is installed could not be read.' : 'Logging in to this PC from the others (the SSH tab shows its settings).',
    fixId: sshState === 'missing' ? 'ssh-server' : sshState === 'broken' ? 'ssh-server-start' : null,
  }))
  let browser: { name: string; path: string; version: string | null } | null = null
  for (const b of d.browsers) {
    if (!(await d.exists(b.path))) continue
    let bv: string | null = null
    if (windows) {
      // Chrome and Edge keep each version in a folder named after it beside the program: the highest is the one in use.
      const names = await d.listDir(P.dirname(b.path)).catch(() => [] as string[])
      bv = names.filter(n => /^\d+\.\d+\.\d+\.\d+$/.test(n)).sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0] ?? null
    } else {
      bv = version((await d.exec(b.path, ['--version'], 8000)).stdout)
    }
    browser = { ...b, version: bv }
    break
  }
  rows.push(row({
    id: 'browser', group: 'tools', name: browser ? browser.name : 'Chrome or Edge', required: 'Chrome or Edge', installed: browser?.version ?? (browser ? 'installed' : null), where: browser?.path ?? null,
    state: browser ? 'ok' : 'missing', note: 'The Browser page and WhatsApp use it.', fixId: browser ? null : 'browser',
  }))

  // ---- The CRM drive, and (Windows) the voice ----
  const win: { winfsp: string | null; voices: string[] | null } = { winfsp: (await winfspP) ?? null, voices: (await voicesP) ?? null }
  if (windows) {
    const dll = await d.exists(WINFSP_DLL)
    const old = !!win.winfsp && !meetsRange(win.winfsp, '>=2.1')
    rows.push(row({
      id: 'winfsp', group: 'drive', name: 'WinFsp', required: '>=2.1', installed: win.winfsp ?? (dll ? 'installed' : null), where: dll ? WINFSP_DLL : null,
      state: !dll ? 'missing' : old ? 'outdated' : 'ok', note: 'The CRM files drive (Y:) runs on it.', fixId: !dll || old ? 'winfsp' : null,
    }))
  } else if (linux) {
    const [gio, dav, fuse, fusermount] = (await linuxP)!
    rows.push(row({ id: 'gio', group: 'drive', name: 'gio (GLib)', required: 'any', installed: gio.code === 0 ? version(gio.stdout) : null, where: gio.code === 0 ? 'on PATH' : null, state: gio.code === 0 ? 'ok' : 'missing', note: 'Mounts the CRM files (gio mount).', fixId: gio.code === 0 ? null : 'linux-drive' }))
    rows.push(row({ id: 'gvfs-dav', group: 'drive', name: 'gvfs WebDAV backend', required: 'installed', installed: dav ? 'installed' : null, where: dav, state: dav ? 'ok' : 'missing', note: 'Reads and writes the CRM files over the app’s own WebDAV.', fixId: dav ? null : 'linux-drive' }))
    rows.push(row({ id: 'gvfs-fuse', group: 'drive', name: 'gvfs FUSE', required: 'installed', installed: fuse ? 'installed' : null, where: fuse, state: fuse ? 'ok' : 'missing', note: 'Shows the mounted files as a folder (under /run/user).', fixId: fuse ? null : 'linux-drive' }))
    rows.push(row({ id: 'fuse3', group: 'drive', name: 'FUSE 3', required: 'any', installed: fusermount.code === 0 ? version(fusermount.stdout + fusermount.stderr) : null, where: fusermount.code === 0 ? 'fusermount3' : null, state: fusermount.code === 0 ? 'ok' : 'missing', fixId: fusermount.code === 0 ? null : 'linux-drive' }))
  }

  if (windows) {
    // F-251: the very places speech/engine.ts runs them from and the installer puts them (speech/paths.ts).
    const { exe: whisper, model } = speechPaths(d.whisperModel, d.stateRoot, d.platform)
    const hasWhisper = await d.exists(whisper)
    const hasModel = await d.exists(model)
    rows.push(row({
      id: 'whisper', group: 'voice', name: 'Whisper (speech to text)', required: 'whisper.cpp server', installed: hasWhisper ? 'installed' : null, where: hasWhisper ? whisper : null, state: hasWhisper ? 'ok' : 'missing',
      note: 'Without it the mic uses the phone’s own recogniser.', fixId: hasWhisper ? null : 'whisper',
    }))
    rows.push(row({
      id: 'whisper-model', group: 'voice', name: `Whisper model ggml-${d.whisperModel}.bin`, required: `ggml-${d.whisperModel}.bin`, installed: hasModel ? 'in place' : null, where: hasModel ? model : null, state: hasModel ? 'ok' : 'missing',
      fixId: hasModel ? null : 'whisper-model',
    }))
    const have = win.voices
    const lacking = have ? VOICES_WANTED.filter(l => !have.some(v => v.toLowerCase() === l.toLowerCase())) : null
    rows.push(row({
      id: 'voices', group: 'voice', name: 'Windows voice packs', required: VOICES_WANTED.join(' and '), installed: have ? [...new Set(have)].join(', ') || 'none' : null, where: have ? 'Windows speech (OneCore)' : null,
      state: !have ? 'unknown' : lacking!.length ? 'missing' : 'ok',
      note: !have ? 'Windows did not say which voices it has.' : lacking!.length ? `Missing: ${lacking!.join(', ')}. The app speaks English with en-IN and Hindi and Marathi with hi-IN, else the default voice. Or: Settings › Time & language › Speech › Add voices.` : null,
      fixId: lacking?.length ? 'voices' : null,
    }, { ...ctx, voices: lacking ?? [] }))
  }
  return { os, appRoot: d.appRoot, rows }
}
