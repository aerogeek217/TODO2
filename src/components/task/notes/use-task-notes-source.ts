import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { SAVE_DEBOUNCE_MS } from '../../../stores/note-store'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { onPageHide } from '../../../utils/page-hide'
import type { NotesSource } from './NotesBody'

/**
 * Writes a task's notes (`undefined` = none). Resolves false when the write
 * failed (it was rolled back); `void` counts as written.
 */
export type TaskNotesWrite = (todoId: number, notes: string | undefined) => void | Promise<boolean>

const storeWrite: TaskNotesWrite = (todoId, notes) => useTodoStore.getState().update(todoId, { notes })

interface TaskNotesSourceOptions {
  /** The task the notes belong to; undefined for a task not stored yet (nothing is written). */
  todoId: number | undefined
  /** The text to start from when there is no stored task (a create's seed). */
  initial?: string
  /** How the notes are written. Defaults to `todo-store.update` with just the notes. */
  write?: TaskNotesWrite
}

export interface TaskNotesSession {
  /** `NotesBody`'s source: the text typed, written debounced; `flush` writes it now. */
  source: NotesSource
  /**
   * Writes what was typed and not written yet, now. Call it before any other
   * write to the same task. A write with nothing in flight applies to the
   * store before this returns. Never rejects.
   */
  flush: () => Promise<void>
  /** The text the editor shows (a create reads it when it stores the task). */
  text: () => string
}

/**
 * A task's notes as one edit session at a time, the global note's shape:
 * typed changes are written after `SAVE_DEBOUNCE_MS` without typing, or at a
 * flush (blur, close / unmount, the page hidden or closed, Copy, Convert,
 * another write to the task);
 * each write is one `todo-store` edit, so one undo entry covers everything
 * typed since the last write. Writes run one at a time, in order, each with
 * the text as it was when it was asked for. A failed write keeps the text as
 * typed, written again with the next change or flush.
 *
 * While nothing is typed and not written yet, the text follows the store: a
 * change made elsewhere (Undo, the editor, a check-in reply) shows, and the
 * next keystroke edits that text — never older text written back over it.
 */
export function useTaskNotesSource({ todoId, initial = '', write = storeWrite }: TaskNotesSourceOptions): TaskNotesSession {
  // The task's stored notes; null while there is no such task.
  const stored = useTodoStore((s) => {
    if (todoId === undefined) return null
    const todo = s.todos.find((t) => t.id === todoId)
    return todo ? (todo.notes ?? '') : null
  })

  const [, setShown] = useState(0)
  const textRef = useRef<string>(stored ?? initial)
  const idRef = useRef(todoId)
  /** Typed since the last write was asked for. */
  const dirtyRef = useRef(false)
  /** Writes started and not finished. */
  const inFlightRef = useRef(0)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const writeRef = useLatestRef(write)
  const storedRef = useLatestRef(stored)

  /** Shows the store's text while nothing typed is waiting to be written. */
  const followStore = useCallback(() => {
    const next = storedRef.current
    if (dirtyRef.current || inFlightRef.current > 0 || next === null || next === textRef.current) return
    textRef.current = next
    if (mountedRef.current) setShown((n) => n + 1)
  }, [storedRef])

  const runWrite = useCallback(async (id: number, text: string) => {
    let ok: boolean
    try {
      ok = (await writeRef.current(id, text ? text : undefined)) !== false
    } catch {
      ok = false
    } finally {
      inFlightRef.current--
    }
    // Not written: still to write, unless this is another task's text now.
    if (!ok && idRef.current === id) dirtyRef.current = true
    followStore()
  }, [writeRef, followStore])

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    const id = idRef.current
    if (!dirtyRef.current || id === undefined) return queueRef.current
    dirtyRef.current = false
    const text = textRef.current
    inFlightRef.current++
    // Nothing in flight: start now, so the store has the text before the
    // caller's own write. Else after the one running.
    queueRef.current = inFlightRef.current === 1
      ? runWrite(id, text)
      : queueRef.current.then(() => runWrite(id, text))
    return queueRef.current
  }, [runWrite])


  const source = useMemo<NotesSource>(() => ({
    get: () => textRef.current,
    set: (next) => {
      textRef.current = next
      if (idRef.current === undefined) return
      dirtyRef.current = true
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        void flush()
      }, SAVE_DEBOUNCE_MS)
    },
    flush,
  }), [flush])

  // Another task: write what was typed for the last one, then show this one's.
  useLayoutEffect(() => {
    if (idRef.current === todoId) return
    void flush()
    idRef.current = todoId
    dirtyRef.current = false
    textRef.current = storedRef.current ?? ''
    setShown((n) => n + 1)
  }, [todoId, flush, storedRef])

  // A change made elsewhere shows while nothing typed waits.
  useLayoutEffect(() => { followStore() }, [stored, followStore])

  // Closing keeps what was typed — the popover or editor, or the page: hidden
  // or closed, the write starts in the event handler.
  useEffect(() => {
    mountedRef.current = true
    const stopOnHide = onPageHide(() => { void flush() })
    return () => {
      stopOnHide()
      mountedRef.current = false
      void flush()
    }
  }, [flush])

  const text = useCallback(() => textRef.current, [])
  return useMemo(() => ({ source, flush, text }), [source, flush, text])
}
