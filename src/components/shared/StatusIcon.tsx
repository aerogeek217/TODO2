export { STATUS_ICON_KEYS, type StatusIconKey } from '../../models/status'

const svgBase = { width: '1em', height: '1em', viewBox: '0 0 16 16', style: { verticalAlign: '-0.125em' } as const }

function Svg({ filled, children, strokeOnly }: { filled?: boolean; children: React.ReactNode; strokeOnly?: boolean }) {
  return (
    <svg {...svgBase}
      fill={strokeOnly ? 'none' : filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled && !strokeOnly ? 0 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function StatusIcon({ icon, filled }: { icon?: string; filled?: boolean }) {
  switch (icon) {
    case 'person':
      return (
        <svg {...svgBase}
          fill={filled ? 'currentColor' : 'none'}
          stroke={filled ? 'none' : 'currentColor'}
          strokeWidth={filled ? 0 : 1.6}
          strokeLinecap="round"
          strokeLinejoin="round">
          <circle cx="8" cy="5.25" r="2.75" />
          <path d="M3 13.5a5 5 0 0 1 10 0" />
        </svg>
      )
    case 'message-bubble':
      return (
        <Svg filled={filled}>
          <path d="M3 2.5h10A1.5 1.5 0 0114.5 4v6A1.5 1.5 0 0113 11.5H7.5L4 14.5v-3H3A1.5 1.5 0 011.5 10V4A1.5 1.5 0 013 2.5z" />
        </Svg>
      )
    case 'circle':
      return <Svg filled={filled}><circle cx="8" cy="8" r="5.5" /></Svg>
    case 'star':
      return <Svg filled={filled}><path d="M8 1.5l2 4.5 5 .5-3.8 3.3L12.5 15 8 12.2 3.5 15l1.3-5.2L1 6.5l5-.5z" /></Svg>
    case 'stop-sign':
      return <Svg filled={filled}><path d="M5.5 1.5h5l3.5 3.5v5l-3.5 3.5h-5L2 10V5z" /></Svg>
    case 'exclamation':
      return (
        <Svg filled={filled} strokeOnly>
          <circle cx="8" cy="8" r="6" />
          <line x1="8" y1="4.5" x2="8" y2="9" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
        </Svg>
      )
    case 'clock':
      return (
        <Svg filled={filled} strokeOnly>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        </Svg>
      )
    case 'check':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M3.5 8.5L6.5 11.5 12.5 4.5" />
        </Svg>
      )
    case 'question':
      return (
        <Svg filled={filled} strokeOnly>
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1-1.5 2.5" />
          <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
        </Svg>
      )
    case 'flag':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M3 2v12" />
          <path d="M3 2.5h9l-2.5 3.5L12 9.5H3" fill={filled ? 'currentColor' : 'none'} />
        </Svg>
      )
    case 'eye':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" fill={filled ? 'currentColor' : 'none'} />
        </Svg>
      )
    case 'bookmark':
      return <Svg filled={filled}><path d="M4 2h8a0.5 0.5 0 010.5 0.5V14L8 11 3.5 14V2.5A0.5 0.5 0 014 2z" /></Svg>
    case 'snooze':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M5 5h6L5 11h6" />
        </Svg>
      )
    case 'arrow':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M3 8h10M9 4l4 4-4 4" />
        </Svg>
      )
    case 'calendar':
      return (
        <Svg filled={filled} strokeOnly>
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </Svg>
      )
    case 'sparkle':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M8 1.5C8.6 5.2 10.8 7.4 14.5 8C10.8 8.6 8.6 10.8 8 14.5C7.4 10.8 5.2 8.6 1.5 8C5.2 7.4 7.4 5.2 8 1.5Z" fill={filled ? 'currentColor' : 'none'} />
        </Svg>
      )
    case 'lightbulb':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M5.6 11C5.6 9.4 3.5 8.5 3.5 6A4.5 4.5 0 0 1 12.5 6C12.5 8.5 10.4 9.4 10.4 11Z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M6.2 13.6H9.8" />
        </Svg>
      )
    case 'person-arrow':
      return (
        <Svg filled={filled} strokeOnly>
          {filled
            ? <path d="M3.2 5a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z M1.5 13.5A4 4 0 0 1 9.5 13.5Z" fill="currentColor" />
            : <>
                <circle cx="5.5" cy="5" r="2.3" />
                <path d="M1.5 13.5A4 4 0 0 1 9.5 13.5" />
              </>}
          <path d="M11 8.5H14.5M12.8 6.6L14.6 8.5L12.8 10.4" />
        </Svg>
      )
    case 'pause-circle':
      // Filled: a disc as wide as the outline's ring, the bars cut out of it.
      return filled
        ? (
          <svg {...svgBase} fill="currentColor" fillRule="evenodd">
            <path d="M1.1 8a6.9 6.9 0 1 0 13.8 0a6.9 6.9 0 1 0 -13.8 0Z M5.6 5H7.2V11H5.6Z M8.8 5H10.4V11H8.8Z" />
          </svg>
        )
        : (
          <Svg strokeOnly>
            <circle cx="8" cy="8" r="6.2" />
            <path d="M6.4 5.5V10.5M9.6 5.5V10.5" />
          </Svg>
        )
    case 'person-circle':
      // Filled: a disc with the head and shoulders cut out of it.
      return filled
        ? (
          <svg {...svgBase} fill="currentColor" fillRule="evenodd">
            <path d="M0.8 8a7.2 7.2 0 1 0 14.4 0a7.2 7.2 0 1 0 -14.4 0Z M5.8 6.3a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z M4.1 12.9C5.1 10.9 6.4 10 8 10C9.6 10 10.9 10.9 11.9 12.9C10.9 13.9 9.5 14.3 8 14.3C6.5 14.3 5.1 13.9 4.1 12.9Z" />
          </svg>
        )
        : (
          <Svg strokeOnly>
            <circle cx="8" cy="8" r="6.5" />
            <circle cx="8" cy="6.3" r="2.2" />
            <path d="M4.4 12.9C5.3 11.1 6.5 10.3 8 10.3C9.5 10.3 10.7 11.1 11.6 12.9" />
          </Svg>
        )
    case 'pushpin':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M6.5 1.8H9.5V6L12 9.2H4L6.5 6Z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M5 1.8H11M8 9.2V14.6" />
        </Svg>
      )
    default:
      return null
  }
}
