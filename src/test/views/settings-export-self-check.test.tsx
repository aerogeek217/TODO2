import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// Force the download fallback (no File System Access API in this test).
vi.mock('../../utils/file-picker', () => ({
  getSaveFilePicker: () => null,
  getOpenFilePicker: () => null,
}))

import { SettingsPage } from '../../views/SettingsPage'
import { db } from '../../data/database'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function clickExport() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Export JSON' }))
}

describe('SettingsPage — Export JSON self-check', () => {
  it('saves the file and shows a persistent warning naming the bad row', async () => {
    await db.todos.add(makeTodo({ id: 1 }))
    await db.todos.add(makeTodo({ id: 2, title: '' }))

    await clickExport()

    const warning = await screen.findByTestId('export-self-check-warning')
    expect(warning).toHaveTextContent('would not import back')
    expect(warning).toHaveTextContent('Invalid "todos" record at index 1')
    expect(warning).toHaveTextContent('bad field "title"')
    // The file was still produced.
    expect(URL.createObjectURL).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('export-self-check-warning')).toBeNull()
  })

  it('shows no warning for a clean export', async () => {
    await db.todos.add(makeTodo({ id: 1 }))

    await clickExport()

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    expect(screen.queryByTestId('export-self-check-warning')).toBeNull()
  })
})
