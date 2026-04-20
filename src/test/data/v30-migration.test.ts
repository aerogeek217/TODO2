import { describe, it, expect, beforeEach } from 'vitest'
import { db, tagRailsTaskboardSlots, ensureSeededDefaultTaskboard } from '../../data/database'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('tagRailsTaskboardSlots', () => {
  it('adds taskboardId to every taskboard slot', () => {
    const input = JSON.stringify({
      left: { orientation: 'vertical', slots: [{ id: 's1', kind: 'taskboard' }] },
      right: { orientation: 'vertical', slots: [{ id: 's2', kind: 'lens', listDefinitionId: 1 }] },
      top: null,
      bottom: null,
    })
    const out = tagRailsTaskboardSlots(input, 7)
    const parsed = JSON.parse(out!)
    expect(parsed.left.slots[0].taskboardId).toBe(7)
    expect(parsed.right.slots[0].taskboardId).toBeUndefined()
  })

  it('leaves slots already carrying a taskboardId alone', () => {
    const input = JSON.stringify({
      left: { orientation: 'vertical', slots: [{ id: 's1', kind: 'taskboard', taskboardId: 99 }] },
      right: null, top: null, bottom: null,
    })
    const out = tagRailsTaskboardSlots(input, 7)
    expect(out).toBe(input)
  })

  it('returns the original value on invalid JSON', () => {
    expect(tagRailsTaskboardSlots('nope', 1)).toBe('nope')
    expect(tagRailsTaskboardSlots(undefined, 1)).toBeUndefined()
  })
})

describe('ensureSeededDefaultTaskboard', () => {
  it('creates a Default taskboard and writes the settings key', async () => {
    const id = await ensureSeededDefaultTaskboard(db.taskboards, db.settings, [
      { todoId: 10, sortOrder: 2000 },
      { todoId: 5, sortOrder: 1000 },
    ])
    const row = await db.taskboards.get(id)
    expect(row?.name).toBe('Default')
    expect(row?.entries.map((e) => e.todoId)).toEqual([5, 10])
    const setting = await db.settings.get('defaultTaskboardId')
    expect(setting?.value).toBe(String(id))
  })

  it('is idempotent — a second call returns the same id', async () => {
    const id1 = await ensureSeededDefaultTaskboard(db.taskboards, db.settings, [])
    const id2 = await ensureSeededDefaultTaskboard(db.taskboards, db.settings, [])
    expect(id2).toBe(id1)
    expect(await db.taskboards.count()).toBe(1)
  })

  it('repoints the setting at the first existing row when missing', async () => {
    const now = new Date()
    const id = await db.taskboards.add({ name: 'Already here', entries: [], createdAt: now, updatedAt: now })
    const returned = await ensureSeededDefaultTaskboard(db.taskboards, db.settings, [])
    expect(returned).toBe(id)
    const setting = await db.settings.get('defaultTaskboardId')
    expect(setting?.value).toBe(String(id))
  })
})
