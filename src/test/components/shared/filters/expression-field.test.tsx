import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler, useState } from 'react'
import { PredicateChips, SWITCH_REFUSED } from '../../../../components/shared/filters/PredicateChips'
import { EXPRESSION_WRITE_MS } from '../../../../hooks/use-expression-field'
import { CLOSE_HELD, COMPLETED_HINT_DONE } from '../../../../components/shared/filters/ExpressionField'
import { TOOLTIP_DELAY_MS } from '../../../../components/shared/use-tooltip'
import { EXPRESSION_NODES_MAX, emptyPredicate, type FilterExpr, type TodoPredicate } from '../../../../models'
import { usePersonStore } from '../../../../stores/person-store'
import { useStatusStore } from '../../../../stores/status-store'
import { useTagStore } from '../../../../stores/tag-store'
import { makePerson } from '../../../helpers'

/**
 * The editors' filter as Graphical or an Expression: the switch, the
 * expression field (writes once a text reads, never one that doesn't), its
 * Reads as preview, Graphical over an expression no chip says, and the
 * list's filter line showing an expression as one chip.
 */

beforeEach(() => {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Ann Lee' })],
    assignedPeopleMap: new Map(),
  })
  useStatusStore.setState({
    statuses: [
      { id: 1, name: 'Assigned', color: '#888', sortOrder: 1, icon: 'circle' },
      { id: 2, name: 'Waiting', color: '#888', sortOrder: 2, icon: 'circle' },
    ],
  })
  useTagStore.setState({ tags: [{ id: 10, name: 'work', color: '#f00' }], assignedTagsMap: new Map() })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Harness({ initial, log, layout = 'stack', omitPeople = false, onOpen }: {
  initial: TodoPredicate
  log: TodoPredicate[]
  layout?: 'line' | 'stack'
  omitPeople?: boolean
  onOpen?: () => void
}) {
  const [p, setP] = useState(initial)
  return (
    <PredicateChips
      predicate={p}
      layout={layout}
      omitFields={omitPeople ? ['people'] : undefined}
      onOpenExpression={onOpen}
      onChange={(next) => { log.push(next); setP(next) }}
    />
  )
}

const field = () => screen.getByRole('textbox', { name: 'Filter expression' }) as HTMLTextAreaElement
const type = (text: string) => fireEvent.change(field(), { target: { value: text, selectionStart: text.length } })
const mode = (name: 'Graphical' | 'Expression') => screen.getByRole('radio', { name })
const RULE: FilterExpr = {
  kind: 'or',
  items: [{ kind: 'priority', value: 'focus' }, { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'status', id: 2 }] }],
}

