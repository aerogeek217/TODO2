import { describe, it, expect } from 'vitest'
import { emptyPredicate, type PersistedTodoItem } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import {
  eisenhowerQuadrantDialog,
  eisenhowerSummaryDialog,
  noPaneTaskDialog,
  personTaskDialog,
  recentlyCompletedDialog,
  staleTasksDialog,
  tagSectionDialog,
  tagsSectionDialog,
  resolveTaskDialog,
  screenTaskCount,
  screenTaskCounts,
  screenTaskDialog,
  screenTaskDialogDescription,
  showTasksLabel,
  taskDialogCopySections,
  taskDialogCount,
  type TaskDialogEnv,
} from '../../services/task-dialog'
import type { TaskDialogSource } from '../../stores/task-dialog-payload'
import { buildTasksPlain } from '../../services/task-copy'
import { DEFAULT_HOT_RULE } from '../../utils/hot'
import { emptyFilterCriteria } from '../helpers'
import { defaultPaneFilter, resolvePanes } from '../../utils/eisenhower-panes'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, PRIYA, SAMPLE_LISTS, SAMPLE_OPEN_COUNT, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES,
} from '../fixtures/dashboard-sample'
import { useFilterStore } from '../../stores/filter-store'

function env(over: Partial<TaskDialogEnv> = {}): TaskDialogEnv {
  return {
    todos: SAMPLE_TASKS,
    today: SAMPLE_TODAY,
    weekStartsOn: 0,
    markerSettings: { urgentRange: 3, hotRule: DEFAULT_HOT_RULE },
    assignedPeopleMap: ASSIGNED_PEOPLE,
    assignedTagsMap: ASSIGNED_TAGS,
    people: PEOPLE,
    statuses: STATUSES,
    listDefinitions: SAMPLE_LISTS,
    screen: { ...emptyFilterCriteria },
    listRanks: new Map(),
    newListView: { sort: 'manual', sortDirection: 'asc', grouping: 'none' },
    ...over,
  }
}

const byId = new Map(SAMPLE_TASKS.map((t) => [t.id, t]))
const titles = (ids: readonly number[]) => ids.map((id) => byId.get(id)?.title)

describe('resolveTaskDialog', () => {
  it('todos: one flat group, in the given order', () => {
    expect(resolveTaskDialog({ kind: 'todos', todoIds: [5, 1, 9] }, env())).toEqual([{ key: 'all', label: null, todoIds: [5, 1, 9] }])
  })

  it('groups: headings in order with their colours; empty ones left out', () => {
    const source: TaskDialogSource = {
      kind: 'groups',
      groups: [
        { key: 'due', label: 'Due', color: 'red', todoIds: [1, 2] },
        { key: 'followup', label: 'Follow-up', color: 'gold', todoIds: [] },
        { key: 'x', label: 'Other', todoIds: [2] },
      ],
    }
    expect(resolveTaskDialog(source, env())).toEqual([
      { key: 'due', label: 'Due', color: 'red', todoIds: [1, 2] },
      { key: 'x', label: 'Other', todoIds: [2] },
    ])
  })

  it('predicate: the matching tasks in sortOrder — a person’s open tasks (the person chip)', () => {
    const [group] = resolveTaskDialog(personTaskDialog({ id: PRIYA, name: 'Priya Nair' }).source, env())
    // Priya's open tasks only (her completed "Team lunch booking" is left out), by sortOrder.
    expect(group?.label).toBeNull()
    expect(titles(group?.todoIds ?? [])).toEqual(['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast'])
  })

  it('list: the members with the list’s own sort, flat when ungrouped', () => {
    // "#q4 planning": tag q4, sorted by due date (undated last).
    expect(resolveTaskDialog({ kind: 'list', listDefinitionId: 3 }, env())).toEqual([
      { key: 'all', label: null, todoIds: [7, 14, 15, 4, 17] },
    ])
  })

  it('list: the list’s grouping through the shared section builder, unsaved drafts included', () => {
    const grouped = SAMPLE_LISTS.map((d) => (d.id === 3 ? { ...d, grouping: 'status' as const } : d))
    const groups = resolveTaskDialog({ kind: 'list', listDefinitionId: 3 }, env({ listDefinitions: grouped }))
    expect(groups.map((g) => [g.label, g.todoIds])).toEqual([['To do', [7, 4, 17]], ['In progress', [14, 15]]])
    expect(groups[0]?.color).toBeTruthy()
  })

  it('list: the screen filter narrows it, as on the list tile', () => {
    const screen = { ...emptyFilterCriteria, personIds: new Set([PRIYA]) }
    const [group] = resolveTaskDialog({ kind: 'list', listDefinitionId: 3 }, env({ screen }))
    expect(titles(group?.todoIds ?? [])).toEqual(['Q4 roadmap deck', 'Q4 forecast'])
  })

  it('list: follows the list’s sort direction (latest due first, undated still last)', () => {
    const desc = SAMPLE_LISTS.map((d) => (d.id === 3 ? { ...d, sortDirection: 'desc' as const } : d))
    expect(resolveTaskDialog({ kind: 'list', listDefinitionId: 3 }, env({ listDefinitions: desc }))).toEqual([
      { key: 'all', label: null, todoIds: [15, 14, 7, 4, 17] },
    ])
  })

  it('list: a deleted list has no rows', () => {
    expect(resolveTaskDialog({ kind: 'list', listDefinitionId: 99 }, env())).toEqual([])
  })
})

