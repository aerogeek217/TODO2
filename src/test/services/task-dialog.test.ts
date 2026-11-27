import { describe, it, expect } from 'vitest'
import type { DateMatch, PersistedTodoItem, Person, Tag } from '../../models'
import {
  currentTaskDialogEnv,
  personTaskDialog,
  popupListView,
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
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { countTabBadges } from '../../utils/tab-badges'

function env(over: Partial<TaskDialogEnv> = {}): TaskDialogEnv {
  return {
    todos: SAMPLE_TASKS,
    today: SAMPLE_TODAY,
    weekStartsOn: 0,
    markerSettings: { urgentRange: 3, staleAfterDays: 30 },
    assignedPeopleMap: ASSIGNED_PEOPLE,
    assignedTagsMap: ASSIGNED_TAGS,
    people: PEOPLE,
    statuses: STATUSES,
    statusUpdatesByTodo: new Map(),
    subtasksByTodo: new Map(),
    screen: { ...emptyFilterCriteria },
    view: { sort: 'manual', sortDirection: 'asc', grouping: 'none' },
    groupingPicked: false,
    ...over,
  }
}

const byId = new Map(SAMPLE_TASKS.map((t) => [t.id, t]))

/** The counter's badge without badge ranges: nothing counted. */
const NO_BADGES = { due: 0, dueOverdue: 0, followup: 0, followupOverdue: 0 }
const titles = (ids: readonly number[]) => ids.map((id) => byId.get(id)?.title)

describe('resolveTaskDialog', () => {
  it('todos: one flat group; a Manual sort is the tasks’ sortOrder; a deleted one left out', () => {
    expect(resolveTaskDialog({ kind: 'todos', todoIds: [5, 1, 9, 999] }, env())).toEqual([{ key: 'all', label: null, todoIds: [1, 5, 9] }])
  })

  it('todos: sorted and grouped by the view, completed ones kept (what was counted)', () => {
    const ids = SAMPLE_TASKS.map((t) => t.id)
    const view = { sort: 'deadline', sortDirection: 'desc', grouping: 'priority' } as const
    const groups = resolveTaskDialog({ kind: 'todos', todoIds: ids }, env({ view }))
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.every((g) => g.label != null)).toBe(true)
    // Every task is under a heading, completed ones too.
    expect(new Set(groups.flatMap((g) => g.todoIds))).toEqual(new Set(ids))
    for (const g of groups) {
      const due = g.todoIds.map((id) => byId.get(id)?.dueDate?.getTime() ?? -Infinity)
      expect(due).toEqual([...due].sort((a, b) => b - a))
    }
  })

  const GROUPS: TaskDialogSource = {
    kind: 'groups',
    groups: [
      { key: 'due', label: 'Due', color: 'red', todoIds: [2, 1] },
      { key: 'followup', label: 'Follow-up', color: 'gold', todoIds: [] },
      { key: 'x', label: 'Other', todoIds: [2] },
    ],
  }

  it('groups: headings in order with their colours, each sorted; empty ones left out', () => {
    expect(resolveTaskDialog(GROUPS, env())).toEqual([
      { key: 'due', label: 'Due', color: 'red', todoIds: [1, 2] },
      { key: 'x', label: 'Other', todoIds: [2] },
    ])
  })

  it('groups: keeps its own headings under a default grouping, until the user picks one', () => {
    const byStatus = { sort: 'name', sortDirection: 'asc', grouping: 'status' } as const
    // Settings' grouping (not picked): the source's headings stay, each sorted by the view's sort.
    const kept = resolveTaskDialog(GROUPS, env({ view: byStatus }))
    expect(kept.map((g) => g.label)).toEqual(['Due', 'Other'])
    expect(titles(kept[0]?.todoIds ?? [])).toEqual(titles([1, 2]).sort((a, b) => a!.localeCompare(b!)))
    // Picked: its tasks, each once, under the picked grouping's headings.
    const regrouped = resolveTaskDialog(GROUPS, env({ view: byStatus, groupingPicked: true }))
    expect(regrouped.map((g) => g.label)).not.toContain('Due')
    expect(regrouped.flatMap((g) => g.todoIds).sort()).toEqual([1, 2])
    // Picked "No grouping": one flat list.
    const flat = resolveTaskDialog(GROUPS, env({ view: { ...byStatus, grouping: 'none' }, groupingPicked: true }))
    expect(flat).toHaveLength(1)
    expect(flat[0]?.label).toBeNull()
    expect(titles(flat[0]?.todoIds ?? [])).toEqual(titles([1, 2]).sort((a, b) => a!.localeCompare(b!)))
  })

  it('predicate: grouped and sorted by the view', () => {
    const view = { sort: 'name', sortDirection: 'desc', grouping: 'tag' } as const
    const groups = resolveTaskDialog(personTaskDialog({ id: PRIYA, name: 'Priya Nair' }).source, env({ view }))
    expect(groups.every((g) => g.label != null)).toBe(true)
    expect(new Set(groups.flatMap((g) => titles(g.todoIds)))).toEqual(new Set(['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast']))
    for (const g of groups) {
      const names = titles(g.todoIds)
      expect(names).toEqual([...names].sort().reverse())
    }
  })

  it('predicate: the matching tasks in sortOrder — a person’s open tasks (the person chip)', () => {
    const [group] = resolveTaskDialog(personTaskDialog({ id: PRIYA, name: 'Priya Nair' }).source, env())
    // Priya's open tasks only (her completed "Team lunch booking" is left out), by sortOrder.
    expect(group?.label).toBeNull()
    expect(titles(group?.todoIds ?? [])).toEqual(['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast'])
  })

})

