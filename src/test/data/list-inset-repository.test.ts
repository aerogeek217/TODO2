import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listInsetRepository } from '../../data/list-inset-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('listInsetRepository', () => {
  function makeInset(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Due This Week',
      preset: 'due-this-week' as const,
      canvasId: 1,
      x: 100,
      y: 200,
      width: 300,
      height: 400,
      isCollapsed: false,
      ...overrides,
    }
  }

  it('insert and retrieve by canvas', async () => {
    await listInsetRepository.insert(makeInset())
    await listInsetRepository.insert(makeInset({ name: 'Starred', preset: 'starred', canvasId: 2 }))

    const insets = await listInsetRepository.getByCanvas(1)
    expect(insets).toHaveLength(1)
    expect(insets[0].name).toBe('Due This Week')
  })

  it('getById returns correct inset', async () => {
    const id = await listInsetRepository.insert(makeInset())
    const inset = await listInsetRepository.getById(id)
    expect(inset).toBeDefined()
    expect(inset!.preset).toBe('due-this-week')
  })

  it('update modifies fields', async () => {
    const id = await listInsetRepository.insert(makeInset())
    const inset = await listInsetRepository.getById(id)
    await listInsetRepository.update({ ...inset!, name: 'Updated', isCollapsed: true })

    const updated = await listInsetRepository.getById(id)
    expect(updated!.name).toBe('Updated')
    expect(updated!.isCollapsed).toBe(true)
  })

  it('updatePosition changes x, y', async () => {
    const id = await listInsetRepository.insert(makeInset())
    await listInsetRepository.updatePosition(id, 500, 600)

    const inset = await listInsetRepository.getById(id)
    expect(inset!.x).toBe(500)
    expect(inset!.y).toBe(600)
  })

  it('remove removes inset', async () => {
    const id = await listInsetRepository.insert(makeInset())
    await listInsetRepository.remove(id)
    expect(await listInsetRepository.getById(id)).toBeUndefined()
  })

  it('deleteByCanvas removes all for a canvas', async () => {
    await listInsetRepository.insert(makeInset())
    await listInsetRepository.insert(makeInset({ name: 'Starred', preset: 'starred' }))
    await listInsetRepository.insert(makeInset({ canvasId: 2 }))

    await listInsetRepository.deleteByCanvas(1)
    const remaining = await listInsetRepository.getByCanvas(1)
    expect(remaining).toHaveLength(0)
    const other = await listInsetRepository.getByCanvas(2)
    expect(other).toHaveLength(1)
  })
})
