import { describe, expect, it } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import { draftEditorTitle, draftFromEditor, draftFromText, draftToTodo, type TaskDraft } from '../../services/task-draft'

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
    const defaults = { personIds: [2], tagIds: [11, 12], statusId: 7, markers: { focus: true as const } }
    const plain = draftFromText('Plain', { ...ctx, defaults })
    expect(plain).toMatchObject({ personIds: [2], tagIds: [11, 12], focus: true, statusId: 7 })
    expect(draftFromText('With @Priya', { ...ctx, defaults }).personIds).toEqual([1])
    expect(draftFromText('With @Nobody', { ...ctx, defaults }).personIds).toEqual([])
  })

  it('status: typed /status, else the Settings default, else the filter', () => {
    const defaults = { personIds: [], tagIds: [], statusId: 7 }
    expect(draftFromText('x', { ...ctx, defaults, defaultStatusId: 8 }).statusId).toBe(8)
    expect(draftFromText('x /status in', { ...ctx, defaults, defaultStatusId: 8 }).statusId).toBe(7)
    expect(draftFromText('x', { ...ctx, defaults }).statusId).toBe(7)
    expect(draftFromText('x', ctx).statusId).toBeUndefined()
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
})
