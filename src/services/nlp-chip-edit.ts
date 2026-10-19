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
 */
export function removeTextSpans(text: string, spans: readonly Span[], caret: number): TextEdit {
  let out = text
  let at = Math.max(0, Math.min(caret, text.length))
  const ordered = [...spans]
    .filter((s) => s.start < s.end && s.start >= 0 && s.end <= text.length)
    .sort((a, b) => b.start - a.start)
  let lastStart = Infinity
  for (const { start, end } of ordered) {
    if (end > lastStart) continue // overlaps a span already cut
    lastStart = start
    out = out.slice(0, start) + out.slice(end)
    if (at >= end) at -= end - start
    else if (at > start) at = start
    const before = out[start - 1]
    const after = out[start]
    if ((before === undefined || isSpace(before)) && isSpace(after)) {
      // A doubled space, or a space now leading the text.
      out = out.slice(0, start) + out.slice(start + 1)
      if (at > start) at -= 1
    } else if (after === undefined && isSpace(before)) {
      // A space now trailing the text.
      out = out.slice(0, start - 1)
      if (at >= start) at -= 1
    }
  }
  return { text: out, caret: at }
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
