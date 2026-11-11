/**
 * The README screenshots' data (`e2e/readme-shots.spec.ts`): a small product
 * team's work — a launch, a billing migration, hiring and a vendor
 * contract — as an export in the current schema, for the import pipeline.
 * Every date is relative to `today`, so the pictures read the same on any
 * day: a few tasks overdue, most due within the next two weeks, some later.
 * Synthetic: fictional first names, no real people or companies.
 */

type Obj = Record<string, unknown>

export const README_SCHEMA_VERSION = 78

const PEOPLE = [
  { key: 'priya', name: 'Priya Nair', initials: 'PN', color: '#4f8cff' },
  { key: 'marcus', name: 'Marcus Bell', initials: 'MB', color: '#34c759' },
  { key: 'elena', name: 'Elena Ruiz', initials: 'ER', color: '#e07a5f' },
  { key: 'jonas', name: 'Jonas Berg', initials: 'JB', color: '#a070e0' },
  { key: 'sam', name: 'Sam Ortiz', initials: 'SO', color: '#d4a017' },
  { key: 'aisha', name: 'Aisha Khan', initials: 'AK', color: '#2bb3a3' },
] as const
type PersonKey = (typeof PEOPLE)[number]['key']

const TAGS = [
  { key: 'launch', color: '#4f8cff' },
  { key: 'billing', color: '#a070e0' },
  { key: 'hiring', color: '#34c759' },
  { key: 'vendor', color: '#f5a623' },
  { key: 'docs', color: '#8e8e93' },
] as const
type TagKey = (typeof TAGS)[number]['key']

const STATUSES = [
  { key: 'assigned', name: 'Assigned', color: '#537FE7', icon: 'person' },
  { key: 'followup', name: 'Follow-up', color: '#f5a623', icon: 'message-bubble' },
  { key: 'waiting', name: 'Waiting', color: '#a070e0', icon: 'clock' },
] as const
type StatusKey = (typeof STATUSES)[number]['key']

interface Task {
  title: string
  /** Created this many days ago. */
  age: number
  due?: number
  followup?: number
  /** Last followed up this many days from today (≤ 0). */
  followedUp?: number
  people?: PersonKey[]
  tags?: TagKey[]
  status?: StatusKey
  urgent?: boolean
  important?: boolean
  focus?: boolean
  notes?: string
  /** `[x] ` marks a line done. */
  subtasks?: string[]
  /** `[day, text]`, oldest first; the last one is the follow-up when `followedUp` is that day. */
  updates?: Array<[number, string]>
  /** Completed this many days from today (≤ 0). */
  done?: number
}

/** The task the editor shot opens. */
export const EDITOR_TASK = 'Negotiate the vendor renewal'
/** The person the review shot reviews. */
export const REVIEW_PERSON = 'Priya Nair'

