import { useRef, useState } from 'react'
import type { PersistedTodoItem, TaskPlan, TodoItem } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER } from '../../hooks/use-followup-input'
import { useToday } from '../../hooks/use-today'
import { applyPlannerFix, clearPlannerTask, planTaskForDay } from '../../services/planner-drop'
import { useSettingsStore } from '../../stores/settings-store'
import { startOfDay } from '../../utils/date'
import { factDateWords } from '../../utils/fact-dates'
import {
  plannerConflictFixes,
  plannerConflictLabel,
  plannerConflicts,
  plannerFixLabel,
  plannerHasPlan,
  plannerPlannedDay,
  plannerWindow,
  type PlannerFix,
} from '../../utils/planner'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { FactSection } from './TaskFacts'
import { TypedDateField } from './TypedDateField'
import { useTypedDate } from './use-typed-date'
import styles from './TaskDetails.module.css'

/** What a typed day before today says (the picker's own `min` stops one there). */
const PLAN_PAST_MESSAGE = 'Plan a day from today on'

/** What the Planned cell reads: the plan state and the real dates it may fall after. */
type PlannedSubject = Pick<TodoItem, 'doDate' | 'dueDate' | 'nextFollowupAt'>

interface PlannedFactsProps {
  task: PlannedSubject
  /** False: the plan shows, nothing sets it (a completed task). */
  editable: boolean
  /** A day typed or picked, today or later: the task planned for it. */
  onPlan: (day: Date) => void
  /** A fix picked (a plan after a real date). */
  onFix: (fix: PlannerFix) => void
  /** × — the plan state cleared. */
  onClear: () => void
}

/**
 * **Planned**, the fact band's last cell (after Due; task layout B — the
 * task editor and the review card alike): the task's plan state
 * (`doDate`), on two short lines as Due. The first is a typed
 * date field as Due's (`TypedDateField`): a day typed (`fri`, `11/30`,
 * `2w`) or picked from the calendar plans the task for it (`onPlan`) —
 * today or later; an earlier day typed is refused with a message, the
 * picker starts at today —, and × (**Clear plan**) clears the plan state
 * while there is one; an emptied field clears it too. Its states at rest:
 *
 * - not planned — `Not planned`, muted;
 * - a planned day — the hollow bar (the Planner's plan mark) and the day
 *   in the rows' words, how far it is under the field, muted
 *   (`tomorrow`); planned after a real date, `1 day after due ▾` under it
 *   in the deadline color, a button opening the Planner's fixes
 *   (`plannerFixLabel`); a day passed (**missed**) — muted, `3 days ago ·
 *   Delayed` under it.
 *
 * While typing, the second line says what the text means. A task that is
 * not `editable` shows its plan's words alone.
 */
