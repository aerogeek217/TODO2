import { describe, expect, it } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import { draftEditorTitle, draftFromEditor, draftFromText, draftToTodo, newTaskStatus, type TaskDraft } from '../../services/task-draft'

const TODAY = new Date(2026, 9, 10) // Sat 10 Oct 2026
const people: Person[] = [
  { id: 1, name: 'Priya Shah', initials: 'PS' },
  { id: 2, name: 'Ben Ortiz', initials: 'BO' },
]
const statuses: Status[] = [
  { id: 7, name: 'In progress', color: '#fff', sortOrder: 1 } as Status,
  { id: 8, name: 'Waiting', color: '#fff', sortOrder: 2 } as Status,
]
const tags: Tag[] = [{ id: 11, name: 'planning', color: '#000' } as Tag]
const ctx = { people, statuses, tags, today: TODAY }

const base: TaskDraft = {
  title: 'T', urgent: false, important: false, focus: false,
  personIds: [], newPeople: [], tagIds: [], newTags: [],
}

describe('draftFromText', () => {
  it('a line whose tokens fill the parser window keeps the whole line as a title over 500 characters', () => {
    // Why import accepts titles of any length: this is a title the app makes.
    const line = `#${'a'.repeat(499)} and the rest of the line`
    const d = draftFromText(line, ctx)
    expect(d.title).toBe(line)
    expect(d.title.length).toBeGreaterThan(500)
  })

  it('parses people, tags and commands out of the title', () => {
    const d = draftFromText('Draft homepage copy @Priya #planning /due mon', ctx)
    expect(d.title).toBe('Draft homepage copy')
    expect(d.personIds).toEqual([1])
    expect(d.tagIds).toEqual([11])
    expect(d.dueDate).toEqual(new Date(2026, 9, 12))
    expect(d.nextFollowupAt).toBeUndefined() // the default
  })

  it('keeps unknown people and tags by name, to create with the task', () => {
    const d = draftFromText('Call legal @Marco #launch @"Dana Kim"', ctx)
    expect(d.title).toBe('Call legal')
    expect(d.personIds).toEqual([])
    expect(d.newPeople).toEqual(['Marco', 'Dana Kim'])
    expect(d.newTags).toEqual(['launch'])
  })

  it('a #tag resolves as the # popup ranks it: the exact tag, else the first starting with it; created only when none does', () => {
    const tagsQ: Tag[] = [
      { id: 21, name: 'q4-review', color: '#000' } as Tag,
      { id: 22, name: 'Q4', color: '#000' } as Tag,
      { id: 23, name: 'q3', color: '#000' } as Tag,
    ]
    const c = { ...ctx, tags: tagsQ }
    expect(draftFromText('Plan #q4', c)).toMatchObject({ tagIds: [22], newTags: [] }) // exact, any case
    expect(draftFromText('Plan #q', c)).toMatchObject({ tagIds: [23], newTags: [] }) // first alphabetically: q3
    expect(draftFromText('Plan #q4-r', c)).toMatchObject({ tagIds: [21], newTags: [] })
    expect(draftFromText('Plan #zz', c)).toMatchObject({ tagIds: [], newTags: ['zz'] })
  })

  it('reads markers, /followup, /status and /repeat', () => {
    const d = draftFromText('Ask @Ben /urgent /important /focus /followup 2w /status waiting', ctx)
    expect(d).toMatchObject({ title: 'Ask', urgent: true, important: true, focus: true, statusId: 8 })
    expect(d.nextFollowupAt).toEqual(new Date(2026, 9, 24))
    expect(draftFromText('Pay rent /due fri /repeat monthly', ctx).recurrence).toBe('monthly')
  })

  it('/followup none means no follow-up', () => {
    expect(draftFromText('x /followup none', ctx).nextFollowupAt).toBeNull()
  })

  it('unreadable commands stay in the title', () => {
    expect(draftFromText('Renew /due frday', ctx).title).toBe('Renew /due frday')
  })

  it('a line of only tokens keeps its text as the title', () => {
    expect(draftFromText('/urgent', ctx).title).toBe('/urgent')
  })

  it('adds the screen filter defaults: people only when nobody is named, tags, markers', () => {
    const defaults = { personIds: [2], tagIds: [11], statusId: 7, markers: { focus: true as const } }
    const plain = draftFromText('Plain', { ...ctx, defaults })
    expect(plain).toMatchObject({ personIds: [2], tagIds: [11], focus: true, statusId: 7 })
    expect(draftFromText('With @Priya', { ...ctx, defaults }).personIds).toEqual([1])
    expect(draftFromText('With @Nobody', { ...ctx, defaults }).personIds).toEqual([])
  })

  it('never seeds a status, person or tag that no longer exists (a filter or pane naming a deleted one)', () => {
    const defaults = { personIds: [2, 98], tagIds: [97, 11], statusId: 99 }
    const d = draftFromText('Plain', { ...ctx, defaults, statusDefaultFirst: 'filter' })
    expect(d).toMatchObject({ personIds: [2], tagIds: [11] })
    expect(d.statusId).toBeUndefined()
    // The filter's deleted status gives way to Settings' default, as no filter status would.
    expect(draftFromText('Plain', { ...ctx, defaults, defaultStatusId: 8, statusDefaultFirst: 'filter' }).statusId).toBe(8)
    // A deleted Settings default status is no status either.
    expect(draftFromText('Plain', { ...ctx, defaultStatusId: 96 }).statusId).toBeUndefined()
  })

  it('status: typed /status, else the Settings default, else the filter', () => {
    const defaults = { personIds: [], tagIds: [], statusId: 7 }
    expect(draftFromText('x', { ...ctx, defaults, defaultStatusId: 8 }).statusId).toBe(8)
    expect(draftFromText('x /status in', { ...ctx, defaults, defaultStatusId: 8 }).statusId).toBe(7)
    expect(draftFromText('x', { ...ctx, defaults }).statusId).toBe(7)
    expect(draftFromText('x', ctx).statusId).toBeUndefined()
  })

  it('status with the filter first (Quick Add): typed /status, else the filter, else the Settings default', () => {
    const defaults = { personIds: [], tagIds: [], statusId: 7 }
    const filterFirst = { ...ctx, defaultStatusId: 8, statusDefaultFirst: 'filter' as const }
    expect(draftFromText('x', { ...filterFirst, defaults }).statusId).toBe(7)
    expect(draftFromText('x /status wait', { ...filterFirst, defaults }).statusId).toBe(8)
    expect(draftFromText('x', filterFirst).statusId).toBe(8)
  })
})

