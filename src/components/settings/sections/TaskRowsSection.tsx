import { Fragment } from 'react'
import { useSettingsStore, type RowDates } from '../../../stores/settings-store'
import { LIST_ZOOM_SETTING_LABELS, LIST_ZOOM_SETTINGS } from '../../../utils/list-zoom'
import { MARKER_KEYS } from '../../../models'
import { MARKER_LABELS } from '../../../utils/markers'
import { PriorityRing } from '../../shared/PriorityRing'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

const DATES_OPTIONS: ReadonlyArray<{ dates: RowDates; label: string }> = [
  { dates: 'relative', label: 'Relative' },
  { dates: 'numeric', label: 'MM/DD' },
]

/** The sample checkbox beside each priority's name, px. */
const CUE_RING_SIZE = 16

/** An on / off switch row's control. */
function Switch({ label, on, onFlip }: { label: string; on: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`${styles.switch} ${on ? styles.switchOn : ''}`}
      onClick={onFlip}
    />
  )
}

/** What each priority adds to a task's row, beside its ring on the checkbox (D25 B; each name shows its ring). */
function PriorityCuesSetting() {
  const cues = useSettingsStore((s) => s.priorityCues)
  const setCues = useSettingsStore((s) => s.setPriorityCues)
  return (
    <SettingRow label="Priority cues" help="Beside the ring on each task's checkbox. Several glows blend along the row." column>
      <div className={styles.cueGrid}>
        <span />
        <span className={styles.cueHead}>Glow</span>
        <span className={styles.cueHead}>Semibold</span>
        {MARKER_KEYS.map((key) => (
          <Fragment key={key}>
            <span className={styles.cueName}>
              <span className={styles.cueRing} aria-hidden="true" data-cue-ring={key}>
                <PriorityRing
                  summary={{ focus: key === 'focus', urgent: key === 'urgent' ? 'flag' : null, important: key === 'important' }}
                  completed={false}
                  size={CUE_RING_SIZE}
                />
              </span>
              {MARKER_LABELS[key]}
            </span>
            <Switch label={`${MARKER_LABELS[key]} glow`} on={cues[key].glow} onFlip={() => void setCues({ ...cues, [key]: { ...cues[key], glow: !cues[key].glow } })} />
            <Switch label={`${MARKER_LABELS[key]} semibold`} on={cues[key].semibold} onFlip={() => void setCues({ ...cues, [key]: { ...cues[key], semibold: !cues[key].semibold } })} />
          </Fragment>
        ))}
      </div>
    </SettingRow>
  )
}

/** Which tasks are stale, in words, for the stale rows' help (the threshold is Tasks › Rules). */
function staleWords(days: number): string {
  return days === 0
    ? 'Nothing goes stale now: Tasks › Rules › Stale after is 0.'
    : `Stale: no change for ${days} ${days === 1 ? 'day' : 'days'} (Tasks › Rules).`
}

/**
 * Appearance › Task rows: how a task's row looks — the default list zoom, how
 * dates read, what a priority adds, and how a stale task shows (its fade and
 * its cobweb; which tasks are stale is Tasks › Rules).
 */
export function TaskRowsSection() {
  const listZoom = useSettingsStore((s) => s.listZoom)
  const setListZoom = useSettingsStore((s) => s.setListZoom)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const setRowDates = useSettingsStore((s) => s.setRowDates)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const staleFade = useSettingsStore((s) => s.staleFade)
  const setStaleFade = useSettingsStore((s) => s.setStaleFade)
  const staleCobwebs = useSettingsStore((s) => s.staleCobwebs)
  const setStaleCobwebs = useSettingsStore((s) => s.setStaleCobwebs)

  return (
    <div className={styles.section}>
      <SettingRow
        label="Default list zoom"
        help="How a list tab draws its tasks until you zoom it (Ctrl + scroll over the list, or its tab menu): Auto is Stacked in a list narrower than 480px and Rows in a wider one, Stacked puts the details under the name, Rows one row per task, Lines the names alone."
      >
        <div className={styles.segmented} role="radiogroup" aria-label="Default list zoom">
          {LIST_ZOOM_SETTINGS.map((zoom) => (
            <button
              key={zoom}
              type="button"
              role="radio"
              aria-checked={listZoom === zoom}
              className={`${styles.segment} ${listZoom === zoom ? styles.segmentActive : ''}`}
              onClick={() => void setListZoom(zoom)}
            >
              {LIST_ZOOM_SETTING_LABELS[zoom]}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Dates" help="How task rows show due and follow-up dates. Relative says Today, the weekday for the next six days, else 11/20; MM/DD always says 11/20.">
        <div className={styles.segmented} role="radiogroup" aria-label="Dates">
          {DATES_OPTIONS.map(({ dates, label }) => (
            <button
              key={dates}
              type="button"
              role="radio"
              aria-checked={rowDates === dates}
              className={`${styles.segment} ${rowDates === dates ? styles.segmentActive : ''}`}
              onClick={() => void setRowDates(dates)}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>
      <PriorityCuesSetting />
      <SettingRow label="Fade stale tasks" help={`A stale task's row is drawn faded until you point at it. ${staleWords(staleAfterDays)}`}>
        <Switch label="Fade stale tasks" on={staleFade} onFlip={() => void setStaleFade(!staleFade)} />
      </SettingRow>
      <SettingRow label="Cobwebs on stale tasks" help="A stale task gathers a small cobweb in its checkbox.">
        <Switch label="Cobwebs on stale tasks" on={staleCobwebs} onFlip={() => void setStaleCobwebs(!staleCobwebs)} />
      </SettingRow>
    </div>
  )
}
