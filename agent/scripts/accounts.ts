// order o4857, o28a6: the Accounts setup and copy as a command. Run it from the app's own folder (the one with package.json), on the PC that holds the CRM sign-in (the Server):
//   node agent/scripts/accounts.ts help
// The logic and its tests are agent/agentic/accounts-cli.ts; this file only connects it to the terminal, the state folder and the real database package. Passwords are typed with no echo
// (never as an argument or an environment variable), and nothing here prints one. The prompts are agent/agentic/hidden-prompt.ts: a hidden answer closes the readline interface FIRST (a paused one still
// echoed every key, found 17 Nov 2026 with a throwaway string in a pseudo-terminal), and its test types a string at a fake terminal and checks it never comes back out.
import path from 'node:path'
import { createPrompter } from '../agentic/hidden-prompt.ts'
import { statePaths } from '../config.ts'
import { createAccountsEmail } from '../agentic/accounts-email.ts'
import { createAccountsImport } from '../agentic/accounts-import.ts'
import { createAccountsCodebases } from '../agentic/accounts-codebases.ts'
import { createCodebaseImport } from '../agentic/accounts-codebase-import.ts'
import { createAccountsPlatforms } from '../agentic/accounts-platforms.ts'
import { runCli, type AdminLogin, type Io } from '../agentic/accounts-cli.ts'
import { createCrmProxy } from '../agentic/crmproxy.ts'
import { crmUrlOf } from '../claude/crm.ts'

const paths = statePaths()
// F-339: the same address the app talks to; a CRM login made at any other address has ended here too.
const proxy = createCrmProxy({ file: paths.crmSession, crmUrl: crmUrlOf() })

const prompter = createPrompter({ input: process.stdin, output: process.stdout })
const io: Io = {
  say: line => console.log(line),
  ask: q => prompter.ask(q),
  askHidden: q => prompter.askHidden(q),
}

// The package is loaded only when it is used (it is the app's pinned postgres 3.4.8).
const PACKAGE = 'postgres'
const loadPackage = () => import(PACKAGE) as Promise<{ default: (o: Record<string, unknown>) => { begin<T>(fn: (tx: { unsafe(text: string): PromiseLike<unknown> }) => Promise<T>): Promise<T>; end(o?: { timeout?: number }): Promise<void> } }>

async function runSql(login: AdminLogin, text: string): Promise<void> {
  const postgres = (await loadPackage()).default
  const sql = postgres({ host: login.host, port: login.port, database: login.database, username: login.user, password: login.password, ssl: 'require', max: 1, connect_timeout: 15, prepare: false, onnotice: () => {} })
  try {
    // One transaction per file: it all happens or none of it does.
    await sql.begin(async tx => {
      await tx.unsafe(text)
    })
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}

try {
  const code = await runCli(process.argv.slice(2), {
    io,
    dir: paths.agent,
    sqlDir: path.resolve(import.meta.dirname, '..', '..', 'db', 'accounts'),
    runSql,
    importer: args => createAccountsImport({ proxy, dir: paths.agent }).run(args),
    // slice D (disable, never delete): the page hides disabled rows unless "Show disabled" asks; this counts-only script counts EVERYTHING in the new database (its "N disabled" would read 0 otherwise)
    lister: person => createAccountsEmail({ dir: paths.agent }).list(person, { disabled: true }),
    codebaseImporter: args => createCodebaseImport({ proxy, dir: paths.agent }).run(args),
    codebaseLister: person => createAccountsCodebases({ dir: paths.agent }).list(person),
    platformLister: person => createAccountsPlatforms({ dir: paths.agent }).list(person, { disabled: true }),
    crmSignedIn: () => proxy.session().signedIn,
    packageThere: () => loadPackage().then(() => true, () => false),
  })
  prompter.close()
  process.exit(code)
} catch (e) {
  prompter.close()
  // Only the message of OUR errors; never a stack (it could carry a host or a login).
  console.log(e instanceof Error ? e.message : 'Something went wrong.')
  process.exit(1)
}
