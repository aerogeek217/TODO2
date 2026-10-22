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
    render(<EntitiesSection mobile={false} />)
    const group = screen.getByRole('radiogroup', { name: 'Email check-ins open as' })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['mailto', 'eml'])
    expect(radios.map((r) => r.checked)).toEqual([true, false])
    expect(screen.getByRole('radio', { name: /Open in mail app, then paste/ })).toBeChecked()
    expect(screen.getByText('To + Subject filled in; body copied. New and classic Outlook.')).toBeInTheDocument()
    expect(screen.getByText('Opens ready to send in classic Outlook. No paste.')).toBeInTheDocument()
  })

  it('picking Download draft (.eml) saves the setting', async () => {
    render(<EntitiesSection mobile={false} />)
    fireEvent.click(screen.getByRole('radio', { name: /Download draft \(\.eml\)/ }))
    await waitFor(() => expect(useSettingsStore.getState().checkinOpenMethod).toBe('eml'))
    expect((await db.settings.get('checkinOpenMethod'))!.value).toBe('eml')
    expect(screen.getByRole('radio', { name: /Download draft/ })).toBeChecked()
  })

  it('shows the stored method', () => {
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    render(<EntitiesSection mobile={false} />)
    expect(screen.getByRole('radio', { name: /Download draft/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Open in mail app/ })).not.toBeChecked()
  })
})

describe('EntitiesSection — Unused people & tags', () => {
  it('desktop: the row comes after Tags; Find unused… opens the dialog, × closes it', async () => {
    render(<EntitiesSection mobile={false} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Manage people…', 'Manage statuses…', 'Manage tags…', 'Find unused…'])
    expect(screen.getByText('Unused people & tags')).toBeInTheDocument()
    expect(screen.getByText('People and tags no task has.')).toBeInTheDocument()
    expect(screen.queryByTestId('unused-entities')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Find unused…' }))
    const dialog = screen.getByRole('dialog', { name: 'Unused people & tags' })
    expect(within(dialog).getByRole('checkbox', { name: 'Ignore completed tasks' })).not.toBeChecked()
    await waitFor(() => expect(within(dialog).getByText('No unused people')).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: '×' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the phone: only the Unused people & tags row, and its dialog', () => {
    render(<EntitiesSection mobile />)
    expect(screen.queryByRole('button', { name: 'Manage people…' })).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Find unused…' }))
    expect(screen.getByRole('dialog', { name: 'Unused people & tags' })).toBeInTheDocument()
  })
})
