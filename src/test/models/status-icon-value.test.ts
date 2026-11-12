import { describe, expect, it } from 'vitest'
import {
  iconDescription, iconSummary, layoutIcon, recentEmoji, sameIcon, statusGlyphLabel, statusIconValue, statusLookAfterPick,
} from '../../models/icon'
import { layoutIcons, statusIcons } from '../../hooks/use-recent-emoji'
import { emptyBody } from '../helpers/layout-builders'
import type { WorkspaceLayout } from '../../models/workspace-layout'

describe('a status’s icon (J17)', () => {
  it('is its emoji where it has one, else its glyph, else the default glyph', () => {
    expect(statusIconValue({})).toEqual({ kind: 'status', key: 'circle' })
    expect(statusIconValue({ icon: 'clock' })).toEqual({ kind: 'status', key: 'clock' })
    expect(statusIconValue({ icon: 'clock', emoji: '⏳' })).toEqual({ kind: 'emoji', emoji: '⏳' })
    expect(statusIconValue({ icon: 'clock', emoji: '⏳', emojiShow: 'color' })).toEqual({ kind: 'emoji', emoji: '⏳', show: 'color' })
    // Not one emoji (never stored so): the glyph.
    expect(statusIconValue({ icon: 'clock', emoji: 'x' })).toEqual({ kind: 'status', key: 'clock' })
  })

  it('a glyph pick drops the emoji; an emoji pick keeps the glyph underneath; No icon and line icons are refused', () => {
    expect(statusLookAfterPick({ icon: 'clock', emoji: '⏳' }, { kind: 'status', key: 'star' })).toEqual({ icon: 'star' })
    expect(statusLookAfterPick({ icon: 'clock' }, { kind: 'emoji', emoji: '⏳', show: 'color' })).toEqual({ icon: 'clock', emoji: '⏳', emojiShow: 'color' })
    expect(statusLookAfterPick({}, { kind: 'emoji', emoji: '⏳' })).toEqual({ emoji: '⏳' })
    expect(statusLookAfterPick({ icon: 'clock' }, { kind: 'none' })).toBeNull()
    expect(statusLookAfterPick({ icon: 'clock' }, { kind: 'line', key: 'flag' })).toBeNull()
  })

  it('names its glyphs (snooze draws an inbox)', () => {
    expect(statusGlyphLabel('message-bubble')).toBe('Message bubble')
    expect(statusGlyphLabel('snooze')).toBe('Inbox')
    expect(iconDescription({ kind: 'status', key: 'clock' })).toBe('Clock icon')
    expect(iconSummary({ kind: 'status', key: 'stop-sign' })).toBe('Icon · Stop sign')
    expect(sameIcon({ kind: 'status', key: 'clock' }, { kind: 'status', key: 'clock' })).toBe(true)
    expect(sameIcon({ kind: 'status', key: 'clock' }, { kind: 'status', key: 'star' })).toBe(false)
  })
})

describe('a layout’s icon (J1)', () => {
  it('is the layout glyph until one is picked; No icon is none', () => {
    expect(layoutIcon({})).toEqual({ kind: 'line', key: 'layout' })
    expect(layoutIcon({ icon: { kind: 'none' } })).toEqual({ kind: 'none' })
    expect(layoutIcon({ icon: { kind: 'emoji', emoji: '🏠' } })).toEqual({ kind: 'emoji', emoji: '🏠' })
  })
})

describe('Recent (J6): the emoji on tabs, layouts and statuses', () => {
  const layout = (id: number, icon: WorkspaceLayout['icon'], tabEmoji?: string): WorkspaceLayout & { id: number } => {
    const body = emptyBody()
    return {
      id, name: `L${id}`, sortOrder: id, createdAt: new Date(), modifiedAt: new Date(), ...body,
      ...(icon ? { icon } : {}),
      cells: tabEmoji
        ? [{ id: `c${id}`, area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: `t${id}`, kind: 'notes', config: {}, icon: { kind: 'emoji', emoji: tabEmoji } }], activeTabId: `t${id}` }]
        : [],
    } as WorkspaceLayout & { id: number }
  }

  it('the open layout first (its own icon, then its tabs), then the other layouts, then the statuses in their order; each once', () => {
    const a = layout(1, { kind: 'emoji', emoji: '🏠' }, '📅')
    const b = layout(2, { kind: 'emoji', emoji: '🚀', show: 'color' }, '🏠')
    const c = layout(3, { kind: 'line', key: 'flag' })
    const icons = [...layoutIcons([a, b, c], b), ...statusIcons([{ icon: 'clock', emoji: '⏳' }, { icon: 'star' }, { emoji: '📅' }])]
    expect(recentEmoji(icons)).toEqual(['🚀', '🏠', '📅', '⏳'])
  })

  it('starts empty', () => {
    expect(recentEmoji([...layoutIcons([layout(1, undefined)], null), ...statusIcons([{ icon: 'clock' }])])).toEqual([])
  })
})
