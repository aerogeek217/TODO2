import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { TaskDefaultsSection } from '../../../components/settings/sections/TaskDefaultsSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { db } from '../../../data/database'
import { makeTodo, resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useStatusStore.setState(useStatusStore.getInitialState(), true)
  useTodoStore.setState(useTodoStore.getInitialState(), true)
})

afterEach(cleanup)

describe('TaskDefaultsSection — follow-up', () => {
  it('Set a next follow-up automatically, above the interval: on by default, its help says both uses; off is stored, on removes the row', async () => {
    render(<TaskDefaultsSection />)
    const sw = screen.getByRole('switch', { name: 'Set a next follow-up automatically' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    const interval = screen.getByRole('textbox', { name: 'Follow-up interval' })
    expect(sw.compareDocumentPosition(interval) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('New tasks and Mark followed up set it to today + the interval. Off: new tasks get none, and Mark followed up clears it.')).toBeInTheDocument()
    expect(screen.getByText(/^How far ahead new tasks and “Mark followed up” set the next follow-up\./)).toBeInTheDocument()
    fireEvent.click(sw)
    await waitFor(() => expect(useSettingsStore.getState().autoFollowup).toBe(false))
    expect((await db.settings.get('newTaskFollowup'))!.value).toBe('false')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    // Off, the interval waits for the switch.
    expect(screen.getByText(/^Used while Set a next follow-up automatically is on\./)).toBeInTheDocument()
    expect(screen.queryByText(/^How far ahead/)).toBeNull()
    fireEvent.click(sw)
    await waitFor(() => expect(useSettingsStore.getState().autoFollowup).toBe(true))
    await waitFor(async () => expect(await db.settings.get('newTaskFollowup')).toBeUndefined())
  })
})

describe('TaskDefaultsSection — Due date makes a task urgent', () => {
  it('shows the range (default Within 3 days) with its help line and offers Off · Today · 1 · 2 · 3 days · 1 · 2 weeks', () => {
    render(<TaskDefaultsSection />)
    const select = screen.getByRole('combobox', { name: 'Due date makes a task urgent' }) as HTMLSelectElement
    expect(select.selectedOptions[0]!.textContent).toBe('Within 3 days')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Off', 'Today', 'Within 1 day', 'Within 2 days', 'Within 3 days', 'Within 1 week', 'Within 2 weeks',
    ])
    expect(screen.getByText('Overdue tasks count too. They show a clock instead of the urgent mark.')).toBeInTheDocument()
  })

  it('picking a choice saves the setting', async () => {
    render(<TaskDefaultsSection />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Due date makes a task urgent' }), { target: { value: 'off' } })
    await waitFor(() => expect(useSettingsStore.getState().urgentDueWithinDays).toBeNull())
    expect((await db.settings.get('urgentDueWithinDays'))!.value).toBe('off')
  })

  it('a range outside the choices (e.g. imported) still shows', () => {
    useSettingsStore.setState({ urgentDueWithinDays: 5 })
    render(<TaskDefaultsSection />)
    const select = screen.getByRole('combobox', { name: 'Due date makes a task urgent' }) as HTMLSelectElement
    expect(select.selectedOptions[0]!.textContent).toBe('Within 5 days')
  })
})

describe('TaskDefaultsSection — Hot tasks', () => {
  const tomorrow = () => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }

  function seedTodos() {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, urgent: true, important: true }),
        makeTodo({ id: 2, important: true, dueDate: tomorrow() }), // urgent by date
        makeTodo({ id: 3, focus: true }),
        makeTodo({ id: 4, important: true }),
        makeTodo({ id: 5, focus: true, isCompleted: true }),
      ],
    })
  }

  const line = (n: number) => screen.getByRole('group', { name: `Hot rule line ${n}` })
  const chip = (n: number, name: string) => within(line(n)).getByRole('button', { name })

  it('shows the default rule as lines with live counts of open tasks and the total', () => {
    seedTodos()
    render(<TaskDefaultsSection />)
    expect(screen.getByText('A task is hot when it matches any line. Within a line it needs everything lit.')).toBeInTheDocument()
    expect(chip(1, 'Urgent')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(1, 'Important')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(1, 'Focus')).toHaveAttribute('aria-pressed', 'false')
    expect(within(line(1)).getByText('2 now')).toBeInTheDocument()
    expect(chip(2, 'Focus')).toHaveAttribute('aria-pressed', 'true')
    expect(within(line(2)).getByText('1 now')).toBeInTheDocument()
    expect(screen.getByTestId('hot-rule-total')).toHaveTextContent('3 open tasks are hot right now.')
  })

  it('a line’s marker chips read Focus › Urgent › Important', () => {
    render(<TaskDefaultsSection />)
    expect(within(line(1)).getAllByRole('button').map((b) => b.textContent).filter((t) => t && /^(Focus|Urgent|Important)$/.test(t)))
      .toEqual(['Focus', 'Urgent', 'Important'])
  })

  it('toggling a marker saves the rule at once and updates the counts', async () => {
    seedTodos()
    render(<TaskDefaultsSection />)
    fireEvent.click(chip(1, 'Urgent'))
    await waitFor(() => expect(useSettingsStore.getState().hotRule).toEqual([{ important: true }, { focus: true }]))
    expect((await db.settings.get('hotRule'))!.value).toBe('[{"important":true},{"focus":true}]')
    expect(within(line(1)).getByText('3 now')).toBeInTheDocument()
    expect(screen.getByTestId('hot-rule-total')).toHaveTextContent('4 open tasks are hot right now.')
  })

  it('+ Or… adds an empty line that is saved once it has a marker; × removes a line', async () => {
    render(<TaskDefaultsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Or…' }))
    expect(within(line(3)).getByText('Pick some')).toBeInTheDocument()
    expect(useSettingsStore.getState().hotRule).toHaveLength(2)
    fireEvent.click(chip(3, 'Important'))
    await waitFor(() => expect(useSettingsStore.getState().hotRule).toEqual([
      { urgent: true, important: true }, { focus: true }, { important: true },
    ]))
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    await waitFor(() => expect(useSettingsStore.getState().hotRule).toEqual([{ focus: true }, { important: true }]))
  })

  it('always keeps one marker: no × on the only line, and its only lit chip stays on', async () => {
    useSettingsStore.setState({ hotRule: [{ focus: true }] })
    render(<TaskDefaultsSection />)
    expect(screen.queryByRole('button', { name: /^Remove line/ })).toBeNull()
    expect(chip(1, 'Focus')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(chip(1, 'Focus'))
    expect(chip(1, 'Focus')).toHaveAttribute('aria-pressed', 'true')
    expect(useSettingsStore.getState().hotRule).toEqual([{ focus: true }])
    // With an empty second line the first line still can't be removed.
    fireEvent.click(screen.getByRole('button', { name: 'Or…' }))
    expect(screen.queryByRole('button', { name: 'Remove line 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove line 2' })).toBeInTheDocument()
  })

  it('Reset to default restores (Urgent AND Important) OR Focus', async () => {
    useSettingsStore.setState({ hotRule: [{ important: true }] })
    render(<TaskDefaultsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(useSettingsStore.getState().hotRule).toEqual([{ urgent: true, important: true }, { focus: true }]))
    expect(chip(2, 'Focus')).toHaveAttribute('aria-pressed', 'true')
  })

  it('follows a rule changed elsewhere', () => {
    render(<TaskDefaultsSection />)
    act(() => useSettingsStore.setState({ hotRule: [{ urgent: true, focus: true }] }))
    expect(chip(1, 'Urgent')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(1, 'Focus')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('group', { name: 'Hot rule line 2' })).toBeNull()
  })
})

