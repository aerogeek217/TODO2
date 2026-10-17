import { describe, it, expect, afterEach, vi } from 'vitest'
import { SHORTCUT_IDS, shortcutSpec } from '../../models/keyboard-shortcut'
import {
  formatShortcutOverrides,
  readShortcutOverrides,
  resolveBindings,
  shortcutLabel,
  shortcutRefusal,
  withShortcut,
} from '../../utils/shortcut-bindings'
import { parseChord } from '../../utils/shortcut-chord'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

const chord = (text: string) => {
  const c = parseChord(text)
  if (!c) throw new Error(`not a chord: ${text}`)
  return c
}

describe('the shortcut table', () => {
  it('has no clashing defaults', () => {
    expect(readShortcutOverrides('{}').dropped).toEqual([])
    for (const id of SHORTCUT_IDS) {
      if (!shortcutSpec(id).editable) continue
      // Each editable default passes the rules against the other defaults.
      expect(shortcutRefusal(id, shortcutSpec(id).chord, {}), id).toBeNull()
    }
  })
})

describe('resolveBindings / shortcutLabel', () => {
  it('uses the override for its id and the default for the rest', () => {
    stubPlatform('Win32')
    const overrides = { 'command-palette': chord('Mod-Shift-p') }
    expect(resolveBindings(overrides)['command-palette']).toEqual(chord('Mod-Shift-p'))
    expect(resolveBindings(overrides).undo).toEqual(shortcutSpec('undo').chord)
    expect(shortcutLabel('command-palette', overrides)).toBe('Ctrl+Shift+P')
    expect(shortcutLabel('open-settings', {})).toBe('G then S')
  })
})

