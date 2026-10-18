import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SyncConflictDialog } from '../../../components/overlays/SyncConflictDialog'
import { FileUpgradeDialog } from '../../../components/overlays/FileUpgradeDialog'
import type { SyncConflictInfo } from '../../../services/file-storage'

afterEach(() => cleanup())

const info: SyncConflictInfo = {
  fileName: 'todo2-data.json',
  reason: 'browser-changes',
  browser: { taskCount: 12, schemaVersion: 49, unsyncedSince: '2026-10-02T09:00:00.000Z' },
  file: {
    taskCount: 10, schemaVersion: 48, savedAt: '2026-10-01T10:00:00.000Z',
    lastModified: '2026-10-01T10:00:00.000Z', changedSinceLastSync: true,
  },
}

describe('SyncConflictDialog', () => {
  it('shows both sides as cards, nothing picked; the one confirm is off until a card is picked', () => {
    const onChoose = vi.fn()
    render(<SyncConflictDialog info={info} onChoose={onChoose} />)

    const sides = screen.getByTestId('sync-conflict-sides')
    expect(sides).toHaveTextContent('12 tasks')
    expect(sides).toHaveTextContent('10 tasks')
    expect(sides).toHaveTextContent('Schema v48 (older format)')
    expect(screen.getByRole('dialog')).toHaveTextContent('the file was also changed elsewhere')
    expect(screen.getByRole('dialog')).toHaveTextContent('Nothing has changed yet')

    const group = screen.getByRole('radiogroup', { name: 'Version to keep' })
    expect(group).toBe(sides)
    const browser = screen.getByRole('radio', { name: /This browser/ })
    const file = screen.getByRole('radio', { name: /todo2-data\.json/ })
    expect(browser).not.toBeChecked()
    expect(file).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Pick a version' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()

    fireEvent.click(screen.getByText('This browser'))
    expect(browser).toBeChecked()
    expect(screen.getByRole('button', { name: 'Keep browser data' })).toBeEnabled()
    fireEvent.click(screen.getByText('todo2-data.json'))
    expect(file).toBeChecked()
    expect(browser).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Keep todo2-data.json' }))
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(['file'])
  })

  it('Keep browser data and Cancel (pause sync) map to their choices', () => {
    const onChoose = vi.fn()
    render(<SyncConflictDialog info={info} onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('radio', { name: /This browser/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep browser data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (pause sync)' }))
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(['browser', 'cancel'])
  })

  it('Escape cancels (stays paused)', () => {
    const onChoose = vi.fn()
    render(<SyncConflictDialog info={info} onChoose={onChoose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })
})

describe('FileUpgradeDialog', () => {
  it('confirms or cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<FileUpgradeDialog info={{ fileName: 'f.json', fromVersion: 49, toVersion: 50 }} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('schema v49')
    expect(screen.getByRole('dialog')).toHaveTextContent('A copy of the file as it is now is saved first')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (pause sync)' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
