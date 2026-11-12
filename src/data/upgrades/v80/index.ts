import type { DataRow, DataSet } from '../../schema-upgrades'

/**
 * v80 — check-ins by copy (2026-11-12): a check-in is copied from its dialog
 * and pasted into a message, so nothing about mail is stored any more:
 *
 * - every `people` row without its `email`;
 * - the `settings` row `checkinOpenMethod` (how a check-in opened in the
 *   mail app) deleted.
 *
 * Nothing else moves: tasks and their `modifiedAt`, the history log,
 * `historyLogSince` and the check-in filter (`checkinTaskFilter`) stay as
 * they were. Follows the transform contract (`schema-upgrades`): pure,
 * idempotent, tolerant of missing tables and malformed rows (left for
 * validation); a table it leaves alone comes back as the same array.
 */

const RETIRED_SETTING_KEYS: ReadonlySet<unknown> = new Set(['checkinOpenMethod'])

function isRecord(v: unknown): v is DataRow {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function upgradePeople(data: DataSet): DataSet {
  const people = data.people
  if (!people || !people.some((r) => isRecord(r) && 'email' in r)) return data
  return {
    ...data,
    people: people.map((row) => {
      if (!isRecord(row) || !('email' in row)) return row
      const { email: _email, ...rest } = row
      void _email
      return rest
    }),
  }
}

function upgradeSettings(data: DataSet): DataSet {
  const settings = data.settings
  if (!settings || !settings.some((r) => isRecord(r) && RETIRED_SETTING_KEYS.has(r.key))) return data
  return { ...data, settings: settings.filter((r) => !isRecord(r) || !RETIRED_SETTING_KEYS.has(r.key)) }
}

export function upgradeV80(data: DataSet): DataSet {
  return upgradeSettings(upgradePeople(data))
}
