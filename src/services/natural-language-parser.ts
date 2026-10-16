import type { RecurrenceType } from '../models'
import { normalizeTag } from '../utils/tags'
import {
  COMMAND_SHAPE,
  lookupSlashCommand,
  parseCommandDate,
  parseRepeatArgument,
  takesArgument,
  type SlashCommandName,
} from './slash-commands'
import { collapseWhitespace } from '../utils/text'

/**
 * Task-text parser. Only explicit tokens set metadata:
 *  - `@name` / `@"First Last"` — people (looked up by `nlp-resolver`);
 *    like `#` and `/`, only at the start of the text or after whitespace;
 *  - `#tag` — tags (lookup-or-create on submit);
 *  - slash commands (`services/slash-commands`): `/urgent`, `/important`,
 *    `/focus`, `/due <date>`, `/followup <date|interval|none>`,
 *    `/repeat <frequency>`, `/status <name>`.
 * Everything else — dates, weekday names, `every week` — is plain title
 * text. The parser is store-free; `nlp-resolver.resolveInput` matches names.
 */

export interface ParsedToken {
  type: 'person' | 'tag' | 'command'
  /** The command, for `type: 'command'`. */
  command?: SlashCommandName
  /** Person / tag name, or the command's argument as typed (`''` for flags). */
  value: string
  raw: string
  start: number
  end: number
}

/**
 * Something typed that looks like a command but sets nothing:
 *  - `unknown` — `/urgnt` (not a command; stays in the title);
 *  - `unreadable` — the argument can't be read, or is missing (`/due frday`,
 *    `/status` at the end; stays in the title);
 *  - `duplicate` — a second `/due` (… `/followup`, `/repeat`, `/status`):
 *    the first wins, later ones stay in the title;
 *  - `ignored` — `/repeat` without a `/due` date: dropped from the title,
 *    sets nothing (repeating is anchored on the due date);
 *  - `unmatched` — `/status` naming no status (set by `nlp-resolver`; stays
 *    in the title).
 */
export interface CommandProblem {
  kind: 'unknown' | 'unreadable' | 'duplicate' | 'ignored' | 'unmatched'
  command?: SlashCommandName
  raw: string
  start: number
  end: number
}

export interface ParsedInput {
  /** The text parsed (input capped at `MAX_INPUT_LENGTH`). */
  text: string
  /** `text` with every token removed, whitespace collapsed. */
  title: string
  /** Recognised tokens in text order (problems excluded). */
  tokens: ParsedToken[]
  dueDate?: Date
  /** From `/repeat` — only applied when there is a due date to anchor on. */
  recurrence?: RecurrenceType
  persons: string[]
  /** User-supplied tag names in first-seen order (trimmed, original case
   * preserved). Dedup is by case-folded slug so `#Foo` and `#foo` collapse to
   * one entry — the first-seen case wins. Resolver lookup is also
   * case-insensitive (`nlp-resolver.resolveTags`). */
  tags: string[]
  /** Raw status name from `/status`; resolved by `resolveInput`. */
  status?: string
  urgent: boolean
  important: boolean
  focus: boolean
  /** From `/followup <date|interval>`. */
  nextFollowupAt?: Date
  /** `/followup none`: the task gets no next follow-up (not the default). */
  followupNone: boolean
  problems: CommandProblem[]
}

// `@` mentions name a person. Whitespace-anchored like `#tag` and `/command`
// (group 1 = the separator), so `bob@acme.com`, `a@b` or `(@Dana` are plain
// text. The parser stays store-free and emits `'person'`-typed tokens;
// `nlp-resolver.ts` looks the names up.
const MENTION_PATTERN = /(^|\s)@(?:"([^"]+)"|(\w+))/g
// Whitespace-anchored #tag — group 1 is the leading separator (empty at start
// of input) and group 2 is the slug. Separator stays in the remaining title
// after token removal.
const TAG_PATTERN = /(^|\s)#([A-Za-z0-9_-]+)/g
// Whitespace-anchored `/word` (group 2) running to whitespace or the end.
const SLASH_PATTERN = /(^|\s)\/(\S+)/g

