import { describe, it, expect } from 'vitest'
import { NOTES_PREVIEW_MAX_CHARS, notesPreviewLines, statusNotesPreview } from '../../utils/notes-preview'

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

describe('statusNotesPreview', () => {
  const update = (text: string) => ({ date: new Date(2026, 9, 28), text })

  it('nothing to show → null', () => {
    expect(statusNotesPreview(undefined, undefined)).toBeNull()
    expect(statusNotesPreview(update(' '), '\n')).toBeNull()
  })

  it('an update only: one label line, `MM/DD text`', () => {
    expect(statusNotesPreview(update('50% done'), undefined)).toEqual({ text: '10/28 50% done', labelLines: 1 })
  })

  it('notes only: a Notes heading over the lines', () => {
    expect(statusNotesPreview(undefined, 'a\nb')).toEqual({ text: 'Notes\na\nb', labelLines: 1 })
  })

  it('both: the update, then the Notes heading, then the lines; the update on one line, cut like a note line', () => {
    expect(statusNotesPreview(update('waiting\non review'), '- call Sam')).toEqual({
      text: '10/28 waiting on review\nNotes\n• call Sam',
      labelLines: 2,
    })
    const long = statusNotesPreview(update('x'.repeat(200)), undefined)?.text ?? ''
    expect(long).toHaveLength(NOTES_PREVIEW_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })
})
