/**
 * Dev seed — a production-shaped **v49** export for manual testing.
 *
 * Run `npm run seed:dev` (see `generate-dev-seed.ts`), then load the file in
 * the dev server via Settings → Import JSON. v49 is the schema production
 * runs, so the import walks the whole upgrade pipeline (v49 → current) the
 * way a real user's backup would.
 *
 * Dates are relative to the run day (overdue / today / this week / later /
 * none) so the seed stays meaningful whenever it is regenerated; everything
 * else comes from a fixed-seed PRNG, so two runs on the same day write the
 * same file.
 *
 * Covers: ~145 work-like tasks across 5 projects on one canvas (plus a few
 * with no project); 12 people; 4 orgs with person memberships and org
 * assignments (→ v55 org→person merge); 10 tags; the seeded Assigned /
 * Follow-up statuses plus Waiting and a hidden-by-default Parked (→ v54);
 * due dates incl. overdue + today; precise and fuzzy (incl. aged) scheduled
 * dates, some snoozed repeatedly (→ v53 scheduled → next follow-up);
 * recurring tasks incl. one anchored only on a scheduled date (→ v53 due-date
 * anchor); completed tasks old and recent with `completed` events, one with
 * no event, one reopened (→ v51 completedAt backfill; with the 30-day
 * retention setting the old ones trigger the purge prompt); notes and
 * progress; the global note; taskboard entries; the 5 horizon lists plus
 * custom lists using Effective date / Scheduled / Has scheduled / org filters
 * / person and org runtime prompts (→ v53/v55 predicate rewrites); a rails
 * layout with multi-tab slots incl. horizons / scoreboard / snooze tabs and
 * floating widgets of every v49 kind (→ v52 drops, v56 Default layout).
 *
 * Pure: no Node or DOM APIs, so the vitest suite can run it in memory.
 * Self-contained on purpose — the v49 shape is frozen, so nothing here may
 * follow later model changes.
 */

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

// ── Entities ────────────────────────────────────────────────────────────

const PEOPLE = {
  priya: ['Priya Shah', 'PS'],
  marcus: ['Marcus Chen', 'MC'],
  elena: ['Elena Rossi', 'ER'],
  david: ['David Okafor', 'DO'],
  sarah: ['Sarah Kim', 'SK'],
  tom: ['Tom Becker', 'TB'],
  aisha: ['Aisha Rahman', 'AR'],
  jonas: ['Jonas Weber', 'JW'],
  laura: ['Laura Martinez', 'LM'],
  kenji: ['Kenji Watanabe', 'KW'],
  nina: ['Nina Petrova', 'NP'],
  sam: ['Sam Taylor', 'ST'],
} as const
type PersonKey = keyof typeof PEOPLE

/** `initials` / `color` optional on purpose: v55 generates / backfills them. */
const ORGS = {
  northwind: { name: 'Northwind Logistics', initials: 'NL', color: '#e05050' },
  bluefield: { name: 'Bluefield Analytics', initials: 'BA', color: '#2bb3a3' },
  finance: { name: 'Finance Team', initials: 'FIN', color: '#d4a017' },
  halcyon: { name: 'Halcyon Legal' },
} as const satisfies Record<string, { name: string; initials?: string; color?: string }>
type OrgKey = keyof typeof ORGS

/** Membership order matters to v55: Laura takes Finance's color (her first colored org). */
const MEMBERSHIPS: ReadonlyArray<[PersonKey, OrgKey]> = [
  ['elena', 'northwind'],
  ['david', 'northwind'],
  ['kenji', 'bluefield'],
  ['nina', 'bluefield'],
  ['laura', 'finance'],
  ['laura', 'halcyon'],
  ['tom', 'finance'],
  ['sam', 'halcyon'],
]

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

/** Seeded Assigned / Follow-up (as v49 seeded them) + two custom statuses. */
const STATUSES = {
  assigned: { name: 'Assigned', color: '#537FE7', icon: 'person', hideByDefault: true },
  followup: { name: 'Follow-up', color: '#f5a623', icon: 'message-bubble', hideByDefault: false },
  waiting: { name: 'Waiting', color: '#a070e0', icon: 'clock', hideByDefault: false },
  parked: { name: 'Parked', color: '#8a8a8a', icon: 'snooze', hideByDefault: true },
} as const
type StatusKey = keyof typeof STATUSES

