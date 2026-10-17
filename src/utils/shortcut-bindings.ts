/**
 * The live keyboard bindings (defaults + the user's overrides) and the rules
 * a new binding must pass: no key the app or the browser reserves, nothing
 * that would take another binding's keys, and keys that still work for a
 * binding that fires while typing. Also reads and writes the stored
 * overrides (`settings.keyboardShortcuts`, a JSON object of chord texts by id).
 */
import {
  SHORTCUT_CATEGORIES,
  SHORTCUT_IDS,
  SHORTCUT_INFO_ROWS,
  isShortcutId,
  shortcutSpec,
  type KeyCombo,
  type ShortcutCategory,
  type ShortcutChord,
  type ShortcutId,
  type ShortcutOverrides,
} from '../models/keyboard-shortcut'
import {
  chordLabel,
  chordsOverlap,
  comboLabel,
  formatChordText,
  isFunctionKey,
  isSequenceKey,
  modKeyLabel,
  parseChord,
  startsSequence,
} from './shortcut-chord'
import { isRecord } from './is-record'
import { formatShortcut } from './platform'

export type ResolvedBindings = Readonly<Record<ShortcutId, ShortcutChord>>

/** Every binding's keys: the user's override, else the default. */
export function resolveBindings(overrides: ShortcutOverrides): ResolvedBindings {
  return Object.fromEntries(
    SHORTCUT_IDS.map((id) => [id, overrides[id] ?? shortcutSpec(id).chord]),
  ) as Record<ShortcutId, ShortcutChord>
}

/** The label of `id`'s live keys (`Ctrl+K`, `G then S`). */
export function shortcutLabel(id: ShortcutId, overrides: ShortcutOverrides): string {
  return chordLabel(overrides[id] ?? shortcutSpec(id).chord)
}

interface ReservedCombo {
  combo: KeyCombo
  what: string
}

const mod = (key: string, extra: Partial<KeyCombo> = {}): KeyCombo => ({ key, mod: true, ...extra })

/** Keys the app keeps for its dialogs, menus and forms, whatever the modifiers. */
const APP_RESERVED_KEYS: Readonly<Record<string, string>> = {
  Escape: 'closes dialogs and menus',
  Tab: 'moves the focus',
  Enter: 'confirms dialogs and forms',
}