describe('resolveTaskDialog — the screen filter’s tasks', () => {
  const SCREEN: TaskDialogSource = { kind: 'screen' }
  const priya = { ...emptyFilterCriteria, personIds: new Set([PRIYA]) }

  it('no filter: every open task, flat, in sortOrder (the Manual default without a manual order)', () => {
    const groups = resolveTaskDialog(SCREEN, env())
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBeNull()
    const ids = groups[0]?.todoIds ?? []
    expect(ids).toHaveLength(SAMPLE_OPEN_COUNT)
    const sortOrders = ids.map((id) => byId.get(id)!.sortOrder)
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b))
    expect(ids.every((id) => !byId.get(id)!.isCompleted)).toBe(true)
  })

  it('the screen filter narrows it; its Show completed adds the completed ones', () => {
    const [open] = resolveTaskDialog(SCREEN, env({ screen: priya }))
    expect(titles(open?.todoIds ?? [])).toEqual(['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast'])
    const [all] = resolveTaskDialog(SCREEN, env({ screen: { ...priya, showCompleted: true } }))
    expect(titles(all?.todoIds ?? [])).toContain('Team lunch booking')
    expect(all?.todoIds).toHaveLength(5)
  })

  it('sorted and grouped by Settings’ new-list defaults (direction included), as such a list shows them', () => {
    const view = { sort: 'deadline', sortDirection: 'desc', grouping: 'status' } as const
    const groups = resolveTaskDialog(SCREEN, env({ screen: priya, newListView: view }))
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.every((g) => g.label != null)).toBe(true)
    const everyOpenTask: PersistedListDefinition = {
      id: 50, name: 'All', sortOrder: 0, owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: view.sort, sortDirection: view.sortDirection, grouping: view.grouping,
    }
    expect(groups).toEqual(resolveTaskDialog({ kind: 'list', listDefinitionId: 50 }, env({ screen: priya, listDefinitions: [everyOpenTask] })))
  })

  it('screenTaskCount: how many rows the dialog lists', () => {
    for (const screen of [emptyFilterCriteria, priya, { ...priya, showCompleted: true }, { ...emptyFilterCriteria, showCompleted: true }]) {
      expect(screenTaskCount(env({ screen }))).toBe(taskDialogCount(resolveTaskDialog(SCREEN, env({ screen }))))
    }
    expect(screenTaskCount(env())).toBe(SAMPLE_OPEN_COUNT)
  })

  it('its payload, the description for the filter as it is, the button’s label', () => {
    useFilterStore.getState().setPersonIds(new Set([PRIYA]))
    expect(screenTaskDialog()).toEqual({
      title: 'Filtered tasks',
      glyph: 'filter',
      description: 'Open tasks matching the screen filter. A change here applies to every widget.',
      source: { kind: 'screen' },
    })
    expect(screenTaskDialogDescription({ ...priya, showCompleted: true }))
      .toBe('Tasks matching the screen filter, completed ones included. A change here applies to every widget.')
    expect(screenTaskDialogDescription(emptyFilterCriteria))
      .toBe('Every open task: no screen filter is on. A filter set here applies to every widget.')
    expect(showTasksLabel(1)).toBe('Show 1 task')
    expect(showTasksLabel(12)).toBe('Show 12 tasks')
  })

  it('the counter’s numbers: shown (chips and lens), the open total, what the lens alone keeps', () => {
    const lens = { ...emptyFilterCriteria, personIds: new Set([PRIYA]) }
    const priyaOpen = 4
    expect(screenTaskCounts(env())).toEqual({ shown: SAMPLE_OPEN_COUNT, total: SAMPLE_OPEN_COUNT, lensKeeps: SAMPLE_OPEN_COUNT })
    expect(screenTaskCounts(env({ screen: { ...emptyFilterCriteria, lens } })))
      .toEqual({ shown: priyaOpen, total: SAMPLE_OPEN_COUNT, lensKeeps: priyaOpen })
    // Chips on top: shown narrows further; the lens's own count stays.
    const hot = { ...emptyFilterCriteria, markers: 'hot' as const, lens }
    const counts = screenTaskCounts(env({ screen: hot }))
    expect(counts.lensKeeps).toBe(priyaOpen)
    expect(counts.shown).toBe(screenTaskCount(env({ screen: hot })))
    expect(counts.shown).toBeLessThanOrEqual(priyaOpen)
    // Under Show completed the total counts completed tasks too.
    expect(screenTaskCounts(env({ screen: { ...emptyFilterCriteria, showCompleted: true } })).total).toBe(SAMPLE_TASKS.length)
  })

  it('the description names the lens and what it hides; with chips too, the filter under it', () => {
    const counts = { shown: 61, total: 109, lensKeeps: 61 }
    expect(screenTaskDialogDescription(emptyFilterCriteria, { name: 'This month', counts }))
      .toBe('61 of 109 open tasks shown: the lens “This month” hides 48. A filter set here applies to every widget; the lens is the layout’s.')
    expect(screenTaskDialogDescription(priya, { name: 'This month', counts: { ...counts, shown: 6 } }))
      .toBe('6 of 109 open tasks match the filter under the lens “This month”. A change here applies to every widget.')
  })
})

