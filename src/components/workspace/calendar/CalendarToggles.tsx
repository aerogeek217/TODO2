import { type CalendarDateType, type CalendarDateTypes } from '../../../models/workspace-layout'
import { DateBar } from '../../shared/DateBar'
import { TitlesIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'

/** The calendar toolbar's toggles: each date type, and Titles. */

const TOGGLE_WORDS: Record<CalendarDateType, { label: string; tip: string }> = {
  due: { label: 'Due', tip: 'Show due dates' },
  followup: { label: 'Follow-up', tip: 'Show next follow-ups' },
  plan: { label: 'Plans', tip: 'Show planned days' },
}

/** A date type's toggle: its bar — a plan's the hollow bar — and its name (or the bar alone, `iconOnly`). */
export function TypeToggle({ type, types, iconOnly, onToggle }: {
  type: CalendarDateType
  types: CalendarDateTypes
  iconOnly: boolean
  onToggle: (type: CalendarDateType) => void
}) {
  const on = types[type]
  const { label, tip } = TOGGLE_WORDS[type]
  return (
    <button
      type="button"
      className={`${styles.typeToggle} ${iconOnly ? styles.typeToggleIcon : ''}`}
      data-type={type}
      aria-pressed={on}
      aria-label={iconOnly ? label : undefined}
      data-tooltip={iconOnly ? `${tip} (${label})` : tip}
      onClick={() => onToggle(type)}
    >
      {type === 'plan'
        ? <span className={styles.planBar} aria-hidden="true" />
        : <DateBar type={type} level={on ? 'soon' : 'later'} />}
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}

/** Month view: a bar per entry with its title (on) or the heat map (off, the default). */
export function TitlesToggle({ on, iconOnly, onToggle }: { on: boolean; iconOnly: boolean; onToggle: () => void }) {
  const tip = on ? 'Show the month as a heat map' : 'Show task titles in the month'
  return (
    <button
      type="button"
      className={`${styles.typeToggle} ${styles.titlesToggle} ${iconOnly ? styles.typeToggleIcon : ''}`}
      aria-pressed={on}
      aria-label={iconOnly ? 'Titles' : undefined}
      data-tooltip={iconOnly ? `${tip} (Titles)` : tip}
      onClick={onToggle}
    >
      <TitlesIcon size={12} />
      {!iconOnly && <span>Titles</span>}
    </button>
  )
}
