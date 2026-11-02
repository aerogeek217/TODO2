import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { StatusEditor } from '../../../components/settings/StatusEditor'
import { useStatusStore } from '../../../stores/status-store'
import { resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  await useStatusStore.getState().add('Alpha', '#a00')
  await useStatusStore.getState().add('Beta', '#0a0')
})

afterEach(cleanup)

const names = () => [...useStatusStore.getState().statuses].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.name)

describe('StatusEditor', () => {
  it('Esc while a row is held by the keyboard cancels the drag, not the editor; then Esc closes it', async () => {
    const onClose = vi.fn()
    render(<StatusEditor onClose={onClose} />)
    const panel = screen.getByRole('dialog')
    const grips = () => panel.querySelectorAll<HTMLElement>('[aria-roledescription="sortable"]')
    await waitFor(() => expect(grips()).toHaveLength(2))
    const grip = grips()[0]!
    grip.focus()
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    // The sensor listens on the document from the next tick.
    await new Promise((r) => setTimeout(r, 0))
    await waitFor(() => expect(grip).toHaveAttribute('aria-pressed', 'true'))

    // Esc from inside the panel: the frame's own key handler sees it first.
    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(grip).not.toHaveAttribute('aria-pressed', 'true'))
    expect(onClose).not.toHaveBeenCalled()
    expect(names()).toEqual(['Alpha', 'Beta'])

    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
