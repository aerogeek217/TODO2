import { describe, it, expect } from 'vitest'
import type { DateMatch, PersistedTodoItem, Person, Tag } from '../../models'
import {
  personTaskDialog,
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
import { emptyFilterCriteria } from '../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, BEN, PEOPLE, PLANNING, PRIYA, Q4, SAMPLE_OPEN_COUNT, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../fixtures/glance-sample'
import { useFilterStore } from '../../stores/filter-store'
import { countTabBadges } from '../../utils/tab-badges'

function env(over: Partial<TaskDialogEnv> = {}): TaskDialogEnv {
  return {
    todos: SAMPLE_TASKS,
    today: SAMPLE_TODAY,
    weekStartsOn: 0,
    markerSettings: { urgentRange: 3 },
    assignedPeopleMap: ASSIGNED_PEOPLE,
    assignedTagsMap: ASSIGNED_TAGS,
    people: PEOPLE,
    statuses: STATUSES,
    statusUpdatesByTodo: new Map(),
    subtasksByTodo: new Map(),
    screen: { ...emptyFilterCriteria },
    newListView: { sort: 'manual', sortDirection: 'asc', grouping: 'none' },
    ...over,
  }
}

const byId = new Map(SAMPLE_TASKS.map((t) => [t.id, t]))

/** The counter's badge without badge ranges: nothing counted. */
const NO_BADGES = { due: 0, dueOverdue: 0, followup: 0, followupOverdue: 0 }
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
    // Every one of Priya's open tasks once, each group latest due first (undated last).
    expect(groups.flatMap((g) => g.todoIds).sort()).toEqual([...(resolveTaskDialog(SCREEN, env({ screen: priya }))[0]?.todoIds ?? [])].sort())
    for (const g of groups) {
      const due = g.todoIds.map((id) => byId.get(id)?.dueDate?.getTime() ?? -Infinity)
      expect(due).toEqual([...due].sort((a, b) => b - a))
    }
  })

  it('grouped by People or Tag, the screen filter’s "is" picks narrow the groups, as a list’s own filter does', () => {
    const person = (id: number): Person => PEOPLE.find((p) => p.id === id)!
    const tag = (id: number): Tag => TAGS.find((t) => t.id === id)!
    // Q4 roadmap deck (14) is Priya's and Ben's, and tagged #q4 and #planning.
    const assignedPeopleMap = new Map(ASSIGNED_PEOPLE).set(14, [person(PRIYA), person(BEN)])
    const assignedTagsMap = new Map(ASSIGNED_TAGS).set(14, [tag(Q4), tag(PLANNING)])
    const base = { assignedPeopleMap, assignedTagsMap }
    const byPeople = { sort: 'manual', sortDirection: 'asc', grouping: 'people' } as const
    const labelled = (groups: ReturnType<typeof resolveTaskDialog>) => groups.map((g) => [g.label, titles(g.todoIds)])
    const priyaTasks = ['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast']
    const groups = resolveTaskDialog(SCREEN, env({ ...base, screen: priya, newListView: byPeople }))
    expect(labelled(groups)).toEqual([['Priya Nair', priyaTasks]])
    // Counts stay unique tasks.
    expect(taskDialogCount(groups)).toBe(screenTaskCount(env({ ...base, screen: priya })))
    // Without a People pick, the task shows under both of its people.
    const unpicked = resolveTaskDialog(SCREEN, env({ ...base, newListView: byPeople }))
    expect(unpicked.filter((g) => g.todoIds.includes(14)).map((g) => g.label)).toEqual(['Ben Ortiz', 'Priya Nair'])
    // Tags likewise, the No tags pick keeping only its trailing group.
    const byTag = { ...byPeople, grouping: 'tag' } as const
    const q4 = { ...emptyFilterCriteria, tags: new Set([Q4]) }
    expect(resolveTaskDialog(SCREEN, env({ ...base, screen: q4, newListView: byTag })).map((g) => g.label)).toEqual(['#q4'])
    const untagged = { ...emptyFilterCriteria, tags: new Set([0]) }
    expect(resolveTaskDialog(SCREEN, env({ ...base, screen: untagged, newListView: byTag })).map((g) => g.label)).toEqual(['No Tag'])
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

  it('the counter’s numbers: shown (the chips) and the open total', () => {
    const priyaOpen = 4
    expect(screenTaskCounts(env())).toEqual({ shown: SAMPLE_OPEN_COUNT, total: SAMPLE_OPEN_COUNT, withCompleted: false, badges: NO_BADGES })
    expect(screenTaskCounts(env({ screen: priya })))
      .toEqual({ shown: priyaOpen, total: SAMPLE_OPEN_COUNT, withCompleted: false, badges: NO_BADGES })
    // Another chip: shown narrows further; the total stays.
    const hot = { ...priya, markers: [{ values: ['focus' as const] }] }
    const counts = screenTaskCounts(env({ screen: hot }))
    expect(counts.total).toBe(SAMPLE_OPEN_COUNT)
    expect(counts.shown).toBe(screenTaskCount(env({ screen: hot })))
    expect(counts.shown).toBeLessThanOrEqual(priyaOpen)
    // Under Show completed the total counts completed tasks too.
    expect(screenTaskCounts(env({ screen: { ...emptyFilterCriteria, showCompleted: true } })).total).toBe(SAMPLE_TASKS.length)
  })

  it('the counter’s badge: the open tasks it shows due / due for a follow-up in the tab badge ranges', () => {
    const ranges = { due: 7, followup: 7 } as const
    const all = screenTaskCounts(env(), ranges).badges
    // Every open task shown: the badge a list of every task would carry.
    expect(all).toEqual(countTabBadges(SAMPLE_TASKS, ranges, SAMPLE_TODAY))
    expect(all.due + all.followup).toBeGreaterThan(0)
    // The chips narrow it with what they show.
    const priya = { ...emptyFilterCriteria, personIds: new Set([PRIYA]) }
    const shown = SAMPLE_TASKS.filter((t) => ASSIGNED_PEOPLE.get(t.id)?.some((p) => p.id === PRIYA))
    expect(screenTaskCounts(env({ screen: priya }), ranges).badges).toEqual(countTabBadges(shown, ranges, SAMPLE_TODAY))
    // Completed tasks never count, even while shown.
    expect(screenTaskCounts(env({ screen: { ...emptyFilterCriteria, showCompleted: true } }), ranges).badges).toEqual(all)
    // Off, or no ranges: nothing.
    expect(screenTaskCounts(env(), { due: 'off', followup: 'off' }).badges).toEqual(NO_BADGES)
    expect(screenTaskCounts(env()).badges).toEqual(NO_BADGES)
  })

  it('a Completed range among the chips counts completed tasks too, and lists the ones it keeps', () => {
    const ever: DateMatch = { match: 'range', start: { kind: 'offset', days: -3650 }, end: { kind: 'offset', days: 0 } }
    const doneCount = SAMPLE_TASKS.length - SAMPLE_OPEN_COUNT
    const chips = { ...emptyFilterCriteria, dates: { completed: ever } }
    expect(screenTaskCounts(env({ screen: chips }))).toEqual({ shown: doneCount, total: SAMPLE_TASKS.length, withCompleted: true, badges: NO_BADGES })
    expect(screenTaskCount(env({ screen: chips }))).toBe(taskDialogCount(resolveTaskDialog(SCREEN, env({ screen: chips }))))
    expect(screenTaskDialogDescription(chips)).toBe('Tasks matching the screen filter, completed ones included. A change here applies to every widget.')
  })

  describe('the total under a Completed range: open tasks and the completed ones the filter admits', () => {
    // Done this week: Sun 4 Oct … today (Sat 10 Oct).
    const thisWeek: DateMatch = { match: 'range', start: { kind: 'offset', days: -6 }, end: { kind: 'offset', days: 0 } }
    const weekStart = new Date(2026, 9, 4)
    const doneThisWeek = SAMPLE_TASKS.filter((t) => t.isCompleted && t.completedAt != null && t.completedAt >= weekStart)

    it('the fixture has completed tasks both inside and outside the week', () => {
      expect(doneThisWeek.length).toBeGreaterThan(0)
      expect(doneThisWeek.length).toBeLessThan(SAMPLE_TASKS.length - SAMPLE_OPEN_COUNT)
    })

    it('chips: the completed tasks in their range, not every completed task', () => {
      const chips = { ...emptyFilterCriteria, dates: { completed: thisWeek } }
      expect(screenTaskCounts(env({ screen: chips }))).toEqual({
        shown: doneThisWeek.length, total: SAMPLE_OPEN_COUNT + doneThisWeek.length, withCompleted: true, badges: NO_BADGES,
      })
      // Another chip narrows what is shown, not the total.
      const priyaToo = { ...chips, personIds: new Set([PRIYA]) }
      expect(screenTaskCounts(env({ screen: priyaToo })).total).toBe(SAMPLE_OPEN_COUNT + doneThisWeek.length)
    })
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

