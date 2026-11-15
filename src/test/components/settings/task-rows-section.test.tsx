import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { TaskRowsSection } from '../../../components/settings/sections/TaskRowsSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(cleanup)

describe('TaskRowsSection — default list zoom', () => {
  it('offers Auto | Stacked | Rows | Lines under the theme, Auto checked by default; a pick is saved and Auto removes the row', async () => {
    render(<TaskRowsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Default list zoom' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Auto', 'Stacked', 'Rows', 'Lines'])
    expect(within(group).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/How a list tab draws its tasks until you zoom it/)).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('radio', { name: 'Lines' }))
    await waitFor(() => expect(useSettingsStore.getState().listZoom).toBe('lines'))
    expect(within(group).getByRole('radio', { name: 'Lines' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(async () => expect((await db.settings.get('rowDensity'))?.value).toBe('lines'))

    // Rows is a choice of its own now: stored.
    fireEvent.click(within(group).getByRole('radio', { name: 'Rows' }))
    await waitFor(() => expect(useSettingsStore.getState().listZoom).toBe('rows'))
    await waitFor(async () => expect((await db.settings.get('rowDensity'))?.value).toBe('rows'))

    fireEvent.click(within(group).getByRole('radio', { name: 'Auto' }))
    await waitFor(() => expect(useSettingsStore.getState().listZoom).toBe('auto'))
    await waitFor(async () => expect(await db.settings.get('rowDensity')).toBeUndefined())
  })
})

describe('TaskRowsSection — dates', () => {
  it('offers Relative | MM/DD, Relative checked by default; MM/DD is saved and Relative removes the row', async () => {
    render(<TaskRowsSection />)
    const group = screen.getByRole('radiogroup', { name: 'Dates' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Relative', 'MM/DD'])
    expect(within(group).getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(group).getByRole('radio', { name: 'MM/DD' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDates).toBe('numeric'))
    expect(within(group).getByRole('radio', { name: 'MM/DD' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(async () => expect((await db.settings.get('rowDates'))?.value).toBe('numeric'))

    fireEvent.click(within(group).getByRole('radio', { name: 'Relative' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDates).toBe('relative'))
    await waitFor(async () => expect(await db.settings.get('rowDates')).toBeUndefined())
  })
})

describe('TaskRowsSection — cobwebs on stale tasks', () => {
  it('is on by default; off is saved as false and on removes the row', async () => {
    render(<TaskRowsSection />)
    const toggle = screen.getByRole('switch', { name: 'Cobwebs on stale tasks' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    await waitFor(() => expect(useSettingsStore.getState().staleCobwebs).toBe(false))
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await waitFor(async () => expect((await db.settings.get('staleCobwebs'))?.value).toBe('false'))

    fireEvent.click(toggle)
    await waitFor(() => expect(useSettingsStore.getState().staleCobwebs).toBe(true))
    await waitFor(async () => expect(await db.settings.get('staleCobwebs')).toBeUndefined())
  })
})

describe('TaskRowsSection — Priority cues', () => {
  it('each priority shows its checkbox mark as the rows draw it (D25 B): Focus the glow, Urgent / Important their rings', () => {
    render(<TaskRowsSection />)
    const rings = Array.from(document.querySelectorAll('[data-cue-ring]')).map((el) => [
      el.getAttribute('data-cue-ring'),
      el.querySelector('[data-priority-ring]')?.getAttribute('data-priority-ring') ?? null,
      el.querySelector('[data-focus-glow]') !== null,
    ])
    expect(rings).toEqual([['focus', null, true], ['urgent', 'urgent', false], ['important', 'important', false]])
    expect(screen.getByText("Beside the ring on each task's checkbox. Several glows blend along the row.")).toBeInTheDocument()
  })
})

describe('TaskRowsSection — fade stale tasks', () => {
  it('is on by default, its help naming the threshold; off is saved as false and on removes the row', async () => {
    render(<TaskRowsSection />)
    expect(screen.getByText(/Stale: no change for 30 days \(Tasks › Rules\)\./)).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Fade stale tasks' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    await waitFor(() => expect(useSettingsStore.getState().staleFade).toBe(false))
    await waitFor(async () => expect((await db.settings.get('staleFade'))?.value).toBe('false'))
    fireEvent.click(toggle)
    await waitFor(() => expect(useSettingsStore.getState().staleFade).toBe(true))
    await waitFor(async () => expect(await db.settings.get('staleFade')).toBeUndefined())
  })

  it('says nothing goes stale while the threshold is 0', () => {
    useSettingsStore.setState({ staleAfterDays: 0 })
    render(<TaskRowsSection />)
    expect(screen.getByText(/Nothing goes stale now: Tasks › Rules › Stale after is 0\./)).toBeInTheDocument()
  })
})
