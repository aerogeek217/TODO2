import { type CalendarDateType, type CalendarDateTypes } from '../../../models/workspace-layout'
import { DateBar } from '../../shared/DateBar'
import { TitlesIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'

/** The calendar toolbar's toggles: each date type, and Titles. */

export function TypeToggle({ type, types, iconOnly, onToggle }: {
  type: CalendarDateType
  types: CalendarDateTypes
  iconOnly: boolean
  onToggle: (type: CalendarDateType) => void
}) {
  const on = types[type]
  const label = type === 'due' ? 'Due' : 'Follow-up'
  const tip = type === 'due' ? 'Show due dates' : 'Show next follow-ups'
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
      <DateBar type={type} level={on ? 'soon' : 'later'} />
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
