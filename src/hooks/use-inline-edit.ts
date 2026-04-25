import { useCallback, useEffect, useRef, useState } from 'react'
import { INLINE_EDIT_BLUR_MS } from '../constants'

/**
 * Encapsulates inline title editing logic for TaskRow.
 * Manages editing state, title sync, focus, save, cancel, and the
 * 250ms click-to-edit timer.
 */
export function useInlineEdit(
  title: string,
  onSave: (newTitle: string) => void,
) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)

  // Sync external title changes when not editing
  useEffect(() => {
    if (!isEditing) setEditTitle(title)
  }, [title, isEditing])

  // Auto-focus and select on edit start
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const save = useCallback(() => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== title) {
      onSave(trimmed)
    }
    setIsEditing(false)
  }, [editTitle, title, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      save()
    } else if (e.key === 'Escape') {
      setEditTitle(title)
      setIsEditing(false)
    }
  }, [save, title])

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  /** Start editing after a 250ms delay (distinguishes click from double-click) */
  const scheduleEdit = useCallback(() => {
    timerRef.current = window.setTimeout(() => setIsEditing(true), INLINE_EDIT_BLUR_MS)
  }, [])

  /** Cancel the scheduled edit (e.g. on double-click) */
  const cancelScheduledEdit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return {
    isEditing,
    editTitle,
    setEditTitle,
    inputRef,
    save,
    handleKeyDown,
    scheduleEdit,
    cancelScheduledEdit,
  }
}
