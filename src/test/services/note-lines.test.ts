import { describe, expect, it } from 'vitest'
import {
  applyTextChanges,
  classifyNoteLine,
  convertCandidates,
  locateLines,
  markLineChanges,
  removeLineChanges,
  selectionLines,
  singleLineCandidate,
} from '../../services/note-lines'

describe('classifyNoteLine', () => {
  it.each([
    ['- Draft homepage copy', 'Draft homepage copy'],
    ['* Book venue', 'Book venue'],
    ['• Draft agenda #q4', 'Draft agenda #q4'],
    ['[ ] Ask for access', 'Ask for access'],
    ['- [ ] Renew domain /due 10/20', 'Renew domain /due 10/20'],
    ['* [ ] Starred box', 'Starred box'],
    ['    - indented bullet', 'indented bullet'],
    ['\t• tab-indented', 'tab-indented'],
    ['-   extra spaces  ', 'extra spaces'],
  ])('%j is a candidate', (text, body) => {
    expect(classifyNoteLine(text)).toMatchObject({ kind: 'candidate', body })
  })

  it.each([
    '- [x] Send recap email',
    '- [X] Send recap email',
    '[x] Done thing',
    '  - [x] indented done',
  ])('%j is done (skipped)', (text) => {
    expect(classifyNoteLine(text).kind).toBe('done')
  })

  it.each([
    '✓ Sign off on new logo',
    '  ✓ indented converted',
    '- ✓ bullet then converted',
  ])('%j is already converted (skipped)', (text) => {
    expect(classifyNoteLine(text).kind).toBe('converted')
  })

  it.each([
    'Random thought: maybe switch CDN?',
    '# Weekly sync',
    '## Heading two',
    '',
    '   ',
    '-',
    '- ',
    '*',
    '- [ ]',
    '[ ]',
    '-no space after the dash',
    '**bold** text',
    '+ plus bullet',
    '– en dash',
    '1. numbered',
  ])('%j is not a candidate', (text) => {
    expect(classifyNoteLine(text).kind).toBe('other')
  })

  it('keeps the indent', () => {
    expect(classifyNoteLine('   - x').indent).toBe('   ')
  })
})

describe('singleLineCandidate (Alt+T)', () => {
  it('takes any non-empty line, bullet or not', () => {
    expect(singleLineCandidate('Plain line /urgent', 3)).toEqual({ line: 3, text: 'Plain line /urgent', indent: '', body: 'Plain line /urgent' })
    expect(singleLineCandidate('  - Book venue /important', 1)).toMatchObject({ indent: '  ', body: 'Book venue /important' })
  })

  it('strips a bullet or dash, then a box (open or done)', () => {
    expect(singleLineCandidate('- [ ] Renew', 1)?.body).toBe('Renew')
    expect(singleLineCandidate('- [x] Recap', 1)?.body).toBe('Recap')
    expect(singleLineCandidate('* Star', 1)?.body).toBe('Star')
    expect(singleLineCandidate('• Dot', 1)?.body).toBe('Dot')
    expect(singleLineCandidate('– En dash', 1)?.body).toBe('En dash')
    expect(singleLineCandidate('— Em dash', 1)?.body).toBe('Em dash')
    expect(singleLineCandidate('[ ] Box', 1)?.body).toBe('Box')
  })

  it('refuses blank and already-converted lines', () => {
    expect(singleLineCandidate('', 1)).toBeNull()
    expect(singleLineCandidate('   ', 1)).toBeNull()
    expect(singleLineCandidate('- ', 1)).toBeNull()
    expect(singleLineCandidate('✓ Done', 1)).toBeNull()
    expect(singleLineCandidate('  ✓ Done', 1)).toBeNull()
    expect(singleLineCandidate('- ✓ Done', 1)).toBeNull()
  })
})

const NOTE = [
  '# Weekly sync', // 1
  'Discussed Q4 offsite and homepage.', // 2
  '', // 3
  '- Draft homepage copy @Priya #planning /due mon', // 4
  '- [ ] Ask for analytics access @Ben /urgent', // 5
  '• Draft agenda for Q4 offsite #q4 /followup 2w', // 6
  'Random thought: maybe switch CDN?', // 7
  '- Book venue for team dinner /important', // 8
  '- [ ] Renew domain before it lapses /due 10/20', // 9
  '- [x] Send recap email', // 10
  '✓ Sign off on new logo', // 11
].join('\n')

/** Offset of `col` on 1-based `line` of `text`. */
function at(text: string, line: number, col = 0): number {
  const lines = text.split('\n')
  let off = 0
  for (let n = 1; n < line; n++) off += (lines[n - 1]?.length ?? 0) + 1
  return off + col
}

describe('selectionLines', () => {
  it('is null for an empty selection', () => {
    expect(selectionLines(NOTE, 5, 5)).toBeNull()
  })

  it('covers every line the selection touches, even partly', () => {
    // From the middle of line 6 to the middle of line 8.
    expect(selectionLines(NOTE, at(NOTE, 6, 20), at(NOTE, 8, 10))).toEqual({ from: 6, to: 8 })
  })

  it('works backwards (anchor after head)', () => {
    expect(selectionLines(NOTE, at(NOTE, 8, 10), at(NOTE, 6, 20))).toEqual({ from: 6, to: 8 })
  })

  it('a selection ending at the start of a line does not touch that line', () => {
    expect(selectionLines(NOTE, at(NOTE, 4), at(NOTE, 6))).toEqual({ from: 4, to: 5 })
  })

  it('a selection within one line covers that line', () => {
    expect(selectionLines(NOTE, at(NOTE, 5, 2), at(NOTE, 5, 9))).toEqual({ from: 5, to: 5 })
  })

  it('a selection starting at the end of a line still touches it', () => {
    const end4 = at(NOTE, 5) - 1
    expect(selectionLines(NOTE, end4, at(NOTE, 5, 3))).toEqual({ from: 4, to: 5 })
  })

  it('select-all covers the whole note', () => {
    expect(selectionLines(NOTE, 0, NOTE.length)).toEqual({ from: 1, to: 11 })
  })
})

