import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PredicateChips } from '../../../../components/shared/filters/PredicateChips'
import { EXPRESSION_WRITE_MS } from '../../../../hooks/use-expression-field'
import { emptyPredicate, type FilterExpr, type TodoPredicate } from '../../../../models'
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
})

describe('the expression field', () => {
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
    expect(screen.getByRole('status')).toHaveTextContent('No person named Zed')
  })

  it('on blur writes at once and shows the text in its canonical form', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} />)
    type('budget review and @"ann lee" and done')
    fireEvent.blur(field())
    expect(log.at(-1)).toMatchObject({ showCompleted: true, expression: { kind: 'and', items: [{ kind: 'text', text: 'budget review' }, { kind: 'person', id: 2 }] } })
    expect(field().value).toBe('"budget review" and @"Ann Lee" and done')
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

  it('refuses people where the filter can’t name them (the check-in)', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), expression: { kind: 'priority', value: 'focus' } }} log={log} omitPeople />)
    type('@Alice')
    fireEvent.blur(field())
    expect(log).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('Leave people out')
  })
})

describe('the filter line', () => {
  it('shows an expression as one chip that opens where it is edited', () => {
    const log: TodoPredicate[] = []
    const onOpen = vi.fn()
    render(<Harness initial={{ ...emptyPredicate(), expression: RULE }} log={log} layout="line" onOpen={onOpen} />)
    const chip = screen.getByTestId('list-filter-expression')
    expect(chip).toHaveTextContent('/focus or (@Alice and !Waiting)')
    fireEvent.click(chip)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('radio', { name: 'Expression' })).toBeNull()
  })
})
