// The dashboard design's sample workspace, as data: today Sat 10 Oct 2026,
// urgent range 3 days, the default Hot rule, weeks starting Sunday. 19 open
// tasks + 14 completed ones, with the created / completed / reopened history
// of the last 14 days (27 Sep … 10 Oct). The design's numbers (Open 19, Hot
// 4, Urgent 8 = 3 flagged + 5 by date, Overdue 2, Follow-up due 2, Focus 3,
// statuses 11 / 5 / 2 / 1, trend 17 created / 14 completed, …) follow from it.
import type { PersistedTodoItem, Person, Status, Tag, TodoEvent, TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { DEFAULT_HOT_RULE } from '../../utils/hot'
import type { StatsContext } from '../../services/stats/stats-context'

/** Sat 10 Oct 2026, local midnight. */
export const SAMPLE_TODAY = new Date(2026, 9, 10)

/** Local midnight of day `n` of the 14-day window (0 = Sun 27 Sep, 13 = today). */
export function windowDay(n: number, hour = 0, minute = 0): Date {
  return new Date(2026, 8, 27 + n, hour, minute)
}

const oct = (day: number) => new Date(2026, 9, day)

export const PEOPLE: Array<Person & { id: number }> = [
  { id: 1, name: 'Dana Kim', initials: 'DK' },
  { id: 2, name: 'Sam Lee', initials: 'SL' },
  { id: 3, name: 'Ben Ortiz', initials: 'BO' },
  { id: 4, name: 'Priya Nair', initials: 'PN', color: '#8fb3e8' },
  { id: 5, name: 'Alice Chen', initials: 'AC', color: '#e8a25c' },
]
export const DANA = 1, SAM = 2, BEN = 3, PRIYA = 4, ALICE = 5

export const STATUSES: Array<Status & { id: number }> = [
  { id: 1, name: 'To do', color: '#888', sortOrder: 1, icon: 'circle' },
  { id: 2, name: 'In progress', color: '#5b8', sortOrder: 2 },
  { id: 3, name: 'Waiting', color: '#db5', sortOrder: 3 },
  { id: 4, name: 'Blocked', color: '#d55', sortOrder: 4 },
]
const TODO = 1, DOING = 2, WAITING = 3, BLOCKED = 4

export const TAGS: Array<Tag & { id: number }> = [
  { id: 1, name: 'q4', color: '#999' },
  { id: 2, name: 'planning', color: '#999' },
  { id: 3, name: 'home', color: '#999' },
  { id: 4, name: 'errands', color: '#999' },
]
export const Q4 = 1, PLANNING = 2, HOME = 3, ERRANDS = 4

interface SampleTask {
  id: number
  title: string
  /** Window day it was created (see `windowDay`); `null` = before the window (1 Sep). */
  created: number | null
  /** Window day it was completed; absent = open. */
  completed?: number
  status: number
  people?: number[]
  tags?: number[]
  due?: Date
  followup?: Date
  urgent?: true
  important?: true
  focus?: true
}

const SAMPLE: SampleTask[] = [
  // Open (19)
  { id: 1, title: 'Fix checkout outage', created: 13, status: DOING, people: [DANA], due: oct(10), urgent: true, important: true, focus: true },
  { id: 2, title: 'Headcount request', created: 10, status: DOING, people: [SAM], due: oct(10), urgent: true, important: true },
  { id: 3, title: 'Draft homepage copy', created: 10, status: DOING, people: [PRIYA], tags: [PLANNING], due: oct(10), important: true, focus: true },
  { id: 4, title: 'Book venue for offsite', created: 1, status: TODO, tags: [Q4], followup: oct(15), important: true, focus: true },
  { id: 5, title: 'Review analytics dashboard', created: 1, status: TODO, people: [BEN], due: oct(7), urgent: true },
  { id: 6, title: 'Call plumber about water heater', created: 0, status: BLOCKED, tags: [HOME], due: oct(8) },
  { id: 7, title: 'Budget review with finance', created: 3, status: TODO, tags: [Q4], due: oct(11) },
  { id: 8, title: 'Sign off on new logo', created: 3, status: TODO, people: [ALICE], due: oct(15), followup: oct(13) },
  { id: 9, title: 'Chase venue deposit invoice', created: 5, status: WAITING, people: [DANA], followup: oct(10) },
  { id: 10, title: 'Vendor contract', created: 3, status: WAITING, followup: oct(9) },
  { id: 11, title: 'Vendor contract redlines', created: 4, status: TODO, people: [PRIYA], followup: oct(12) },
  { id: 12, title: '1:1 with Ben', created: 9, status: TODO, people: [BEN], due: oct(12) },
  { id: 13, title: 'Pick up prescriptions', created: 11, status: TODO, tags: [ERRANDS], due: oct(13) },
  { id: 14, title: 'Q4 roadmap deck', created: 8, status: DOING, people: [PRIYA], tags: [Q4], due: oct(14) },
  { id: 15, title: 'Q4 forecast', created: 10, status: DOING, people: [PRIYA], tags: [Q4], due: oct(15) },
  { id: 16, title: 'Brand guidelines review', created: 8, status: TODO, people: [ALICE], due: oct(15) },
  { id: 17, title: 'Offsite agenda', created: null, status: TODO, tags: [Q4] },
  { id: 18, title: 'Buy printer ink', created: 5, status: TODO, tags: [ERRANDS] },
  { id: 19, title: 'Clean up shared drive', created: null, status: TODO },
  // Completed (14), all created before the window. Their markers, dates and
  // people must never count anywhere but in the trend.
  { id: 101, title: 'Q4 kickoff notes', created: null, completed: 3, status: DOING, tags: [Q4], due: oct(1), urgent: true, important: true, focus: true },
  { id: 102, title: 'Q4 hiring plan', created: null, completed: 5, status: TODO, tags: [Q4], followup: oct(5) },
  { id: 103, title: 'Q4 OKR draft', created: null, completed: 9, status: TODO, tags: [Q4] },
  { id: 104, title: 'Send invoice', created: null, completed: 1, status: TODO, people: [DANA], followup: oct(9) },
  { id: 105, title: 'Renew domain', created: null, completed: 2, status: TODO, due: oct(10), urgent: true },
  { id: 106, title: 'Expense report', created: null, completed: 3, status: TODO },
  { id: 107, title: 'Update README', created: null, completed: 4, status: TODO },
  { id: 108, title: 'Return library books', created: null, completed: 4, status: TODO, tags: [ERRANDS] },
  { id: 109, title: 'Team lunch booking', created: null, completed: 7, status: TODO, people: [PRIYA] },
  { id: 110, title: 'Fix login bug', created: null, completed: 8, status: WAITING },
  { id: 111, title: 'Car service', created: null, completed: 9, status: TODO },
  { id: 112, title: 'Interview debrief', created: null, completed: 10, status: TODO, focus: true },
  { id: 113, title: 'Order team swag', created: null, completed: 12, status: TODO },
  { id: 114, title: 'Ship release notes', created: null, completed: 13, status: TODO, people: [SAM] },
]

const BEFORE_WINDOW = new Date(2026, 8, 1, 9)

export const SAMPLE_TASKS: PersistedTodoItem[] = SAMPLE.map((s) => {
  const createdAt = s.created == null ? BEFORE_WINDOW : windowDay(s.created, 9)
  const completedAt = s.completed == null ? undefined : windowDay(s.completed, 17)
  return {
    id: s.id,
    uid: `sample-${s.id}`,
    title: s.title,
    isCompleted: s.completed != null,
    ...(completedAt ? { completedAt } : {}),
    createdAt,
    modifiedAt: completedAt ?? createdAt,
    statusId: s.status,
    sortOrder: s.id,
    ...(s.due ? { dueDate: s.due } : {}),
    ...(s.followup ? { nextFollowupAt: s.followup } : {}),
    ...(s.urgent ? { urgent: true } : {}),
    ...(s.important ? { important: true } : {}),
    ...(s.focus ? { focus: true } : {}),
  }
})

export const SAMPLE_OPEN_COUNT = 19

export const ASSIGNED_PEOPLE = new Map<number, Person[]>(
  SAMPLE.filter((s) => s.people).map((s) => [s.id, (s.people ?? []).map((id) => PEOPLE.find((p) => p.id === id)!)]),
)
export const ASSIGNED_TAGS = new Map<number, Tag[]>(
  SAMPLE.filter((s) => s.tags).map((s) => [s.id, (s.tags ?? []).map((id) => TAGS.find((t) => t.id === id)!)]),
)

/**
 * The history: one `created` per task (1 Sep for tasks from before the
 * window), one `completed` per completed task, plus "Chase venue deposit
 * invoice" completed by mistake and reopened the same afternoon (no net
 * change).
 */
export const SAMPLE_EVENTS: TodoEvent[] = (() => {
  const out: Omit<TodoEvent, 'id'>[] = []
  const ev = (todoId: number, type: TodoEvent['type'], at: Date) =>
    out.push({ todoId, type, fromValue: null, toValue: null, timestamp: at.toISOString() })
  for (const s of SAMPLE) {
    ev(s.id, 'created', s.created == null ? BEFORE_WINDOW : windowDay(s.created, 9))
    if (s.completed != null) ev(s.id, 'completed', windowDay(s.completed, 17))
  }
  ev(9, 'completed', windowDay(9, 14))
  ev(9, 'reopened', windowDay(9, 15))
  return out.map((e, i) => ({ ...e, id: i + 1 }))
})()

/** Per-day created / completed bars and open series the design draws (27 Sep … 10 Oct). */
export const DESIGN_TREND = {
  created: [1, 2, 0, 3, 1, 2, 0, 0, 2, 1, 3, 1, 0, 1],
  completed: [0, 1, 1, 2, 2, 1, 0, 1, 1, 2, 1, 0, 1, 1],
  open: [17, 18, 17, 18, 17, 18, 18, 17, 18, 17, 19, 20, 19, 19],
}

/** The same with the top-bar Tags filter `q4`. */
export const DESIGN_TREND_Q4 = {
  created: [0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
  completed: [0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
  open: [4, 5, 5, 5, 5, 4, 4, 4, 5, 4, 5, 5, 5, 5],
}

export const SAMPLE_CTX: StatsContext = {
  today: SAMPLE_TODAY,
  weekStartsOn: 0,
  urgentRange: 3,
  hotRule: DEFAULT_HOT_RULE,
  assignedPeopleMap: ASSIGNED_PEOPLE,
  statuses: STATUSES,
}

const EMPTY_PREDICATE: TodoPredicate = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'deadline',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasDeadline: null,
  hasFollowup: null,
  markers: null,
  tags: null,
}

function list(id: number, name: string, predicate: Partial<TodoPredicate>, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id,
    name,
    sortOrder: id,
    membership: { kind: 'custom', predicate: { ...EMPTY_PREDICATE, ...predicate } },
    sort: 'deadline',
    grouping: 'none',
    pinnedToDashboard: true,
    ...extra,
  }
}

/** The design's list tiles, plus a list with a prompt (never a tile). */
export const SAMPLE_LISTS: PersistedListDefinition[] = [
  list(1, 'Waiting on', { statusIds: [WAITING] }),
  list(2, 'Priya 1:1 agenda', { personIds: [PRIYA] }),
  list(3, '#q4 planning', { tags: [Q4] }),
  list(4, 'Errands', { tags: [ERRANDS] }),
  list(5, 'Tasks for…', {}, { runtimeFilter: { field: 'person' } }),
]