describe('shortcutRefusal', () => {
  it('accepts free keys', () => {
    expect(shortcutRefusal('focus-filters', chord('Shift-f'), {})).toBeNull()
    expect(shortcutRefusal('open-settings', chord('g o'), {})).toBeNull()
    expect(shortcutRefusal('command-palette', chord('Mod-Alt-p'), {})).toBeNull()
  })

  it('refuses a fixed binding', () => {
    expect(shortcutRefusal('close-overlay', chord('q'), {})).toMatch(/can't be changed/)
  })

  it('refuses keys another binding uses, naming it', () => {
    stubPlatform('Win32')
    expect(shortcutRefusal('focus-filters', chord('Mod-k'), {})).toBe('Ctrl+K is already used by Command Palette.')
    // Fixed bindings count too, in either Shift state.
    expect(shortcutRefusal('focus-filters', chord('Shift-ArrowUp'), {})).toMatch(/already used by Select previous/)
    // An override's keys, not its default's.
    const overrides = { 'command-palette': chord('Mod-Shift-p') }
    expect(shortcutRefusal('focus-filters', chord('Mod-k'), overrides)).toBeNull()
    expect(shortcutRefusal('focus-filters', chord('Mod-Shift-p'), overrides)).toMatch(/Command Palette/)
  })

  it('refuses a single key that starts a sequence, and a sequence starting with a used key', () => {
    expect(shortcutRefusal('focus-filters', chord('g'), {})).toBe('G starts G then S (Open Settings).')
    expect(shortcutRefusal('open-settings', chord('f s'), {})).toBe('F is already used by Focus filters, so a sequence can\'t start with it.')
    expect(shortcutRefusal('open-settings', chord('g s'), {})).toBeNull()
  })

  it('refuses the keys the app reserves, with any modifiers', () => {
    stubPlatform('Win32')
    expect(shortcutRefusal('focus-filters', chord('Escape'), {})).toMatch(/^Esc closes dialogs/)
    expect(shortcutRefusal('focus-filters', chord('Mod-Enter'), {})).toMatch(/^Enter confirms/)
    expect(shortcutRefusal('undo', chord('Shift-Tab'), {})).toMatch(/^Tab moves the focus/)
  })

  it('refuses browser keys', () => {
    stubPlatform('Win32')
    expect(shortcutRefusal('undo', chord('Mod-w'), {})).toBe('Ctrl+W is used by the browser (Close tab).')
    expect(shortcutRefusal('undo', chord('Mod-Shift-t'), {})).toMatch(/Reopen closed tab/)
    expect(shortcutRefusal('undo', chord('F5'), {})).toMatch(/Reload/)
    expect(shortcutRefusal('undo', chord('Mod-3'), {})).toMatch(/Switch tab/)
  })

  it('makes a binding that fires while typing keep Ctrl, stay one combo and leave text-editing keys alone', () => {
    stubPlatform('Win32')
    expect(shortcutRefusal('quick-add', chord('q'), {})).toBe('Quick Add task also works while typing, so it needs Ctrl (or a function key).')
    expect(shortcutRefusal('quick-add', chord('F2'), {})).toBeNull()
    expect(shortcutRefusal('quick-add', chord('q a'), {})).toMatch(/can't be a two-key sequence/)
    expect(shortcutRefusal('quick-add', chord('Mod-c'), {})).toBe('Ctrl+C is used in text fields (Copy).')
    expect(shortcutRefusal('quick-add', chord('Alt-t'), {})).toMatch(/needs Ctrl/)
    expect(shortcutRefusal('quick-add', chord('Mod-b'), {})).toMatch(/Bold/)
    // A binding that doesn't fire while typing may use them.
    expect(shortcutRefusal('focus-filters', chord('Alt-t'), {})).toBeNull()
  })

  it('refuses a sequence of keys with modifiers', () => {
    expect(shortcutRefusal('open-settings', [{ key: 'g', mod: true }, { key: 's' }], {})).toMatch(/two plain keys/)
  })
})

describe('withShortcut / formatShortcutOverrides', () => {
  it('stores only changed bindings, in table order', () => {
    let o = withShortcut({}, 'open-settings', chord('g o'))
    o = withShortcut(o, 'quick-add', chord('Mod-Shift-Space'))
    expect(formatShortcutOverrides(o)).toBe('{"quick-add":"Mod-Shift-Space","open-settings":"g o"}')
    o = withShortcut(o, 'open-settings', chord('g s'))
    expect(formatShortcutOverrides(o)).toBe('{"quick-add":"Mod-Shift-Space"}')
    expect(formatShortcutOverrides(withShortcut(o, 'quick-add', null))).toBe('{}')
  })
})

describe('readShortcutOverrides', () => {
  it('reads what the editor writes', () => {
    const text = '{"command-palette":"Mod-Shift-p","open-settings":"g o"}'
    const { overrides, dropped } = readShortcutOverrides(text)
    expect(dropped).toEqual([])
    expect(formatShortcutOverrides(overrides)).toBe(text)
  })

  it('resets unreadable text', () => {
    expect(readShortcutOverrides('not json')).toEqual({ overrides: {}, dropped: ['unreadable keyboard shortcuts reset'] })
    expect(readShortcutOverrides('["Mod-Shift-p"]').overrides).toEqual({})
  })

  it('drops unknown ids, fixed bindings, unreadable keys and refused keys, naming each', () => {
    stubPlatform('Win32')
    const { overrides, dropped } = readShortcutOverrides(JSON.stringify({
      nope: 'Mod-Shift-p',
      'close-overlay': 'q',
      undo: 42,
      redo: 'Mod-Mod-y',
      'select-all': 'Mod-w',
      'focus-filters': 'Shift-f',
    }))
    expect(formatShortcutOverrides(overrides)).toBe('{"focus-filters":"Shift-f"}')
    expect(dropped).toEqual([
      'unknown shortcut "nope" dropped',
      "Close overlay / Clear selection: can't be changed — dropped",
      'Undo: unreadable keys dropped',
      'Redo: unreadable keys dropped',
      'Select all visible tasks: Ctrl+W is used by the browser (Close tab) — dropped',
    ])
  })

  it('drops clashing overrides until none clash, keeping a swap that works as a whole', () => {
    // undo ⇄ redo: neither clashes once both are in.
    const swap = readShortcutOverrides('{"undo":"Mod-y","redo":"Mod-z"}')
    expect(swap.dropped).toEqual([])
    // Two overrides on the same keys: the later one goes.
    const both = readShortcutOverrides('{"focus-filters":"n","toggle-complete":"n"}')
    expect(formatShortcutOverrides(both.overrides)).toBe('{"focus-filters":"n"}')
    expect(both.dropped).toEqual(['Toggle complete: clashes with Focus filters — dropped'])
    // An override on a default's keys: the override goes.
    const onDefault = readShortcutOverrides('{"focus-filters":"Mod-k"}')
    expect(onDefault.overrides).toEqual({})
    expect(onDefault.dropped).toEqual(['Focus filters: clashes with Command Palette — dropped'])
  })

  it('quietly drops an override equal to the default', () => {
    expect(readShortcutOverrides('{"open-settings":"g s"}')).toEqual({ overrides: {}, dropped: [] })
  })
})
