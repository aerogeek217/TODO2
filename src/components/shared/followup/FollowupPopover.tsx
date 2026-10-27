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
  /** "Mark followed up": last = now, next = `next` — the Next field's date (`null` = none). */
  onFollowedUp: (next: Date | null) => void
  /**
   * Already followed up today (dims "Mark followed up"). Defaults to `todo`'s own
   * last follow-up; the bulk bar passes "every selected task".
   */
  followedUpToday?: boolean
  /**
   * The next follow-up there is now — the `Now:` hint, and what ⏎ compares
   * the field with. Defaults to `todo`'s own; the bulk bar passes the
   * selection's (`'mixed'` when the tasks differ).
   */
  current?: Date | null | 'mixed'
  /**
   * What has focus on open: `followedUp` (default — ⏎ records a follow-up
   * today) or `next` (the Next follow-up field, its value selected — opened
   * to pick a date).
   */
  initialFocus?: 'followedUp' | 'next'
}

/** Same day, or both none. */
function sameDay(a: Date | null, b: Date | null): boolean {
  return (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null)
}

/**
 * Small popover for a task's follow-up, opened from the row's follow-up pill,
 * its empty-slot flag, the row menu or the bulk bar. The Next follow-up field
 * opens on what "Mark followed up" will set (Settings' automatic next
 * follow-up: today + the interval, or empty while that is off); the label's
 * `Now:` says what the task has. Mark followed up (focused on open, so ⏎
 * records; or the field, `initialFocus: 'next'`) stamps today and sets the
 * field's date — empty clears it, text that isn't a date disables it. The
 * field takes an interval or a date, or a day from the browser's date picker
 * (its calendar button); quick buttons set common intervals. Focusing the
 * field (click, Tab) selects its text, so typing replaces the proposal. ⏎ in the field
 * (when it differs from now), a picked day or a quick button sets the next
 * follow-up only and closes; the field's × empties it; Esc / outside click
 * closes without change. On close, focus goes back to what had it before
 * (the trigger) unless something else took it.
 */
export function FollowupPopover({
  todo, anchor, onClose, onSetNext, onFollowedUp, followedUpToday, current: currentProp, initialFocus = 'followedUp',
}: FollowupPopoverProps) {
  const today = useToday()
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  // What Mark followed up sets unless the field is edited: the field starts on it.
  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const inputRef = useRef<HTMLInputElement>(null)
  const followedUpRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const input = useFollowupInput(proposal ?? undefined, 'next', today)
  // The field holds a proposal the user usually replaces: focus selects it.
  const selectOnFocus = useSelectAllOnFocus()
  const { panelRef, style } = usePopoverAnchor({ anchor, open: true, onClose })
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
  // The field's date: the proposal while untouched, null when empty.
  const fieldDate: Date | null | 'invalid' =
    s.kind === 'unchanged' ? proposal : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'
  const current = currentProp !== undefined ? currentProp : (todo.nextFollowupAt ?? null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (fieldDate === 'invalid') return
    // Sets the next follow-up only; a field that says what there is now just closes.
    if (current === 'mixed' || !sameDay(fieldDate, current)) apply(fieldDate)
    else onClose()
  }

  const { triggerProps: followedUpTipProps, tooltip: followedUpTip } = useTooltip(
    fieldDate === null
      ? 'Record a follow-up today and clear the next follow-up'
      : 'Record a follow-up today and set the next follow-up to the date above',
  )
  // Only highlight "Mark followed up" when it would record something new.
  const doneToday = followedUpToday ?? isFollowedUpToday(todo, today)
  const nowText = current === 'mixed' ? 'mixed' : current ? formatWeekdayNumeric(current) : 'none'

  return createPortal(
    <PopoverRoot
      ref={setPanel}
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
      <div className={styles.fieldLabelRow}>
        <label className={styles.fieldLabel} htmlFor={`followup-next-${todo.id}`}>Next follow-up</label>
        <span className={styles.fieldNow} id={`followup-now-${todo.id}`} data-followup-now="">Now: {nowText}</span>
      </div>
      <div className={`${styles.inputWrap} ${s.kind === 'invalid' ? styles.inputWrapError : ''}`}>
        <input
          id={`followup-next-${todo.id}`}
          ref={inputRef}
          className={styles.input}
          value={input.text}
          placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
          onChange={(e) => input.change(e.target.value)}
          onKeyDown={handleKeyDown}
          {...selectOnFocus}
          aria-invalid={s.kind === 'invalid'}
          aria-describedby={`followup-now-${todo.id} followup-next-help-${todo.id}`}
          autoComplete="off"
          spellCheck={false}
        />
        {s.kind === 'unchanged' && input.storedHint && (
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
          onFollowedUp(fieldDate)
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
