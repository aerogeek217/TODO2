import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { db } from '../../data/database'
import { SETTING_KEYS } from '../../data/setting-keys'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useFileStorageStore } from '../../services/file-storage-store'
import { fileStorageService, type SyncConflictInfo } from '../../services/file-storage'
import { backupScheduler } from '../../data/backup-scheduler'
import { expiredCompletedUids, recordPurgePromptShown } from '../../services/purge-completed'
import { runAppStartup } from '../../services/app-startup'
import { nextPurgePromptDay } from '../../utils/completed-at'
import { StartupPurgePrompt } from '../../components/overlays/StartupPurgePrompt'
import { CompletedTasksSection } from '../../components/settings/sections/CompletedTasksSection'
import { makeTodo, resetDb } from '../helpers'

// The launch prompt about old completed tasks asks at most once every N
// days (Settings › Tasks › Completed tasks, 7 by default), counted from the
// day it last showed, whatever was answered.

const DAY = 86_400_000
let expiredUid = ''

beforeEach(async () => {
  await resetDb()
  const old = new Date(Date.now() - 90 * DAY)
  const todo = makeTodo({ id: 1, title: 'Old done', isCompleted: true, completedAt: old, createdAt: old, modifiedAt: old })
  expiredUid = todo.uid
  await db.todos.add(todo)
  await db.settings.put({ key: SETTING_KEYS.completedRetentionDays, value: '30' })
  await useSettingsStore.getState().load()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('nextPurgePromptDay', () => {
  const at = (s: string) => new Date(s)
  it('null (ask now) when it never showed, or the interval’s calendar days have passed', () => {
    expect(nextPurgePromptDay(null, 7, at('2026-10-20T09:00'))).toBeNull()
    // Shown late on the 13th: the 20th is 7 calendar days on, whatever the hour.
    expect(nextPurgePromptDay(at('2026-10-13T23:30'), 7, at('2026-10-20T00:05'))).toBeNull()
    expect(nextPurgePromptDay(at('2026-10-13T08:00'), 7, at('2026-10-25T08:00'))).toBeNull()
  })

  it('the day it may ask again while the interval runs', () => {
    expect(nextPurgePromptDay(at('2026-10-13T08:00'), 7, at('2026-10-19T23:59'))).toEqual(at('2026-10-20T00:00'))
    expect(nextPurgePromptDay(at('2026-10-20T08:00'), 7, at('2026-10-20T18:00'))).toEqual(at('2026-10-27T00:00'))
    expect(nextPurgePromptDay(at('2026-10-20T08:00'), 1, at('2026-10-20T18:00'))).toEqual(at('2026-10-21T00:00'))
  })

  it('a stamp after today (a clock set back) isn’t trusted: ask now', () => {
    expect(nextPurgePromptDay(at('2026-11-30T08:00'), 7, at('2026-10-20T08:00'))).toBeNull()
    expect(nextPurgePromptDay(new Date(Number.NaN), 7, at('2026-10-20T08:00'))).toBeNull()
  })
})

describe('the purge check (launch, and after a sync-file load)', () => {
  it('finds the expired tasks while the prompt never showed, or showed the interval ago', async () => {
    expect(await expiredCompletedUids()).toEqual(new Set([expiredUid]))
    useSettingsStore.setState({ purgePromptLastAt: new Date(Date.now() - 7 * DAY) })
    expect(await expiredCompletedUids()).toEqual(new Set([expiredUid]))
  })

  it('skips while the prompt showed less than the interval ago, whatever the interval', async () => {
    useSettingsStore.setState({ purgePromptLastAt: new Date(Date.now() - 6 * DAY) })
    expect(await expiredCompletedUids()).toBeNull()
    useSettingsStore.setState({ purgePromptIntervalDays: 30, purgePromptLastAt: new Date(Date.now() - 20 * DAY) })
    expect(await expiredCompletedUids()).toBeNull()
    useSettingsStore.setState({ purgePromptIntervalDays: 14 })
    expect(await expiredCompletedUids()).toEqual(new Set([expiredUid]))
  })

  it('launch: no prompt to show while inside the interval (read from the stored setting)', async () => {
    vi.spyOn(fileStorageService, 'initialize').mockResolvedValue(undefined)
    vi.spyOn(backupScheduler, 'start').mockImplementation(() => {})
    await db.settings.put({ key: SETTING_KEYS.purgePromptLastAt, value: new Date(Date.now() - 2 * DAY).toISOString() })
    await expect(runAppStartup()).resolves.toEqual({ expiredUids: null })
    await db.settings.put({ key: SETTING_KEYS.purgePromptLastAt, value: new Date(Date.now() - 8 * DAY).toISOString() })
    await expect(runAppStartup()).resolves.toEqual({ expiredUids: new Set([expiredUid]) })
  })

  it('after a file load: the loaded data’s stamp counts (the settings reload first)', async () => {
    useSettingsStore.setState({ purgePromptLastAt: new Date() })
    expect(await expiredCompletedUids()).toBeNull()
    // The file's data says it never showed.
    await db.settings.delete(SETTING_KEYS.purgePromptLastAt)
    await useSettingsStore.getState().load()
    expect(await expiredCompletedUids()).toEqual(new Set([expiredUid]))
  })

  it('recordPurgePromptShown stamps the setting, with no undo step and no notice', async () => {
    useUndoStore.getState().clear()
    const now = new Date('2026-10-20T08:00:00.000Z')
    await recordPurgePromptShown(now)
    expect(useSettingsStore.getState().purgePromptLastAt).toEqual(now)
    expect((await db.settings.get(SETTING_KEYS.purgePromptLastAt))?.value).toBe(now.toISOString())
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })
})

describe('StartupPurgePrompt — the stamp is the showing', () => {
  it('stamps when the prompt shows; Not now doesn’t clear it', async () => {
    const onClose = vi.fn()
    const before = Date.now()
    render(<StartupPurgePrompt launchUids={new Set([expiredUid])} onClose={onClose} />)
    await screen.findByRole('dialog', { name: 'Delete 1 old completed task?' })
    await waitFor(() => expect(useSettingsStore.getState().purgePromptLastAt).not.toBeNull())
    expect(useSettingsStore.getState().purgePromptLastAt!.getTime()).toBeGreaterThanOrEqual(before)
    await waitFor(async () => expect(await db.settings.get(SETTING_KEYS.purgePromptLastAt)).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalled()
    expect(useSettingsStore.getState().purgePromptLastAt).not.toBeNull()
  })

  it('no stamp while it waits behind a sync-file prompt, or when nothing is left to ask about', async () => {
    act(() => useFileStorageStore.setState({ pendingConflict: { fileName: 'f.json' } as unknown as SyncConflictInfo }))
    const view = render(<StartupPurgePrompt launchUids={new Set([expiredUid])} onClose={vi.fn()} />)
    // Let the effects and the database read run.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useSettingsStore.getState().purgePromptLastAt).toBeNull()
    view.unmount()

    act(() => useFileStorageStore.setState({ pendingConflict: null }))
    await db.todos.clear()
    useTodoStore.setState({ todosVersion: useTodoStore.getState().todosVersion + 1 })
    render(<StartupPurgePrompt launchUids={new Set([expiredUid])} onClose={vi.fn()} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useSettingsStore.getState().purgePromptLastAt).toBeNull()
    expect(await db.settings.get(SETTING_KEYS.purgePromptLastAt)).toBeUndefined()
  })
})

describe('Settings › Completed tasks — Ask at most every', () => {
  it('shown only while retention is on; 7 by default; a whole number 1–365 commits on Enter, anything else reverts', async () => {
    useSettingsStore.setState({ completedRetentionDays: null })
    const view = render(<CompletedTasksSection />)
    expect(screen.queryByRole('spinbutton', { name: 'Ask at most every (days)' })).toBeNull()
    act(() => useSettingsStore.setState({ completedRetentionDays: 30 }))
    const input = screen.getByRole('spinbutton', { name: 'Ask at most every (days)' })
    expect(input).toHaveValue(7)

    fireEvent.change(input, { target: { value: '14' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await waitFor(() => expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(14))
    await waitFor(async () => expect((await db.settings.get(SETTING_KEYS.purgePromptIntervalDays))?.value).toBe('14'))
    await waitFor(() => expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Ask about old completed tasks at most every 14 days'))

    for (const bad of ['0', '366', '2.5', '']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.blur(input)
      expect(input).toHaveValue(14)
    }
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(14)
    view.unmount()
  })

  it('the past-retention line says when the prompt will ask, inside the interval', () => {
    useSettingsStore.setState({ completedRetentionDays: 30 })
    useTodoStore.setState({ todos: [makeTodo({ id: 1, isCompleted: true, completedAt: new Date(Date.now() - 90 * DAY) })] })
    const view = render(<CompletedTasksSection />)
    expect(screen.getByText(/1 completed task past retention \(you'll be asked on next launch\)/)).toBeInTheDocument()
    view.unmount()

    const shown = new Date(Date.now() - 2 * DAY)
    useSettingsStore.setState({ purgePromptLastAt: shown })
    render(<CompletedTasksSection />)
    const from = new Date(shown.getFullYear(), shown.getMonth(), shown.getDate() + 7)
    const label = from.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(from.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
    expect(screen.getByText(`1 completed task past retention (you'll be asked at a launch from ${label})`)).toBeInTheDocument()
  })
})
