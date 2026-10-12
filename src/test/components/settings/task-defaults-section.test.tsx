import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TaskDefaultsSection } from '../../../components/settings/sections/TaskDefaultsSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useStatusStore.setState(useStatusStore.getInitialState(), true)
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
