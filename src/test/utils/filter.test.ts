import { describe, it, expect } from 'vitest'
import { groupTodosByTextMatch, matchTodoText, textMatchContextFor, toggleItem } from '../../utils/filter'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { emptyFilterCriteria, makeTodo } from '../helpers'
import { DEFAULT_HOT_RULE } from '../../utils/hot'

describe('matchTodoText', () => {
  it('returns matched=true with no fields for empty query', () => {
    const r = matchTodoText({ title: 'anything' }, '')
    expect(r).toEqual({ matched: true, fields: [] })
  })

  it('matches title case-insensitively', () => {
    const r = matchTodoText({ title: 'Buy MILK today' }, 'milk')
    expect(r.matched).toBe(true)
    expect(r.fields).toEqual(['title'])
  })

  it('matches notes independently from title', () => {
    const r = matchTodoText({ title: 'Grocery', notes: 'remember the eggs' }, 'egg')
    expect(r.matched).toBe(true)
    expect(r.fields).toEqual(['notes'])
  })

  it('reports multiple fields when the query matches in several places', () => {
    const r = matchTodoText({ title: 'foo bar', notes: 'foo' }, 'foo', {
      personNames: ['Foo Person'],
      statusName: 'InProgress',
      tagNames: ['foo-tag'],
    })
    expect(r.matched).toBe(true)
    expect(r.fields).toEqual(['title', 'notes', 'person', 'tag'])
  })

  it('matches the task’s status updates via ctx, as their own field, after notes', () => {
    const todo = { title: 'Budget', notes: 'numbers' }
    expect(matchTodoText(todo, 'slack', { statusUpdateTexts: ['Pinged on Slack', 'Waiting'] }).fields).toEqual(['statusUpdate'])
    expect(matchTodoText(todo, 'num', { statusUpdateTexts: ['Numbers by Friday'] }).fields).toEqual(['notes', 'statusUpdate'])
    expect(matchTodoText(todo, 'slack').matched).toBe(false)
  })

  it('matches on person / status via ctx', () => {
    const todo = { title: 't', notes: 'n' }
    expect(matchTodoText(todo, 'alice', { personNames: ['Alice', 'Bob'] }).fields).toEqual(['person'])
    expect(matchTodoText(todo, 'blocked', { statusName: 'Blocked' }).fields).toEqual(['status'])
  })

  // `tagNames` is resolved from the registry by the caller — e.g. via
  // `assignedTagsMap.get(todoId)?.map(t => t.name)`. The cases below supply
  // the already-resolved names the caller would produce.
  it('matches on tag via ctx.tagNames (any registry-resolved tag hit)', () => {
    const todo = { title: 't', notes: 'n' }
    expect(matchTodoText(todo, 'urgent', { tagNames: ['urgent', 'today'] }).fields).toEqual(['tag'])
    expect(matchTodoText(todo, 'today', { tagNames: ['urgent', 'today'] }).fields).toEqual(['tag'])
  })

  it('does not match tag when tagNames is empty or absent (registry has no assignments)', () => {
    const todo = { title: 't', notes: 'n' }
    expect(matchTodoText(todo, 'urgent', { tagNames: [] }).fields).toEqual([])
    expect(matchTodoText(todo, 'urgent', {}).fields).toEqual([])
  })

  it('matches tag case-insensitively (query uppercase, canonical casing from registry)', () => {
    const r = matchTodoText({ title: 't' }, 'URGENT', { tagNames: ['Urgent'] })
    expect(r.matched).toBe(true)
    expect(r.fields).toEqual(['tag'])
  })

  it('is null-safe for missing todo fields and missing context', () => {
    const r = matchTodoText({}, 'foo')
    expect(r).toEqual({ matched: false, fields: [] })
  })

  it('returns matched=false when nothing matches', () => {
    const r = matchTodoText({ title: 'abc', notes: 'def' }, 'xyz', { personNames: ['nope'], statusName: 'nope', tagNames: ['nope'] })
    expect(r.matched).toBe(false)
    expect(r.fields).toEqual([])
  })

  it('trims the query and treats all-whitespace as empty', () => {
    expect(matchTodoText({ title: 'abc' }, '   ').matched).toBe(true)
    expect(matchTodoText({ title: 'abc' }, '   ').fields).toEqual([])
  })
})

