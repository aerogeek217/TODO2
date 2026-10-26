import { useId } from 'react'
import { HUE_NAMES } from '../../models/workspace-layout'
import { HUE_LABEL, HUE_PRESET_HEX, presetHueOf } from '../../utils/layout-hue'
import { ColorInput } from './ColorInput'
import styles from './ColorPicker.module.css'

interface ColorPickerProps {
  /** The colour, a hex. */
  value: string
  onChange: (hex: string) => void
  /** Before the presets: an extra swatch that stands for "no colour" (the layout dialog's None). */
  before?: React.ReactNode
}

/**
 * The app's one colour picker: the six preset hues as swatches (one radio
 * group; the one whose colour `value` is reads checked), then `ColorInput`
 * (the native picker's swatch and the hex) for any other colour. Used by
 * the people, status and tag editors and by the layout dialog (which maps a
 * preset back to its theme-aware hue name). `data-custom` marks a colour
 * that is no preset.
 */
export function ColorPicker({ value, onChange, before }: ColorPickerProps) {
  const name = useId()
  const preset = presetHueOf(value)
  return (
    <div className={styles.picker} data-color-picker="" data-custom={preset ? undefined : 'true'}>
      <div className={styles.presets} role="radiogroup" aria-label="Preset colours">
        {before}
        {HUE_NAMES.map((h) => (
          <input
            key={h}
            type="radio"
            name={name}
            className={styles.swatch}
            style={{ background: HUE_PRESET_HEX[h] }}
            checked={preset === h}
            onChange={() => onChange(HUE_PRESET_HEX[h])}
            aria-label={HUE_LABEL[h]}
            title={HUE_LABEL[h]}
            data-hue={h}
          />
        ))}
      </div>
      <ColorInput value={value} onChange={onChange} />
    </div>
  )
}