describe('newTaskStatus', () => {
  it('a typed status, else the defaults in the given order; none → undefined', () => {
    expect(newTaskStatus(3, { settings: 1, filter: 2 })).toBe(3)
    expect(newTaskStatus(undefined, { settings: 1, filter: 2 })).toBe(1)
    expect(newTaskStatus(undefined, { settings: 1, filter: 2 }, 'filter')).toBe(2)
    expect(newTaskStatus(undefined, { settings: null, filter: 2 })).toBe(2)
    expect(newTaskStatus(undefined, { settings: 1, filter: undefined }, 'filter')).toBe(1)
    expect(newTaskStatus(undefined, { settings: null, filter: undefined })).toBeUndefined()
  })
})

describe('draftFromEditor', () => {
  it('takes the fields and picked people / tags, and parses tokens left in the title', () => {
    const d = draftFromEditor(
      { title: 'Ask for access @Marco /due mon', statusId: 7, urgent: true },
      { personIds: [2], tagIds: [11] },
      ctx,
    )
    expect(d).toMatchObject({ title: 'Ask for access', statusId: 7, urgent: true, personIds: [2], tagIds: [11], newPeople: ['Marco'] })
    expect(d.dueDate).toEqual(new Date(2026, 9, 12))
  })

  it('drops a picked status, person or tag that no longer exists (seeded from a filter naming a deleted one)', () => {
    const d = draftFromEditor({ title: 'x', statusId: 99 }, { personIds: [98, 1], tagIds: [97] }, ctx)
    expect(d).toMatchObject({ personIds: [1], tagIds: [] })
    expect(d.statusId).toBeUndefined()
  })

  it('the editor’s due date wins over a typed one', () => {
    const due = new Date(2026, 9, 30)
    expect(draftFromEditor({ title: 'x /due mon', dueDate: due }, { personIds: [], tagIds: [] }, ctx).dueDate).toBe(due)
  })

  it('follow-up: absent = default, undefined = none, a date = that date', () => {
    const none = { personIds: [], tagIds: [] }
    expect('nextFollowupAt' in draftFromEditor({ title: 'x' }, none, ctx)).toBe(false)
    expect(draftFromEditor({ title: 'x', nextFollowupAt: undefined }, none, ctx).nextFollowupAt).toBeNull()
    const d = new Date(2026, 10, 1)
    expect(draftFromEditor({ title: 'x', nextFollowupAt: d }, none, ctx).nextFollowupAt).toBe(d)
    expect(draftFromEditor({ title: 'x /followup none' }, none, ctx).nextFollowupAt).toBeNull()
  })

  it('round-trips a draft through the editor title', () => {
    const draft = draftFromText('Call legal @Marco #launch @Ben', ctx)
    const back = draftFromEditor({ title: draftEditorTitle(draft) }, { personIds: draft.personIds, tagIds: draft.tagIds }, ctx)
    expect(back).toMatchObject({ title: 'Call legal', personIds: [2], newPeople: ['Marco'], newTags: ['launch'] })
  })
})

