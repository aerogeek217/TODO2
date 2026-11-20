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

  it('an emptied title is not saved', () => {
    expect(editorChanges({ ...base, title: '   ' }, base)).toEqual({})
  })

  it('a due-date change rebuilds the repeat rule from the new date', () => {
    const repeating = { ...base, repeat: '1m' }
    const changes = editorChanges({ ...repeating, deadline: new Date(2026, 0, 31) }, repeating)
    expect(changes.dueDate).toEqual(new Date(2026, 0, 31))
    expect(changes.recurrenceRule).toEqual({ every: { count: 1, unit: 'm' }, originalDayOfMonth: 31 })
  })

  it('the repeat is its interval as typed: a new one writes its rule, an empty one removes it', () => {
    expect(editorFieldsOf({ title: 'R', dueDate: new Date(2026, 0, 5), recurrenceRule: { every: { count: 2, unit: 'w' } } }).repeat).toBe('2w')
    expect(base.repeat).toBe('')
    expect(editorChanges({ ...base, repeat: '3m' }, base)).toEqual({ recurrenceRule: { every: { count: 3, unit: 'm' }, originalDayOfMonth: 5 } })
    const repeating = { ...base, repeat: '2w' }
    expect(editorChanges({ ...repeating, repeat: '' }, repeating)).toEqual({ recurrenceRule: undefined })
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