const TASKS: Task[] = [
  // ── Launch ──
  {
    title: 'Finish the launch post', age: 9, due: 0, people: ['priya'], tags: ['launch'], status: 'followup', important: true, focus: true,
    subtasks: ['[x] Headline and summary', '[x] Customer quote', 'Pricing paragraph', 'Legal review', 'Schedule the post'],
    updates: [[-4, 'First draft shared with marketing'], [-1, 'Waiting on the customer quote approval']],
  },
  { title: 'Record the product demo video', age: 34, due: 2, people: ['marcus'], tags: ['launch'], status: 'assigned' },
  { title: 'Brief support on the new pricing', age: 8, due: -1, people: ['elena'], tags: ['launch'], urgent: true },
  { title: 'Publish the release notes', age: 6, due: 3, followedUp: 0, people: ['priya'], tags: ['launch', 'docs'], updates: [[0, 'Draft reviewed by Jonas']] },
  { title: 'Confirm the launch on-call rota', age: 31, due: 1, followup: 0, people: ['jonas'], tags: ['launch'] },
  { title: 'Refresh the pricing page screenshots', age: 4, due: 6, people: ['sam'], tags: ['launch'] },
  { title: 'Send the press kit to partners', age: 40, due: 8, followup: 4, followedUp: 0, people: ['priya'], tags: ['launch'], updates: [[0, 'Partner list agreed with Elena']] },
  { title: 'Baseline the launch metrics', age: 45, followup: 5, people: ['priya'], tags: ['launch'] },
  // ── Billing migration ──
  {
    title: 'Final dry run of the billing migration', age: 38, due: -2, people: ['jonas'], tags: ['billing'], urgent: true, important: true,
    subtasks: ['[x] Restore last night’s snapshot', '[x] Replay the October invoices', 'Compare totals', 'Sign-off from finance'],
  },
  { title: 'Write the cutover rollback plan', age: 11, due: 4, people: ['jonas'], tags: ['billing', 'docs'], important: true },
  { title: 'Freeze schema changes', age: 7, due: 0, people: ['marcus'], tags: ['billing'] },
  { title: 'Verify backups restore in staging', age: 36, due: 5, people: ['jonas'], tags: ['billing'], status: 'assigned' },
  { title: 'Retire the old reporting jobs', age: 50, due: 13, people: ['marcus'], tags: ['billing'] },
  { title: 'Tidy up the migration wiki page', age: 55, people: ['marcus'], tags: ['billing', 'docs'] },
  // ── Hiring ──
  { title: 'Schedule the backend onsite loop', age: 6, due: 1, followup: -1, people: ['aisha'], tags: ['hiring'], status: 'followup' },
  { title: 'Review the take-home exercises', age: 33, due: -3, people: ['aisha'], tags: ['hiring'], status: 'waiting' },
  { title: 'Draft the product designer job post', age: 5, due: 9, people: ['aisha'], tags: ['hiring', 'docs'] },
  { title: 'Plan onboarding for the new support hire', age: 42, due: 12, people: ['elena'], tags: ['hiring'] },
  // ── Vendor contract ──
  { title: 'Compare vendor support tiers', age: 30, due: 2, people: ['sam'], tags: ['vendor'] },
  {
    title: EDITOR_TASK, age: 16, due: 7, followup: 2, followedUp: -2, people: ['sam', 'priya'], tags: ['vendor'], status: 'waiting', important: true,
    notes: 'Contract ends on the 30th. Aim: same seats, a two-year term, premium support at the standard price.\n\n- Usage is down 18% since spring\n- Finance wants a counter-offer by the budget review',
    subtasks: ['[x] Pull the last 12 months of usage', '[x] Get two competing quotes', 'Draft the counter-offer', 'Review the terms with finance'],
    updates: [[-9, 'Kick-off call with their account manager'], [-5, 'First renewal quote received: 12% up'], [-2, 'Sent our usage numbers; reply expected Friday']],
  },
  { title: 'Answer the vendor security questionnaire', age: 37, due: 5, followup: 1, people: ['sam'], tags: ['vendor'], status: 'waiting' },
  { title: 'Check the data processing addendum', age: 48, due: 10, people: ['elena'], tags: ['vendor'] },
  { title: 'Book the planning offsite', age: 2, due: 20, people: ['priya'] },
  // ── Completed in the last few weeks (the trend and the closed counts) ──
  { title: 'Agree the launch date with sales', age: 44, done: -24, people: ['priya'], tags: ['launch'] },
  { title: 'Set up the staging billing database', age: 50, done: -22, people: ['jonas'], tags: ['billing'] },
  { title: 'Write the launch FAQ outline', age: 30, done: -20, people: ['elena'], tags: ['launch', 'docs'] },
  { title: 'Shortlist backend candidates', age: 27, done: -17, people: ['aisha'], tags: ['hiring'] },
  { title: 'Map the old billing tables', age: 40, done: -15, people: ['marcus'], tags: ['billing'] },
  { title: 'Request quotes from two other vendors', age: 21, done: -13, people: ['sam'], tags: ['vendor'] },
  { title: 'Write the migration test plan', age: 19, done: -11, people: ['jonas'], tags: ['billing', 'docs'] },
  { title: 'Draft the pricing FAQ', age: 17, done: -9, people: ['elena'], tags: ['launch', 'docs'] },
  { title: 'Set up the candidate scorecard', age: 15, done: -8, people: ['aisha'], tags: ['hiring'] },
  { title: 'Phone screen: backend candidate', age: 13, done: -6, people: ['aisha'], tags: ['hiring'] },
  { title: 'Export billing data for the dry run', age: 12, done: -5, people: ['marcus'], tags: ['billing'] },
  { title: 'Approve the launch blog banner', age: 7, done: -4, people: ['priya'], tags: ['launch'] },
  { title: 'Fix the invoice rounding bug', age: 9, done: -3, people: ['jonas'], tags: ['billing'] },
  { title: 'Send the NDA back to the vendor', age: 6, done: -2, people: ['sam'], tags: ['vendor'] },
  { title: 'Book the interview rooms', age: 3, done: -1, people: ['aisha'], tags: ['hiring'] },
  { title: 'Reserve the launch-day war room', age: 3, done: 0, people: ['jonas'], tags: ['launch'] },
]

