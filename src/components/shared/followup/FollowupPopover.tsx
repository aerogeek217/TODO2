import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { usePopoverAnchor, type PopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useFollowupInput, NEXT_FOLLOWUP_PLACEHOLDER } from '../../../hooks/use-followup-input'
import { useToday } from '../../../hooks/use-today'
import { useSettingsStore } from '../../../stores/settings-store'
import {
  addFollowupInterval,
  formatFollowupDate,
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
}

/**
 * Small popover for a task's follow-up, opened from the row's follow-up pill,
 * its empty-slot flag, or the row menu. Next follow-up takes an interval or a
 * date; quick buttons set common intervals; "Followed up" stamps the task.
 * ⏎ (valid input) or a quick button applies and closes; Esc / outside click
 * closes without change.
 */
export function FollowupPopover({ todo, anchor, onClose, onSetNext, onFollowedUp }: FollowupPopoverProps) {
  const today = useToday()
  const interval = useSettingsStore((s) => s.followupDefaultInterval)
  const inputRef = useRef<HTMLInputElement>(null)
  const input = useFollowupInput(todo.nextFollowupAt, 'next', today)
  const { panelRef, style } = usePopoverAnchor({ anchor, open: true, onClose })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
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
  const s = input.state

  return createPortal(
    <div
      ref={panelRef}
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
        type="button"
        className={styles.followedUpPrimary}
        onClick={() => { onFollowedUp(); onClose() }}
      >
        <FollowedUpIcon />
        Followed up
        <span className={styles.followedUpHint}>· next {formatFollowupDate(nextAfterFollowup, today)}</span>
      </button>
    </div>,
    document.body,
  )
}
