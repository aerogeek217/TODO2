import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CompletedTasksSection } from '../../../components/settings/sections/CompletedTasksSection'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { makeTodo } from '../../helpers'

// Settings › Completed tasks › "Delete completed tasks…" is a modal like the
// app's others (the shared dialog frame): focus moves in, Esc and a backdrop
// press close it, focus goes back to the button. Before, Esc did nothing
// (Settings ignores Esc while it is open) and focus stayed behind it.

afterEach(() => { cleanup() })

function openCleanup() {
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
  useTodoStore.setState({ todos: [makeTodo({ id: 1, isCompleted: true, completedAt: old })] })
  render(<CompletedTasksSection />)
  const opener = screen.getByRole('button', { name: 'Delete completed tasks…' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, dialog: screen.getByRole('dialog', { name: 'Delete completed tasks' }) }
}

describe('the Delete completed tasks dialog', () => {
  it('takes focus, closes on Esc and gives focus back', () => {
    const { opener, dialog } = openCleanup()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Delete completed tasks' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Tab from its last control wraps to its first', () => {
    const { dialog } = openCleanup()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(cancel)
  })
})

describe('Offer to delete after', () => {
  const retention = () => screen.getByRole('combobox', { name: 'Offer to delete completed tasks after' }) as HTMLSelectElement
  const labels = () => Array.from(retention().options).map((o) => o.textContent)

  it('a stored value outside the choices (e.g. from an import) shows as an extra choice', () => {
    useSettingsStore.setState({ completedRetentionDays: 45 })
    render(<CompletedTasksSection />)
    expect(retention().value).toBe('45')
    expect(labels()).toEqual(['Keep forever', '7 days', '14 days', '30 days', '60 days', '90 days', '45 days'])
    cleanup()
    useSettingsStore.setState({ completedRetentionDays: 1 })
    render(<CompletedTasksSection />)
    expect(labels().at(-1)).toBe('1 day')
  })

  it('an offered value adds nothing', () => {
    useSettingsStore.setState({ completedRetentionDays: 30 })
    render(<CompletedTasksSection />)
    expect(retention().value).toBe('30')
    expect(labels()).toHaveLength(6)
  })
})