describe('convertCandidates', () => {
  it('takes every bullet line of the note without a selection', () => {
    expect(convertCandidates(NOTE, null).map((c) => c.line)).toEqual([4, 5, 6, 8, 9])
  })

  it('carries the original text and the parsed body', () => {
    const [first] = convertCandidates(NOTE, null)
    expect(first).toEqual({
      line: 4,
      text: '- Draft homepage copy @Priya #planning /due mon',
      indent: '',
      body: 'Draft homepage copy @Priya #planning /due mon',
    })
  })

  it('takes only the bullet lines a selection touches; plain lines inside are skipped', () => {
    expect(convertCandidates(NOTE, { from: 6, to: 8 }).map((c) => c.line)).toEqual([6, 8])
  })

  it('a selection over plain / done / converted lines only takes nothing', () => {
    expect(convertCandidates(NOTE, { from: 10, to: 11 })).toEqual([])
    expect(convertCandidates(NOTE, { from: 1, to: 3 })).toEqual([])
  })

  it('clamps a range past the end', () => {
    expect(convertCandidates(NOTE, { from: 9, to: 99 }).map((c) => c.line)).toEqual([9])
  })

  it('an empty note has none', () => {
    expect(convertCandidates('', null)).toEqual([])
  })
})

describe('locateLines', () => {
  const targets = [
    { line: 4, text: '- a' },
    { line: 6, text: '- c' },
  ]

  it('uses the original line numbers while the text is unchanged', () => {
    expect(locateLines('x\ny\nz\n- a\n- b\n- c', targets)).toEqual([4, 6])
  })

  it('follows lines that moved (lines added or removed above)', () => {
    expect(locateLines('new\nx\ny\nz\n- a\n- b\n- c', targets)).toEqual([5, 7])
    expect(locateLines('z\n- a\n- b\n- c', targets)).toEqual([2, 4])
  })

  it('gives null for a line that was edited or deleted', () => {
    expect(locateLines('x\ny\nz\n- a edited\n- b\n- c', targets)).toEqual([null, 6])
    expect(locateLines('x\ny\nz\n- b\n- c', targets)).toEqual([null, 5])
  })

  it('never uses one line for two targets with the same text', () => {
    const dupes = [{ line: 1, text: '- same' }, { line: 2, text: '- same' }]
    expect(locateLines('- same\n- same', dupes)).toEqual([1, 2])
    expect(locateLines('- same', dupes)).toEqual([1, null])
  })

  it('picks the nearest copy when the line moved', () => {
    expect(locateLines('- a\nx\nx\nx\n- a', [{ line: 4, text: '- a' }])).toEqual([5])
  })
})

describe('removeLineChanges', () => {
  const text = 'one\n- a\ntwo\n- b\n- c\nthree'

  it('removes exactly the given lines with their newlines', () => {
    expect(applyTextChanges(text, removeLineChanges(text, [2, 4]))).toBe('one\ntwo\n- c\nthree')
  })

  it('merges adjacent lines into one change', () => {
    const changes = removeLineChanges(text, [4, 5])
    expect(changes).toHaveLength(1)
    expect(applyTextChanges(text, changes)).toBe('one\n- a\ntwo\nthree')
  })

  it('removes the last line with the newline before it', () => {
    expect(applyTextChanges(text, removeLineChanges(text, [6]))).toBe('one\n- a\ntwo\n- b\n- c')
    expect(applyTextChanges(text, removeLineChanges(text, [5, 6]))).toBe('one\n- a\ntwo\n- b')
  })

  it('removes the first line', () => {
    expect(applyTextChanges(text, removeLineChanges(text, [1]))).toBe('- a\ntwo\n- b\n- c\nthree')
  })

  it('removing every line leaves an empty note', () => {
    expect(applyTextChanges(text, removeLineChanges(text, [1, 2, 3, 4, 5, 6]))).toBe('')
  })

  it('ignores duplicates and out-of-range lines', () => {
    expect(applyTextChanges(text, removeLineChanges(text, [2, 2, 0, 99]))).toBe('one\ntwo\n- b\n- c\nthree')
  })

  it('changes never overlap (one CodeMirror transaction)', () => {
    const changes = removeLineChanges(text, [1, 2, 4, 5, 6])
    const sorted = [...changes].sort((a, b) => a.from - b.from)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.from).toBeGreaterThanOrEqual(sorted[i - 1]!.to)
    }
    expect(applyTextChanges(text, changes)).toBe('two')
  })
})

describe('markLineChanges', () => {
  it('rewrites each line as `<indent>✓ <title>`', () => {
    const text = 'x\n  - [ ] Ask @Ben /urgent\n- Book venue /important'
    const out = applyTextChanges(text, markLineChanges(text, [
      { line: 2, title: 'Ask' },
      { line: 3, title: 'Book venue' },
    ]))
    expect(out).toBe('x\n  ✓ Ask\n✓ Book venue')
  })

  it('skips out-of-range lines', () => {
    expect(markLineChanges('a', [{ line: 2, title: 'b' }])).toEqual([])
  })
})
