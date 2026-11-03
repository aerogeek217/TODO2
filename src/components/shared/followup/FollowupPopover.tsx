import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { usePopoverAnchor, type PopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useFollowupInput, NEXT_FOLLOWUP_PLACEHOLDER } from '../../../hooks/use-followup-input'
import { useSelectAllOnFocus } from '../../../hooks/use-select-all-on-focus'
import { useToday } from '../../../hooks/use-today'
import { autoNextFollowup, useSettingsStore } from '../../../stores/settings-store'
import { startOfDay } from '../../../utils/date'
import {
  addFollowupInterval,
  formatFollowupDate,
  formatWeekdayNumeric,
  isFollowedUpToday,
  isFollowupOverdue,
  nextAfterFollowup,
  relativeDayPhrase,
  QUICK_FOLLOWUP_INTERVALS,
} from '../../../utils/followup'
import { FollowedUpIcon } from '../FollowupIcons'
import { useTooltip } from '../use-tooltip'
import { FollowupDateButton } from './FollowupDateButton'
import { FollowupQuickButtons } from './FollowupQuickButtons'
import styles from './Followup.module.css'
import { PopoverRoot } from '../PopoverRoot'

interface FollowupPopoverProps {
  todo: PersistedTodoItem
  anchor: PopoverAnchor
  onClose: () => void
  /** Set (or with `null`, clear) the next follow-up — nothing else. */
  onSetNext: (date: Date | null) => void
  /**
   * "Mark followed up": last = now and next = `next`, the edited field's date
   * (`null` = none); `undefined` while the field is untouched — the store's
   * rule then decides per task (a next follow-up after today is kept).
   */
  onFollowedUp: (next?: Date | null) => void
  /**
   * Already followed up today (dims "Mark followed up"). Defaults to `todo`'s own
   * last follow-up; the bulk bar passes "every selected task".
   */
  followedUpToday?: boolean
  /**
   * The next follow-up there is now — what the field starts from (kept when
   * after today), the help line's `Was …`, and what ⏎ compares the field
   * with. Defaults to `todo`'s own; the bulk bar passes the selection's
   * (`'mixed'` when the tasks differ: the field starts empty, `Each task’s own`).
   */
  current?: Date | null | 'mixed'
  /**
   * What has focus on open: `followedUp` (default — ⏎ records a follow-up
   * today) or `next` (the Next follow-up field, its value selected — opened
   * to pick a date).
   */
  initialFocus?: 'followedUp' | 'next'
}

/** The field's placeholder while a mixed selection's field is untouched. */
const EACH_TASKS_OWN = 'Each task’s own'

/** What Mark followed up will do, for its tooltip: keep / set / clear. */
function followedUpTooltip({ untouched, mixed, kept, fieldDate, current, proposal, today }: {
  untouched: boolean
  mixed: boolean
  kept: boolean
  fieldDate: Date | null | 'invalid'
  current: Date | null | 'mixed'
  proposal: Date | null
  today: Date
}): string {
  if (untouched && mixed) {
    return proposal
      ? `Record a follow-up today; future next follow-ups are kept, the rest set to ${formatFollowupDate(proposal, today)}`
      : 'Record a follow-up today; future next follow-ups are kept, the rest cleared'
  }
  if (untouched && kept) return 'Record a follow-up today and keep the next follow-up'
  if (fieldDate === null) {
    return current === null
      ? 'Record a follow-up today (no next follow-up)'
      : 'Record a follow-up today and clear the next follow-up'
  }
  return 'Record a follow-up today and set the next follow-up to the date above'
}

/** Same day, or both none. */
function sameDay(a: Date | null, b: Date | null): boolean {
  return (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null)
}

