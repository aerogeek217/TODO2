import { describe, it, expect } from 'vitest'
import type { Org, Person, Project, Tag } from '../../models'
import {
  buildDateSections,
  buildFlatSection,
  buildOrgSections,
  buildPeopleSections,
  buildProjectSections,
  buildTagSections,
  itemSortComparator,
  truncateSections,
  type Section,
} from '../../services/list-view-sections'
import { encodeGroupSort } from '../../utils/list-view-encoding'
import { makeTodo } from '../helpers'

describe('buildDateSections', () => {
  // Fixed Monday so `+3 days` (Thursday) and `+4 days` (Friday) stay inside
  // the calendar week (weekStartsOn=1 → Mon-Sun); the post-P9 bucketer keys
  // "this week" off the calendar boundary, not a rolling-7-day window.
  const MONDAY = new Date(2026, 0, 12)

  it('groups into overdue, today, this week, later, no date', () => {
    const today = MONDAY
    const yesterday = new Date(today.getTime() - 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inTenDays = new Date(today.getTime() + 10 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: yesterday }),
      makeTodo({ id: 2, dueDate: today }),
      makeTodo({ id: 3, dueDate: inThreeDays }),
      makeTodo({ id: 4, dueDate: inTenDays }),
      makeTodo({ id: 5 }), // no dates
    ]
    const sections = buildDateSections(todos, 1, today)
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'today', 'week', 'later', 'none'])
    expect(sections[0]!.todos).toHaveLength(1) // overdue
    expect(sections[1]!.todos).toHaveLength(1) // today
    expect(sections[2]!.todos).toHaveLength(1) // this week
    expect(sections[3]!.todos).toHaveLength(1) // later
    expect(sections[4]!.todos).toHaveLength(1) // no date
  })

  it('preserves input order within a bucket (caller sorts upstream)', () => {
    const today = MONDAY
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inFourDays = new Date(today.getTime() + 4 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: inThreeDays, sortOrder: 30 }),
      makeTodo({ id: 2, dueDate: inFourDays, sortOrder: 5 }),
      makeTodo({ id: 3, dueDate: inThreeDays, sortOrder: 10 }),
      makeTodo({ id: 4, dueDate: inFourDays, sortOrder: 20 }),
    ]
    const sections = buildDateSections(todos, 1, today)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('uses scheduledDate when dueDate is absent', () => {
    const today = MONDAY
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)

    const todos = [
      makeTodo({ id: 1, scheduledDate: { kind: 'date', value: inThreeDays } }),
    ]
    const sections = buildDateSections(todos, 1, today)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([1])
  })

})

