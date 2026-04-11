import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useStickyNoteStore } from '../../stores/sticky-note-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useStickyNoteStore.setState({ notes: [], loading: false, error: null })
})

describe('useStickyNoteStore', () => {
  describe('loadByCanvas', () => {
    it('loadByCanvas_withMatchingNotes_loadsNotesForCanvas', async () => {
      // Arrange
      const now = new Date()
      await db.stickyNotes.bulkAdd([
        { canvasId: 1, text: 'Note A', x: 0, y: 0, width: 240, height: 200, createdAt: now, modifiedAt: now },
        { canvasId: 1, text: 'Note B', x: 300, y: 0, width: 240, height: 200, createdAt: now, modifiedAt: now },
        { canvasId: 99, text: 'Other', x: 0, y: 0, width: 240, height: 200, createdAt: now, modifiedAt: now },
      ])

      // Act
      await useStickyNoteStore.getState().loadByCanvas(1)

      // Assert
      const { notes } = useStickyNoteStore.getState()
      expect(notes).toHaveLength(2)
      expect(notes.map((n) => n.text)).toEqual(expect.arrayContaining(['Note A', 'Note B']))
    })

    it('loadByCanvas_withUnknownCanvasId_returnsEmptyArray', async () => {
      // Arrange — no data for canvas 42

      // Act
      await useStickyNoteStore.getState().loadByCanvas(42)

      // Assert
      expect(useStickyNoteStore.getState().notes).toHaveLength(0)
    })

    it('loadByCanvas_setsLoadingFalseAfterCompletion', async () => {
      // Act
      await useStickyNoteStore.getState().loadByCanvas(1)

      // Assert
      expect(useStickyNoteStore.getState().loading).toBe(false)
    })
  })

  describe('add', () => {
    it('add_withPositionOnly_createsNoteWithDefaultDimensions', async () => {
      // Act
      const id = await useStickyNoteStore.getState().add(1, 100, 200)

      // Assert
      const { notes } = useStickyNoteStore.getState()
      expect(notes).toHaveLength(1)
      const note = notes[0]
      expect(note.id).toBe(id)
      expect(note.canvasId).toBe(1)
      expect(note.x).toBe(100)
      expect(note.y).toBe(200)
      expect(note.width).toBe(240)
      expect(note.height).toBe(200)
      expect(note.text).toBe('')
    })

    it('add_withColor_storesColorOnNote', async () => {
      // Act
      const id = await useStickyNoteStore.getState().add(1, 0, 0, '#ffcc00')

      // Assert
      const { notes } = useStickyNoteStore.getState()
      const note = notes.find((n) => n.id === id)!
      expect(note.color).toBe('#ffcc00')
    })

    it('add_withoutColor_defaultsToYellow', async () => {
      // Act
      const id = await useStickyNoteStore.getState().add(1, 0, 0)

      // Assert
      const note = useStickyNoteStore.getState().notes.find((n) => n.id === id)!
      expect(note.color).toBe('#FFF3B0')
    })

    it('add_withValidArgs_persistsNoteToDatabase', async () => {
      // Act
      const id = await useStickyNoteStore.getState().add(5, 10, 20, '#aabbcc')

      // Assert
      const row = await db.stickyNotes.get(id)
      expect(row).toBeDefined()
      expect(row!.canvasId).toBe(5)
      expect(row!.x).toBe(10)
      expect(row!.y).toBe(20)
      expect(row!.color).toBe('#aabbcc')
    })

    it('add_multipleNotes_appendsAllToState', async () => {
      // Act
      await useStickyNoteStore.getState().add(1, 0, 0)
      await useStickyNoteStore.getState().add(1, 300, 0)

      // Assert
      expect(useStickyNoteStore.getState().notes).toHaveLength(2)
    })
  })

  describe('updatePosition', () => {
    it('updatePosition_existingNote_updatesXYInStateAndDatabase', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0)

      // Act
      await useStickyNoteStore.getState().updatePosition(id, 150, 250)

      // Assert state
      const found = useStickyNoteStore.getState().notes.find((n) => n.id === id)
      expect(found!.x).toBe(150)
      expect(found!.y).toBe(250)

      // Assert DB
      const row = await db.stickyNotes.get(id)
      expect(row!.x).toBe(150)
      expect(row!.y).toBe(250)
    })

    it('updatePosition_existingNote_preservesOtherFields', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0, '#ff0000')

      // Act
      await useStickyNoteStore.getState().updatePosition(id, 50, 75)

      // Assert non-position fields are unchanged
      const found = useStickyNoteStore.getState().notes.find((n) => n.id === id)
      expect(found!.color).toBe('#ff0000')
      expect(found!.width).toBe(240)
      expect(found!.height).toBe(200)
      expect(found!.text).toBe('')
    })
  })

  describe('updateText', () => {
    it('updateText_existingNote_updatesTextInStateAndDatabase', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0)

      // Act
      await useStickyNoteStore.getState().updateText(id, 'Hello world')

      // Assert state
      const found = useStickyNoteStore.getState().notes.find((n) => n.id === id)
      expect(found!.text).toBe('Hello world')

      // Assert DB
      const row = await db.stickyNotes.get(id)
      expect(row!.text).toBe('Hello world')
    })

    it('updateText_unknownId_doesNotThrow', async () => {
      // Act + Assert — no note loaded in state, should no-op gracefully
      await expect(useStickyNoteStore.getState().updateText(9999, 'text')).resolves.toBeUndefined()
    })

    it('updateText_existingNote_updatesModifiedAt', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0)
      const before = useStickyNoteStore.getState().notes.find((n) => n.id === id)!.modifiedAt

      // Act
      await useStickyNoteStore.getState().updateText(id, 'Changed')

      // Assert
      const after = useStickyNoteStore.getState().notes.find((n) => n.id === id)!.modifiedAt
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })
  })

  describe('updateColor', () => {
    it('updateColor_withNewColor_updatesColorInStateAndDatabase', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0)

      // Act
      await useStickyNoteStore.getState().updateColor(id, '#123456')

      // Assert state
      const found = useStickyNoteStore.getState().notes.find((n) => n.id === id)
      expect(found!.color).toBe('#123456')

      // Assert DB
      const row = await db.stickyNotes.get(id)
      expect(row!.color).toBe('#123456')
    })

    it('updateColor_withUndefined_clearsColor', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0, '#ff0000')

      // Act
      await useStickyNoteStore.getState().updateColor(id, undefined)

      // Assert
      const found = useStickyNoteStore.getState().notes.find((n) => n.id === id)
      expect(found!.color).toBeUndefined()
    })

    it('updateColor_unknownId_doesNotThrow', async () => {
      // Act + Assert
      await expect(useStickyNoteStore.getState().updateColor(9999, '#ffffff')).resolves.toBeUndefined()
    })
  })

  describe('remove', () => {
    it('remove_existingNote_removesFromStateAndDatabase', async () => {
      // Arrange
      const id = await useStickyNoteStore.getState().add(1, 0, 0)

      // Act
      await useStickyNoteStore.getState().remove(id)

      // Assert state
      expect(useStickyNoteStore.getState().notes).toHaveLength(0)

      // Assert DB
      const row = await db.stickyNotes.get(id)
      expect(row).toBeUndefined()
    })

    it('remove_oneOfMultipleNotes_onlyRemovesTarget', async () => {
      // Arrange
      const id1 = await useStickyNoteStore.getState().add(1, 0, 0)
      const id2 = await useStickyNoteStore.getState().add(1, 300, 0)

      // Act
      await useStickyNoteStore.getState().remove(id2)

      // Assert
      const { notes } = useStickyNoteStore.getState()
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe(id1)
    })
  })
})
