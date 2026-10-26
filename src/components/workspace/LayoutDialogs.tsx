import { useRef, useState } from 'react'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { HUE_NAMES, isHueName, LAYOUT_NAME_MAX, type HueName } from '../../models/workspace-layout'
import { HUE_LABEL, hueColor } from '../../utils/layout-hue'
import { ColorInput } from '../shared/ColorInput'
import { deleteLayoutMessage } from './delete-layout-message'
import styles from './LayoutDialogs.module.css'

interface UnsavedChangesDialogProps {
  layoutName: string
  /** What the user is about to do, e.g. `You’re switching to “Daily”.` */
  lead: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** "Save changes to layout …?" — Save / Discard / Cancel before leaving a layout with unsaved changes. */
export function UnsavedChangesDialog({ layoutName, lead, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const saveRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open onClose={onCancel} title={`Save changes to layout “${layoutName}”?`} initialFocusRef={saveRef} nested>
      <DialogBody>
        {lead} If you don’t save, your changes to “{layoutName}” will be lost.
      </DialogBody>
      <DialogActions className={styles.actions}>
        <button type="button" className={styles.dangerGhost} onClick={onDiscard}>Discard</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button ref={saveRef} type="button" className={styles.primary} onClick={onSave}>Save layout</button>
      </DialogActions>
    </Dialog>
  )
}

interface LayoutNameDialogProps {
  title: string
  confirmLabel: string
  initialName: string
  /** The empty field's hint (New layout, which starts empty). */
  placeholder?: string
  /** Edit layout: the layout's hue (a preset's name or a hex colour), offered as a swatch row + a colour input under the name (`null` = none). Absent = no swatches. */
  initialHue?: string | null
  /** `hue` only when the dialog offers the swatches. */
  onConfirm: (name: string, hue?: string | null) => void
  onCancel: () => void
}

/**
 * "New layout…" / "Save as new layout…" / "Edit…": one name field, prefilled
 * and selected; empty can't be confirmed. Edit… adds the hue swatches (D19).
 */
export function LayoutNameDialog({ title, confirmLabel, initialName, placeholder, initialHue, onConfirm, onCancel }: LayoutNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [hue, setHue] = useState<string | null>(initialHue ?? null)
  const withHue = initialHue !== undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = name.trim()
  const submit = () => { if (trimmed) onConfirm(trimmed, withHue ? hue : undefined) }
  return (
    <Dialog open onClose={onCancel} title={title} initialFocusRef={inputRef} nested>
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
        {withHue && <HueSwatches value={hue} onChange={setHue} />}
        <DialogActions>
          <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={!trimmed}>{confirmLabel}</button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** The custom colour the input starts on while a preset (or none) is picked. */
const CUSTOM_HUE_START = '#8a7cf0'

/**
 * None + the six preset hues + a custom colour as one radio group (arrow
 * keys move the pick), with the app's colour input (`ColorInput`) for the
 * custom one: changing it picks it. A preset has a light twin; a custom
 * colour is used as it is in both themes.
 */
function HueSwatches({ value, onChange }: { value: string | null; onChange: (hue: string | null) => void }) {
  const customOn = value != null && !isHueName(value)
  // The colour input's value: the custom colour while one is picked, else the last one typed (or a start).
  const [custom, setCustom] = useState(customOn ? value : CUSTOM_HUE_START)
  if (customOn && value !== custom) setCustom(value)
  const options: Array<{ hue: HueName | null; label: string }> = [{ hue: null, label: 'None (the accent)' }, ...HUE_NAMES.map((h) => ({ hue: h, label: HUE_LABEL[h] }))]
  return (
    <fieldset className={styles.hues}>
      <legend className={styles.huesLegend}>Hue</legend>
      <div className={styles.swatches}>
        {options.map((o) => (
          <input
            key={o.hue ?? 'none'}
            type="radio"
            name="layout-hue"
            className={`${styles.swatch} ${o.hue ? '' : styles.swatchNone}`}
            style={o.hue ? { background: hueColor(o.hue) } : undefined}
            checked={value === o.hue}
            onChange={() => onChange(o.hue)}
            aria-label={o.label}
            title={o.label}
            data-hue={o.hue ?? 'none'}
          />
        ))}
        <input
          type="radio"
          name="layout-hue"
          className={styles.swatch}
          style={{ background: custom }}
          checked={customOn}
          onChange={() => onChange(custom)}
          aria-label="Custom colour"
          title="Custom colour"
          data-hue="custom"
        />
      </div>
      <div className={styles.custom} data-hue-custom>
        <ColorInput value={custom} onChange={(c) => { setCustom(c); onChange(c) }} />
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
    <Dialog open onClose={onCancel} title={`Delete layout “${layoutName}”?`} initialFocusRef={cancelRef} nested>
      <DialogBody>{deleteLayoutMessage(ownedLists)}</DialogBody>
      <DialogActions>
        <button ref={cancelRef} type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.danger} onClick={onConfirm}>Delete layout</button>
      </DialogActions>
    </Dialog>
  )
}
