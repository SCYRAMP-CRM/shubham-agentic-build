import { safePlatformRows, type PlatformsAnswer } from '../../shared/platform-accounts.ts'
import type { NotConnected } from '../../shared/email-accounts.ts'
import { apiError } from '../api.ts'
import { BAD_WORDS, WORDS, openAccountsDb, readAccountsDb, reasonOf, type AccountsSql, type Row } from './accounts-db.ts'

// order o4029: the Accounts page's "Accounts" tab (the CRM's Code > Accounts page: the platform accounts), read from the NEW Supabase project (schema sad, db/accounts/0004 + 0005). Same rules as the Email
// and Codebases tabs: only SELECTs, each inside a transaction that first says who is asking (set_config app.person_id, bound), so the database's row-level security decides what that person sees; every row
// goes through the whitelist of shared/platform-accounts.ts on the way out; the connection is opened for the call and ended after it; a failure becomes a plain reason (never the error's text). F-293 (his decision "A", 18 Nov 2026):
// a password he typed is kept sealed (db/accounts/0017) and this reader NEVER selects the sealed columns: only the flags has_password (the CRM says one exists), has_app_password, password_disabled and the change time. The email each account signs in with is matched to the Email tab's copy by the CRM's own id (for the link and the "disabled" badge).

export interface AccountsPlatformsOptions {
  dir: string
  open?: typeof openAccountsDb
  log?: { warn(message: string): void }
}

const PERSON = /^[A-Za-z0-9._:@-]{1,80}$/
const notConnected = (reason: NotConnected, detail?: string): PlatformsAnswer => ({ connected: false, reason, message: detail ? `${WORDS[reason]} (${detail}.)` : WORDS[reason] })

export function createAccountsPlatforms(o: AccountsPlatformsOptions) {
  const open = o.open ?? openAccountsDb
  return {
    /**
     * The platform accounts `person` may see, each with the codebases it is connected to. Slice D (disable, never delete): a switched-off (disabled) account is not in the list unless `disabled` is asked for (the page's "Show disabled"); with it
     * every account comes back, a disabled one marked `disabled` and carrying `disabledAt`. An account an older version soft-deleted (deleted_at) is a disabled one too: nothing is converted, it simply reads as disabled.
     */
    async list(person: string, opts: { disabled?: boolean } = {}): Promise<PlatformsAnswer> {
      const read = readAccountsDb(o.dir)
      if (!read.ok) return read.bad === null ? notConnected('not-set-up') : notConnected('not-set-up', BAD_WORDS[read.bad])
      if (!PERSON.test(person)) throw apiError(400, 'The person asking is not a valid id.')
      let sql: AccountsSql | null = null
      try {
        sql = await open(read)
        const got = await sql.begin(async tx => {
          await tx`select set_config('app.person_id', ${person}, true)`
          const accounts: Row[] = opts.disabled === true
            ? await tx`
            select p.id, p.platform, p.account_type, p.account_type_disabled, p.name, p.sign_in_email, p.email_source_id, p.phone, p.contact_name, p.contact_linked, p.contact_disabled, p.has_password,
              p.is_disabled, p.source_updated_at, e.id as email_id, e.is_disabled as email_disabled, p.authenticator_email, p.authenticator_app, p.authenticator_note, p.note, p.has_app_password, p.password_disabled, p.password_changed_at, p.deleted_at, p.updated_at
            from sad.account_platform p left join sad.account_email e on e.source_id = p.email_source_id
            order by (p.is_disabled or p.deleted_at is not null), lower(p.platform), lower(coalesce(p.name, p.sign_in_email, '')) limit 2001`
            : await tx`
            select p.id, p.platform, p.account_type, p.account_type_disabled, p.name, p.sign_in_email, p.email_source_id, p.phone, p.contact_name, p.contact_linked, p.contact_disabled, p.has_password,
              p.is_disabled, p.source_updated_at, e.id as email_id, e.is_disabled as email_disabled, p.authenticator_email, p.authenticator_app, p.authenticator_note, p.note, p.has_app_password, p.password_disabled, p.password_changed_at, p.deleted_at, p.updated_at
            from sad.account_platform p left join sad.account_email e on e.source_id = p.email_source_id
            where p.deleted_at is null and p.is_disabled = false
            order by lower(p.platform), lower(coalesce(p.name, p.sign_in_email, '')) limit 2001`
          const links: Row[] = await tx`
            select pc.platform_id, pc.parts, c.id as codebase_id, c.name as codebase_name
            from sad.account_platform_codebase pc left join sad.account_codebase c on coalesce(c.source_id, c.id) = pc.codebase_source_id
            where pc.gone_from_source = false order by pc.platform_id, lower(coalesce(c.name, '')) limit 8000`
          return { accounts, links }
        })
        const linksBy = new Map<string, unknown[]>()
        for (const l of got.links) {
          const key = String(l.platform_id)
          linksBy.set(key, [...(linksBy.get(key) ?? []), { codebaseId: l.codebase_id === null || l.codebase_id === undefined ? null : String(l.codebase_id), name: l.codebase_name ?? 'A codebase that is not in the copy', parts: Array.isArray(l.parts) ? l.parts : [] }])
        }
        const accounts = safePlatformRows(
          got.accounts.map(a => ({
            id: String(a.id),
            platform: a.platform,
            accountType: a.account_type,
            accountTypeDisabled: a.account_type_disabled === true,
            name: a.name,
            signInEmail: a.sign_in_email,
            emailId: a.email_id === null || a.email_id === undefined ? null : String(a.email_id),
            inEmails: a.email_source_id !== null && a.email_source_id !== undefined,
            emailDisabled: a.email_disabled === true,
            phone: a.phone,
            contactName: a.contact_name,
            contactLinked: a.contact_linked === true,
            contactDisabled: a.contact_disabled === true,
            hasPassword: a.has_password === true,
            // F-293: only the flags and the time. The sealed password_enc / password_mac are NEVER in this reader's SQL (a test pins it): the page learns WHETHER one is stored here, never the password.
            hasAppPassword: a.has_app_password === true,
            passwordDisabled: a.password_disabled === true,
            passwordChangedAt: a.password_changed_at,
            disabled: a.is_disabled === true || a.deleted_at != null,
            disabledAt: a.deleted_at ?? a.updated_at,
            updatedAt: a.source_updated_at,
            codebases: linksBy.get(String(a.id)) ?? [],
            authenticatorEmail: a.authenticator_email,
            authenticatorApp: a.authenticator_app,
            authenticatorNote: a.authenticator_note,
            // Order obf7c: the Description (the `note` column, written by the Add form since 0011 but never read until now). It goes through safeDescription on the way out (a text that looks like a secret is hidden).
            description: a.note,
          })),
        )
        return { connected: true, accounts: accounts ?? [] }
      } catch (e) {
        const { reason, code } = reasonOf(e)
        o.log?.warn(`accounts db (platforms): ${reason} (${code})`)
        return notConnected(reason)
      } finally {
        await sql?.end({ timeout: 2 }).catch(() => {})
      }
    },
  }
}

export type AccountsPlatforms = ReturnType<typeof createAccountsPlatforms>