/** A stored filter with `over` on top of none (every open task). */
export function filter(over: Obj = {}): Obj {
  return { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null, ...over }
}

const offset = (days: number) => ({ kind: 'offset', days })
const rel = (token: string) => ({ kind: 'relative', token })
const range = (start: Obj | null, end: Obj | null) => ({ match: 'range', start, end })

/** The colours the app's own Numbers and Breakdown columns use for due and follow-up. */
const DUE = '#e86bf0'
const FOLLOWUP = '#f5c842'

const number = (id: string, name: string, f: Obj, lit: { color?: string; above?: number } = {}) => ({
  id,
  kind: 'number',
  config: {
    name,
    ...(lit.color ? { color: lit.color } : {}),
    filter: f,
    show: 'count',
    litWhen: lit.above !== undefined ? 'above' : 'never',
    ...(lit.above !== undefined ? { litAt: lit.above } : {}),
    compare: 'yesterday',
  },
})

const byPerson = (id: string) => ({
  id,
  kind: 'breakdown',
  config: {
    name: 'By person',
    filter: filter(),
    splitBy: 'people',
    style: 'bars',
    show: 'count',
    showNone: false,
    checkins: true,
    columns: [
      { id: 'due', name: 'Due', color: DUE, filter: filter({ dates: { deadline: range(null, offset(3)) } }), litWhen: 'above', litAt: 0 },
      { id: 'followup', name: 'Chase', color: FOLLOWUP, filter: filter({ dates: { followup: range(null, rel('today')) } }), litWhen: 'above', litAt: 0 },
    ],
  },
})

/** Ids of the layouts and the cells the spec crops to. */
export const README_IDS = {
  layouts: { today: 1, planning: 2 },
  cells: {
    list: 'cell-list', calendar: 'cell-cal', numbers: ['cell-n-open', 'cell-n-week', 'cell-n-late'],
    planningNumbers: ['cell-p-open', 'cell-p-week', 'cell-p-late'], breakdown: 'cell-breakdown', trend: 'cell-trend',
  },
}

