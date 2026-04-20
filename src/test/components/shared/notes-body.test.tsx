import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { db } from '../../../data/database'
import { NotesBody } from '../../../components/shared/notes/NotesBody'
import { useNoteStore } from '../../../stores/note-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useCanvasStore.setState({ selectedCanvasId: null })
  useTodoStore.setState({ todos: [], loading: false, error: null })
  useSettingsStore.setState({ defaultProjectId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotesBody', () => {
  it('renders no footer chrome (editor + toolbar only)', async () => {
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    // No legacy chips/hints, no save-status line.
    expect(screen.queryByText(/MD shorthand/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/convert current line/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/saved|unsaved|saving/i)).not.toBeInTheDocument()
  })

  it('exposes the convert-to-task shortcut as Alt+T on Windows', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' } as Navigator)
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    const btn = screen.getByLabelText('Convert line to task')
    expect(btn.getAttribute('title')).toMatch(/Alt\+T/)
  })

  it('exposes the convert-to-task shortcut as ⌥T on Mac', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' } as Navigator)
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    const btn = screen.getByLabelText('Convert line to task')
    expect(btn.getAttribute('title')).toMatch(/⌥T/)
  })

  it('renders the toolbar by default', async () => {
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    expect(screen.getByRole('toolbar', { name: /Notes formatting/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy as rich text')).toBeInTheDocument()
  })

  it('hides the toolbar when showToolbar={false}', async () => {
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody showToolbar={false} />)
    expect(screen.queryByRole('toolbar', { name: /Notes formatting/i })).not.toBeInTheDocument()
  })

  it('reflects content loaded into the note store', async () => {
    await act(async () => {
      const now = new Date()
      await db.notes.add({ content: 'FROM STORE', createdAt: now, modifiedAt: now })
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    // CodeMirror renders content as plain text inside .cm-content; scan the DOM.
    await act(async () => {
      await Promise.resolve()
    })
    const container = document.querySelector('.cm-content')
    expect(container).toBeTruthy()
    expect(container!.textContent).toContain('FROM STORE')
  })
})
