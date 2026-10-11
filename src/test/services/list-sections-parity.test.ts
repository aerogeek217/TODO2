import { describe, it, expect } from 'vitest'
import type {
  PersistedTodoItem, Person, Project, Status, Tag, TodoPredicate,
} from '../../models'
import { LIST_SORT_VALUES, TODO_GROUP_BY_VALUES, TODO_SORT_BY_VALUES } from '../../models'
import type { PersistedListDefinition, RuntimeFilterSpec } from '../../models/list-definition'
import {
  applyFilter,
  createPredicateEvaluator,
  criteriaToPredicate,
  predicateToCriteria,
} from '../../stores/filter-store'
import { emptyPredicate } from '../../stores/list-definition-store'
import { applyRuntimeFilter, buildDashboardLists } from '../../services/dashboard-lists'
import { buildListSections, type ListSectionsContext, type Section } from '../../services/list-sections'
import { makeTodo } from '../helpers'

// The list page and list widgets must show the same sections for the same
// list definition. Each path below mirrors its surface: the list page loads a
// definition into the screen filter (ListView), widgets run it through
// `buildDashboardLists` with the evaluator `ListDefinitionBody` uses.

// Wed 14 Oct 2026; a Monday-first week ends Sun 18 Oct.
const today = new Date(2026, 9, 14)
const day = (m: number, d: number) => new Date(2026, m - 1, d)

const alice: Person = { id: 1, name: 'Alice', initials: 'A', color: '#c33' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const acme: Person = { id: 3, name: 'Org: Acme', initials: 'AC', color: '#f28c4e' }
const people = [alice, bob, acme]

const statuses: Status[] = [
  { id: 1, name: 'Doing', color: '#0a0', sortOrder: 1 },
  { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 0 },
]

const project = (id: number, name: string, sortOrder: number): Project => ({
  id, name, sortOrder, canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, createdAt: new Date(2026, 0, 1),
})
const projects = [project(1, 'Alpha', 1), project(2, 'Beta', 0)]

const work: Tag = { id: 1, name: 'work', color: '#36c' }
const home: Tag = { id: 2, name: 'home' }

const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Pay invoice', sortOrder: 9, dueDate: day(10, 10), statusId: 1, projectId: 1 }),
  makeTodo({ id: 2, title: 'call plumber', sortOrder: 3, dueDate: day(10, 14), nextFollowupAt: day(10, 20) }),
  makeTodo({ id: 3, title: 'Draft memo', sortOrder: 5, dueDate: day(10, 15), statusId: 2, projectId: 2 }),
  makeTodo({ id: 4, title: 'book flights', sortOrder: 1, dueDate: day(10, 18), nextFollowupAt: day(10, 13), projectId: 1 }),
  makeTodo({ id: 5, title: 'Archive old files', sortOrder: 7, dueDate: day(10, 19), statusId: 1 }),
  makeTodo({ id: 6, title: 'Plan offsite', sortOrder: 2, dueDate: day(12, 1), nextFollowupAt: day(10, 14), statusId: 2 }),
  makeTodo({ id: 7, title: 'Read book', sortOrder: 8, nextFollowupAt: day(11, 30) }),
  makeTodo({ id: 8, title: 'Done thing', sortOrder: 4, isCompleted: true, dueDate: day(10, 12), projectId: 2 }),
  makeTodo({ id: 9, title: 'Water plants', sortOrder: 6, notes: 'ask alice first' }),
  makeTodo({ id: 10, title: 'pay rent', sortOrder: 10, dueDate: day(10, 14), statusId: 1, projectId: 2 }),
]

const assignedPeopleMap = new Map<number, Person[]>([
  [1, [alice]], [2, [bob, alice]], [3, [acme]], [5, [bob]], [6, [alice, acme]], [8, [alice]], [10, [bob]],
])
const assignedTagsMap = new Map<number, Tag[]>([
  [1, [work]], [3, [work, home]], [4, [home]], [6, [work]], [9, [home]], [10, [home]],
])

const ctx: ListSectionsContext = {
  today, weekStartsOn: 1, people, statuses, projects, assignedPeopleMap, assignedTagsMap,
}

function def(over: Partial<PersistedListDefinition>): PersistedListDefinition {
  return {
    id: 1, name: 'List', sortOrder: 0, pinnedToDashboard: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual', grouping: 'none',
    ...over,
  }
}

function widgetSections(d: PersistedListDefinition, pick: number[] | undefined): Section[] {
  const evalPredicate = createPredicateEvaluator({
    assignedPeopleMap,
    assignedTagsMap,
    statusesById: new Map(statuses.map((s) => [s.id!, s])),
    projectsById: new Map(projects.map((p) => [p.id!, p])),
  }, today)
  const [list] = buildDashboardLists([d], todos, {
    ...ctx,
    people: [...people],
    statuses: [...statuses],
    projects: [...projects],
    evalPredicate,
    runtimeFilterValues: d.runtimeFilter && pick ? new Map([[d.id, pick]]) : undefined,
  })
  return list!.sections
}

