import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_COLOR_VARS } from '../../models/theme-colors'
import { SRC } from './css-source'

/**
 * The compact facts row (the task layout's fact band, the editor's and the
 * review card's): each cell's width is the band's, never its value's (E6) —
 * Priority its three 26 × 24px toggles, Status at most 180px, People and Tags
 * from 80px sharing what is left, Due and Planned from 144px — so the six
 * facts share one line in the 1040px editor. The real widths are measured in
 * `e2e/task-facts-stable.spec.ts`.
 */

/** A stylesheet's source, its line ends as LF whatever the checkout's. */
const css = (file: string) => readFileSync(join(SRC, file), 'utf8').split('\r').join('')
const DETAILS = css('components/task/TaskDetails.module.css')
const EDITOR = css('components/task/TaskEditPopup.module.css')

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`no rule ${selector}`)
  const open = source.indexOf('{', start)
  const body = source.slice(open + 1, source.indexOf('}', open))
  return new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}

describe('the facts row’s widths', () => {
  it('each cell’s flex: Priority its own, Status 180px at most, People and Tags from 80px, Due and Planned from 144px', () => {
    expect(rule(DETAILS, ".fact[data-fact='priority']").get('flex')).toBe('none')
    expect(rule(DETAILS, ".fact[data-fact='status']").get('flex')).toBe('0 1 180px')
    expect(rule(DETAILS, ".fact[data-fact='people'],\n.fact[data-fact='tags']").get('flex')).toBe('4 1 80px')
    expect(rule(DETAILS, ".fact[data-fact='due'],\n.fact[data-fact='planned']").get('flex')).toBe('1 0 144px')
  })

  it('a priority toggle is its mark alone, 26 × 24px, every one the same width', () => {
    const toggle = rule(DETAILS, '.markerToggle')
    expect(toggle.get('width')).toBe('26px')
    expect(toggle.get('height')).toBe('24px')
    expect(toggle.get('padding')).toBe('0')
    expect(toggle.get('flex')).toBe('none')
    expect(rule(DETAILS, '.markerRow').get('gap')).toBe('4px')
  })

  it('urgent by its due date: the unpressed Urgent mark in the urgent colour', () => {
    expect(rule(DETAILS, ".markerToggle[data-urgent='date'][aria-pressed='false']").get('color'))
      .toBe(`var(${THEME_COLOR_VARS.urgent})`)
  })

  it('the dates’ two lines: the field at 30px, its words 16px under it, cut with an ellipsis', () => {
    expect(rule(DETAILS, '.dateField > div').get('height')).toBe('30px')
    const under = rule(DETAILS, '.dateUnder')
    expect(under.get('height')).toBe('16px')
    expect(under.get('text-overflow')).toBe('ellipsis')
    expect(under.get('white-space')).toBe('nowrap')
  })

  it('the editor is 1040px', () => {
    expect(rule(EDITOR, '.card').get('width')).toBe('min(1040px, calc(100vw - 32px))')
  })
})