describe('buildPeopleSections', () => {
  it('groups by assigned person with unassigned fallback', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!]],
      [11, [people[1]!]],
      // 12 is unassigned
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(3)
    expect(sections[0]!.label).toBe('Alice')
    expect(sections[0]!.todos).toHaveLength(1)
    expect(sections[1]!.label).toBe('Bob')
    expect(sections[2]!.label).toBe('Unassigned')
    expect(sections[2]!.todos).toHaveLength(1)
  })

  it('shows todo in multiple sections when assigned to multiple people', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [makeTodo({ id: 10 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!, people[1]!]],
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(2)
    expect(sections[0]!.todos).toHaveLength(1)
    expect(sections[1]!.todos).toHaveLength(1)
  })

  // grouping-cross-surface-convergence-2026-04-29 P2 — group-by-people emits
  // person sections only. The legacy org-first short-circuit (siphon
  // direct-org-assigned tasks into a leading per-org bucket) is dropped;
  // a task with both a direct person AND a direct org now lands under the
  // person, matching the canvas project widget / list widget / lens.
  it('emits under person sections only when a task has both direct person and direct org', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const acme: Org = { id: 100, name: 'Acme', color: '#abc' }
    const t = makeTodo({ id: 10 })
    const assignedPeopleMap = new Map<number, Person[]>([[10, [alice]]])
    // `orgs` + `personOrgMap` are kept on the signature for `resolvePersonColor`
    // accent resolution; they no longer drive a leading org section.
    const sections = buildPeopleSections([t], [alice], assignedPeopleMap, [acme], new Map())
    expect(sections.map((s) => s.label)).toEqual(['Alice'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
  })

  // Item 1, P6 — visible-groups intersection rule. When the active filter
  // narrows to specific people AND grouping is by people, ONLY those
  // people's sections appear. Carol+Alice are restricted-to; Bob is filtered
  // out of the visible groups entirely, even though his task survived the
  // upstream filter pass (in production he wouldn't reach this helper, but
  // this asserts the helper's restriction is independent of the matcher).
  it('restricts visible person sections to restrictToPersonIds in caller order', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
      { id: 3, name: 'Carol', initials: 'C' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!]],
      [11, [people[1]!]],
      [12, [people[2]!]],
    ])
    const sections = buildPeopleSections(
      todos,
      people,
      assignedPeopleMap,
      undefined,
      undefined,
      [3, 1], // restrict to Carol then Alice; Bob's task drops out of the visible groups.
    )
    expect(sections.map((s) => s.label)).toEqual(['Carol', 'Alice'])
  })

  it('leaves person section order untouched when restrict list is null', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[1]!]],
      [11, [people[0]!]],
    ])
    const sections = buildPeopleSections(
      todos,
      people,
      assignedPeopleMap,
      undefined,
      undefined,
      null,
    )
    // Order follows the `people` registry input order.
    expect(sections.map((s) => s.label)).toEqual(['Alice', 'Bob'])
  })

  it('puts implicit-tier (cross-axis) person sections at the bottom of the person block', () => {
    // Setup mirrors the worked example from the plan's Decision 6:
    // - Filter people [Alice, Bob], group by people, mode=include-orgs.
    // - Bob is a member of org Acme; Alice is not.
    // - T1 directly assigned to Alice (and Charlie, who is filtered out).
    // - T2 directly assigned only to Charlie + org Acme — survives the
    //   filter via Bob's org membership; emits under Bob via implicit.
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const charlie: Person = { id: 3, name: 'Charlie', initials: 'C' }
    const acme: Org = { id: 100, name: 'Acme', color: '#abc' }
    const t1 = makeTodo({ id: 10 })
    const t2 = makeTodo({ id: 11 })
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [alice, charlie]],
      [11, [charlie]],
    ])
    const assignedOrgsMap = new Map<number, Org[]>([
      [10, []],
      [11, [acme]],
    ])
    const personOrgMap = new Map<number, number[]>([
      [bob.id!, [acme.id!]], // Bob ∈ Acme
    ])
    const implicitPersonIdsFor = (todo: typeof t1): readonly number[] => {
      const taskOrgs = assignedOrgsMap.get(todo.id) ?? []
      if (taskOrgs.length === 0) return []
      const result: number[] = []
      const seen = new Set<number>()
      for (const [pid, orgs] of personOrgMap) {
        if (orgs.some((oid) => taskOrgs.some((o) => o.id === oid))) {
          if (!seen.has(pid)) {
            seen.add(pid)
            result.push(pid)
          }
        }
      }
      return result
    }
    const sections = buildPeopleSections(
      [t1, t2],
      [alice, bob, charlie],
      assignedPeopleMap,
      [acme],
      personOrgMap,
      [alice.id!, bob.id!],
      implicitPersonIdsFor,
    )
    // Alice (direct) leads, Bob (implicit-only) at the bottom of the person
    // block. Charlie never appears.
    expect(sections.map((s) => s.label)).toEqual(['Alice', 'Bob'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([11])
  })

  it('drops tasks whose direct + implicit keys fail to intersect restrict set', () => {
    // Filter [Alice], no implicit callback; task assigned to Bob only →
    // dropped from the visible groups entirely (not routed to Unassigned).
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [makeTodo({ id: 10 })]
    const assignedPeopleMap = new Map<number, Person[]>([[10, [bob]]])
    const sections = buildPeopleSections(
      todos,
      [alice, bob],
      assignedPeopleMap,
      undefined,
      undefined,
      [alice.id!],
    )
    expect(sections).toEqual([])
  })

  it('promotes a group to direct tier when any task emits under it directly', () => {
    // Filter [Alice]; T1 has direct Alice; T2 has implicit-only Alice (via
    // org). Group Alice ends up direct-tier (not implicit-only) because of T1.
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const charlie: Person = { id: 3, name: 'Charlie', initials: 'C' }
    const acme: Org = { id: 100, name: 'Acme', color: '#abc' }
    const t1 = makeTodo({ id: 10 })
    const t2 = makeTodo({ id: 11 })
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [alice]],
      [11, [charlie]],
    ])
    const assignedOrgsMap = new Map<number, Org[]>([
      [10, []],
      [11, [acme]],
    ])
    const personOrgMap = new Map<number, number[]>([[alice.id!, [acme.id!]]])
    const implicitPersonIdsFor = (todo: typeof t1): readonly number[] => {
      const taskOrgs = assignedOrgsMap.get(todo.id) ?? []
      if (taskOrgs.length === 0) return []
      const result: number[] = []
      for (const [pid, orgs] of personOrgMap) {
        if (orgs.some((oid) => taskOrgs.some((o) => o.id === oid))) result.push(pid)
      }
      return result
    }
    const sections = buildPeopleSections(
      [t1, t2],
      [alice, charlie],
      assignedPeopleMap,
      [acme],
      personOrgMap,
      [alice.id!],
      implicitPersonIdsFor,
    )
    expect(sections.map((s) => s.label)).toEqual(['Alice'])
    // Both tasks land in the Alice section — T1 directly, T2 via implicit.
    expect(sections[0]!.todos.map((t) => t.id).sort()).toEqual([10, 11])
  })
})

