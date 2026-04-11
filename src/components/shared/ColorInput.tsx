import { useState, useEffect } from 'react'
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
}

export function ColorInput({ value, onChange }: ColorInputProps) {
  const [hexText, setHexText] = useState(value)

  useEffect(() => {
    setHexText(value)
  }, [value])

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
      <input
        type="color"
        className={styles.swatch}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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
