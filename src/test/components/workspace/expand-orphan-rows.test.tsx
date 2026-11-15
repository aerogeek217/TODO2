import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { db } from '../../../data/database'
import { layoutRepository } from '../../../data/layout-repository'
import { useExpandOrphanRows } from '../../../components/workspace/use-expand-orphan-rows'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../../models/workspace-layout'
import { orphanCollapsedRows } from '../../../utils/workspace-grid'
import { resetDb } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * cr34 M8: a layout stored with a collapsed row nothing can expand — as the
 * ops left it before they expanded such a row themselves — comes right when
 * the workspace next shows it: the row expands, as view state.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const filled = (id: string) => cell(id, [createTab('notes', `${id}-t`)])
const [p, s, a, t2] = [filled('p'), filled('s'), filled('a'), filled('t2')]

/**
 * p s
 * a s    — the middle row folded, as Collapse row, Close and Close left it
 * a t2     (the review's probe): a and s both reach out of it.
 */
function orphaned(): LayoutBody {
  return grid([[p, s], [a, s], [a, t2]], { rows: [1000, { weight: 1000, collapsed: true }, 1000] })
}

/** A filled cell of its own in the folded row: it can expand it. */
function held(): LayoutBody {
  return grid([[p, s], [a, filled('b')], [a, t2]], { rows: [1000, { weight: 1000, collapsed: true }, 1000] })
}

function stored(body: LayoutBody): Omit<WorkspaceLayout, 'id'> {
  return { sortOrder: 0, name: 'Main', createdAt: T0, modifiedAt: T0, ...body }
}

const ws = () => useWorkspaceStore.getState()
const collapsed = (body: LayoutBody | null | undefined) => body?.grid.rows.map((t) => t.collapsed === true)

async function open(body: LayoutBody): Promise<number> {
  const id = await layoutRepository.insert(stored(body))
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

async function shown(): Promise<void> {
  await act(async () => {
    renderHook(() => useExpandOrphanRows(ws().working as PersistedWorkspaceLayout))
    await Promise.resolve()
  })
}

beforeEach(async () => {
  await resetDb()
})

afterEach(cleanup)

describe('a stored layout with a collapsed row nothing can expand', () => {
  it('is opened as stored: the read repairs nothing (a valid row), so the orphan arrives', async () => {
    const id = await open(orphaned())
    expect((await layoutRepository.get(id))?.fixes).toEqual([])
    expect(collapsed(ws().working)).toEqual([false, true, false])
    expect(orphanCollapsedRows(ws().working as LayoutBody)).toEqual([1])
  })

  it('expands when the workspace shows it — the working copy, the saved one and the stored row — with no undo step', async () => {
    const id = await open(orphaned())
    await shown()
    expect(collapsed(ws().working)).toEqual([false, false, false])
    expect(collapsed(ws().saved)).toEqual([false, false, false])
    await expect.poll(async () => collapsed((await db.layouts.get(id)) as LayoutBody | undefined)).toEqual([false, false, false])
    expect(layoutSteps()).toEqual([])
    // Its weight is its own again: nothing else about the row changed.
    expect(ws().working?.grid.rows[1]).toEqual({ id: 'r2', weight: 1000 })
  })

  it('leaves a collapsed row with a filled cell of its own alone', async () => {
    const id = await open(held())
    await shown()
    expect(collapsed(ws().working)).toEqual([false, true, false])
    expect(collapsed((await db.layouts.get(id)) as LayoutBody | undefined)).toEqual([false, true, false])
  })
})