describe('buildOrgSections — legacy mode (no restrict)', () => {
  // Baseline coverage seeded in P4 of grouping-bucketers-consolidation-2026-04-29.
  // The 3 inference-path tests (person→org infer / dedup / no-people-inferred
  // sentinel) were retired in grouping-cross-surface-convergence-2026-04-29
  // P3 alongside the `additionalKeysFor` callback. Direct emit + filtered-
  // out direct emit stay — they cover the post-P3 grouping surface.
  it('emits a section for each direct org assignment', () => {
    const acme: Org = { id: 1, name: 'Acme', color: '#a' }
    const beta: Org = { id: 2, name: 'Beta', color: '#b' }
    const t1 = makeTodo({ id: 10 })
    const t2 = makeTodo({ id: 11 })
    const assignedOrgsMap = new Map<number, Org[]>([
      [t1.id, [acme]],
      [t2.id, [beta]],
    ])
    const sections = buildOrgSections(
      [t1, t2],
      [acme, beta],
      assignedOrgsMap,
      new Map(),
    )
    expect(sections.map((s) => s.key)).toEqual(['org-1', 'org-2'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([11])
  })

  it('routes a person-only task with no direct org into the No Organization sentinel (post-P3: no inference)', () => {
    // Pre-P3: T's assignee Alice ∈ Acme via personOrgMap → T emitted under
    // Acme via person→org inference.
    // Post-P3: inference is gone → T has no direct org → falls to ungrouped
    // → renders as "No Organization" iff `showNoOrg`.
    const acme: Org = { id: 1, name: 'Acme', color: '#a' }
    const alice: Person = { id: 10, name: 'Alice', initials: 'A' }
    const t = makeTodo({ id: 100 })
    const assignedOrgsMap = new Map<number, Org[]>() // T has no direct orgs
    const personOrgMap = new Map<number, number[]>([[alice.id!, [acme.id!]]]) // Alice ∈ Acme
    const sections = buildOrgSections(
      [t],
      [acme],
      assignedOrgsMap,
      personOrgMap,
    )
    expect(sections.map((s) => s.key)).toEqual(['no-org'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([100])
  })

  it('drops direct-org tasks whose orgs are filtered out and suppresses No Organization when filter excludes the sentinel', () => {
    // filteredOrgIds = [acme.id] (no 0 sentinel) → showNoOrg=false.
    // T2 directly assigned to Beta (filtered out) is silently dropped.
    const acme: Org = { id: 1, name: 'Acme', color: '#a' }
    const beta: Org = { id: 2, name: 'Beta', color: '#b' }
    const t1 = makeTodo({ id: 10 })
    const t2 = makeTodo({ id: 11 })
    const assignedOrgsMap = new Map<number, Org[]>([
      [t1.id, [acme]],
      [t2.id, [beta]],
    ])
    const sections = buildOrgSections(
      [t1, t2],
      [acme, beta],
      assignedOrgsMap,
      new Map(),
      new Set([acme.id!]), // filter excludes Beta and the 0 sentinel
    )
    expect(sections.map((s) => s.key)).toEqual(['org-1'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
  })
})

describe('buildOrgSections — visible-groups intersection (P6)', () => {
  it('restricts visible org sections to restrictToOrgIds in caller order', () => {
    const orgs: Org[] = [
      { id: 1, name: 'Acme' },
      { id: 2, name: 'Beta' },
      { id: 3, name: 'Charlie' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedOrgsMap = new Map([
      [10, [orgs[0]!]],
      [11, [orgs[1]!]],
      [12, [orgs[2]!]],
    ])
    const sections = buildOrgSections(
      todos,
      orgs,
      assignedOrgsMap,
      new Map(),
      null,
      [3], // Restrict to Charlie only — Acme/Beta tasks drop out.
    )
    expect(sections.map((s) => s.label)).toEqual(['Charlie'])
  })

  it('puts implicit-tier (cross-axis people→org) sections at the bottom', () => {
    // Filter [Acme, Beta], group by org, mode=include-people.
    // - Bob ∈ Beta only.
    // - T1 directly assigned to org Acme → Acme is direct.
    // - T2 directly assigned to person Bob (no direct org) → emits under
    //   Beta as implicit via include-people.
    const acme: Org = { id: 1, name: 'Acme', color: '#a' }
    const beta: Org = { id: 2, name: 'Beta', color: '#b' }
    const bob = { id: 10, name: 'Bob', initials: 'B' }
    const t1 = makeTodo({ id: 100 })
    const t2 = makeTodo({ id: 101 })
    const assignedPeopleMap = new Map([[t2.id, [bob]]])
    const assignedOrgsMap = new Map([[t1.id, [acme]]])
    const personOrgMap = new Map([[bob.id, [beta.id!]]])
    const implicitOrgIdsFor = (todo: typeof t1): readonly number[] => {
      const ppl = assignedPeopleMap.get(todo.id) ?? []
      const ids = new Set<number>()
      for (const p of ppl) for (const oid of personOrgMap.get(p.id) ?? []) ids.add(oid)
      return [...ids]
    }
    const sections = buildOrgSections(
      [t1, t2],
      [acme, beta],
      assignedOrgsMap,
      personOrgMap,
      null,
      [acme.id!, beta.id!],
      implicitOrgIdsFor,
    )
    expect(sections.map((s) => s.label)).toEqual(['Acme', 'Beta'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([100])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([101])
  })
})

describe('buildTagSections — visible-groups intersection (P6)', () => {
  const ALPHA: Tag = { id: 3, name: 'alpha', color: '#00f' }
  const MU: Tag = { id: 4, name: 'mu', color: '#ff0' }
  const ZETA: Tag = { id: 5, name: 'zeta', color: '#0ff' }

  it('restricts visible tag sections to restrictToTagIds in caller order', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ALPHA]],
      [11, [MU]],
      [12, [ZETA]],
    ])
    // Restrict to {zeta, alpha} → mu drops; output in caller order.
    const sections = buildTagSections(todos, assigned, [5, 3])
    expect(sections.map((s) => s.label)).toEqual(['#zeta', '#alpha'])
  })

  it('suppresses the untagged trailing bucket when restricting by tag', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }), // untagged
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ALPHA]],
      [11, [ZETA]],
    ])
    // Restrict to {zeta} → alpha bucket drops; untagged is suppressed
    // (the user narrowed to specific tags, so "untagged" is incoherent).
    const sections = buildTagSections(todos, assigned, [5])
    expect(sections.map((s) => s.key)).toEqual(['tag-5'])
  })

  it('emits a task under each filter-set tag it has, dropping non-filter tags', () => {
    // T has tags {zeta, mu, alpha}; filter is {zeta, alpha} → T appears in
    // zeta and alpha sections only, never mu.
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [ZETA, MU, ALPHA]]])
    const sections = buildTagSections(todos, assigned, [5, 3])
    expect(sections.map((s) => s.label)).toEqual(['#zeta', '#alpha'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([10])
  })
})

