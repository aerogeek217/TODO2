/**
 * Dev seed — a realistic export in the **current** schema for manual testing.
 *
 * Run `npm run seed:dev` (see `generate-dev-seed.ts`), then load the file in
 * the dev server via Settings → Import / Export → Import JSON (it replaces
 * that browser's database).
 *
 * Dates are relative to the run day (overdue / today / this week / later /
 * none) so the seed stays meaningful whenever it is regenerated; everything
 * else comes from a fixed-seed PRNG, so two runs on the same day write the
 * same file.
 *
 * Covers: ~145 work-like tasks, each of five projects a `Project: <name>`
 * tag (plus a few loose tasks); 12 people, most with an email, and 4
 * `Org: <name>` people; 10 plain tags; the seeded Assigned / Follow-up
 * statuses plus Waiting and Parked; due dates incl. overdue + today, some
 * pushed out (deadline history); next follow-ups incl. overdue and today,
 * some followed up before; recurring tasks (one monthly on the month's last
 * day); Focus / Urgent / Important flags; completed tasks old and recent
 * with `completed` events, one with no event, one reopened (with the 30-day
 * retention setting the old ones trigger the purge prompt); notes and
 * progress; the global note; two layouts — Default (columns plus a
 * dashboard band) and Planning (a calendar band, lists, the Eisenhower, a
 * dashboard) — each owning its lists, with list prompts, an "is not"
 * filter, a descending sort, Hot / Focus markers and manual orders; the
 * Eisenhower's own list with one renamed pane; a check-in filter.
 *
 * Pure: no Node or DOM APIs, so the vitest suite can run it in memory. The
 * rows are typed by the app's models (type imports only — Node strips them),
 * so a model change shows up here at compile time; a schema step bumps
 * `__schemaVersion` with it (`dev-seed.test.ts` checks it is current).
 */

import type { TodoItem } from '../src/models/todo-item'
import type { Person } from '../src/models/person'
import type { Status } from '../src/models/status'
import type { Tag } from '../src/models/tag'
import type { Note } from '../src/models/note'
import type { TodoPerson } from '../src/models/todo-person'
import type { TodoTag } from '../src/models/todo-tag'
import type { TodoEvent } from '../src/models/todo-event'
import type { ListOrder } from '../src/models/list-order'
import type { RecurrenceType } from '../src/models/recurrence'
import type { ListDefinition } from '../src/models/list-definition'
import type { DateAnchor, DateMatch, TodoPredicate } from '../src/models/filter-predicate'
import type { TodoGroupBy, TodoSortBy } from '../src/models/todo-sort-group'
import type { DashboardTabConfig } from '../src/models/dashboard-config'
import type { EisenhowerPanes } from '../src/models/eisenhower-settings'
import type { LayoutBand, LayoutCell, LayoutColumn, LayoutTab, WorkspaceLayout } from '../src/models/workspace-layout'
import type { SettingKey } from '../src/data/setting-keys'

/** The schema the seed is written in (`CURRENT_DB_VERSION`; the test keeps them equal). */
export const DEV_SEED_SCHEMA_VERSION = 68

// ── Deterministic randomness ────────────────────────────────────────────

/** mulberry32 — tiny seeded PRNG (public domain). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PRNG_SEED = 0x7d02_5eed
/** A separate stream for task uids, so they don't shift the other choices. */
const UID_SEED = 0x0de7_5eed

interface Rng {
  next: () => number
  int: (min: number, max: number) => number
  chance: (p: number) => boolean
  pick: <T>(items: readonly T[]) => T
  pickN: <T>(items: readonly T[], n: number) => T[]
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed)
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)]
    if (item === undefined) throw new Error('pick from an empty list')
    return item
  }
  const pickN = <T>(items: readonly T[], n: number): T[] => {
    const pool = [...items]
    const out: T[] = []
    while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0] as T)
    return out
  }
  return { next, int, chance: (p) => next() < p, pick, pickN }
}

