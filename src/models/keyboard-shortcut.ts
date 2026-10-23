/**
 * The app's keyboard shortcuts: one row per binding, keyed by a stable id.
 *
 * This table is the one source: the dispatcher (`hooks/use-keyboard-shortcuts`
 * with the handlers in `services/keyboard-shortcuts`), the `?` list, Settings ›
 * Keyboard shortcuts (the editor), the palette's hints and the import check of
 * the user's bindings all read it. A user's changes are stored as overrides by
 * id (`settings.keyboardShortcuts`, `utils/shortcut-bindings`); the defaults
 * stay here.
 */

/** One key with its modifiers. `mod` = Ctrl, or ⌘ on a Mac (either counts). */
export interface KeyCombo {
  /**
   * A single character, lowercase for letters (`k`, `/`, `?`), or a named key
   * (`Space`, `Enter`, `Escape`, `Tab`, `Delete`, `ArrowUp`, `F2` …).
   * A character key other than a letter or digit ignores Shift: the
   * character already says which (`?` is Shift+/ on most layouts).
   */
  key: string
  mod?: boolean
  alt?: boolean
  shift?: boolean
  /** Matches either Shift state (the selection keys, whose handlers branch on Shift). Never recorded. */
  shiftAny?: boolean
}

/** One key combo, or a two-key sequence (`G` then `S`) of plain character keys. */
export type ShortcutChord = readonly [KeyCombo] | readonly [KeyCombo, KeyCombo]

export type ShortcutCategory = 'general' | 'navigation' | 'task' | 'notes'

export const SHORTCUT_CATEGORIES: ReadonlyArray<{ id: ShortcutCategory; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'task', label: 'Task Editing' },
  { id: 'notes', label: 'Notes' },
]

export interface ShortcutSpec {
  /** What it does — the list's text and the name a conflict message uses. */
  description: string
  category: ShortcutCategory
  /** The default keys. */
  chord: ShortcutChord
  /** The user can change it (Settings › Keyboard shortcuts). */
  editable: boolean
  /** Fires while a text field has focus too (it must keep Ctrl / ⌘). */
  allowInInput?: boolean
  /** Doesn't fire while the task editor is open. */
  blockedByEditPopup?: boolean
  /**
   * A fixed binding's label in the lists, when one row stands for several
   * bindings (`Up / Down`); written like `formatShortcut` specs.
   */
  docLabel?: string
  /** Has no row of its own in the lists (another row covers it). */
  unlisted?: boolean
}

const one = (combo: KeyCombo): ShortcutChord => [combo]

/** Every binding, in list order within its category. */
export const SHORTCUT_SPECS = {
  'quick-add': {
    description: 'Quick Add task', category: 'general', editable: true, allowInInput: true,
    chord: one({ key: 'Space', mod: true }),
  },
  'command-palette': {
    description: 'Command Palette', category: 'general', editable: true, allowInInput: true,
    chord: one({ key: 'k', mod: true }),
  },
  'close-overlay': {
    description: 'Close overlay / Clear selection', category: 'general', editable: false, allowInInput: true,
    chord: one({ key: 'Escape' }), docLabel: 'Esc',
  },
  undo: {
    description: 'Undo', category: 'general', editable: true,
    chord: one({ key: 'z', mod: true }),
  },
  redo: {
    description: 'Redo', category: 'general', editable: true,
    chord: one({ key: 'y', mod: true }),
  },
  'redo-alt': {
    description: 'Redo (alternative)', category: 'general', editable: true,
    chord: one({ key: 'z', mod: true, shift: true }),
  },
  'select-all': {
    description: 'Select all visible tasks', category: 'general', editable: true,
    chord: one({ key: 'a', mod: true }),
  },
  'show-shortcuts': {
    description: 'Show keyboard shortcuts', category: 'general', editable: true,
    chord: one({ key: '?' }),
  },
  'focus-search': {
    description: 'Focus search', category: 'navigation', editable: true, allowInInput: true,
    chord: one({ key: 'f', mod: true }),
  },
  'focus-search-alt': {
    description: 'Focus search (outside text fields)', category: 'navigation', editable: true,
    chord: one({ key: '/' }),
  },
  'focus-filters': {
    description: 'Focus filters', category: 'navigation', editable: true,
    chord: one({ key: 'f' }),
  },
  'open-settings': {
    description: 'Open Settings', category: 'navigation', editable: true,
    chord: [{ key: 'g' }, { key: 's' }],
  },
  'select-previous': {
    description: 'Select previous / next task', category: 'navigation', editable: false, blockedByEditPopup: true,
    chord: one({ key: 'ArrowUp', shiftAny: true }), docLabel: 'Up / Down',
  },
  'select-next': {
    description: 'Select next task', category: 'navigation', editable: false, blockedByEditPopup: true,
    chord: one({ key: 'ArrowDown', shiftAny: true }), unlisted: true,
  },
  'select-first': {
    description: 'Select first / last task', category: 'navigation', editable: false, blockedByEditPopup: true,
    chord: one({ key: 'Home', shiftAny: true }), docLabel: 'Home / End',
  },
  'select-last': {
    description: 'Select last task', category: 'navigation', editable: false, blockedByEditPopup: true,
    chord: one({ key: 'End', shiftAny: true }), unlisted: true,
  },
  'edit-selected': {
    description: 'Edit selected task', category: 'task', editable: false, blockedByEditPopup: true,
    chord: one({ key: 'Enter' }), docLabel: 'Enter',
  },
  'toggle-complete': {
    description: 'Toggle complete', category: 'task', editable: true, blockedByEditPopup: true,
    chord: one({ key: 'Space' }),
  },
  'delete-selected': {
    description: 'Delete selected task(s)', category: 'task', editable: true, blockedByEditPopup: true,
    chord: one({ key: 'Delete' }),
  },
  'copy-selected': {
    description: 'Copy selected tasks', category: 'task', editable: true, blockedByEditPopup: true,
    chord: one({ key: 'c', mod: true }),
  },
} as const satisfies Record<string, ShortcutSpec>

export type ShortcutId = keyof typeof SHORTCUT_SPECS

/** Every binding id, in table order. */
export const SHORTCUT_IDS = Object.keys(SHORTCUT_SPECS) as ShortcutId[]

export function isShortcutId(value: string): value is ShortcutId {
  return Object.prototype.hasOwnProperty.call(SHORTCUT_SPECS, value)
}

/** The spec of `id` (widened, so optional fields read as such). */
export function shortcutSpec(id: ShortcutId): ShortcutSpec {
  return SHORTCUT_SPECS[id]
}

/** The user's changed bindings by id; an id that isn't here has its default. */
export type ShortcutOverrides = Readonly<Partial<Record<ShortcutId, ShortcutChord>>>

/** A row of the lists that is no binding of its own: keys other surfaces own (fixed). */
export interface ShortcutInfoRow {
  category: ShortcutCategory
  /** A `formatShortcut` spec (`Alt-T`). */
  label: string
  description: string
}

/** Keys shown in the lists but owned elsewhere — never editable. */
export const SHORTCUT_INFO_ROWS: readonly ShortcutInfoRow[] = [
  { category: 'navigation', label: 'Shift+Up / Down', description: 'Extend selection' },
  { category: 'notes', label: 'Alt-T', description: 'Convert current line to task' },
  { category: 'notes', label: 'Mod-B', description: 'Bold' },
  { category: 'notes', label: 'Mod-I', description: 'Italic' },
]
