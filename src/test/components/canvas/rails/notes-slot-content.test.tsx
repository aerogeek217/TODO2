import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { db } from '../../../../data/database'
import { NotesSlotContent } from '../../../../components/canvas/rails/NotesSlotContent'
import { useNoteStore } from '../../../../stores/note-store'
import { useCanvasStore } from '../../../../stores/canvas-store'
import { useTodoStore } from '../../../../stores/todo-store'
import { useSettingsStore } from '../../../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useCanvasStore.setState({ selectedCanvasId: null })
  useTodoStore.setState({ todos: [], loading: false, error: null })
  useSettingsStore.setState({ defaultProjectId: null })
})

afterEach(cleanup)

describe('NotesSlotContent', () => {
  it('shares the notes store with NotesBody (content from store flows through)', async () => {
    await act(async () => {
      const now = new Date()
      await db.notes.add({ content: 'SLOT SHARED NOTES', createdAt: now, modifiedAt: now })
      await useNoteStore.getState().load()
    })
    render(<NotesSlotContent />)
    await act(async () => {
      await Promise.resolve()
    })
    const container = document.querySelector('.cm-content')
    expect(container).toBeTruthy()
    expect(container!.textContent).toContain('SLOT SHARED NOTES')
    // Footer is present (body renders with `dock="slot"`).
    expect(screen.getByText(/⌘T convert/i)).toBeInTheDocument()
  })
})
