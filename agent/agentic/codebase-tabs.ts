import { apiError } from '../api.ts'
import { checkDescription, checkLink, checkSubsetName, checkVarName, checkVarValue, mayShowName, mayShowValue, isSection, type Checked, type TabSection, type TabsAnswer, type TabsVar } from '../../shared/codebase-tabs.ts'
import { ENV_PASTE_MAX_VARS } from '../../shared/env-paste.ts'
import { decryptPassword, encryptPassword } from './accounts-crypto.ts'
import { openAccountsDb, readAccountsDb, readAccountsKey, reasonOf, WORDS, type AccountsSql, type Row, type Tx } from './accounts-db.ts'

// Order ocf00 (version 2): the Codebases modal's tabs, kept in the NEW Supabase project (schema sad, db/accounts/0006_codebase_tabs.sql). Only the owner
// (the person the agent says is asking) reads or changes them: row-level security decides, the same as the other Accounts tables.
// SLICE D, DISABLE NEVER DELETE: there is no delete anywhere on this page, in the page, the routes or the statements (the app's login has no delete right either). A link, a set and a variable are DISABLED: that sets
// deleted_at (an UPDATE; the column keeps the name it was made with, and it is the one marker: it means "disabled"), every read leaves those rows out unless the page asks for them ("Show disabled"), and ENABLE clears it.
// A disabled name does not count as taken, and adding a name again brings its disabled row back with the new value (no second row). A disabled SET hides its variables WITHOUT touching them (no cascade). A row an older
// version soft-deleted is a disabled row too, with nothing converted: it shows up under "Show disabled" and Enable brings it back.
// The rules: a variable's VALUE is stored only encrypted (the Accounts key file, the same code as the mailbox passwords); a value is given back with the list
// ONLY when the allowlist says it is safe to show (shared/codebase-tabs.ts: mayShowName / mayShowValue: FAIL CLOSED); every other value comes back only by an
// explicit reveal. Nothing is logged but a reason and a code, and no error text names a value. The .env of the CRM is never read here.

export interface CodebaseTabsOptions {
  dir: string
  open?: typeof openAccountsDb
  log?: { warn(message: string): void; info?(message: string): void }
  /** Order o6f00: this PC's name as the app shows it (Server, Shubham ...), read at each request. Only a name is ever given to the page. */
  pcName?: () => string
}

const PERSON = /^[A-Za-z0-9._:@-]{1,80}$/
const KEY_MISSING = 'The key file for the Accounts passwords is not on this PC, so environment variables cannot be saved or read. Nothing was changed.'
const NO_CODEBASE = 'That codebase is not on the list.'
const NO_ROW = 'That row is not there any more.'
const NOT_DISABLED = 'That row is not disabled (it may have been enabled already).'
const NAME_TAKEN = 'A variable with that name is already in this subset.'
const SET_NAME_TAKEN = 'A live set has that name: rename or disable it first.'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** A timestamp as ISO text (the driver gives a Date; a fake store may give text). */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v))
const uuid = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

export function createCodebaseTabs(o: CodebaseTabsOptions) {
  const open = o.open ?? openAccountsDb

  /** One transaction for `person`: the database's own rules then decide what they may see or change. Errors that are ours (status) pass through. */
  async function run<T>(person: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const read = readAccountsDb(o.dir)
    if (!read.ok) throw apiError(503, WORDS['not-set-up'])
    if (!PERSON.test(person)) throw apiError(400, 'The person asking is not a valid id.')
    let sql: AccountsSql | null = null
    try {
      sql = await open(read)
      return await sql.begin(async tx => {
        await tx`select set_config('app.person_id', ${person}, true)`
        return fn(tx)
      })
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'status' in e) throw e
      const { reason, code } = reasonOf(e)
      o.log?.warn(`accounts db (codebase tabs): ${reason} (${code})`)
      throw apiError(503, WORDS[reason])
    } finally {
      await sql?.end({ timeout: 2 }).catch(() => {})
    }
  }

  /** This PC's name for the page (a short plain name: no path, no address); null when none is given or it is not a usable name. */
  function pcLabel(): string | null {
    let name: unknown
    try {
      name = o.pcName?.()
    } catch {
      return null
    }
    const t = typeof name === 'string' ? name.trim() : ''
    return t && t.length <= 80 && !/[\\/:]/.test(t) ? t : null
  }

  /** The key, or a plain refusal (values cannot be saved or read without it). */
  function keyOrRefuse(): Buffer {
    const k = readAccountsKey(o.dir)
    if (!k.ok) throw apiError(503, KEY_MISSING)
    return k.key
  }

  function need<T>(c: Checked<T>): T {
    if (!c.ok) throw apiError(400, c.message)
    return c.value
  }

  /** Order o26c8: a link's account, from the request: `id` (a platform account's id, or null to clear it) and `sent` (whether the form sent the field at all). */
