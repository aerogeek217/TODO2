import { describe, it, expect } from 'vitest'
import { translateStickyToNote } from '../../data/database'

describe('translateStickyToNote', () => {
  const now = new Date('2026-04-19T12:00:00Z')

  it('prepends the sticky title as an H1 when present', () => {
    const note = translateStickyToNote({
      title: 'Shopping',
      text: 'eggs\nmilk',
      canvasId: 1,
      x: 40,
      y: 80,
      width: 240,
      height: 200,
      color: '#FFF3B0',
      createdAt: now,
      modifiedAt: now,
    })

    expect(note.content).toBe('# Shopping\n\neggs\nmilk')
    expect(note.canvasId).toBe(1)
    expect(note.x).toBe(40)
    expect(note.y).toBe(80)
    expect(note.width).toBe(240)
    expect(note.height).toBe(200)
    expect(note.color).toBe('#FFF3B0')
    expect(note.createdAt).toBe(now)
    expect(note.modifiedAt).toBe(now)
  })

  it('omits the H1 when the sticky has no title', () => {
    const note = translateStickyToNote({
      text: 'just text',
      canvasId: 2,
      x: 0,
      y: 0,
      width: 200,
      height: 160,
      createdAt: now,
      modifiedAt: now,
    })
    expect(note.content).toBe('just text')
    expect(note.canvasId).toBe(2)
  })

  it('emits just the H1 when the sticky is titled but empty', () => {
    const note = translateStickyToNote({
      title: 'Header only',
      text: '',
      canvasId: 1,
      x: 0,
      y: 0,
      width: 200,
      height: 160,
      createdAt: now,
      modifiedAt: now,
    })
    expect(note.content).toBe('# Header only')
  })

  it('drops placement fields that are not numbers', () => {
    const note = translateStickyToNote({
      text: 'a',
      createdAt: now,
      modifiedAt: now,
    })
    expect(note.canvasId).toBeUndefined()
    expect(note.x).toBeUndefined()
    expect(note.y).toBeUndefined()
    expect(note.width).toBeUndefined()
    expect(note.height).toBeUndefined()
    expect(note.color).toBeUndefined()
  })

  it('trims whitespace-only titles down to no-title output', () => {
    const note = translateStickyToNote({
      title: '   ',
      text: 'body',
      createdAt: now,
      modifiedAt: now,
    })
    expect(note.content).toBe('body')
  })
})
