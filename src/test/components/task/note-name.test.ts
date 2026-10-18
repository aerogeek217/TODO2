import { describe, it, expect } from 'vitest'
import { noteNameOf } from '../../../components/task/notes/NotesConvert'
import { expectWithin } from '../../timing'

/** The heading rule as it was written, for inputs short enough to run it. */
function byRegex(text: string): string | null {
  const first = text.split('\n').find((l) => l.trim() !== '')
  const heading = first ? /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(first) : null
  const name = heading?.[1]?.trim()
  if (!name) return null
  return name.length > 40 ? `${name.slice(0, 39)}…` : name
}

describe('noteNameOf', () => {
  it('names a note by its first line when that is a heading', () => {
    expect(noteNameOf('\n  ## Weekly sync ##  \n- a')).toBe('Weekly sync')
    expect(noteNameOf('# Plan')).toBe('Plan')
    expect(noteNameOf('Plan\n# Later')).toBeNull()
    expect(noteNameOf('####### seven')).toBeNull()
    expect(noteNameOf('#nospace')).toBeNull()
    expect(noteNameOf(`# ${'x'.repeat(50)}`)).toBe(`${'x'.repeat(39)}…`)
  })

  it('matches the old heading regex on short random lines', () => {
    const alphabet = ['#', ' ', '\t', 'a', 'b', '\r', '\u2028']
    let seed = 7
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let i = 0; i < 20_000; i++) {
      const len = next() % 14
      let s = ''
      for (let j = 0; j < len; j++) s += alphabet[next() % alphabet.length]
      expect(noteNameOf(s), JSON.stringify(s)).toBe(byRegex(s))
    }
  })

  it('stays fast on a heading with a long space run (the regex was cubic)', () => {
    expectWithin(1000, () => expect(noteNameOf(`# Title${' '.repeat(200_000)}x`)).toBe(`Title${' '.repeat(34)}…`))
  })
})
