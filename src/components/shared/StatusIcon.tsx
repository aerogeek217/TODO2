export const STATUS_ICON_KEYS = [
  'person', 'message-bubble', 'circle', 'star', 'stop-sign', 'exclamation',
  'clock', 'check', 'question', 'flag', 'eye', 'bookmark', 'snooze',
] as const
export type StatusIconKey = (typeof STATUS_ICON_KEYS)[number]

const svgBase = { width: '1em', height: '1em', viewBox: '0 0 16 16', style: { verticalAlign: '-0.125em' } as const }

function Svg({ filled, children, strokeOnly }: { filled?: boolean; children: React.ReactNode; strokeOnly?: boolean }) {
  return (
    <svg {...svgBase}
      fill={strokeOnly ? 'none' : filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled && !strokeOnly ? 0 : 1.3}>
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
          strokeWidth={filled ? 0 : 1.3}>
          <circle cx="8" cy="5" r="3" />
          <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
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
          <line x1="8" y1="4.5" x2="8" y2="9" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
        </Svg>
      )
    case 'clock':
      return (
        <Svg filled={filled} strokeOnly>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case 'check':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M3.5 8.5L6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </Svg>
      )
    case 'question':
      return (
        <Svg filled={filled} strokeOnly>
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1-1.5 2.5" strokeLinecap="round" />
          <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
        </Svg>
      )
    case 'flag':
      return (
        <Svg filled={filled} strokeOnly>
          <path d="M3 2v12" strokeLinecap="round" />
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
          <path d="M5 5h6L5 11h6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </Svg>
      )
    default:
      return null
  }
}