describe('draftEditorTitle', () => {
  it('appends the people and tags still to create', () => {
    expect(draftEditorTitle({ ...base, title: 'Call', newPeople: ['Marco', 'Dana Kim'], newTags: ['q4'] }))
      .toBe('Call @Marco @"Dana Kim" #q4')
  })
})

describe('draftToTodo', () => {
  const now = new Date(2026, 9, 10, 9, 30)
  const fallback = new Date(2026, 10, 10)

  it('gives the default follow-up unless the draft chose one', () => {
    expect(draftToTodo(base, now, fallback).nextFollowupAt).toBe(fallback)
    expect('nextFollowupAt' in draftToTodo({ ...base, nextFollowupAt: null }, now, fallback)).toBe(false)
    const d = new Date(2026, 9, 24)
    expect(draftToTodo({ ...base, nextFollowupAt: d }, now, fallback).nextFollowupAt).toBe(d)
  })

  it('keeps a repeat only with a due date', () => {
    expect(draftToTodo({ ...base, recurrence: 'weekly' }, now, fallback).recurrenceRule).toBeUndefined()
    const due = new Date(2026, 9, 12)
    expect(draftToTodo({ ...base, recurrence: 'weekly', dueDate: due }, now, fallback).recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('stores only true markers and set fields', () => {
    const row = draftToTodo({ ...base, urgent: true }, now, fallback)
    expect(row).toEqual({ title: 'T', isCompleted: false, createdAt: now, modifiedAt: now, nextFollowupAt: fallback, urgent: true })
  })

  it('keeps the editor’s Last follow-up, notes and Progress; a repeat keeps its day of month', () => {
    const due = new Date(2026, 9, 12)
    const d = new Date(2026, 9, 1)
    const row = draftToTodo({ ...base, dueDate: due, recurrence: 'monthly', statusId: 7, lastFollowupAt: d, notes: 'n', progress: 'p' }, now, fallback)
    expect(row).toMatchObject({ dueDate: due, recurrenceRule: { type: 'monthly', originalDayOfMonth: 12 }, statusId: 7, lastFollowupAt: d, notes: 'n', progress: 'p' })
  })
})
