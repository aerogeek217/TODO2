import { describe, it, expect } from 'vitest'
import { matchTodoText, toggleItem } from '../../utils/filter'

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
      projectName: 'foo project',
      personNames: ['Foo Person'],
      orgNames: ['OtherOrg'],
      statusName: 'InProgress',
    })
    expect(r.matched).toBe(true)
    expect(r.fields).toEqual(['title', 'notes', 'project', 'person'])
  })

  it('matches on project / person / org / status via ctx', () => {
    const todo = { title: 't', notes: 'n' }
    expect(matchTodoText(todo, 'projx', { projectName: 'ProjX' }).fields).toEqual(['project'])
    expect(matchTodoText(todo, 'alice', { personNames: ['Alice', 'Bob'] }).fields).toEqual(['person'])
    expect(matchTodoText(todo, 'acme', { orgNames: ['Acme Corp'] }).fields).toEqual(['org'])
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
    const r = matchTodoText({ title: 'abc', notes: 'def' }, 'xyz', { projectName: 'nope' })
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
