import { describe, it, expect, vi, beforeEach } from 'vitest'

// Count the per-line Markdown work: the preview runs on every row mount and
// on every keystroke in the notes popover, and notes have no size limit.
const linkScans = vi.hoisted(() => ({ count: 0, longest: 0 }))
vi.mock('../../utils/markdown-links', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../utils/markdown-links')>()
  return {
    ...real,
    replaceMarkdownLinks: (...args: Parameters<typeof real.replaceMarkdownLinks>) => {
      linkScans.count += 1
      linkScans.longest = Math.max(linkScans.longest, args[0].length)
      return real.replaceMarkdownLinks(...args)
    },
  }
})

import { NOTES_PREVIEW_MAX_LINES, progressNotesPreview } from '../../utils/notes-preview'

beforeEach(() => {
  linkScans.count = 0
  linkScans.longest = 0
})

describe('notes preview cost', () => {
  it('reads only the lines it shows (and one more), however long the note', () => {
    const notes = Array.from({ length: 20_000 }, (_, i) => `- line ${i}`).join('\n')
    const preview = progressNotesPreview(undefined, notes)
    expect(preview?.text.split('\n')).toHaveLength(NOTES_PREVIEW_MAX_LINES + 1)
    expect(linkScans.count).toBeLessThanOrEqual(NOTES_PREVIEW_MAX_LINES + 1)
  })

  it('a huge single line is cut before the Markdown work', () => {
    const notes = `start ${'x'.repeat(2_000_000)}`
    const preview = progressNotesPreview(undefined, notes)
    expect(preview?.text.split('\n')[1]).toMatch(/^start x+…$/)
    expect(linkScans.longest).toBeLessThan(10_000)
  })

  it('blank lines in between are skipped without the Markdown work', () => {
    const notes = `first\n${'\n   '.repeat(50_000)}\nsecond`
    expect(progressNotesPreview(undefined, notes)?.text).toBe('Notes\nfirst\nsecond')
    expect(linkScans.count).toBe(2)
  })
})
