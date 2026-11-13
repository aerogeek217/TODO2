import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useUndoStore } from '../../stores/undo-store'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { cleanup } from '@testing-library/react'
import { emptyBody, single } from '../helpers/layout-builders'

// A layout write that fails (e.g. browser storage full) must not pass
// silently (the Couldn't save · Retry control, the notice), lose what is on
// screen, nor reject into the `void` callers (edits, layout menu, rename /
// duplicate dialogs, tab clicks). Every failed-write case of the store is
// here (undo after one, with a list tab: `layout-owned-lists.test.ts`).

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const notice = () => useUndoStore.getState().snackbar?.description

async function openPlain(): Promise<number> {
  const id = await layoutRepository.insert({
    name: 'Plain', createdAt: T0, modifiedAt: T0,
    ...single({ id: 'kp', activeTabId: 'p1', tabs: [createTab('notes', 'p1'), createTab('calendar', 'p2')] }),
  })
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

/** A second, empty layout (not open). */
async function second(): Promise<number> {
  return layoutRepository.insert({ name: 'Second', createdAt: T0, modifiedAt: T0, ...emptyBody() })
}

/** Layout `id` as stored, once the writes in flight have run. */
async function storedLayout(id: number): Promise<PersistedWorkspaceLayout> {
  await settleLayoutWrites()
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

/** The tab ids of layout `id`'s cell `kp`, as stored. */
const storedTabs = async (id: number) => (await storedLayout(id)).cells.find((c) => c.id === 'kp')?.tabs.map((t) => t.id)

function quiet() {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

function failWrites() {
  quiet()
  const err = new DOMException('full', 'QuotaExceededError')
  vi.spyOn(layoutRepository, 'putAndPrune').mockRejectedValue(err)
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
  it('an edit whose write fails stays on screen, marks the layout and says so; the stored row is untouched', async () => {
    const id = await openPlain()
    failWrites()
    ws().closeTab('p2')
    await settleLayoutWrites()
    expect(ws().writeFailed).toBe(true)
    expect(ws().working?.cells[0]?.tabs).toHaveLength(1)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn\'t save layout "Plain".', notice: true })
    expect(await storedTabs(id)).toEqual(['p1', 'p2'])
  })

  it('an edit whose write lands leaves the layout unmarked', async () => {
    await openPlain()
    ws().closeTab('p2')
    await settleLayoutWrites()
    expect(ws().writeFailed).toBe(false)
  })

  it('Retry resolves false while the write still fails, true once it lands', async () => {
    const id = await openPlain()
    failWrites()
    ws().closeTab('p2')
    await settleLayoutWrites()
    await expect(ws().retryWrite()).resolves.toBe(false)
    expect(ws().writeFailed).toBe(true)
    vi.mocked(layoutRepository.putAndPrune).mockRestore()
    await expect(ws().retryWrite()).resolves.toBe(true)
    expect(ws().writeFailed).toBe(false)
    expect(await storedTabs(id)).toEqual(['p1'])
  })

  it('the next edit that lands writes the whole layout, and clears the mark', async () => {
    const id = await openPlain()
    failWrites()
    ws().closeTab('p2')
    await settleLayoutWrites()
    vi.mocked(layoutRepository.putAndPrune).mockRestore()
    ws().splitCell('kp', 'right')
    await settleLayoutWrites()
    expect(ws().writeFailed).toBe(false)
    expect((await storedLayout(id)).cells).toHaveLength(2)
    expect(await storedTabs(id)).toEqual(['p1'])
  })

  it('Duplicate layout resolves null and says so; the open layout stays as it was', async () => {
    const id = await openPlain()
    failWrites()
    await expect(ws().duplicateLayout('Copy')).resolves.toBeNull()
    expect(ws().activeLayoutId).toBe(id)
    expect(notice()).toBe('Couldn\'t duplicate layout "Plain".')
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
    expect(ws().working?.cells[0]?.activeTabId).toBe('p2')
  })
})

describe('switching or deleting a layout when a write fails (cr31 L10)', () => {
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

describe('leaving a layout whose write failed', () => {
  const STAY = 'Couldn\'t save layout "Plain". Retry before leaving it, or its last changes are lost.'

  it('stays on it instead of switching (which would drop its last changes), and says so; the layout tab shows Couldn’t save · Retry', async () => {
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react')
    const { LayoutControls } = await import('../../components/workspace/LayoutControls')
    const plain = await openPlain()
    const other = await second()
    await ws().init()
    failWrites()
    ws().closeTab('p2')
    await settleLayoutWrites()
    render(<LayoutControls mode="tabs" />)
    const retry = screen.getByTestId('layout-write-failed')
    expect(retry).toHaveTextContent('Couldn’t save·Retry')
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(plain)
    expect(notice()).toBe(STAY)
    vi.mocked(layoutRepository.putAndPrune).mockRestore()
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByTestId('layout-write-failed')).toBeNull())
    expect(ws().writeFailed).toBe(false)
  })

  it('a switch and a new layout try the write again first; once it lands, the switch goes through with the edit stored', async () => {
    const plain = await openPlain()
    const other = await second()
    await ws().init()
    failWrites()
    ws().closeTab('p2')
    await settleLayoutWrites()
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(plain)
    expect(notice()).toBe(STAY)
    expect(await ws().createLayout('New')).toBeNull()
    expect(ws().activeLayoutId).toBe(plain)
    vi.restoreAllMocks()
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(other)
    expect(await storedTabs(plain)).toEqual(['p1'])
  })
})

describe('leaving a layout while its write is still running (cr34 D5)', () => {
  const STAY = 'Couldn\'t save layout "Plain". Retry before leaving it, or its last changes are lost.'

  /** The open layout with an edit whose write hasn't run yet, and a second layout to leave for. */
  async function editInFlight(): Promise<{ plain: number; other: number }> {
    const plain = await openPlain()
    const other = await second()
    await ws().init()
    return { plain, other }
  }

  it('a switch waits for the write: when it fails (and fails again), the layout stays open, marked, with the edit on screen', async () => {
    const { plain, other } = await editInFlight()
    failWrites()
    ws().closeTab('p2')
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(plain)
    expect(ws().writeFailed).toBe(true)
    expect(ws().working?.cells[0]?.tabs).toHaveLength(1)
    expect(notice()).toBe(STAY)
  })

  it('a write that fails once is written again before the switch: the edit is stored, not lost', async () => {
    const { plain, other } = await editInFlight()
    quiet()
    vi.spyOn(layoutRepository, 'putAndPrune').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    ws().closeTab('p2')
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(other)
    expect(ws().writeFailed).toBe(false)
    expect(await storedTabs(plain)).toEqual(['p1'])
  })

  it('New layout and Duplicate layout wait for it too', async () => {
    const { plain } = await editInFlight()
    quiet()
    const put = vi.spyOn(layoutRepository, 'putAndPrune').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    ws().closeTab('p2')
    expect(await ws().createLayout('New')).toBeNull()
    expect(notice()).toBe(STAY)
    expect(await ws().duplicateLayout('Copy')).toBeNull()
    expect(ws().activeLayoutId).toBe(plain)
    expect(await db.layouts.count()).toBe(2)
    put.mockRestore()
    const copy = await ws().duplicateLayout('Copy')
    expect(copy).not.toBeNull()
    expect(await storedTabs(plain)).toEqual(['p1'])
    expect(await storedTabs(copy!)).toEqual(['p1'])
  })

  it('a write that lands lets the switch through as before', async () => {
    const { plain, other } = await editInFlight()
    ws().closeTab('p2')
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(other)
    expect(await storedTabs(plain)).toEqual(['p1'])
  })
})
