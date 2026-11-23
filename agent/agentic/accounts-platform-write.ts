import { apiError } from '../api.ts'
import { checkPlatformEdit, type PlatformEditInput } from '../../shared/platform-edit.ts'
import { checkPlatformAdd, type PlatformAddInput } from '../../shared/platform-add.ts'
import { checkAuthenticator, type AuthenticatorInput } from '../../shared/authenticator.ts'
import { PASSWORD_WORDS } from '../../shared/platform-password.ts'
import { decryptPassword, encryptPassword, passwordMac } from './accounts-crypto.ts'
import { openAccountsDb, readAccountsDb, readAccountsKey, reasonOf, WORDS, type AccountsSql, type Row, type Tx } from './accounts-db.ts'

// Accounts edit slice (Shubham's o45c0 rule): the platform accounts (the CRM's Accounts page) can be EDITED, DISABLED and enabled again in the app, in the new database (sad) only. DISABLE NEVER DELETE (slice D): there is no delete.
// Every app edit, disable or enable sets app_touched_at; the copy job then leaves the row alone (accounts-codebase-import.ts). A copied row is editable here: the CRM is never written.
// F-293, HIS DECISION "A" (18 Nov 2026; reverses the old rule "no password here, only has_password"): a platform account's password is typed by HIM and sealed here (AES-256-GCM, the same code and the same key file as the email passwords,
// db/accounts/0017_platform_password.sql). It is WRITE-ONLY: accepted once, never returned by any list or answer; the only way out is the owner's Reveal (decrypted here, logged: who, which row, when; never the password). There is NO remove:
// the password is DISABLED and ENABLED again. A save is one transaction: the old password stays exactly as it was when anything fails. The key is read BEFORE the database is opened, so a missing key writes nothing at all.
// Every method here that seals, opens or changes a password is for a signed-in human only (humanOnly in index.ts); accounts-human-only.test.ts finds this module by its import of accounts-crypto.ts and pins that.

export interface AccountsPlatformWriteOptions {
  dir: string
  open?: typeof openAccountsDb
  log?: { warn(message: string): void; info?(message: string): void }
}

const PERSON = /^[A-Za-z0-9._:@-]{1,80}$/
const UUID = /^[0-9a-f-]{36}$/i
const NO_ROW = 'That account is not there any more.'
// Order obf7c: the app's database login may INSERT and READ a platform account's note (db/accounts/0011) but may not CHANGE it until db/accounts/0016 has been run (one grant, no new column). Said in plain words; nothing is saved.
const NOTE_NEEDS_UPDATE = 'The database needs an update before a description can be changed: db/accounts/0016_platform_note_update.sql has not been run yet. Nothing was saved.'

function need<T>(c: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!c.ok) throw apiError(400, c.message)
  return c.value
}

/** The database refused a statement that names the password columns: they are not there (42703) or the login has no right to them (42501): db/accounts/0017 has not been run. Said in plain words; the whole save is rolled back. */
const needsPasswordUpdate = (e: unknown): boolean => {
  const code = reasonOf(e).code
  return code === '42501' || code === '42703'
}