function accountChoice(r: Record<string, unknown>): { id: string | null; sent: boolean } {
  if (!('accountId' in r)) return { id: null, sent: false }
  if (r.accountId === null || r.accountId === '' || r.accountId === undefined) return { id: null, sent: true }
  const id = uuid(r.accountId)
  if (!id) throw apiError(400, 'That account id is not valid.')
  return { id, sent: true }
}

/** The account must be the owner's own, live platform account (the row-level rule of 0004 limits what can be seen). */
async function ownedLiveAccount(tx: Tx, id: string): Promise<void> {
  const rows: Row[] = await tx`select id from sad.account_platform where id = ${id} and deleted_at is null`
  if (rows.length === 0) throw apiError(400, 'That account is not there any more. Choose it again.')
}

async function codebaseOr404(tx: Tx, cb: string) {
    const rows: Row[] = await tx`select id from sad.account_codebase where id = ${cb}`
    if (rows.length === 0) throw apiError(404, NO_CODEBASE)
  }

  return {
    /**
     * Everything in the tabs of one codebase that is not disabled: the sections' descriptions, the links, the subsets and their variables (values only where they are not secret). With `disabled` (the page's "Show
     * disabled") the disabled links, sets and variables come back too, each marked `disabled` with the time; a disabled variable carries NO value (it stays sealed) and a disabled set lists NO variables.
     */
    async read(person: string, codebaseId: string, opts: { disabled?: boolean } = {}): Promise<TabsAnswer> {
      const cb = uuid(codebaseId)
      if (!cb) throw apiError(400, 'That codebase id is not valid.')
      const withDisabled = opts.disabled === true
      const key = readAccountsKey(o.dir)
      return run(person, async tx => {
        await codebaseOr404(tx, cb)
        const secs: Row[] = await tx`select section, description from sad.account_codebase_section where codebase_id = ${cb} and deleted_at is null`
        const links: Row[] = withDisabled
          ? await tx`select id, section, label, url, description, deleted_at from sad.account_codebase_link where codebase_id = ${cb} order by sort_order, created_at`
          : await tx`select id, section, label, url, description, deleted_at from sad.account_codebase_link where codebase_id = ${cb} and deleted_at is null order by sort_order, created_at`
        // Order o26c8: a link's account (platform_id, from migration 0013). Read only when that column is there: until 0013 is run the links show without accounts (no error).
        const hasAccount: Row[] = await tx`select column_name from information_schema.columns where table_schema = 'sad' and table_name = 'account_codebase_link' and column_name = 'platform_id'`
        const accountOf = new Map<string, { pid: string; platform: string; name: string | null; email: string | null }>()
        if (hasAccount.length > 0) {
          // every link of the codebase, disabled or not: the map is keyed by link id and only the links listed above are looked up
          const acc: Row[] = await tx`select l.id, l.platform_id, p.platform, p.name, p.sign_in_email from sad.account_codebase_link l join sad.account_platform p on p.id = l.platform_id where l.codebase_id = ${cb} and p.deleted_at is null`
          for (const a of acc) accountOf.set(str(a.id), { pid: str(a.platform_id), platform: str(a.platform), name: a.name == null ? null : str(a.name), email: a.sign_in_email == null ? null : str(a.sign_in_email) })
        }
        const subs: Row[] = withDisabled
          ? await tx`select id, name, deleted_at from sad.account_env_subset where codebase_id = ${cb} order by sort_order, created_at`
          : await tx`select id, name, deleted_at from sad.account_env_subset where codebase_id = ${cb} and deleted_at is null order by sort_order, created_at`
        // the variables of LIVE sets only (a disabled set lists none: they stay sealed and unlisted until it is enabled)
        const vars: Row[] = withDisabled
          ? await tx`select v.id, v.subset_id, v.name, v.value_sealed, v.deleted_at from sad.account_env_var v join sad.account_env_subset s on s.id = v.subset_id where s.codebase_id = ${cb} and s.deleted_at is null order by v.name`
          : await tx`select v.id, v.subset_id, v.name, v.value_sealed, v.deleted_at from sad.account_env_var v join sad.account_env_subset s on s.id = v.subset_id where s.codebase_id = ${cb} and s.deleted_at is null and v.deleted_at is null order by v.name`
        const sections = { be: '', fe: '', deployment: '', database: '' } as Record<TabSection, string>
        for (const s of secs) if (isSection(s.section)) sections[s.section] = str(s.description)
        const varsBy = new Map<string, TabsVar[]>()
        for (const v of vars) {
          const name = str(v.name)
          if (v.deleted_at != null) {
            // a disabled variable: its name and the time only; the sealed value is never opened for it
            varsBy.set(str(v.subset_id), [...(varsBy.get(str(v.subset_id)) ?? []), { id: str(v.id), name, secret: false, value: null, disabled: true, disabledAt: iso(v.deleted_at) }])
            continue
          }
          // FAIL CLOSED (order o94f3, Lead's rule, 17 Nov): a value is given with the list only when the ALLOWLIST says it is safe to show (mayShowName / mayShowValue: a framework's public prefix or a plain
          // name like NODE_ENV, no secret word in the name, nothing secret in its shape). Everything else is masked: no value in the answer, hidden on the page until his own signed-in tap asks for it (reveal).
          let secret = !mayShowName(name)
          let value: string | null = null
          if (!secret && key.ok) {
            try {
              value = decryptPassword(key.key, str(v.value_sealed))
            } catch {
              value = null
            }
            if (value !== null && !mayShowValue(name, value)) {
              secret = true
              value = null
            }
          }
          const sid = str(v.subset_id)
          varsBy.set(sid, [...(varsBy.get(sid) ?? []), { id: str(v.id), name, secret, value }])
        }
        const pc = pcLabel()
        return {
          codebaseId: cb,
          sections,
          links: links.filter(l => isSection(l.section)).map(l => {
            const a = accountOf.get(str(l.id))
            return {
              id: str(l.id), section: l.section as TabSection, label: str(l.label), url: str(l.url), description: str(l.description),
              platformId: a?.pid ?? null, accountName: a?.name ?? null, accountPlatform: a?.platform ?? null, accountEmail: a?.email ?? null,
              ...(l.deleted_at == null ? {} : { disabled: true as const, disabledAt: iso(l.deleted_at) }),
            }
          }),
          subsets: subs.map(s => ({
            id: str(s.id),
            name: str(s.name),
            vars: s.deleted_at == null ? (varsBy.get(str(s.id)) ?? []) : [],
            ...(s.deleted_at == null ? {} : { disabled: true as const, disabledAt: iso(s.deleted_at) }),
          })),
          keyOk: key.ok,
          ...(pc === null ? {} : { pc }),
        }
      })
    },

    /** The description of one section (empty clears it). */
    async setSection(person: string, codebaseId: string, section: unknown, description: unknown): Promise<{ section: TabSection; description: string }> {
      const cb = uuid(codebaseId)
      if (!cb) throw apiError(400, 'That codebase id is not valid.')
      if (!isSection(section)) throw apiError(400, 'The section is BE, FE, Deployment or Database.')
      const text = need(checkDescription(description))
      return run(person, async tx => {
        await codebaseOr404(tx, cb)
        const upd: Row[] = await tx`update sad.account_codebase_section set description = ${text}, updated_at = now() where codebase_id = ${cb} and section = ${section} returning id`
        if (upd.length === 0) await tx`insert into sad.account_codebase_section (owner_id, codebase_id, section, description) values (${person}, ${cb}, ${section}, ${text})`
        return { section, description: text }
      })
    },

    async addLink(person: string, codebaseId: string, input: unknown): Promise<{ id: string }> {
      const cb = uuid(codebaseId)
      if (!cb) throw apiError(400, 'That codebase id is not valid.')
      const r = input as Record<string, unknown>
      if (!isSection(r?.section)) throw apiError(400, 'The section is BE, FE, Deployment or Database.')
      const link = need(checkLink(input))
      const section = r.section
      const account = accountChoice(r)
      return run(person, async tx => {
        await codebaseOr404(tx, cb)
        if (account.id !== null) await ownedLiveAccount(tx, account.id)
        const next: Row[] = await tx`select coalesce(max(sort_order), 0) + 1 as n from sad.account_codebase_link where codebase_id = ${cb} and section = ${section}`
        // Without an account the statement is the one that has always run (it works before migration 0013); with one, the platform_id column is written.
        const made: Row[] = account.id === null
          ? await tx`insert into sad.account_codebase_link (owner_id, codebase_id, section, label, url, description, sort_order) values (${person}, ${cb}, ${section}, ${link.label}, ${link.url}, ${link.description}, ${Number(next[0]?.n ?? 1)}) returning id`
          : await tx`insert into sad.account_codebase_link (owner_id, codebase_id, section, label, url, description, sort_order, platform_id) values (${person}, ${cb}, ${section}, ${link.label}, ${link.url}, ${link.description}, ${Number(next[0]?.n ?? 1)}, ${account.id}) returning id`
        return { id: str(made[0]?.id) }
      })
    },

    async updateLink(person: string, linkId: string, input: unknown): Promise<{ ok: true }> {
      const id = uuid(linkId)
      if (!id) throw apiError(400, 'That link id is not valid.')
      const link = need(checkLink(input))
      const account = accountChoice(input as Record<string, unknown>)
      return run(person, async tx => {
        if (account.id !== null) await ownedLiveAccount(tx, account.id)
        // The account is written only when the form sends one (picked or cleared): an edit without it never touches the column (so it works before 0013).
        const rows: Row[] = account.sent
          ? await tx`update sad.account_codebase_link set label = ${link.label}, url = ${link.url}, description = ${link.description}, platform_id = ${account.id}, updated_at = now() where id = ${id} and deleted_at is null returning id`
          : await tx`update sad.account_codebase_link set label = ${link.label}, url = ${link.url}, description = ${link.description}, updated_at = now() where id = ${id} and deleted_at is null returning id`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        return { ok: true as const }
      })
    },

    /** Disable a link: the row stays in the database with deleted_at set (the one marker); the page no longer shows it unless "Show disabled" asks. */
    async disableLink(person: string, linkId: string): Promise<{ ok: true }> {
      const id = uuid(linkId)
      if (!id) throw apiError(400, 'That link id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_codebase_link set deleted_at = now(), updated_at = now() where id = ${id} and deleted_at is null returning id`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        return { ok: true as const }
      })
    },

    /** Enable a disabled link again (a link an older version soft-deleted is a disabled one too). */
    async enableLink(person: string, linkId: string): Promise<{ ok: true }> {
      const id = uuid(linkId)
      if (!id) throw apiError(400, 'That link id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_codebase_link set deleted_at = null, updated_at = now() where id = ${id} and deleted_at is not null returning id`
        if (rows.length === 0) throw apiError(404, NOT_DISABLED)
        return { ok: true as const }
      })
    },

    async addSubset(person: string, codebaseId: string, name: unknown): Promise<{ id: string }> {
      const cb = uuid(codebaseId)
      if (!cb) throw apiError(400, 'That codebase id is not valid.')
      const n = need(checkSubsetName(name))
      return run(person, async tx => {
        await codebaseOr404(tx, cb)
        const next: Row[] = await tx`select coalesce(max(sort_order), 0) + 1 as n from sad.account_env_subset where codebase_id = ${cb}`
        const made: Row[] = await tx`insert into sad.account_env_subset (owner_id, codebase_id, name, sort_order) values (${person}, ${cb}, ${n}, ${Number(next[0]?.n ?? 1)}) returning id`
        return { id: str(made[0]?.id) }
      })
    },

    async renameSubset(person: string, subsetId: string, name: unknown): Promise<{ ok: true }> {
      const id = uuid(subsetId)
      if (!id) throw apiError(400, 'That subset id is not valid.')
      const n = need(checkSubsetName(name))
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_env_subset set name = ${n}, updated_at = now() where id = ${id} and deleted_at is null returning id`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        return { ok: true as const }
      })
    },

    /** Disable a set. Its variables are NOT touched (no cascade): they leave the page with the set because a read lists the variables of live sets only, and they come back as they were when the set is enabled. */
    async disableSubset(person: string, subsetId: string): Promise<{ ok: true }> {
      const id = uuid(subsetId)
      if (!id) throw apiError(400, 'That subset id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_env_subset set deleted_at = now(), updated_at = now() where id = ${id} and deleted_at is null returning id`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        return { ok: true as const }
      })
    },

    /**
     * Enable a disabled set. Refused in plain words when a LIVE set of the same codebase now has the same name (compared the way the Env tab's add compares: ignoring case). A set an older version soft-deleted took ITS variables
     * with it, stamped with the very same time: those come back with it (and only those: a variable that was disabled on its own stays disabled).
     */
    async enableSubset(person: string, subsetId: string): Promise<{ ok: true }> {
      const id = uuid(subsetId)
      if (!id) throw apiError(400, 'That subset id is not valid.')
      return run(person, async tx => {
        const me: Row[] = await tx`select codebase_id, name from sad.account_env_subset where id = ${id} and deleted_at is not null`
        if (me.length === 0) throw apiError(404, NOT_DISABLED)
        const clash: Row[] = await tx`select id from sad.account_env_subset where codebase_id = ${me[0].codebase_id} and deleted_at is null and lower(name) = lower(${str(me[0].name)})`
        if (clash.length > 0) throw apiError(409, SET_NAME_TAKEN)
        // before the set's own mark is cleared (they are compared with it): the variables an older version stamped with the set's time
        await tx`update sad.account_env_var v set deleted_at = null, updated_at = now() from sad.account_env_subset s where s.id = ${id} and v.subset_id = s.id and v.deleted_at = s.deleted_at`
        await tx`update sad.account_env_subset set deleted_at = null, updated_at = now() where id = ${id}`
        return { ok: true as const }
      })
    },

    /**
     * Adds a variable to a subset. The value is sealed before it is written. A name that is taken by a live variable is refused; a name whose
     * variable was deleted is brought back with the new value (so there is never a second row with the same name).
     */
    async addVar(person: string, subsetId: string, input: unknown): Promise<{ id: string }> {
      const id = uuid(subsetId)
      if (!id) throw apiError(400, 'That subset id is not valid.')
      const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
      const name = need(checkVarName(r.name))
      const value = need(checkVarValue(r.value ?? ''))
      const key = keyOrRefuse()
      const sealed = encryptPassword(key, value)
      return run(person, async tx => {
        const sub: Row[] = await tx`select id from sad.account_env_subset where id = ${id} and deleted_at is null`
        if (sub.length === 0) throw apiError(404, NO_ROW)
        const live: Row[] = await tx`select id from sad.account_env_var where subset_id = ${id} and name = ${name} and deleted_at is null`
        if (live.length > 0) throw apiError(409, NAME_TAKEN)
        const back: Row[] = await tx`update sad.account_env_var set deleted_at = null, value_sealed = ${sealed}, updated_at = now() where subset_id = ${id} and name = ${name} and deleted_at is not null returning id`
        if (back.length > 0) return { id: str(back[0].id) }
        const made: Row[] = await tx`insert into sad.account_env_var (owner_id, subset_id, name, value_sealed) values (${person}, ${id}, ${name}, ${sealed}) returning id`
        return { id: str(made[0]?.id) }
      })
    },

    /**
     * Order o94f3 (the Env tab's "+" and its paste box for NAME=VALUE lines): adds one variable or many to the set called `environment` (Dev, Prod, Preview or his own name), making the set when it is not there yet. A name
     * that a live variable of that set already has is left as it is and reported (never overwritten: changing a value is Edit's job). One transaction: all of it or none. Values are sealed before they are
     * written. WHAT COMES BACK IS NAMES AND COUNTS ONLY, never a value; a name that cannot be used is reported by its place in the list, not by its text.
     */
    async addEnv(person: string, codebaseId: string, input: unknown): Promise<{ subsetId: string; created: boolean; added: string[]; skipped: { name: string; why: string }[] }> {
      const cb = uuid(codebaseId)
      if (!cb) throw apiError(400, 'That codebase id is not valid.')
      const { environment: wanted, vars: given } = (typeof input === 'object' && input !== null ? input : {}) as { environment?: unknown; vars?: unknown }
      const environment = need(checkSubsetName(wanted))
      const list = Array.isArray(given) ? given : []
      if (list.length === 0) throw apiError(400, 'There is nothing to add.')
      if (list.length > ENV_PASTE_MAX_VARS) throw apiError(400, `At most ${ENV_PASTE_MAX_VARS} variables at a time.`)
      const skipped: { name: string; why: string }[] = []
      const usable: { name: string; value: string }[] = []
      const seen = new Set<string>()
      list.forEach((item, i) => {
        const o = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        const n = checkVarName(o.name)
        if (!n.ok) return void skipped.push({ name: `#${i + 1}`, why: n.message })
        const v = checkVarValue(o.value ?? '')
        if (!v.ok) return void skipped.push({ name: n.value, why: v.message })
        if (seen.has(n.value)) return void skipped.push({ name: n.value, why: 'given twice' })
        seen.add(n.value)
        usable.push({ name: n.value, value: v.value })
      })
      if (usable.length === 0) throw apiError(400, `None of the variables can be used (${skipped.map(s => `${s.name}: ${s.why}`).join('; ')}).`)
      const key = keyOrRefuse()
      return run(person, async tx => {
        await codebaseOr404(tx, cb)
        const found: Row[] = await tx`select id from sad.account_env_subset where codebase_id = ${cb} and deleted_at is null and lower(name) = lower(${environment}) order by sort_order, created_at limit 1`
        let subsetId = found.length > 0 ? str(found[0].id) : ''
        let created = false
        if (!subsetId) {
          const next: Row[] = await tx`select coalesce(max(sort_order), 0) + 1 as n from sad.account_env_subset where codebase_id = ${cb}`
          const made: Row[] = await tx`insert into sad.account_env_subset (owner_id, codebase_id, name, sort_order) values (${person}, ${cb}, ${environment}, ${Number(next[0]?.n ?? 1)}) returning id`
          subsetId = str(made[0]?.id)
          created = true
        }
        const live: Row[] = await tx`select name from sad.account_env_var where subset_id = ${subsetId} and deleted_at is null`
        const taken = new Set(live.map(x => str(x.name)))
        const added: string[] = []
        for (const { name, value } of usable) {
          if (taken.has(name)) {
            skipped.push({ name, why: 'already in this set' })
            continue
          }
          const sealed = encryptPassword(key, value)
          const back: Row[] = await tx`update sad.account_env_var set deleted_at = null, value_sealed = ${sealed}, updated_at = now() where subset_id = ${subsetId} and name = ${name} and deleted_at is not null returning id`
          if (back.length === 0) await tx`insert into sad.account_env_var (owner_id, subset_id, name, value_sealed) values (${person}, ${subsetId}, ${name}, ${sealed})`
          added.push(name)
        }
        return { subsetId, created, added, skipped }
      })
    },

    /** Changes a variable's name and/or value (a value left out keeps the old one). */
    async updateVar(person: string, varId: string, input: unknown): Promise<{ ok: true; id: string }> {
      const id = uuid(varId)
      if (!id) throw apiError(400, 'That variable id is not valid.')
      const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
      const name = r.name === undefined ? null : need(checkVarName(r.name))
      const value = r.value === undefined ? null : need(checkVarValue(r.value))
      const sealed = value === null ? null : encryptPassword(keyOrRefuse(), value)
      return run(person, async tx => {
        const cur: Row[] = await tx`select id, name, subset_id, value_sealed from sad.account_env_var where id = ${id} and deleted_at is null`
        if (cur.length === 0) throw apiError(404, NO_ROW)
        const row = cur[0]
        const finalName = name ?? str(row.name)
        const finalSealed = sealed ?? str(row.value_sealed)
        if (name !== null && name !== str(row.name)) {
          const live: Row[] = await tx`select id from sad.account_env_var where subset_id = ${row.subset_id} and name = ${name} and deleted_at is null`
          if (live.length > 0) throw apiError(409, NAME_TAKEN)
          // A deleted variable with the new name is brought back with this value; this row goes to the deleted state (no second row with one name).
          const back: Row[] = await tx`select id from sad.account_env_var where subset_id = ${row.subset_id} and name = ${name} and deleted_at is not null`
          if (back.length > 0) {
            await tx`update sad.account_env_var set deleted_at = null, value_sealed = ${finalSealed}, updated_at = now() where id = ${back[0].id}`
            await tx`update sad.account_env_var set deleted_at = now(), updated_at = now() where id = ${id}`
            return { ok: true as const, id: str(back[0].id) }
          }
        }
        if (sealed !== null) await tx`update sad.account_env_var set name = ${finalName}, value_sealed = ${finalSealed}, updated_at = now() where id = ${id}`
        else await tx`update sad.account_env_var set name = ${finalName}, updated_at = now() where id = ${id}`
        return { ok: true as const, id }
      })
    },

    /** Disable a variable: it stays in the database, sealed, with deleted_at set (the one marker); it has no Show, Copy, Edit or Deliver until it is enabled, and its name is free for an add (which brings this row back). */
    async disableVar(person: string, varId: string): Promise<{ ok: true }> {
      const id = uuid(varId)
      if (!id) throw apiError(400, 'That variable id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_env_var set deleted_at = now(), updated_at = now() where id = ${id} and deleted_at is null returning id`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        return { ok: true as const }
      })
    },

    /**
     * Enable a disabled variable again, as it was (its sealed value is not touched). Only inside a LIVE set: a variable of a disabled set is enabled by enabling the set. There is no name clash to refuse: the name is
     * unique per set over ALL rows (0006), and adding a disabled name brings that same row back.
     */
    async enableVar(person: string, varId: string): Promise<{ ok: true }> {
      const id = uuid(varId)
      if (!id) throw apiError(400, 'That variable id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`update sad.account_env_var v set deleted_at = null, updated_at = now() from sad.account_env_subset s where v.id = ${id} and v.deleted_at is not null and s.id = v.subset_id and s.deleted_at is null returning v.id`
        if (rows.length === 0) throw apiError(404, NOT_DISABLED)
        return { ok: true as const }
      })
    },

    /** The one way a secret value leaves the Server: when he asks for it (reveal). One line is logged (who, which row, when), never the value. */
    async reveal(person: string, varId: string): Promise<{ value: string }> {
      const id = uuid(varId)
      if (!id) throw apiError(400, 'That variable id is not valid.')
      const key = keyOrRefuse()
      const out = await run(person, async tx => {
        const rows: Row[] = await tx`select value_sealed from sad.account_env_var where id = ${id} and deleted_at is null`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        try {
          return { value: decryptPassword(key, str(rows[0].value_sealed)) }
        } catch {
          throw apiError(500, 'That value could not be opened with the key on this PC.')
        }
      })
      // The reveal is logged: who, which row, when. Never the value.
      o.log?.info?.(`environment variable revealed: row ${id} by ${person} at ${new Date().toISOString()}`)
      return out
    },

    /**
     * Order o94f3, "show all" (Lead, 17 Nov: seeing his own values at a glance is his to choose): the values of ONE set in one call, for his own tap on "Show all" (or the device setting that taps for him).
     * Keyed by the variable's id; a value that will not open is listed in `unreadable`, never described. Like reveal it is humanOnly, and it is logged as one line (who, which set, how many), never a value.
     */
    async revealSet(person: string, subsetId: string): Promise<{ values: Record<string, string>; unreadable: string[] }> {
      const id = uuid(subsetId)
      if (!id) throw apiError(400, 'That subset id is not valid.')
      const key = keyOrRefuse()
      const out = await run(person, async tx => {
        const sub: Row[] = await tx`select id from sad.account_env_subset where id = ${id} and deleted_at is null`
        if (sub.length === 0) throw apiError(404, NO_ROW)
        const rows: Row[] = await tx`select id, value_sealed from sad.account_env_var where subset_id = ${id} and deleted_at is null`
        const values: Record<string, string> = {}
        const unreadable: string[] = []
        for (const r of rows) {
          try {
            values[str(r.id)] = decryptPassword(key, str(r.value_sealed))
          } catch {
            unreadable.push(str(r.id))
          }
        }
        return { values, unreadable }
      })
      o.log?.info?.(`environment set revealed: set ${id} by ${person} at ${new Date().toISOString()}: ${Object.keys(out.values).length} values`)
      return out
    },
  }
}

export type CodebaseTabs = ReturnType<typeof createCodebaseTabs>
