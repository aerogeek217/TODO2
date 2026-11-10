import type { LensMark } from '../../hooks/use-widget-lens'
import { GlassesIcon } from './icons'
import { useTooltip } from './use-tooltip'
import styles from './LensSwitch.module.css'

/**
 * The top bar's lens on one widget (G3, board BD — the list's switch, made
 * the standard): on — glasses and `−N`, what it hides here; off — slashed
 * glasses, muted. A click turns it off / on for this widget (saved at
 * once) — or for the review deck's queue (item 10). A toggle button: its
 * name is fixed, `aria-pressed` its state. At the right end of the widget's
 * own header line, before the ⋯.
 */
export function LensSwitch({ lens, onToggle, noun = 'widget' }: {
  lens: LensMark
  onToggle: () => void
  /** What the tooltip calls the widget (`This list ignores …`). */
  noun?: string
}) {
  const tip = lens.ignored
    ? `This ${noun} ignores the lens “${lens.name}”\nClick to apply it${lens.hides > 0 ? ` (it hides ${lens.hides})` : ''}`
    : `“${lens.name}” hides ${lens.hides} here\nClick to ignore the lens in this ${noun}`
  const { triggerProps, tooltip } = useTooltip(tip, { labelLines: 1 })
  return (
    <>
      <button
        type="button"
        className={`${styles.lensSwitch} ${lens.ignored ? styles.lensSwitchOff : ''}`}
        // A toggle's name stays put; `aria-pressed` says whether it applies, the tooltip what it hides.
        aria-pressed={!lens.ignored}
        aria-label={`Apply the lens “${lens.name}” here`}
        data-testid="lens-switch"
        data-lens-switch=""
        onClick={(e) => {
          // Not the click of what holds it (a row, a small face).
          e.stopPropagation()
          onToggle()
        }}
        {...triggerProps}
      >
        <GlassesIcon size={14} slashed={lens.ignored} />
        {!lens.ignored && <span>−{lens.hides}</span>}
      </button>
      {tooltip}
    </>
  )
}
