import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { backupScheduler, BACKUPS_KEPT } from '../../data/backup-scheduler'
import { resetDb } from '../helpers'

// The raw text of a sync file at an older schema version is the only copy of
// what the old build wrote. The newest-5 sync-file pool must never push it
// out: later overwrites (Use browser data, Keep browser data) each add a
// copy of a file that by then is a current-version dump. Its own pool keeps
// the newest five (one per schema upgrade of the file).

const V49_TEXT = '{"__schemaVersion":49,"todos":[],"settings":[]}'
const current = (n: number) => `{"__schemaVersion":63,"todos":[],"settings":[],"n":${n}}`

async function byTrigger(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const b of await db.backups.orderBy('id').toArray()) (out[b.trigger] ??= []).push(b.data)
  return out
}

beforeEach(async () => {
  await resetDb()
})

describe('the raw copy of an older sync file', () => {
  it('outlives any number of later sync-file backups', async () => {
    await backupScheduler.snapshotFileBeforeOverwrite(V49_TEXT, { olderVersion: true })
    for (let n = 0; n < BACKUPS_KEPT['sync-file'] + 3; n++) await backupScheduler.snapshotFileBeforeOverwrite(current(n))
    const kept = await byTrigger()
    expect(kept['sync-file-original']).toEqual([V49_TEXT])
    expect(kept['sync-file']).toHaveLength(BACKUPS_KEPT['sync-file'])
  })

  it('keeps the newest of its own, past its count', async () => {
    const older = (n: number) => `{"__schemaVersion":${49 + n},"todos":[],"settings":[]}`
    const total = BACKUPS_KEPT['sync-file-original'] + 2
    for (let n = 0; n < total; n++) await backupScheduler.snapshotFileBeforeOverwrite(older(n), { olderVersion: true })
    const kept = (await byTrigger())['sync-file-original']
    expect(kept).toEqual(Array.from({ length: total }, (_, n) => older(n)).slice(2))
  })

  it('is stored once per text (a retried upgrade adds no second copy)', async () => {
    await backupScheduler.snapshotFileBeforeOverwrite(V49_TEXT, { olderVersion: true })
    await backupScheduler.snapshotFileBeforeOverwrite(V49_TEXT, { olderVersion: true })
    expect((await byTrigger())['sync-file-original']).toEqual([V49_TEXT])
  })

  it('a current-version file goes to the pruned pool as before', async () => {
    await backupScheduler.snapshotFileBeforeOverwrite(current(1))
    expect(await byTrigger()).toEqual({ 'sync-file': [current(1)] })
  })
})
