// Icon components for the list sort / group-by option menus. The option →
// icon maps live in `list-option-icon-maps.ts` (kept out of this file so it
// only exports components — react-refresh/only-export-components).
import { StatusIcon } from './StatusIcon'

const svgBase = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 16 16',
  style: { verticalAlign: '-0.125em' } as const,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function FlatIcon() {
  return (
    <svg {...svgBase}>
      <line x1="3" y1="5" x2="13" y2="5" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="3" y1="11" x2="13" y2="11" />
    </svg>
  )
}

export function ManualIcon() {
  return (
    <svg {...svgBase}>
      <line x1="3" y1="5" x2="13" y2="5" />
      <line x1="3" y1="8" x2="10" y2="8" />
      <line x1="3" y1="11" x2="12" y2="11" />
    </svg>
  )
}

export function DeadlineIcon() {
  return <StatusIcon icon="calendar" />
}

export function PeopleIcon() {
  return <StatusIcon icon="person" />
}

export function ProjectIcon() {
  return (
    <svg {...svgBase}>
      <path d="M2.5 5.5V12.5A1 1 0 003.5 13.5H12.5A1 1 0 0013.5 12.5V6A0.5 0.5 0 0013 5.5H8L6.5 4H3A0.5 0.5 0 002.5 4.5V5.5Z" />
    </svg>
  )
}

export function StatusIconGlyph() {
  return <StatusIcon icon="circle" />
}

export function TagIcon() {
  return (
    <svg {...svgBase}>
      <line x1="6" y1="3" x2="4" y2="13" />
      <line x1="12" y1="3" x2="10" y2="13" />
      <line x1="3" y1="6" x2="13" y2="6" />
      <line x1="3" y1="10" x2="13" y2="10" />
    </svg>
  )
}

export function NameIcon() {
  return (
    <svg {...svgBase}>
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        fontFamily="system-ui, sans-serif"
        fill="currentColor"
        stroke="none"
      >
        Aa
      </text>
    </svg>
  )
}
