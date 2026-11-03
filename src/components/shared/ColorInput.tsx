import { useState } from 'react'
import styles from './ColorInput.module.css'

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function expandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex.toLowerCase()
}

interface ColorInputProps {
  value: string
  onChange: (color: string) => void
  /** Show the colour wheel, not `value`: the picker's value is one of its presets, so no custom colour is set. */
  wheel?: boolean
  /** The swatch's name (default "Custom colour"). */
  label?: string
}

/**
 * The custom colour: the native colour input as a swatch in a colour-wheel
 * ring (the wheel alone while `wheel`), then the hex to type.
 */
export function ColorInput({ value, onChange, wheel = false, label = 'Custom colour' }: ColorInputProps) {
  const [hexText, setHexText] = useState(value)
  // A new `value` from the parent replaces the text (adjusted during render,
  // not in an effect: no render with the stale text).
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setHexText(value)
  }

  const handleHexChange = (raw: string) => {
    setHexText(raw)
    const normalized = raw.startsWith('#') ? raw : `#${raw}`
    if (HEX_RE.test(normalized)) {
      onChange(expandHex(normalized))
    }
  }

  const handleBlur = () => {
    const normalized = hexText.startsWith('#') ? hexText : `#${hexText}`
    if (!HEX_RE.test(normalized)) {
      setHexText(value)
    }
  }

  return (
    <div className={styles.wrapper}>
      <span className={`${styles.ring} ${wheel ? styles.wheel : ''}`} title={label}>
        <input
          type="color"
          className={styles.swatch}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
      </span>
      <input
        type="text"
        className={styles.hex}
        value={hexText}
        onChange={(e) => handleHexChange(e.target.value)}
        onBlur={handleBlur}
        maxLength={7}
        spellCheck={false}
      />
    </div>
  )
}
