import { useRef, useState, type MouseEvent } from 'react'
import { applyPlannerFix, snoozePlannerTask, unplanPlannerTask } from '../../../services/planner-drop'
import {
  plannerDayWords,
  plannerFixLabel,
  plannerRowTagHint,
  plannerRowTagLabel,
  plannerSnoozeDay,
  type PlannerPlacement,
  type PlannerRowTag as RowTag,
  type PlannerWindow,
} from '../../../utils/planner'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import styles from './PlannerWidget.module.css'

type Span = Pick<PlannerWindow, 'today' | 'last'>

/** A button's click in a row: its own, never the row's (select, edit, open), and once for a double-click. */
function rowClick(run: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation()
    if (e.detail > 1) return
    run()
  }
}

/**
 * A Planner row's tag, after its title (`utils/planner.plannerRowTag`):
 *
 * - a Delayed row: the day it was planned for, in words (`Wed`), muted;
 * - a row held in Unplanned that has a natural day: that day, muted;
 * - a row planned past a real date: `1 day after due` in the deadline
 *   color — a **button** that opens the row's fixes as a menu
 *   (`plannerFixLabel`: `Move due date to Tue, Nov 24`, `Plan for Mon, Nov
 *   23`), each made by `services/planner-drop.applyPlannerFix`. Esc hands
 *   the focus back to the tag;
 * - a row planned later — for a day past the window, shown on its natural
 *   day meanwhile: `planned Fri, Nov 27`, muted, a button with the same
 *   fixes.
 *
 * Its tooltip says it in full.
 */
export function PlannerRowTag({ tabId, todoId, tag, window }: { tabId: string; todoId: number; tag: RowTag; window: Span }) {
  const { today } = window
  const label = plannerRowTagLabel(tag, today)
  const hint = plannerRowTagHint(tag, today)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (tag.kind !== 'conflict' && tag.kind !== 'later') {
    return <span className={styles.rowTag} data-planner-tag={tag.kind} data-row-cell="planner-tag" data-tooltip={hint}>{label}</span>
  }
  const entries: MenuEntry[] = tag.fixes.map((fix) => ({
    kind: 'item',
    label: plannerFixLabel(fix, today),
    onSelect: () => { void applyPlannerFix(tabId, todoId, fix, window) },
  }))
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${styles.rowTag} ${tag.kind === 'conflict' ? styles.rowTagLate : styles.rowTagButton}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-planner-tag={tag.kind}
        data-row-cell="planner-tag"
        data-open={open ? '' : undefined}
        data-tooltip={`${hint}. Click to fix`}
        onClick={rowClick(() => setOpen((v) => !v))}
      >
        {label}
      </button>
      {open && <MenuPopover anchorRef={ref} entries={entries} label="Fix the plan" width={232} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * A Planner row's hover buttons, at its title's end (shown as the row's
 * placeholders are: hover, focus within; desktop only): **Snooze** — the
 * next day — and **Unplan** — to Unplanned; no Unplan on a row that is
 * there already. The row's menu keeps both.
 */
export function PlannerRowActions({ tabId, todoId, placement, window }: {
  tabId: string
  todoId: number
  placement: PlannerPlacement
  window: Span
}) {
  const snoozeTo = plannerDayWords(plannerSnoozeDay(placement, window.today), window.today)
  return (
    <span className={styles.rowActions} data-planner-actions="">
      <button
        type="button"
        className={styles.rowAction}
        data-row-cell="planner-snooze"
        data-tooltip={`Plan for ${snoozeTo === 'Today' ? 'today' : snoozeTo}`}
        onClick={rowClick(() => { void snoozePlannerTask(tabId, todoId, window) })}
      >
        Snooze
      </button>
      {placement.where !== 'unplanned' && (
        <button
          type="button"
          className={styles.rowAction}
          data-row-cell="planner-unplan"
          data-tooltip="Move to Unplanned"
          onClick={rowClick(() => { void unplanPlannerTask(tabId, todoId, window) })}
        >
          Unplan
        </button>
      )}
    </span>
  )
}
