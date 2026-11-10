import { describe, it, expect, beforeEach } from 'vitest'
import { layoutBodyOf } from '../../models/workspace-layout'
import { useWorkspaceStore, type ResizeHandle } from '../../stores/workspace-store'
import { readLayoutDraft } from '../../data/draft-storage'
import { resetDb } from '../helpers'

/**
 * A structural resize drag's preview (`resizePreview`, layout feedback item
 * 3): transient — set and cleared by the handle, a preview drawing the same
 * table changing nothing — and never an edit: the working copy, its unsaved
 * state and the kept draft stay as they are.
 */

const ws = () => useWorkspaceStore.getState()
const handle: ResizeHandle = { kind: 'divider', axis: 'columns', beforeId: 'a', afterId: 'b' }

describe('workspace-store resizePreview', () => {
  beforeEach(async () => {
    await resetDb()
    await ws().init()
  })

  it('is set and cleared without touching the working copy, its unsaved state or the kept draft', () => {
    const working = ws().working
    if (!working) throw new Error('no layout open')
    const draft = readLayoutDraft()
    const body = layoutBodyOf(working)
    ws().setResizePreview({ layoutId: working.id, body, handle })
    expect(ws().resizePreview?.body).toBe(body)
    expect(ws().working).toBe(working)
    expect(ws().isDirty).toBe(false)
    expect(readLayoutDraft()).toEqual(draft)
    ws().setResizePreview(null)
    expect(ws().resizePreview).toBeNull()
    expect(ws().working).toBe(working)
  })

  it('a preview drawing the same table as the current one changes nothing', () => {
    const working = ws().working
    if (!working) throw new Error('no layout open')
    ws().setResizePreview({ layoutId: working.id, body: layoutBodyOf(working), handle })
    const first = ws().resizePreview
    ws().setResizePreview({ layoutId: working.id, body: { grid: { ...working.grid }, cells: working.cells.map((c) => ({ ...c })) }, handle })
    expect(ws().resizePreview).toBe(first)
    ws().setResizePreview({ layoutId: working.id, body: layoutBodyOf(working), handle: { ...handle, afterId: 'c' } })
    expect(ws().resizePreview).not.toBe(first)
  })

  it('opening a layout drops it', async () => {
    const working = ws().working
    if (!working) throw new Error('no layout open')
    ws().setResizePreview({ layoutId: working.id, body: layoutBodyOf(working), handle })
    await ws().init()
    expect(ws().resizePreview).toBeNull()
  })
})
