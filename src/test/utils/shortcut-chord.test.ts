import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  chordLabel,
  chordsOverlap,
  comboFromEvent,
  comboMatchesEvent,
  formatChordText,
  isModifierOnly,
  parseChord,
  sequenceKeyMatchesEvent,
  startsSequence,
} from '../../utils/shortcut-chord'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

function ev(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init)
}

describe('parseChord / formatChordText', () => {
  it('reads combos with modifiers in any order and writes them back canonically', () => {
    expect(parseChord('Mod-k')).toEqual([{ key: 'k', mod: true }])
    expect(parseChord('Shift-Mod-Z')).toEqual([{ key: 'z', mod: true, shift: true }])
    expect(formatChordText(parseChord('Shift-Alt-Mod-p')!)).toBe('Mod-Alt-Shift-p')
  })

  it('reads named keys case-insensitively in their stored spelling', () => {
    expect(parseChord('Mod-space')).toEqual([{ key: 'Space', mod: true }])
    expect(parseChord('f2')).toEqual([{ key: 'F2' }])
    expect(parseChord('arrowup')).toEqual([{ key: 'ArrowUp' }])
  })

  it('reads the minus key after a modifier', () => {
    expect(parseChord('Mod--')).toEqual([{ key: '-', mod: true }])
    expect(parseChord('-')).toEqual([{ key: '-' }])
  })

  it('drops Shift on punctuation (the character already says it)', () => {
    expect(parseChord('Shift-?')).toEqual([{ key: '?' }])
  })

  it('reads a two-key sequence of plain keys only', () => {
    expect(parseChord('g s')).toEqual([{ key: 'g' }, { key: 's' }])
    expect(parseChord('Mod-g s')).toBeNull()
    expect(parseChord('g Space')).toBeNull()
    expect(parseChord('g s t')).toBeNull()
  })

  it('refuses text that is no chord', () => {
    expect(parseChord('')).toBeNull()
    expect(parseChord('Mod-')).toBeNull()
    expect(parseChord('Mod-Mod-k')).toBeNull()
    expect(parseChord('Shift')).toBeNull()
    expect(parseChord('NotAKey')).toBeNull()
  })
})

describe('chordLabel', () => {
  it('spells Mod as Ctrl with + on Windows', () => {
    stubPlatform('Win32')
    expect(chordLabel([{ key: 'z', mod: true, shift: true }])).toBe('Ctrl+Shift+Z')
    expect(chordLabel([{ key: 'Space', mod: true }])).toBe('Ctrl+Space')
    expect(chordLabel([{ key: 'Escape' }])).toBe('Esc')
  })

  it('uses the Mac symbols without separators', () => {
    stubPlatform('MacIntel')
    expect(chordLabel([{ key: 'z', mod: true, shift: true }])).toBe('⌘⇧Z')
    expect(chordLabel([{ key: 't', alt: true }])).toBe('⌥T')
  })

  it('reads a sequence as "G then S"', () => {
    expect(chordLabel([{ key: 'g' }, { key: 's' }])).toBe('G then S')
  })
})

