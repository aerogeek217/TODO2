import type { ParsedInput } from './natural-language-parser'
import type { ResolvedInput } from './nlp-resolver'
import type { SlashCommandName } from './slash-commands'

/**
 * How each recognised token is tinted where task text is typed:
 *  - `chip` — `#tag`, a known `@person`, `/status …`, a token still being typed;
 *  - `new` — an `@name` that matches nobody (created with the task);
 *  - `due` / `urgent` / `followup` (`/important`, `/followup …`) /
 *    `accent` (`/focus`, `/repeat …`) — the command's marker / pill colour;
 *  - `error` — an argument that can't be read, or a status that doesn't exist;
 *  - `ignored` — recognised but ignored (`/repeat` without `/due`, a repeat).
 * Unknown commands get no tint: they are plain title text.
 */
export type TokenTint = 'chip' | 'new' | 'due' | 'urgent' | 'followup' | 'accent' | 'error' | 'ignored'

export interface TintSpan { start: number; end: number; tint: TokenTint }

const COMMAND_TINT: Record<SlashCommandName, TokenTint> = {
  urgent: 'urgent',
  important: 'followup',
  focus: 'accent',
  due: 'due',
  followup: 'followup',
  repeat: 'accent',
  status: 'chip',
}

/**
 * The tinted spans of `parsed.text`, in order and non-overlapping. `active`
 * is the token the autocomplete popup is open on: it shows as `chip` while
 * being typed unless it already reads as a command (or the popup shows an
 * error for it).
 */
export function tokenTints(
  parsed: ParsedInput,
  resolved: Pick<ResolvedInput, 'unmatchedPersons' | 'problems'>,
  active?: { start: number; end: number; error: boolean },
): TintSpan[] {
  const unmatched = new Set(resolved.unmatchedPersons.map((n) => n.toLowerCase()))
  const spans: TintSpan[] = []
  for (const t of parsed.tokens) {
    if (t.type === 'person') spans.push({ start: t.start, end: t.end, tint: unmatched.has(t.value.toLowerCase()) ? 'new' : 'chip' })
    else if (t.type === 'tag') spans.push({ start: t.start, end: t.end, tint: 'chip' })
    else if (t.command) spans.push({ start: t.start, end: t.end, tint: COMMAND_TINT[t.command] })
  }
  for (const p of resolved.problems ?? parsed.problems) {
    if (p.kind === 'unknown') continue
    // A `/status` naming nothing is no longer a recognised token.
    const i = spans.findIndex((s) => s.start === p.start && s.end === p.end)
    if (i >= 0) spans.splice(i, 1)
    spans.push({ start: p.start, end: p.end, tint: p.kind === 'unreadable' || p.kind === 'unmatched' ? 'error' : 'ignored' })
  }
  if (active && active.end > active.start) {
    const covered = spans.some((s) => s.tint !== 'error' && s.tint !== 'ignored' && s.start <= active.start && s.end >= active.end)
    if (!covered && !active.error) {
      const kept = spans.filter((s) => s.end <= active.start || s.start >= active.end)
      kept.push({ start: active.start, end: active.end, tint: 'chip' })
      return kept.sort((a, b) => a.start - b.start)
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}
