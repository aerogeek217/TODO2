import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { KeyboardEvent } from 'react'
import { useInlineEdit } from '../../hooks/use-inline-edit'

function key(k: string): KeyboardEvent {
  return { key: k, stopPropagation: () => {} } as unknown as KeyboardEvent
}

describe('useInlineEdit', () => {
  it('shows the live title until the user types', () => {
    const { result, rerender } = renderHook(({ title }) => useInlineEdit(title, vi.fn()), {
      initialProps: { title: 'A' },
    })
    expect(result.current.editTitle).toBe('A')
    rerender({ title: 'B' })
    expect(result.current.editTitle).toBe('B')
  })

  it('saves the trimmed draft and resets to the live title afterwards', () => {
    const onSave = vi.fn()
    const { result, rerender } = renderHook(({ title }) => useInlineEdit(title, onSave), {
      initialProps: { title: 'A' },
    })
    act(() => result.current.setEditTitle('  New  '))
    expect(result.current.editTitle).toBe('  New  ')
    act(() => result.current.handleKeyDown(key('Enter')))
    expect(onSave).toHaveBeenCalledWith('New')
    rerender({ title: 'New' })
    expect(result.current.isEditing).toBe(false)
    expect(result.current.editTitle).toBe('New')
  })

  it('Escape discards the draft without saving', () => {
    const onSave = vi.fn()
    const { result } = renderHook(() => useInlineEdit('A', onSave))
    act(() => result.current.setEditTitle('typed'))
    act(() => result.current.handleKeyDown(key('Escape')))
    expect(onSave).not.toHaveBeenCalled()
    expect(result.current.editTitle).toBe('A')
  })

  it('does not save when the untouched draft equals the title', () => {
    const onSave = vi.fn()
    const { result, rerender } = renderHook(({ title }) => useInlineEdit(title, onSave), {
      initialProps: { title: 'A' },
    })
    rerender({ title: 'B' })
    act(() => result.current.save())
    expect(onSave).not.toHaveBeenCalled()
  })
})