describe('toggleItem (regression cover)', () => {
  it('toggles in and out of null → partial → full', () => {
    const all = [1, 2, 3]
    const afterFirst = toggleItem<number>(null, 2, all)
    expect(afterFirst).toEqual(new Set([1, 3]))
    const afterSecond = toggleItem<number>(afterFirst, 2, all)
    expect(afterSecond).toBe(null)
  })
})

describe('groupTodosByTextMatch', () => {
  type T = { id: number; title: string; notes?: string; isCompleted: boolean; tag?: string }
  const ctxFor = (t: T) => ({ tagNames: t.tag ? [t.tag] : [] })
  const ids = (xs: T[]) => xs.map((x) => x.id)

  it('puts completed todos after incomplete ones within each group, keeping relative order', () => {
    const todos: T[] = [
      { id: 1, title: 'milk A', isCompleted: true },
      { id: 2, title: 'milk B', isCompleted: false },
      { id: 3, title: 'milk C', isCompleted: true },
      { id: 4, title: 'milk D', isCompleted: false },
      { id: 5, title: 'milk E', isCompleted: false },
    ]
    const g = groupTodosByTextMatch(todos, 'milk', ctxFor)
    expect(ids(g.title)).toEqual([2, 4, 5, 1, 3])
  })

  it('orders each group independently', () => {
    const todos: T[] = [
      { id: 1, title: 'x', notes: 'egg', isCompleted: true, tag: 'eggs' },
      { id: 2, title: 'egg', isCompleted: true },
      { id: 3, title: 'y', notes: 'egg', isCompleted: false },
      { id: 4, title: 'eggplant', isCompleted: false, tag: 'egg-tag' },
    ]
    const g = groupTodosByTextMatch(todos, 'egg', ctxFor)
    expect(ids(g.title)).toEqual([4, 2])
    expect(ids(g.notes)).toEqual([3, 1])
    expect(ids(g.tag)).toEqual([4, 1])
    expect(g.person).toEqual([])
  })

  it('preserves input order when nothing is completed', () => {
    const todos: T[] = [
      { id: 3, title: 'abc', isCompleted: false },
      { id: 1, title: 'abd', isCompleted: false },
      { id: 2, title: 'zzz', isCompleted: false },
    ]
    expect(ids(groupTodosByTextMatch(todos, 'ab', ctxFor).title)).toEqual([3, 1])
  })

  it('returns all-empty groups for an empty query', () => {
    const g = groupTodosByTextMatch([{ id: 1, title: 'a', isCompleted: false }], '', ctxFor)
    expect(Object.keys(g)).toEqual(['title', 'notes', 'statusUpdate', 'subtask', 'person', 'status', 'tag'])
    expect(Object.values(g).every((arr) => arr.length === 0)).toBe(true)
  })
})

