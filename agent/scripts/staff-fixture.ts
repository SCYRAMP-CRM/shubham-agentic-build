import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCP_SERVER_NAME } from '../agentic/briefs.ts'
import { fakeSpawner } from '../agentic/chats.fake.ts'
import { createChatPool } from '../agentic/chats.ts'
import { appCommand, STAFF_POLICY, STAFF_TOOL_NAMES, STAFF_TOOLS, staffAllowedTools, staffBrief, staffMcpConfig, staffSettings, staffUsageEnv } from '../agentic/staff-policy.ts'

// Order o7e6d (Lead, 15 Nov): a PURE fixture of a staff Assistant's launch, for Agent 14's offline V1/V2 harness. It reads no app state, session,
// key, credential or config and starts nothing: the chat pool's own start (chats.ts) is run with a pretend terminal and dummy inputs, so the argv
// and the environment are exactly what the pool builds for a staff chat; the brief, the settings and the MCP file are written by the very
// functions the hub uses (staff-policy.ts). The app's two commands and its MCP shim are replaced by small mocks written beside them (mock\), and
// no credential is given (the harness brings its own dummy). The staff tool definitions come from the candidate itself (tools.json), never typed.
//
//   node agent/scripts/staff-fixture.ts <out folder> "<candidate sha> agent/scripts/staff-fixture.ts"

export const FIXTURE_SESSION = '7e6d0000-0000-4000-8000-00000000f001'
/** A dummy person id in the CRM's form (a UUID), as STAFF_OWNER_RE requires. */
export const FIXTURE_PERSON = '7e6d0000-0000-4000-8000-0000000000f1'
export const FIXTURE_KEY = 'sad_fixture_dummy_key'
export const FIXTURE_URL = 'http://127.0.0.1:50999/agent-api/agentic/mcp'

/** The agent's own environment, as dummies: the basics, plus decoys the staff launch must drop (they are listed in `dropped`). */
const DUMMY_BASE: Record<string, string> = {
  SystemRoot: 'C:\\Windows',
  PATH: 'C:\\Windows\\system32;C:\\Windows',
  TEMP: 'C:\\fixture\\temp',
  SAD_STATUSLINE_CHAIN: 'ZWNobyBkZWNveQ==',
  SAD_PAGE_SERVER: 'decoy',
  CLAUDE_CODE_DECOY_SWITCH: '1',
  CLAUDECODE: '1',
  NODE_OPTIONS: '--decoy',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/decoy',
  GH_TOKEN: 'decoy',
}

export interface StaffFixture {
  fixture: true
  source: string
  policy: typeof STAFF_POLICY
  /** claude's argv for the staff launch (the executable not included). */
  args: string[]
  /** The environment the pool built, every value a dummy (the chat key is fixed here; the pool makes a random one per start). */
  env: Record<string, string>
  /** The dummy variables the pool was given that the staff launch dropped. */
  dropped: string[]
  cwd: string
  files: { brief: string; settings: string; mcp: string; tools: string; mocks: { shim: string; reportHook: string; statusLine: string } }
  tools: string[]
  allowedTools: string
}

const MOCK_SHIM = `// Mock of the app's MCP shim (o7e6d fixture): stdio JSON-RPC, the staff tools of tools.json, every call logged and answered "fixture".
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const here = new URL('.', import.meta.url)
const tools = JSON.parse(readFileSync(new URL('../tools.json', here), 'utf8'))
const log = new URL('../out/shim-calls.jsonl', here)
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
  let m
  try { m = JSON.parse(line) } catch { return }
  try { appendFileSync(log, JSON.stringify({ method: m.method, params: m.params ?? null }) + '\\n') } catch {}
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'shubham-agentic', version: 'fixture' } })
  if (m.method === 'tools/list') return reply(m.id, { tools })
  if (m.method === 'tools/call') return reply(m.id, { content: [{ type: 'text', text: 'fixture' }], isError: false })
  if (m.method === 'ping') return reply(m.id, {})
  if (m.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }) + '\\n')
})
`
const MOCK_REPORT = `// Mock of the prompt report hook (o7e6d fixture): its stdin (the hook JSON) is appended to out/reports.jsonl; nothing printed, exit 0, within 2 s.
import { appendFileSync } from 'node:fs'
setTimeout(() => process.exit(0), 2000).unref()
let s = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => { s += d })
process.stdin.on('end', () => { try { appendFileSync(new URL('../out/reports.jsonl', import.meta.url), JSON.stringify({ argv: process.argv.slice(2), stdin: s }) + '\\n') } catch {} process.exit(0) })
`
const MOCK_STATUS = `// Mock of the usage status line (o7e6d fixture): prints "fixture" and the person it would file under.
process.stdout.write('fixture ' + (process.env.SAD_USAGE_USER || '-') + '\\n')
`

