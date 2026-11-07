import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { TaskDefaultsSection } from '../../../components/settings/sections/TaskDefaultsSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

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
    expect(screen.getByText('New tasks and Mark followed up set it to today + the interval. Off: new tasks get none, and Mark followed up clears it. Either way, Mark followed up keeps a next follow-up that’s after today.')).toBeInTheDocument()
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

describe('TaskDefaultsSection — Remove note lines after converting', () => {
  it('is off by default; the switch saves it, stored only while on', async () => {
    render(<TaskDefaultsSection />)
    const sw = screen.getByRole('switch', { name: 'Remove note lines after converting' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    await waitFor(async () => expect((await db.settings.get('removeConvertedLines'))?.value).toBe('true'))
    expect(useSettingsStore.getState().removeConvertedLines).toBe(true)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    useSettingsStore.setState({ removeConvertedLines: false })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().removeConvertedLines).toBe(true)
    fireEvent.click(sw)
    await waitFor(async () => expect(await db.settings.get('removeConvertedLines')).toBeUndefined())
    expect(useSettingsStore.getState().removeConvertedLines).toBe(false)
  })
})

describe('TaskDefaultsSection — Priority cues', () => {
  it('each priority shows its checkbox mark as the rows draw it (D25 B): Focus the glow, Urgent / Important their rings', () => {
    render(<TaskDefaultsSection />)
    const rings = Array.from(document.querySelectorAll('[data-cue-ring]')).map((el) => [
      el.getAttribute('data-cue-ring'),
      el.querySelector('[data-priority-ring]')?.getAttribute('data-priority-ring') ?? null,
      el.querySelector('[data-focus-glow]') !== null,
    ])
    expect(rings).toEqual([['focus', null, true], ['urgent', 'urgent', false], ['important', 'important', false]])
    expect(screen.getByText("Beside the ring on each task's checkbox. Several glows blend along the row.")).toBeInTheDocument()
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
    expect(screen.getByText('Overdue tasks count too. A task urgent by its due date gets a dashed ring.')).toBeInTheDocument()
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
    expect(within(sort).getAllByRole('option').map((o) => o.textContent)).toEqual(['Manual', 'Priority', 'Due date', 'Next follow-up', 'Last followed up', 'Completed', 'Name', 'People', 'Status', 'Created', 'Modified'])
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

  it('Completed starts newest first and Last followed up oldest first, whatever the order before', async () => {
    render(<TaskDefaultsSection />)
    const sort = screen.getByRole('combobox', { name: 'New lists sort by' })
    fireEvent.change(sort, { target: { value: 'completed' } })
    await waitFor(() => expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'completed', newListSortDirection: 'desc' }))
    expect(screen.getByRole('combobox', { name: 'New lists sort order' })).toHaveValue('desc')
    expect(screen.getByRole('option', { name: 'Newest first' })).toBeInTheDocument()
    fireEvent.change(sort, { target: { value: 'lastFollowup' } })
    await waitFor(() => expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'lastFollowup', newListSortDirection: 'asc' }))
    expect(within(screen.getByRole('combobox', { name: 'New lists sort order' })).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Oldest first', 'Most recent first'])
  })

  it('New lists group by: No grouping by default; a pick is saved', async () => {
    render(<TaskDefaultsSection />)
    const group = screen.getByRole('combobox', { name: 'New lists group by' })
    expect(group).toHaveValue('none')
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual(['No grouping', 'Priority', 'Due date', 'Next follow-up date', 'People', 'Status', 'Tag'])
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
