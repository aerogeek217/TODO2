import { useMemo, useRef, useState } from 'react'
import { useLensHideCounts } from '../../../hooks/use-lens-counts'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { usePickedLens } from '../../../stores/screen-filter'
import type { Lens } from '../../../utils/lens'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { ChevronDownIcon, GearIcon, GlassesIcon } from '../icons'
import { useTooltip } from '../use-tooltip'
import { useChipNames } from './filter-menu'
import { lensSummary } from './lens-text'
import styles from './LensControl.module.css'

/**
 * The top bar's lens control, first in the tray after the search: the top
 * bar's lens, the same on every layout. Two buttons: the glasses (accent
 * while the lens is on) lift it for now and put it back — slashed, the name
 * struck through, while lifted; the pick stays — and the name opens the
 * picker (No lens, each lens with its filters in a line and how many open
 * tasks it hides, Edit lenses…). A pick is saved at once
 * (`settings-store.setActiveLens`): no unsaved state, no undo step.
 */
export function LensControl() {
  const lenses = useSettingsStore((s) => s.lenses)
  const lens = usePickedLens()
  const lifted = useUIStore((s) => s.lensLifted)
  const state = !lens ? 'none' : lifted ? 'lifted' : 'on'
  const nameRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // A click on the name while its menu is open closes it (the menu's outside click already did).
  const menuWasOpen = useRef(false)
  const toggleTip = useTooltip(!lens ? null : lifted ? `Put “${lens.name}” back` : `Lift “${lens.name}” for now\nThe pick stays`)
  const nameTip = useTooltip(menuOpen ? null : 'Lens')

  return (
    <span className={styles.lens} data-state={state} data-testid="lens-control">
      {lens ? (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={!lifted}
          aria-label={lifted ? 'Lens lifted. Put it back' : 'Lens on. Lift it'}
          onClick={() => useUIStore.getState().setLensLifted(!lifted)}
          {...toggleTip.triggerProps}
        >
          <GlassesIcon slashed={lifted} />
        </button>
      ) : (
        <span className={styles.toggle} aria-hidden="true"><GlassesIcon /></span>
      )}
      <button
        ref={nameRef}
        type="button"
        className={styles.name}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={lens ? `Lens: ${lens.name}${lifted ? ', lifted' : ''}` : 'Lens: none'}
        onMouseDown={() => { menuWasOpen.current = menuOpen }}
        onClick={() => {
          if (menuWasOpen.current) {
            menuWasOpen.current = false
            return
          }
          setMenuOpen(true)
        }}
        {...nameTip.triggerProps}
      >
        <span className={styles.nameText}>{lens?.name ?? 'No lens'}</span>
        <ChevronDownIcon />
      </button>
      {toggleTip.tooltip}
      {nameTip.tooltip}
      {menuOpen && <LensMenu lenses={lenses} lensId={lens?.id ?? null} anchorRef={nameRef} onClose={() => setMenuOpen(false)} />}
    </span>
  )
}

/** The lens picker: its own component, so the counts are only made while it is open. */
function LensMenu({ lenses, lensId, anchorRef, onClose }: {
  lenses: readonly Lens[]
  lensId: string | null
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const names = useChipNames()
  const counts = useLensHideCounts(lenses)
  const pick = (id: string | null) => {
    useUIStore.getState().setLensLifted(false)
    void useSettingsStore.getState().setActiveLens(id)
  }
  const entries = useMemo<MenuEntry[]>(() => [
    { kind: 'label', text: 'Lens · hides tasks on every widget' },
    { kind: 'item', label: 'No lens', radio: true, indicator: 'radio', checked: lensId == null, note: `${counts.open} shown`, onSelect: () => pick(null) },
    ...(lenses.length > 0 ? [{ kind: 'separator' } as const] : []),
    ...lenses.map((l): MenuEntry => ({
      kind: 'item',
      label: l.name,
      radio: true,
      indicator: 'radio',
      checked: l.id === lensId,
      description: lensSummary(l, names),
      note: `hides ${counts.hides.get(l.id) ?? 0}`,
      onSelect: () => pick(l.id),
    })),
    { kind: 'separator' },
    { kind: 'item', label: 'Edit lenses…', icon: <GearIcon size={14} />, onSelect: () => useUIStore.getState().openSettings('lenses') },
    { kind: 'note', text: 'The glasses switch the lens off and on without changing it. Filters set in the bar apply on top.' },
  ], [lenses, lensId, counts, names])
  return <MenuPopover anchorRef={anchorRef} placement="bottom-start" width={300} label="Lens" entries={entries} onClose={onClose} />
}