/** Builds the fixture into `out` (made if missing) and returns it; also written as out\\fixture.json. */
export function buildStaffFixture(o: { out: string; source: string; node?: string }): StaffFixture {
  const out = path.resolve(o.out)
  if (!/^[A-Za-z]:\\/.test(out)) throw new Error(`The fixture folder must be an absolute drive path: ${out}`)
  const node = o.node ?? 'C:\\Program Files\\nodejs\\node.exe'
  const mockDir = path.join(out, 'mock')
  const room = path.join(out, 'room')
  for (const d of [out, mockDir, room, path.join(out, 'out'), path.join(out, 'usage')]) mkdirSync(d, { recursive: true })
  const files = {
    brief: path.join(out, 'brief.md'),
    settings: path.join(out, 'settings.json'),
    mcp: path.join(out, 'mcp.json'),
    tools: path.join(out, 'tools.json'),
    mocks: { shim: path.join(mockDir, 'shim.mjs'), reportHook: path.join(mockDir, 'report-hook.mjs'), statusLine: path.join(mockDir, 'statusline.mjs') },
  }
  writeFileSync(files.mocks.shim, MOCK_SHIM)
  writeFileSync(files.mocks.reportHook, MOCK_REPORT)
  writeFileSync(files.mocks.statusLine, MOCK_STATUS)
  writeFileSync(files.tools, `${JSON.stringify(STAFF_TOOLS, null, 2)}\n`)
  writeFileSync(files.brief, staffBrief({ agent: 'Assistant', person: 'Fixture Person', md: 'Answer briefly.', server: MCP_SERVER_NAME }))
  writeFileSync(files.settings, `${JSON.stringify(staffSettings({ reportCommand: appCommand(node, files.mocks.reportHook, '--report-only'), statusLineCommand: appCommand(node, files.mocks.statusLine) }), null, 2)}\n`)
  writeFileSync(files.mcp, `${JSON.stringify(staffMcpConfig(MCP_SERVER_NAME, node, files.mocks.shim), null, 2)}\n`)

  // The pool's own start, with a pretend terminal: nothing runs.
  const fake = fakeSpawner()
  const pool = createChatPool({
    toolsUrl: () => FIXTURE_URL,
    mcpConfig: path.join(out, 'unused-shared-mcp.json'),
    spawn: fake.spawn,
    claude: 'C:\\fixture\\claude.exe',
    env: { ...DUMMY_BASE },
    token: () => null,
    credential: () => null,
    settings: s => (s.policy === STAFF_POLICY ? files.settings : undefined),
    chatEnv: () => staffUsageEnv({ dir: path.join(out, 'usage'), launch: 'fixture0launch0001', person: FIXTURE_PERSON }),
    treeKill: () => {},
  })
  try {
    pool.start({ sessionId: FIXTURE_SESSION, floorId: 'fixture-floor', agentId: 'fixture-agent', cwd: room, briefPath: files.brief, mcpConfig: files.mcp, strictMcp: true, model: '', resume: false, policy: STAFF_POLICY })
  } finally {
    pool.closeAll()
  }
  const p = fake.last()
  const env = { ...p.env, SAD_AGENTIC_KEY: FIXTURE_KEY }
  const fixture: StaffFixture = {
    fixture: true,
    source: o.source,
    policy: STAFF_POLICY,
    args: p.args,
    env,
    dropped: Object.keys(DUMMY_BASE).filter(k => !(k in env)),
    cwd: p.cwd,
    files,
    tools: [...STAFF_TOOL_NAMES],
    allowedTools: staffAllowedTools(MCP_SERVER_NAME),
  }
  writeFileSync(path.join(out, 'fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`)
  return fixture
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const [out, source] = process.argv.slice(2)
  if (!out || !source) {
    console.error('usage: node agent/scripts/staff-fixture.ts <out folder> "<candidate sha> agent/scripts/staff-fixture.ts"')
    process.exit(2)
  }
  const f = buildStaffFixture({ out, source, node: process.execPath })
  console.log(`fixture written: ${path.join(path.resolve(out), 'fixture.json')} (${f.args.length} args, ${Object.keys(f.env).length} env, dropped ${f.dropped.join(', ')})`)
}