/**
 * Small popover for a task's follow-up, opened from the row's follow-up pill,
 * its empty-slot flag, the row menu or the bulk bar. The Next follow-up field
 * opens on what "Mark followed up" will leave (`nextAfterFollowup`): the
 * task's own next follow-up when it is after today, else Settings' automatic
 * one (today + the interval, or empty while that is off) — the help line then
 * says what it was (`Was today` / `Was Mon 11/02 · overdue`). A bulk
 * selection with mixed dates opens empty (`Each task’s own`). Mark followed up
 * (focused on open, so ⏎ records; or the field, `initialFocus: 'next'`) stamps
 * today: with the field untouched it passes no date, so the store's rule
 * decides per task (a later date kept); edited, the field's date — empty
 * clears it, text that isn't a date disables it. Its tooltip says which. The
 * field takes an interval or a date, or a day from the browser's date picker
 * (its calendar button). Focusing the field (click, Tab) selects its text,
 * so typing replaces it. ⏎ in the field (when it differs from now), a
 * picked day or a quick button sets the next follow-up only and closes;
 * the field's × empties it; Esc / outside click closes without change. On
 * close, focus goes back to what had it before (the trigger) unless
 * something else took it.
 */
export function FollowupPopover({
  todo, anchor, onClose, onSetNext, onFollowedUp, followedUpToday, current: currentProp, initialFocus = 'followedUp',
}: FollowupPopoverProps) {
  const today = useToday()
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  // The automatic next follow-up (none while that setting is off).
  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const current = currentProp !== undefined ? currentProp : (todo.nextFollowupAt ?? null)
  const mixed = current === 'mixed'
  // What Mark followed up leaves unless the field is edited — the store's
  // rule: a date after today kept, else the proposal. The field starts on it
  // (a mixed selection: nothing — each task's own).
  const ruled = mixed ? null : nextAfterFollowup(current, today, proposal)
  const kept = !mixed && current !== null && ruled === current
  // A date today or past that Mark followed up replaces: said under the field.
  const was = !mixed && current !== null && !kept ? current : null
  const inputRef = useRef<HTMLInputElement>(null)
  const followedUpRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const input = useFollowupInput(ruled ?? undefined, 'next', today)
  // The field holds a proposal the user usually replaces: focus selects it.
  const selectOnFocus = useSelectAllOnFocus()
  const { panelRef, style, caret } = usePopoverAnchor({ anchor, open: true, onClose, caret: true })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    panelRef(el)
  }, [panelRef])

  // Remember what had focus (the trigger — or, from a menu, what the menu
  // handed focus back to: a passive effect runs after that), then focus in.
  const initialFocusRef = useRef(initialFocus)
  useEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !containerRef.current?.contains(previous)) {
      returnFocusRef.current = previous
    }
    if (initialFocusRef.current === 'next') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      followedUpRef.current?.focus()
    }
  }, [])
  // On close hand focus back, unless something else took it.
  useLayoutEffect(() => {
    const container = containerRef.current
    return () => {
      const target = returnFocusRef.current
      const active = document.activeElement
      const focusIsOurs = !active || active === document.body || !active.isConnected || !!container?.contains(active)
      if (target && target.isConnected && focusIsOurs) target.focus({ preventScroll: true })
    }
  }, [])

  const apply = useCallback((date: Date | null) => {
    onSetNext(date)
    onClose()
  }, [onSetNext, onClose])

  const s = input.state
  const untouched = s.kind === 'unchanged'
  // The field's date: what it shows while untouched (`ruled`), null when empty.
  const fieldDate: Date | null | 'invalid' =
    untouched ? ruled : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (fieldDate === 'invalid') return
    // Sets the next follow-up only; a field that says what there is now (or,
    // mixed, nothing typed: each task's own) just closes.
    if (mixed ? !untouched : !sameDay(fieldDate, current)) apply(fieldDate)
    else onClose()
  }

  const { triggerProps: followedUpTipProps, tooltip: followedUpTip } = useTooltip(
    followedUpTooltip({ untouched, mixed, kept, fieldDate, current, proposal, today }),
  )
  // Only highlight "Mark followed up" when it would record something new.
  const doneToday = followedUpToday ?? isFollowedUpToday(todo, today)

  return createPortal(
    <PopoverRoot
      ref={setPanel}
      caret={caret}
      className={styles.popover}
      style={{ position: style.position, left: style.left, top: style.top }}
      role="dialog"
      aria-label="Follow-up"
      // The popover is portaled but React events still bubble to the row
      // (select / drag / open-detail handlers) — keep them inside.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <label className={styles.fieldLabel} htmlFor={`followup-next-${todo.id}`}>Next follow-up</label>
      <div className={`${styles.inputWrap} ${s.kind === 'invalid' ? styles.inputWrapError : ''}`}>
        <input
          id={`followup-next-${todo.id}`}
          ref={inputRef}
          className={styles.input}
          value={input.text}
          placeholder={mixed && untouched ? EACH_TASKS_OWN : NEXT_FOLLOWUP_PLACEHOLDER}
          onChange={(e) => input.change(e.target.value)}
          onKeyDown={handleKeyDown}
          {...selectOnFocus}
          aria-invalid={s.kind === 'invalid'}
          aria-describedby={`followup-next-help-${todo.id}`}
          autoComplete="off"
          spellCheck={false}
        />
        {untouched && input.storedHint && (
          <span className={styles.inputHint}>{input.storedHint}</span>
        )}
        {input.text !== '' && (
          <button
            type="button"
            className={styles.inputClear}
            aria-label="Clear next follow-up"
            title="Clear the date"
            onClick={() => {
              input.change('')
              inputRef.current?.focus()
            }}
          >
            &times;
          </button>
        )}
        <FollowupDateButton
          label="Pick next follow-up date"
          value={fieldDate instanceof Date ? fieldDate : undefined}
          onPick={apply}
        />
      </div>
      <div id={`followup-next-help-${todo.id}`} className={styles.help} aria-live="polite">
        {s.kind === 'valid' && (
          <>
            → <strong className={styles.helpDate}>{formatFollowupDate(s.date, today)}</strong>
            {' · '}{relativeDayPhrase(s.date, today)} · ⏎ to set
          </>
        )}
        {s.kind === 'invalid' && <span className={styles.helpError}>{s.message}</span>}
        {untouched && was && (isFollowupOverdue({ nextFollowupAt: was, isCompleted: false }, today)
          ? `Was ${formatWeekdayNumeric(was)} · overdue`
          : 'Was today')}
        {untouched && mixed && (proposal
          ? <>Future dates kept · the rest → <strong className={styles.helpDate}>{formatFollowupDate(proposal, today)}</strong></>
          : 'Future dates kept · the rest cleared')}
      </div>
      <FollowupQuickButtons
        intervals={QUICK_FOLLOWUP_INTERVALS}
        labelStyle="long"
        onPick={(i) => apply(addFollowupInterval(today, i))}
      />
      <div className={styles.separator} />
      <div className={styles.lastLine}>
        {todo.lastFollowupAt ? (
          <>
            Last followed up <strong>{formatFollowupDate(todo.lastFollowupAt, today)}</strong>
            {' · '}{relativeDayPhrase(todo.lastFollowupAt, today)}
          </>
        ) : 'Never followed up'}
      </div>
      <button
        ref={followedUpRef}
        type="button"
        className={`${styles.followedUpPrimary} ${doneToday ? styles.followedUpDone : ''}`}
        disabled={fieldDate === 'invalid'}
        {...followedUpTipProps}
        onClick={() => {
          if (fieldDate === 'invalid') return
          // Untouched: no date — the store keeps a later one per task.
          onFollowedUp(untouched ? undefined : fieldDate)
          onClose()
        }}
        data-done-today={doneToday ? 'true' : undefined}
      >
        <FollowedUpIcon />
        Mark followed up
      </button>
      {followedUpTip}
    </PopoverRoot>,
    document.body,
  )
}
