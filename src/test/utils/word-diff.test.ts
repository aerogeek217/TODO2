import { describe, expect, it } from 'vitest'
import { diffSequences, WORD_DIFF_MAX_CELLS, wordDiff, wordTokens, type WordDiffPart } from '../../utils/word-diff'
import { expectWithin } from '../timing'

/** The old text (`=` + `-`) and the new text (`=` + `+`) a diff spells. */
function sides(parts: readonly WordDiffPart[]) {
  return {
    from: parts.filter((p) => p.op !== '+').map((p) => p.text).join(''),
    to: parts.filter((p) => p.op !== '-').map((p) => p.text).join(''),
  }
}

/** A diff as a string: `[-removed-]` / `{+added+}`. */
function show(parts: readonly WordDiffPart[]): string {
  return parts.map((p) => (p.op === '=' ? p.text : p.op === '-' ? `[-${p.text}-]` : `{+${p.text}+}`)).join('')
}

describe('wordTokens', () => {
  it('splits words, whitespace runs and each other character; joined, gives the text back', () => {
    const text = 'Half  done — don’t ship (yet), 3.5 left!\nNext'
    expect(wordTokens(text)).toEqual(['Half', '  ', 'done', ' ', '—', ' ', 'don’t', ' ', 'ship', ' ', '(', 'yet', ')', ',', ' ', '3', '.', '5', ' ', 'left', '!', '\n', 'Next'])
    expect(wordTokens(text).join('')).toBe(text)
  })

  it('keeps accented letters, non-Latin words and emoji whole', () => {
    expect(wordTokens('café naïve 東京 👍')).toEqual(['café', ' ', 'naïve', ' ', '東京', ' ', '👍'])
    expect(wordTokens('')).toEqual([])
  })
})

describe('wordDiff', () => {
  it('equal texts: one kept part (none for two empty texts)', () => {
    expect(wordDiff('same words', 'same words')).toEqual([{ op: '=', text: 'same words' }])
    expect(wordDiff('', '')).toEqual([])
  })

  it('an empty side: all added, or all removed', () => {
    expect(wordDiff('', 'section 4 done')).toEqual([{ op: '+', text: 'section 4 done' }])
    expect(wordDiff('half done', '')).toEqual([{ op: '-', text: 'half done' }])
  })

  it('a replaced word: removed then added, the rest kept', () => {
    expect(wordDiff('half done', 'section 4 done')).toEqual([
      { op: '-', text: 'half' },
      { op: '+', text: 'section 4' },
      { op: '=', text: ' done' },
    ])
    expect(show(wordDiff('Ask Nina about the window', 'Ask Sam about the window'))).toBe('Ask [-Nina-]{+Sam+} about the window')
  })

  it('an inserted and a deleted word', () => {
    expect(show(wordDiff('Dry run on staging', 'Dry run on staging by Friday'))).toBe('Dry run on staging{+ by Friday+}')
    expect(show(wordDiff('Dry run on staging today', 'Dry run on staging'))).toBe('Dry run on staging[- today-]')
  })

  it('whitespace kept between two changes joins them: whole phrases, not word by word', () => {
    expect(wordDiff('a b c', 'x y z')).toEqual([{ op: '-', text: 'a b c' }, { op: '+', text: 'x y z' }])
    expect(show(wordDiff('keep a b keep', 'keep x y keep'))).toBe('keep [-a b-]{+x y+} keep')
  })

  it('punctuation is its own token', () => {
    expect(show(wordDiff('Done.', 'Done, mostly.'))).toBe('Done{+, mostly+}.')
    expect(show(wordDiff('(rollback window)', '[rollback window]'))).toBe('[-(-]{+[+}rollback window[-)-]{+]+}')
  })

  it('repeated words line up with the longest common run', () => {
    const parts = wordDiff('the cat and the hat', 'the hat and the cat')
    expect(sides(parts)).toEqual({ from: 'the cat and the hat', to: 'the hat and the cat' })
    expect(parts.filter((p) => p.op === '=').map((p) => p.text).join('')).toContain(' and the ')
    expect(show(wordDiff('no no no', 'no no'))).toBe('no no[- no-]')
  })

  it('adjacent parts of one kind are merged; the sides always spell both texts', () => {
    const cases: [string, string][] = [
      ['', 'x'],
      ['Sections 4 and 7 still open.', 'Section 7 still open; 4 done.'],
      ['  leading and trailing  ', 'leading, trailing'],
      ['line one\nline two', 'line one\nline 2\nline three'],
    ]
    for (const [from, to] of cases) {
      const parts = wordDiff(from, to)
      expect(sides(parts)).toEqual({ from, to })
      parts.forEach((p, i) => {
        expect(p.text).not.toBe('')
        expect(parts[i + 1]?.op).not.toBe(p.op)
      })
    }
  })

  it('over the cap: all removed, then all added (no LCS)', () => {
    const words = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ')
    // Each side ~2n tokens (words + spaces): (2n)² > the cap.
    const n = Math.ceil(Math.sqrt(WORD_DIFF_MAX_CELLS) / 2) + 1
    const from = `start ${words('a', n)} end`
    const to = `start ${words('b', n)} end`
    expectWithin(5000, () => {
      expect(wordDiff(from, to)).toEqual([
        { op: '=', text: 'start ' },
        { op: '-', text: words('a', n) },
        { op: '+', text: words('b', n) },
        { op: '=', text: ' end' },
      ])
    })
  })

  it('just under the cap still runs the LCS', () => {
    // a0 x a1 x … vs b0 x b1 x …: the shared `x` words line up.
    const side = (p: string) => Array.from({ length: 100 }, (_, i) => `${p}${i} x`).join(' ')
    const parts = wordDiff(side('a'), side('b'))
    expect(parts.filter((p) => p.op === '=').some((p) => p.text.includes('x'))).toBe(true)
  })
})

describe('diffSequences', () => {
  it('prefix and suffix kept, the middle by LCS, removals before additions', () => {
    expect(diffSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'], 100)).toEqual([
      { op: '=', a: 0, b: 0 },
      { op: '-', a: 1 },
      { op: '+', b: 1 },
      { op: '=', a: 2, b: 2 },
      { op: '=', a: 3, b: 3 },
    ])
  })

  it('over the cap: the middle removed, then added', () => {
    expect(diffSequences(['k', 'a', 'b', 'k'], ['k', 'b', 'a', 'k'], 3).map((o) => o.op)).toEqual(['=', '-', '-', '+', '+', '='])
    expect(diffSequences(['k', 'a', 'b', 'k'], ['k', 'b', 'a', 'k'], 4).map((o) => o.op)).toEqual(['=', '-', '=', '+', '='])
  })
})