/** Most words a date argument may span (`Tue 13 Oct 2026`). */
const MAX_DATE_WORDS = 4

const MAX_INPUT_LENGTH = 500

interface Word { text: string; start: number; end: number }

/**
 * The whitespace-separated words of `text` from `from`, stopping before a
 * word that starts another token (`@`, `#`, `/`). At most `max`.
 */
function wordsFrom(text: string, from: number, max: number): Word[] {
  const out: Word[] = []
  const re = /\S+/g
  re.lastIndex = from
  let m: RegExpExecArray | null
  while (out.length < max && (m = re.exec(text)) !== null) {
    if (/^[@#/]/.test(m[0])) break
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Index of the first non-blank character at or after `from` on the same run of spaces. */
function skipSpaces(text: string, from: number): number {
  let i = from
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  return i
}

interface ArgumentMatch { value: string; end: number }

/** The argument after a command ending at `nameEnd`, or null when it can't be read. */
function readArgument(
  command: SlashCommandName,
  text: string,
  nameEnd: number,
  today: Date,
): { arg: ArgumentMatch; date?: Date; recurrence?: RecurrenceType; none?: boolean } | null {
  const argStart = skipSpaces(text, nameEnd)
  if (argStart === nameEnd) return null // no space after the command
  if (command === 'status') {
    if (text[argStart] === '"') {
      const close = text.indexOf('"', argStart + 1)
      if (close < 0) return null
      const name = text.slice(argStart + 1, close).trim()
      return name ? { arg: { value: name, end: close + 1 } } : null
    }
    const [word] = wordsFrom(text, argStart, 1)
    if (!word || word.start !== argStart) return null
    return { arg: { value: word.text, end: word.end } }
  }
  if (command === 'repeat') {
    const [word] = wordsFrom(text, argStart, 1)
    if (!word || word.start !== argStart) return null
    const recurrence = parseRepeatArgument(word.text)
    return recurrence ? { arg: { value: word.text, end: word.end }, recurrence } : null
  }
  // due / followup: the longest run of words that reads as a date.
  const words = wordsFrom(text, argStart, MAX_DATE_WORDS)
  if (words[0]?.start !== argStart) return null
  if (command === 'followup' && words[0].text.toLowerCase() === 'none') {
    return { arg: { value: words[0].text, end: words[0].end }, none: true }
  }
  for (let n = words.length; n > 0; n--) {
    const last = words[n - 1]
    if (!last) continue
    const value = text.slice(argStart, last.end)
    const date = parseCommandDate(value, today)
    if (date) return { arg: { value, end: last.end }, date }
  }
  return null
}

/** `text` with the given spans removed, whitespace collapsed and trimmed. */
export function removeSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  let out = text
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + out.slice(s.end)
  }
  return collapseWhitespace(out)
}

export function parseInput(input: string, today: Date = new Date()): ParsedInput {
  const text = input.slice(0, MAX_INPUT_LENGTH)
  const tokens: ParsedToken[] = []
  const problems: CommandProblem[] = []
  let match: RegExpExecArray | null

  // Slash commands first: their arguments own the words they read.
  const seen = new Set<SlashCommandName>()
  let dueDate: Date | undefined
  let recurrence: RecurrenceType | undefined
  let repeatToken: ParsedToken | undefined
  let status: string | undefined
  let nextFollowupAt: Date | undefined
  let followupNone = false
  const flags = { urgent: false, important: false, focus: false }
  SLASH_PATTERN.lastIndex = 0
  while ((match = SLASH_PATTERN.exec(text)) !== null) {
    const sep = match[1] ?? ''
    const word = match[2] ?? ''
    const start = match.index + sep.length
    const nameEnd = start + 1 + word.length
    if (!COMMAND_SHAPE.test(word)) continue // a path, URL fragment, `/2`…
    const spec = lookupSlashCommand(word)
    if (!spec) {
      problems.push({ kind: 'unknown', raw: text.slice(start, nameEnd), start, end: nameEnd })
      continue
    }
    const command = spec.name
    if (!takesArgument(command)) {
      flags[command as 'urgent' | 'important' | 'focus'] = true
      tokens.push({ type: 'command', command, value: '', raw: text.slice(start, nameEnd), start, end: nameEnd })
      continue
    }
    const read = readArgument(command, text, nameEnd, today)
    if (!read) {
      // The argument as far as one word, for the problem line.
      const [arg] = wordsFrom(text, skipSpaces(text, nameEnd), 1)
      const end = arg && arg.start === skipSpaces(text, nameEnd) && arg.start > nameEnd ? arg.end : nameEnd
      problems.push({ kind: 'unreadable', command, raw: text.slice(start, end), start, end })
      SLASH_PATTERN.lastIndex = end
      continue
    }
    const end = read.arg.end
    if (seen.has(command)) {
      problems.push({ kind: 'duplicate', command, raw: text.slice(start, end), start, end })
      SLASH_PATTERN.lastIndex = end
      continue
    }
    seen.add(command)
    const token: ParsedToken = { type: 'command', command, value: read.arg.value, raw: text.slice(start, end), start, end }
    tokens.push(token)
    if (command === 'due') dueDate = read.date
    if (command === 'followup') {
      if (read.none) followupNone = true
      else nextFollowupAt = read.date
    }
    if (command === 'repeat') { recurrence = read.recurrence; repeatToken = token }
    if (command === 'status') status = read.arg.value
    SLASH_PATTERN.lastIndex = end
  }
  if (repeatToken && !dueDate) {
    tokens.splice(tokens.indexOf(repeatToken), 1)
    // Kept on `recurrence`: a due date set elsewhere (the editor's picker)
    // can still anchor it; with none, every applier drops it.
    problems.push({ kind: 'ignored', command: 'repeat', raw: repeatToken.raw, start: repeatToken.start, end: repeatToken.end })
  }

  const inCommand = (start: number, end: number) =>
    tokens.some((t) => start < t.end && end > t.start) || problems.some((p) => start < p.end && end > p.start)

  // @-mentions (@name or @"First Last").
  const persons: string[] = []
  MENTION_PATTERN.lastIndex = 0
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const value = match[2] ?? match[3]
    const start = match.index + (match[1]?.length ?? 0)
    const end = match.index + match[0].length
    if (value == null || inCommand(start, end)) continue
    tokens.push({ type: 'person', value, raw: text.slice(start, end), start, end })
    persons.push(value)
  }

  // Tags (#name) — whitespace-preceded or at start of input; the leading
  // separator in group 1 stays in the title.
  const tags: string[] = []
  const seenTags = new Set<string>()
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    const sep = match[1]
    const name = match[2]
    if (sep == null || name == null) continue
    const start = match.index + sep.length
    const end = start + 1 + name.length
    if (inCommand(start, end)) continue
    tokens.push({ type: 'tag', value: name, raw: text.slice(start, end), start, end })
    // Dedup by case-folded slug (`normalizeTag`), but keep the user-supplied
    // case (trimmed) so `#FooBar` round-trips as `FooBar`.
    const slug = normalizeTag(name)
    if (slug && !seenTags.has(slug)) {
      seenTags.add(slug)
      tags.push(name.trim())
    }
  }

  tokens.sort((a, b) => a.start - b.start)
  problems.sort((a, b) => a.start - b.start)
  // Recognised tokens leave the title; so does an ignored `/repeat`.
  const removed = [...tokens, ...problems.filter((p) => p.kind === 'ignored')]

  return {
    text,
    title: removeSpans(text, removed),
    tokens,
    dueDate,
    recurrence,
    persons,
    tags,
    status,
    ...flags,
    nextFollowupAt,
    followupNone,
    problems,
  }
}
