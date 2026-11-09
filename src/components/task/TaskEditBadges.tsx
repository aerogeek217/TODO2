import { useEffect, useRef, useState } from 'react'
import { DEFAULT_STATUS_ICON, type Status } from '../../models'
import { FocusIcon, ImportantIcon, UrgentClockIcon, UrgentIcon } from '../shared/MarkerIcons'
import { PopoverRoot } from '../shared/PopoverRoot'
import { StatusIcon } from '../shared/StatusIcon'
import { useTooltip } from '../shared/use-tooltip'
import type { UrgentMark } from '../../utils/urgency'
import styles from './TaskEditPopup.module.css'

export interface TaskEditBadgesProps {
  statuses: readonly Status[]
  statusId: number | undefined
  /** A status picked (undefined: No Status). */
  onStatusChange: (statusId: number | undefined) => void
  focusOn: boolean
  urgentOn: boolean
  importantOn: boolean
  /** `urgentMark`: `date` while urgent by its due date only (the faint clock after the label). */
  urgentState: UrgentMark
  /** The due date's hint for the Urgent tooltip (`urgentToggleHint`). */
  urgentHint: string
  onToggleFocus: () => void
  onToggleUrgent: () => void
  onToggleImportant: () => void
}

/**
 * The task layout's badges (D26 BB / BG — the task editor and the review
 * card alike): the status pill (its menu: No Status, then each status;
 * outside press or Esc closes the menu only, Esc handing the focus back to
 * the pill — never the dialog around it, cr31 T8) and, after a rule, the
 * marker toggles in display order (Focus › Urgent › Important). The Urgent
 * toggle shows and flips the flag only; a due date that makes the task
 * urgent anyway is a hint (the clock after the label, the tooltip). What
 * the callbacks write is the host's.
 */
export function TaskEditBadges({
  statuses, statusId, onStatusChange,
  focusOn, urgentOn, importantOn, urgentState, urgentHint,
  onToggleFocus, onToggleUrgent, onToggleImportant,
}: TaskEditBadgesProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showStatusMenu) return
    const handler = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      setShowStatusMenu(false)
      statusMenuRef.current?.querySelector<HTMLElement>('button')?.focus()
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [showStatusMenu])

  const status = statusId != null ? statuses.find((s) => s.id === statusId) : undefined
  const pick = (id: number | undefined) => {
    setShowStatusMenu(false)
    onStatusChange(id)
  }

  return (
    <div className={styles.badges}>
      {statuses.length > 0 && (
        <div className={styles.priorityWrapper} ref={statusMenuRef}>
          <button
            type="button"
            className={styles.badge}
            aria-label={`Status: ${status?.name ?? 'No status'}`}
            aria-haspopup="menu"
            aria-expanded={showStatusMenu}
            onClick={() => setShowStatusMenu((v) => !v)}
          >
            {status ? (
              <><span style={{ color: status.color }}><StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled /></span> {status.name}</>
            ) : (
              'Status'
            )}
            {' '}&#x25BE;
          </button>
          {showStatusMenu && (
            <PopoverRoot className={styles.statusMenu}>
              <button
                type="button"
                className={`${styles.statusOption} ${!statusId ? styles.statusOptionActive : ''}`}
                onClick={(e) => { e.stopPropagation(); pick(undefined) }}
              >
                <span style={{ color: 'var(--color-text-muted)' }}><StatusIcon icon="circle" /></span>
                No Status
              </button>
              {statuses.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`${styles.statusOption} ${statusId === s.id ? styles.statusOptionActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); pick(s.id) }}
                >
                  <span style={{ color: s.color }}><StatusIcon icon={s.icon || DEFAULT_STATUS_ICON} filled /></span>
                  {s.name}
                </button>
              ))}
            </PopoverRoot>
          )}
        </div>
      )}
      {statuses.length > 0 && <span className={styles.badgeDivider} aria-hidden="true" />}
      <MarkerToggle
        className={`${styles.markerToggle} ${focusOn ? styles.markerToggleFocusOn : ''}`}
        pressed={focusOn}
        onClick={onToggleFocus}
        tooltip={focusOn ? 'Remove from Focus' : 'Add to Focus'}
      >
        <FocusIcon /> Focus
      </MarkerToggle>
      <MarkerToggle
        className={`${styles.markerToggle} ${urgentOn ? styles.markerToggleUrgentOn : ''}`}
        pressed={urgentOn}
        onClick={onToggleUrgent}
        tooltip={`${urgentOn ? 'Remove urgent' : 'Mark urgent'}${urgentHint ? `\n${urgentHint}` : ''}`}
        data-urgent={urgentState ?? undefined}
      >
        <UrgentIcon /> Urgent
        {urgentState === 'date' && (
          <span className={styles.markerToggleHint} data-urgent-hint=""><UrgentClockIcon /></span>
        )}
      </MarkerToggle>
      <MarkerToggle
        className={`${styles.markerToggle} ${importantOn ? styles.markerToggleImportantOn : ''}`}
        pressed={importantOn}
        onClick={onToggleImportant}
        tooltip={importantOn ? 'Remove important' : 'Mark important'}
      >
        <ImportantIcon outline={!importantOn} /> Important
      </MarkerToggle>
    </div>
  )
}

/** A marker toggle (Focus / Urgent / Important) with its tooltip. */
function MarkerToggle({ className, pressed, onClick, tooltip, children, ...rest }: {
  className: string
  pressed: boolean
  onClick: () => void
  tooltip: string
  children: React.ReactNode
  'data-urgent'?: string
}) {
  const { triggerProps, tooltip: tip } = useTooltip(tooltip)
  return (
    <button type="button" className={className} aria-pressed={pressed} onClick={onClick} {...rest} {...triggerProps}>
      {children}
      {tip}
    </button>
  )
}
