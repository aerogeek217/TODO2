import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { usePopoverAnchor, type PopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useFollowupInput, NEXT_FOLLOWUP_PLACEHOLDER } from '../../../hooks/use-followup-input'
import { useToday } from '../../../hooks/use-today'
import { useSettingsStore } from '../../../stores/settings-store'
import {
  addFollowupInterval,
  formatFollowupDate,
  isFollowedUpToday,
  relativeDayPhrase,
  QUICK_FOLLOWUP_INTERVALS,
} from '../../../utils/followup'
import { FollowedUpIcon } from '../FollowupIcons'
import { FollowupQuickButtons } from './FollowupQuickButtons'
import styles from './Followup.module.css'

interface FollowupPopoverProps {
  todo: PersistedTodoItem
  anchor: PopoverAnchor
  onClose: () => void
  /** Set (or with `null`, clear) the next follow-up. */
  onSetNext: (date: Date | null) => void
  /** "Followed up": last = now, next = today + the default interval. */
  onFollowedUp: () => void
  /**
   * Already followed up today (dims "Followed up"). Defaults to `todo`'s own
   * last follow-up; the bulk bar passes "every selected task".
   */
  followedUpToday?: boolean
  /**
   * What has focus on open: `followedUp` (default — ⏎ records a follow-up
   * today) or `next` (the Next follow-up field, its value selected — opened
   * to pick a date).
   */
  initialFocus?: 'followedUp' | 'next'
}

/**
 * Small popover for a task's follow-up, opened from the row's follow-up pill,
 * its empty-slot flag, the row menu or the bulk bar. It opens with focus on
 * "Followed up" (⏎ or a click stamps the task today), or on the Next
 * follow-up field (`initialFocus: 'next'`). Next follow-up takes an interval
 * or a date; quick buttons set common intervals. ⏎ in the field (valid
 * input) or a quick button applies and closes; Esc / outside click closes
 * without change. On close, focus goes back to what had it before (the
 * trigger) unless something else took it.
 */
export function FollowupPopover({ todo, anchor, onClose, onSetNext, onFollowedUp, followedUpToday, initialFocus = 'followedUp' }: FollowupPopoverProps) {
  const today = useToday()
  const interval = useSettingsStore((s) => s.followupDefaultInterval)
  const inputRef = useRef<HTMLInputElement>(null)
  const followedUpRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const input = useFollowupInput(todo.nextFollowupAt, 'next', today)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const s = input.state
    if (s.kind === 'valid') apply(s.date)
    else if (s.kind === 'empty') apply(null)
    else if (s.kind === 'unchanged') onClose()
  }

  const nextAfterFollowup = addFollowupInterval(today, interval)
  // Only highlight "Followed up" when it would record something new.
  const doneToday = followedUpToday ?? isFollowedUpToday(todo, today)
  const s = input.state

  return createPortal(
    <div
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
      <label className={styles.fieldLabel} htmlFor={`followup-next-${todo.id}`}>Next follow-up</label>
      <div className={`${styles.inputWrap} ${s.kind === 'invalid' ? styles.inputWrapError : ''}`}>
        <input
          id={`followup-next-${todo.id}`}
          ref={inputRef}
          className={styles.input}
          value={input.text}
          placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
          onChange={(e) => input.change(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-invalid={s.kind === 'invalid'}
          aria-describedby={`followup-next-help-${todo.id}`}
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
            aria-label="Clear follow-up"
            title="Clear follow-up"
            onClick={() => apply(null)}
          >
            &times;
          </button>
        )}
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
        onClick={() => { onFollowedUp(); onClose() }}
        data-done-today={doneToday ? 'true' : undefined}
      >
        <FollowedUpIcon />
        Followed up
        <span className={styles.followedUpHint}>· next {formatFollowupDate(nextAfterFollowup, today)}</span>
      </button>
    </div>,
    document.body,
  )
}
