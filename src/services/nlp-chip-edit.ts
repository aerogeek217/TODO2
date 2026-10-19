import type { MarkerKey, Person } from '../models'
import type { ParsedInput } from './natural-language-parser'
import { matchPerson } from './nlp-resolver'
import type { SlashCommandName } from './slash-commands'

/**
 * Quick Add's chip ×: the chips are read from the typed text, so removing
 * one edits the text — the tokens the chip came from are cut out (a chip
 * that is the default, the follow-up, adds `/followup none` instead). Pure
 * functions over (text, caret); the bar applies the result to its input.
 */

/** The text after an edit, and where the caret goes. */
export interface TextEdit { text: string; caret: number }

interface Span { start: number; end: number }

/** What a Quick Add chip shows — the key its × removes. */
export type QuickAddChip =
  | { kind: 'marker'; marker: MarkerKey }
  | { kind: 'tag'; name: string }
  | { kind: 'person'; personId: number }
  | { kind: 'newPerson'; name: string }
  | { kind: 'command'; command: 'due' | 'followup' | 'repeat' | 'status' }

/** What the default follow-up chip's × adds: no next follow-up. */
export const FOLLOWUP_NONE_TOKEN = '/followup none'

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch)

/**
 * `text` without the given spans. Each cut leaves one space between the
 * words around it — none at the start or the end of the text; the rest of
 * the text's spacing is kept as typed. The caret keeps its place in the
 * text around the cuts (inside a cut, it goes where the cut was).
 *
 * One pass, last cut first: the text left of a cut is still as typed, the
 * text right of it is final (kept pieces, collected in reverse) — so the
 * work is linear in the text, however many spans there are.
 */
export function removeTextSpans(text: string, spans: readonly Span[], caret: number): TextEdit {
  let at = Math.max(0, Math.min(caret, text.length))
  const ordered = [...spans]
    .filter((s) => s.start < s.end && s.start >= 0 && s.end <= text.length)
    .sort((a, b) => b.start - a.start)
  // The text right of the last cut, as pieces in reverse order; `skip` is
  // how many leading characters of the newest piece a cut has dropped.
  const right: string[] = []
  let skip = 0
  /** The first character right of the cut (`undefined` at the end of the text). */
  const rightFirst = (): string | undefined => {
    while (right.length > 0) {
      const head = right.at(-1) ?? ''
      if (skip < head.length) return head[skip]
      right.pop()
      skip = 0
    }
    return undefined
  }
  // `text.slice(0, cursor)` is the text left of every cut so far, as typed.
  let cursor = text.length
  let lastStart = Infinity
  for (const { start, end } of ordered) {
    if (end > lastStart) continue // overlaps a span already cut
    lastStart = start
    const kept = text.slice(end, cursor)
    if (kept.length > 0) {
      // The newest piece's dropped characters go with it (they were its first ones).
      if (right.length > 0 && skip > 0) right[right.length - 1] = (right.at(-1) ?? '').slice(skip)
      right.push(kept)
      skip = 0
    }
    cursor = Math.min(cursor, start)
    if (at >= end) at -= end - start
    else if (at > start) at = start
    const before = start > 0 ? text[start - 1] : undefined
    const after = rightFirst()
    if ((before === undefined || isSpace(before)) && isSpace(after)) {
      // A doubled space, or a space now leading the text.
      skip += 1
      if (at > start) at -= 1
    } else if (after === undefined && isSpace(before)) {
      // A space now trailing the text.
      cursor = start - 1
      if (at >= start) at -= 1
    }
  }
  if (right.length > 0 && skip > 0) right[right.length - 1] = (right.at(-1) ?? '').slice(skip)
  return { text: text.slice(0, cursor) + right.reverse().join(''), caret: at }
}

/**
 * `text` with `token` added after its last word. The caret stays where it
 * was — one in the trailing space moves past the token, so typing goes on
 * after it; with no text yet the caret ends after the token and a space.
 */
export function appendTextToken(text: string, token: string, caret: number): TextEdit {
  const trimmedEnd = text.trimEnd().length
  if (trimmedEnd === 0) {
    const out = `${token} `
    return { text: out, caret: out.length }
  }
  const insert = ` ${token}`
  const out = text.slice(0, trimmedEnd) + insert + text.slice(trimmedEnd)
  const at = Math.max(0, Math.min(caret, text.length))
  return { text: out, caret: at > trimmedEnd ? at + insert.length : at }
}

const lower = (s: string) => s.trim().toLowerCase()

/**
 * The spans of `input` a chip came from: every token for it (`#Work #work`
 * is one chip; `@Ann @ann` one person) and, for a command, the repeats
 * the first one won over (problem lines, `Repeated:`), so the chip goes
 * rather than the next one taking its place.
 */
export function chipSpans(input: ParsedInput, chip: QuickAddChip, people: readonly Person[]): Span[] {
  switch (chip.kind) {
    case 'marker':
      return input.tokens.filter((t) => t.type === 'command' && t.command === chip.marker)
    case 'tag':
      return input.tokens.filter((t) => t.type === 'tag' && lower(t.value) === lower(chip.name))
    case 'person':
      return input.tokens.filter((t) => t.type === 'person' && matchPerson(t.value, people)?.id === chip.personId)
    case 'newPerson':
      return input.tokens.filter((t) =>
        t.type === 'person' && lower(t.value) === lower(chip.name) && matchPerson(t.value, people) === undefined)
    case 'command': {
      const command: SlashCommandName = chip.command
      return [
        ...input.tokens.filter((t) => t.type === 'command' && t.command === command),
        ...input.problems.filter((p) => p.kind === 'duplicate' && p.command === command),
      ]
    }
  }
}

/** `text` (parsed as `input`) without what `chip` came from. */
export function removeChip(
  text: string,
  input: ParsedInput,
  chip: QuickAddChip,
  people: readonly Person[],
  caret: number,
): TextEdit {
  return removeTextSpans(text, chipSpans(input, chip, people), caret)
}
