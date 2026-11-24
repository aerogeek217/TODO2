import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { SETTING_KEYS, SYNC_NEUTRAL_SETTING_KEYS } from '../../data/setting-keys'
import { refreshAllStores } from '../../services/refresh-all'
import { useSettingsStore } from '../../stores/settings-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

/**
 * `historyLogSince` (D26 P7): when this database began logging the history
 * log H3's events — stamped once, keyed on the row being absent, never on a
 * schema number; it travels with the data (exports, replaces) as every
 * settings row does.
 */

const KEY = SETTING_KEYS.historyLogSince
const stored = async () => (await db.settings.get(KEY))?.value

beforeEach(async () => {
  await resetDb()
  resetStores()
})

describe('stampHistoryLogSince', () => {
  it('stamps the row once, when it is absent', async () => {
    const first = new Date('2026-11-08T09:00:00Z')
    await useSettingsStore.getState().stampHistoryLogSince(first)
    expect(await stored()).toBe(first.toISOString())
    expect(useSettingsStore.getState().historyLogSince).toEqual(first)

    await useSettingsStore.getState().stampHistoryLogSince(new Date('2026-11-09T09:00:00Z'))
    expect(await stored()).toBe(first.toISOString())
    expect(useSettingsStore.getState().historyLogSince).toEqual(first)
  })

  it('keeps a stored row even when the store hasn’t read it (a failed load)', async () => {
    await db.settings.put({ key: KEY, value: '2026-10-01T00:00:00.000Z' })
    expect(useSettingsStore.getState().historyLogSince).toBeNull()
    await useSettingsStore.getState().stampHistoryLogSince(new Date('2026-11-08T09:00:00Z'))
    expect(await stored()).toBe('2026-10-01T00:00:00.000Z')
    expect(useSettingsStore.getState().historyLogSince).toEqual(new Date('2026-10-01T00:00:00.000Z'))
  })

  it('loads with the settings', async () => {
    await db.settings.put({ key: KEY, value: '2026-10-01T00:00:00.000Z' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().historyLogSince).toEqual(new Date('2026-10-01T00:00:00.000Z'))
  })

  it('is sync-neutral: a launch’s stamp is no unsynced change', () => {
    expect(SYNC_NEUTRAL_SETTING_KEYS.has(KEY)).toBe(true)
  })
})

describe('a data replace', () => {
  it('keeps the start the replaced data brings', async () => {
    await db.settings.put({ key: KEY, value: '2026-07-01T00:00:00.000Z' })
    await refreshAllStores()
    expect(await stored()).toBe('2026-07-01T00:00:00.000Z')
    expect(useSettingsStore.getState().historyLogSince).toEqual(new Date('2026-07-01T00:00:00.000Z'))
  })

  it('starts the log now for data from before it (an older file)', async () => {
    const before = Date.now()
    await refreshAllStores()
    const at = useSettingsStore.getState().historyLogSince
    expect(at).not.toBeNull()
    expect(at!.getTime()).toBeGreaterThanOrEqual(before)
    expect(await stored()).toBe(at!.toISOString())
  })
})

/**
 * `planLogSince` (week load P1): when this database began logging planned
 * days (the `planned` event) — stamped exactly as `historyLogSince` is.
 */
describe('stampPlanLogSince', () => {
  const PLAN = SETTING_KEYS.planLogSince
  const plan = async () => (await db.settings.get(PLAN))?.value

  it('stamps the row once, when it is absent, and keeps a stored row the store hasn’t read', async () => {
    const first = new Date('2026-11-24T09:00:00Z')
    await useSettingsStore.getState().stampPlanLogSince(first)
    expect(await plan()).toBe(first.toISOString())
    expect(useSettingsStore.getState().planLogSince).toEqual(first)
    await useSettingsStore.getState().stampPlanLogSince(new Date('2026-11-25T09:00:00Z'))
    expect(await plan()).toBe(first.toISOString())

    await resetDb()
    resetStores()
    await db.settings.put({ key: PLAN, value: '2026-10-01T00:00:00.000Z' })
    expect(useSettingsStore.getState().planLogSince).toBeNull()
    await useSettingsStore.getState().stampPlanLogSince(new Date('2026-11-24T09:00:00Z'))
    expect(await plan()).toBe('2026-10-01T00:00:00.000Z')
    expect(useSettingsStore.getState().planLogSince).toEqual(new Date('2026-10-01T00:00:00.000Z'))
  })

  it('loads with the settings and is sync-neutral', async () => {
    await db.settings.put({ key: PLAN, value: '2026-10-01T00:00:00.000Z' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().planLogSince).toEqual(new Date('2026-10-01T00:00:00.000Z'))
    expect(SYNC_NEUTRAL_SETTING_KEYS.has(PLAN)).toBe(true)
  })

  it('a data replace keeps the start the data brings, or starts the log now', async () => {
    await db.settings.put({ key: PLAN, value: '2026-07-01T00:00:00.000Z' })
    await refreshAllStores()
    expect(useSettingsStore.getState().planLogSince).toEqual(new Date('2026-07-01T00:00:00.000Z'))

    await resetDb()
    const before = Date.now()
    await refreshAllStores()
    const at = useSettingsStore.getState().planLogSince
    expect(at!.getTime()).toBeGreaterThanOrEqual(before)
    expect(await plan()).toBe(at!.toISOString())
  })
})
