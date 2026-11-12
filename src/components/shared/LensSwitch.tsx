import type { LensMark } from '../../hooks/use-widget-lens'
import { GlassesIcon } from './icons'
import { useTooltip } from './use-tooltip'
import styles from './LensSwitch.module.css'

/**
 * The top bar's lens on one widget (G3, board BD — the list's switch, made
 * the standard): on — glasses and `−N`, what it hides here; off — slashed
 * glasses, muted. A click turns it off / on for this widget (saved at
 * once). A toggle button: its
 * name is fixed, `aria-pressed` its state. At the right end of the widget's
 * own header line, before the ⋯.
 *
 * In a workspace cell on desktop it is `quiet` (UX cleanup 2A, as the user
 * restated it: visible while it has an effect): while the lens hides at least
 * one task here (`−N`, N ≥ 1) it shows at rest, as does a widget ignoring the
 * lens; following it with nothing hidden here (`−0`) it shows only while the
 * cell is hovered or holds the focus. Hidden, it keeps its room — its `−0`
 * drawn invisibly, so N crossing 0 doesn't move the line — and takes no press
 * (`pointer-events: none`), but stays a tab stop: focusing it shows it.
 */
export function LensSwitch({ lens, onToggle, noun = 'widget', quiet = false }: {
  lens: LensMark
  onToggle: () => void
  /** What the tooltip calls the widget (`This list ignores …`). */
  noun?: string
  /** In a desktop cell: hidden at rest while it follows the lens and hides nothing there. */
  quiet?: boolean
}) {
  const tip = lens.ignored
    ? `This ${noun} ignores the lens “${lens.name}”\nClick to apply it${lens.hides > 0 ? ` (it hides ${lens.hides})` : ''}`
    : `“${lens.name}” hides ${lens.hides} here\nClick to ignore the lens in this ${noun}`
  const { triggerProps, tooltip } = useTooltip(tip, { labelLines: 1 })
  // Hidden at rest only while it has no effect here: following the lens, hiding nothing.
  const hidden = quiet && !lens.ignored && lens.hides === 0
  return (
    <>
      <button
        type="button"
        className={[
          styles.lensSwitch,
          lens.ignored ? styles.lensSwitchOff : '',
          hidden ? styles.quiet : '',
        ].join(' ')}
        // A toggle's name stays put; `aria-pressed` says whether it applies, the tooltip what it hides.
        aria-pressed={!lens.ignored}
        aria-label={`Apply the lens “${lens.name}” here`}
        data-testid="lens-switch"
        data-lens-switch=""
        data-quiet={hidden ? '' : undefined}
        // What it hides here (also its `−N`, drawn invisibly while it is hidden).
        data-lens-hides={lens.hides}
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