describe('taskDialogCount / taskDialogCopySections', () => {
  it('counts a task under two headings once', () => {
    expect(taskDialogCount([
      { key: 'due', label: 'Due', todoIds: [1, 2] },
      { key: 'followup', label: 'Follow-up', todoIds: [2, 9] },
    ])).toBe(3)
    expect(taskDialogCount([])).toBe(0)
  })

  it('copies the rows as shown: headings, completed ones checked, deleted ones left out', () => {
    const done: PersistedTodoItem = { ...byId.get(2)!, isCompleted: true }
    const todoById = new Map(byId)
    todoById.set(2, done)
    todoById.delete(9)
    const sections = taskDialogCopySections([
      { key: 'due', label: 'Due', todoIds: [1, 2] },
      { key: 'followup', label: 'Follow-up', todoIds: [9] },
    ], todoById)
    expect(sections.map((s) => [s.label, s.todos.map((t) => t.id)])).toEqual([['Due', [1, 2]], ['Follow-up', []]])
    const plain = buildTasksPlain(sections, { assignedPeopleMap: new Map(), statusMap: new Map(STATUSES.map((s) => [s.id, s])), today: SAMPLE_TODAY })
    expect(plain.split('\n')).toEqual([
      '== Due ==',
      expect.stringMatching(/^\[ \] Fix checkout outage \[In progress\]/),
      expect.stringMatching(/^\[x\] Headcount request \[In progress\]/),
    ])
  })

  it('a flat list copies without a heading', () => {
    const sections = taskDialogCopySections([{ key: 'all', label: null, todoIds: [17] }], byId)
    expect(sections).toEqual([{ todos: [byId.get(17)] }])
  })
})

