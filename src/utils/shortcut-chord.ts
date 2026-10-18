/**
 * Keyboard chords (`models/keyboard-shortcut`): the stored text form, labels,
 * matching a `keydown` and recording one.
 *
 * Text form: a combo is `[Mod-][Alt-][Shift-]<key>` (`Mod-Shift-z`, `Mod--`
 * for Ctrl+minus), a sequence is two plain keys separated by a space (`g s`).
 */
import type { KeyCombo, ShortcutChord } from '../models/keyboard-shortcut'
import { isMacLike } from './platform'

/** The named (non-character) keys a shortcut may use, in their stored spelling. */
const NAMED_KEYS = [
  'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const

const NAMED_BY_LOWER = new Map<string, string>(NAMED_KEYS.map((k) => [k.toLowerCase(), k]))

/** `name` in its stored spelling: a printable character lowercased, or a named key; null otherwise. */
export function canonicalKey(name: string): string | null {
  if (name === ' ') return 'Space'
  if ([...name].length === 1) return /\s/.test(name) || name < ' ' ? null : name.toLowerCase()
  return NAMED_BY_LOWER.get(name.toLowerCase()) ?? null
}

/** A key that types a character (letter, digit, punctuation). */
export function isCharacterKey(key: string): boolean {
  return [...key].length === 1
}

/** Whether `key` is a function key (F1–F12). */
export function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(key)
}

/** A character key other than a letter or digit: the character already says whether Shift was down. */
function shiftImplied(key: string): boolean {
  return isCharacterKey(key) && !/^[a-z0-9]$/.test(key)
}

function ignoresShift(c: KeyCombo): boolean {
  return c.shiftAny === true || shiftImplied(c.key)
}

/** A key a sequence can use: a plain character key, no modifiers. */
export function isSequenceKey(c: KeyCombo): boolean {
  return isCharacterKey(c.key) && !c.mod && !c.alt && !c.shift
}

function parseCombo(text: string): KeyCombo | null {
  let rest = text
  const combo: { mod?: boolean; alt?: boolean; shift?: boolean } = {}
  for (;;) {
    const m = /^(Mod|Alt|Shift)-(.+)$/.exec(rest)
    if (!m) break
    const flag = m[1] === 'Mod' ? 'mod' : m[1] === 'Alt' ? 'alt' : 'shift'
    if (combo[flag]) return null
    combo[flag] = true
    rest = m[2] ?? ''
  }
  const key = canonicalKey(rest)
  if (key === null) return null
  return {
    key,
    ...(combo.mod ? { mod: true } : {}),
    ...(combo.alt ? { alt: true } : {}),
    ...(combo.shift && !shiftImplied(key) ? { shift: true } : {}),
  }
}

/** The chord a stored text spells; null when it isn't one (a sequence takes two plain character keys). */
export function parseChord(text: string): ShortcutChord | null {
  const parts = text.split(' ')
  if (parts.length === 1) {
    const only = parseCombo(parts[0] ?? '')
    return only ? [only] : null
  }
  if (parts.length !== 2) return null
  const first = parseCombo(parts[0] ?? '')
  const second = parseCombo(parts[1] ?? '')
  if (!first || !second || !isSequenceKey(first) || !isSequenceKey(second)) return null
  return [first, second]
}

function comboText(c: KeyCombo): string {
  return `${c.mod ? 'Mod-' : ''}${c.alt ? 'Alt-' : ''}${c.shift && !ignoresShift(c) ? 'Shift-' : ''}${c.key}`
}

/** The stored text of a chord (`parseChord`'s inverse). */
export function formatChordText(chord: ShortcutChord): string {
  return chord.map(comboText).join(' ')
}

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
}

/** The Mod key's name: `Ctrl`, or `⌘` on a Mac. */
export function modKeyLabel(): string {
  return isMacLike() ? '⌘' : 'Ctrl'
}