describe('comboMatchesEvent', () => {
  it('counts Ctrl and ⌘ as Mod, strict on Shift and Alt', () => {
    expect(comboMatchesEvent(ev({ key: 'k', ctrlKey: true }), { key: 'k', mod: true })).toBe(true)
    expect(comboMatchesEvent(ev({ key: 'k', metaKey: true }), { key: 'k', mod: true })).toBe(true)
    expect(comboMatchesEvent(ev({ key: 'K', ctrlKey: true, shiftKey: true }), { key: 'k', mod: true })).toBe(false)
    expect(comboMatchesEvent(ev({ key: 'k', ctrlKey: true, altKey: true }), { key: 'k', mod: true })).toBe(false)
  })

  it('ignores Shift for punctuation and for shiftAny combos', () => {
    expect(comboMatchesEvent(ev({ key: '?', shiftKey: true }), { key: '?' })).toBe(true)
    expect(comboMatchesEvent(ev({ key: 'ArrowUp', shiftKey: true }), { key: 'ArrowUp', shiftAny: true })).toBe(true)
    expect(comboMatchesEvent(ev({ key: 'ArrowUp' }), { key: 'ArrowUp', shiftAny: true })).toBe(true)
  })

  it('matches Space by key or code', () => {
    expect(comboMatchesEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }), { key: 'Space', mod: true })).toBe(true)
    expect(comboMatchesEvent(ev({ key: ' ' }), { key: 'Space' })).toBe(true)
  })

  it('matches a letter by its physical key when Alt changes the character', () => {
    expect(comboMatchesEvent(ev({ key: '†', code: 'KeyT', altKey: true }), { key: 't', alt: true })).toBe(true)
  })

  it('goes by the letter typed, not the key position, when the key types a letter or digit', () => {
    // German QWERTZ: the key labelled Y sits where QWERTY has Z.
    expect(comboMatchesEvent(ev({ key: 'y', code: 'KeyZ', ctrlKey: true }), { key: 'z', mod: true })).toBe(false)
    expect(comboMatchesEvent(ev({ key: 'y', code: 'KeyZ', ctrlKey: true }), { key: 'y', mod: true })).toBe(true)
    // French AZERTY: A / Q and W / Z swapped.
    expect(comboMatchesEvent(ev({ key: 'w', code: 'KeyZ', ctrlKey: true }), { key: 'z', mod: true })).toBe(false)
    expect(comboMatchesEvent(ev({ key: 'q', code: 'KeyA', ctrlKey: true }), { key: 'a', mod: true })).toBe(false)
    // A layout without Latin letters still reaches the shortcut by position.
    expect(comboMatchesEvent(ev({ key: 'я', code: 'KeyZ', ctrlKey: true }), { key: 'z', mod: true })).toBe(true)
  })
})

describe('sequenceKeyMatchesEvent', () => {
  it('matches the key in either Shift state, never with Ctrl / Alt', () => {
    expect(sequenceKeyMatchesEvent(ev({ key: 'S', shiftKey: true }), { key: 's' })).toBe(true)
    expect(sequenceKeyMatchesEvent(ev({ key: 's', ctrlKey: true }), { key: 's' })).toBe(false)
  })
})

describe('comboFromEvent', () => {
  it('records letters lowercase with their modifiers', () => {
    expect(comboFromEvent(ev({ key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true }))).toEqual({ key: 'j', mod: true, shift: true })
    expect(comboFromEvent(ev({ key: 'n', code: 'KeyN' }))).toEqual({ key: 'n' })
  })

  it('records punctuation without Shift and Space by name', () => {
    expect(comboFromEvent(ev({ key: '?', code: 'Slash', shiftKey: true }))).toEqual({ key: '?' })
    expect(comboFromEvent(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toEqual({ key: 'Space', mod: true })
  })

  it('records the letter typed on a non-QWERTY layout', () => {
    expect(comboFromEvent(ev({ key: 'y', code: 'KeyZ', ctrlKey: true }))).toEqual({ key: 'y', mod: true })
    expect(comboFromEvent(ev({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toEqual({ key: 'z', mod: true })
  })

  it('records the physical letter when Alt is down', () => {
    expect(comboFromEvent(ev({ key: 'ß', code: 'KeyS', altKey: true }))).toEqual({ key: 's', alt: true })
  })

  it('returns null for keys a shortcut cannot use', () => {
    expect(comboFromEvent(ev({ key: 'Dead', code: 'Quote' }))).toBeNull()
    expect(comboFromEvent(ev({ key: 'Unidentified' }))).toBeNull()
  })

  it('tells a lone modifier apart', () => {
    expect(isModifierOnly(ev({ key: 'Control', ctrlKey: true }))).toBe(true)
    expect(isModifierOnly(ev({ key: 'k' }))).toBe(false)
  })
})

describe('chordsOverlap / startsSequence', () => {
  it('treats a punctuation key as the same keys in either Shift state', () => {
    expect(chordsOverlap([{ key: '?' }], [{ key: '?', shift: true }])).toBe(true)
    expect(chordsOverlap([{ key: 'z', mod: true }], [{ key: 'z', mod: true, shift: true }])).toBe(false)
  })

  it('finds a single key that is the first key of a sequence', () => {
    expect(startsSequence([{ key: 'g' }], [{ key: 'g' }, { key: 's' }])).toBe(true)
    expect(startsSequence([{ key: 'g', shift: true }], [{ key: 'g' }, { key: 's' }])).toBe(false)
    expect(startsSequence([{ key: 'g' }, { key: 's' }], [{ key: 'g' }, { key: 's' }])).toBe(false)
  })
})