export function createAccountsPlatformWrite(o: AccountsPlatformWriteOptions) {
  const open = o.open ?? openAccountsDb

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
      o.log?.warn(`accounts db (platform write): ${reason} (${code})`)
      throw apiError(503, WORDS[reason])
    } finally {
      await sql?.end({ timeout: 2 }).catch(() => {})
    }
  }

  async function liveOrNotFound(tx: Tx, id: string): Promise<void> {
    const rows: Row[] = await tx`select id from sad.account_platform where id = ${id} and deleted_at is null`
    if (rows.length === 0) throw apiError(404, NO_ROW)
  }

  /** The sealed password and its fingerprint, or null when no new password was typed. The key is needed only for a password, and is read BEFORE the database is opened: a missing key writes nothing at all. */
  function sealed(password: string | null): { enc: string; mac: string } | null {
    if (password === null) return null
    const k = readAccountsKey(o.dir)
    if (!k.ok) throw apiError(503, PASSWORD_WORDS.keyMissing)
    return { enc: encryptPassword(k.key, password), mac: passwordMac(k.key, password) }
  }

  /**
   * Stores the sealed password of one live row, as the LAST statement of the caller's transaction: so the other fields of the save and the password are written together or not at all. 'replace' when a password was already
   * here, else 'set'; a new password also switches it on (password_disabled = false). The change record names the person who is asking (the one the database was told) and the time, never the value.
   */
  async function storePassword(tx: Tx, person: string, id: string, s: { enc: string; mac: string }, fresh = false): Promise<'set' | 'replace'> {
    try {
      // A row made a moment ago in this same transaction (an Add) has no earlier password: no need to ask.
      let kind: 'set' | 'replace' = 'set'
      if (!fresh) {
        const prev: Row[] = await tx`select has_app_password from sad.account_platform where id = ${id} and deleted_at is null`
        if (prev.length === 0) throw apiError(404, NO_ROW)
        kind = prev[0].has_app_password === true ? 'replace' : 'set'
      }
      await tx`update sad.account_platform set password_enc = ${s.enc}, password_mac = ${s.mac}, has_app_password = true, password_disabled = false, password_changed_at = now(), password_changed_by = ${person}, password_change = ${kind},
        app_touched_at = now(), updated_at = now() where id = ${id} and deleted_at is null`
      return kind
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'status' in e) throw e
      if (needsPasswordUpdate(e)) throw apiError(503, PASSWORD_WORDS.needsUpdate)
      throw e
    }
  }

  /** One line in the agent's log per CHANGE that was committed: who, which row, when. Never the password. Written after the transaction, so a failed save logs nothing. */
  const note = (what: string, id: string, person: string) => o.log?.info?.(`platform password ${what}: row ${id} by ${person} at ${new Date().toISOString()}`)

  return {
    /** Add account (order oc35dc): a platform account made in the app (source 'app'), with the codebases it is connected to. Nothing is written to the CRM. A password typed in the form is sealed and stored in the same transaction (F-293). */
    async create(person: string, raw: unknown): Promise<{ id: string }> {
      const v: PlatformAddInput = need(checkPlatformAdd(raw))
      const a: AuthenticatorInput = need(checkAuthenticator(raw))
      const s = sealed(v.password)
      const made = await run(person, async tx => {
        // Each codebase must be the owner's own codebase (the read rule of 0004 limits the rows; a missing one is refused, not skipped). The codebase table has no
        // deleted_at column in any migration, so this check does not name one (naming it made the database answer 42703).
        const found: Row[] = v.codebases.length
          ? await tx`select id::text as id, source_id::text as source_id from sad.account_codebase where id = any(${v.codebases}::uuid[])`
          : []
        if (found.length !== v.codebases.length) throw apiError(400, 'One of the codebases is not there any more. Choose the codebases again.')
        const made: Row[] = await tx`insert into sad.account_platform (owner_id, source, platform, account_type, name, sign_in_email, phone, contact_name, has_password, is_disabled, note, app_touched_at, authenticator_email, authenticator_app, authenticator_note)
          values (${person}, 'app', ${v.platform}, ${v.accountType}, ${v.name}, ${v.signInEmail}, ${v.phone}, ${v.contactName}, false, ${v.disabled}, ${v.note}, now(), ${a.authenticatorEmail}, ${a.authenticatorApp}, ${a.authenticatorNote})
          returning id::text as id`
        const platformId = String(made[0]?.id)
        // A copied codebase is linked by its CRM id (source_id); an app-made one by its own id (source_id is empty for it).
        for (const cb of found) {
          await tx`insert into sad.account_platform_codebase (platform_id, codebase_source_id, parts) values (${platformId}, ${cb.source_id ?? cb.id}, '{}')`
        }
        // F-293: the password is its OWN statement (an Add without one never touches the new columns, so it works before 0017), inside this same transaction.
        const kind = s === null ? null : await storePassword(tx, person, platformId, s, true)
        return { id: platformId, kind }
      })
      if (made.kind !== null) note(made.kind, made.id, person)
      return { id: made.id }
    },

    /** Changes an account. A password left empty keeps the stored one (the form's other fields never wipe it); a typed one replaces it (F-293). */
    async update(person: string, id: string, raw: unknown): Promise<{ ok: true }> {
      if (!UUID.test(id)) throw apiError(400, 'That account id is not valid.')
      const v: PlatformEditInput = need(checkPlatformEdit(raw))
      const a: AuthenticatorInput = need(checkAuthenticator(raw))
      const s = sealed(v.password)
      const kind = await run(person, async tx => {
        await liveOrNotFound(tx, id)
        await tx`update sad.account_platform set platform = ${v.platform}, account_type = ${v.accountType}, name = ${v.name}, sign_in_email = ${v.signInEmail}, phone = ${v.phone}, is_disabled = ${v.disabled}, app_touched_at = now(), updated_at = now()
          where id = ${id} and deleted_at is null`
        // order o2881: the authenticator (which email account holds the 2FA codes, the app, the device note). Never a secret or a code.
        await tx`update sad.account_platform set authenticator_email = ${a.authenticatorEmail}, authenticator_app = ${a.authenticatorApp}, authenticator_note = ${a.authenticatorNote}
          where id = ${id} and deleted_at is null`
        // Order obf7c: the Description, only when the form sent one (it sends one only when it was changed, so an edit that leaves it alone never needs the right to change it). It is its OWN statement: when the database refuses it
        // (42501: 0016 not run yet) the whole save is rolled back and says so in plain words, so nothing is half-saved.
        if (v.note !== undefined) {
          try {
            await tx`update sad.account_platform set note = ${v.note}, app_touched_at = now(), updated_at = now() where id = ${id} and deleted_at is null`
          } catch (e) {
            if (reasonOf(e).code === '42501') throw apiError(503, NOTE_NEEDS_UPDATE)
            throw e
          }
        }
        // F-293: the password LAST, in the same transaction: if it fails, everything above is rolled back with it and the old password is exactly as it was.
        return s === null ? null : await storePassword(tx, person, id, s)
      })
      if (kind !== null) note(kind, id, person)
      return { ok: true as const }
    },

    /**
     * Reveal (F-293, his answer "1 yes"): the stored password of one of the owner's rows, decrypted HERE; the browser gets it for this one reveal only. Refused while the password is disabled (enable it first). Logged: who, which row, when;
     * the password itself is never logged. Only a signed-in human may call it (humanOnly in index.ts).
     */
    async reveal(person: string, id: string): Promise<{ password: string }> {
      if (!UUID.test(id)) throw apiError(400, 'That account id is not valid.')
      const k = readAccountsKey(o.dir)
      if (!k.ok) throw apiError(503, PASSWORD_WORDS.keyMissing)
      const out = await run(person, async tx => {
        const rows: Row[] = await tx`select password_enc, has_app_password, password_disabled from sad.account_platform where id = ${id} and deleted_at is null`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        const sealedText = rows[0].password_enc
        if (rows[0].has_app_password !== true || typeof sealedText !== 'string' || sealedText === '') throw apiError(404, PASSWORD_WORDS.noPassword)
        if (rows[0].password_disabled === true) throw apiError(409, PASSWORD_WORDS.disabledReveal)
        try {
          return { password: decryptPassword(k.key, sealedText) }
        } catch {
          throw apiError(500, PASSWORD_WORDS.cannotOpen)
        }
      })
      note('revealed', id, person)
      return out
    },

    /** Disable the stored password (F-293: there is NO remove; his word "disable"): reversible, nothing is destroyed. Reveal is refused until it is enabled again. Already disabled: nothing is written. */
    async passwordDisable(person: string, id: string): Promise<{ ok: true }> {
      return setPasswordDisabled(person, id, true)
    },

    /** Enable the stored password again. Already enabled: nothing is written. */
    async passwordEnable(person: string, id: string): Promise<{ ok: true }> {
      return setPasswordDisabled(person, id, false)
    },

    /** Disable (slice D): the account is switched off with the marker this table already has (is_disabled: the editor's "Switched off" toggle is the same state) and leaves the list unless "Show disabled" asks. The copy job leaves it alone. */
    async disable(person: string, id: string): Promise<{ ok: true }> {
      if (!UUID.test(id)) throw apiError(400, 'That account id is not valid.')
      return run(person, async tx => {
        await liveOrNotFound(tx, id)
        await tx`update sad.account_platform set is_disabled = true, app_touched_at = now(), updated_at = now() where id = ${id} and deleted_at is null`
        return { ok: true as const }
      })
    },

    /** Enable: switched on again. An account an older version soft-deleted is a disabled one too: enabling it clears BOTH marks, so it is back exactly as it was. */
    async enable(person: string, id: string): Promise<{ ok: true }> {
      if (!UUID.test(id)) throw apiError(400, 'That account id is not valid.')
      return run(person, async tx => {
        const rows: Row[] = await tx`select id from sad.account_platform where id = ${id}`
        if (rows.length === 0) throw apiError(404, NO_ROW)
        await tx`update sad.account_platform set is_disabled = false, deleted_at = null, app_touched_at = now(), updated_at = now() where id = ${id}`
        return { ok: true as const }
      })
    },
  }

  async function setPasswordDisabled(person: string, id: string, disabled: boolean): Promise<{ ok: true }> {
    if (!UUID.test(id)) throw apiError(400, 'That account id is not valid.')
    const changed = await run(person, async tx => {
      const rows: Row[] = await tx`select has_app_password, password_disabled from sad.account_platform where id = ${id} and deleted_at is null`
      if (rows.length === 0) throw apiError(404, NO_ROW)
      if (rows[0].has_app_password !== true) throw apiError(404, PASSWORD_WORDS.noPassword)
      if ((rows[0].password_disabled === true) === disabled) return false
      await tx`update sad.account_platform set password_disabled = ${disabled}, password_changed_at = now(), password_changed_by = ${person}, password_change = ${disabled ? 'disable' : 'enable'},
        app_touched_at = now(), updated_at = now() where id = ${id} and deleted_at is null`
      return true
    })
    if (changed) note(disabled ? 'disabled' : 'enabled', id, person)
    return { ok: true as const }
  }
}

export type AccountsPlatformWrite = ReturnType<typeof createAccountsPlatformWrite>
