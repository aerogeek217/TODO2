import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITY_CUES, parsePriorityCues, rowCue, rowGlow } from '../../utils/priority-cues'

const today = new Date(2026, 10, 5)
const open = { isCompleted: false }

describe('rowGlow', () => {
  it('is nothing with no colour, the edge glow with one, a blend with several', () => {
    expect(rowGlow([])).toBeUndefined()
    expect(rowGlow(['red'])).toBe('radial-gradient(60px 28px at 0 50%, red, transparent)')
    expect(rowGlow(['red', 'blue'])).toBe('linear-gradient(to right, red 0px, blue 30px, transparent 90px)')
    expect(rowGlow(['a', 'b', 'c'])).toBe('linear-gradient(to right, a 0px, b 30px, c 60px, transparent 120px)')
  })
})

describe('rowCue with the default cues', () => {
  const cue = (todo: Parameters<typeof rowCue>[0]) => rowCue(todo, DEFAULT_PRIORITY_CUES, today, 3)

  it('adds nothing to a task with no priority', () => {
    expect(cue(open)).toEqual({ semibold: false })
  })

  it('Focus has no glow and no weight', () => {
    expect(cue({ ...open, focus: true })).toEqual({ semibold: false })
  })

  it('Urgent glows, Important glows and is semibold', () => {
    const urgent = cue({ ...open, urgent: true })
    expect(urgent.glow).toContain('radial-gradient')
    expect(urgent.glow).toContain('--color-marker-urgent')
    expect(urgent.semibold).toBe(false)
    const important = cue({ ...open, important: true })
    expect(important.glow).toContain('--color-marker-important')
    expect(important.semibold).toBe(true)
  })

  it('Urgent and Important blend, in the markers’ order', () => {
    const both = cue({ ...open, urgent: true, important: true })
    expect(both.glow).toContain('linear-gradient')
    expect(both.glow?.indexOf('marker-urgent')).toBeLessThan(both.glow?.indexOf('marker-important') ?? -1)
    expect(both.semibold).toBe(true)
  })

  it('urgent only by its due date glows less', () => {
    const glow = cue({ ...open, dueDate: new Date(2026, 10, 6) }).glow
    expect(glow).toContain('--color-marker-urgent')
    expect(glow).toContain('* 0.55')
  })

  it('a completed task has none', () => {
    expect(cue({ isCompleted: true, urgent: true, important: true })).toEqual({ semibold: false })
  })
})

describe('rowCue with other cues', () => {
  it('follows what is switched', () => {
    const cues = {
      focus: { glow: true, semibold: true },
      urgent: { glow: false, semibold: false },
      important: { glow: false, semibold: false },
    }
    const cue = rowCue({ ...open, focus: true, urgent: true, important: true }, cues, today, 3)
    expect(cue.glow).toContain('radial-gradient')
    expect(cue.glow).toContain('--color-marker-focus')
    expect(cue.semibold).toBe(true)
  })
})

describe('parsePriorityCues', () => {
  it('round-trips', () => {
    expect(parsePriorityCues(JSON.stringify(DEFAULT_PRIORITY_CUES))).toEqual(DEFAULT_PRIORITY_CUES)
  })

  it.each(['', 'nope', 'null', '{}', 42, JSON.stringify({ ...DEFAULT_PRIORITY_CUES, focus: { glow: 'yes', semibold: false } })])('refuses %s', (value) => {
    expect(parsePriorityCues(value)).toBeUndefined()
  })
})
