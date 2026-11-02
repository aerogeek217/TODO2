/**
 * Sequence and word diffs (LCS), for showing what an edit changes — the
 * check-in reply import's notes line diff and its redlined progress / notes
 * lines.
 */

/** One step of a sequence diff: `=` kept (both indexes), `-` removed (from `a`), `+` added (from `b`). */
export type SequenceOp = { op: '='; a: number; b: number } | { op: '-'; a: number } | { op: '+'; b: number }

/** The middle of `a` and `b` past their common prefix and suffix: `[start, endA)` / `[start, endB)`. */
function middle(a: readonly string[], b: readonly string[]) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { start, endA, endB }
}

/**
 * The cells `diffSequences` would run its LCS over (the middle's length × the
 * other's): over its `maxCells`, the diff is everything removed then added.
 */
export function lcsCells(a: readonly string[], b: readonly string[]): number {
  const { start, endA, endB } = middle(a, b)
  return (endA - start) * (endB - start)
}

/**
 * The diff of `a` → `b` in order: the common prefix and suffix, then an LCS
 * of the middle — or, when the middle is over `maxCells` (its length × the
 * other's, `lcsCells`), everything in it removed then added (keeps huge
 * inputs fast). Within a change, removals come before additions.
 */
export function diffSequences(a: readonly string[], b: readonly string[], maxCells: number): SequenceOp[] {
  const { start, endA, endB } = middle(a, b)
  const ops: SequenceOp[] = []
  for (let i = 0; i < start; i++) ops.push({ op: '=', a: i, b: i })
  const n = endA - start
  const m = endB - start
  if (n * m > maxCells) {
    for (let i = start; i < endA; i++) ops.push({ op: '-', a: i })
    for (let j = start; j < endB; j++) ops.push({ op: '+', b: j })
  } else {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB).
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
      const row = lcs[i] ?? []
      const below = lcs[i + 1] ?? []
      for (let j = m - 1; j >= 0; j--) {
        row[j] = a[start + i] === b[start + j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push({ op: '=', a: start + i, b: start + j })
        i++
        j++
      } else if (i < n && (j >= m || (lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0))) {
        // Removed before added (an edit reads `-` then `+`).
        ops.push({ op: '-', a: start + i })
        i++
      } else {
        ops.push({ op: '+', b: start + j })
        j++
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ op: '=', a: endA + k, b: endB + k })
  return ops
}

export interface WordDiffPart {
  /** `=` in both, `-` only in the old text, `+` only in the new text. */
  op: '=' | '-' | '+'
  text: string
}

/** Above this many token pairs the word diff skips the LCS: all removed, then all added. */
export const WORD_DIFF_MAX_CELLS = 250_000

/** Words (letters / digits, an inner apostrophe kept), whitespace runs, and each other character on its own. */
const TOKEN = /[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*|\s+|[^]/gu

/** `text` as diff tokens; joined, they give `text` back. */
export function wordTokens(text: string): string[] {
  return text.match(TOKEN) ?? []
}

const isSpace = (text: string) => text.trim() === ''

/**
 * The word diff of `from` → `to`: the parts in reading order, adjacent parts
 * of one kind merged. Joining the `=` and `-` parts gives `from`; the `=` and
 * `+` parts give `to`. Within a change the removed text comes first, then the
 * added text, and whitespace kept between two changes joins them into one
 * (`a b` → `x y` reads as `a b` removed, `x y` added — not word by word).
 */
export function wordDiff(from: string, to: string): WordDiffPart[] {
  const a = wordTokens(from)
  const b = wordTokens(to)
  const ops = diffSequences(a, b, WORD_DIFF_MAX_CELLS)
  const steps: WordDiffPart[] = ops.map((o) =>
    o.op === '=' ? { op: '=', text: a[o.a] ?? '' } : o.op === '-' ? { op: '-', text: a[o.a] ?? '' } : { op: '+', text: b[o.b] ?? '' })

  // Kept whitespace between two changes belongs to the change.
  const kept = (i: number) => steps[i]?.op === '='
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step?.op !== '=' || !isSpace(step.text)) continue
    let end = i
    while (end + 1 < steps.length && kept(end + 1) && isSpace(steps[end + 1]?.text ?? '')) end++
    const before = steps[i - 1]
    const after = steps[end + 1]
    if (before && after && before.op !== '=' && after.op !== '=') {
      const space = steps.slice(i, end + 1).map((s) => s.text).join('')
      steps.splice(i, end + 1 - i, { op: '-', text: space }, { op: '+', text: space })
      i++
    } else {
      i = end
    }
  }

  // Each run of changes: its removed text, then its added text.
  const parts: WordDiffPart[] = []
  const push = (op: WordDiffPart['op'], text: string) => {
    if (text === '') return
    const last = parts.at(-1)
    if (last?.op === op) last.text += text
    else parts.push({ op, text })
  }
  let removed = ''
  let added = ''
  const flush = () => {
    push('-', removed)
    push('+', added)
    removed = ''
    added = ''
  }
  for (const step of steps) {
    if (step.op === '=') {
      flush()
      push('=', step.text)
    } else if (step.op === '-') {
      removed += step.text
    } else {
      added += step.text
    }
  }
  flush()
  return parts
}
