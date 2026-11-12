import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { emptyBody } from '../helpers/layout-builders'

const layout = (extra: Record<string, unknown>) => ({
  id: 1,
  name: 'Home',
  sortOrder: 0,
  ...emptyBody(),
  createdAt: new Date('2026-11-01T09:00:00Z'),
  modifiedAt: new Date('2026-11-01T09:00:00Z'),
  ...extra,
})

const status = (extra: Record<string, unknown>) => ({ id: 1, name: 'Waiting', color: '#e0a030', sortOrder: 0, icon: 'clock', ...extra })

describe('a layout’s icon (items 11, 14; J1)', () => {
  it('passes absent, none, a line icon and an emoji with its Show as', () => {
    for (const icon of [undefined, { kind: 'none' }, { kind: 'line', key: 'flag' }, { kind: 'emoji', emoji: '🏠' }, { kind: 'emoji', emoji: '🚀', show: 'color' }]) {
      expect(validateRow('layouts', layout({ icon }))).toBe(true)
      expect(rowFixes('layouts', layout({ icon }))).toEqual([])
    }
  })

  it('refuses one that doesn’t read (an import), and the repair drops it, the layout glyph again', () => {
    for (const icon of [{ kind: 'line', key: 'rocket' }, { kind: 'emoji', emoji: 'ab' }, 'flag', { kind: 'status', key: 'clock' }]) {
      expect(validateRow('layouts', layout({ icon }))).toContain('icon')
      expect(rowFixes('layouts', layout({ icon }))).toContain('icon reset')
      expect(sanitizeRow('layouts', layout({ icon })).icon).toBeUndefined()
    }
  })

  it('keeps only the model’s keys (muted is the default, not stored)', () => {
    expect(sanitizeRow('layouts', layout({ icon: { kind: 'emoji', emoji: '🏠', show: 'muted' } })).icon).toEqual({ kind: 'emoji', emoji: '🏠' })
    expect(sanitizeRow('layouts', layout({ icon: { kind: 'emoji', emoji: '🏠', show: 'color' } })).icon).toEqual({ kind: 'emoji', emoji: '🏠', show: 'color' })
  })
})

describe('a status’s emoji (J17)', () => {
  it('an old row reads unchanged', () => {
    expect(validateRow('statuses', status({}))).toBe(true)
    expect(rowFixes('statuses', status({}))).toEqual([])
    expect(sanitizeRow('statuses', status({}))).toEqual(status({}))
  })

  it('keeps one emoji and its Show as, the glyph beside it', () => {
    const row = status({ emoji: '⏳', emojiShow: 'color' })
    expect(validateRow('statuses', row)).toBe(true)
    expect(rowFixes('statuses', row)).toEqual([])
    expect(sanitizeRow('statuses', row)).toMatchObject({ icon: 'clock', emoji: '⏳', emojiShow: 'color' })
    expect(sanitizeRow('statuses', status({ emoji: '⏳', emojiShow: 'muted' })).emojiShow).toBeUndefined()
  })

  it('a text that isn’t one emoji passes the check and is dropped with a fix (as an unknown glyph is)', () => {
    for (const emoji of ['wait', '⏳⏳']) {
      const row = status({ emoji, emojiShow: 'color' })
      expect(validateRow('statuses', row)).toBe(true)
      expect(rowFixes('statuses', row)).toEqual(['emoji dropped'])
      expect(sanitizeRow('statuses', row)).toEqual(status({}))
    }
  })

  it('refuses an emoji that isn’t text', () => {
    expect(validateRow('statuses', status({ emoji: 5 }))).toContain('emoji')
  })
})