/** Browser keys a page can't (or shouldn't) take over. */
const BROWSER_RESERVED: readonly ReservedCombo[] = [
  { combo: mod('t'), what: 'New tab' },
  { combo: mod('n'), what: 'New window' },
  { combo: mod('w'), what: 'Close tab' },
  { combo: mod('q'), what: 'Quit' },
  { combo: mod('l'), what: 'Address bar' },
  { combo: mod('r'), what: 'Reload' },
  { combo: mod('r', { shift: true }), what: 'Reload' },
  { combo: mod('t', { shift: true }), what: 'Reopen closed tab' },
  { combo: mod('n', { shift: true }), what: 'New private window' },
  { combo: mod('w', { shift: true }), what: 'Close window' },
  { combo: mod('q', { shift: true }), what: 'Quit' },
  { combo: mod('p'), what: 'Print' },
  { combo: mod('s'), what: 'Save page' },
  { combo: mod('o'), what: 'Open file' },
  { combo: mod('d'), what: 'Bookmark' },
  { combo: mod('h'), what: 'History / Hide window' },
  { combo: mod('j'), what: 'Downloads' },
  { combo: mod('u'), what: 'View source' },
  { combo: mod('e'), what: 'Search' },
  { combo: mod('g'), what: 'Find next' },
  { combo: mod('g', { shift: true }), what: 'Find previous' },
  { combo: mod('m'), what: 'Minimize window' },
  { combo: mod('b', { shift: true }), what: 'Bookmarks bar' },
  { combo: mod('o', { shift: true }), what: 'Bookmarks' },
  { combo: mod('i', { shift: true }), what: 'Developer tools' },
  { combo: mod('j', { shift: true }), what: 'Developer tools' },
  { combo: mod('c', { shift: true }), what: 'Developer tools' },
  { combo: mod('i', { alt: true }), what: 'Developer tools' },
  { combo: mod('j', { alt: true }), what: 'Developer tools' },
  { combo: mod('c', { alt: true }), what: 'Developer tools' },
  { combo: mod('Delete', { shift: true }), what: 'Clear browsing data' },
  { combo: mod('Backspace', { shift: true }), what: 'Clear browsing data' },
  { combo: mod('PageUp'), what: 'Previous tab' },
  { combo: mod('PageDown'), what: 'Next tab' },
  { combo: mod('='), what: 'Zoom in' },
  { combo: mod('+'), what: 'Zoom in' },
  { combo: mod('-'), what: 'Zoom out' },
  { combo: mod('0'), what: 'Reset zoom' },
  { combo: mod(','), what: 'Preferences' },
  { combo: mod('F5'), what: 'Reload' },
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({ combo: mod(d), what: 'Switch tab' })),
  { combo: { key: 'F1' }, what: 'Help' },
  { combo: { key: 'F3' }, what: 'Find next' },
  { combo: { key: 'F5' }, what: 'Reload' },
  { combo: { key: 'F5', shift: true }, what: 'Reload' },
  { combo: { key: 'F6' }, what: 'Address bar' },
  { combo: { key: 'F7' }, what: 'Caret browsing' },
  { combo: { key: 'F10' }, what: 'Browser menu' },
  { combo: { key: 'F11' }, what: 'Full screen' },
  { combo: { key: 'F12' }, what: 'Developer tools' },
  { combo: { key: 'F4', alt: true }, what: 'Close window' },
  { combo: { key: 'ArrowLeft', alt: true }, what: 'Back' },
  { combo: { key: 'ArrowRight', alt: true }, what: 'Forward' },
  { combo: { key: 'Home', alt: true }, what: 'Home page' },
  { combo: { key: 'd', alt: true }, what: 'Address bar' },
  { combo: { key: 'e', alt: true }, what: 'Browser menu' },
  { combo: { key: 'f', alt: true }, what: 'Browser menu' },
]

/**
 * Keys text fields and the notes editor use. A binding that fires while
 * typing can't take them (it would steal them from every text field).
 */
const TEXT_EDITING_RESERVED: readonly ReservedCombo[] = [
  { combo: mod('a'), what: 'Select all text' },
  { combo: mod('c'), what: 'Copy' },
  { combo: mod('v'), what: 'Paste' },
  { combo: mod('x'), what: 'Cut' },
  { combo: mod('z'), what: 'Undo typing' },
  { combo: mod('y'), what: 'Redo typing' },
  { combo: mod('z', { shift: true }), what: 'Redo typing' },
  { combo: mod('b'), what: 'Bold' },
  { combo: mod('i'), what: 'Italic' },
  { combo: mod('k', { shift: true }), what: 'Delete line' },
  { combo: mod('['), what: 'Outdent' },
  { combo: mod(']'), what: 'Indent' },
  { combo: mod('/'), what: 'Toggle comment' },
  { combo: mod('Backspace'), what: 'Delete word' },
  { combo: mod('Delete'), what: 'Delete word' },
  { combo: mod('Home'), what: 'Go to start' },
  { combo: mod('End'), what: 'Go to end' },
  { combo: mod('ArrowLeft'), what: 'Move by word' },
  { combo: mod('ArrowRight'), what: 'Move by word' },
  { combo: mod('ArrowUp'), what: 'Move the cursor' },
  { combo: mod('ArrowDown'), what: 'Move the cursor' },
  { combo: { key: 't', alt: true }, what: 'Convert line to task' },
  { combo: { key: 'ArrowUp', alt: true }, what: 'Move line' },
  { combo: { key: 'ArrowDown', alt: true }, what: 'Move line' },
  { combo: { key: 'Backspace', alt: true }, what: 'Delete word' },
  { combo: { key: 'Delete', alt: true }, what: 'Delete word' },
]

