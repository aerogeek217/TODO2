import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUndoStore } from '../../stores/undo-store'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { cleanup } from '@testing-library/react'
import { rowOf } from '../helpers/layout-builders'

// A layout write that fails (e.g. browser storage full) must not leave the
// workspace saying the layout is saved, nor reject into the `void` callers
// (Save button, layout menu, rename / save-as dialogs, tab clicks).

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const notice = () => useUndoStore.getState().snackbar?.description

async function openPlain(): Promise<number> {
  const id = await layoutRepository.insert({
    name: 'Plain', createdAt: T0, modifiedAt: T0,
    columns: [{ id: 'P', weight: 1, rows: [rowOf({ id: 'kp', weight: 1, activeTabId: 'p1', tabs: [createTab('notes', 'p1'), createTab('calendar', 'p2')] })] }],
  })
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

function failWrites() {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const err = new DOMException('full', 'QuotaExceededError')
  vi.spyOn(layoutRepository, 'put').mockRejectedValue(err)
  vi.spyOn(layoutRepository, 'insert').mockRejectedValue(err)
  vi.spyOn(layoutRepository, 'rename').mockRejectedValue(err)
}

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('workspace layout writes that fail', () => {
  it('Save keeps the layout unsaved, resolves false and says so', async () => {
    const id = await openPlain()
    ws().closeTab('p2')
    expect(ws().isDirty).toBe(true)
    failWrites()
    await expect(ws().save()).resolves.toBe(false)
    expect(ws().isDirty).toBe(true)
    expect(ws().saved?.columns[0]?.rows[0]?.cells[0]?.tabs).toHaveLength(2)
    expect(notice()).toBe('Couldn\'t save layout "Plain".')
    expect(((await db.layouts.get(id)) as PersistedWorkspaceLayout).columns[0]?.rows[0]?.cells[0]?.tabs).toHaveLength(2)
  })

  it('Save that works resolves true and marks the layout saved', async () => {
    await openPlain()
    ws().closeTab('p2')
    await expect(ws().save()).resolves.toBe(true)
    expect(ws().isDirty).toBe(false)
  })

  it('an edit made while Save writes stays unsaved', async () => {
    await openPlain()
    ws().closeTab('p2')
    let release: () => void = () => {}
    const put = layoutRepository.put.bind(layoutRepository)
    vi.spyOn(layoutRepository, 'put').mockImplementation(async (l) => {
      await new Promise<void>((r) => { release = r })
      return put(l)
    })
    const saving = ws().save()
    await vi.waitFor(() => expect(layoutRepository.put).toHaveBeenCalled())
    ws().changeTabKind('p1', 'calendar')
    release()
    await expect(saving).resolves.toBe(true)
    expect(ws().isDirty).toBe(true)
  })

  it('Save as resolves null and says so; the open layout stays as it was', async () => {
    const id = await openPlain()
    failWrites()
    await expect(ws().saveAs('Copy')).resolves.toBeNull()
    expect(ws().activeLayoutId).toBe(id)
    expect(notice()).toBe('Couldn\'t save layout "Copy".')
  })

  it('Rename resolves false and keeps the old name', async () => {
    const id = await openPlain()
    failWrites()
    await expect(ws().rename(id, 'Renamed')).resolves.toBe(false)
    expect(ws().saved?.name).toBe('Plain')
    expect(ws().layouts.find((l) => l.id === id)?.name).toBe('Plain')
    expect(notice()).toBe('Couldn\'t rename layout "Plain".')
  })

  it('a view-state write (switching tab) that fails does not reject; the tab still switches', async () => {
    await openPlain()
    failWrites()
    await expect(ws().setActiveTab('p2')).resolves.toBeUndefined()
    expect(ws().working?.columns[0]?.rows[0]?.cells[0]?.activeTabId).toBe('p2')
  })
})

describe('switching or deleting a layout when a write fails (cr31 L10)', () => {
  async function second(): Promise<number> {
    return layoutRepository.insert({ name: 'Second', createdAt: T0, modifiedAt: T0, columns: [] })
  }

  it('a switch that fails does not reject, says so, and keeps the open layout', async () => {
    const plain = await openPlain()
    const other = await second()
    await ws().init()
    failWrites()
    vi.spyOn(layoutRepository, 'touch').mockRejectedValue(new Error('full'))
    await expect(ws().load(other)).resolves.toBeUndefined()
    expect(ws().activeLayoutId).toBe(plain)
    expect(notice()).toBe('Couldn\'t open layout "Second".')
  })

  it('a delete that fails does not reject, resolves false and says so', async () => {
    const plain = await openPlain()
    await second()
    await ws().init()
    failWrites()
    vi.spyOn(layoutRepository, 'deleteUnlessLast').mockRejectedValue(new Error('full'))
    await expect(ws().delete(plain)).resolves.toBe(false)
    expect(ws().layouts.map((l) => l.id)).toContain(plain)
    expect(notice()).toBe('Couldn\'t delete layout "Plain".')
  })

  it('a delete of the open layout whose next layout won’t open still drops its tab and says so', async () => {
    const plain = await openPlain()
    await second()
    await ws().init()
    failWrites()
    vi.spyOn(layoutRepository, 'touch').mockRejectedValue(new Error('full'))
    await expect(ws().delete(plain)).resolves.toBe(true)
    expect(await db.layouts.get(plain)).toBeUndefined()
    expect(ws().layouts.map((l) => l.id)).not.toContain(plain)
    expect(notice()).toBe('Deleted layout "Plain", but couldn\'t open another. Reload the page.')
  })
})

describe('the unsaved-changes prompt when Save fails', () => {
  it('stays open instead of carrying on (which would drop the layout)', async () => {
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react')
    const { UnsavedPrompt } = await import('../../components/workspace/UnsavedPrompt')
    await openPlain()
    ws().closeTab('p2')
    failWrites()
    const onDone = vi.fn()
    render(<UnsavedPrompt lead="You’re switching." layout listIds={[]} onDone={onDone} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(notice()).toBe('Couldn\'t save layout "Plain".'))
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeInTheDocument()
  })
})
