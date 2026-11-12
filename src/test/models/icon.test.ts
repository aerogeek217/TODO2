import { describe, it, expect } from 'vitest'
import {
  asEmoji,
  emojiFromField,
  iconDescription,
  iconSummary,
  isEmoji,
  isIconValue,
  pickIconValue,
  recentEmoji,
  sameIcon,
} from '../../models/icon'

describe('asEmoji (J7: one grapheme with the emoji property, no list)', () => {
  it.each(['🚀', '📅', '👍🏽', '👨‍👩‍👧', '🇺🇸', '1️⃣', '❤️', '🏳️‍🌈'])('takes %s', (e) => {
    expect(asEmoji(e)).toBe(e)
    expect(isEmoji(e)).toBe(true)
  })

  it('adds the emoji variation selector to a text-style pictograph', () => {
    expect(asEmoji('☺')).toBe('☺️')
    expect(isEmoji('☺')).toBe(false)
  })

  it.each(['', 'a', '1', '#', 'ab', '🚀🔥', 'rocket🚀', ' 🚀', '→', '©x'])('refuses %j', (t) => {
    expect(asEmoji(t)).toBeNull()
  })
})

describe('emojiFromField (the OS panel’s leftovers)', () => {
  it('keeps the one emoji, dropping the text around it', () => {
    expect(emojiFromField('rocket🚀')).toEqual({ emoji: '🚀' })
    expect(emojiFromField('🚀 ')).toEqual({ emoji: '🚀' })
  })

  it('says so for two emoji', () => {
    expect(emojiFromField('🚀🔥')).toEqual({ problem: 'Pick one emoji at a time.' })
  })

  it('is null for text without one', () => {
    expect(emojiFromField('rocket')).toBeNull()
    expect(emojiFromField('')).toBeNull()
  })
})

describe('the stored icon value', () => {
  it('reads the three kinds', () => {
    expect(isIconValue({ kind: 'none' })).toBe(true)
    expect(isIconValue({ kind: 'line', key: 'flag' })).toBe(true)
    expect(isIconValue({ kind: 'emoji', emoji: '🚀' })).toBe(true)
    expect(isIconValue({ kind: 'emoji', emoji: '🚀', show: 'color' })).toBe(true)
    expect(isIconValue({ kind: 'emoji', emoji: '🚀', show: 'muted' })).toBe(true)
  })

  it.each([
    null, 'flag', [], { kind: 'line', key: 'nope' }, { kind: 'emoji', emoji: 'a' }, { kind: 'emoji', emoji: '🚀🔥' },
    { kind: 'emoji', emoji: '🚀', show: 'bright' }, { kind: 'status' },
  ])('refuses %j', (v) => {
    expect(isIconValue(v)).toBe(false)
    expect(pickIconValue(v)).toBeUndefined()
  })

  it('picks only the model’s keys; muted is the default and is dropped', () => {
    expect(pickIconValue({ kind: 'line', key: 'flag', extra: 1 })).toEqual({ kind: 'line', key: 'flag' })
    expect(pickIconValue({ kind: 'emoji', emoji: '🚀', show: 'muted' })).toEqual({ kind: 'emoji', emoji: '🚀' })
    expect(pickIconValue({ kind: 'none', key: 'x' })).toEqual({ kind: 'none' })
  })

  it('compares values (muted equals no show)', () => {
    expect(sameIcon({ kind: 'emoji', emoji: '🚀', show: 'color' }, { kind: 'emoji', emoji: '🚀' })).toBe(false)
    expect(sameIcon({ kind: 'line', key: 'flag' }, { kind: 'line', key: 'flag' })).toBe(true)
    expect(sameIcon(undefined, { kind: 'none' })).toBe(false)
  })

  it('words for controls', () => {
    expect(iconDescription({ kind: 'emoji', emoji: '📅' })).toBe('Emoji 📅, muted')
    expect(iconSummary({ kind: 'emoji', emoji: '📅', show: 'color' })).toBe('Emoji · Color')
    expect(iconDescription({ kind: 'line', key: 'flag' })).toBe('Flag icon')
    expect(iconSummary({ kind: 'none' })).toBe('No icon')
  })
})

describe('recentEmoji (J6)', () => {
  it('lists each emoji once, in the order met, nothing else', () => {
    expect(recentEmoji([
      { kind: 'emoji', emoji: '🚀' }, undefined, { kind: 'line', key: 'flag' }, { kind: 'emoji', emoji: '🔥', show: 'color' }, { kind: 'emoji', emoji: '🚀' },
    ])).toEqual(['🚀', '🔥'])
    expect(recentEmoji([])).toEqual([])
  })
})