/** A version-4-shaped UUID from the seeded stream (the app mints `crypto.randomUUID()`). */
function seededUid(rng: Rng): string {
  const b = Array.from({ length: 16 }, () => rng.int(0, 255))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── Row types: the models as JSON (dates are ISO strings) ───────────────

type Json<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T

type TodoRow = Json<TodoItem>
type LayoutRow = Json<WorkspaceLayout>
type TabRow = Json<LayoutTab>
type CellRow = Json<LayoutCell>
type ColumnRow = Json<LayoutColumn>
type BandRow = Json<LayoutBand>
interface SettingRow {
  key: SettingKey | `color.${'dark' | 'light'}.${string}`
  value: string
}

// ── Entities ────────────────────────────────────────────────────────────

/** Name, initials, email domain (absent = no email), avatar color. */
const PEOPLE = {
  priya: ['Priya Shah', 'PS', 'example.com', '#4f8cff'],
  marcus: ['Marcus Chen', 'MC', 'example.com'],
  elena: ['Elena Rossi', 'ER', 'northwind.example'],
  david: ['David Okafor', 'DO', 'northwind.example'],
  sarah: ['Sarah Kim', 'SK', 'example.com', '#34c759'],
  tom: ['Tom Becker', 'TB', 'example.com', '#d4a017'],
  aisha: ['Aisha Rahman', 'AR', 'example.com'],
  jonas: ['Jonas Weber', 'JW', 'example.com'],
  laura: ['Laura Martinez', 'LM', 'example.com', '#d4a017'],
  kenji: ['Kenji Watanabe', 'KW', 'bluefield.example', '#2bb3a3'],
  nina: ['Nina Petrova', 'NP', undefined, '#2bb3a3'],
  sam: ['Sam Taylor', 'ST'],
} as const satisfies Record<string, readonly [string, string, (string | undefined)?, string?]>
type PersonKey = keyof typeof PEOPLE

/** Organisations, kept as `Org: <name>` people (a naming convention only). */
const ORGS = {
  northwind: { name: 'Northwind Logistics', initials: 'NL', color: '#e05050' },
  bluefield: { name: 'Bluefield Analytics', initials: 'BA', color: '#2bb3a3' },
  finance: { name: 'Finance Team', initials: 'FIN', color: '#d4a017' },
  halcyon: { name: 'Halcyon Legal', initials: 'HL' },
} as const satisfies Record<string, { name: string; initials: string; color?: string }>
type OrgKey = keyof typeof ORGS

const TAGS = {
  urgent: '#ff3b30',
  Q4: '#34c759',
  budget: '#f5a623',
  customer: '#4f8cff',
  hiring: '#a070e0',
  '1:1': '#5ac8fa',
  docs: '#8e8e93',
  security: '#ff9500',
  travel: '#30b0c7',
  'quick-win': '#64d2ff',
} as const
type TagKey = keyof typeof TAGS

/** Seeded Assigned / Follow-up + two custom statuses. */
const STATUSES = {
  assigned: { name: 'Assigned', color: '#537FE7', icon: 'person' },
  followup: { name: 'Follow-up', color: '#f5a623', icon: 'message-bubble' },
  waiting: { name: 'Waiting', color: '#a070e0', icon: 'clock' },
  parked: { name: 'Parked', color: '#8a8a8a', icon: 'snooze' },
} as const satisfies Record<string, Omit<Status, 'id' | 'sortOrder'>>
type StatusKey = keyof typeof STATUSES

const RECUR_DAYS: Record<RecurrenceType, number> = {
  daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365,
}

/** Earlier due dates a recurring task rolled over from (its deadline history). */
function rollovers(type: RecurrenceType): number {
  const days = RECUR_DAYS[type]
  return days <= 30 ? 2 : days <= 91 ? 1 : 0
}

// ── Tasks ───────────────────────────────────────────────────────────────

/**
 * Explicit task scenario. Day offsets are relative to the run day (negative =
 * past). A task with options uses exactly these; a bare title gets random
 * attributes from its project's affinities.
 */
interface TaskOpts {
  /** Due day. */
  due?: number
  /** Number of earlier due dates (the deadline was pushed out). */
  dueMoves?: number
  /** Due on the last day of this month (monthly `originalDayOfMonth`). */
  dueMonthEnd?: boolean
  /** Next follow-up day. */
  followup?: number
  /** Last followed up on this day (≤ 0). */
  followedUp?: number
  recur?: RecurrenceType
  status?: StatusKey
  people?: PersonKey[]
  orgs?: OrgKey[]
  tags?: TagKey[]
  urgent?: boolean
  important?: boolean
  notes?: string
  progress?: string
  /** Completed on this day (≤ 0), with a `completed` event. */
  done?: number
  /** Completed on this day with no event (a completion from before the history log). */
  legacyDone?: number
  /** Completed on day [0], reopened on day [1]; open now. */
  reopened?: [number, number]
  /** Created this many days ago (default: derived). */
  age?: number
}

type TaskDef = string | [string, TaskOpts]

interface ProjectDef {
  name: string
  color: string
  people: PersonKey[]
  orgs: OrgKey[]
  tags: TagKey[]
  tasks: TaskDef[]
}

const NOTES_POOL = [
  'Context in the thread from last Tuesday.',
  '- [ ] confirm owner\n- [ ] agree on date\n- [ ] send summary',
  'Blocked until the vendor answers. **Do not** chase before Thursday.',
  'Link: see the shared drive folder *Planning / Q4*.',
  'Keep it short — one page max.',
  'Questions:\n1. Who signs off?\n2. Is there budget left this quarter?',
]

const PROGRESS_POOL = ['first draft done', 'waiting on numbers', 'half way', 'outline agreed', '2 of 5 done']

const PROJECTS: ProjectDef[] = [
  {
    name: 'Platform Migration',
    color: '#4f8cff',
    people: ['marcus', 'sarah', 'kenji', 'nina', 'jonas'],
    orgs: ['bluefield'],
    tags: ['security', 'docs', 'urgent', 'quick-win'],
    tasks: [
      ['Draft cutover runbook for the billing service', {
        due: 6, followup: 2, people: ['marcus'], tags: ['docs'], status: 'followup', important: true,
        progress: 'steps 1–6 drafted',
        notes: '## Steps\n- Freeze writes\n- Snapshot the database\n- Flip DNS\n- Smoke test\n\nOwner: **Marcus**',
      }],
      ["Review Marcus's PR for the auth token refresh", { due: 0, people: ['marcus'], tags: ['security', 'urgent'], urgent: true }],
      'Schedule load test with Bluefield',
      ['Follow up with Kenji on data export format', { followup: -2, followedUp: -9, people: ['kenji'], orgs: ['bluefield'], status: 'waiting' }],
      'Decommission legacy reporting cron jobs',
      'Update architecture diagram after the queue change',
      'Email Nina the staging access checklist',
      'Confirm rollback window with ops',
      'Write post-migration monitoring dashboards',
      ['Review incident postmortem from the last dry run', { done: -2, people: ['sarah'], tags: ['docs'] }],
      'Get sign-off on the data retention policy',
      'Migrate feature flags to the new service',
      ['Book a room for the cutover war room', { done: -1, tags: ['quick-win'] }],
      'Pair with Sarah on the schema diff',
      'Triage open migration bugs',
      'Prepare go/no-go checklist',
      ['Send weekly migration status update', { recur: 'weekly', due: 4, tags: ['docs'] }],
      'Check TLS certificate expiry on the old cluster',
      ['Archive the old wiki pages', { done: -90, tags: ['docs'] }],
      ['Ask Bluefield for the revised SOW', { followup: 3, followedUp: -1, orgs: ['bluefield'], status: 'followup' }],
      'Verify backups restore cleanly in staging',
      'Document the new deploy pipeline',
      'Clean up unused IAM roles',
      'Review cost estimate for the new cluster',
      'Demo the migration dashboard at all-hands',
      'Retire the v1 API endpoints',
      ['Reply to security review questions', { due: -1, people: ['nina'], tags: ['security', 'urgent'], status: 'followup', urgent: true, important: true }],
      ['Plan the second dry run', { due: 9, dueMoves: 2, people: ['marcus', 'sarah'], important: true }],
    ],
  },
  {
    name: 'Q4 Planning & Budget',
    color: '#34c759',
    people: ['priya', 'laura', 'tom'],
    orgs: ['finance'],
    tags: ['budget', 'Q4', 'urgent'],
    tasks: [
      ['Submit Q4 budget draft to Finance', { due: 0, orgs: ['finance'], tags: ['budget', 'Q4', 'urgent'], status: 'followup', important: true, progress: 'waiting on numbers' }],
      ['Reconcile September vendor invoices', { due: -6, dueMoves: 1, people: ['laura'], tags: ['budget'], status: 'followup' }],
      'Review headcount plan with Priya',
      ['Prepare board deck: engineering section', { recur: 'quarterly', due: 25, people: ['priya'], tags: ['Q4'], important: true }],
      ['Collect team OKR drafts', { done: -5, tags: ['Q4'] }],
      ['Follow up on the unpaid Northwind invoice', {
        due: -10, followup: -1, followedUp: -6, orgs: ['northwind', 'finance'], tags: ['urgent', 'budget'], status: 'waiting', urgent: true,
        notes: 'Invoice #4471, net 30. Their AP contact changed in August.',
      }],
      'Update the forecast spreadsheet with October actuals',
      ['Submit monthly expense report', { recur: 'monthly', dueMonthEnd: true, tags: ['budget'] }],
      'Negotiate the analytics license renewal',
      'Approve training budget requests',
      'Review the software spend audit',
      'Send Q4 priorities email to the team',
      ['Draft 2027 planning assumptions', { followup: 35, people: ['priya'], tags: ['Q4'], important: true }],
      'Meet Laura about cost-center changes',
      'Check capex vs opex split for hardware',
      'Finalize the conference sponsorship decision',
      'Ask Tom for the updated cloud spend report',
      'Prepare the quarterly business review',
      ['Close out the Q3 accruals', { done: -40, people: ['laura'], orgs: ['finance'], tags: ['budget'] }],
      ['Read the finance policy update', { done: -55 }],
      'Respond to the procurement questionnaire',
      ['Renew the design tool seats', { recur: 'yearly', due: 40, tags: ['budget'] }],
      'Sanity-check the offsite budget',
      'Share the Q4 roadmap one-pager',
      'Review contractor rates for next year',
      'Draft the hiring budget justification',
      'Confirm the year-end freeze dates',
    ],
  },
  {
    name: 'Northwind Rollout',
    color: '#e05050',
    people: ['elena', 'david', 'aisha', 'sam'],
    orgs: ['northwind', 'halcyon'],
    tags: ['customer', 'urgent', 'docs', 'travel'],
    tasks: [
      ['Kickoff call with Northwind stakeholders', { done: -75, people: ['elena', 'david'], orgs: ['northwind'], tags: ['customer'] }],
      'Send Elena the integration timeline',
      "Review Northwind's SSO requirements",
      'Prepare the rollout training deck',
      ['Follow up with David on the pilot feedback', { followup: 8, followedUp: -2, people: ['david'], status: 'followup', tags: ['customer'] }],
      ['Fix the CSV import edge case they reported', { reopened: [-8, -6], due: 3, people: ['aisha'], orgs: ['northwind'], tags: ['customer'], urgent: true }],
      'Schedule the go-live readiness review',
      'Draft the customer success plan',
      'Confirm data residency requirements',
      ['Send the weekly Northwind status report', { recur: 'weekly', due: 3, orgs: ['northwind'], tags: ['customer'] }],
      'Collect sign-offs on the pilot results',
      'Update the shared project tracker',
      ["Answer Northwind's security questionnaire", { due: -3, orgs: ['northwind'], tags: ['security', 'customer'], status: 'assigned', people: ['sam'], urgent: true }],
      'Plan the phase 2 regional rollout',
      ['Book onsite visit to the Rotterdam warehouse', { followup: 12, tags: ['travel'], people: ['elena'] }],
      'Review the support escalation path',
      ['Get legal review of the Northwind DPA', { due: 14, orgs: ['halcyon'], status: 'waiting', tags: ['customer'] }],
      'Draft release notes for the pilot build',
      'Check in with Elena about user adoption',
      'Escalate the API rate-limit issue',
      'Prepare the executive sponsor update',
      'Map Northwind roles to our permission model',
      'Write the admin quick-start guide',
      'Close the pilot feedback survey',
      ['Send thank-you note to the pilot team', { done: -3, orgs: ['northwind'], tags: ['customer'] }],
      'Review contract renewal terms',
      'Hand off support runbook to customer success',
    ],
  },
  {
    name: 'Team & People',
    color: '#a070e0',
    people: ['aisha', 'jonas', 'marcus', 'sarah', 'priya'],
    orgs: [],
    tags: ['hiring', '1:1', 'docs'],
    tasks: [
      ['1:1 with Marcus', { recur: 'weekly', due: 2, people: ['marcus'], tags: ['1:1'], notes: '- migration workload\n- conference talk?\n- feedback on the runbook' }],
      ['1:1 with Sarah', { recur: 'biweekly', due: 9, people: ['sarah'], tags: ['1:1'] }],
      ["Write Aisha's performance review", { due: -4, people: ['aisha'], status: 'followup', progress: 'half way', important: true }],
      'Prepare interview loop for the senior backend role',
      "Review Jonas's promotion packet",
      'Schedule team retro',
      ['Plan the team offsite agenda', { followup: 9, tags: ['travel'] }],
      "Give feedback on Tom's design doc",
      'Onboarding checklist for the new hire',
      ['Phone screen: platform engineer candidate', { followup: 0, tags: ['hiring'] }],
      'Debrief with interviewers on the backend candidates',
      'Update the team on-call rotation',
      'Recognize the migration crew at all-hands',
      'Draft career ladder updates',
      'Send offer letter details to recruiting',
      'Book team dinner for the release',
      'Mentor session with Aisha',
      'Collect peer feedback for review cycle',
      'Reply to the internal transfer request',
      ['Order a welcome kit for the new hire', { done: 0, tags: ['hiring', 'quick-win'] }],
      'Set up shadowing for the support rotation',
      'Review the hiring scorecard template',
      'Talk to Jonas about his conference talk proposal',
      ['Plan learning-day topics', { status: 'parked' }],
      'Ask Priya about the reorg timeline',
      'Respond to engagement survey results',
      'Write job description for data engineer',
    ],
  },
  {
    name: 'Admin & Ops',
    color: '#f5a623',
    people: ['sam', 'tom', 'laura'],
    orgs: ['finance', 'halcyon'],
    tags: ['quick-win', 'travel', 'security', 'budget'],
    tasks: [
      ['Weekly metrics email', { recur: 'weekly', due: 1, tags: ['docs'] }],
      ['Renew the domain registration', { recur: 'yearly', due: 60 }],
      ['Submit timesheet', { recur: 'weekly', due: -2, tags: ['quick-win'] }],
      ['Clean up the shared drive', { followup: -12, status: 'parked' }],
      'Update the vendor contact list',
      ['Review access for departing contractors', { due: 5, tags: ['security'], people: ['sam'] }],
      'Audit shared service accounts',
      ['Book flights for the November offsite', { followup: 2, tags: ['travel'] }],
      'Renew the parking permit',
      'File the security training certificate',
      'Order replacement laptop for Sam',
      'Update the team calendar with holidays',
      "Archive last quarter's chat channels",
      ['Fix the broken link in the onboarding doc', { legacyDone: -50, tags: ['quick-win'] }],
      'Expense the conference tickets',
      ['Daily standup notes', { recur: 'daily', due: 0 }],
      'Check the printer contract renewal',
      'Respond to the IT asset inventory request',
      'Unsubscribe from noisy alert emails',
      "Back up the team's dashboards",
      ['Organize the team wiki sidebar', { followup: -15 }],
      'Review the office move plan',
      ['Request a new monitor', { followup: 0, tags: ['quick-win'] }],
      'Update the email signature with the new title',
      'Confirm the hotel booking for Berlin',
      'Submit the vendor onboarding form',
      'Cancel the unused SaaS trial',
    ],
  },
]

/** Tasks in no project. */
const LOOSE_TASKS: TaskDef[] = [
  'Call back the recruiter',
  ['Read the distributed systems book, chapter 8', { status: 'parked' }],
  ['Look into a new note-taking workflow', { followup: 1 }],
  ['Pick up dry cleaning', {}],
  ['Renew passport', { done: -120, due: -125 }],
  ['Think about a 2027 conference talk', { important: true }],
  ['Draft blog post on the migration lessons', { notes: 'Angle: what we would do differently.\n\n- dry runs\n- comms\n- rollback drills' }],
]

/** Titles in Focus, in the Focus list's manual order. */
const FOCUS_TITLES = [
  'Submit Q4 budget draft to Finance',
  "Review Marcus's PR for the auth token refresh",
  'Follow up on the unpaid Northwind invoice',
  'Reply to security review questions',
  'Daily standup notes',
  'Plan the second dry run',
]

/** Titles in the Someday list's manual order (open tasks with no due date). */
const SOMEDAY_ORDER = [
  'Draft blog post on the migration lessons',
  'Think about a 2027 conference talk',
  'Plan learning-day topics',
  'Pick up dry cleaning',
]

// ── Generation ──────────────────────────────────────────────────────────

export interface DevSeed {
  __schemaVersion: typeof DEV_SEED_SCHEMA_VERSION
  todos: TodoRow[]
  people: Person[]
  settings: SettingRow[]
  todoPeople: TodoPerson[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Json<Note>[]
  tags: Tag[]
  todoTags: TodoTag[]
  todoEvents: TodoEvent[]
  layouts: LayoutRow[]
  listOrders: ListOrder[]
  exportedAt: string
}

const personKeys = Object.keys(PEOPLE) as PersonKey[]
const orgKeys = Object.keys(ORGS) as OrgKey[]
const tagKeys = Object.keys(TAGS) as TagKey[]

/** Ids of the seed's named entities (stable across runs). */
export const DEV_SEED_IDS = {
  people: Object.fromEntries(personKeys.map((k, i) => [k, i + 1])) as Record<PersonKey, number>,
  /** The `Org: <name>` people, after the 12 people. */
  orgs: Object.fromEntries(orgKeys.map((k, i) => [k, personKeys.length + i + 1])) as Record<OrgKey, number>,
  tags: Object.fromEntries(tagKeys.map((k, i) => [k, i + 1])) as Record<TagKey, number>,
  /** The `Project: <name>` tags, after the plain tags, in project order. */
  projectTags: PROJECTS.map((_, i) => tagKeys.length + i + 1),
  statuses: Object.fromEntries(Object.keys(STATUSES).map((k, i) => [k, i + 1])) as Record<StatusKey, number>,
  lists: {
    thisWeek: 1, nextWeek: 2, restOfMonth: 3, later: 4, someday: 5,
    dueSoon: 6, followupsThisWeek: 7, northwind: 8, tasksFor: 9, byClient: 10,
    focus: 11, hot: 12, recentlyAdded: 13, eisenhower: 14,
  },
  layouts: { default: 1, planning: 2 },
}

const IDS = DEV_SEED_IDS

interface Spec {
  title: string
  /** Index into `PROJECTS`, or none. */
  project?: number
  opts: TaskOpts
  /** Creation timestamp (ms). */
  created: number
}

/**
 * Builds the export for `today` (only its local calendar day is used).
 */
export function generateDevSeed(today: Date = new Date()): DevSeed {
  const rng = makeRng(PRNG_SEED)
  const uidRng = makeRng(UID_SEED)
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  /** Local midnight `n` days from today. */
  const day = (n: number) => new Date(y, m, d + n)
  /** Local time on day `n`. */
  const at = (n: number, hh: number, mm = 0) => new Date(y, m, d + n, hh, mm)
  const iso = (dt: Date | number) => new Date(dt).toISOString()
  /** Export moment; "today" activity is kept before it. */
  const exportedAt = at(0, 8, 30)
  const nowMs = exportedAt.getTime()

  // ── Task specs (random attributes for bare titles) ──
  const specs: Spec[] = []
  const randomOpts = (p: ProjectDef | null): TaskOpts => {
    const o: TaskOpts = {}
    const people = p?.people ?? (['priya'] as PersonKey[])
    if (rng.chance(0.2)) {
      o.done = rng.chance(0.5) ? -rng.int(1, 25) : -rng.int(31, 110)
      if (rng.chance(0.4)) o.due = o.done - rng.int(0, 4)
    } else {
      const r = rng.next()
      if (r < 0.14) o.due = -rng.int(1, 14)
      else if (r < 0.2) o.due = 0
      else if (r < 0.45) o.due = rng.int(1, 14)
      else if (r < 0.57) o.due = rng.int(15, 75)
      if (o.due !== undefined && rng.chance(0.15)) o.dueMoves = rng.int(1, 2)
      if (rng.chance(0.55)) {
        o.followup = rng.int(-10, 21)
        if (rng.chance(0.3)) o.followedUp = -rng.int(1, 12)
      }
      const s = rng.next()
      if (s < 0.18) o.status = 'followup'
      else if (s < 0.32) o.status = 'waiting'
      else if (s < 0.44) o.status = 'assigned'
      else if (s < 0.5) o.status = 'parked'
      if (rng.chance(0.1)) o.urgent = true
      if (rng.chance(0.15)) o.important = true
    }
    const pr = rng.next()
    if (pr < 0.55) o.people = [rng.pick(people)]
    else if (pr < 0.7) o.people = rng.pickN(people, 2)
    if (o.status === 'assigned' && !o.people) o.people = [rng.pick(people)]
    if (p && p.orgs.length > 0 && rng.chance(0.22)) o.orgs = [rng.pick(p.orgs)]
    const tags = p?.tags ?? (['quick-win'] as TagKey[])
    const tr = rng.next()
    if (tr < 0.4) o.tags = rng.pickN(tags, 1)
    else if (tr < 0.55) o.tags = rng.pickN(tags, 2)
    else if (tr < 0.6) o.tags = rng.pickN(tags, 3)
    if (rng.chance(0.15)) o.notes = rng.pick(NOTES_POOL)
    if (o.done === undefined && rng.chance(0.07)) o.progress = rng.pick(PROGRESS_POOL)
    return o
  }

  /** Days ago the task must at least be, so every event fits after creation. */
  const minAge = (o: TaskOpts): number => {
    const past = [0]
    if (o.done !== undefined) past.push(-o.done + 2)
    if (o.legacyDone !== undefined) past.push(-o.legacyDone + 2)
    if (o.reopened) past.push(-o.reopened[0] + 2)
    if (o.due !== undefined && o.due < 0) past.push(-o.due + 3)
    if (o.followup !== undefined && o.followup < 0) past.push(-o.followup + 2)
    if (o.followedUp !== undefined) past.push(-o.followedUp + 2)
    if (o.dueMoves) past.push(o.dueMoves * 4 + 2)
    if (o.recur) past.push(RECUR_DAYS[o.recur] * rollovers(o.recur) + 3)
    return Math.max(...past)
  }

  const addSpecs = (defs: TaskDef[], project: number | undefined) => {
    const def = project !== undefined ? PROJECTS[project] ?? null : null
    for (const taskDef of defs) {
      const [title, explicit] = typeof taskDef === 'string' ? [taskDef, null] : taskDef
      const opts = explicit ?? randomOpts(def)
      const lo = minAge(opts)
      const age = opts.age ?? lo + (rng.chance(0.1) ? 0 : rng.int(0, 45))
      // Same-day creations land before the export moment.
      const created = age === 0
        ? at(0, 7, rng.int(0, 59)).getTime()
        : at(-age, rng.int(8, 17), rng.int(0, 59)).getTime()
      specs.push({ title, project, opts, created })
    }
  }
  PROJECTS.forEach((p, i) => addSpecs(p.tasks, i))
  addSpecs(LOOSE_TASKS, undefined)

  // Autoincrement ids follow creation time.
  specs.sort((a, b) => a.created - b.created)

  const todos: TodoRow[] = []
  const todoPeople: Omit<TodoPerson, 'id'>[] = []
  const todoTags: Omit<TodoTag, 'id'>[] = []
  const events: Omit<TodoEvent, 'id'>[] = []

  specs.forEach((spec, index) => {
    const id = index + 1
    const o = spec.opts
    const created = spec.created
    const completedMs = o.done !== undefined ? at(o.done, 16, rng.int(0, 59)).getTime()
      : o.legacyDone !== undefined ? at(o.legacyDone, 15, rng.int(0, 59)).getTime()
        : null
    // Same-day completions stay before the export moment.
    const endMs = completedMs !== null ? Math.min(completedMs, nowMs - 60_000) : nowMs
    // Whole minutes, like a person's edits.
    const between = (frac: number) => created + Math.floor(((endMs - created) * frac) / 60_000) * 60_000
    const ev = (type: TodoEvent['type'], ts: number, fromValue: string | number | null = null, toValue: string | number | null = null) => {
      events.push({ todoId: id, type, fromValue, toValue, timestamp: iso(ts) })
    }
    ev('created', created)

    // Due date (with earlier values when it was pushed out / rolled over).
    let due: Date | null = null
    if (o.dueMonthEnd) due = new Date(y, m + 1, 0)
    else if (o.due !== undefined) due = day(o.due)
    if (due) {
      const step = o.recur ? RECUR_DAYS[o.recur] : 0
      const moves = o.recur ? rollovers(o.recur) : (o.dueMoves ?? 0)
      // Earlier values: recurrence rollovers, or a deadline pushed out a few days at a time.
      const shifts = [0]
      for (let k = 0; k < moves; k++) shifts.unshift((shifts[0] ?? 0) - (step || rng.int(3, 7)))
      let prev: string | null = null
      shifts.forEach((shift, k) => {
        const value = iso(new Date(due.getFullYear(), due.getMonth(), due.getDate() + shift))
        ev('deadline', between((k + 0.5) / (moves + 2)), prev, value)
        prev = value
      })
    }

    // Followed up: an exact moment that day, after creation and before now.
    const lastFollowupMs = o.followedUp !== undefined
      ? Math.min(nowMs - 60_000, Math.max(created + 60_000, at(o.followedUp, rng.int(9, 17), rng.int(0, 59)).getTime()))
      : null

    if (o.status) {
      if (o.status === 'waiting' && rng.chance(0.5)) {
        ev('status', between(0.2), null, IDS.statuses.followup)
        ev('status', between(0.6), IDS.statuses.followup, IDS.statuses.waiting)
      } else {
        ev('status', between(0.3), null, IDS.statuses[o.status])
      }
    }
    if (o.reopened) {
      ev('completed', at(o.reopened[0], 17, 10).getTime())
      ev('reopened', at(o.reopened[1], 9, 40).getTime())
    }
    if (o.done !== undefined && completedMs !== null) ev('completed', endMs)

    const mine = events.filter((e) => e.todoId === id).map((e) => Date.parse(e.timestamp))
    const modified = Math.max(created, ...mine, completedMs !== null ? endMs : created, lastFollowupMs ?? created)

    const todo: TodoRow = {
      id,
      uid: seededUid(uidRng),
      title: spec.title,
      isCompleted: completedMs !== null,
      createdAt: iso(created),
      modifiedAt: iso(modified),
      sortOrder: index,
    }
    if (o.notes) todo.notes = o.notes
    if (o.progress) todo.progress = o.progress
    if (completedMs !== null) todo.completedAt = iso(endMs)
    if (due) todo.dueDate = iso(due)
    if (lastFollowupMs !== null) todo.lastFollowupAt = iso(lastFollowupMs)
    if (o.followup !== undefined && completedMs === null) todo.nextFollowupAt = iso(day(o.followup))
    if (o.recur) {
      todo.recurrenceRule = o.recur === 'monthly' && due && due.getDate() >= 29
        ? { type: 'monthly', originalDayOfMonth: due.getDate() }
        : { type: o.recur }
    }
    if (FOCUS_TITLES.includes(spec.title)) todo.focus = true
    if (o.urgent) todo.urgent = true
    if (o.important) todo.important = true
    if (o.status) todo.statusId = IDS.statuses[o.status]
    // Field order of the model (cosmetic — keeps diffs against real exports readable).
    todos.push(reorder(todo, ['id', 'uid', 'title', 'notes', 'progress', 'isCompleted', 'completedAt', 'dueDate',
      'lastFollowupAt', 'nextFollowupAt', 'recurrenceRule', 'focus', 'urgent', 'important', 'createdAt', 'modifiedAt',
      'statusId', 'sortOrder']))

    const personIds = new Set([...(o.people ?? []).map((p) => IDS.people[p]), ...(o.orgs ?? []).map((g) => IDS.orgs[g])])
    for (const personId of personIds) todoPeople.push({ todoId: id, personId })
    const tagIds = new Set((o.tags ?? []).map((t) => IDS.tags[t]))
    const projectTag = spec.project !== undefined ? IDS.projectTags[spec.project] : undefined
    if (projectTag !== undefined) tagIds.add(projectTag)
    for (const tagId of tagIds) todoTags.push({ todoId: id, tagId })
  })

  const idOf = (title: string): number => {
    const t = todos.find((r) => r.title === title)
    if (t?.id === undefined) throw new Error(`dev seed: no task titled "${title}"`)
    return t.id
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.todoId - b.todoId)
  const withIds = <T extends object>(rows: T[]): (T & { id: number })[] => rows.map((r, i) => ({ ...r, id: i + 1 }))

  // ── Entities ──
  const longAgo = iso(at(-200, 9))
  const people: Person[] = [
    ...personKeys.map((key, i): Person => {
      const [name, initials, domain, color] = PEOPLE[key] as readonly [string, string, string?, string?]
      const row: Person = { id: i + 1, name, initials }
      if (color) row.color = color
      if (domain) row.email = `${name.toLowerCase().replace(' ', '.')}@${domain}`
      return row
    }),
    ...orgKeys.map((key): Person => {
      const org: { name: string; initials: string; color?: string } = ORGS[key]
      const row: Person = { id: IDS.orgs[key], name: `Org: ${org.name}`, initials: org.initials }
      if (org.color) row.color = org.color
      return row
    }),
  ]
  const tags: Tag[] = [
    ...tagKeys.map((name, i) => ({ id: i + 1, name, color: TAGS[name] })),
    ...PROJECTS.map((p, i) => ({ id: IDS.projectTags[i] ?? 0, name: `Project: ${p.name}`, color: p.color })),
  ]
  const statuses: Status[] = Object.values(STATUSES).map((s, i) => ({ id: i + 1, name: s.name, color: s.color, sortOrder: i, icon: s.icon }))

  // ── List definitions ──
  const filter = (over: Partial<TodoPredicate> = {}): TodoPredicate => ({
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
    ...over,
  })
  const rel = (token: 'start-of-week' | 'end-of-week' | 'start-of-next-week' | 'end-of-next-week' | 'tomorrow'
    | 'end-of-month' | 'start-of-next-month' | 'end-of-month-plus-3') => ({ kind: 'relative', token }) as const
  const range = (start: DateAnchor | null, end: DateAnchor | null, includeNoDate = false): DateMatch =>
    includeNoDate ? { match: 'range', start, end, includeNoDate } : { match: 'range', start, end }
  const L = IDS.lists
  const layoutOwner = (layoutId: number) => ({ layoutId })
  const list = (
    id: number, name: string, predicate: TodoPredicate, sort: TodoSortBy, grouping: TodoGroupBy,
    owner: ListDefinition['owner'], extra: Partial<ListDefinition> = {},
  ): ListDefinition => ({ id, name, sortOrder: id - 1, membership: { kind: 'custom', predicate }, sort, ...extra, grouping, owner })
  const def = layoutOwner(IDS.layouts.default)
  const plan = layoutOwner(IDS.layouts.planning)
  const listDefinitions: ListDefinition[] = [
    list(L.thisWeek, 'This week', filter({ dates: { deadline: range(rel('start-of-week'), rel('end-of-week')) } }), 'deadline', 'none', def),
    list(L.nextWeek, 'Next week', filter({ dates: { deadline: range(rel('start-of-next-week'), rel('end-of-next-week')) } }), 'deadline', 'none', plan),
    list(L.restOfMonth, 'Rest of month', filter({ dates: { deadline: range(rel('tomorrow'), rel('end-of-month')) } }), 'deadline', 'none', plan),
    list(L.later, 'Later', filter({ dates: { deadline: range(rel('start-of-next-month'), rel('end-of-month-plus-3')) } }), 'deadline', 'deadline', plan),
    list(L.someday, 'Someday', filter({ dates: { deadline: { match: 'unset' } } }), 'manual', 'none', plan),
    list(L.dueSoon, 'Overdue & due soon', filter({ dates: { deadline: range(null, { kind: 'offset', days: 7 }) } }), 'deadline', 'tag', def),
    list(L.followupsThisWeek, 'Follow-ups this week',
      filter({ dates: { followup: range(null, rel('end-of-week')) } }), 'followup', 'people', plan),
    list(L.northwind, 'Northwind', filter({
      personIds: [IDS.orgs.northwind], tags: [IDS.projectTags[2] ?? 0],
      dates: { deadline: range({ kind: 'fixed', iso: iso(day(-60)) }, null, true) },
    }), 'deadline', 'people', plan),
    list(L.tasksFor, 'Tasks for…', filter({ statusIds: [IDS.statuses.assigned, IDS.statuses.followup, IDS.statuses.waiting] }),
      'deadline', 'status', def, { runtimeFilter: { field: 'person', label: 'Who' } }),
    list(L.byClient, 'By client', filter({
      personIds: [IDS.people.elena, IDS.people.david, 0], tags: [IDS.tags.customer, IDS.tags.urgent],
    }), 'people', 'people', def, { runtimeFilter: { field: 'person', label: 'Client' } }),
    list(L.focus, 'Focus', filter({ markers: { focus: true } }), 'manual', 'none', def),
    list(L.hot, 'Hot', filter({ markers: 'hot' }), 'priority', 'none', plan),
    list(L.recentlyAdded, 'Recently added', filter({
      statusIds: [IDS.statuses.parked], negate: { statusIds: true },
      dates: { created: range({ kind: 'offset', days: -14 }, null) },
    }), 'created', 'status', plan, { sortDirection: 'desc', showFilterLine: false }),
    list(L.eisenhower, 'Eisenhower', filter(), 'manual', 'none', { eisenhower: true }),
  ]

  // ── Layouts ──
  const lens = (id: string, listDefinitionId: number): TabRow => ({ id, kind: 'lens', config: { listDefinitionId } })
  const calendar = (id: string, view: 'week' | 'month', offset: number, followup = true): TabRow =>
    ({ id, kind: 'calendar', config: { dateTypes: { due: true, followup } }, viewState: { view, offset } })
  const notes = (id: string): TabRow => ({ id, kind: 'notes', config: {} })
  const dashboard = (id: string, config: DashboardTabConfig): TabRow => ({ id, kind: 'dashboard', config })
  const cell = (id: string, tabs: TabRow[], extra: Partial<CellRow> = {}): CellRow =>
    ({ id, weight: 1, tabs, activeTabId: tabs[0]?.id, ...extra })
  const column = (id: string, cells: CellRow[], weight = 1): ColumnRow => ({ id, weight, cells })
  const band = (id: string, height: number, tabs: TabRow[], extra: Partial<BandRow> = {}): BandRow =>
    ({ id, height, tabs, activeTabId: tabs[0]?.id, ...extra })

  const layouts: LayoutRow[] = [
    {
      id: IDS.layouts.default,
      name: 'Default',
      sortOrder: 0,
      columns: [
        column('col-focus', [
          cell('cell-focus', [lens('tab-who', L.tasksFor), lens('tab-week', L.thisWeek), notes('tab-notes')], { weight: 2 }),
          cell('cell-cal', [calendar('tab-cal', 'week', 0)]),
        ], 1.4),
        column('col-client', [cell('cell-client', [lens('tab-client', L.byClient)])]),
        column('col-board', [
          cell('cell-board', [lens('tab-board', L.focus), { id: 'tab-matrix', kind: 'eisenhower', config: {} }]),
          cell('cell-soon', [lens('tab-soon', L.dueSoon)], { collapsed: true }),
        ]),
      ],
      bottom: band('band-dash', 260, [dashboard('tab-dash', {
        tiles: ['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue'],
        listTiles: [L.focus, L.dueSoon],
        sections: [{ id: 'hot' }, { id: 'followup' }, { id: 'next7' }, { id: 'trend', options: { range: '4w' } }, { id: 'status' }, { id: 'people' }],
      })]),
      createdAt: longAgo,
      modifiedAt: iso(at(-3, 17, 20)),
      lastUsedAt: iso(at(0, 8, 0)),
    },
    {
      id: IDS.layouts.planning,
      name: 'Planning',
      sortOrder: 1,
      top: band('band-cal', 220, [calendar('tab-month', 'month', 0, false)]),
      columns: [
        column('col-horizon', [
          cell('cell-horizon', [lens('tab-next', L.nextWeek), lens('tab-rest', L.restOfMonth), lens('tab-later', L.later)], { activeTabId: 'tab-rest' }),
          cell('cell-someday', [lens('tab-someday', L.someday)]),
        ]),
        column('col-people', [
          cell('cell-followups', [lens('tab-followups', L.followupsThisWeek)], { weight: 2 }),
          cell('cell-northwind', [lens('tab-northwind', L.northwind)]),
        ]),
        column('col-matrix', [
          cell('cell-matrix', [{ id: 'tab-matrix2', kind: 'eisenhower', config: {}, viewState: { collapsed: ['drop'] } }]),
          cell('cell-stats', [
            dashboard('tab-stats', {
              tiles: ['open', 'hot', 'overdue', 'followupDue', 'dueToday', 'dueNext7'],
              listTiles: [L.hot],
              sections: [{ id: 'eisenhower' }, { id: 'tags', options: { showUntagged: false } }, { id: 'stale', options: { staleDays: 30 } }, { id: 'recent', options: { recentDays: 14 } }],
            }),
            lens('tab-hot', L.hot),
            lens('tab-recent', L.recentlyAdded),
          ]),
        ], 1.2),
      ],
      createdAt: iso(at(-60, 10)),
      modifiedAt: iso(at(-8, 16, 45)),
      lastUsedAt: iso(at(-1, 14, 10)),
    },
  ]

  // ── Manual orders ──
  const listOrders: ListOrder[] = withIds([
    ...FOCUS_TITLES.map((t, i) => ({ listDefinitionId: L.focus, todoId: idOf(t), rank: i + 1 })),
    ...SOMEDAY_ORDER.map((t, i) => ({ listDefinitionId: L.someday, todoId: idOf(t), rank: i + 1 })),
  ])

  // ── Settings ──
  const checkinFilter = filter({ statusIds: [IDS.statuses.parked], negate: { statusIds: true } })
  const panes: EisenhowerPanes = { delegate: { name: 'Hand off' } }
  const settings: SettingRow[] = ([
    { key: 'activeLayoutId', value: String(IDS.layouts.default) },
    { key: 'checkinOpenMethod', value: 'mailto' },
    { key: 'checkinTaskFilter', value: JSON.stringify(checkinFilter) },
    { key: 'color.dark.accent', value: '#4f8cff' },
    { key: 'color.dark.appBg', value: '#111110' },
    { key: 'color.light.appBg', value: '#f5f4f2' },
    { key: 'completedRetentionDays', value: '30' },
    { key: 'eisenhowerPanes', value: JSON.stringify(panes) },
    { key: 'eisenhowerSource', value: `list:${L.eisenhower}` },
    { key: 'followupDefaultInterval', value: '1w' },
    { key: 'quickStatusId', value: String(IDS.statuses.followup) },
    { key: 'seededAssignedStatusId', value: String(IDS.statuses.assigned) },
    { key: 'themeMode', value: 'dark' },
    { key: 'urgentDueWithinDays', value: '2' },
    { key: 'weekStartsOn', value: '1' },
  ] satisfies SettingRow[]).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return {
    __schemaVersion: DEV_SEED_SCHEMA_VERSION,
    todos,
    people,
    settings,
    todoPeople: withIds(todoPeople),
    statuses,
    listDefinitions,
    notes: [{
      id: 1,
      content: '# Scratch\n\n- Ask Priya about Q4 headcount before Thursday\n- Northwind wants the SSO doc by end of month\n- Idea: rollback drill before the second dry run\n- Book dentist',
      createdAt: longAgo,
      modifiedAt: iso(at(-1, 18, 5)),
    }],
    tags,
    todoTags: withIds(todoTags),
    todoEvents: withIds(events),
    layouts,
    listOrders,
    exportedAt: iso(exportedAt),
  }
}

/** `row` with its keys in `order` (keys not listed are dropped; absent ones stay absent). */
function reorder<T extends object>(row: T, order: readonly (keyof T)[]): T {
  const out: Partial<T> = {}
  for (const k of order) if (k in row) out[k] = row[k]
  return out as T
}