type FuzzyToken = 'today' | 'tomorrow' | 'this-week' | 'next-week' | 'this-month' | 'next-month'
type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

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
  /** Due (deadline) day. */
  due?: number
  /** Number of earlier deadline values (the deadline was pushed out). */
  dueMoves?: number
  /** `'month-end'`: due on the last day of this month (monthly `originalDayOfMonth`). */
  dueMonthEnd?: boolean
  /** Precise scheduled day. */
  sched?: number
  /** Number of earlier scheduled values (snoozes) before the current one. */
  snoozes?: number
  /** Fuzzy scheduled token + the day it was picked (≤ 0). */
  fuzzy?: [FuzzyToken, number]
  recur?: RecurrenceType
  status?: StatusKey
  people?: PersonKey[]
  orgs?: OrgKey[]
  tags?: TagKey[]
  notes?: string
  progress?: string
  /** Completed on this day (≤ 0), with a `completed` event. */
  done?: number
  /** Completed on this day with no event (pre-history completion). */
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
  groupBy: string | null
  groupOrder?: string[]
  width?: number
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
    groupBy: 'status',
    groupOrder: ['status:2', 'status:3', 'status:1'],
    width: 380,
    people: ['marcus', 'sarah', 'kenji', 'nina', 'jonas'],
    orgs: ['bluefield'],
    tags: ['security', 'docs', 'urgent', 'quick-win'],
    tasks: [
      ['Draft cutover runbook for the billing service', {
        due: 6, sched: 2, people: ['marcus'], tags: ['docs'], status: 'followup',
        progress: 'steps 1–6 drafted',
        notes: '## Steps\n- Freeze writes\n- Snapshot the database\n- Flip DNS\n- Smoke test\n\nOwner: **Marcus**',
      }],
      ["Review Marcus's PR for the auth token refresh", { due: 0, people: ['marcus'], tags: ['security', 'urgent'] }],
      'Schedule load test with Bluefield',
      ['Follow up with Kenji on data export format', { sched: -2, snoozes: 2, people: ['kenji'], orgs: ['bluefield'], status: 'waiting' }],
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
      ['Ask Bluefield for the revised SOW', { fuzzy: ['this-week', -1], orgs: ['bluefield'], status: 'followup' }],
      'Verify backups restore cleanly in staging',
      'Document the new deploy pipeline',
      'Clean up unused IAM roles',
      'Review cost estimate for the new cluster',
      'Demo the migration dashboard at all-hands',
      'Retire the v1 API endpoints',
      ['Reply to security review questions', { due: -1, people: ['nina'], tags: ['security', 'urgent'], status: 'followup' }],
      ['Plan the second dry run', { due: 9, dueMoves: 2, people: ['marcus', 'sarah'] }],
    ],
  },
  {
    name: 'Q4 Planning & Budget',
    color: '#34c759',
    groupBy: 'date',
    people: ['priya', 'laura', 'tom'],
    orgs: ['finance'],
    tags: ['budget', 'Q4', 'urgent'],
    tasks: [
      ['Submit Q4 budget draft to Finance', { due: 0, orgs: ['finance'], tags: ['budget', 'Q4', 'urgent'], status: 'followup', progress: 'waiting on numbers' }],
      ['Reconcile September vendor invoices', { due: -6, dueMoves: 1, people: ['laura'], tags: ['budget'], status: 'followup' }],
      'Review headcount plan with Priya',
      ['Prepare board deck: engineering section', { recur: 'quarterly', due: 25, people: ['priya'], tags: ['Q4'] }],
      ['Collect team OKR drafts', { done: -5, tags: ['Q4'] }],
      ['Follow up on the unpaid Northwind invoice', {
        due: -10, sched: -1, snoozes: 5, orgs: ['northwind', 'finance'], tags: ['urgent', 'budget'], status: 'waiting',
        notes: 'Invoice #4471, net 30. Their AP contact changed in August.',
      }],
      'Update the forecast spreadsheet with October actuals',
      ['Submit monthly expense report', { recur: 'monthly', dueMonthEnd: true, tags: ['budget'] }],
      'Negotiate the analytics license renewal',
      'Approve training budget requests',
      'Review the software spend audit',
      'Send Q4 priorities email to the team',
      ['Draft 2027 planning assumptions', { fuzzy: ['next-month', -5], people: ['priya'], tags: ['Q4'] }],
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
    groupBy: 'org',
    people: ['elena', 'david', 'aisha', 'sam'],
    orgs: ['northwind', 'halcyon'],
    tags: ['customer', 'urgent', 'docs', 'travel'],
    tasks: [
      ['Kickoff call with Northwind stakeholders', { done: -75, people: ['elena', 'david'], orgs: ['northwind'], tags: ['customer'] }],
      'Send Elena the integration timeline',
      "Review Northwind's SSO requirements",
      'Prepare the rollout training deck',
      ['Follow up with David on the pilot feedback', { fuzzy: ['next-week', -2], people: ['david'], status: 'followup', tags: ['customer'] }],
      ['Fix the CSV import edge case they reported', { reopened: [-8, -6], due: 3, people: ['aisha'], orgs: ['northwind'], tags: ['customer'] }],
      'Schedule the go-live readiness review',
      'Draft the customer success plan',
      'Confirm data residency requirements',
      ['Send the weekly Northwind status report', { recur: 'weekly', due: 3, orgs: ['northwind'], tags: ['customer'] }],
      'Collect sign-offs on the pilot results',
      'Update the shared project tracker',
      ["Answer Northwind's security questionnaire", { due: -3, orgs: ['northwind'], tags: ['security', 'customer'], status: 'assigned', people: ['sam'] }],
      'Plan the phase 2 regional rollout',
      ['Book onsite visit to the Rotterdam warehouse', { sched: 12, tags: ['travel'], people: ['elena'] }],
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
    groupBy: 'people',
    people: ['aisha', 'jonas', 'marcus', 'sarah', 'priya'],
    orgs: [],
    tags: ['hiring', '1:1', 'docs'],
    tasks: [
      ['1:1 with Marcus', { recur: 'weekly', due: 2, people: ['marcus'], tags: ['1:1'], notes: '- migration workload\n- conference talk?\n- feedback on the runbook' }],
      ['1:1 with Sarah', { recur: 'biweekly', due: 9, people: ['sarah'], tags: ['1:1'] }],
      ["Write Aisha's performance review", { due: -4, people: ['aisha'], status: 'followup', progress: 'half way' }],
      'Prepare interview loop for the senior backend role',
      "Review Jonas's promotion packet",
      'Schedule team retro',
      ['Plan the team offsite agenda', { fuzzy: ['next-week', -2], tags: ['travel'] }],
      "Give feedback on Tom's design doc",
      'Onboarding checklist for the new hire',
      ['Phone screen: platform engineer candidate', { sched: 0, tags: ['hiring'] }],
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
    groupBy: 'scheduled',
    people: ['sam', 'tom', 'laura'],
    orgs: ['finance', 'halcyon'],
    tags: ['quick-win', 'travel', 'security', 'budget'],
    tasks: [
      // Recurring, anchored only on a precise scheduled date (no due date).
      ['Weekly metrics email', { recur: 'weekly', sched: 1, tags: ['docs'] }],
      ['Renew the domain registration', { recur: 'yearly', due: 60 }],
      ['Submit timesheet', { recur: 'weekly', due: -2, tags: ['quick-win'] }],
      ['Clean up the shared drive', { fuzzy: ['this-month', -30], status: 'parked' }],
      'Update the vendor contact list',
      ['Review access for departing contractors', { due: 5, tags: ['security'], people: ['sam'] }],
      'Audit shared service accounts',
      ['Book flights for the November offsite', { fuzzy: ['this-week', -1], tags: ['travel'] }],
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
      ['Organize the team wiki sidebar', { fuzzy: ['this-week', -21] }],
      'Review the office move plan',
      ['Request a new monitor', { fuzzy: ['today', 0], tags: ['quick-win'] }],
      'Update the email signature with the new title',
      'Confirm the hotel booking for Berlin',
      'Submit the vendor onboarding form',
      'Cancel the unused SaaS trial',
    ],
  },
]

/** Tasks with no project (and no canvas). */
const LOOSE_TASKS: TaskDef[] = [
  'Call back the recruiter',
  ['Read the distributed systems book, chapter 8', { status: 'parked' }],
  ['Look into a new note-taking workflow', { fuzzy: ['tomorrow', 0] }],
  'Pick up dry cleaning',
  ['Renew passport', { done: -120, due: -125 }],
  'Think about a 2027 conference talk',
  ['Draft blog post on the migration lessons', { notes: 'Angle: what we would do differently.\n\n- dry runs\n- comms\n- rollback drills' }],
]

/** Titles on the taskboard, in board order. */
const TASKBOARD_TITLES = [
  'Submit Q4 budget draft to Finance',
  "Review Marcus's PR for the auth token refresh",
  'Follow up on the unpaid Northwind invoice',
  'Reply to security review questions',
  'Daily standup notes',
  'Plan the second dry run',
]

// ── Generation ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>

export interface DevSeed {
  __schemaVersion: 49
  todos: Row[]
  projects: Row[]
  canvases: Row[]
  listInsets: Row[]
  people: Row[]
  settings: Row[]
  todoPeople: Row[]
  todoOrgs: Row[]
  personOrgs: Row[]
  orgs: Row[]
  taskboards: Row[]
  statuses: Row[]
  listDefinitions: Row[]
  notes: Row[]
  floatingCalendars: Row[]
  floatingNotes: Row[]
  floatingTaskboards: Row[]
  floatingHorizons: Row[]
  floatingStatus: Row[]
  floatingScoreboard: Row[]
  floatingSnoozeGraveyard: Row[]
  tags: Row[]
  todoTags: Row[]
  todoEvents: Row[]
  exportedAt: string
}

/** Ids of the seed's named entities (stable across runs). */
export const DEV_SEED_IDS = {
  people: Object.fromEntries(Object.keys(PEOPLE).map((k, i) => [k, i + 1])) as Record<PersonKey, number>,
  orgs: Object.fromEntries(Object.keys(ORGS).map((k, i) => [k, i + 1])) as Record<OrgKey, number>,
  tags: Object.fromEntries(Object.keys(TAGS).map((k, i) => [k, i + 1])) as Record<TagKey, number>,
  statuses: Object.fromEntries(Object.keys(STATUSES).map((k, i) => [k, i + 1])) as Record<StatusKey, number>,
  lists: {
    thisWeek: 1, nextWeek: 2, restOfMonth: 3, later: 4, someday: 5,
    dueSoon: 6, scheduledThisWeek: 7, northwind: 8, tasksFor: 9, byClient: 10,
  },
}

const IDS = DEV_SEED_IDS

interface Spec {
  title: string
  projectId?: number
  opts: TaskOpts
  /** Creation timestamp (ms). */
  created: number
}

/**
 * Builds the v49 export for `today` (only its local calendar day is used).
 */
export function generateDevSeed(today: Date = new Date()): DevSeed {
  const rng = makeRng(PRNG_SEED)
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
      if (rng.chance(0.35)) {
        if (rng.chance(0.6)) {
          o.sched = rng.int(-10, 20)
          if (rng.chance(0.3)) o.snoozes = rng.int(1, 4)
        } else {
          o.fuzzy = [rng.pick(['today', 'tomorrow', 'this-week', 'next-week', 'this-month', 'next-month'] as const), -rng.int(0, 20)]
        }
      }
      const s = rng.next()
      if (s < 0.18) o.status = 'followup'
      else if (s < 0.32) o.status = 'waiting'
      else if (s < 0.44) o.status = 'assigned'
      else if (s < 0.5) o.status = 'parked'
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
    if (!o.done && rng.chance(0.07)) o.progress = rng.pick(PROGRESS_POOL)
    return o
  }

  /** Days ago the task must at least be, so every event fits after creation. */
  const minAge = (o: TaskOpts): number => {
    const past = [0]
    if (o.done !== undefined) past.push(-o.done + 2)
    if (o.legacyDone !== undefined) past.push(-o.legacyDone + 2)
    if (o.reopened) past.push(-o.reopened[0] + 2)
    if (o.due !== undefined && o.due < 0) past.push(-o.due + 3)
    if (o.sched !== undefined && o.sched < 0) past.push(-o.sched + 2)
    if (o.fuzzy) past.push(-o.fuzzy[1])
    if (o.snoozes) past.push(o.snoozes * 3 + 2)
    if (o.dueMoves) past.push(o.dueMoves * 4 + 2)
    if (o.recur) past.push(RECUR_DAYS[o.recur] * rollovers(o.recur) + 3)
    return Math.max(...past)
  }

  const addSpecs = (defs: TaskDef[], project: ProjectDef | null, projectId: number | undefined) => {
    for (const def of defs) {
      const [title, explicit] = typeof def === 'string' ? [def, null] : def
      const opts = explicit ?? randomOpts(project)
      const lo = minAge(opts)
      const age = opts.age ?? lo + (rng.chance(0.1) ? 0 : rng.int(0, 45))
      // Same-day creations land before the export moment.
      const created = age === 0
        ? at(0, 7, rng.int(0, 59)).getTime()
        : at(-age, rng.int(8, 17), rng.int(0, 59)).getTime()
      specs.push({ title, projectId, opts, created })
    }
  }
  PROJECTS.forEach((p, i) => addSpecs(p.tasks, p, i + 1))
  addSpecs(LOOSE_TASKS, null, undefined)

  // Autoincrement ids follow creation time.
  specs.sort((a, b) => a.created - b.created)

  const todos: Row[] = []
  const todoPeople: Row[] = []
  const todoOrgs: Row[] = []
  const todoTags: Row[] = []
  const events: Array<Row & { timestamp: string; todoId: number }> = []
  const projectSort = new Map<number | undefined, number>()

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
    const ev = (type: string, ts: number, fromValue: unknown = null, toValue: unknown = null) => {
      events.push({ todoId: id, type, fromValue, toValue, timestamp: iso(ts) })
    }
    ev('created', created)

    const todo: Row = { title: spec.title }
    if (o.notes) todo.notes = o.notes
    if (o.progress) todo.progress = o.progress
    todo.isCompleted = completedMs !== null

    // Scheduled date (precise with snoozes, or fuzzy picked at `setAt`).
    if (o.sched !== undefined) {
      const final = day(o.sched)
      todo.scheduledDate = { kind: 'date', value: iso(final) }
      // Each snooze pushed the date out a few days, ending at the stored value.
      const n = o.snoozes ?? 0
      const offsets = [o.sched]
      for (let k = 0; k < n; k++) offsets.unshift((offsets[0] ?? o.sched) - rng.int(2, 4))
      let prev: string | null = null
      offsets.forEach((off, k) => {
        const value = iso(day(off))
        ev('scheduled', between((k + 1) / (n + 2)), prev, value)
        prev = value
      })
    } else if (o.fuzzy) {
      const [token, pickedDay] = o.fuzzy
      // Picked after creation (an old pick on the creation day can't predate it).
      const setAt = Math.max(created + 60_000, at(pickedDay, pickedDay === 0 ? 7 : 11, rng.int(0, 59)).getTime())
      todo.scheduledDate = { kind: 'fuzzy', token, setAt: iso(setAt) }
      ev('scheduled', setAt, null, `fuzzy:${token}`)
    }

    // Due date (with earlier values when it was pushed out / rolled over).
    let due: Date | null = null
    if (o.dueMonthEnd) due = new Date(y, m + 1, 0)
    else if (o.due !== undefined) due = day(o.due)
    if (due) {
      todo.dueDate = iso(due)
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
    if (o.recur) {
      todo.recurrenceRule = o.recur === 'monthly' && due && due.getDate() >= 29
        ? { type: 'monthly', originalDayOfMonth: due.getDate() }
        : { type: o.recur }
    }

    todo.createdAt = iso(created)
    if (spec.projectId !== undefined) {
      todo.projectId = spec.projectId
      todo.canvasId = 1
    }
    if (o.status) {
      todo.statusId = IDS.statuses[o.status]
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

    const sortOrder = projectSort.get(spec.projectId) ?? 0
    projectSort.set(spec.projectId, sortOrder + 1)
    todo.sortOrder = sortOrder
    todo.id = id

    const mine = events.filter((e) => e.todoId === id).map((e) => Date.parse(e.timestamp))
    const modified = Math.max(created, ...mine, completedMs !== null ? endMs : created)
    todo.modifiedAt = iso(modified)
    todos.push(reorderTodo(todo))

    for (const p of o.people ?? []) todoPeople.push({ todoId: id, personId: IDS.people[p] })
    for (const g of o.orgs ?? []) todoOrgs.push({ todoId: id, orgId: IDS.orgs[g] })
    for (const t of o.tags ?? []) todoTags.push({ todoId: id, tagId: IDS.tags[t] })
  })

  const idOf = (title: string): number => {
    const t = todos.find((r) => r.title === title)
    if (!t) throw new Error(`dev seed: no task titled "${title}"`)
    return t.id as number
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.todoId - b.todoId)
  const withIds = <T extends Row>(rows: T[]): Row[] => rows.map((r, i) => ({ ...r, id: i + 1 }))

  // ── Entities ──
  const canvasCreated = iso(at(-200, 9))
  const people = Object.values(PEOPLE).map(([name, initials], i) => ({ name, initials, id: i + 1 }))
  const orgs = Object.values(ORGS).map((o, i) => ({ ...o, id: i + 1 }))
  const personOrgs = withIds(MEMBERSHIPS.map(([p, g]) => ({ personId: IDS.people[p], orgId: IDS.orgs[g] })))
  const tags = Object.entries(TAGS).map(([name, color], i) => ({ name, color, id: i + 1 }))
  const statuses = Object.values(STATUSES).map((s, i) => ({ name: s.name, color: s.color, sortOrder: i, icon: s.icon, hideByDefault: s.hideByDefault, id: i + 1 }))

  const projects = PROJECTS.map((p, i) => {
    const row: Row = {
      name: p.name,
      canvasId: 1,
      positionX: i * 420,
      positionY: 0,
    }
    if (p.width) row.width = p.width
    row.isCollapsed = false
    row.color = p.color
    row.sortOrder = i
    row.createdAt = iso(at(-200 + i * 3, 10))
    row.groupBy = p.groupBy
    if (p.groupOrder) row.groupOrder = p.groupOrder
    row.id = i + 1
    return row
  })

  // ── List definitions ──
  const base = () => ({
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null as number[] | null,
    personFilterMode: 'include-orgs',
    orgIds: null as number[] | null,
    orgFilterMode: 'include-people',
    projectIds: null as number[] | null,
    statusIds: null as number[] | null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null as unknown,
    dateRangeEnd: null as unknown,
    dateRangeIncludeNoDate: false,
    hasScheduled: null as boolean | null,
    hasDeadline: null as boolean | null,
    tags: null as number[] | null,
  })
  const rel = (token: string) => ({ kind: 'relative', token })
  const list = (
    name: string, predicate: Row, sort: string, grouping: string,
    extra: Row = {}, pinnedToDashboard = false, favorited = false,
  ): Row => ({
    name, sortOrder: 0, pinnedToDashboard, favorited,
    membership: { kind: 'custom', predicate }, sort, grouping, ...extra,
  })
  const listDefinitions = [
    // The five horizon seeds every v49 database has.
    list('This week', { ...base(), dateRangeStart: rel('start-of-week'), dateRangeEnd: rel('end-of-week') }, 'date', 'none', {}, true),
    list('Next week', { ...base(), dateRangeStart: rel('start-of-next-week'), dateRangeEnd: rel('end-of-next-week') }, 'date', 'none', {}, true),
    list('Rest of month', { ...base(), dateRangeStart: rel('tomorrow'), dateRangeEnd: rel('end-of-month') }, 'date', 'none', {}, true),
    list('Later', { ...base(), dateRangeStart: rel('start-of-next-month'), dateRangeEnd: rel('end-of-month-plus-3') }, 'date', 'date', {}, true),
    list('Someday', { ...base(), hasScheduled: false, hasDeadline: false }, 'manual', 'none', {}, true),
    // Custom lists.
    list('Overdue & due soon', {
      ...base(), dateField: 'deadline', hasDeadline: true, dateRangeEnd: { kind: 'offset', days: 7 },
    }, 'deadline', 'project', { maxTasks: 30, limitMode: 'scroll' }, false, true),
    list('Scheduled this week', {
      ...base(), dateField: 'scheduled', hasScheduled: true,
      dateRangeStart: rel('start-of-week'), dateRangeEnd: rel('end-of-week'),
    }, 'scheduled', 'people', {}, false, true),
    list('Northwind', {
      ...base(), orgIds: [IDS.orgs.northwind], projectIds: [3, 0], dateRangeIncludeNoDate: true,
      dateRangeStart: { kind: 'fixed', iso: iso(day(-60)) },
    }, 'date', 'org', { maxTasks: 20, limitMode: 'hard' }),
    list('Tasks for…', {
      ...base(), showHiddenStatuses: true,
      statusIds: [IDS.statuses.assigned, IDS.statuses.followup, IDS.statuses.waiting],
    }, 'deadline', 'status', { maxTasks: 25, limitMode: 'scroll', runtimeFilter: { field: 'person', label: 'Who' } }, false, true),
    list('By client', {
      ...base(), personIds: [IDS.people.elena, IDS.people.david, 0], personFilterMode: 'direct-only',
      tags: [IDS.tags.customer, IDS.tags.urgent],
    }, 'org', 'org', { runtimeFilter: { field: 'org', label: 'Client' } }),
  ].map((r, i) => ({ ...r, sortOrder: i, id: i + 1 }))

  // ── Canvas widgets ──
  const W = { y1: 1250, y2: 1620 }
  const listInsets = withIds([
    { listDefinitionId: IDS.lists.dueSoon, canvasId: 1, x: 0, y: W.y1, width: 360, height: 320, isCollapsed: false },
    { listDefinitionId: IDS.lists.byClient, canvasId: 1, x: 400, y: W.y1, width: 360, height: 320, isCollapsed: false, runtimeFilterValue: [IDS.orgs.bluefield, IDS.orgs.northwind] },
    { listDefinitionId: IDS.lists.tasksFor, canvasId: 1, x: 800, y: W.y1, width: 360, height: 280, isCollapsed: true, runtimeFilterValue: [IDS.people.sarah] },
  ])
  const box = (x: number, yy: number, extra: Row = {}) => ({ canvasId: 1, width: 340, height: 300, x, y: yy, ...extra })
  const floatingCalendars = withIds([box(1200, W.y1, { width: 460, orientation: 'horizontal', weekOffset: 1 })])
  const floatingNotes = withIds([box(1700, W.y1)])
  const floatingTaskboards = withIds([box(2080, W.y1, { collapsed: false })])
  const floatingHorizons = withIds([box(0, W.y2, { width: 520, collapsed: false })])
  const floatingStatus = withIds([box(560, W.y2, { collapsed: true })])
  const floatingScoreboard = withIds([box(940, W.y2)])
  const floatingSnoozeGraveyard = withIds([box(1320, W.y2, { collapsed: false })])

  const rails = {
    left: {
      orientation: 'vertical',
      slots: [
        {
          id: 's-focus', flex: 2, activeTabId: 't-who',
          tabs: [
            { id: 't-who', type: 'lens', listDefinitionId: IDS.lists.tasksFor, runtimeFilterValue: [IDS.people.priya] },
            { id: 't-week', type: 'lens', listDefinitionId: IDS.lists.thisWeek },
            { id: 't-notes', type: 'notes' },
          ],
        },
        { id: 's-cal', flex: 1, activeTabId: 't-cal', orientation: 'vertical', weekOffset: 0, tabs: [{ id: 't-cal', type: 'calendar' }] },
      ],
    },
    right: {
      orientation: 'vertical',
      slots: [
        { id: 's-board', activeTabId: 't-horizons', tabs: [{ id: 't-board', type: 'taskboard' }, { id: 't-horizons', type: 'horizons' }] },
      ],
    },
    top: null,
    bottom: {
      orientation: 'horizontal',
      slots: [
        {
          id: 's-stats', activeTabId: 't-score',
          tabs: [{ id: 't-status', type: 'status' }, { id: 't-score', type: 'scoreboard' }, { id: 't-snooze', type: 'snoozeGraveyard' }],
        },
        { id: 's-client', activeTabId: 't-client', tabs: [{ id: 't-client', type: 'lens', listDefinitionId: IDS.lists.byClient, runtimeFilterValue: [IDS.orgs.northwind] }] },
      ],
    },
    widths: { left: 360, right: 320 },
    heights: { bottom: 240 },
    corners: { sw: 'v' },
  }

  const settings = [
    { key: 'canvasMaxExtent', value: '20000' },
    { key: 'canvasRails', value: JSON.stringify(rails) },
    { key: 'canvasViewport', value: JSON.stringify({ x: 380, y: 60, zoom: 0.55 }) },
    { key: 'color.dark.accent', value: '#4f8cff' },
    // The app background (named after the canvas until v63) at the theme's own value.
    { key: 'color.dark.canvasBg', value: '#111110' },
    { key: 'color.dark.scheduled', value: '#7ec4bc' },
    { key: 'color.light.canvasBg', value: '#f5f4f2' },
    { key: 'completedRetentionDays', value: '30' },
    { key: 'defaultProjectGroupBy', value: 'status' },
    { key: 'defaultProjectId', value: '1' },
    { key: 'horizonSlots', value: JSON.stringify([1, 2, 3, 4, 5]) },
    { key: 'maxTags', value: '3' },
    { key: 'seededAssignedStatusId', value: String(IDS.statuses.assigned) },
    { key: 'seededFollowupStatusId', value: String(IDS.statuses.followup) },
    { key: 'selectedHorizonDefId', value: '1' },
    { key: 'themeMode', value: 'dark' },
    { key: 'weekStartsOn', value: '1' },
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return {
    __schemaVersion: 49,
    todos,
    projects,
    canvases: [{ name: 'Main', sortOrder: 0, createdAt: canvasCreated, id: 1 }],
    listInsets,
    people,
    settings,
    todoPeople: withIds(todoPeople),
    todoOrgs: withIds(todoOrgs),
    personOrgs,
    orgs,
    taskboards: [{
      entries: TASKBOARD_TITLES.map((t, i) => ({ todoId: idOf(t), sortOrder: i })),
      createdAt: canvasCreated,
      updatedAt: iso(at(0, 7, 50)),
      id: 1,
    }],
    statuses,
    listDefinitions,
    notes: [{
      content: '# Scratch\n\n- Ask Priya about Q4 headcount before Thursday\n- Northwind wants the SSO doc by end of month\n- Idea: rollback drill before the second dry run\n- Book dentist',
      createdAt: canvasCreated,
      modifiedAt: iso(at(-1, 18, 5)),
      id: 1,
    }],
    floatingCalendars,
    floatingNotes,
    floatingTaskboards,
    floatingHorizons,
    floatingStatus,
    floatingScoreboard,
    floatingSnoozeGraveyard,
    tags,
    todoTags: withIds(todoTags),
    todoEvents: withIds(events),
    exportedAt: iso(exportedAt),
  }

  function reorderTodo(t: Row): Row {
    // Field order of the v49 model (cosmetic — keeps diffs against real exports readable).
    const order = ['title', 'notes', 'progress', 'isCompleted', 'scheduledDate', 'dueDate', 'recurrenceRule',
      'createdAt', 'modifiedAt', 'projectId', 'canvasId', 'statusId', 'sortOrder', 'id']
    const out: Row = {}
    for (const k of order) if (k in t) out[k] = t[k]
    return out
  }
}