describe('Graphical | Expression', () => {
  it('Expression turns the chips into the expression that filters the same', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), statusIds: [2], personIds: [1] }} log={log} />)
    expect(mode('Graphical')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(mode('Expression'))
    expect(log.at(-1)?.expression).toEqual({ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'status', id: 2 }] })
    expect(log.at(-1)?.statusIds).toBeNull()
    expect(field().value).toBe('@Alice and !Waiting')
  })

  it('Graphical over a plain and turns it back into chips', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'not', item: { kind: 'status', id: 2 } }] } }} log={log} />)
    expect(mode('Expression')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(mode('Graphical'))
    expect(log.at(-1)).toMatchObject({ personIds: [1], statusIds: [2], negate: { statusIds: true } })
    expect(log.at(-1)?.expression).toBeUndefined()
    expect(screen.getAllByTestId('list-filter-chip')).toHaveLength(2)
  })

  it('Graphical over an expression no chip says: edit it, or clear it', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: RULE }} log={log} />)
    fireEvent.click(mode('Graphical'))
    expect(log).toEqual([])
    expect(screen.getByTestId('expression-locked')).toHaveTextContent('This filter is an expression/focus or (@Alice and !Waiting)')
    fireEvent.click(screen.getByRole('button', { name: 'Clear and use Graphical' }))
    expect(log.at(-1)?.expression).toBeUndefined()
    expect(screen.queryByTestId('expression-locked')).toBeNull()
    expect(screen.getByRole('button', { name: /Filter/ })).toBeTruthy()
  })

  it('Expression, Edit expression and Clear and use Graphical leave the focus on what replaced them, never <body> (cr33 U6)', () => {
    const log: TodoPredicate[] = []
    const { unmount } = render(<Harness initial={{ ...emptyPredicate(), statusIds: [2] }} log={log} />)
    fireEvent.click(mode('Expression'))
    expect(document.activeElement).toBe(field())
    unmount()
    render(<Harness initial={{ ...emptyPredicate(), expression: RULE }} log={log} />)
    fireEvent.click(mode('Graphical'))
    const edit = screen.getByRole('button', { name: 'Edit expression' })
    edit.focus()
    fireEvent.click(edit)
    expect(document.activeElement).toBe(field())
    fireEvent.click(mode('Graphical'))
    const clear = screen.getByRole('button', { name: 'Clear and use Graphical' })
    clear.focus()
    fireEvent.click(clear)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Filter/ }))
  })

  it('the switch is one tab stop; the arrows move the choice and the focus (cr33 U9)', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), statusIds: [2] }} log={log} />)
    expect(mode('Graphical')).toHaveAttribute('tabindex', '0')
    expect(mode('Expression')).toHaveAttribute('tabindex', '-1')
    mode('Graphical').focus()
    fireEvent.keyDown(mode('Graphical'), { key: 'ArrowRight' })
    expect(mode('Expression')).toHaveAttribute('aria-checked', 'true')
    expect(mode('Expression')).toHaveAttribute('tabindex', '0')
    expect(document.activeElement).toBe(mode('Expression'))
    expect(log.at(-1)?.expression).toEqual({ kind: 'status', id: 2 })
    fireEvent.keyDown(mode('Expression'), { key: 'ArrowLeft' })
    expect(mode('Graphical')).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(mode('Graphical'))
  })

  it('refuses to switch a filter past the expression cap: it stays Graphical, saying why (cr33 M1)', () => {
    const log: TodoPredicate[] = []
    const tags = Array.from({ length: EXPRESSION_NODES_MAX }, (_, i) => i + 1)
    render(<Harness initial={{ ...emptyPredicate(), tags }} log={log} />)
    fireEvent.click(mode('Expression'))
    expect(log).toEqual([])
    expect(mode('Graphical')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('textbox', { name: 'Filter expression' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(SWITCH_REFUSED)
  })

  it('a filter put back to chips from outside (Revert, undo) shows them; one emptied stays in Expression', () => {
    const chips = { ...emptyPredicate(), personIds: [1] }
    const show = (predicate: TodoPredicate) => <PredicateChips predicate={predicate} layout="stack" onChange={() => {}} />
    const { rerender } = render(show({ ...emptyPredicate(), expression: RULE }))
    expect(field().value).toBe('/focus or (@Alice and !Waiting)')
    rerender(show(chips))
    expect(screen.queryByRole('textbox', { name: 'Filter expression' })).toBeNull()
    expect(mode('Graphical')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Alice')).toBeTruthy()
    rerender(show({ ...emptyPredicate(), expression: RULE }))
    rerender(show(emptyPredicate()))
    expect(mode('Expression')).toHaveAttribute('aria-checked', 'true')
    expect(field().value).toBe('')
  })
})

describe('the expression field', () => {
  // The popup's `compute` was a new function each render, and the popup
  // re-reads its text whenever that changes: an open popup re-rendered the
  // field forever (a hung test worker; a busy loop in a browser). The
  // Profiler turns the loop into a failure instead of a hang.
  it.each(['#wo', '#work and /fo', '@al'])('settles with the popup open on %s', (text) => {
    let commits = 0
    const log: TodoPredicate[] = []
    render(
      <Profiler id="field" onRender={() => { if (++commits > 50) throw new Error(`still rendering after ${commits} commits`) }}>
        <Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />
      </Profiler>,
    )
    commits = 0
    type(text)
    expect(commits).toBeLessThan(10)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(field(), { key: 'Tab' })
    expect(field().value).toBe({ '#wo': '#work ', '#work and /fo': '#work and /focus ', '@al': '@Alice ' }[text])
  }, 5000)

  it('writes a text that reads once typing rests, and shows how it reads', () => {
    vi.useFakeTimers()
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('/focus or (@alice and !waiting)')
    expect(log).toEqual([])
    act(() => { vi.advanceTimersByTime(EXPRESSION_WRITE_MS) })
    expect(log.at(-1)?.expression).toEqual(RULE)
    const reads = screen.getByTestId('expression-reads-as')
    expect(reads).toHaveTextContent('KeepPriority Focusor(People AliceandStatus Waiting)')
  })

  it('never writes a text that doesn’t read; says why', () => {
    vi.useFakeTimers()
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('(/focus or @Zed')
    act(() => { vi.advanceTimersByTime(EXPRESSION_WRITE_MS * 2) })
    fireEvent.blur(field())
    expect(log).toEqual([])
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('expression-error')).toHaveTextContent('No person named Zed')
  })

  it('announces the error from a live region that is always there, once typing rests (cr33 U10)', () => {
    vi.useFakeTimers()
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={[]} />)
    const region = screen.getByTestId('expression-announce')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region.textContent).toBe('')
    type('(/focus or')
    expect(region.textContent).toBe('')
    act(() => { vi.advanceTimersByTime(EXPRESSION_WRITE_MS) })
    expect(screen.getByTestId('expression-announce')).toBe(region)
    expect(region).toHaveTextContent('“or” needs something after it')
  })

  it('holds the first press outside while the text doesn’t read, saying so; the next goes through (cr33 U5)', () => {
    const log: TodoPredicate[] = []
    const closed = vi.fn()
    render(
      <>
        <Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />
        <button type="button" onClick={closed}>Close</button>
      </>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    const press = () => {
      fireEvent.pointerDown(close)
      fireEvent.mouseDown(close)
      fireEvent.click(close)
    }
    // A text that reads holds nothing.
    type('(/focus or #work)')
    press()
    expect(closed).toHaveBeenCalledTimes(1)
    type('(/focus or')
    press()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('expression-error')).toHaveTextContent(CLOSE_HELD)
    expect(screen.getByTestId('expression-announce')).toHaveTextContent(CLOSE_HELD)
    // Closing again drops it: the press goes through.
    press()
    expect(closed).toHaveBeenCalledTimes(2)
    // A press inside the field is never held.
    type('(/focus or (')
    fireEvent.mouseDown(field())
    fireEvent.click(field())
    expect(screen.getByTestId('expression-error')).not.toHaveTextContent(CLOSE_HELD)
  })

  it('on blur writes at once and shows the text in its canonical form', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('budget review and @"ann lee" and done')
    fireEvent.blur(field())
    expect(log.at(-1)).toMatchObject({ showCompleted: true, expression: { kind: 'and', items: [{ kind: 'text', text: 'budget review' }, { kind: 'person', id: 2 }] } })
    expect(field().value).toBe('"budget review" and @"Ann Lee" and done')
  })

  it('settles a date typed in the older words as a comparison', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('followup from in 7 days or created before 30 days ago')
    fireEvent.blur(field())
    expect(log.at(-1)?.expression).toEqual({ kind: 'or', items: [
      { kind: 'date', field: 'followup', match: { match: 'range', start: { kind: 'offset', days: 7 }, end: null } },
      { kind: 'date', field: 'created', match: { match: 'range', start: null, end: { kind: 'offset', days: -31 } } },
    ] })
    expect(field().value).toBe('followup >= +7d or created <= -31d')
  })

  it('a change from elsewhere during the write pause drops the waiting write (cr33 U13)', () => {
    vi.useFakeTimers()
    const log: TodoPredicate[] = []
    const show = (predicate: TodoPredicate) => <PredicateChips predicate={predicate} layout="stack" onChange={(n) => log.push(n)} />
    const { rerender } = render(show({ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }))
    type('(/focus or #work)')
    // An undo lands before the pause is over.
    rerender(show({ ...emptyPredicate(), expression: { kind: 'tag', id: 10 } }))
    expect(field().value).toBe('#work')
    act(() => { vi.advanceTimersByTime(EXPRESSION_WRITE_MS * 2) })
    expect(log).toEqual([])
  })

  it('a focus and a blur write nothing when the text reads as the same filter (cr33 F4)', () => {
    const log: TodoPredicate[] = []
    // As Graphical → Expression writes a Relative Completed range: its end a 0-day offset, which reads back as `today`.
    const lastWeek: FilterExpr = { kind: 'date', field: 'completed', match: { match: 'range', start: { kind: 'offset', days: -6 }, end: { kind: 'offset', days: 0 } } }
    render(<Harness initial={{ ...emptyPredicate(), expression: lastWeek }} log={log} />)
    expect(field().value).toBe('completed within last 6 days')
    fireEvent.focus(field())
    fireEvent.blur(field())
    expect(log).toEqual([])
  })

  it('keeps the person the text named when two share a name (cr33 F5)', () => {
    usePersonStore.setState({ people: [makePerson({ id: 3, name: 'Alex' }), makePerson({ id: 4, name: 'Alex' })], assignedPeopleMap: new Map() })
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'person', id: 4 } }} log={log} />)
    expect(field().value).toBe('@Alex')
    type('(@Alex and #work)')
    fireEvent.blur(field())
    expect(log.at(-1)?.expression).toEqual({ kind: 'and', items: [{ kind: 'person', id: 4 }, { kind: 'tag', id: 10 }] })
  })

  it('Esc puts back the filter’s text, writing nothing', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('/focus or (')
    const esc = fireEvent.keyDown(field(), { key: 'Escape' })
    expect(esc).toBe(false)
    expect(field().value).toBe('/focus')
    expect(log).toEqual([])
  })

  it('refuses done where the host never shows completed tasks by it, and a Completed date where it has none (cr33 F9, F11)', () => {
    const log: TodoPredicate[] = []
    const initial = { ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } as FilterExpr }
    const { unmount } = render(<PredicateChips predicate={initial} layout="stack" allowDone={false} onChange={(n) => log.push(n)} />)
    type('(/focus and done)')
    fireEvent.blur(field())
    expect(log).toEqual([])
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('expression-field')).toHaveTextContent('done has no say here')
    unmount()
    render(<PredicateChips predicate={initial} layout="stack" dateHost={{ omit: ['completed'] }} onChange={(n) => log.push(n)} />)
    type('(/focus or completed this week)')
    fireEvent.blur(field())
    expect(log).toEqual([])
    expect(screen.getByTestId('expression-field')).toHaveTextContent('Leave completed out')
  })

  it('says why Completed dates inside an or keep nothing without “and done” (cr33 F10)', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('(completed this week or completed last week)')
    expect(screen.getByTestId('expression-completed-hint')).toHaveTextContent(COMPLETED_HINT_DONE)
    type('(completed this week or completed last week) and done')
    expect(screen.queryByTestId('expression-completed-hint')).toBeNull()
    type('(#work or completed this week) and completed last week')
    expect(screen.queryByTestId('expression-completed-hint')).toBeNull()
  })

  it('refuses people where the filter can’t name them (the check-in)', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} omitPeople />)
    type('@Alice')
    fireEvent.blur(field())
    expect(log).toEqual([])
    expect(screen.getByTestId('expression-error')).toHaveTextContent('Leave people out')
  })
})

describe('the filter line', () => {
  it('reads an expression back in words, its exact text in the tooltip, and opens where it is edited', () => {
    const log: TodoPredicate[] = []
    const onOpen = vi.fn()
    render(<Harness initial={{ ...emptyPredicate(), expression: RULE }} log={log} layout="line" onOpen={onOpen} />)
    const chip = screen.getByTestId('list-filter-expression')
    expect(chip).toHaveTextContent('Focus, or Alice and Waiting')
    expect([...chip.querySelectorAll('[data-piece="name"]')].map((el) => el.textContent)).toEqual(['Focus', 'Alice', 'Waiting'])
    expect([...chip.querySelectorAll('[data-piece="joiner"]')].map((el) => el.textContent)).toEqual([',', 'or', 'and'])
    vi.useFakeTimers()
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('/focus or (@Alice and !Waiting)')
    vi.useRealTimers()
    fireEvent.click(chip)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('radio', { name: 'Expression' })).toBeNull()
  })
})
