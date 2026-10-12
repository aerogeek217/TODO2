import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { EntitiesSection } from '../../../components/settings/sections/EntitiesSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { usePersonStore } from '../../../stores/person-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { db } from '../../../data/database'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useListDefinitionStore.setState(useListDefinitionStore.getInitialState(), true)
})

afterEach(cleanup)

describe('EntitiesSection — Email check-ins open as', () => {
  it('offers the two methods with their help lines, mail app first and picked by default', () => {
    render(<EntitiesSection />)
    const group = screen.getByRole('radiogroup', { name: 'Email check-ins open as' })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['mailto', 'eml'])
    expect(radios.map((r) => r.checked)).toEqual([true, false])
    expect(screen.getByRole('radio', { name: /Open in mail app, then paste/ })).toBeChecked()
    expect(screen.getByText('To + Subject filled in; body copied. New and classic Outlook.')).toBeInTheDocument()
    expect(screen.getByText('Opens ready to send in classic Outlook. No paste.')).toBeInTheDocument()
  })

  it('picking Download draft (.eml) saves the setting', async () => {
    render(<EntitiesSection />)
    fireEvent.click(screen.getByRole('radio', { name: /Download draft \(\.eml\)/ }))
    await waitFor(() => expect(useSettingsStore.getState().checkinOpenMethod).toBe('eml'))
    expect((await db.settings.get('checkinOpenMethod'))!.value).toBe('eml')
    expect(screen.getByRole('radio', { name: /Download draft/ })).toBeChecked()
  })

  it('shows the stored method', () => {
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    render(<EntitiesSection />)
    expect(screen.getByRole('radio', { name: /Download draft/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Open in mail app/ })).not.toBeChecked()
  })
})