function PlannedFacts({ task, editable, onPlan, onFix, onClear }: PlannedFactsProps) {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  const fixRef = useRef<HTMLButtonElement>(null)
  const [fixesOpen, setFixesOpen] = useState(false)

  const planned = plannerPlannedDay(task)
  const hasPlan = plannerHasPlan(task)
  const missed = planned != null && planned.getTime() < startOfDay(today).getTime()
  const conflicts = planned && !missed ? plannerConflicts(task, planned, today) : []
  const fixes = plannerConflictFixes(conflicts)
  const words = planned ? factDateWords(planned, today, rowDates, 'next') : null
  const state = planned ? (missed ? 'missed' : conflicts.length > 0 ? 'late' : 'planned') : 'none'

  const entry = useTypedDate({
    value: planned ?? undefined,
    mode: 'next',
    options: { pastMessage: PLAN_PAST_MESSAGE },
    onChange: (day) => {
      if (day == null) {
        if (hasPlan) onClear()
      } else if (day.getTime() !== planned?.getTime()) {
        onPlan(day)
      }
    },
  })

  const face = planned && words ? (
    <>
      <span className={styles.planBar} aria-hidden="true" />
      <span className={styles.planDay}>{words.words}</span>
    </>
  ) : undefined
  // Under the field: how far the day is (a missed day's with Delayed); none with the fixes there instead.
  const under = !words ? undefined
    : missed ? [words.relative, 'Delayed'].filter(Boolean).join(' · ')
      : conflicts.length === 0 ? words.relative : undefined
  const name = planned && words ? `Planned: ${words.full}` : 'Planned: not planned'

  return (
    <FactSection fact="planned">
      <div className={styles.dateValue} data-planned-state={state}>
        {editable ? (
          <TypedDateField
            entry={entry}
            label="Planned"
            placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
            date={planned ?? undefined}
            kind="next"
            empty="Not planned"
            words={face}
            fill
            clear={{ label: 'Clear plan' }}
            pick={{ label: 'Pick planned day', min: today }}
          />
        ) : (
          <span className={styles.planValue} role="img" aria-label={name}>
            {face ?? <span className={styles.dateEmpty}>Not planned</span>}
          </span>
        )}
        {entry.input.dirty ? (
          <span className={styles.dateUnder} data-date-under="" data-tooltip={entry.helpTitle} aria-live="polite">{entry.help}</span>
        ) : conflicts.length > 0 && conflicts[0] ? (
          <div className={styles.dateUnder}>
            <button
              ref={fixRef}
              type="button"
              className={styles.planConflict}
              aria-haspopup="menu"
              aria-expanded={fixesOpen}
              data-tooltip="Fix the plan"
              onClick={() => setFixesOpen((v) => !v)}
            >
              {plannerConflictLabel(conflicts[0])}
              <span className={styles.statusCaret} aria-hidden="true">&#x25BE;</span>
            </button>
          </div>
        ) : (
          <span className={styles.dateUnder} data-date-under="" data-tooltip={under}>{under}</span>
        )}
      </div>
      {fixesOpen && (
        <MenuPopover
          anchorRef={fixRef}
          entries={fixes.map((fix): MenuEntry => ({ kind: 'item', label: plannerFixLabel(fix, today), onSelect: () => onFix(fix) }))}
          label="Fix the plan"
          width={232}
          onClose={() => setFixesOpen(false)}
        />
      )}
    </FactSection>
  )
}

/**
 * The Planned cell of a stored task (the task editor's edit mode, the
 * review card): a day typed or picked is the plan write
 * (`planTaskForDay`: a pick, no stamp, one undo step), the fixes
 * `applyPlannerFix` outside a Planner and × Clear plan
 * (`clearPlannerTask`), each against this week's window. It reads the task
 * as stored, so a plan changed elsewhere (a Planner drag, a menu, undo)
 * shows at once. A completed task's plan shows, with nothing to set: the
 * Planner holds open tasks.
 */
export function TaskPlannedFacts({ todo }: { todo: PersistedTodoItem }) {
  const today = useToday()
  const window = plannerWindow(today)
  return (
    <PlannedFacts
      task={todo}
      editable={!todo.isCompleted}
      onPlan={(day) => { void planTaskForDay(todo.id, day) }}
      onFix={(fix) => { void applyPlannerFix(null, todo.id, fix, window) }}
      onClear={() => { void clearPlannerTask(todo.id, window) }}
    />
  )
}

/**
 * The Planned cell of a task not yet created (the task editor's create and
 * draft modes): the plan is held in `plan` until Create — a day typed or
 * picked and × set it, a fix's date move sets the due date or follow-up
 * `onMoveDate` hands it.
 */
export function DraftPlannedFacts({ plan, dates, onPlan, onMoveDate }: {
  plan: TaskPlan
  dates: Pick<TodoItem, 'dueDate' | 'nextFollowupAt'>
  onPlan: (plan: TaskPlan) => void
  onMoveDate: (date: 'due' | 'followup', to: Date) => void
}) {
  const task: PlannedSubject = {
    ...dates,
    ...(plan ? { doDate: plan.day } : {}),
  }
  return (
    <PlannedFacts
      task={task}
      editable
      onPlan={(day) => onPlan({ day: startOfDay(day) })}
      onFix={(fix) => (fix.kind === 'plan' ? onPlan({ day: fix.day }) : onMoveDate(fix.date, startOfDay(new Date(fix.to))))}
      onClear={() => onPlan(null)}
    />
  )
}
