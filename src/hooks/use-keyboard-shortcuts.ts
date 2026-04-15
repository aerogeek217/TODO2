import { useEffect, useRef } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { indentTasks, outdentTasks, moveTasksInDirection } from '../services/task-placement'
import { pasteTasksAt } from '../services/clipboard'
import { bySortOrder } from '../utils/hierarchy'

interface KeyboardShortcutOptions {
  openCreatePopup: () => void
  openPalette: () => void
  closePalette: () => void
  navigate: (path: string) => void
  createStickyNote?: () => void
  openShortcutsModal?: () => void
  fitView?: () => void
  toggleProjectNavigator?: () => void
  enabled?: boolean
}

export function useKeyboardShortcuts({ openCreatePopup, openPalette, closePalette, navigate, createStickyNote, openShortcutsModal, fitView, toggleProjectNavigator, enabled = true }: KeyboardShortcutOptions) {
  const pendingChordRef = useRef<{ key: string; timestamp: number } | null>(null)
  const CHORD_TIMEOUT = 1000

  // Store callbacks in refs to avoid stale closures without re-registering the event listener
  const cbRef = useRef({ openCreatePopup, openPalette, closePalette, navigate, createStickyNote, openShortcutsModal, fitView, toggleProjectNavigator })
  cbRef.current = { openCreatePopup, openPalette, closePalette, navigate, createStickyNote, openShortcutsModal, fitView, toggleProjectNavigator }

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = async (e: KeyboardEvent) => {
      const { openCreatePopup, openPalette, closePalette, navigate, createStickyNote, openShortcutsModal, fitView, toggleProjectNavigator } = cbRef.current
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // Undo/Redo — skip when focus is in a text input (native undo handles it)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
        e.preventDefault()
        if (e.shiftKey) {
          useUndoStore.getState().redo()
        } else {
          useUndoStore.getState().undo()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !isInput) {
        e.preventDefault()
        useUndoStore.getState().redo()
        return
      }

      // Chord completion
      const pending = pendingChordRef.current
      if (pending && Date.now() - pending.timestamp < CHORD_TIMEOUT) {
        pendingChordRef.current = null
        if (pending.key === 'g' && !isInput) {
          if (e.key === 'c') {
            e.preventDefault()
            navigate('/')
            return
          } else if (e.key === 'd') {
            e.preventDefault()
            navigate('/dashboard')
            return
          } else if (e.key === 'l') {
            e.preventDefault()
            navigate('/list')
            return
          } else if (e.key === 'a') {
            e.preventDefault()
            navigate('/calendar')
            return
          } else if (e.key === 's') {
            e.preventDefault()
            navigate('/settings')
            return
          }
        }
        // Invalid second key — fall through to normal handling
      } else {
        pendingChordRef.current = null
      }

      // Global shortcuts (work regardless of input focus)
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        openCreatePopup()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        openPalette()
        return
      }
      if (e.key === 'Escape') {
        const { editPopupMode, clipboardTodoIds } = useUIStore.getState()
        if (!editPopupMode) {
          useUIStore.getState().clearSelection()
        }
        if (clipboardTodoIds.length > 0) {
          useUIStore.getState().clearClipboard()
        }
        closePalette()
        return
      }

      // Ctrl+0 — fit all to view
      if ((e.ctrlKey || e.metaKey) && e.key === '0' && fitView) {
        e.preventDefault()
        fitView()
        return
      }

      // Ctrl+F — focus search input (works even in inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
        if (searchInput) {
          e.preventDefault()
          searchInput.focus()
          searchInput.select()
        }
        return
      }

      // Ctrl+X — cut selected tasks (works outside inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !isInput) {
        const ids = useUIStore.getState().selectedTodoIds
        if (ids.size > 0) {
          e.preventDefault()
          const { todos } = useTodoStore.getState()
          const first = todos.find(t => ids.has(t.id))
          useUIStore.getState().cutTasks(Array.from(ids), first?.projectId ?? null)
        }
        return
      }

      // Ctrl+V — paste cut tasks at focused position (works outside inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isInput) {
        const { clipboardTodoIds, focusedTodoId } = useUIStore.getState()
        if (clipboardTodoIds.length > 0) {
          e.preventDefault()
          const { todos } = useTodoStore.getState()
          const focusedTodo = focusedTodoId != null ? todos.find(t => t.id === focusedTodoId) : null
          if (focusedTodo && focusedTodo.projectId != null) {
            const projectTodos = todos
              .filter(t => t.projectId === focusedTodo.projectId && (focusedTodo.parentId == null ? t.parentId == null : t.parentId === focusedTodo.parentId))
              .sort(bySortOrder)
            const focusedIdx = projectTodos.findIndex(t => t.id === focusedTodo.id)
            const beforeTodo = focusedIdx < projectTodos.length - 1 ? projectTodos[focusedIdx + 1] : null
            await pasteTasksAt({
              projectId: focusedTodo.projectId,
              parentId: focusedTodo.parentId ?? undefined,
              beforeTodoId: beforeTodo?.id ?? null,
            })
          } else {
            const sourceProjectId = useUIStore.getState().clipboardSourceProjectId
            if (sourceProjectId == null) return
            await pasteTasksAt({ projectId: sourceProjectId, parentId: undefined, beforeTodoId: null })
          }
        }
        return
      }

      // All remaining shortcuts require no input focus
      if (isInput) return

      // Skip task shortcuts when edit popup is open
      const { editPopupMode } = useUIStore.getState()

      // Chord initiation: G key
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'g') {
        e.preventDefault()
        pendingChordRef.current = { key: 'g', timestamp: Date.now() }
        return
      }

      // / — focus search input (only outside inputs)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === '/') {
        const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
        if (searchInput) {
          e.preventDefault()
          searchInput.focus()
          searchInput.select()
        }
        return
      }

      // F — focus filter bar
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F') && !e.shiftKey) {
        const filterRow = document.querySelector('[data-filter-row]')
        const firstBtn = filterRow?.querySelector('button') as HTMLElement | null
        if (firstBtn) {
          e.preventDefault()
          firstBtn.focus()
        }
        return
      }

      // N — create sticky note at viewport center (canvas view only)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'n') {
        if (createStickyNote) {
          e.preventDefault()
          createStickyNote()
          return
        }
      }

      // P — toggle project navigator (canvas view only)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'p') {
        if (toggleProjectNavigator) {
          e.preventDefault()
          toggleProjectNavigator()
          return
        }
      }

      // ? — show keyboard shortcuts modal
      if (e.key === '?' && openShortcutsModal) {
        e.preventDefault()
        openShortcutsModal()
        return
      }

      // Ctrl+A — select all visible tasks
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
        if (rows.length > 0) {
          e.preventDefault()
          const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
          useUIStore.getState().selectAll(todoIds)
          return
        }
      }

      // Task shortcuts — skip when edit popup is open
      if (editPopupMode) return

      const ids = useUIStore.getState().selectedTodoIds

      // Enter — edit selected task
      if (e.key === 'Enter' && ids.size === 1) {
        e.preventDefault()
        const todoId = Array.from(ids)[0]
        useUIStore.getState().openEditPopup(todoId)
        return
      }

      // Delete
      if (e.key === 'Delete' && ids.size > 0) {
        e.preventDefault()
        useUIStore.getState().showBulkConfirmation('delete', Array.from(ids))
        return
      }

      // Space — toggle complete
      if (e.key === ' ' && ids.size > 0) {
        e.preventDefault()
        const { todos } = useTodoStore.getState()
        const selectedTodos = todos.filter((t) => ids.has(t.id))
        const allCompleted = selectedTodos.every((t) => t.isCompleted)
        const action = allCompleted ? 'uncomplete' : 'complete'
        if (ids.size > 1) {
          useUIStore.getState().showBulkConfirmation(action, Array.from(ids))
        } else {
          useTodoStore.getState().toggleComplete(selectedTodos[0].id)
        }
        return
      }

      // Insert — inline create after selected
      if (e.key === 'Insert' && ids.size === 1) {
        e.preventDefault()
        const todoId = Array.from(ids)[0]
        useUIStore.getState().clearSelection()
        useUIStore.getState().triggerInlineCreate(todoId)
        return
      }

      // Arrow keys — navigation and move
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
        const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
        if (todoIds.length === 0) return

        // Ctrl+Arrow — move task(s) up/down
        if (e.ctrlKey && !e.shiftKey && ids.size > 0) {
          e.preventDefault()
          const direction = e.key === 'ArrowUp' ? 'up' : 'down' as const
          const { todos, applyMutations } = useTodoStore.getState()
          const selected = todos.filter(t => ids.has(t.id))
          const firstTask = selected[0]
          if (!firstTask) return
          const projectTodos = todos
            .filter(t => t.projectId === firstTask.projectId)
            .sort(bySortOrder)
          const mutations = moveTasksInDirection(projectTodos, ids, direction)
          if (mutations.length > 0) {
            await applyMutations(mutations)
          }
          return
        }

        // Plain arrow or Shift+Arrow — selection navigation
        if (ids.size > 0) {
          e.preventDefault()
          const { selectionFocusId, selectionAnchorId } = useUIStore.getState()
          const currentId = (e.shiftKey ? selectionFocusId : selectionAnchorId) ?? Array.from(ids)[0]
          const currentIdx = todoIds.indexOf(currentId)
          if (currentIdx === -1) return
          const nextIdx = e.key === 'ArrowUp' ? currentIdx - 1 : currentIdx + 1
          if (nextIdx < 0 || nextIdx >= todoIds.length) return
          const nextId = todoIds[nextIdx]
          if (e.shiftKey) {
            useUIStore.getState().rangeSelectTodo(nextId, todoIds)
          } else {
            useUIStore.getState().selectOneTodo(nextId)
          }
          rows[nextIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        } else {
          // No selection — select first or last task
          e.preventDefault()
          const targetId = e.key === 'ArrowDown' ? todoIds[0] : todoIds[todoIds.length - 1]
          useUIStore.getState().selectOneTodo(targetId)
          const targetIdx = e.key === 'ArrowDown' ? 0 : rows.length - 1
          rows[targetIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
        return
      }

      // Home/End — jump to first/last task
      if (e.key === 'Home' || e.key === 'End') {
        const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
        if (rows.length === 0) return
        e.preventDefault()
        const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
        const targetId = e.key === 'Home' ? todoIds[0] : todoIds[todoIds.length - 1]
        if (e.shiftKey && ids.size > 0) {
          useUIStore.getState().rangeSelectTodo(targetId, todoIds)
        } else {
          useUIStore.getState().selectOneTodo(targetId)
        }
        const targetEl = e.key === 'Home' ? rows[0] : rows[rows.length - 1]
        targetEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        return
      }

      // Tab / Shift+Tab — indent / outdent (only when tasks selected)
      if (e.key === 'Tab' && ids.size > 0) {
        e.preventDefault()
        const { todos, applyMutations } = useTodoStore.getState()
        const selected = todos.filter(t => ids.has(t.id))
        const firstTask = selected[0]
        if (!firstTask) return
        const projectTodos = todos
          .filter(t => t.projectId === firstTask.projectId)
          .sort(bySortOrder)
        const mutations = e.shiftKey
          ? outdentTasks(projectTodos, ids)
          : indentTasks(projectTodos, ids)
        if (mutations.length > 0) {
          await applyMutations(mutations)
        }
        return
      }

      // Ctrl+] / Ctrl+[ — indent / outdent (existing alias)
      if (e.ctrlKey && (e.key === ']' || e.key === '[')) {
        if (ids.size > 0) {
          e.preventDefault()
          const { todos, applyMutations } = useTodoStore.getState()
          const selected = todos.filter(t => ids.has(t.id))
          const firstTask = selected[0]
          if (!firstTask) return
          const projectTodos = todos
            .filter(t => t.projectId === firstTask.projectId)
            .sort(bySortOrder)
          const mutations = e.key === ']'
            ? indentTasks(projectTodos, ids)
            : outdentTasks(projectTodos, ids)
          if (mutations.length > 0) {
            await applyMutations(mutations)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
