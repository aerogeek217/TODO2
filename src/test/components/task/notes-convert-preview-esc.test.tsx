import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
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

describe('NotesConvertPreview follow-up chip', () => {
  it('shows the default next follow-up, and none while new tasks get no follow-up', () => {
    renderPreview(false)
    expect(document.querySelector('[title="The default next follow-up"]')).not.toBeNull()
    cleanup()
    renderPreview(false, null)
    expect(document.querySelector('[title="The default next follow-up"]')).toBeNull()
  })
})
