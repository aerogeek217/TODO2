import { useId, useState } from 'react'
import { useLensHideCounts } from '../../hooks/use-lens-counts'
import { usePickedLens } from '../../stores/screen-filter'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { GlassesIcon } from '../shared/icons'
import { useChipNames } from '../shared/filters/filter-menu'
import { lensSummary } from '../shared/filters/lens-text'
import sheet from '../shared/filters/FilterChipBarMobile.module.css'
import styles from './FilterSheetLens.module.css'

/**
 * The phone filter sheet's first section (D15 board F): the top bar's lens,
 * the same on every layout — a radio list (No lens with the open count,
 * each lens with its filters in a line and how many open tasks it hides) —
 * and "Lift the lens for now", as the desktop lens control's glasses. A
 * pick is saved at once (`settings-store.setActiveLens`).
 */
export function FilterSheetLens() {
  const lenses = useSettingsStore((s) => s.lenses)
  const lens = usePickedLens()
  const lifted = useUIStore((s) => s.lensLifted)
  const [open, setOpen] = useState(true)
  const names = useChipNames()
  const counts = useLensHideCounts(lenses)
  const groupName = useId()
  const pick = (id: string | null) => {
    useUIStore.getState().setLensLifted(false)
    void useSettingsStore.getState().setActiveLens(id)
  }
  return (
    <div className={sheet.entitySection} data-testid="sheet-lens">
      <div className={sheet.entityHeader} onClick={() => setOpen(!open)}>
        <span className={sheet.filterLabel}>
          <span className={`${styles.glyph} ${lens && !lifted ? styles.glyphOn : ''}`}><GlassesIcon slashed={lens != null && lifted} /></span>
          Lens
        </span>
        <span className={`${sheet.sectionValue} ${lens ? sheet.sectionValueOn : ''} ${lifted ? styles.struck : ''}`}>{lens?.name ?? 'No lens'}</span>
        <span className={`${sheet.entityChevron} ${open ? sheet.entityChevronOpen : ''}`}>▸</span>
      </div>
      {open && (
        <div className={styles.body}>
          <div role="radiogroup" aria-label="Lens" className={styles.options}>
            <label className={styles.option}>
              <input type="radio" name={groupName} checked={lens == null} onChange={() => pick(null)} />
              <span className={styles.name}>No lens</span>
              <span className={styles.count}>{counts.open}</span>
            </label>
            {lenses.map((l) => (
              <label key={l.id} className={styles.option}>
                <input type="radio" name={groupName} checked={l.id === lens?.id} onChange={() => pick(l.id)} />
                <span className={styles.words}>
                  <span className={styles.name}>{l.name}</span>
                  <span className={styles.summary}>{lensSummary(l, names)}</span>
                </span>
                <span className={styles.count}>hides {counts.hides.get(l.id) ?? 0}</span>
              </label>
            ))}
          </div>
          {lens && (
            <button
              type="button"
              className={styles.lift}
              aria-pressed={lifted}
              onClick={() => useUIStore.getState().setLensLifted(!lifted)}
            >
              Lift the lens for now · shows all <b>{counts.open}</b>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
