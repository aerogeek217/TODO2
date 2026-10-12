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
    expect(screen.getByText('A task is hot when it matches any line. Within a line it needs every lit marker.')).toBeInTheDocument()
    expect(chip(1, 'Urgent')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(1, 'Important')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(1, 'Focus')).toHaveAttribute('aria-pressed', 'false')
    expect(within(line(1)).getByText('2 now')).toBeInTheDocument()
    expect(chip(2, 'Focus')).toHaveAttribute('aria-pressed', 'true')
    expect(within(line(2)).getByText('1 now')).toBeInTheDocument()
    expect(screen.getByTestId('hot-rule-total')).toHaveTextContent('3 open tasks are hot right now.')
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
    expect(within(line(3)).getByText('Pick markers')).toBeInTheDocument()
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
