import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { stickyNoteRepository } from '../../data/sticky-note-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('stickyNoteRepository', () => {
  function makeNote(overrides: Record<string, unknown> = {}) {
    return {
      canvasId: 1,
      x: 100,
      y: 200,
      width: 300,
      height: 150,
      text: 'Hello world',
      createdAt: new Date('2025-01-01'),
      modifiedAt: new Date('2025-01-01'),
      ...overrides,
    }
  }

  it('insert_andGetByCanvas_returnsInsertedNote', async () => {
    await stickyNoteRepository.insert(makeNote())
    await stickyNoteRepository.insert(makeNote({ canvasId: 2, text: 'Other canvas' }))

    const notes = await stickyNoteRepository.getByCanvas(1)
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toBe('Hello world')
  })

  it('getByCanvas_noNotes_returnsEmptyArray', async () => {
    const notes = await stickyNoteRepository.getByCanvas(99)
    expect(notes).toHaveLength(0)
  })

  it('getById_existingNote_returnsCorrectNote', async () => {
    const id = await stickyNoteRepository.insert(makeNote({ text: 'Find me' }))
    const note = await stickyNoteRepository.getById(id)
    expect(note).toBeDefined()
    expect(note!.text).toBe('Find me')
    expect(note!.id).toBe(id)
  })

  it('getById_nonExistentId_returnsUndefined', async () => {
    const note = await stickyNoteRepository.getById(9999)
    expect(note).toBeUndefined()
  })

  it('insert_withOptionalColor_persitsColor', async () => {
    const id = await stickyNoteRepository.insert(makeNote({ color: '#ffcc00' }))
    const note = await stickyNoteRepository.getById(id)
    expect(note!.color).toBe('#ffcc00')
  })

  it('update_modifiesTextAndDimensions', async () => {
    const id = await stickyNoteRepository.insert(makeNote())
    const inserted = await stickyNoteRepository.getById(id)
    await stickyNoteRepository.update({ ...inserted!, text: 'Updated text', width: 500 })

    const updated = await stickyNoteRepository.getById(id)
    expect(updated!.text).toBe('Updated text')
    expect(updated!.width).toBe(500)
  })

  it('update_withNoId_doesNothing', async () => {
    // Should not throw — guard inside update()
    await expect(stickyNoteRepository.update(makeNote() as any)).resolves.toBeUndefined()
  })

  it('updatePosition_changesXAndY', async () => {
    const id = await stickyNoteRepository.insert(makeNote())
    await stickyNoteRepository.updatePosition(id, 750, 850)

    const note = await stickyNoteRepository.getById(id)
    expect(note!.x).toBe(750)
    expect(note!.y).toBe(850)
  })

  it('remove_removesNote', async () => {
    const id = await stickyNoteRepository.insert(makeNote())
    await stickyNoteRepository.remove(id)
    expect(await stickyNoteRepository.getById(id)).toBeUndefined()
  })

  it('deleteByCanvas_removesAllNotesForCanvas_leavesOthersIntact', async () => {
    await stickyNoteRepository.insert(makeNote())
    await stickyNoteRepository.insert(makeNote({ text: 'Second note' }))
    await stickyNoteRepository.insert(makeNote({ canvasId: 2, text: 'Different canvas' }))

    await stickyNoteRepository.deleteByCanvas(1)

    const remaining = await stickyNoteRepository.getByCanvas(1)
    expect(remaining).toHaveLength(0)
    const other = await stickyNoteRepository.getByCanvas(2)
    expect(other).toHaveLength(1)
    expect(other[0].text).toBe('Different canvas')
  })
})
