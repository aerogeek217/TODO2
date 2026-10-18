import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { db } from '../../data/database'
import { emptyPredicate } from '../../models'
import { createTab } from '../../models/workspace-layout'
import { useTodoStore } from '../../stores/todo-store'

/**
 * `WorkspacePage` renders once per change of its own inputs (the layout,
 * overlays, drags) — not on every task edit, which only the widgets showing
 * the task need. Its renders are counted through the one hook only it calls.
 */

const renders = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../hooks/use-entity-assignments-for-todos', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../hooks/use-entity-assignments-for-todos')>()
  return {
    useEntityAssignmentsForLoadedTodos: () => {
      renders.count++
      real.useEntityAssignmentsForLoadedTodos()
    },
  }
})

const { WorkspacePage } = await import('../../views/WorkspacePage')

afterEach(() => cleanup())

describe('WorkspacePage renders', () => {
  it('a task edit re-renders the list row, not the page', async () => {
    const now = new Date()
    const listDefinitionId = await db.listDefinitions.add({
      name: 'Tasks', sortOrder: 1, 
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
    })
    const todoId = await db.todos.add({ uid: 'u1', title: 'First title', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
    await db.layouts.add({
      name: 'Main', createdAt: now, modifiedAt: now,
      columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [createTab('lens', 'list', { listDefinitionId })] }] }],
    })

    const router = createMemoryRouter([{ path: '*', element: <WorkspacePage /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('First title')).toBeInTheDocument()
    const before = renders.count

    await act(async () => { await useTodoStore.getState().update(todoId, { title: 'Second title' }) })
    expect(await screen.findByText('Second title')).toBeInTheDocument()
    await act(async () => { await useTodoStore.getState().update(todoId, { focus: true }) })

    expect(renders.count).toBe(before)
  })
})