describe('subtasks in the text search (cr28)', () => {
  const sub = (id: number, todoId: number, title: string) => ({ id, todoId, title, isCompleted: false, sortOrder: id, createdAt: new Date(2026, 9, 5) })
  const subtasksByTodo = new Map([[1, [sub(1, 1, 'Get travel actuals from Marco'), sub(2, 1, 'Review with Ben')]]])

  it('matches a subtask title via ctx, as its own field after status updates; never without the ctx', () => {
    const todo = { title: 'Q4 budget', notes: 'travel policy' }
    expect(matchTodoText(todo, 'marco', { subtaskTitles: ['Get travel actuals from Marco'] }).fields).toEqual(['subtask'])
    expect(matchTodoText(todo, 'travel', { subtaskTitles: ['Get travel actuals from Marco'], statusUpdateTexts: ['travel booked'] }).fields)
      .toEqual(['notes', 'statusUpdate', 'subtask'])
    expect(matchTodoText(todo, 'marco').matched).toBe(false)
  })

  it('textMatchContextFor reads the task’s subtask titles from the lookups', () => {
    expect(textMatchContextFor({ id: 1 }, { subtasksByTodo }).subtaskTitles).toEqual(['Get travel actuals from Marco', 'Review with Ben'])
    expect(textMatchContextFor({ id: 2 }, { subtasksByTodo }).subtaskTitles).toEqual([])
    expect(textMatchContextFor({ id: 1 }, {}).subtaskTitles).toEqual([])
  })

  it('groups the task (never the subtask) under subtask; a search clause keeps the task', () => {
    const todos = [makeTodo({ id: 1, title: 'Q4 budget' }), makeTodo({ id: 2, title: 'Travel budget review' })]
    const groups = groupTodosByTextMatch(todos, 'travel', (t) => textMatchContextFor(t, { subtasksByTodo }))
    expect(groups.subtask.map((t) => t.id)).toEqual([1])
    expect(groups.title.map((t) => t.id)).toEqual([2])
    const settings = { urgentRange: null, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 as const }
    const filters = { ...emptyFilterCriteria, searchText: 'marco' }
    const today = new Date(2026, 9, 6)
    expect(matchesFilterWithLookups(filters, makeTodo({ id: 1, title: 'Q4 budget' }), { subtasksByTodo }, today, settings)).toBe(true)
    expect(matchesFilterWithLookups(filters, makeTodo({ id: 1, title: 'Q4 budget' }), {}, today, settings)).toBe(false)
  })
})

describe('status updates in the text search', () => {
  const entry = (todoId: number, text: string) => ({ id: todoId * 10, todoId, date: new Date(2026, 9, 5), text, createdAt: new Date(2026, 9, 5, 9) })
  const statusUpdatesByTodo = new Map([[1, [entry(1, 'Pinged on Slack'), entry(1, 'Asked Ben')]]])

  it('textMatchContextFor reads the task’s entry texts from the lookups', () => {
    expect(textMatchContextFor({ id: 1 }, { statusUpdatesByTodo }).statusUpdateTexts).toEqual(['Pinged on Slack', 'Asked Ben'])
    expect(textMatchContextFor({ id: 2 }, { statusUpdatesByTodo }).statusUpdateTexts).toEqual([])
    expect(textMatchContextFor({ id: 1 }, {}).statusUpdateTexts).toEqual([])
  })

  it('groups a task whose entry matches under statusUpdate', () => {
    const todos = [makeTodo({ id: 1, title: 'Q4 budget' }), makeTodo({ id: 2, title: 'Slack cleanup' })]
    const groups = groupTodosByTextMatch(todos, 'slack', (t) => textMatchContextFor(t, { statusUpdatesByTodo }))
    expect(groups.statusUpdate.map((t) => t.id)).toEqual([1])
    expect(groups.title.map((t) => t.id)).toEqual([2])
  })

  it('a search clause (a list’s, the screen filter’s) keeps a task whose entry matches', () => {
    const settings = { urgentRange: null, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 as const }
    const filters = { ...emptyFilterCriteria, searchText: 'ben' }
    const today = new Date(2026, 9, 6)
    expect(matchesFilterWithLookups(filters, makeTodo({ id: 1, title: 'Q4 budget' }), { statusUpdatesByTodo }, today, settings)).toBe(true)
    expect(matchesFilterWithLookups(filters, makeTodo({ id: 1, title: 'Q4 budget' }), {}, today, settings)).toBe(false)
    expect(matchesFilterWithLookups(filters, makeTodo({ id: 2, title: 'Other' }), { statusUpdatesByTodo }, today, settings)).toBe(false)
  })
})
