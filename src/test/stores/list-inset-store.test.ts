import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useListInsetStore } from '../../stores/list-inset-store'

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
        { name: 'This Week', preset: 'due-this-week', canvasId: 1, x: 0, y: 0, width: 280, height: 300, isCollapsed: false },
        { name: 'Starred', preset: 'starred', canvasId: 1, x: 300, y: 0, width: 280, height: 300, isCollapsed: false },
        { name: 'Other Canvas', preset: 'high-priority', canvasId: 99, x: 0, y: 0, width: 280, height: 300, isCollapsed: false },
      ])

      // Act
      await useListInsetStore.getState().loadByCanvas(1)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(2)
      expect(insets.map((i) => i.name)).toEqual(expect.arrayContaining(['This Week', 'Starred']))
    })

    it('loadByCanvas_withUnknownCanvasId_returnsEmptyArray', async () => {
      // Arrange — no data seeded for canvas 42

      // Act
      await useListInsetStore.getState().loadByCanvas(42)

      // Assert
      expect(useListInsetStore.getState().insets).toHaveLength(0)
    })

    it('loadByCanvas_setsLoadingFalseAfterCompletion', async () => {
      // Act
      await useListInsetStore.getState().loadByCanvas(1)

      // Assert
      expect(useListInsetStore.getState().loading).toBe(false)
    })
  })

  describe('add', () => {
    it('add_withValidArgs_createsInsetWithDefaultDimensions', async () => {
      // Act
      const id = await useListInsetStore.getState().add('My Inset', 'starred', 1, 100, 200)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(1)
      const inset = insets[0]
      expect(inset.id).toBe(id)
      expect(inset.name).toBe('My Inset')
      expect(inset.preset).toBe('starred')
      expect(inset.canvasId).toBe(1)
      expect(inset.x).toBe(100)
      expect(inset.y).toBe(200)
      expect(inset.width).toBe(280)
      expect(inset.height).toBe(300)
      expect(inset.isCollapsed).toBe(false)
    })

    it('add_withValidArgs_persistsInsetToDatabase', async () => {
      // Act
      const id = await useListInsetStore.getState().add('Persisted', 'high-priority', 5, 0, 0)

      // Assert
      const row = await db.listInsets.get(id)
      expect(row).toBeDefined()
      expect(row!.name).toBe('Persisted')
      expect(row!.preset).toBe('high-priority')
      expect(row!.canvasId).toBe(5)
    })

    it('add_multipleInsets_appendsAllToState', async () => {
      // Act
      await useListInsetStore.getState().add('First', 'starred', 1, 0, 0)
      await useListInsetStore.getState().add('Second', 'due-this-week', 1, 300, 0)

      // Assert
      expect(useListInsetStore.getState().insets).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('update_existingInset_updatesStateAndDatabase', async () => {
      // Arrange
      const id = await useListInsetStore.getState().add('Original', 'starred', 1, 0, 0)
      const insets = useListInsetStore.getState().insets
      const original = insets.find((i) => i.id === id)!

      // Act
      const updated = { ...original, name: 'Renamed', isCollapsed: true, width: 400 }
      await useListInsetStore.getState().update(updated)

      // Assert state
      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.name).toBe('Renamed')
      expect(found!.isCollapsed).toBe(true)
      expect(found!.width).toBe(400)

      // Assert DB
      const row = await db.listInsets.get(id)
      expect(row!.name).toBe('Renamed')
      expect(row!.isCollapsed).toBe(true)
    })

    it('update_existingInset_doesNotAffectOtherInsets', async () => {
      // Arrange
      const id1 = await useListInsetStore.getState().add('First', 'starred', 1, 0, 0)
      const id2 = await useListInsetStore.getState().add('Second', 'high-priority', 1, 300, 0)
      const target = useListInsetStore.getState().insets.find((i) => i.id === id1)!

      // Act
      await useListInsetStore.getState().update({ ...target, name: 'Changed' })

      // Assert
      const other = useListInsetStore.getState().insets.find((i) => i.id === id2)
      expect(other!.name).toBe('Second')
    })
  })

  describe('updatePosition', () => {
    it('updatePosition_existingInset_updatesXYInStateAndDatabase', async () => {
      // Arrange
      const id = await useListInsetStore.getState().add('Moveable', 'starred', 1, 0, 0)

      // Act
      await useListInsetStore.getState().updatePosition(id, 150, 250)

      // Assert state
      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.x).toBe(150)
      expect(found!.y).toBe(250)

      // Assert DB
      const row = await db.listInsets.get(id)
      expect(row!.x).toBe(150)
      expect(row!.y).toBe(250)
    })

    it('updatePosition_existingInset_preservesOtherFields', async () => {
      // Arrange
      const id = await useListInsetStore.getState().add('Moveable', 'high-priority', 1, 0, 0)

      // Act
      await useListInsetStore.getState().updatePosition(id, 50, 75)

      // Assert non-position fields are unchanged
      const found = useListInsetStore.getState().insets.find((i) => i.id === id)
      expect(found!.name).toBe('Moveable')
      expect(found!.preset).toBe('high-priority')
      expect(found!.width).toBe(280)
      expect(found!.height).toBe(300)
    })
  })

  describe('remove', () => {
    it('remove_existingInset_removesFromStateAndDatabase', async () => {
      // Arrange
      const id = await useListInsetStore.getState().add('To Delete', 'starred', 1, 0, 0)

      // Act
      await useListInsetStore.getState().remove(id)

      // Assert state
      expect(useListInsetStore.getState().insets).toHaveLength(0)

      // Assert DB
      const row = await db.listInsets.get(id)
      expect(row).toBeUndefined()
    })

    it('remove_oneOfMultipleInsets_onlyRemovesTarget', async () => {
      // Arrange
      const id1 = await useListInsetStore.getState().add('Keep', 'starred', 1, 0, 0)
      const id2 = await useListInsetStore.getState().add('Delete', 'high-priority', 1, 300, 0)

      // Act
      await useListInsetStore.getState().remove(id2)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(1)
      expect(insets[0].id).toBe(id1)
    })
  })

  describe('addFiltered', () => {
    it('addFiltered_withOrgFilter_createsInsetWithAttributeFilter', async () => {
      // Arrange
      const filter = { type: 'org' as const, orgId: 1, orgName: 'Acme', orgColor: '#ff0000' }

      // Act
      const id = await useListInsetStore.getState().addFiltered('Acme List', filter, 1, 100, 200)

      // Assert
      const { insets } = useListInsetStore.getState()
      expect(insets).toHaveLength(1)
      const inset = insets[0]
      expect(inset.id).toBe(id)
      expect(inset.name).toBe('Acme List')
      expect(inset.attributeFilter).toEqual(filter)
      expect(inset.preset).toBeUndefined()
      expect(inset.canvasId).toBe(1)
      expect(inset.x).toBe(100)
      expect(inset.y).toBe(200)
      expect(inset.width).toBe(320)
      expect(inset.height).toBe(300)
      expect(inset.isCollapsed).toBe(false)
    })

    it('addFiltered_withOrgFilter_persistsToDatabase', async () => {
      // Arrange
      const filter = { type: 'org' as const, orgId: 7, orgName: 'Engineering', orgColor: '#537FE7' }

      // Act
      const id = await useListInsetStore.getState().addFiltered('Eng List', filter, 3, 0, 0)

      // Assert
      const row = await db.listInsets.get(id)
      expect(row).toBeDefined()
      expect(row!.name).toBe('Eng List')
      expect(row!.canvasId).toBe(3)
      expect(row!.attributeFilter).toEqual(filter)
      expect(row!.preset).toBeUndefined()
      expect(row!.width).toBe(320)
    })

    it('addFiltered_withPersonFilter_createsInsetWithPersonFilter', async () => {
      // Arrange
      const filter = { type: 'person' as const, personId: 5, personName: 'Alice' }

      // Act
      const id = await useListInsetStore.getState().addFiltered('Alice Tasks', filter, 1, 50, 75)

      // Assert
      const { insets } = useListInsetStore.getState()
      const inset = insets.find((i) => i.id === id)!
      expect(inset.attributeFilter).toEqual(filter)
      expect(inset.preset).toBeUndefined()
      expect(inset.name).toBe('Alice Tasks')
      expect(inset.width).toBe(320)

      // Assert DB
      const row = await db.listInsets.get(id)
      expect(row!.attributeFilter).toEqual(filter)
    })
  })
})