function reservedFor(combo: KeyCombo, table: readonly ReservedCombo[]): string | null {
  return table.find((r) => chordsOverlap([r.combo], [combo]))?.what ?? null
}

/**
 * Why `chord` can't be `id`'s keys on its own terms (before looking at the
 * other bindings), or null when it can.
 */
function ruleRefusal(id: ShortcutId, chord: ShortcutChord): string | null {
  const spec = shortcutSpec(id)
  if (!spec.editable) return `${spec.description} can't be changed.`
  const label = chordLabel(chord)
  const [first, second] = chord
  if (!first) return 'No keys were pressed.'
  if (second && (!isSequenceKey(first) || !isSequenceKey(second))) {
    return 'A two-key sequence takes two plain keys (no Ctrl, Alt or Shift).'
  }
  for (const combo of chord) {
    const appUse = APP_RESERVED_KEYS[combo.key]
    if (appUse) return `${comboLabel({ key: combo.key })} ${appUse}, so it can't be a shortcut.`
  }
  if (!second) {
    const browser = reservedFor(first, BROWSER_RESERVED)
    if (browser) return `${label} is used by the browser (${browser}).`
  }
  if (spec.allowInInput) {
    if (second) return `${spec.description} also works while typing, so it can't be a two-key sequence.`
    if (!first.mod && !isFunctionKey(first.key)) {
      return `${spec.description} also works while typing, so it needs ${modKeyLabel()} (or a function key).`
    }
    const editing = reservedFor(first, TEXT_EDITING_RESERVED)
    if (editing) return `${label} is used in text fields (${editing}).`
  }
  return null
}

/** Why `chord` would clash with `other`'s keys, or null. */
function clash(chord: ShortcutChord, other: ShortcutChord, otherName: string): string | null {
  if (chordsOverlap(chord, other)) return `${chordLabel(chord)} is already used by ${otherName}.`
  if (startsSequence(chord, other)) return `${chordLabel(chord)} starts ${chordLabel(other)} (${otherName}).`
  if (startsSequence(other, chord)) {
    return `${chordLabel(other)} is already used by ${otherName}, so a sequence can't start with it.`
  }
  return null
}

/**
 * Why `id` can't take `chord` given the current overrides, or null when it
 * can: the rules above, then a clash with any other live binding — the same
 * keys, or a key that is the first key of a sequence (and the reverse).
 */
export function shortcutRefusal(id: ShortcutId, chord: ShortcutChord, overrides: ShortcutOverrides): string | null {
  const rule = ruleRefusal(id, chord)
  if (rule) return rule
  const bindings = resolveBindings(overrides)
  for (const other of SHORTCUT_IDS) {
    if (other === id) continue
    const reason = clash(chord, bindings[other], shortcutSpec(other).description)
    if (reason) return reason
  }
  return null
}

/** `overrides` with `id` set to `chord` (dropped when that is its default). */
export function withShortcut(overrides: ShortcutOverrides, id: ShortcutId, chord: ShortcutChord | null): ShortcutOverrides {
  const next: Partial<Record<ShortcutId, ShortcutChord>> = { ...overrides }
  if (chord === null || formatChordText(chord) === formatChordText(shortcutSpec(id).chord)) {
    delete next[id]
  } else {
    next[id] = chord
  }
  return next
}

/** The stored text of the overrides: chord texts by id, in table order. */
export function formatShortcutOverrides(overrides: ShortcutOverrides): string {
  const entries = SHORTCUT_IDS.flatMap((id) => {
    const chord = overrides[id]
    return chord ? [[id, formatChordText(chord)] as const] : []
  })
  return JSON.stringify(Object.fromEntries(entries))
}

export interface ReadShortcutOverrides {
  overrides: ShortcutOverrides
  /** What was dropped, in words (empty when the text was clean). */
  dropped: string[]
}

