import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../stores/filter-store'
import { countActiveFilters, criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { PersistedTodoItem } from '../../models'
import { applyFilterNow as applyFilter, makeTodo, matchesFilterNow as matchesFilter, patchScreenFilter } from '../helpers'
import { useSettingsStore } from '../../stores/settings-store'
import { DEFAULT_HOT_RULE } from '../../utils/hot'

/** Short-hand: current active filter state from the store. */
const f = () => useFilterStore.getState().filters

beforeEach(() => {
  useFilterStore.getState().clearAll()
})

describe('useFilterStore', () => {
  it('showCompleted false hides completed tasks', () => {
    // Default is showCompleted: false
    expect(matchesFilter(f(), makeTodo({ id: 1, isCompleted: true }))).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 2, isCompleted: false }))).toBe(true)
  })

  it('showCompleted true shows completed tasks', () => {
    useFilterStore.getState().setShowCompleted(true)

    expect(matchesFilter(f(), makeTodo({ id: 1, isCompleted: true }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, isCompleted: false }))).toBe(true)
  })

  it('a status never hides a task on its own — only a status filter narrows by status', () => {
    const todos = [makeTodo({ id: 1, statusId: 5 }), makeTodo({ id: 2 })] as PersistedTodoItem[]
    const statuses = [{ id: 5, name: 'Assigned', color: '#000', sortOrder: 0, icon: 'person' as const }]

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(applyFilter(f(), todos, undefined, statuses).map((t) => t.id)).toEqual([1, 2])
    expect(useFilterStore.getState().isActive).toBe(false)
  })

  it('matchesFilter checks person assignment', () => {
    useFilterStore.getState().setPersonIds(new Set([5]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [3])).toBe(false)
    // unassigned tasks filtered out when "None" (0) not in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [])).toBe(false)
  })

  it('matchesFilter shows unassigned tasks when None (0) is in personIds', () => {
    useFilterStore.getState().setPersonIds(new Set([0, 5]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [3])).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [])).toBe(true)
  })

  it('clearAll resets all filters', () => {
    useFilterStore.getState().setPersonIds(new Set([1]))
    useFilterStore.getState().setShowCompleted(true)
    useFilterStore.getState().clearAll()

    const { filters, isActive } = useFilterStore.getState()
    expect(filters.personIds).toBe(null)
    expect(filters.showCompleted).toBe(false)
    expect(isActive).toBe(false)
  })

  it('setStatusIds filters by statusId', () => {
    useFilterStore.getState().setStatusIds(new Set([5]))

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, statusId: 3 }))).toBe(false)
    // No status filtered out when 0 not in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
  })

  it('setStatusIds with 0 (None): tasks with no status pass', () => {
    useFilterStore.getState().setStatusIds(new Set([0, 5]))

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 3, statusId: 99 }))).toBe(false)
  })

  it('null statusIds means no filter', () => {
    useFilterStore.getState().setStatusIds(null)

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(true)
  })

  it('dateField defaults to deadline (due date)', () => {
    expect(useFilterStore.getState().filters.dateField).toBe('deadline')
  })

  it('setDateField changes the date field', () => {
    patchScreenFilter({ dateField: 'created' })
    expect(useFilterStore.getState().filters.dateField).toBe('created')

    patchScreenFilter({ dateField: 'modified' })
    expect(useFilterStore.getState().filters.dateField).toBe('modified')

    patchScreenFilter({ dateField: 'followup' })
    expect(useFilterStore.getState().filters.dateField).toBe('followup')

    patchScreenFilter({ dateField: 'deadline' })
    expect(useFilterStore.getState().filters.dateField).toBe('deadline')
  })

  it('date range filters by due date with the default dateField', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    // No date excluded by default
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
  })

  it('date range filters by createdAt when dateField is created', () => {
    patchScreenFilter({ dateField: 'created' })
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, createdAt: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, createdAt: new Date('2025-04-15') }))).toBe(false)
  })

  it('date range filters by modifiedAt when dateField is modified', () => {
    patchScreenFilter({ dateField: 'modified' })
    useFilterStore.getState().setDateRange(new Date('2025-06-01'), new Date('2025-06-30'))

    expect(matchesFilter(f(), makeTodo({ id: 1, modifiedAt: new Date('2025-06-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, modifiedAt: new Date('2025-05-15') }))).toBe(false)
  })

  it('date range filters by dueDate when dateField is deadline', () => {
    patchScreenFilter({ dateField: 'deadline' })
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    // A follow-up-only task does NOT pass the due-date filter
    expect(matchesFilter(f(), makeTodo({ id: 3, nextFollowupAt: new Date('2025-03-15') }))).toBe(false)
  })

  it('includeNoDate keeps tasks without a due date when dateField is deadline', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    patchScreenFilter({ dateRangeIncludeNoDate: true })

    expect(matchesFilter(f(), makeTodo({ id: 1 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
  })

  it('includeNoDate has no effect on other date fields', () => {
    patchScreenFilter({ dateField: 'followup' })
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    patchScreenFilter({ dateRangeIncludeNoDate: true })

    expect(matchesFilter(f(), makeTodo({ id: 1 }))).toBe(false)
  })

  describe('hasDeadline / hasFollowup presence filters', () => {
    it('hasDeadline=true keeps only tasks with a due date', () => {
      patchScreenFilter({ hasDeadline: true })
      expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2026-04-20') }))).toBe(true)
      expect(matchesFilter(f(), makeTodo({ id: 2, nextFollowupAt: new Date('2026-04-16') }))).toBe(false)
      expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
    })

    it('hasDeadline=false keeps only tasks without a due date', () => {
      patchScreenFilter({ hasDeadline: false })
      expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2026-04-20') }))).toBe(false)
      expect(matchesFilter(f(), makeTodo({ id: 2, nextFollowupAt: new Date('2026-04-16') }))).toBe(true)
      expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(true)
    })

    it('null (default) disables the presence filter entirely', () => {
      expect(f().hasDeadline).toBeNull()
      expect(f().hasFollowup).toBeNull()
      expect(matchesFilter(f(), makeTodo({ id: 1 }))).toBe(true)
    })

    it('hasDeadline and hasFollowup compose with AND', () => {
      patchScreenFilter({ hasDeadline: true })
      patchScreenFilter({ hasFollowup: true })
      // Only the task with both should pass
      expect(matchesFilter(f(), makeTodo({
        id: 1,
        nextFollowupAt: new Date('2026-04-16'),
        dueDate: new Date('2026-04-20'),
      }))).toBe(true)
      expect(matchesFilter(f(), makeTodo({ id: 2, nextFollowupAt: new Date('2026-04-16') }))).toBe(false)
      expect(matchesFilter(f(), makeTodo({ id: 3, dueDate: new Date('2026-04-20') }))).toBe(false)
    })
  })

  describe('markers filter', () => {
    const today = new Date(2026, 9, 10)
    const day = (offset: number) => new Date(2026, 9, 10 + offset)

    beforeEach(() => {
      useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE })
    })

    it('each ticked marker narrows; several AND together', () => {
      const focused = makeTodo({ id: 1, focus: true })
      const important = makeTodo({ id: 2, important: true })
      const both = makeTodo({ id: 3, important: true, focus: true })
      const plain = makeTodo({ id: 4 })
      expect(f().markers).toBeNull()
      for (const t of [focused, important, both, plain]) expect(matchesFilter(f(), t, undefined, today)).toBe(true)
      patchScreenFilter({ markers: { focus: true } })
      expect([focused, important, both, plain].map((t) => matchesFilter(f(), t, undefined, today))).toEqual([true, false, true, false])
      patchScreenFilter({ markers: { focus: true, important: true } })
      expect([focused, important, both, plain].map((t) => matchesFilter(f(), t, undefined, today))).toEqual([false, false, true, false])
    })

    it('Urgent means effective urgent: the flag, or due within the range (overdue included)', () => {
      patchScreenFilter({ markers: { urgent: true } })
      const flagged = makeTodo({ id: 1, urgent: true })
      const overdue = makeTodo({ id: 2, dueDate: day(-2) })
      const edge = makeTodo({ id: 3, dueDate: day(3) })
      const later = makeTodo({ id: 4, dueDate: day(4) })
      const doneOverdue = makeTodo({ id: 5, dueDate: day(-2), isCompleted: true })
      useFilterStore.getState().setShowCompleted(true)
      expect([flagged, overdue, edge, later, doneOverdue].map((t) => matchesFilter(f(), t, undefined, today)))
        .toEqual([true, true, true, false, false])
      // Range off: only the flag counts.
      useSettingsStore.setState({ urgentDueWithinDays: null })
      expect([flagged, overdue, edge].map((t) => matchesFilter(f(), t, undefined, today))).toEqual([true, false, false])
    })

    it('counts as one active filter, clears with clearAll, and an emptied set is no filter', () => {
      patchScreenFilter({ markers: { urgent: true, focus: true } })
      expect(useFilterStore.getState().isActive).toBe(true)
      expect(countActiveFilters(f())).toBe(1)
      useFilterStore.getState().clearAll()
      expect(f().markers).toBeNull()
      patchScreenFilter({ markers: {} })
      expect(countActiveFilters(f())).toBe(0)
      expect(useFilterStore.getState().isActive).toBe(false)
    })

    it('Hot keeps the tasks the Settings rule makes hot, and is one active filter', () => {
      patchScreenFilter({ markers: 'hot' })
      expect(f().markers).toBe('hot')
      expect(countActiveFilters(f())).toBe(1)
      const urgentImportant = makeTodo({ id: 1, important: true, dueDate: day(1) })
      const focused = makeTodo({ id: 2, focus: true })
      const importantOnly = makeTodo({ id: 3, important: true })
      const doneFocused = makeTodo({ id: 4, focus: true, isCompleted: true })
      useFilterStore.getState().setShowCompleted(true)
      const shown = () => [urgentImportant, focused, importantOnly, doneFocused].map((t) => matchesFilter(f(), t, undefined, today))
      expect(shown()).toEqual([true, true, false, false])
      useSettingsStore.setState({ hotRule: [{ important: true }] })
      expect(shown()).toEqual([true, false, true, false])
      // A caller's own settings win over the store's.
      expect(matchesFilter(f(), focused, undefined, today, undefined, undefined, { urgentRange: 3, hotRule: [{ focus: true }] })).toBe(true)
      const predicate = criteriaToPredicate(f())
      expect(predicate.markers).toBe('hot')
      expect(predicateToCriteria(predicate).markers).toBe('hot')
    })

    it('round-trips through the predicate; a predicate without it reads as null', () => {
      patchScreenFilter({ markers: { important: true } })
      const predicate = criteriaToPredicate(f())
      expect(predicate.markers).toEqual({ important: true })
      expect(predicateToCriteria(predicate).markers).toEqual({ important: true })
      const { markers: _drop, ...legacy } = predicate
      void _drop
      expect(predicateToCriteria(legacy).markers).toBeNull()
    })
  })

  describe('DateAnchor relative-token resolution', () => {
    it('relative end-of-week resolves to the configured weekStartsOn boundary', () => {
      // Wednesday 2026-04-15 → Monday-first week ends Sunday 2026-04-19.
      const today = new Date('2026-04-15T12:00:00')
      patchScreenFilter({ dateRangeStart: null, dateRangeEnd: { kind: 'relative', token: 'end-of-week' } })

      // Task due Sunday (2026-04-19) passes; task due next Monday (2026-04-20) fails.
      expect(matchesFilter(f(), makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 19),
      }), undefined, today)).toBe(true)

      expect(matchesFilter(f(), makeTodo({
        id: 2,
        dueDate: new Date(2026, 3, 20),
      }), undefined, today)).toBe(false)
    })

    it('relative tomorrow anchor lets a same-day task through as a start bound', () => {
      const today = new Date('2026-04-15T12:00:00')
      patchScreenFilter({ dateRangeStart: { kind: 'relative', token: 'tomorrow' }, dateRangeEnd: null })
      // Today-due task excluded (before tomorrow); tomorrow-due passes.
      expect(matchesFilter(f(), makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 15),
      }), undefined, today)).toBe(false)

      expect(matchesFilter(f(), makeTodo({
        id: 2,
        dueDate: new Date(2026, 3, 16),
      }), undefined, today)).toBe(true)
    })

    it('fixed anchor behaves like the legacy ISO-string range', () => {
      patchScreenFilter({
        dateRangeStart: { kind: 'fixed', iso: '2025-03-01' },
        dateRangeEnd: { kind: 'fixed', iso: '2025-03-31' },
      })
      expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
      expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    })
  })

  it('clearAll resets dateField to deadline', () => {
    patchScreenFilter({ dateField: 'modified' })
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.dateField).toBe('deadline')
  })

  it('clearAll resets hasDeadline / hasFollowup to null', () => {
    patchScreenFilter({ hasFollowup: true })
    patchScreenFilter({ hasDeadline: false })
    expect(useFilterStore.getState().isActive).toBe(true)
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.hasFollowup).toBeNull()
    expect(useFilterStore.getState().filters.hasDeadline).toBeNull()
  })

  describe('tags filter', () => {
    // Tag filters are by registry id. `matchesFilter` reads the
    // `assignedTagIds` positional arg (6th) — no fallback to inline strings.
    const withTagIds = (ids: number[]) =>
      // positional: filters, todo, personIds, today, searchCtx, assignedTagIds
      (todo: PersistedTodoItem) =>
        matchesFilter(f(), todo, undefined, undefined, undefined, ids)

    it('null (default) is not a filter — tagged and untagged todos pass', () => {
      expect(f().tags).toBeNull()
      expect(useFilterStore.getState().isActive).toBe(false)
      expect(withTagIds([10])(makeTodo({ id: 1 }))).toBe(true)
      expect(withTagIds([])(makeTodo({ id: 2 }))).toBe(true)
    })

    it('non-empty set matches tasks with at least one assigned id (OR)', () => {
      useFilterStore.getState().setTags(new Set([10, 20]))

      // Has one of the two
      expect(withTagIds([10])(makeTodo({ id: 1 }))).toBe(true)
      expect(withTagIds([20])(makeTodo({ id: 2 }))).toBe(true)
      // Has both plus another
      expect(withTagIds([10, 20, 99])(makeTodo({ id: 3 }))).toBe(true)
      // Has neither
      expect(withTagIds([30])(makeTodo({ id: 4 }))).toBe(false)
    })

    it('todo with zero assigned tags is excluded when the clause is non-empty', () => {
      useFilterStore.getState().setTags(new Set([10]))
      expect(withTagIds([])(makeTodo({ id: 1 }))).toBe(false)
      // Missing `assignedTagIds` arg falls back to empty list → also excluded.
      expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(false)
    })

    it('empty set matches zero todos (no id can satisfy it)', () => {
      useFilterStore.getState().setTags(new Set())
      expect(withTagIds([10])(makeTodo({ id: 1 }))).toBe(false)
      expect(withTagIds([])(makeTodo({ id: 2 }))).toBe(false)
    })

    it('isActive reflects a non-null tag filter', () => {
      useFilterStore.getState().setTags(new Set([10]))
      expect(useFilterStore.getState().isActive).toBe(true)
      useFilterStore.getState().setTags(null)
      expect(useFilterStore.getState().isActive).toBe(false)
    })

    it('clearAll resets tags to null', () => {
      useFilterStore.getState().setTags(new Set([10]))
      useFilterStore.getState().clearAll()
      expect(useFilterStore.getState().filters.tags).toBeNull()
    })
  })

  describe('applyFilter person membership', () => {
    it('keeps only todos assigned to a filtered person', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      useFilterStore.getState().setShowCompleted(true)

      const todos = [
        makeTodo({ id: 1 }), // unassigned
        makeTodo({ id: 2 }), // person 5
        makeTodo({ id: 3 }), // person 99 (not filtered)
      ]
      const assignedPeopleMap = new Map([
        [2, [{ id: 5, name: 'Alice', initials: 'A' }]],
        [3, [{ id: 99, name: 'Bob', initials: 'B' }]],
      ])

      const result = applyFilter(f(), todos, assignedPeopleMap)

      expect(result.map(t => t.id)).toEqual([2])
    })

    it('unassigned (0) sentinel keeps todos with no assigned person', () => {
      useFilterStore.getState().setPersonIds(new Set([0]))
      useFilterStore.getState().setShowCompleted(true)

      const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
      const assignedPeopleMap = new Map([
        [2, [{ id: 5, name: 'Alice', initials: 'A' }]],
      ])

      const result = applyFilter(f(), todos, assignedPeopleMap)

      expect(result.map(t => t.id)).toEqual([1])
    })
  })
})

