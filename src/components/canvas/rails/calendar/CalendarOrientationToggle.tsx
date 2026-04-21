import type { CalendarOrientation } from '../../../../models/canvas-rails'
import styles from './CalendarOrientationToggle.module.css'

interface CalendarOrientationToggleProps {
  orientation: CalendarOrientation
  onChange: (o: CalendarOrientation) => void
}

export function CalendarOrientationToggle({ orientation, onChange }: CalendarOrientationToggleProps) {
  return (
    <span
      className={`${styles.toggle} nopan nodrag`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        draggable={false}
        className={orientation === 'vertical' ? styles.btnActive : styles.btn}
        onClick={() => onChange('vertical')}
        aria-pressed={orientation === 'vertical'}
        title="Vertical — one row per day"
      >
        ☰
      </button>
      <button
        type="button"
        draggable={false}
        className={orientation === 'horizontal' ? styles.btnActive : styles.btn}
        onClick={() => onChange('horizontal')}
        aria-pressed={orientation === 'horizontal'}
        title="Horizontal — dates across the top"
      >
        ☷
      </button>
    </span>
  )
}
