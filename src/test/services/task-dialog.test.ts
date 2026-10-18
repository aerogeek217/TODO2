import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import {
  personTaskDialog,
  resolveTaskDialog,
  taskDialogCopySections,
  taskDialogCount,
  type TaskDialogEnv,
} from '../../services/task-dialog'
import type { TaskDialogSource } from '../../stores/task-dialog-payload'
import { buildTasksPlain } from '../../services/task-copy'
import { DEFAULT_HOT_RULE } from '../../utils/hot'
import { emptyFilterCriteria } from '../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, PRIYA, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES,
} from '../fixtures/dashboard-sample'

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