describe('buildTagSections', () => {
  const URGENT: Tag = { id: 1, name: 'urgent', color: '#f00' }
  const WORK: Tag = { id: 2, name: 'work', color: '#0f0' }
  const ALPHA: Tag = { id: 3, name: 'alpha', color: '#00f' }
  const MU: Tag = { id: 4, name: 'mu', color: '#ff0' }
  const ZETA: Tag = { id: 5, name: 'zeta', color: '#0ff' }

  it('explodes a two-tag todo into both buckets via the assigned map', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT, WORK]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1', 'tag-2'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([10])
  })

  it('sorts tag buckets alphabetically by registry name', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ZETA]],
      [11, [ALPHA]],
      [12, [MU]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-3', 'tag-4', 'tag-5'])
    expect(sections.map((s) => s.label)).toEqual(['#alpha', '#mu', '#zeta'])
  })

  it('surfaces the registry color as the section accentColor', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [URGENT]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections[0]!.accentColor).toBe('#f00')
  })

  it('uses the canonical casing from the registry, not whatever was typed first', () => {
    const pascal: Tag = { id: 7, name: 'Urgent', color: '#f00' }
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [pascal]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections[0]!.label).toBe('#Urgent')
  })

  it('routes untagged todos into a trailing "No tag" bucket', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT]],
      // 11 unassigned; 12 has an empty array
      [12, []],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1', 'no-tag'])
    const noTag = sections[1]!
    expect(noTag.label).toBe('No tag')
    expect(noTag.todos.map((t) => t.id).sort()).toEqual([11, 12])
  })

  it('dedupes repeated tag entries on a single todo', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT, URGENT, URGENT]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('tag-1')
    expect(sections[0]!.todos).toHaveLength(1)
  })

  it('emits no bucket for tags with no assignments (discover-on-fly)', () => {
    // Post-L8 the helper discovers tags from `assignedTagsMap` rather than the
    // registry list, so a registry tag that has no assignments simply never
    // appears in the result. Same observable shape as the pre-L8 explicit
    // prune-empty-buckets pass.
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [URGENT]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1'])
  })

  it('renders an empty result when the input is empty', () => {
    expect(buildTagSections([], new Map())).toEqual([])
  })
})

