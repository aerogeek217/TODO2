import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { EntitiesSection } from '../../../components/settings/sections/EntitiesSection'
import { useSettingsStore } from '../../../stores/settings-store'
import { usePersonStore } from '../../../stores/person-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useListDefinitionStore.setState(useListDefinitionStore.getInitialState(), true)
})

afterEach(cleanup)

describe('EntitiesSection — no mail settings', () => {
  it('desktop: People, Statuses, Tags and Unused people & tags; nothing about how check-ins open', () => {
    render(<EntitiesSection mobile={false} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByText(/check-ins open as/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage people…' })).toBeInTheDocument()
  })
})

describe('EntitiesSection — Unused people & tags', () => {
  it('desktop: the row comes after Tags; Find unused… opens the dialog, × closes it', async () => {
    render(<EntitiesSection mobile={false} />)
    // Each ⓘ is an `About …` button; the actions are the rest.
    const actions = screen.getAllByRole('button').filter((b) => !b.hasAttribute('data-help-tip'))
    expect(actions.map((b) => b.textContent)).toEqual(['Manage people…', 'Manage statuses…', 'Manage tags…', 'Find unused…'])
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
