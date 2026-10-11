import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { db } from '../../../data/database'
import { NotesWidget } from '../../../components/workspace/NotesWidget'
import { useNoteStore } from '../../../stores/note-store'
import { useTodoStore } from '../../../stores/todo-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useTodoStore.setState({ todos: [], loading: false, error: null })
})

afterEach(cleanup)

describe('NotesWidget', () => {
  it('shares the notes store with NotesBody (content from store flows through)', async () => {
    await act(async () => {
      const now = new Date()
      await db.notes.add({ content: 'SLOT SHARED NOTES', createdAt: now, modifiedAt: now })
      await useNoteStore.getState().load()
    })
    render(<NotesWidget />)
    await act(async () => {
      await Promise.resolve()
    })
    const container = document.querySelector('.cm-content')
    expect(container).toBeTruthy()
    expect(container!.textContent).toContain('SLOT SHARED NOTES')
  })
})