describe('buildProjectSections', () => {
  it('groups by project with no-project fallback', () => {
    const projects: Project[] = [
      { id: 1, name: 'Alpha', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
      { id: 2, name: 'Beta', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
    ]
    const todos = [
      makeTodo({ id: 10, projectId: 1 }),
      makeTodo({ id: 11, projectId: 2 }),
      makeTodo({ id: 12 }), // no project
    ]

    const sections = buildProjectSections(todos, projects)
    expect(sections).toHaveLength(3)
    expect(sections[0]!.label).toBe('Alpha')
    expect(sections[1]!.label).toBe('Beta')
    expect(sections[2]!.label).toBe('No Project')
  })
})

describe('buildFlatSection', () => {
  it('returns single "all" section with every todo', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const sections = buildFlatSection(todos)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('all')
    expect(sections[0]!.todos).toHaveLength(3)
  })

  it('returns empty when no todos so the "empty state" message shows', () => {
    expect(buildFlatSection([])).toEqual([])
  })
})

describe('itemSortComparator', () => {
  const today = new Date(2026, 0, 15)

  it('returns undefined for manual sort so the caller keeps the upstream sortOrder order', () => {
    expect(itemSortComparator('manual', 1)).toBeUndefined()
  })

  it('sorts deadline ascending, nulls last', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(2026, 0, 20), sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: new Date(2026, 0, 18), sortOrder: 1 })
    const c = makeTodo({ id: 3, sortOrder: 5 }) // no deadline
    const cmp = itemSortComparator('deadline', 1, today)!
    const sorted = [a, b, c].sort(cmp)
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('breaks ties with sortOrder', () => {
    const d = new Date(2026, 0, 20)
    const a = makeTodo({ id: 1, dueDate: d, sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: d, sortOrder: 5 })
    const cmp = itemSortComparator('deadline', 1, today)!
    expect([a, b].sort(cmp).map((t) => t.id)).toEqual([2, 1])
  })

  it('sorts name ascending via localeCompare, case-insensitive', () => {
    const a = makeTodo({ id: 1, title: 'banana', sortOrder: 0 })
    const b = makeTodo({ id: 2, title: 'Apple', sortOrder: 0 })
    const c = makeTodo({ id: 3, title: 'cherry', sortOrder: 0 })
    const cmp = itemSortComparator('name', 1)!
    const sorted = [a, b, c].sort(cmp)
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('breaks name ties with sortOrder, then id', () => {
    const a = makeTodo({ id: 1, title: 'Same', sortOrder: 10 })
    const b = makeTodo({ id: 2, title: 'Same', sortOrder: 5 })
    const c = makeTodo({ id: 3, title: 'Same', sortOrder: 5 })
    const cmp = itemSortComparator('name', 1)!
    expect([a, b, c].sort(cmp).map((t) => t.id)).toEqual([2, 3, 1])
  })
})

describe('encodeGroupSort', () => {
  // Post ui-consistency-2026-04-25 P4 the encoder is the identity over flat
  // `TodoSortBy` / `TodoGroupBy` literals — `sort = itemSortBy`,
  // `grouping = groupBy`. The former discriminated-union shape was flattened
  // in the v46 Dexie migration.
  it('ungrouped + manual → grouping=none, sort=manual', () => {
    const { sort, grouping } = encodeGroupSort('none', 'manual')
    expect(grouping).toBe('none')
    expect(sort).toBe('manual')
  })

  it('coupled groupBy === itemSortBy → both = same field', () => {
    const { sort, grouping } = encodeGroupSort('date', 'date')
    expect(grouping).toBe('date')
    expect(sort).toBe('date')
  })

  it('decoupled groupBy / itemSortBy → flat literals retained independently', () => {
    const { sort, grouping } = encodeGroupSort('project', 'deadline')
    expect(grouping).toBe('project')
    expect(sort).toBe('deadline')
  })

  it('grouped by categorical + manual sort → grouping=project, sort=manual', () => {
    const { sort, grouping } = encodeGroupSort('project', 'manual')
    expect(grouping).toBe('project')
    expect(sort).toBe('manual')
  })

  it("grouped by tag → grouping='tag'", () => {
    const { sort, grouping } = encodeGroupSort('tag', 'date')
    expect(grouping).toBe('tag')
    expect(sort).toBe('date')
  })
})

describe('truncateSections', () => {
  const mkSection = (key: string, ids: number[]): Section => ({
    key,
    label: key,
    todos: ids.map((id) => makeTodo({ id })),
  })

  it('returns all sections when the limit exceeds total count', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 10)
    expect(truncatedCount).toBe(0)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0]!.todos).toHaveLength(2)
    expect(displaySections[1]!.todos).toHaveLength(1)
  })

  it('slices the section that straddles the cap', () => {
    const sections = [mkSection('a', [1, 2, 3]), mkSection('b', [4, 5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 4)
    expect(truncatedCount).toBe(2)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0]!.todos.map((t) => t.id)).toEqual([1, 2, 3])
    expect(displaySections[1]!.todos.map((t) => t.id)).toEqual([4])
  })

  it('drops entire tail sections after the cap', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3, 4]), mkSection('c', [5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 2)
    expect(truncatedCount).toBe(4)
    expect(displaySections).toHaveLength(1)
    expect(displaySections[0]!.todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('preserves label, key, and accentColor on the sliced section', () => {
    const sections: Section[] = [{
      key: 'a',
      label: 'Alpha',
      accentColor: '#abc',
      todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 })],
    }]
    const { displaySections } = truncateSections(sections, 1)
    expect(displaySections[0]!.key).toBe('a')
    expect(displaySections[0]!.label).toBe('Alpha')
    expect(displaySections[0]!.accentColor).toBe('#abc')
    expect(displaySections[0]!.todos).toHaveLength(1)
  })

  it('cap of 0 drops everything', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 0)
    expect(displaySections).toHaveLength(0)
    expect(truncatedCount).toBe(3)
  })
})