export function readmeData(today: Date = new Date()): Obj {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  const day = (n: number) => new Date(y, m, d + n)
  const at = (n: number, hh: number, mm = 0) => new Date(y, m, d + n, hh, mm)
  const iso = (dt: Date | number) => new Date(dt).toISOString()
  const exportedAt = at(0, 8, 30)
  const nowMs = exportedAt.getTime()

  const personId = (k: PersonKey) => PEOPLE.findIndex((p) => p.key === k) + 1
  const tagId = (k: TagKey) => TAGS.findIndex((t) => t.key === k) + 1
  const statusId = (k: StatusKey) => STATUSES.findIndex((s) => s.key === k) + 1

  const todos: Obj[] = []
  const todoPeople: Obj[] = []
  const todoTags: Obj[] = []
  const events: Obj[] = []
  const statusUpdates: Obj[] = []
  const subtasks: Obj[] = []

  // Ids follow creation, oldest first.
  const ordered = [...TASKS].sort((a, b) => b.age - a.age)
  ordered.forEach((t, i) => {
    const id = i + 1
    const created = Math.min(at(-t.age, 9 + (i % 7), (i * 13) % 60).getTime(), nowMs - 3_600_000)
    const ev = (type: string, ts: number, toValue: string | number | null = null) =>
      events.push({ todoId: id, type, fromValue: null, toValue, timestamp: iso(ts) })
    ev('created', created)
    const completed = t.done !== undefined ? Math.min(at(t.done, 16, (i * 7) % 60).getTime(), nowMs - 60_000) : null
    const followedUp = t.followedUp !== undefined ? Math.min(at(t.followedUp, 8, 5 + i).getTime(), nowMs - 60_000) : null
    const todo: Obj = {
      id,
      uid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      title: t.title,
      isCompleted: completed !== null,
      createdAt: iso(created),
      // Every open task was touched in the last week (none reads as stale).
      modifiedAt: iso(Math.max(created, completed ?? 0, followedUp ?? 0, t.updates ? at(t.updates.at(-1)![0], 8, 0).getTime() : 0,
        completed === null ? Math.min(at(-(i % 6) - 1, 14).getTime(), nowMs - 60_000) : 0)),
      sortOrder: i,
    }
    if (t.notes) todo.notes = t.notes
    if (completed !== null) { todo.completedAt = iso(completed); ev('completed', completed) }
    if (t.due !== undefined) { todo.dueDate = iso(day(t.due)); ev('deadline', created, iso(day(t.due))) }
    if (followedUp !== null) { todo.lastFollowupAt = iso(followedUp); ev('followedUp', followedUp, iso(followedUp)) }
    if (t.followup !== undefined && completed === null) { todo.nextFollowupAt = iso(day(t.followup)); ev('followup', created, iso(day(t.followup))) }
    if (t.focus) todo.focus = true
    if (t.urgent) todo.urgent = true
    if (t.important) todo.important = true
    if (t.status) { todo.statusId = statusId(t.status); ev('status', created, statusId(t.status)) }
    todos.push(todo)
    for (const p of t.people ?? []) { todoPeople.push({ todoId: id, personId: personId(p) }); ev('person', created, personId(p)) }
    for (const g of t.tags ?? []) { todoTags.push({ todoId: id, tagId: tagId(g) }); ev('tag', created, tagId(g)) }
    t.subtasks?.forEach((line, k) => {
      const isDone = line.startsWith('[x] ')
      subtasks.push({ todoId: id, title: isDone ? line.slice(4) : line, isCompleted: isDone, sortOrder: k, createdAt: iso(created + (k + 1) * 60_000) })
    })
    t.updates?.forEach(([n, text], k) => {
      const ms = Math.min(at(n, 8, k).getTime(), nowMs - 60_000)
      statusUpdates.push({
        todoId: id, date: iso(day(n)), text, createdAt: iso(ms),
        ...(t.followedUp === n && k === t.updates!.length - 1 ? { followedUp: true } : {}),
      })
    })
  })

  events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
  const withIds = (rows: Obj[]) => rows.map((r, i) => ({ ...r, id: i + 1 }))

  const longAgo = iso(at(-200, 9))
  const listDefinitions = [
    {
      id: 1, name: 'Next few days', sortOrder: 0,
      membership: { kind: 'custom', predicate: filter({ dates: { deadline: range(null, offset(3)) } }) },
      sort: 'priority', grouping: 'deadline', owner: { layoutId: README_IDS.layouts.today },
    },
    { id: 2, name: 'Eisenhower', sortOrder: 1, membership: { kind: 'custom', predicate: filter() }, sort: 'manual', grouping: 'none', owner: { eisenhower: true } },
  ]

  const C = README_IDS.cells
  const layouts = [
    {
      id: README_IDS.layouts.today,
      name: 'Today',
      sortOrder: 0,
      // A list beside three Numbers over a Breakdown by person, this week's calendar across the bottom.
      grid: {
        columns: [{ id: 't-c1', weight: 620 }, { id: 't-c2', weight: 127 }, { id: 't-c3', weight: 127 }, { id: 't-c4', weight: 126 }],
        rows: [{ id: 't-r1', weight: 95 }, { id: 't-r2', weight: 640 }, { id: 't-r3', weight: 360 }],
      },
      cells: [
        { id: C.list, tabs: [{ id: 'tab-list', kind: 'lens', config: { listDefinitionId: 1 } }], activeTabId: 'tab-list', area: { col: 0, row: 0, colSpan: 1, rowSpan: 2 } },
        { id: C.numbers[0], tabs: [number('tab-n-open', 'Open', filter())], activeTabId: 'tab-n-open', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: C.numbers[1], tabs: [number('tab-n-week', 'Due this week', filter({ dates: { deadline: range(rel('today'), offset(6)) } }))], activeTabId: 'tab-n-week', area: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: C.numbers[2], tabs: [number('tab-n-late', 'Overdue', filter({ dates: { deadline: range(null, rel('yesterday')) } }), { color: DUE, above: 0 })], activeTabId: 'tab-n-late', area: { col: 3, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: 'cell-t-breakdown', tabs: [byPerson('tab-t-breakdown')], activeTabId: 'tab-t-breakdown', area: { col: 1, row: 1, colSpan: 3, rowSpan: 1 } },
        { id: C.calendar, tabs: [{ id: 'tab-cal', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: 0 } }], activeTabId: 'tab-cal', area: { col: 0, row: 2, colSpan: 4, rowSpan: 1 } },
      ],
      createdAt: longAgo, modifiedAt: iso(at(-2, 17)), lastUsedAt: iso(at(0, 8)),
    },
    {
      id: README_IDS.layouts.planning,
      name: 'Planning',
      sortOrder: 1,
      // Three Numbers over a Breakdown by person, Created vs completed under it.
      grid: {
        columns: [{ id: 'p-c1', weight: 330 }, { id: 'p-c2', weight: 330 }, { id: 'p-c3', weight: 340 }],
        rows: [{ id: 'p-r1', weight: 95 }, { id: 'p-r2', weight: 515 }, { id: 'p-r3', weight: 485 }],
      },
      cells: [
        { id: C.planningNumbers[0], tabs: [number('tab-p-open', 'Open', filter())], activeTabId: 'tab-p-open', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: C.planningNumbers[1], tabs: [number('tab-p-week', 'Due this week', filter({ dates: { deadline: range(rel('today'), offset(6)) } }))], activeTabId: 'tab-p-week', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: C.planningNumbers[2], tabs: [number('tab-p-late', 'Overdue', filter({ dates: { deadline: range(null, rel('yesterday')) } }), { color: DUE, above: 0 })], activeTabId: 'tab-p-late', area: { col: 2, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: C.breakdown, tabs: [byPerson('tab-breakdown')], activeTabId: 'tab-breakdown', area: { col: 0, row: 1, colSpan: 3, rowSpan: 1 } },
        { id: C.trend, tabs: [{ id: 'tab-trend', kind: 'trend', config: { range: '4w' } }], activeTabId: 'tab-trend', area: { col: 0, row: 2, colSpan: 3, rowSpan: 1 } },
      ],
      createdAt: longAgo, modifiedAt: iso(at(-3, 11)), lastUsedAt: iso(at(-1, 16)),
    },
  ]

  const settings = [
    { key: 'activeLayoutId', value: String(README_IDS.layouts.today) },
    { key: 'eisenhowerSource', value: 'list:2' },
    { key: 'followupDefaultInterval', value: '1w' },
    { key: 'historyLogSince', value: longAgo },
    { key: 'seededAssignedStatusId', value: '1' },
    { key: 'themeMode', value: 'dark' },
    // A due date makes a task urgent only on the day (the app's default is 3 days): fewer dashed rings.
    { key: 'urgentDueWithinDays', value: '0' },
    { key: 'weekStartsOn', value: '1' },
  ]

  return {
    __schemaVersion: README_SCHEMA_VERSION,
    todos,
    people: PEOPLE.map((p, i) => ({ id: i + 1, name: p.name, initials: p.initials, color: p.color, email: `${p.name.split(' ')[0]!.toLowerCase()}@example.com` })),
    settings,
    todoPeople: withIds(todoPeople),
    statuses: STATUSES.map((s, i) => ({ id: i + 1, name: s.name, color: s.color, sortOrder: i, icon: s.icon })),
    listDefinitions,
    notes: [],
    tags: TAGS.map((t, i) => ({ id: i + 1, name: t.key, color: t.color })),
    todoTags: withIds(todoTags),
    todoEvents: withIds(events),
    statusUpdates: withIds(statusUpdates),
    subtasks: withIds(subtasks),
    layouts,
    listOrders: [],
    exportedAt: iso(exportedAt),
  }
}
