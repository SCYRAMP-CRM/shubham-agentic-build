#!/usr/bin/env node
// Order ofedf: how a Claude chat's usage reaches the ledger. Every Claude chat this app starts gets this as its status line
// (the chat's --settings file names it; the process gets SAD_USAGE_LAUNCH, SAD_USAGE_USER, SAD_USAGE_ORG, SAD_USAGE_SUB and
// SAD_USAGE_DIR from the agent). Claude Code runs it after replies and writes a JSON description of the session to its stdin.
//
// It keeps two small snapshot files in SAD_USAGE_DIR and sends nothing anywhere (the reader in snapshots.ts does that):
//   sessions/<sessionId>.<launchId>.json   the session's running cost (cost.total_cost_usd) and who started it
//   limits/<subscription id | _local>.json Claude's own 5-hour and week percentages (rate_limits), per account
//
// Rules: never throw, never hang (Claude Code waits for this), never write outside SAD_USAGE_DIR, never read or write a credential.
// It prints a short line of its own (model · 5-hour % · week %), or the output of the person's own status line when there was one
// (SAD_STATUSLINE_CHAIN: base64 of its command, run with the same stdin).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const LAUNCH_RE = /^[A-Za-z0-9]{8,64}$/
const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/
const OWNER_RE = /^[A-Za-z0-9-]{1,64}$/
const SUB_RE = /^[0-9a-f-]{36}$/i
const CHAIN_TIMEOUT_MS = 3000

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

// Order of130: no figure is not 0. Number(null) and Number('') are 0, so a window Claude Code had no figure for (null, an empty string) read as "0% used": in the snapshot that goes to the CRM, where it could stand
// in for a real reading, and in the line printed below. Only a null, an empty string or a missing value is "no figure"; a real 0, a number and a numeric string read as they always did.
const figure = v => (v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? NaN : Number(v))

function windowOf(w) {
  if (!w || typeof w !== 'object') return null
  const percent = figure(w.used_percentage)
  const resets = figure(w.resets_at)
  const p = Number.isFinite(percent) && percent >= 0 && percent <= 101 ? percent : null
  const r = Number.isFinite(resets) && resets > 0 ? new Date(resets * 1000).toISOString() : null
  // A window with neither a percentage nor a reset time is no reading at all (snapshots.ts says the same): writing it would wipe the last real reading of that account with nulls.
  return p === null && r === null ? null : { percent: p, resetsAt: r }
}

function chained(input) {
  const b64 = process.env.SAD_STATUSLINE_CHAIN
  if (!b64) return null
  try {
    const command = Buffer.from(b64, 'base64').toString('utf8')
    if (!command) return null
    const r = spawnSync(command, { input, shell: true, encoding: 'utf8', timeout: CHAIN_TIMEOUT_MS, windowsHide: true })
    return typeof r.stdout === 'string' ? r.stdout.replace(/\s+$/, '') : null
  } catch {
    return null
  }
}

function main() {
  // Four values from the chat's environment (chats.ts sets them for each process): the launch id (fresh per spawn), the person who
  // started the chat, the org, and the subscription id ('' or '-' for the PC's own login).
  const launch = process.env.SAD_USAGE_LAUNCH
  const owner = process.env.SAD_USAGE_USER || '-'
  const org = process.env.SAD_USAGE_ORG || '-'
  const sub = process.env.SAD_USAGE_SUB || ''
  const input = readStdin()
  let j = null
  try {
    j = JSON.parse(input)
  } catch {
    j = null
  }
  const dir = process.env.SAD_USAGE_DIR
  if (j && typeof dir === 'string' && dir && LAUNCH_RE.test(launch ?? '')) {
    try {
      const session = typeof j.session_id === 'string' && SESSION_RE.test(j.session_id) ? j.session_id : null
      const cost = Number(j.cost?.total_cost_usd)
      if (session && Number.isFinite(cost) && cost >= 0) {
        const subscriptionKey = SUB_RE.test(sub ?? '') ? sub.toLowerCase() : ''
        writeAtomic(
          path.join(dir, 'sessions', `${session}.${launch}.json`),
          `${JSON.stringify({
            sessionId: session,
            launchId: launch,
            at: new Date().toISOString(),
            costUsd: cost,
            userId: OWNER_RE.test(owner ?? '') && owner !== '-' ? owner : null,
            orgId: OWNER_RE.test(org ?? '') && org !== '-' ? org : null,
            subscriptionKey,
          })}\n`,
        )
      }
      const fiveHour = windowOf(j.rate_limits?.five_hour)
      const week = windowOf(j.rate_limits?.seven_day)
      if (fiveHour || week) {
        const subscriptionKey = SUB_RE.test(sub ?? '') ? sub.toLowerCase() : ''
        writeAtomic(
          path.join(dir, 'limits', `${subscriptionKey || '_local'}.json`),
          `${JSON.stringify({ at: new Date().toISOString(), fiveHour, week })}\n`,
        )
      }
    } catch {
      // A failed snapshot is a missing reading, never a broken status line.
    }
  }
  const own = chained(input)
  if (own !== null) {
    process.stdout.write(`${own}\n`)
    return
  }
  const model = j?.model?.display_name ?? j?.model?.id ?? ''
  const five = j?.rate_limits?.five_hour?.used_percentage
  const week = j?.rate_limits?.seven_day?.used_percentage
  const parts = [model, Number.isFinite(figure(five)) ? `5h ${Math.round(figure(five))}%` : null, Number.isFinite(figure(week)) ? `week ${Math.round(figure(week))}%` : null]
  process.stdout.write(`${parts.filter(Boolean).join(' · ')}\n`)
}

try {
  main()
} catch {
  // Never a broken status line.
}
