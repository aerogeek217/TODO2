import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

afterEach(cleanup)

describe('NotesBody', () => {
  it('renders the footer instructions', async () => {
    await act(async () => {
      await useNoteStore.getState().load()
    })
    render(<NotesBody />)
    expect(screen.getByText(/⌘T convert/i)).toBeInTheDocument()
    expect(screen.getByText(/MD shorthand/i)).toBeInTheDocument()
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