describe('popupListView — the popup lists’ group · sort', () => {
  const defaults = { sort: 'deadline', sortDirection: 'desc', grouping: 'status' } as const

  it('before any pick: Settings’ new-list sort, direction and grouping', () => {
    expect(popupListView(defaults, {})).toEqual(defaults)
  })

  it('a pick overrides its part; a sort comes with its direction', () => {
    expect(popupListView(defaults, { grouping: 'priority' })).toEqual({ ...defaults, grouping: 'priority' })
    expect(popupListView(defaults, { sort: 'name' })).toEqual({ ...defaults, sort: 'name', sortDirection: 'asc' })
    expect(popupListView(defaults, { sort: 'name', sortDirection: 'desc', grouping: 'none' })).toEqual({ sort: 'name', sortDirection: 'desc', grouping: 'none' })
  })

  it('every source reads the session’s pick over Settings (currentTaskDialogEnv)', () => {
    useSettingsStore.setState({ newListSort: 'priority', newListSortDirection: 'asc', newListGroup: 'tag' })
    expect(currentTaskDialogEnv()).toMatchObject({ view: { sort: 'priority', sortDirection: 'asc', grouping: 'tag' }, groupingPicked: false })
    useUIStore.getState().pickPopupListView({ grouping: 'priority' })
    useUIStore.getState().pickPopupListView({ sort: 'deadline', sortDirection: 'asc' })
    expect(currentTaskDialogEnv()).toMatchObject({ view: { sort: 'deadline', sortDirection: 'asc', grouping: 'priority' }, groupingPicked: true })
    // Settings changing later doesn't undo the pick.
    useSettingsStore.setState({ newListGroup: 'people' })
    expect(currentTaskDialogEnv().view.grouping).toBe('priority')
  })

  it('the pick is in memory only: the store starts with none (a reload brings back the defaults)', () => {
    expect(useUIStore.getInitialState().popupListPick).toEqual({})
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
    const groups = resolveTaskDialog(SCREEN, env({ screen: priya, view: view }))
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
    const groups = resolveTaskDialog(SCREEN, env({ ...base, screen: priya, view: byPeople }))
    expect(labelled(groups)).toEqual([['Priya Nair', priyaTasks]])
    // Counts stay unique tasks.
    expect(taskDialogCount(groups)).toBe(screenTaskCount(env({ ...base, screen: priya })))
    // Without a People pick, the task shows under both of its people.
    const unpicked = resolveTaskDialog(SCREEN, env({ ...base, view: byPeople }))
    expect(unpicked.filter((g) => g.todoIds.includes(14)).map((g) => g.label)).toEqual(['Ben Ortiz', 'Priya Nair'])
    // Tags likewise, the No tags pick keeping only its trailing group.
    const byTag = { ...byPeople, grouping: 'tag' } as const
    const q4 = { ...emptyFilterCriteria, tags: new Set([Q4]) }
    expect(resolveTaskDialog(SCREEN, env({ ...base, screen: q4, view: byTag })).map((g) => g.label)).toEqual(['#q4'])
    const untagged = { ...emptyFilterCriteria, tags: new Set([0]) }
    expect(resolveTaskDialog(SCREEN, env({ ...base, screen: untagged, view: byTag })).map((g) => g.label)).toEqual(['No Tag'])
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

