import { useRef, useState } from 'react'
import type { PersistedTodoItem, TaskPlan, TodoItem } from '../../models'
import { useToday } from '../../hooks/use-today'
import { applyPlannerFix, clearPlannerTask } from '../../services/planner-drop'
import { useSettingsStore } from '../../stores/settings-store'
import { startOfDay } from '../../utils/date'
import { factDateWords } from '../../utils/fact-dates'
import {
  plannerConflictFixes,
  plannerConflictLabel,
  plannerConflicts,
  plannerFixLabel,
  plannerPlannedDay,
  plannerWindow,
  type PlannerFix,
} from '../../utils/planner'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { RemoveButton } from '../shared/RemoveButton'
import { draftPlanMenuEntries, planMenuEntries } from './plan-menu'
import { FactSection } from './TaskFacts'
import styles from './TaskDetails.module.css'

/** What the Planned cell reads: the plan state and the real dates it may fall after. */
type PlannedSubject = Pick<TodoItem, 'doDate' | 'unplanned' | 'dueDate' | 'nextFollowupAt'>

interface PlannedFactsProps {
  task: PlannedSubject
  /** The Plan for day menu the value opens; null: nothing to open (a completed task). */
  menu: MenuEntry[] | null
  /** A fix picked (a plan after a real date). */
  onFix: (fix: PlannerFix) => void
  /** × — the plan state cleared. */
  onClear: () => void
}

/**
 * **Planned**, the fact band's last cell (after Due; task layout B — the
 * task editor and the review card alike): the task's plan state
 * (`doDate` / `unplanned`). Its value is a button opening the **Plan for
 * day** menu (`menu`); × clears the plan. On two short lines, as Due: the
 * value and × on the first, its words under it. Its states:
 *
 * - not planned — `Not planned`, muted;
 * - held — `Held` over `in Unplanned`, with the Planner's corner flag at
 *   the cell's top-left;
 * - a planned day — the hollow bar (the Planner's plan mark) and the day
 *   in the rows' words, how far it is under them, muted (`tomorrow`);
 *   planned after a real date, `1 day after due ▾` under them in the
 *   deadline color, a button opening the Planner's fixes
 *   (`plannerFixLabel`); a day passed (**missed**) — muted, `3 days ago ·
 *   Delayed` under the day.
 */