describe('TaskDefaultsSection — fade untouched tasks', () => {
  it('shows the threshold (default 30 days); a whole number 0–365 commits on blur, 0 reads as off, anything else reverts', async () => {
    render(<TaskDefaultsSection />)
    const input = screen.getByRole('spinbutton', { name: 'Fade tasks untouched for (days)' }) as HTMLInputElement
    expect(input.value).toBe('30')
    expect(screen.getByText('days')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.blur(input)
    await waitFor(() => expect(useSettingsStore.getState().staleAfterDays).toBe(45))
    expect((await db.settings.get('staleAfterDays'))!.value).toBe('45')
    fireEvent.change(input, { target: { value: '0' } })
    expect(screen.getByText('days (off)')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await waitFor(() => expect(useSettingsStore.getState().staleAfterDays).toBe(0))
    fireEvent.change(input, { target: { value: '400' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(input)
    expect(input.value).toBe('0')
    expect(useSettingsStore.getState().staleAfterDays).toBe(0)
  })
})

describe('TaskDefaultsSection — new lists', () => {
  it('New lists sort by: Manual by default with no order choice; a sort with a direction offers its order in words', async () => {
    render(<TaskDefaultsSection />)
    const sort = screen.getByRole('combobox', { name: 'New lists sort by' })
    expect(sort).toHaveValue('manual')
    expect(within(sort).getAllByRole('option').map((o) => o.textContent)).toEqual(['Manual', 'Priority', 'Due date', 'Follow-up date', 'Name', 'Created'])
    expect(screen.queryByRole('combobox', { name: 'New lists sort order' })).toBeNull()

    fireEvent.change(sort, { target: { value: 'deadline' } })
    await waitFor(() => expect(useSettingsStore.getState().newListSort).toBe('deadline'))
    const order = screen.getByRole('combobox', { name: 'New lists sort order' })
    expect(within(order).getAllByRole('option').map((o) => o.textContent)).toEqual(['Soonest first', 'Latest first'])
    fireEvent.change(order, { target: { value: 'desc' } })
    await waitFor(() => expect(useSettingsStore.getState().newListSortDirection).toBe('desc'))
    await waitFor(async () => expect((await db.settings.get('newListSortDirection'))?.value).toBe('desc'))
    // The direction carries over to another sort with one, and goes with Manual.
    fireEvent.change(sort, { target: { value: 'created' } })
    await waitFor(() => expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'created', newListSortDirection: 'desc' }))
    expect(screen.getByRole('combobox', { name: 'New lists sort order' })).toHaveValue('desc')
    expect(screen.getByRole('option', { name: 'Newest first' })).toBeInTheDocument()
    fireEvent.change(sort, { target: { value: 'manual' } })
    await waitFor(() => expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'manual', newListSortDirection: 'asc' }))
    expect(screen.queryByRole('combobox', { name: 'New lists sort order' })).toBeNull()
  })

  it('New lists group by: No grouping by default; a pick is saved', async () => {
    render(<TaskDefaultsSection />)
    const group = screen.getByRole('combobox', { name: 'New lists group by' })
    expect(group).toHaveValue('none')
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual(['No grouping', 'Priority', 'Due date', 'Follow-up date', 'People', 'Status', 'Tag'])
    fireEvent.change(group, { target: { value: 'tag' } })
    await waitFor(() => expect(useSettingsStore.getState().newListGroup).toBe('tag'))
    await waitFor(async () => expect((await db.settings.get('newListGroup'))?.value).toBe('tag'))
  })

  it('a stored sort the menu no longer offers still shows', () => {
    useSettingsStore.setState({ newListSort: 'people' })
    render(<TaskDefaultsSection />)
    expect(screen.getByRole('combobox', { name: 'New lists sort by' })).toHaveValue('people')
  })
})
