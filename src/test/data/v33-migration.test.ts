import { describe, it, expect } from 'vitest'
import { coalesceTaskboardRows, stripRailsTaskboardIds } from '../../data/database'
import type { TaskboardEntry } from '../../models'

describe('coalesceTaskboardRows', () => {
  it('collapses multiple rows into one, deduping by todoId (first-seen order)', () => {
    const now = new Date()
    const rows = [
      { id: 2, entries: [{ todoId: 2, sortOrder: 2000 }] as TaskboardEntry[], createdAt: now, updatedAt: now },
      { id: 1, entries: [{ todoId: 1, sortOrder: 1000 }, { todoId: 2, sortOrder: 3000 }] as TaskboardEntry[], createdAt: now, updatedAt: now },
      { id: 3, entries: [{ todoId: 5, sortOrder: 1000 }] as TaskboardEntry[], createdAt: now, updatedAt: now },
    ]
    const { survivor, legacyIds } = coalesceTaskboardRows(rows)
    // id=1 wins (lowest), entries from id=1 come first, then new ones from id=2 (already had 2), then id=3.
    expect(survivor.id).toBe(1)
    expect(survivor.entries.map((e) => e.todoId)).toEqual([1, 2, 5])
    expect(legacyIds).toEqual([2, 3])
  })

  it('handles an empty input by returning an empty-entries survivor', () => {
    const { survivor, legacyIds } = coalesceTaskboardRows([])
    expect(survivor.entries).toEqual([])
    expect(legacyIds).toEqual([])
  })

  it('handles a single-row input as a no-op coalesce', () => {
    const now = new Date()
    const { survivor, legacyIds } = coalesceTaskboardRows([
      { id: 7, entries: [{ todoId: 1, sortOrder: 1000 }], createdAt: now, updatedAt: now },
    ])
    expect(survivor.id).toBe(7)
    expect(survivor.entries).toEqual([{ todoId: 1, sortOrder: 1000 }])
    expect(legacyIds).toEqual([])
  })
})

describe('stripRailsTaskboardIds', () => {
  it('removes taskboardId from tabs and legacy flat slots', () => {
    const input = JSON.stringify({
      left: { orientation: 'vertical', slots: [
        { id: 's1', kind: 'taskboard', taskboardId: 7 },
        { id: 's2', tabs: [{ id: 's2-t0', type: 'taskboard', taskboardId: 9 }], activeTabId: 's2-t0' },
      ] },
      right: null, top: null, bottom: null,
    })
    const out = stripRailsTaskboardIds(input)
    const parsed = JSON.parse(out!)
    expect(parsed.left.slots[0].taskboardId).toBeUndefined()
    expect(parsed.left.slots[1].tabs[0].taskboardId).toBeUndefined()
  })

  it('is a no-op when no taskboardId is present', () => {
    const input = JSON.stringify({
      left: { orientation: 'vertical', slots: [
        { id: 's1', tabs: [{ id: 's1-t0', type: 'lens', listDefinitionId: 1 }], activeTabId: 's1-t0' },
      ] },
      right: null, top: null, bottom: null,
    })
    expect(stripRailsTaskboardIds(input)).toBe(input)
  })

  it('returns the original value on invalid JSON', () => {
    expect(stripRailsTaskboardIds('nope')).toBe('nope')
    expect(stripRailsTaskboardIds(undefined)).toBeUndefined()
  })
})
