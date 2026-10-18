import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

// No File System Access API (the download fallback) unless a test sets a save picker.
const picker = vi.hoisted(() => ({ save: null as null | ((opts: unknown) => Promise<unknown>) }))
vi.mock('../../../utils/file-picker', () => ({
  getSaveFilePicker: () => picker.save,
  getOpenFilePicker: () => null,
}))

import { ImportExportSection } from '../../../components/settings/sections/ImportExportSection'
import { db } from '../../../data/database'
import { makeTodo } from '../../helpers'

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
  picker.save = null
})

async function clickExport() {
  render(<ImportExportSection />)
  fireEvent.click(await screen.findByRole('button', { name: 'Export JSON' }))
}

describe('Settings → Import / Export — Export JSON self-check', () => {
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

describe('Settings → Import / Export — what an export says', () => {
  const pickerSaving = () => {
    picker.save = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) })
  }
  const pickerCancelled = () => {
    const cancel = vi.fn(async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }) })
    picker.save = cancel
    return cancel
  }

  for (const [button, savedText, fileName] of [
    ['Export JSON', 'Exported!', /^todo2-backup-.+\.json$/],
    ['Export Markdown', 'Markdown exported!', /^todos-\d{4}-\d{2}-\d{2}\.md$/],
  ] as const) {
    it(`${button}: a plain download names the file and points to the Downloads folder`, async () => {
      render(<ImportExportSection />)
      fireEvent.click(await screen.findByRole('button', { name: button }))
      const message = await screen.findByText(/^Downloaded .+ — check your Downloads folder\.$/)
      const name = /^Downloaded (.+) — check/.exec(message.textContent ?? '')?.[1] ?? ''
      expect(name).toMatch(fileName)
      expect(screen.queryByText(savedText)).toBeNull()
    })

    it(`${button}: saved through the save dialog says "${savedText}"`, async () => {
      pickerSaving()
      render(<ImportExportSection />)
      fireEvent.click(await screen.findByRole('button', { name: button }))
      expect(await screen.findByText(savedText)).toBeTruthy()
      expect(screen.queryByText(/Downloaded/)).toBeNull()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    it(`${button}: cancelling the save dialog says nothing`, async () => {
      const cancel = pickerCancelled()
      render(<ImportExportSection />)
      fireEvent.click(await screen.findByRole('button', { name: button }))
      await waitFor(() => expect(cancel).toHaveBeenCalled())
      await act(async () => {})
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(screen.queryByText(savedText)).toBeNull()
      expect(screen.queryByText(/Downloaded/)).toBeNull()
    })
  }
})