/** One combo as the user reads it: `Ctrl+Shift+Z` (`⌘⇧Z` on a Mac). */
export function comboLabel(c: KeyCombo): string {
  const mac = isMacLike()
  const parts: string[] = []
  if (c.mod) parts.push(modKeyLabel())
  if (c.shift && !ignoresShift(c)) parts.push(mac ? '⇧' : 'Shift')
  if (c.alt) parts.push(mac ? '⌥' : 'Alt')
  parts.push(KEY_LABELS[c.key] ?? (isCharacterKey(c.key) ? c.key.toUpperCase() : c.key))
  return parts.join(mac ? '' : '+')
}

/** A chord as the user reads it: `Ctrl+K`, `G then S`. */
export function chordLabel(chord: ShortcutChord): string {
  return chord.map(comboLabel).join(' then ')
}

/**
 * With Ctrl / ⌘ / Alt down, the letter or digit of the key's position — only
 * when the key didn't type a Latin letter or digit itself (Alt+T types `†` on
 * a Mac; a Cyrillic layout types `я`). A key that types one goes by that
 * letter: on a German keyboard Ctrl + the key labelled Y is Ctrl+Y, though it
 * sits where QWERTY has Z.
 */
function physicalKey(e: KeyboardEvent): string | null {
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return null
  if (/^[a-z0-9]$/i.test(e.key)) return null
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
  const physical = m?.[1] ?? m?.[2]
  return physical ? physical.toLowerCase() : null
}

/** The key names a `keydown` stands for: its `key`, and its position's letter or digit where `physicalKey` gives one. */
function eventKeys(e: KeyboardEvent): string[] {
  const keys = [e.key === ' ' ? 'space' : e.key.toLowerCase()]
  if (e.code === 'Space') keys.push('space')
  const physical = physicalKey(e)
  if (physical) keys.push(physical)
  return keys
}

/** Whether a `keydown` is this combo. Ctrl and ⌘ both count as Mod. */
export function comboMatchesEvent(e: KeyboardEvent, c: KeyCombo): boolean {
  if ((c.mod ?? false) !== (e.ctrlKey || e.metaKey)) return false
  if ((c.alt ?? false) !== e.altKey) return false
  if (!ignoresShift(c) && (c.shift ?? false) !== e.shiftKey) return false
  return eventKeys(e).includes(c.key.toLowerCase())
}

/** Whether a `keydown` is this sequence key: no Ctrl / ⌘ / Alt, either Shift state. */
export function sequenceKeyMatchesEvent(e: KeyboardEvent, c: KeyCombo): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return e.key.toLowerCase() === c.key.toLowerCase()
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS', 'Hyper', 'Super', 'CapsLock', 'Fn'])

/** Whether the key pressed is a modifier on its own (recording waits for the real key). */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(e.key)
}

/**
 * The combo a `keydown` records, or null for a key a shortcut can't use (a
 * dead key, an IME key, a media key). With Ctrl / ⌘ / Alt down, a key that
 * types no Latin letter or digit is recorded by its position (`physicalKey`).
 */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const mod = e.ctrlKey || e.metaKey
  let key: string | null = physicalKey(e)
  key ??= e.code === 'Space' ? 'Space' : canonicalKey(e.key)
  if (key === null) return null
  return {
    key,
    ...(mod ? { mod: true } : {}),
    ...(e.altKey ? { alt: true } : {}),
    ...(e.shiftKey && !shiftImplied(key) ? { shift: true } : {}),
  }
}

function combosOverlap(a: KeyCombo, b: KeyCombo): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false
  if ((a.mod ?? false) !== (b.mod ?? false) || (a.alt ?? false) !== (b.alt ?? false)) return false
  return ignoresShift(a) || ignoresShift(b) || (a.shift ?? false) === (b.shift ?? false)
}

/** Whether two chords are the same keys (a key press would match both). */
export function chordsOverlap(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.length === b.length && a.every((c, i) => {
    const other = b[i]
    return other !== undefined && combosOverlap(c, other)
  })
}

/** Whether a single-key chord `single` is the first key of the sequence `sequence`. */
export function startsSequence(single: ShortcutChord, sequence: ShortcutChord): boolean {
  const [only] = single
  const [first] = sequence
  return single.length === 1 && sequence.length === 2 && only !== undefined && first !== undefined && combosOverlap(only, first)
}