function listPageSections(d: PersistedListDefinition, pick: number[] | undefined): Section[] {
  // Loading a definition: its predicate becomes the screen filter, its sort
  // is kept when the page offers it (otherwise manual).
  const manualFilters = predicateToCriteria(d.membership.predicate)
  const sortBy = LIST_SORT_VALUES.includes(d.sort) ? d.sort : 'manual'
  const spec = d.runtimeFilter ?? null
  const effective = !spec || pick == null || pick.length === 0
    ? manualFilters
    : predicateToCriteria(applyRuntimeFilter(criteriaToPredicate(manualFilters), spec, pick))
  const members = spec && pick == null
    ? []
    : applyFilter(effective, todos, assignedPeopleMap, statuses, today, new Map(projects.map((p) => [p.id!, p])), assignedTagsMap)
  return buildListSections(members, {
    groupBy: d.grouping,
    sortBy,
    restrictToPersonIds: effective.personIds ? [...effective.personIds] : null,
    restrictToTagIds: effective.tags ? [...effective.tags] : null,
  }, ctx)
}

const shape = (sections: Section[]) =>
  sections.map((s) => ({ key: s.key, label: s.label, accentColor: s.accentColor, ids: s.todos.map((t) => t.id) }))

const predicates: Array<[string, TodoPredicate]> = [
  ['no filter', emptyPredicate()],
  ['completed shown', { ...emptyPredicate(), showCompleted: true }],
  ['person filter incl. unassigned', { ...emptyPredicate(), personIds: [1, 0] }],
  ['tag filter', { ...emptyPredicate(), tags: [2, 1] }],
  ['search by person name', { ...emptyPredicate(), searchText: 'alice' }],
  ['search by tag name', { ...emptyPredicate(), searchText: 'work' }],
  ['search by status name', { ...emptyPredicate(), searchText: 'waiting' }],
  ['search by project name', { ...emptyPredicate(), searchText: 'beta' }],
]

const runtimeCases: Array<[string, RuntimeFilterSpec | undefined, number[] | undefined]> = [
  ['no prompt', undefined, undefined],
  ['person prompt, one pick', { field: 'person' }, [2]],
  ['person prompt, picks incl. unassigned', { field: 'person' }, [3, 0]],
  ['tag prompt', { field: 'tag' }, [2]],
  ['status prompt', { field: 'status' }, [1]],
  ['project prompt', { field: 'project' }, [2]],
  ['prompt cleared', { field: 'person' }, []],
  ['prompt unanswered', { field: 'tag' }, undefined],
]

describe('list page and list widgets build the same sections', () => {
  for (const groupBy of TODO_GROUP_BY_VALUES) {
    for (const sortBy of TODO_SORT_BY_VALUES) {
      it(`group ${groupBy} × sort ${sortBy}`, () => {
        for (const [runtimeName, runtimeFilter, pick] of runtimeCases) {
          for (const [predicateName, predicate] of predicates) {
            const d = def({ grouping: groupBy, sort: sortBy, runtimeFilter, membership: { kind: 'custom', predicate } })
            expect(shape(widgetSections(d, pick)), `${runtimeName}, ${predicateName}`)
              .toEqual(shape(listPageSections(d, pick)))
          }
        }
      })
    }
  }

  it('the matrix is not vacuous: sections carry tasks for every axis', () => {
    for (const groupBy of TODO_GROUP_BY_VALUES) {
      const sections = widgetSections(def({ grouping: groupBy }), undefined)
      expect(sections.flatMap((s) => s.todos).length).toBeGreaterThan(0)
    }
  })

  it('widget search hits person, status, tag and project names', () => {
    const ids = (searchText: string) => widgetSections(
      def({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText } } }),
      undefined,
    ).flatMap((s) => s.todos.map((t) => t.id))
    expect(ids('alice')).toEqual([6, 2, 9, 1]) // assignees + a note mentioning her (manual order)
    expect(ids('acme')).toEqual([6, 3])
    expect(ids('waiting')).toEqual([6, 3])
    expect(ids('home')).toEqual([4, 3, 9, 10])
    expect(ids('alpha')).toEqual([4, 1])
  })
})

describe('due-date grouping regressions', () => {
  const grouped = def({ grouping: 'deadline', sort: 'deadline' })

  it('overdue and today tasks keep their own sections (never folded into a later one)', () => {
    const sections = widgetSections(grouped, undefined)
    expect(sections.map((s) => [s.label, s.todos.map((t) => t.id)])).toEqual([
      ['Overdue', [1]],
      ['Today', [2, 10]],
      ['This Week', [3, 4]],
      ['Later', [5, 6]],
      ['No Due Date', [9, 7]],
    ])
  })

  it('undated tasks land in No Due Date, not Later', () => {
    const later = widgetSections(grouped, undefined).find((s) => s.key === 'later')!
    expect(later.todos.every((t) => t.dueDate != null)).toBe(true)
  })

  it('name sort is alphabetical within each section', () => {
    const sections = widgetSections(def({ grouping: 'deadline', sort: 'name' }), undefined)
    expect(sections.find((s) => s.key === 'today')!.todos.map((t) => t.title)).toEqual(['call plumber', 'pay rent'])
    expect(sections.find((s) => s.key === 'week')!.todos.map((t) => t.title)).toEqual(['book flights', 'Draft memo'])
  })
})
