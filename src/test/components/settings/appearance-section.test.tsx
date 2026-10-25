import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { AppearanceSection } from '../../../components/settings/sections/AppearanceSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(cleanup)

describe('AppearanceSection — row density', () => {
  it('offers Comfortable | Compact under the theme, Compact checked by default; a pick is saved and the row goes back to compact', async () => {
    render(<AppearanceSection />)
    const group = screen.getByRole('radiogroup', { name: 'Row density' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Comfortable', 'Compact'])
    expect(within(group).getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Comfortable lets task names wrap to two lines/)).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('radio', { name: 'Comfortable' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDensity).toBe('comfortable'))
    expect(within(group).getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(async () => expect((await db.settings.get('rowDensity'))?.value).toBe('comfortable'))

    fireEvent.click(within(group).getByRole('radio', { name: 'Compact' }))
    await waitFor(() => expect(useSettingsStore.getState().rowDensity).toBe('compact'))
    await waitFor(async () => expect(await db.settings.get('rowDensity')).toBeUndefined())
  })
})
