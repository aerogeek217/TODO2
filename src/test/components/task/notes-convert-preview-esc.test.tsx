import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { NotesConvertPreview } from '../../../components/task/notes/NotesConvertPreview'
import { draftFromText } from '../../../services/task-draft'

// The draft editor opened over the preview isn't an `aria-modal` dialog, so
// with nothing focused (e.g. after a menu inside the editor closed) an Esc
// went to the preview underneath and closed it from under the editor.

afterEach(() => { cleanup() })

function renderPreview(editing: boolean, defaultFollowup: Date | null = new Date()) {
  const ctx = { people: [], statuses: [], tags: [], today: new Date() }
  const onCancel = vi.fn()
  render(
    <NotesConvertPreview
      rows={[{ key: 0, line: { index: 0, from: 0, to: 3, body: 'One', text: '- One' } as never, draft: draftFromText('One', ctx), edited: false }]}
      lookups={{ people: [], tags: [], statuses: [], defaultFollowup, today: new Date() }}
      noteName={null}
      fromSelection={false}
      leftOut={0}
      busy={false}
      focusKey={null}
      editing={editing}
      onEdit={vi.fn()}
      onChange={() => {}}
      onCheck={() => {}}
      onRemove={vi.fn()}
      onCreate={vi.fn()}
      onCancel={onCancel}
    />,
  )
  return onCancel
}

describe('NotesConvertPreview Esc while a draft is open in the editor', () => {
  it('an Esc with nothing focused does not close the preview under the editor', () => {
    const onCancel = renderPreview(true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('with no editor open, the same Esc closes it', () => {
    const onCancel = renderPreview(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('NotesConvertPreview follow-up cell', () => {
  it('shows the default next follow-up, and none while new tasks get no follow-up', () => {
    renderPreview(false)
    expect(document.querySelector('[data-row-cell="followup"]')?.getAttribute('aria-label')).toMatch(/^Follow-up:/)
    cleanup()
    renderPreview(false, null)
    expect(document.querySelector('[data-row-cell="followup"]')?.getAttribute('aria-label')).toBe('Set follow-up')
  })
})

describe('NotesConvertPreview: a draft’s follow-up popover (cr31 N2)', () => {
  it('× after a typed date sets none: the close doesn’t write the typed date over it', () => {
    const ctx = { people: [], statuses: [], tags: [], today: new Date() }
    const onChange = vi.fn()
    render(
      <NotesConvertPreview
        rows={[{ key: 0, line: { index: 0, from: 0, to: 3, body: 'One', text: '- One' } as never, draft: draftFromText('One', ctx), edited: false }]}
        lookups={{ people: [], tags: [], statuses: [], defaultFollowup: new Date(), today: new Date() }}
        noteName={null}
        fromSelection={false}
        leftOut={0}
        busy={false}
        focusKey={null}
        editing={false}
        onEdit={vi.fn()}
        onChange={onChange}
        onCheck={() => {}}
        onRemove={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(document.querySelector('[data-row-cell="followup"]')!)
    const field = document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Next follow-up"] input')!
    fireEvent.change(field, { target: { value: 'in 3 days' } })
    expect(field.getAttribute('aria-invalid')).toBe('false')
    fireEvent.click(document.querySelector('[aria-label="Clear next follow-up"]')!)
    expect(document.querySelector('[role="dialog"][aria-label="Next follow-up"]')).toBeNull()
    const last = onChange.mock.calls.at(-1)?.[1] as { nextFollowupAt?: Date | null }
    expect(last.nextFollowupAt).toBeNull()
  })
})

describe('NotesConvertPreview: Ctrl+Enter in a picker portaled from a row (cr31)', () => {
  function renderWithCreate() {
    const waiting = { id: 1, name: 'Waiting', color: '#888888', sortOrder: 0 }
    const ctx = { people: [], statuses: [waiting], tags: [], today: new Date() }
    const onCreate = vi.fn()
    render(
      <NotesConvertPreview
        rows={[{ key: 0, line: { index: 0, from: 0, to: 3, body: 'One', text: '- One' } as never, draft: draftFromText('One', ctx), edited: false }]}
        lookups={{ people: [], tags: [], statuses: [waiting], defaultFollowup: new Date(), today: new Date() }}
        noteName={null}
        fromSelection={false}
        leftOut={0}
        busy={false}
        focusKey={null}
        editing={false}
        onEdit={vi.fn()}
        onChange={() => {}}
        onCheck={() => {}}
        onRemove={vi.fn()}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    )
    return onCreate
  }

  it('on a status option, it is the picker’s: the preview doesn’t create from it', () => {
    const onCreate = renderWithCreate()
    fireEvent.click(document.querySelector('[data-row-cell="status"]')!)
    const option = screen.getByRole('button', { name: /Waiting/ })
    expect(document.querySelector('[role="dialog"]')?.contains(option)).toBe(false)
    fireEvent.keyDown(option, { key: 'Enter', ctrlKey: true })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('in the preview itself, it creates', () => {
    const onCreate = renderWithCreate()
    fireEvent.keyDown(document.querySelector('[data-draft-row]')!, { key: 'Enter', ctrlKey: true })
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
