import { describe, it, expect } from 'vitest'
import { editorChanges, editorFieldsOf, storeUpdatesToShow, type EditorFields } from '../../components/task/editor-fields'

const base: EditorFields = editorFieldsOf({ title: 'Old', statusId: 1, dueDate: new Date(2026, 0, 5) })

describe('editorChanges', () => {
  it('sends only the fields the user changed since the last sync', () => {
    expect(editorChanges({ ...base, title: '  New  ' }, base)).toEqual({ title: 'New' })
    expect(editorChanges(base, base)).toEqual({})
  })

  it('a form the store has not synced yet still sends only the user’s change', () => {
    // A bulk status change landed; the editor hasn't synced it. The form and
    // the baseline both hold the old status, so it isn't written back.
    const form = { ...base, title: 'New' }
    expect(editorChanges(form, base)).toEqual({ title: 'New' })
  })

  it('an emptied title is not saved; cleared text fields are removed', () => {
    expect(editorChanges({ ...base, title: '   ', notes: '', progress: '' }, { ...base, notes: 'n', progress: 'p' }))
      .toEqual({ notes: undefined, progress: undefined })
  })

  it('a due-date change rebuilds the repeat rule from the new date', () => {
    const repeating = { ...base, recurrenceType: 'monthly' as const }
    const changes = editorChanges({ ...repeating, deadline: new Date(2026, 0, 31) }, repeating)
    expect(changes.dueDate).toEqual(new Date(2026, 0, 31))
    expect(changes.recurrenceRule).toMatchObject({ type: 'monthly' })
  })
})

describe('storeUpdatesToShow', () => {
  it('shows store changes in untouched fields and keeps the user’s edits', () => {
    const form = { ...base, title: 'Half-typ' }
    const store = { ...base, title: 'Renamed elsewhere', deadline: new Date(2026, 1, 1), statusId: undefined }
    expect(storeUpdatesToShow(store, base, form)).toEqual({ deadline: new Date(2026, 1, 1), statusId: undefined })
  })

  it('nothing to show when the store is unchanged', () => {
    expect(storeUpdatesToShow(base, base, { ...base, title: 'x' })).toEqual({})
  })
})
