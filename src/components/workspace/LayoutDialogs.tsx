import { useRef, useState } from 'react'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { isHueName, LAYOUT_NAME_MAX } from '../../models/workspace-layout'
import { HUE_PRESET_HEX, presetHueOf } from '../../utils/layout-hue'
import { ColorPicker } from '../shared/ColorPicker'
import { IconPickerButton } from '../shared/IconPickerButton'
import { iconDescription, iconSummary, layoutIcon, LAYOUT_DEFAULT_ICON, sameIcon, type IconValue } from '../../models/icon'
import { useRecentEmoji } from '../../hooks/use-recent-emoji'
import { deleteLayoutMessage } from './delete-layout-message'
import styles from './LayoutDialogs.module.css'

interface LayoutNameDialogProps {
  title: string
  confirmLabel: string
  initialName: string
  /** The empty field's hint (New layout, which starts empty). */
  placeholder?: string
  /** Edit layout: the layout's hue (a preset's name or a hex colour), offered as a swatch row + a colour input under the name (`null` = none). Absent = no swatches. */
  initialHue?: string | null
  /** Edit layout (with `initialHue`): the layout's icon as stored (absent: never picked — the layout glyph, J1). */
  initialIcon?: IconValue
  /** `hue` only when the dialog offers the swatches; `icon` only when one was picked in it (absent: unchanged). */
  onConfirm: (name: string, hue?: string | null, icon?: IconValue) => void
  onCancel: () => void
}

/**
 * "New layout…" / "Duplicate layout…" / "Edit…": one name field, prefilled
 * and selected; empty can't be confirmed. Edit… adds the Icon row (items
 * 11, 14: the one icon picker, the layout glyph marked while none is
 * picked) and the hue swatches (D19), in the icons board's order — Name,
 * Icon, Hue. Nothing is written before Apply.
 */
export function LayoutNameDialog({ title, confirmLabel, initialName, placeholder, initialHue, initialIcon, onConfirm, onCancel }: LayoutNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [hue, setHue] = useState<string | null>(initialHue ?? null)
  const [icon, setIcon] = useState<IconValue | undefined>(initialIcon)
  const withHue = initialHue !== undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const recent = useRecentEmoji()
  const trimmed = name.trim()
  const iconChanged = !sameIcon(icon, initialIcon)
  const submit = () => { if (trimmed) onConfirm(trimmed, withHue ? hue : undefined, withHue && iconChanged ? icon : undefined) }
  return (
    <Dialog open onClose={onCancel} title={title} initialFocusRef={inputRef}>
      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className={styles.form}
      >
        <label className={styles.label}>
          Name
          <input
            ref={inputRef}
            className={styles.input}
            value={name}
            placeholder={placeholder}
            maxLength={LAYOUT_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        {withHue && (
          <div className={styles.iconField}>
            <span className={styles.iconCaption}>Icon</span>
            <IconPickerButton
              shown={layoutIcon({ icon })}
              ariaLabel={`Icon: ${icon ? iconDescription(icon) : 'Layout icon (the default)'}. Change`}
              summary={icon ? iconSummary(icon) : 'The layout icon'}
              value={icon}
              fallback={LAYOUT_DEFAULT_ICON}
              recent={recent}
              label={`Icon of “${trimmed || initialName}”`}
              onPick={(picked) => { if (picked.kind !== 'status') setIcon(picked) }}
            />
          </div>
        )}
        {withHue && <HueSwatches value={hue} onChange={setHue} />}
        <DialogActions>
          <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={!trimmed}>{confirmLabel}</button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** The colour the picker shows while the layout has no hue (None). */
const NO_HUE_COLOR = '#8a7cf0'

/**
 * The layout's hue: None (the accent) before the app's colour picker
 * (`ColorPicker`, the one the people, status and tag editors use — the six
 * preset hues as swatches, then the colour input). A preset is stored by
 * name (it has a light twin); any other colour as its hex, used as it is in
 * both themes.
 */
function HueSwatches({ value, onChange }: { value: string | null; onChange: (hue: string | null) => void }) {
  const customOn = value != null && !isHueName(value)
  // What the picker shows: a preset's colour, the custom colour, or a start while None.
  const shown = value == null ? NO_HUE_COLOR : isHueName(value) ? HUE_PRESET_HEX[value] : value
  const none = (
    <input
      type="radio"
      name="layout-hue-none"
      className={`${styles.swatch} ${styles.swatchNone}`}
      checked={value == null}
      onChange={() => onChange(null)}
      aria-label="None (the accent)"
      title="None (the accent)"
      data-hue="none"
    />
  )
  return (
    <fieldset className={styles.hues}>
      <legend className={styles.huesLegend}>Hue</legend>
      <div data-hue-custom data-on={customOn || undefined}>
        <ColorPicker value={shown} onChange={(hex) => onChange(presetHueOf(hex) ?? hex)} before={none} />
      </div>
    </fieldset>
  )
}

interface DeleteLayoutDialogProps {
  layoutName: string
  /** How many of its lists go with it. */
  ownedLists?: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteLayoutDialog({ layoutName, ownedLists = 0, onConfirm, onCancel }: DeleteLayoutDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open onClose={onCancel} title={`Delete layout “${layoutName}”?`} initialFocusRef={cancelRef}>
      <DialogBody>{deleteLayoutMessage(ownedLists)}</DialogBody>
      <DialogActions>
        <button ref={cancelRef} type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.danger} onClick={onConfirm}>Delete layout</button>
      </DialogActions>
    </Dialog>
  )
}
