import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { PurgeCompletedDialog } from '../../../components/overlays/PurgeCompletedDialog'
import { UndoSnackbar } from '../../../components/overlays/UndoSnackbar'
import { db } from '../../../data/database'
import { backupScheduler } from '../../../data/backup-scheduler'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import type { PersistedTodoItem } from '../../../models'
import { makeTodo, resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useUndoStore.getState().clear()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  useUndoStore.getState().clear()
  vi.restoreAllMocks()
})

async function oldDone(): Promise<PersistedTodoItem> {
  const todo = makeTodo({ id: 1, title: 'Old done', isCompleted: true, completedAt: new Date(2026, 0, 1) })
  await db.todos.add(todo)
  return todo as PersistedTodoItem
}

describe('PurgeCompletedDialog — Delete when the backup fails', () => {
  it('Continue deletes, and the snackbar says no backup was taken (the strip is desktop-only)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    const onDone = vi.fn()
    render(
      <>
        <PurgeCompletedDialog tasks={[await oldDone()]} retentionDays={30} onDone={onDone} onDismiss={vi.fn()} />
        <UndoSnackbar />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    act(() => useUIStore.getState().answerConfirmation(true))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(await db.todos.count()).toBe(0)
    expect(screen.getByText('Deleted 1 completed task. No backup was taken.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('Cancel keeps the task and says so in the dialog; no snackbar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    const onDone = vi.fn()
    render(<PurgeCompletedDialog tasks={[await oldDone()]} retentionDays={30} onDone={onDone} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    act(() => useUIStore.getState().answerConfirmation(false))

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was deleted — the backup could not be saved.')
    expect(onDone).not.toHaveBeenCalled()
    expect(await db.todos.count()).toBe(1)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('with a backup, Delete shows no notice', async () => {
    const onDone = vi.fn()
    render(<PurgeCompletedDialog tasks={[await oldDone()]} retentionDays={30} onDone={onDone} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(useUndoStore.getState().snackbar).toBeNull()
  })
})