describe('dashboard section payloads', () => {
  it('a tag row: that tag’s open tasks; the untagged row; the Tags count: a heading per tag', () => {
    expect(tagSectionDialog({ id: 4, name: 'q4' }, [3, 1])).toEqual({
      title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [3, 1] },
    })
    expect(tagSectionDialog(null, [7])).toEqual({
      title: 'No tag', glyph: 'tag', description: 'Open tasks with no tag.', source: { kind: 'todos', todoIds: [7] },
    })
    expect(tagsSectionDialog([
      { tag: { id: 4, name: 'q4', color: '#123' }, todoIds: [3, 1] },
      { tag: null, todoIds: [7] },
    ])).toEqual({
      title: 'Tagged tasks',
      glyph: 'tag',
      description: 'Open tasks by tag. A task with several tags shows under each.',
      source: {
        kind: 'groups',
        groups: [
          { key: 'tag-4', label: '#q4', color: '#123', todoIds: [3, 1] },
          { key: 'untagged', label: 'No tag', todoIds: [7] },
        ],
      },
    })
  })

  it('Stale tasks and Recently completed say their window', () => {
    expect(staleTasksDialog([5, 2], 14)).toEqual({
      title: 'Stale tasks', glyph: 'stale', description: 'Open tasks not changed in 14 days or more, oldest first.', source: { kind: 'todos', todoIds: [5, 2] },
    })
    expect(recentlyCompletedDialog([9], 7)).toEqual({
      title: 'Recently completed', glyph: 'done', description: 'Tasks completed in the last 7 days, newest first.', source: { kind: 'todos', todoIds: [9] },
    })
  })

  it('an Eisenhower quadrant, and every quadrant under headings, saying what Urgent includes', () => {
    const [doPane, schedule, , drop] = resolvePanes({})
    const all = (urgentRange: number | null) => ({ urgentRange, listName: null })
    expect(eisenhowerQuadrantDialog(schedule!, 'Important, not urgent', [4], all(3))).toEqual({
      title: 'Schedule',
      glyph: 'matrix',
      description: 'Open tasks that are important, not urgent. Urgent includes tasks due within 3 days.',
      source: { kind: 'todos', todoIds: [4] },
    })
    expect(eisenhowerQuadrantDialog(doPane!, '', [1], all(null)).description).toBe('Open tasks that are urgent and important.')
    expect(eisenhowerQuadrantDialog(drop!, '', [1], all(0)).description).toBe('Open tasks that are neither urgent nor important. Urgent includes tasks due today or earlier.')
    const summary = eisenhowerSummaryDialog(resolvePanes({}), { do: [1], schedule: [], delegate: [5], drop: [6] }, all(7))
    expect(summary).toMatchObject({ title: 'Eisenhower', glyph: 'matrix', description: 'Open tasks by urgent × important. Urgent includes tasks due within 1 week.' })
    expect(summary.source).toEqual({
      kind: 'groups',
      groups: [
        { key: 'do', label: 'Do', color: 'var(--color-danger)', todoIds: [1] },
        { key: 'schedule', label: 'Schedule', color: 'var(--color-followup)', todoIds: [] },
        { key: 'delegate', label: 'Delegate', color: 'var(--color-text-secondary)', todoIds: [5] },
        { key: 'drop', label: 'Drop', color: 'var(--color-text-muted)', todoIds: [6] },
      ],
    })
  })

  it('custom panes and a list source: the pane names, the filter in words, the list named', () => {
    const panes = resolvePanes({ delegate: { name: 'Hand off', filter: { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } } } })
    const source = { urgentRange: 3, listName: 'Team' }
    const delegate = panes[2]!
    expect(eisenhowerQuadrantDialog(delegate, 'Urgent · not Important · not Waiting', [5], source)).toEqual({
      title: 'Hand off',
      glyph: 'matrix',
      description: 'Open tasks of “Team” in “Hand off” (Urgent · not Important · not Waiting) — the first pane each matches.',
      source: { kind: 'todos', todoIds: [5] },
    })
    expect(eisenhowerQuadrantDialog(panes[0]!, '', [1], source).description)
      .toBe('Open tasks of “Team” that are urgent and important. Urgent includes tasks due within 3 days.')
    const summary = eisenhowerSummaryDialog(panes, { do: [1], schedule: [], delegate: [5], drop: [] }, source)
    expect(summary.description).toBe('Open tasks of “Team” by pane, each in the first pane it matches. Urgent includes tasks due within 3 days.')
    expect(summary.source).toMatchObject({ kind: 'groups', groups: [{ label: 'Do' }, { label: 'Schedule' }, { label: 'Hand off', todoIds: [5] }, { label: 'Drop' }] })
  })
})

describe('noPaneTaskDialog', () => {
  it('lists an Eisenhower tab’s open tasks in no pane, in the order given', () => {
    expect(noPaneTaskDialog([4, 2])).toEqual({
      title: 'In no pane',
      glyph: 'matrix',
      description: 'Open tasks the Eisenhower considers that match none of its panes’ filters.',
      source: { kind: 'todos', todoIds: [4, 2] },
    })
  })
})