/**
 * The overrides a stored text holds. Anything the editor couldn't have saved
 * is dropped and named: unreadable text, an unknown or fixed binding, keys
 * that aren't a chord, keys the rules refuse, and bindings that clash (the
 * later one in table order goes until none do). An override equal to the
 * default is dropped quietly.
 */
export function readShortcutOverrides(text: string): ReadShortcutOverrides {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  if (!isRecord(raw)) return { overrides: {}, dropped: ['unreadable keyboard shortcuts reset'] }

  const dropped: string[] = []
  let overrides: ShortcutOverrides = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isShortcutId(key)) {
      dropped.push(`unknown shortcut "${key}" dropped`)
      continue
    }
    const name = shortcutSpec(key).description
    if (!shortcutSpec(key).editable) {
      dropped.push(`${name}: can't be changed — dropped`)
      continue
    }
    const chord = typeof value === 'string' ? parseChord(value) : null
    if (!chord) {
      dropped.push(`${name}: unreadable keys dropped`)
      continue
    }
    const refusal = ruleRefusal(key, chord)
    if (refusal) {
      dropped.push(`${name}: ${refusal.replace(/\.$/, '')} — dropped`)
      continue
    }
    overrides = withShortcut(overrides, key, chord)
  }

  // Clashes: drop the later override of the first clashing pair until none clash.
  for (;;) {
    const bindings = resolveBindings(overrides)
    const pair = firstClash(bindings)
    if (!pair) break
    const [a, b] = pair
    const drop = overrides[b] ? b : a
    const other = drop === b ? a : b
    dropped.push(`${shortcutSpec(drop).description}: clashes with ${shortcutSpec(other).description} — dropped`)
    overrides = withShortcut(overrides, drop, null)
  }
  return { overrides, dropped }
}

/** The first pair of bindings (in table order) whose keys clash, or null. */
function firstClash(bindings: ResolvedBindings): readonly [ShortcutId, ShortcutId] | null {
  for (let i = 0; i < SHORTCUT_IDS.length; i++) {
    for (let j = i + 1; j < SHORTCUT_IDS.length; j++) {
      const a = SHORTCUT_IDS[i]
      const b = SHORTCUT_IDS[j]
      if (a === undefined || b === undefined) continue
      if (clash(bindings[a], bindings[b], '') !== null) return [a, b]
    }
  }
  return null
}

/** One row of the shortcut lists (the `?` list, Settings › Keyboard shortcuts). */
export interface ShortcutListRow {
  /** The binding, or null for a row about keys another surface owns (the notes editor). */
  id: ShortcutId | null
  /** The live keys as the user reads them. */
  label: string
  description: string
  /** The user can change it. */
  editable: boolean
  /** On keys other than its default. */
  changed: boolean
}

export interface ShortcutListSection {
  category: ShortcutCategory
  label: string
  rows: ShortcutListRow[]
}

/** Every listed binding with its live keys, by category, then the fixed rows other surfaces own. */
export function shortcutListSections(overrides: ShortcutOverrides): ShortcutListSection[] {
  const rows: Array<{ category: ShortcutCategory; row: ShortcutListRow }> = []
  for (const id of SHORTCUT_IDS) {
    const spec = shortcutSpec(id)
    if (spec.unlisted) continue
    const chord = overrides[id]
    rows.push({
      category: spec.category,
      row: {
        id,
        label: spec.docLabel !== undefined ? formatShortcut(spec.docLabel) : chordLabel(chord ?? spec.chord),
        description: spec.description,
        editable: spec.editable,
        changed: chord !== undefined,
      },
    })
  }
  for (const info of SHORTCUT_INFO_ROWS) {
    rows.push({
      category: info.category,
      row: { id: null, label: formatShortcut(info.label), description: info.description, editable: false, changed: false },
    })
  }
  return SHORTCUT_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    rows: rows.filter((r) => r.category === c.id).map((r) => r.row),
  })).filter((s) => s.rows.length > 0)
}