describe('criteriaToPredicate / predicateToCriteria round-trip', () => {
  it('converts Sets to arrays and DateAnchor round-trips', async () => {
    const { criteriaToPredicate, predicateToCriteria } = await import('../../utils/filter-criteria')
    const original = {
      showCompleted: true,
      personIds: new Set([5, 10]),
      statusIds: new Set([0, 3]),
      searchText: 'x',
      dateField: 'deadline' as const,
      dateRangeStart: { kind: 'fixed' as const, iso: '2025-03-01T00:00:00.000Z' },
      dateRangeEnd: { kind: 'relative' as const, token: 'end-of-week' as const },
      dateRangeIncludeNoDate: true,
      hasDeadline: null,
      hasFollowup: true,
      tags: null,
    }

    const serialized = criteriaToPredicate(original)
    expect(Array.isArray(serialized.personIds)).toBe(true)
    expect(serialized.personIds).toEqual([5, 10])
    expect(serialized.dateRangeStart).toEqual({ kind: 'fixed', iso: '2025-03-01T00:00:00.000Z' })
    expect(serialized.dateRangeEnd).toEqual({ kind: 'relative', token: 'end-of-week' })
    expect(serialized.hasFollowup).toBe(true)
    expect(serialized.hasDeadline).toBe(null)

    const runtime = predicateToCriteria(serialized)
    expect(runtime.personIds instanceof Set).toBe(true)
    expect([...runtime.personIds!].sort((a, b) => a - b)).toEqual([5, 10])
    expect(runtime.dateField).toBe('deadline')
    expect(runtime.dateRangeStart).toEqual({ kind: 'fixed', iso: '2025-03-01T00:00:00.000Z' })
    expect(runtime.dateRangeEnd).toEqual({ kind: 'relative', token: 'end-of-week' })
    expect(runtime.hasFollowup).toBe(true)
  })

  it('tags round-trip as Set ↔ array; missing field reads back as null', async () => {
    const { criteriaToPredicate, predicateToCriteria } = await import('../../utils/filter-criteria')
    const original = {
      showCompleted: false,
      personIds: null,
      statusIds: null,
      searchText: '',
      dateField: 'deadline' as const,
      dateRangeStart: null,
      dateRangeEnd: null,
      dateRangeIncludeNoDate: false,
      hasDeadline: null,
      tags: new Set([10, 20]),
    }
    const serialized = criteriaToPredicate(original)
    expect(Array.isArray(serialized.tags)).toBe(true)
    expect(new Set(serialized.tags!)).toEqual(new Set([10, 20]))

    const runtime = predicateToCriteria(serialized)
    expect(runtime.tags instanceof Set).toBe(true)
    expect(runtime.tags).toEqual(new Set([10, 20]))

    // Back-compat: a predicate missing the `tags` key reads back as null.
    const pre = { ...serialized }
    delete (pre as { tags?: unknown }).tags
    const backCompat = predicateToCriteria(pre as any)
    expect(backCompat.tags).toBeNull()
  })

  it('legacy ISO-string dateRangeStart auto-upgrades to fixed anchor', async () => {
    const { predicateToCriteria } = await import('../../utils/filter-criteria')
    const legacy = {
      showCompleted: false,
      personIds: null,
      statusIds: null,
      searchText: '',
      dateField: 'deadline' as const,
      dateRangeStart: '2025-03-01' as unknown as never, // legacy string shape
      dateRangeEnd: null,
      dateRangeIncludeNoDate: false,
      hasDeadline: null,
    }
    const runtime = predicateToCriteria(legacy as any)
    expect(runtime.dateRangeStart).toEqual({ kind: 'fixed', iso: '2025-03-01' })
  })
})

describe('countActiveFilters', () => {
  beforeEach(() => useFilterStore.getState().clearAll())

  it('is 0 with no filters', () => {
    expect(countActiveFilters(useFilterStore.getState().filters)).toBe(0)
  })

  it('counts one per active control; the date clauses count once', () => {
    const s = useFilterStore.getState()
    s.setSearchText('plumber')
    s.setShowCompleted(true)
    patchScreenFilter({ hasDeadline: true })
    patchScreenFilter({ hasFollowup: false })
    expect(countActiveFilters(useFilterStore.getState().filters)).toBe(3)
    expect(useFilterStore.getState().isActive).toBe(true)
  })
})
