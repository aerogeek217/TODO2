import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useListInsetStore } from '../../stores/list-inset-store'
import { listInsetRepository } from '../../data/list-inset-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useListInsetStore.setState({ insets: [], loading: false, error: null })
})

describe('useListInsetStore', () => {
  describe('loadByCanvas', () => {
    it('loadByCanvas_withMatchingInsets_loadsInsetsForCanvas', async () => {
      // Arrange
      await db.listInsets.bulkAdd([
        { listDefinitionId: 1, canvasId: 1, x: 0, y: 0, width: 280, height: 300, isCollapsed: false },
        { listDefinitionId: 2, canvasId: 1, x: 300, y: 0, width: 280, height: 300, isCollapsed: false },
        { listDefinitionId: 3, canvasId: 99, x: 0, y: 0, width: 280, height: 300, isCollapsed: false },
      ])

      // Act
      await useListInsetStore.getState().loadByCanvas(1)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(2)
      expect(insets.map((i) => i.listDefinitionId).sort()).toEqual([1, 2])
    })

    it('loadByCanvas_withUnknownCanvasId_returnsEmptyArray', async () => {
      await useListInsetStore.getState().loadByCanvas(42)
      expect(useListInsetStore.getState().insets).toHaveLength(0)
    })

    it('loadByCanvas_setsLoadingFalseAfterCompletion', async () => {
      await useListInsetStore.getState().loadByCanvas(1)
      expect(useListInsetStore.getState().loading).toBe(false)
    })
  })

  describe('add', () => {
    it('add_withValidArgs_createsInsetWithDefaultDimensions', async () => {
      // Act
      const id = await useListInsetStore.getState().add(5, 1, 100, 200)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(1)
      const inset = insets[0]!
      expect(inset.id).toBe(id)
      expect(inset.listDefinitionId).toBe(5)
      expect(inset.canvasId).toBe(1)
      expect(inset.x).toBe(100)
      expect(inset.y).toBe(200)
      expect(inset.width).toBe(320)
      expect(inset.height).toBe(300)
      expect(inset.isCollapsed).toBe(false)
    })

    it('add_withValidArgs_persistsInsetToDatabase', async () => {
      const id = await useListInsetStore.getState().add(9, 5, 0, 0)
      const row = await db.listInsets.get(id)
      expect(row).toBeDefined()
      expect(row!.listDefinitionId).toBe(9)
      expect(row!.canvasId).toBe(5)
    })

    it('add_multipleInsets_appendsAllToState', async () => {
      await useListInsetStore.getState().add(1, 1, 0, 0)
      await useListInsetStore.getState().add(2, 1, 300, 0)
      expect(useListInsetStore.getState().insets).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('update_existingInset_updatesStateAndDatabase', async () => {
      const id = await useListInsetStore.getState().add(1, 1, 0, 0)
      const original = useListInsetStore.getState().insets.find((i) => i.id === id)!

      const updated = { ...original, isCollapsed: true, width: 400 }
      await useListInsetStore.getState().update(updated)

      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.isCollapsed).toBe(true)
      expect(found!.width).toBe(400)

      const row = await db.listInsets.get(id)
      expect(row!.isCollapsed).toBe(true)
    })

    it('update_existingInset_doesNotAffectOtherInsets', async () => {
      const id1 = await useListInsetStore.getState().add(1, 1, 0, 0)
      const id2 = await useListInsetStore.getState().add(2, 1, 300, 0)
      const target = useListInsetStore.getState().insets.find((i) => i.id === id1)!

      await useListInsetStore.getState().update({ ...target, width: 500 })

      const other = useListInsetStore.getState().insets.find((i) => i.id === id2)
      expect(other!.width).toBe(320)
    })

    it('update_runtimeFilterValueExplicitUndefined_clearsPriorPickInState', async () => {
      // Regression: an empty/cleared runtime filter must propagate through
      // the in-memory store. `updateItemInList` spread-merges, so a key
      // absent from the patch is preserved from the prior item — the caller
      // must pass `undefined` explicitly to overwrite the stale array.
      const id = await useListInsetStore.getState().add(1, 1, 0, 0)
      const original = useListInsetStore.getState().insets.find((i) => i.id === id)!

      await useListInsetStore.getState().update({ ...original, runtimeFilterValue: [7, 9] })
      expect(useListInsetStore.getState().insets.find((i) => i.id === id)!.runtimeFilterValue).toEqual([7, 9])

      const withPick = useListInsetStore.getState().insets.find((i) => i.id === id)!
      await useListInsetStore.getState().update({ ...withPick, runtimeFilterValue: undefined })

      const cleared = useListInsetStore.getState().insets.find((i) => i.id === id)!
      expect(cleared.runtimeFilterValue).toBeUndefined()
    })
  })

  describe('updatePosition', () => {
    it('updatePosition_existingInset_updatesXYInStateAndDatabase', async () => {
      const id = await useListInsetStore.getState().add(1, 1, 0, 0)
      await useListInsetStore.getState().updatePosition(id, 150, 250)

      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.x).toBe(150)
      expect(found!.y).toBe(250)

      const row = await db.listInsets.get(id)
      expect(row!.x).toBe(150)
      expect(row!.y).toBe(250)
    })

    it('updatePosition_existingInset_preservesOtherFields', async () => {
      const id = await useListInsetStore.getState().add(4, 1, 0, 0)
      await useListInsetStore.getState().updatePosition(id, 50, 75)

      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.listDefinitionId).toBe(4)
      expect(found!.width).toBe(320)
      expect(found!.height).toBe(300)
    })
  })

  describe('remove', () => {
    it('remove_existingInset_removesFromStateAndDatabase', async () => {
      const id = await useListInsetStore.getState().add(1, 1, 0, 0)
      await useListInsetStore.getState().remove(id)
      expect(useListInsetStore.getState().insets).toHaveLength(0)
      expect(await db.listInsets.get(id)).toBeUndefined()
    })

    it('remove_oneOfMultipleInsets_onlyRemovesTarget', async () => {
      const id1 = await useListInsetStore.getState().add(1, 1, 0, 0)
      const id2 = await useListInsetStore.getState().add(2, 1, 300, 0)
      await useListInsetStore.getState().remove(id2)
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(1)
      expect(insets[0]!.id).toBe(id1)
    })
  })

  describe('optimistic rollback', () => {
    it('updatePosition_dbRejects_revertsPositionToOriginal', async () => {
      const id = await useListInsetStore.getState().add(1, 1, 50, 75)
      const spy = vi.spyOn(listInsetRepository, 'updatePosition').mockRejectedValueOnce(new Error('DB error'))

      await expect(useListInsetStore.getState().updatePosition(id, 999, 999)).rejects.toThrow('DB error')

      const inset = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(inset!.x).toBe(50)
      expect(inset!.y).toBe(75)
      expect(useListInsetStore.getState().error).toBeTruthy()

      spy.mockRestore()
    })
  })
})
