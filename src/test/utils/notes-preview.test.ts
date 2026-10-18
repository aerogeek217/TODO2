import { describe, it, expect } from 'vitest'
import { hasProgressText, notesPreviewLines, progressNotesPreview } from '../../utils/notes-preview'

describe('notesPreviewLines', () => {
  it('no notes → no lines', () => {
    expect(notesPreviewLines(undefined)).toEqual([])
    expect(notesPreviewLines('')).toEqual([])
    expect(notesPreviewLines('\n  \n')).toEqual([])
  })

  it('drops blank lines and Markdown marks: headings, quotes, emphasis, code, links; bullets as • and ✓', () => {
    const notes = [
      '## Call notes',
      '',
      '> quoted **bold** text',
      '- first *point*',
      '* [ ] open item',
      '- [x] done item',
      'See [the doc](https://example.com) and `code`',
    ].join('\n')
    expect(notesPreviewLines(notes)).toEqual([
      'Call notes',
      'quoted bold text',
      '• first point',
      '• open item',
      '✓ done item',
      'See the doc and code',
    ])
    expect(notesPreviewLines('1. numbered stays')).toEqual(['1. numbered stays'])
  })

  it('keeps at most six lines; the last reads … when there is more', () => {
    const notes = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(notesPreviewLines(notes)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5', '…'])
    expect(notesPreviewLines(Array.from({ length: 6 }, (_, i) => `l${i}`).join('\n'))).toHaveLength(6)
  })

  it('cuts a long line to 80 characters ending in …', () => {
    const [line] = notesPreviewLines('x'.repeat(200))
    expect(line).toHaveLength(80)
    expect(line?.endsWith('…')).toBe(true)
  })

  it('leaves a lone asterisk or snake_case words alone', () => {
    expect(notesPreviewLines('2 * 3 = 6 for some_var_name')).toEqual(['2 * 3 = 6 for some_var_name'])
  })
})

describe('hasProgressText', () => {
  it('spaces only is no progress', () => {
    expect(hasProgressText(undefined)).toBe(false)
    expect(hasProgressText('   ')).toBe(false)
    expect(hasProgressText('50%')).toBe(true)
  })
})

describe('progressNotesPreview', () => {
  it('nothing to show → null', () => {
    expect(progressNotesPreview(undefined, undefined)).toBeNull()
    expect(progressNotesPreview(' ', '\n')).toBeNull()
  })

  it('progress only: one label line', () => {
    expect(progressNotesPreview('50% done', undefined)).toEqual({ text: 'Progress: 50% done', labelLines: 1 })
  })

  it('notes only: a Notes heading over the lines', () => {
    expect(progressNotesPreview(undefined, 'a\nb')).toEqual({ text: 'Notes\na\nb', labelLines: 1 })
  })

  it('both: progress, then the Notes heading, then the lines; progress on one line', () => {
    expect(progressNotesPreview('waiting\non review', '- call Sam')).toEqual({
      text: 'Progress: waiting on review\nNotes\n• call Sam',
      labelLines: 2,
    })
  })
})
