import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expressionResolver, expressionTints } from '../../services/filter-expression-field'
import { parseInput } from '../../services/natural-language-parser'
import { resolveInput } from '../../services/nlp-resolver'
import { tokenTints, type TokenTint } from '../../services/nlp-token-tints'
import { parseSearch, searchTints } from '../../services/search-tokens'
import { parseExpression } from '../../utils/filter-expression'
import { SRC } from '../styles/css-source'

/**
 * A priority typed as a token is tinted in the priority's own color (cr34
 * T9): `/urgent`, `/important` and `/focus` each carry their own tint in
 * every map that tints typed text — Quick Add's and the notes editor's
 * (`tokenTints`), the top bar's filter field (`searchTints`) and a filter
 * expression (`expressionTints`) — and every tint a map can give has a rule
 * in each stylesheet that draws it (a tint with no rule draws as plain
 * text). The fields in a real browser — the colors as drawn, a Theme colors
 * override reaching them — are `e2e/priority-tints.spec.ts`.
 */

const TODAY = new Date(2026, 9, 10)
const PRIORITIES = ['urgent', 'important', 'focus'] as const
const TYPED = '/urgent /important /focus'

/** Each tinted span as `text:tint`. */
const read = (text: string, spans: ReadonlyArray<{ start: number; end: number; tint: TokenTint }>) =>
  spans.map((s) => `${text.slice(s.start, s.end)}:${s.tint}`)

const EACH_ITS_OWN = ['/urgent:urgent', '/important:important', '/focus:focus']

describe('a typed priority carries its own tint', () => {
  it('in task text (Quick Add, the notes editor)', () => {
    const parsed = parseInput(`Call ${TYPED}`, TODAY)
    expect(read(parsed.text, tokenTints(parsed, resolveInput(parsed, [], [])))).toEqual(EACH_ITS_OWN)
  })

  it('in the top bar’s filter field', () => {
    const parse = parseSearch(`${TYPED} `, { people: [], tags: [], statuses: [], today: TODAY })
    expect(read(`${TYPED} `, searchTints(parse))).toEqual(EACH_ITS_OWN)
  })

  it('in a filter expression', () => {
    const text = '/urgent or /important and not /focus'
    const parse = parseExpression(text, { today: TODAY, names: expressionResolver([], [], []) })
    expect(parse.ok).toBe(true)
    expect(read(text, expressionTints(parse.spans, null))).toEqual([
      '/urgent:urgent', 'or:operator', '/important:important', 'and:operator', 'not:operator', '/focus:focus',
    ])
  })
})

/**
 * Every tint, by where it is drawn. Typed as the whole union, so a new tint
 * doesn't compile until it says which stylesheets must draw it.
 */
const TINT_SHEETS: Record<TokenTint, readonly Sheet[]> = {
  chip: ['mirror', 'notes'],
  new: ['mirror', 'notes'],
  due: ['mirror', 'notes', 'chips'],
  urgent: ['mirror', 'notes', 'chips'],
  important: ['mirror', 'notes', 'chips'],
  focus: ['mirror', 'notes', 'chips'],
  followup: ['mirror', 'notes', 'chips'],
  accent: ['mirror', 'notes', 'chips'],
  error: ['mirror', 'notes'],
  ignored: ['mirror', 'notes'],
  // A filter expression's words: never in a note or on a Quick Add chip.
  operator: ['mirror'],
}

type Sheet = 'mirror' | 'notes' | 'chips'

/** The three stylesheets that draw a tint, and the selector each uses. */
const SHEETS: Record<Sheet, { file: string; rule: (tint: string) => string }> = {
  // A field's mirror (`TintedText`): Quick Add, the filter field, an expression field, the Review field's pills.
  mirror: { file: 'components/shared/TintedText.module.css', rule: (t) => `.tint[data-tint="${t}"]` },
  notes: { file: 'components/task/notes/NotesEditor.module.css', rule: (t) => `.cm-nlp-tint[data-tint="${t}"]` },
  // Quick Add's chips row.
  chips: { file: 'components/task/QuickAddBar.module.css', rule: (t) => `.chip[data-tint="${t}"]` },
}

/** The declarations of the rule for `selector` in `css` (`null`: no such rule). */
function ruleBody(css: string, selector: string): string | null {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('every tint has a rule where it is drawn', () => {
  for (const [sheet, { file, rule }] of Object.entries(SHEETS) as [Sheet, (typeof SHEETS)[Sheet]][]) {
    const css = readFileSync(join(SRC, file), 'utf8')
    const drawn = (Object.keys(TINT_SHEETS) as TokenTint[]).filter((t) => TINT_SHEETS[t].includes(sheet))

    it(`${file}: ${drawn.join(', ')}`, () => {
      for (const tint of drawn) expect(ruleBody(css, rule(tint)), `${rule(tint)} in ${file}`).not.toBeNull()
    })

    it(`${file}: a priority is drawn in its own color and fill`, () => {
      for (const priority of PRIORITIES) {
        const body = ruleBody(css, rule(priority)) ?? ''
        // Focus has a text token of its own (the accent's text color until it is overridden).
        const text = priority === 'focus' ? '--color-marker-focus-text' : `--color-marker-${priority}`
        expect(body, `${rule(priority)} color`).toMatch(new RegExp(`\\bcolor:\\s*var\\(${text}\\)`))
        expect(body, `${rule(priority)} fill`).toMatch(new RegExp(`background:\\s*var\\(--color-marker-${priority}-bg\\)`))
      }
    })
  }
})
