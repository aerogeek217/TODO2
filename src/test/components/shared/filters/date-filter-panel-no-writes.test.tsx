import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { DateAnchor, DateFilters } from '../../../../models'
import { RELATIVE_DATE_TOKENS } from '../../../../models/filter-predicate'
import type { DateField } from '../../../../models/app-view'
import { DateFilterPanel } from '../../../../components/shared/filters/DateFilterPanel'
import { DATE_FIELD_LABELS_SHORT } from '../../../../utils/filter-labels'

/**
 * Looking writes nothing (P7–P8 review): the date panel opened on every
 * saved shape a clause can have — dates, day counts either way and 0, every
 * rolling day (the legacy ones too, and a From holding end of week), a mix,
 * "is not", "also tasks with no …", Any / None, Completed — with every menu
 * of its type opened and closed with Esc and every box focused and left,
 * calls `onChange` not once; nor does picking every type from the type menu
 * and looking at it, with nothing set and with every type set. Today is Mon
 * 2 Nov 2026.
 */

const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const offset = (days: number): DateAnchor => ({ kind: 'offset', days })
const token = (t: (typeof RELATIVE_DATE_TOKENS)[number]): DateAnchor => ({ kind: 'relative', token: t })
const range = (start: DateAnchor | null, end: DateAnchor | null, extra: { not?: true; includeNoDate?: true } = {}) => ({ match: 'range' as const, start, end, ...extra })

const SHAPES: [string, DateField, DateFilters][] = [
  ['two dates (Calendar)', 'deadline', { deadline: range(fixed(2026, 10, 1), fixed(2026, 10, 31)) }],
  ['a date To alone', 'followup', { followup: range(null, fixed(2026, 11, 1)) }],
  ['a date far back (Created)', 'created', { created: range(fixed(2023, 1, 1), null) }],
  ['counts either way', 'deadline', { deadline: range(offset(-7), offset(14)) }],
  ['0 on each end', 'deadline', { deadline: range(offset(0), offset(0)) }],
  ['0 To alone', 'lastFollowup', { lastFollowup: range(null, offset(0)) }],
  ['999 days back', 'modified', { modified: range(offset(-999), null) }],
  ...RELATIVE_DATE_TOKENS.flatMap((t): [string, DateField, DateFilters][] => [
    [`From ${t}`, 'deadline', { deadline: range(token(t), null) }],
    [`To ${t}`, 'followup', { followup: range(null, token(t)) }],
  ]),
  ['a From holding end of week, a To holding start of week', 'created', { created: range(token('end-of-week'), token('start-of-week')) }],
  ['a mix: a date and a rolling day', 'deadline', { deadline: range(fixed(2026, 10, 1), token('today')) }],
  ['a mix: a count and a date', 'followup', { followup: range(offset(-7), fixed(2026, 12, 1)) }],
  ['is not', 'followup', { followup: range(token('today'), offset(14), { not: true }) }],
  ['is not, dates', 'lastFollowup', { lastFollowup: range(fixed(2026, 10, 1), fixed(2026, 10, 15), { not: true }) }],
  ['also tasks with no date', 'lastFollowup', { lastFollowup: range(null, offset(-14), { includeNoDate: true }) }],
  ['Any', 'deadline', { deadline: { match: 'set' } }],
  ['None', 'followup', { followup: { match: 'unset' } }],
  ['Planned, a range', 'planned', { planned: range(token('today'), offset(7)) }],
  ['Planned, none', 'planned', { planned: { match: 'unset' } }],
  ['Completed', 'completed', { completed: range(token('start-of-week'), token('end-of-week')) }],
  ['Completed, dates', 'completed', { completed: range(fixed(2026, 10, 1), null) }],
  ['every type at once', 'deadline', {
    deadline: { match: 'set' },
    planned: { match: 'unset' },
    followup: range(offset(-3), fixed(2026, 11, 20)),
    lastFollowup: range(null, offset(-14), { includeNoDate: true }),
    completed: range(fixed(2026, 10, 1), fixed(2026, 10, 31)),
    created: range(offset(0), null),
    modified: range(token('yesterday'), token('tomorrow'), { not: true }),
  }],
]

// Found by their ARIA attributes rather than `getByRole`, which computes
// every element's role and name on each call: the sweep below makes
// hundreds of these lookups.

/** The type button (`Date type: …`). */
function typeButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label^="Date type: "]')
  if (!button) throw new Error('no type button')
  return button
}

/** The open menu, if any (`[role="menu"]`; `label` names the one expected). */
function openMenu(label?: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(label ? `[role="menu"][aria-label="${label}"]` : '[role="menu"]')
}

/** The type menu's items (opened with the button). */
function typeItems(): HTMLElement[] {
  fireEvent.click(typeButton())
  const menu = openMenu('Date type')
  if (!menu) throw new Error('no type menu')
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
}

/** The type menu's labels, in order (the menu opened and closed again). */
function typeLabels(): (string | undefined)[] {
  const types = typeItems().map((el) => el.dataset.menuLabel)
  fireEvent.click(typeButton())
  return types
}

/** Picks the `index`th type from the type menu (opened with the button). */
function pickType(index: number) {
  const item = typeItems()[index]
  if (!item) throw new Error(`no type ${index}`)
  fireEvent.click(item)
}

/** Every menu in the selected type's body (and the type menu) opened and closed with Esc; every box focused and left. */
function lookAround() {
  fireEvent.click(typeButton())
  expect(openMenu('Date type')).toBeInTheDocument()
  fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
  expect(openMenu()).toBeNull()
  const panel = document.querySelector<HTMLElement>('[role="group"][aria-labelledby]')
  if (!panel) throw new Error('no type body')
  expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toMatch(/date|follow|Completed|Created|Modified/)
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]'))) {
    fireEvent.click(button)
    expect(openMenu()).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(openMenu()).toBeNull()
  }
  for (const box of Array.from(panel.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'))) {
    fireEvent.focus(box)
    fireEvent.blur(box)
  }
}

describe('the date panel writes nothing while only looked at (P7–P8 review)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  for (const variant of ['popover', 'sheet'] as const) {
    // Each shape is looked at in its own type, the one it holds, and that
    // type picked again from the type menu.
    for (const [name, field, dates] of SHAPES) {
      it(`${variant}: ${name}`, () => {
        const onChange = vi.fn()
        render(<DateFilterPanel dates={dates} initialField={field} variant={variant} onChange={onChange} />)
        lookAround()
        const types = typeLabels()
        expect(types).toHaveLength(7)
        pickType(Math.max(0, types.indexOf(DATE_FIELD_LABELS_SHORT[field])))
        expect(onChange).not.toHaveBeenCalled()
      })
    }

    // Every type picked from the type menu and looked at: with nothing set,
    // and with every type holding a shape.
    it(`${variant}: every type picked and looked at, empty and all set`, () => {
      const everyType = SHAPES.find(([name]) => name === 'every type at once')
      if (!everyType) throw new Error('no every-type shape')
      for (const dates of [{}, everyType[2]]) {
        const onChange = vi.fn()
        render(<DateFilterPanel dates={dates} initialField="deadline" variant={variant} onChange={onChange} />)
        const types = typeLabels()
        expect(types).toHaveLength(7)
        for (let i = 0; i < types.length; i++) {
          pickType(i)
          lookAround()
        }
        expect(onChange).not.toHaveBeenCalled()
        cleanup()
      }
    })
  }
})
