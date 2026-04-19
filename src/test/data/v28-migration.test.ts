import { describe, it, expect } from 'vitest'
import { translateNoteToFloatingNote } from '../../data/database'

describe('translateNoteToFloatingNote', () => {
  it('extracts placement fields and drops content + color', () => {
    const placement = translateNoteToFloatingNote({
      id: 42,
      canvasId: 3,
      content: '# Title\n\nbody',
      color: '#FFF3B0',
      x: 100,
      y: 200,
      width: 260,
      height: 180,
      createdAt: new Date(),
      modifiedAt: new Date(),
    })

    expect(placement).toEqual({
      canvasId: 3,
      x: 100,
      y: 200,
      width: 260,
      height: 180,
    })
  })

  it('uses defaults for missing placement fields', () => {
    const placement = translateNoteToFloatingNote({
      canvasId: 1,
      content: 'no placement',
      createdAt: new Date(),
      modifiedAt: new Date(),
    })

    expect(placement).toEqual({
      canvasId: 1,
      x: 0,
      y: 0,
      width: 240,
      height: 200,
    })
  })

  it('returns null when the row has no canvasId (global note)', () => {
    const placement = translateNoteToFloatingNote({
      content: 'global',
      createdAt: new Date(),
      modifiedAt: new Date(),
    })
    expect(placement).toBeNull()
  })
})