function PlannedFacts({ task, menu, onFix, onClear }: PlannedFactsProps) {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  const valueRef = useRef<HTMLButtonElement>(null)
  const fixRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<'menu' | 'fixes' | null>(null)
  const close = () => setOpen(null)

  const planned = plannerPlannedDay(task)
  const held = planned == null && task.unplanned === true
  const missed = planned != null && planned.getTime() < startOfDay(today).getTime()
  const conflicts = planned && !missed ? plannerConflicts(task, planned, today) : []
  const fixes = plannerConflictFixes(conflicts)
  const words = planned ? factDateWords(planned, today, rowDates, 'next') : null
  const state = planned ? (missed ? 'missed' : conflicts.length > 0 ? 'late' : 'planned') : held ? 'held' : 'none'

  const face = planned && words ? (
    <>
      <span className={styles.planBar} aria-hidden="true" />
      <span className={styles.planDay}>{words.words}</span>
    </>
  ) : held ? <span className={styles.planHeld}>Held</span> : <span className={styles.dateEmpty}>Not planned</span>
  // Under the day: how far it is (a missed day's with Delayed); none with the fixes there instead. Held: where.
  const under = held ? 'in Unplanned' : !words ? undefined
    : missed ? [words.relative, 'Delayed'].filter(Boolean).join(' · ')
      : conflicts.length === 0 ? words.relative : undefined
  const name = planned && words ? `Planned: ${words.full}` : held ? 'Planned: held in Unplanned' : 'Planned: not planned'

  return (
    <FactSection fact="planned">
      {held && <span className={styles.planFlag} data-planned-flag="" aria-hidden="true" />}
      <div className={styles.dateValue} data-planned-state={state}>
        <div className={styles.dateLine}>
          {menu ? (
            <button
              ref={valueRef}
              type="button"
              className={styles.planValue}
              aria-label={name}
              aria-haspopup="menu"
              aria-expanded={open === 'menu'}
              data-tooltip={planned && words ? `Planned for ${words.full}` : 'Plan for day'}
              onClick={() => setOpen((v) => (v === 'menu' ? null : 'menu'))}
            >
              {face}
            </button>
          ) : (
            <span className={styles.planValue} aria-label={name}>{face}</span>
          )}
          {menu && (planned || held) && <RemoveButton size={20} label="Clear plan" tooltip onClick={onClear} />}
        </div>
        {conflicts.length > 0 && conflicts[0] ? (
          <div className={styles.dateUnder}>
            <button
              ref={fixRef}
              type="button"
              className={styles.planConflict}
              aria-haspopup="menu"
              aria-expanded={open === 'fixes'}
              data-tooltip="Fix the plan"
              onClick={() => setOpen((v) => (v === 'fixes' ? null : 'fixes'))}
            >
              {plannerConflictLabel(conflicts[0])}
              <span className={styles.statusCaret} aria-hidden="true">&#x25BE;</span>
            </button>
          </div>
        ) : (
          <span className={styles.dateUnder} data-date-under="" data-tooltip={under}>{under}</span>
        )}
      </div>
      {open === 'menu' && menu && (
        <MenuPopover anchorRef={valueRef} entries={menu} label="Plan for day" width={236} focusChecked onClose={close} />
      )}
      {open === 'fixes' && (
        <MenuPopover
          anchorRef={fixRef}
          entries={fixes.map((fix): MenuEntry => ({ kind: 'item', label: plannerFixLabel(fix, today), onSelect: () => onFix(fix) }))}
          label="Fix the plan"
          width={232}
          onClose={close}
        />
      )}
    </FactSection>
  )
}

/**
 * The Planned cell of a stored task (the task editor's edit mode, the
 * review card): its menu `planMenuEntries` — the plan write, no stamp, one
 * undo step —, the fixes `applyPlannerFix` outside a Planner and × Clear
 * plan (`clearPlannerTask`), each against this week's window. It reads the
 * task as stored, so a plan changed elsewhere (a Planner drag, a menu,
 * undo) shows at once. A completed task's plan shows, with nothing to
 * open: the Planner holds open tasks.
 */
export function TaskPlannedFacts({ todo }: { todo: PersistedTodoItem }) {
  const today = useToday()
  const window = plannerWindow(today)
  return (
    <PlannedFacts
      task={todo}
      menu={todo.isCompleted ? null : planMenuEntries(todo, today)}
      onFix={(fix) => { void applyPlannerFix(null, todo.id, fix, window) }}
      onClear={() => { void clearPlannerTask(todo.id, window) }}
    />
  )
}

/**
 * The Planned cell of a task not yet created (the task editor's create and
 * draft modes): the plan is held in `plan` until Create — the menu's days,
 * Pick a date…, Unplanned and Clear plan set it (`draftPlanMenuEntries`), a
 * fix's date move sets the due date or follow-up `onMoveDate` hands it.
 */
export function DraftPlannedFacts({ plan, dates, onPlan, onMoveDate }: {
  plan: TaskPlan
  dates: Pick<TodoItem, 'dueDate' | 'nextFollowupAt'>
  onPlan: (plan: TaskPlan) => void
  onMoveDate: (date: 'due' | 'followup', to: Date) => void
}) {
  const today = useToday()
  const task: PlannedSubject = {
    ...dates,
    ...(plan === 'unplanned' ? { unplanned: true as const } : plan ? { doDate: plan.day } : {}),
  }
  return (
    <PlannedFacts
      task={task}
      menu={draftPlanMenuEntries(task, today, onPlan)}
      onFix={(fix) => (fix.kind === 'plan' ? onPlan({ day: fix.day }) : onMoveDate(fix.date, startOfDay(new Date(fix.to))))}
      onClear={() => onPlan(null)}
    />
  )
}
